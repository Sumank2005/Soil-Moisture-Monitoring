import {parentPort} from 'node:worker_threads';
import {pool} from './db.js';
import {processBatch} from './ingest-queue.js';

let stopping=false,wake;
parentPort.on('message',message=>{if(message==='stop'){stopping=true;wake?.()}});
const pause=ms=>new Promise(resolve=>{const timer=setTimeout(done,ms);function done(){clearTimeout(timer);wake=null;resolve()}wake=done});
let failures=0,lastCleanup=0;
while(!stopping) {
 try {
  let processed=0,inserted=0,batch;
  // Drain a burst in bounded transactions, then yield before the next cycle.
  for(let i=0;i<10&&!stopping;i++) {
   batch=await processBatch(pool);
   processed+=batch.processed;inserted+=batch.inserted;
   if(batch.processed<100)break;
  }
  if(!stopping&&Date.now()-lastCleanup>=6*3600000) {
   await pool.query('DELETE FROM public.soilsense_readings WHERE received_at < $1',[Date.now()-7*86400000]);
   lastCleanup=Date.now();
  }
  failures=0;
  parentPort.postMessage({type:'progress',at:Date.now(),processed,inserted});
  if(!stopping)await pause(batch?.processed===100?100:5000);
 } catch(error) {
  failures++;
  console.error('Telemetry worker retry:',error.code||error.name);
  parentPort.postMessage({type:'retry',at:Date.now()});
  if(!stopping)await pause(Math.min(60000,5000*2**Math.min(failures-1,4)));
 }
}
await pool.end();
parentPort.close();
