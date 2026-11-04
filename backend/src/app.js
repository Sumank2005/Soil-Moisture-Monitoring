import express from 'express';
import helmet from 'helmet';
import {rateLimit} from 'express-rate-limit';
import {equal,sessionFrom,signSession} from './auth.js';
import {telemetrySchema} from './telemetry.js';
const numeric=['received_at','seq','raw','moisture','pump','sensor_fault','timeout_fault','rssi','uptime','dry_raw','wet_raw','on_percent','off_percent'];
function reading(row){if(!row)return null;const result={...row};for(const c of numeric)result[c]=Number(result[c]);delete result.id;delete result.boot_id;return result}
export function createApp({pool,config}){
 const app=express();app.disable('x-powered-by');if(config.trustProxy)app.set('trust proxy',1);
 app.use(helmet({contentSecurityPolicy:{directives:{'style-src':["'self'","'unsafe-inline'",'https://fonts.googleapis.com'],'font-src':["'self'",'https://fonts.gstatic.com'],'script-src':["'self'"],'img-src':["'self'",'data:']}}}));
 app.use('/api',(_req,res,next)=>{res.set('Cache-Control','no-store');next()});
 const origins=new Set([config.origin]);if(!config.production&&['http://localhost:5173','http://127.0.0.1:5173'].includes(config.origin)){origins.add('http://localhost:5173');origins.add('http://127.0.0.1:5173')}
 if(config.production)origins.add('https://soilsense-ten-delta.vercel.app');
 app.use('/api',(req,res,next)=>{
  const origin=req.headers.origin;
  if(origin&&!origins.has(origin))return res.status(403).json({error:'Origin not allowed'});
  if(origin){res.set('Access-Control-Allow-Origin',origin);res.set('Access-Control-Allow-Credentials','true');res.vary('Origin')}
  if(req.method==='OPTIONS'){res.set('Access-Control-Allow-Methods','GET, POST, OPTIONS');res.set('Access-Control-Allow-Headers','Content-Type, Authorization');return res.sendStatus(204)}
  next();
 });
 app.use(express.json({limit:'2kb'}));
 const requireOwner=(req,res,next)=>sessionFrom(req,config.sessionSecret)?next():res.status(401).json({error:'Please sign in'});
 app.get('/api/session',(req,res)=>res.json({authenticated:sessionFrom(req,config.sessionSecret)}));
 app.post('/api/login',rateLimit({windowMs:15*60000,limit:10,standardHeaders:'draft-8',legacyHeaders:false}),(req,res)=>{if(!equal(req.body?.password,config.password))return res.status(401).json({error:'Incorrect password'});const token=signSession(config.sessionSecret);res.cookie('soilsense_session',token,{httpOnly:true,sameSite:'strict',secure:config.production,path:'/',maxAge:86400000}).json({ok:true,token})});
 app.post('/api/logout',(_req,res)=>{res.clearCookie('soilsense_session',{path:'/'}).json({ok:true})});
 app.get('/api/health',async(_req,res)=>{try{await pool.query('SELECT 1');res.json({ok:true,database:'connected'})}catch{res.status(503).json({ok:false,database:'unavailable'})}});
 app.post('/api/ingest',rateLimit({windowMs:60000,limit:30,standardHeaders:'draft-8',legacyHeaders:false}),async(req,res)=>{
  if(!equal(req.headers.authorization,`Bearer ${config.deviceToken}`))return res.status(401).json({error:'Invalid device credential'});
  const parsed=telemetrySchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'Invalid telemetry'});
  const p=parsed.data,now=Date.now(),client=await pool.connect();
  try{await client.query('BEGIN');const result=await client.query('INSERT INTO public.soilsense_readings(received_at,boot_id,seq,raw,moisture,pump,sensor_fault,timeout_fault,rssi,uptime,dry_raw,wet_raw,on_percent,off_percent) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT(boot_id,seq) DO NOTHING',[now,p.boot_id,p.seq,p.raw,p.moisture,+p.pump,+p.sensor_fault,+p.timeout_fault,p.rssi,p.uptime_s,p.dry_raw,p.wet_raw,p.threshold_on,p.threshold_off]);await client.query('DELETE FROM public.soilsense_readings WHERE received_at < $1',[now-7*86400000]);await client.query('COMMIT');res.json({ok:true,duplicate:result.rowCount===0,received_at:now})}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
 });
 app.get('/api/readings',requireOwner,async(req,res)=>{
  const hours=Number(req.query.hours??6);if(![1,6,24].includes(hours))return res.status(400).json({error:'hours must be 1, 6 or 24'});
  const now=Date.now(),since=now-hours*3600000,bucket=hours<=1?10000:hours<=6?60000:300000;
  const [latest,history,stats,recent]=await Promise.all([
   pool.query('SELECT * FROM public.soilsense_readings WHERE received_at >= $1 ORDER BY received_at DESC,id DESC LIMIT 1',[now-7*86400000]),
   pool.query('SELECT FLOOR(received_at::numeric / $1)*$1 AS time, AVG(moisture) AS moisture, MAX(pump) AS pump FROM public.soilsense_readings WHERE received_at >= $2 AND sensor_fault=0 GROUP BY FLOOR(received_at::numeric / $1) ORDER BY time LIMIT 500',[bucket,since]),
   pool.query('SELECT MIN(moisture) FILTER(WHERE sensor_fault=0) AS min, MAX(moisture) FILTER(WHERE sensor_fault=0) AS max, AVG(moisture) FILTER(WHERE sensor_fault=0) AS avg, COUNT(*) AS count FROM public.soilsense_readings WHERE received_at >= $1',[since]),
   pool.query('SELECT * FROM public.soilsense_readings WHERE received_at >= $1 ORDER BY received_at DESC,id DESC LIMIT 20',[since])]);
  const s=stats.rows[0];res.json({latest:reading(latest.rows[0]),history:history.rows.map(r=>({time:Number(r.time),moisture:Number(r.moisture),pump:Number(r.pump)})),stats:{min:s.min===null?null:Number(s.min),max:s.max===null?null:Number(s.max),avg:s.avg===null?null:Number(s.avg),count:Number(s.count)},recent:recent.rows.map(reading),server_time:now});
 });
 app.get('/api/device-config',requireOwner,(_req,res)=>{const text=`#pragma once\n// Keep this file private.\nconst char WIFI_SSID[] = "YOUR_WIFI_NAME";\nconst char WIFI_PASSWORD[] = "YOUR_WIFI_PASSWORD";\nconst char UPLOAD_URL[] = ${JSON.stringify(config.backendUrl+'/api/ingest')};\nconst char DEVICE_TOKEN[] = ${JSON.stringify(config.deviceToken)};\n`;res.set({'Content-Type':'text/plain; charset=utf-8','Content-Disposition':'attachment; filename="config.h"'}).send(text)});
 app.use('/api',(_req,res)=>res.status(404).json({error:'API endpoint not found'}));
 app.get('/',(_req,res)=>res.json({service:'SoilSense API',health:'/api/health'}));
 app.use((_req,res)=>res.status(404).json({error:'Endpoint not found'}));
 app.use((err,_req,res,_next)=>{const status=err.status===413?413:err.type==='entity.parse.failed'?400:500;if(status===500)console.error('Request failed:',err.code||err.name);res.status(status).json({error:status===413?'Payload too large':status===400?'Invalid JSON':'Server error. Please try again.'})});
 return app;
}

