import {config as loadEnv} from 'dotenv';
import {fileURLToPath} from 'node:url';
// Resolve independently of the shell working directory and any frontend files.
loadEnv({path:fileURLToPath(new URL('../.env',import.meta.url)),quiet:true});
for(const key of ['DATABASE_URL','DASHBOARD_PASSWORD','SESSION_SECRET','DEVICE_TOKEN'])if(!process.env[key])throw new Error(`Missing ${key}. Configure backend/.env or the backend host environment.`);
if(process.env.SESSION_SECRET.length<32||process.env.DEVICE_TOKEN.length<32)throw new Error('SESSION_SECRET and DEVICE_TOKEN require at least 32 characters.');
const production=process.env.NODE_ENV==='production'||process.env.RENDER==='true';
const frontendOrigin=process.env.FRONTEND_ORIGIN?.trim();
const backendUrl=(process.env.RENDER_EXTERNAL_URL||process.env.BACKEND_URL)?.trim();
// Production hosts must use their public HTTPS origins, even if old local
// development values were copied into the hosting environment.
export const config={
 databaseUrl:process.env.DATABASE_URL,password:process.env.DASHBOARD_PASSWORD,
 sessionSecret:process.env.SESSION_SECRET,deviceToken:process.env.DEVICE_TOKEN,
 port:Number(process.env.PORT||3001),host:process.env.BACKEND_HOST||'0.0.0.0',
 origin:new URL(production?(frontendOrigin?.startsWith('https://')?frontendOrigin:'https://soilsense-ten-delta.vercel.app'):(frontendOrigin||'http://localhost:5173')).origin,
 backendUrl:new URL(production?(backendUrl?.startsWith('https://')?backendUrl:'https://soilsense-gz6h.onrender.com'):(backendUrl||'http://localhost:3001')).origin,
 production,trustProxy:process.env.TRUST_PROXY==='1'||process.env.RENDER==='true',
};
