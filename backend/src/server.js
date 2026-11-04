import {config} from './config.js';
import {pool} from './db.js';
import {createApp} from './app.js';
import {ensureQueue} from './ingest-queue.js';
import {startWorker} from './worker-manager.js';
await ensureQueue(pool);
const worker=startWorker();
const server=createApp({pool,config,workerStatus:worker.status}).listen(config.port,config.host,()=>console.log(`SoilSense backend: http://localhost:${config.port}\nDevice upload: ${config.backendUrl}/api/ingest\nDurable telemetry queue and background worker enabled.`));
let stopping=false;
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{
 if(stopping)return;stopping=true;
 server.close(async()=>{await worker.stop();await pool.end();process.exit(0)});
 setTimeout(()=>process.exit(1),20000).unref();
});
