import test from 'node:test';
import assert from 'node:assert/strict';
import {processBatch,createReadCache} from '../src/ingest-queue.js';
import {createApp} from '../src/app.js';
import {signSession} from '../src/auth.js';

const payload={boot_id:'abcdef12-12345678',seq:1,raw:2300,moisture:49,pump:false,sensor_fault:false,timeout_fault:false,rssi:-62,uptime_s:60,dry_raw:3130,wet_raw:1450,threshold_on:30,threshold_off:55};
const config={password:'test',sessionSecret:'s'.repeat(64),deviceToken:'d'.repeat(64),origin:'http://localhost:5173',production:false};

test('worker stores a batch once and removes queue entries in the same transaction',async()=>{
 let queries=0;
 const pool={async query(){queries++;return {rows:[{processed:'100',inserted:'99'}]}}};
 assert.deepEqual(await processBatch(pool),{processed:100,inserted:99});
 assert.equal(queries,1);
});

test('failed batch rolls back without deleting or acknowledging queued readings',async()=>{
 let queries=0;
 await assert.rejects(processBatch({async query(){queries++;throw new Error('database interrupted')}}),/database interrupted/);
 assert.equal(queries,1);
});

test('dashboard cache collapses concurrent loads, expires and retries failures',async()=>{
 let now=0,calls=0,release;const cached=createReadCache(15000,()=>now);
 const load=()=>{calls++;return new Promise(resolve=>{release=resolve})};
 const first=cached(6,load),second=cached(6,load);await Promise.resolve();assert.equal(calls,1);release('same');assert.equal(await first,'same');assert.equal(await second,'same');
 assert.equal(await cached(6,()=>{throw Error('should be cached')}),'same');
 now=15001;assert.equal(await cached(6,async()=>{calls++;return 'new'}),'new');assert.equal(calls,2);
 await assert.rejects(cached(1,async()=>{throw Error('offline')}),/offline/);assert.equal(await cached(1,async()=>'recovered'),'recovered');
});

test('API rate limits bursts and does not acknowledge a failed database enqueue',async t=>{
 let fail=false,release;const blocked=new Promise(resolve=>{release=resolve});let calls=0;
 const pool={async query(){calls++;if(fail)throw new Error('offline');await blocked;return {rowCount:1}}};
 const server=createApp({pool,config}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
 const base=`http://127.0.0.1:${server.address().port}`;
 // Different source IPs are unnecessary: the existing 30/minute rate limiter
 // remains an independent boundary in addition to the in-flight upload cap.
 const send=()=>fetch(base+'/api/ingest',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${config.deviceToken}`},body:JSON.stringify(payload)});
 const pending=Array.from({length:30},send);
 const deadline=Date.now()+5000;
 while(calls<30&&Date.now()<deadline)await new Promise(r=>setTimeout(r,5));
 assert.equal(calls,30);
 const rejected=await send();assert.equal(rejected.status,429);assert.ok(rejected.headers.get('retry-after'));
 release();assert.ok((await Promise.all(pending)).every(response=>response.status===200));
 // A fresh app has a fresh rate-limit window and must return 500 on DB failure.
 fail=true;
 const other=createApp({pool,config}).listen(0,'127.0.0.1');await new Promise(r=>other.once('listening',r));t.after(()=>new Promise(r=>other.close(r)));
 const failed=await fetch(`http://127.0.0.1:${other.address().port}/api/ingest`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${config.deviceToken}`},body:JSON.stringify(payload)});
 assert.equal(failed.status,500);assert.equal((await failed.json()).ok,undefined);
});

test('in-flight uploads are bounded even when requests come from different IPs',async t=>{
 let release,calls=0;const blocked=new Promise(resolve=>{release=resolve});
 const pool={async query(){calls++;await blocked;return {rowCount:1}}};
 const server=createApp({pool,config:{...config,trustProxy:true}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>{release();return new Promise(r=>server.close(r))});
 const send=i=>fetch(`http://127.0.0.1:${server.address().port}/api/ingest`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${config.deviceToken}`,'X-Forwarded-For':`192.0.2.${i}`},body:JSON.stringify({...payload,seq:i})});
 const pending=Array.from({length:32},(_,i)=>send(i+1));
 const deadline=Date.now()+5000;while(calls<32&&Date.now()<deadline)await new Promise(r=>setTimeout(r,5));assert.equal(calls,32);
 const response=await send(33);assert.equal(response.status,503);assert.equal(response.headers.get('retry-after'),'5');assert.equal(calls,32);
 release();assert.ok((await Promise.all(pending)).every(response=>response.status===200));
});

test('concurrent authenticated dashboard requests share four database queries',async t=>{
 let calls=0;
 const pool={async query(sql){calls++;await new Promise(r=>setTimeout(r,10));return {rows:sql.includes('COUNT(*)')?[{min:null,max:null,avg:null,count:0}]:[]}}};
 const server=createApp({pool,config}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
 const base=`http://127.0.0.1:${server.address().port}/api/readings?hours=6`,headers={Authorization:`Bearer ${signSession(config.sessionSecret)}`};
 const responses=await Promise.all(Array.from({length:20},()=>fetch(base,{headers})));
 assert.ok(responses.every(response=>response.status===200));assert.equal(calls,4);
 assert.equal((await fetch(base)).status,401);assert.equal(calls,4);
});
