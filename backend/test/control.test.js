import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../src/app.js';
import {signSession} from '../src/auth.js';
import {telemetrySchema} from '../src/telemetry.js';

const config={sessionSecret:'s'.repeat(64),deviceToken:'d'.repeat(64),origin:'http://localhost:5173',production:false};
test('pump controls require owner login, reject foreign origins and validate actions',async t=>{
 let queries=0;const pool={async query(){queries++;return {rows:[]}}};
 const server=createApp({pool,config}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
 const url=`http://127.0.0.1:${server.address().port}/api/control`;
 assert.equal((await fetch(url)).status,401);
 assert.equal((await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${config.deviceToken}`},body:'{"action":"on"}'})).status,401);
 const headers={Authorization:`Bearer ${signSession(config.sessionSecret)}`,'Content-Type':'application/json',Origin:config.origin};
 assert.equal((await fetch(url,{method:'POST',headers:{...headers,Origin:'https://foreign.example'},body:'{"action":"on"}'})).status,403);
 for(const body of [{action:'reboot'},{action:'on',duration:999},{},null])assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify(body)})).status,400);
 assert.equal(queries,0);
 const offline=await fetch(url,{method:'POST',headers,body:'{"action":"on"}'});assert.equal(offline.status,409);assert.match((await offline.json()).error,/firmware/);
});

test('telemetry accepts explicit command acknowledgements but rejects malformed ones',()=>{
 const sample={boot_id:'abcdef12-12345678',seq:1,raw:2300,moisture:49,pump:false,sensor_fault:false,timeout_fault:false,rssi:-62,uptime_s:60,dry_raw:3130,wet_raw:1450,threshold_on:30,threshold_off:55};
 assert.equal(telemetrySchema.safeParse(sample).success,true);
 const control={...sample,control_version:1,control_mode:'manual_off',command_ack:{id:'00000000-0000-4000-8000-000000000001',result:'applied'}};
 assert.equal(telemetrySchema.safeParse(control).success,true);
 assert.equal(telemetrySchema.safeParse({...control,command_ack:{...control.command_ack,result:'whatever'}}).success,false);
 assert.equal(telemetrySchema.safeParse({...control,command_ack:{...control.command_ack,id:'not-a-uuid'}}).success,false);
});
