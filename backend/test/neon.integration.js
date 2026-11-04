// Real PostgreSQL integration, isolated in a session-local temporary table.
import assert from 'node:assert/strict';
import {pool} from '../src/db.js';
import {config} from '../src/config.js';
import {createApp} from '../src/app.js';
const client=await pool.connect();let server;
try{
 await client.query('BEGIN');
 const table='soilsense_test_'+Date.now();
 await client.query(`CREATE TEMP TABLE ${table} (LIKE public.soilsense_readings INCLUDING ALL) ON COMMIT DROP`);
 // Neon uses transaction pooling. Hold one outer transaction throughout,
 // translating the API transaction into a savepoint and serializing reads.
 let queue=Promise.resolve();
 const query=(sql,args)=>{const mapped=sql==='BEGIN'?'SAVEPOINT api_upload':sql==='COMMIT'?'RELEASE SAVEPOINT api_upload':sql==='ROLLBACK'?'ROLLBACK TO SAVEPOINT api_upload':sql.replaceAll('public.soilsense_readings',`pg_temp.${table}`);const result=queue.then(()=>client.query(mapped,args));queue=result.catch(()=>{});return result};
 const db={query,connect:async()=>({query,release(){}})};
 server=createApp({pool:db,config}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
 const sample={boot_id:'abcdef12-12345678',seq:1,raw:2300,moisture:49,pump:false,sensor_fault:false,timeout_fault:false,rssi:-62,uptime_s:60,dry_raw:3130,wet_raw:1450,threshold_on:30,threshold_off:55};
 const send=data=>fetch(base+'/api/ingest',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+config.deviceToken},body:JSON.stringify(data)});
 assert.equal((await send(sample)).status,200);assert.equal((await (await send(sample)).json()).duplicate,true);
 assert.equal((await send({...sample,seq:2,moisture:0,sensor_fault:true})).status,200);
 const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:config.password})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
 for(const hours of [1,6,24]){const res=await fetch(base+`/api/readings?hours=${hours}`,{headers:{cookie}});assert.equal(res.status,200);const data=await res.json();assert.equal(data.stats.count,2);assert.equal(data.stats.avg,49);assert.equal(data.recent.length,2);assert.equal(typeof data.latest.received_at,'number');assert.equal(data.history.length,1);assert.equal(data.history[0].moisture,49)}
 console.log('Neon integration passed: authenticated upload, deduplication, reads, aggregation and sensor-fault exclusion. Temporary samples are discarded on disconnect.');
}finally{if(server)await new Promise(r=>server.close(r));await client.query('ROLLBACK');client.release();await pool.end()}
