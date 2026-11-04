import {config} from './config.js';
import {pool} from './db.js';
import {createApp} from './app.js';
const server=createApp({pool,config}).listen(config.port,config.host,()=>console.log(`SoilSense backend: http://localhost:${config.port}\nDevice upload: ${config.backendUrl}/api/ingest`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{server.close(async()=>{await pool.end();process.exit(0)});setTimeout(()=>process.exit(1),10000).unref()});
