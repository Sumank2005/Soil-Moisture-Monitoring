import {Worker} from 'node:worker_threads';

export function startWorker() {
 let worker,restartTimer,stopping=false,failures=0;
 const status={state:'starting',lastProcessedAt:null,processed:0};
 function launch() {
  if(stopping)return;
  status.state='starting';
  worker=new Worker(new URL('./worker.js',import.meta.url));
  worker.on('message',message=>{
   if(message.type==='progress'){failures=0;status.state='running';status.lastProcessedAt=message.at;status.processed+=message.processed}
   if(message.type==='retry')status.state='retrying';
  });
  worker.on('error',error=>console.error('Telemetry worker stopped:',error.code||error.name));
  worker.on('exit',()=>{
   worker=null;
   if(stopping)return;
   status.state='restarting';
   restartTimer=setTimeout(launch,Math.min(60000,1000*2**Math.min(failures++,6)));
  });
 }
 launch();
 return {
  status:()=>({...status}),
  async stop(){stopping=true;clearTimeout(restartTimer);if(!worker)return;const exited=new Promise(resolve=>worker.once('exit',resolve));worker.postMessage('stop');await exited},
 };
}
