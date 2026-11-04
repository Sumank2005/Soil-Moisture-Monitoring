import {config as loadEnv} from 'dotenv';
import {fileURLToPath} from 'node:url';
// Resolve independently of the shell working directory and any frontend files.
loadEnv({path:fileURLToPath(new URL('../.env',import.meta.url)),quiet:true});
for(const key of ['DATABASE_URL','DASHBOARD_PASSWORD','SESSION_SECRET','DEVICE_TOKEN'])if(!process.env[key])throw new Error(`Missing ${key}. Configure backend/.env or the backend host environment.`);
if(process.env.SESSION_SECRET.length<32||process.env.DEVICE_TOKEN.length<32)throw new Error('SESSION_SECRET and DEVICE_TOKEN require at least 32 characters.');
export const config={databaseUrl:process.env.DATABASE_URL,password:process.env.DASHBOARD_PASSWORD,sessionSecret:process.env.SESSION_SECRET,deviceToken:process.env.DEVICE_TOKEN,port:Number(process.env.PORT||3001),host:process.env.BACKEND_HOST||'0.0.0.0',origin:process.env.FRONTEND_ORIGIN||'http://localhost:5173',backendUrl:(process.env.BACKEND_URL||'http://localhost:3001').replace(/\/$/,''),production:process.env.NODE_ENV==='production'};
