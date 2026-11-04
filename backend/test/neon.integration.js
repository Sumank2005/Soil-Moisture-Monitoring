// Real PostgreSQL integration, isolated in a session-local temporary table.
import assert from 'node:assert/strict';
import {pool} from '../src/db.js';
import {config} from '../src/config.js';
import {createApp} from '../src/app.js';
import {processBatch} from '../src/ingest-queue.js';
import {readFile} from 'node:fs/promises';
import {recordDeviceState,queueCommand,getControl} from '../src/device-control.js';
const client=await pool.connect();let server;
try{
 await client.query('BEGIN');
 const table='soilsense_test_'+Date.now();
 await client.query(`CREATE TEMP TABLE ${table} (LIKE public.soilsense_readings INCLUDING ALL) ON COMMIT DROP`);
 const inbox=table+'_queue';
 await client.query(`CREATE TEMP TABLE ${inbox}(id BIGSERIAL PRIMARY KEY,boot_id TEXT NOT NULL,seq BIGINT NOT NULL,received_at BIGINT NOT NULL,payload JSONB NOT NULL,UNIQUE(boot_id,seq)) ON COMMIT DROP`);
 const controlTable=table+'_control';
 await client.query((await readFile(new URL('../migrations/003_device_control.sql',import.meta.url),'utf8')).replace('CREATE TABLE IF NOT EXISTS soilsense_device_control',`CREATE TEMP TABLE ${controlTable}`).replace(');',') ON COMMIT DROP;'));
 // Neon uses transaction pooling. Hold one outer transaction throughout,
 // translating the API transaction into a savepoint and serializing reads.
 let queue=Promise.resolve();
 const query=(sql,args)=>{const mapped=sql==='BEGIN'?'SAVEPOINT api_upload':sql==='COMMIT'?'RELEASE SAVEPOINT api_upload':sql==='ROLLBACK'?'ROLLBACK TO SAVEPOINT api_upload':sql.replaceAll('public.soilsense_readings',`pg_temp.${table}`).replaceAll('public.soilsense_ingest_queue',`pg_temp.${inbox}`).replaceAll('public.soilsense_device_control',`pg_temp.${controlTable}`).replaceAll('soilsense_device_control.',`${controlTable}.`);const result=queue.then(()=>client.query(mapped,args));queue=result.catch(()=>{});return result};
 const db={query,connect:async()=>({query,release(){}})};
 server=createApp({pool:db,config}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
 const sample={boot_id:'abcdef12-12345678',seq:1,raw:2300,moisture:49,pump:false,sensor_fault:false,timeout_fault:false,rssi:-62,uptime_s:60,dry_raw:3130,wet_raw:1450,threshold_on:30,threshold_off:55};
 const send=data=>fetch(base+'/api/ingest',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+config.deviceToken},body:JSON.stringify(data)});
 assert.equal((await send(sample)).status,200);assert.equal((await (await send(sample)).json()).duplicate,true);
 assert.equal((await send({...sample,seq:2,moisture:0,sensor_fault:true})).status,200);
 assert.equal(Number((await query('SELECT COUNT(*) AS count FROM public.soilsense_readings')).rows[0].count),0);
 assert.deepEqual(await processBatch(db),{processed:2,inserted:2});
 assert.deepEqual(await processBatch(db),{processed:0,inserted:0});
 assert.equal((await (await send(sample)).json()).duplicate,true);
 // Force a real insert failure and verify that the same atomic batch leaves
 // its inbox entry intact, then succeeds after the transient cause is removed.
 await query(`ALTER TABLE pg_temp.${table} ADD CONSTRAINT simulate_failure CHECK(raw<>2301)`);
 assert.equal((await send({...sample,seq:3,raw:2301})).status,200);
 await query('SAVEPOINT failed_batch');
 await assert.rejects(processBatch(db),error=>error.code==='23514');
 await query('ROLLBACK TO SAVEPOINT failed_batch');
 assert.equal(Number((await query('SELECT COUNT(*) AS count FROM public.soilsense_ingest_queue')).rows[0].count),1);
 assert.equal(Number((await query('SELECT COUNT(*) AS count FROM public.soilsense_readings')).rows[0].count),2);
 await query(`ALTER TABLE pg_temp.${table} DROP CONSTRAINT simulate_failure`);
 assert.deepEqual(await processBatch(db),{processed:1,inserted:1});
 const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:config.password})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
 for(const hours of [1,6,24]){const res=await fetch(base+`/api/readings?hours=${hours}`,{headers:{cookie}});assert.equal(res.status,200);const data=await res.json();assert.equal(data.stats.count,3);assert.equal(data.stats.avg,49);assert.equal(data.recent.length,3);assert.equal(typeof data.latest.received_at,'number');assert.equal(data.history.length,1);assert.equal(data.history[0].moisture,49)}
 // Old firmware cannot receive commands; commands require a live capable boot.
 const now=Date.now();
 assert.equal((await queueCommand(db,'on',now)).ok,false);
 const capable={...sample,seq:10,control_version:1,control_mode:'manual_off',timeout_fault:true};
 await recordDeviceState(db,capable,now);
 assert.equal((await queueCommand(db,'on',now)).ok,false);
 const reset=await queueCommand(db,'reset',now);assert.equal(reset.ok,true);
 const delivered=await recordDeviceState(db,{...capable,seq:11},now+1000);assert.equal(delivered.id,reset.control.command.id);assert.equal(delivered.action,'reset');
 assert.equal((await queueCommand(db,'auto',now+1000)).ok,false);
 await recordDeviceState(db,{...capable,seq:12,timeout_fault:false,command_ack:{id:delivered.id,result:'applied'}},now+2000);
 assert.equal((await getControl(db,now+2000)).command.status,'applied');
 assert.equal((await queueCommand(db,'on',now+2000)).ok,true);
 const off=await queueCommand(db,'off',now+2001);assert.equal(off.ok,true);
 // A late acknowledgement for the replaced ON must not acknowledge OFF.
 await recordDeviceState(db,{...capable,seq:13,timeout_fault:false,command_ack:{id:delivered.id,result:'applied'}},now+3000);
 assert.equal((await getControl(db,now+3000)).command.id,off.control.command.id);
 assert.equal((await getControl(db,now+3000)).command.status,'pending');
 assert.equal(await recordDeviceState(db,{...capable,seq:14},now+33000),null);
 assert.equal((await getControl(db,now+33000)).command.status,'expired');
 assert.equal((await queueCommand(db,'off',now+100000)).ok,false);
 await recordDeviceState(db,{...capable,seq:15},now+100000);
 assert.equal((await queueCommand(db,'reset',now+100000)).ok,true);
 await recordDeviceState(db,{...capable,boot_id:'bbbbbbbb-11111111',seq:0},now+101000);
 assert.equal((await getControl(db,now+101000)).command.status,'expired');
 console.log('Neon integration passed: durable enqueue, batch worker, idempotent replay, authenticated reads, aggregation and sensor-fault exclusion. Temporary samples are rolled back.');
}finally{if(server)await new Promise(r=>server.close(r));await client.query('ROLLBACK');client.release();await pool.end()}
