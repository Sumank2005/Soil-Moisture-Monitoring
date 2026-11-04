import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../src/app.js';
import {signSession,validSession} from '../src/auth.js';
const config={password:'test-password',sessionSecret:'s'.repeat(64),deviceToken:'d'.repeat(64),origin:'http://localhost:5173',backendUrl:'http://192.168.1.7:3001',production:false};
const payload={boot_id:'abcddcba-12345678',seq:1,raw:2300,moisture:49,pump:false,sensor_fault:false,timeout_fault:false,rssi:-62,uptime_s:60,dry_raw:3130,wet_raw:1450,threshold_on:30,threshold_off:55};
test('sessions reject tampering, expiration and wrong secrets',()=>{const token=signSession(config.sessionSecret,1000);assert.equal(validSession(token,config.sessionSecret,1001),true);assert.equal(validSession(token,'wrong',1001),false);assert.equal(validSession(token,config.sessionSecret,86401000),false);assert.equal(validSession(token+'x',config.sessionSecret,1001),false)});
test('production accepts the deployed Vercel origin and rejects unrelated sites',async t=>{
 const server=createApp({pool:{},config:{...config,production:true,origin:'https://previous.example.com'}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));const base=`http://127.0.0.1:${server.address().port}`;
 const allowed=await fetch(base+'/api/session',{headers:{Origin:'https://soilsense-ten-delta.vercel.app'}});assert.equal(allowed.status,200);assert.equal(allowed.headers.get('access-control-allow-origin'),'https://soilsense-ten-delta.vercel.app');
 assert.equal((await fetch(base+'/api/session',{headers:{Origin:'https://unrelated.example.com'}})).status,403);
});
test('API authentication, validation, durable enqueue and deduplication',async t=>{
 let inserted=false;const queries=[];
 const client={query:async(sql,args)=>{queries.push([sql,args]);if(sql.startsWith('INSERT')){const count=inserted?0:1;inserted=true;return {rowCount:count}}return {rows:[]}},release(){}};
 const pool={connect:async()=>client,query:client.query};
 const server=createApp({pool,config}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
 const base=`http://127.0.0.1:${server.address().port}`;
 for(const path of ['/api/readings','/api/device-config'])assert.equal((await fetch(base+path)).status,401);
 const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:config.password})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];assert.match(login.headers.get('set-cookie'),/HttpOnly/i);
 const {token}=await login.json();assert.ok(validSession(token,config.sessionSecret));
 // A frontend on another host must stay signed in even when the browser
 // blocks third-party cookies. These requests deliberately send no cookie.
 const bearerHeaders={Authorization:`Bearer ${token}`,Origin:config.origin};
 const bearerSession=await fetch(base+'/api/session',{headers:bearerHeaders});assert.equal((await bearerSession.json()).authenticated,true);
 const bearerConfig=await fetch(base+'/api/device-config',{headers:bearerHeaders});assert.equal(bearerConfig.status,200);
 assert.equal((await fetch(base+'/api/device-config',{headers:{Authorization:'Bearer invalid',Origin:config.origin}})).status,401);
 const download=await fetch(base+'/api/device-config',{headers:{cookie}});assert.equal(download.status,200);const firmwareConfig=await download.text();assert.match(firmwareConfig,/DEVICE_TOKEN/);assert.ok(firmwareConfig.includes('http://192.168.1.7:3001/api/ingest'));assert.ok(!firmwareConfig.includes(':5173'));assert.equal(download.headers.get('cache-control'),'no-store');
 const preflight=await fetch(base+'/api/login',{method:'OPTIONS',headers:{Origin:config.origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type'}});assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),config.origin);assert.equal(preflight.headers.get('access-control-allow-credentials'),'true');
 const session=await fetch(base+'/api/session',{headers:{Origin:config.origin,cookie}});assert.equal((await session.json()).authenticated,true);assert.equal(session.headers.get('access-control-allow-origin'),config.origin);
 assert.equal((await fetch(base+'/api/session',{headers:{Origin:'https://other.example'}})).status,403);
 assert.equal((await fetch(base+'/assets/index.js')).status,404);
 const send=(data,token=config.deviceToken)=>fetch(base+'/api/ingest',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(data)});
 assert.equal((await send(payload,'wrong')).status,401);assert.equal(queries.length,0);
 for(const invalid of [{...payload,moisture:101},{...payload,pump:1},{...payload,threshold_off:20},{...payload,unexpected:true}])assert.equal((await send(invalid)).status,400);
 assert.equal((await send(payload)).status,200);assert.equal((await (await send(payload)).json()).duplicate,true);
 const insert=queries.find(([sql])=>sql.startsWith('INSERT'));assert.match(insert[0],/soilsense_ingest_queue/);assert.equal(JSON.parse(insert[1][3]).raw,2300);assert.equal(queries.length,2);assert.ok(!queries.some(([sql])=>sql==='BEGIN'||sql.startsWith('DELETE')));
 assert.equal((await fetch(base+'/api/readings?hours=bad',{headers:{cookie}})).status,400);
 assert.equal((await fetch(base+'/api/logout',{method:'POST',headers:{Origin:'https://other.example'}})).status,403);
 assert.equal((await fetch(base+'/api/ingest',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'})).status,400);
 assert.equal((await send({...payload,padding:'x'.repeat(3000)})).status,413);
});
