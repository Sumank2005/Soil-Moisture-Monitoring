import {env} from 'cloudflare:workers';
import {telemetrySchema} from '@/lib/telemetry';
export async function POST(request:Request){
 // The owner-private Sites gate authenticates ESP32 with OAI-Sites-Authorization.
 if(!env.DB) return Response.json({error:'Storage unavailable'},{status:503});
 if(Number(request.headers.get('content-length')||0)>2048)return Response.json({error:'Payload too large'},{status:413});
 let parsed;try{const body=await request.text();if(body.length>2048) return Response.json({error:'Payload too large'},{status:413});parsed=telemetrySchema.safeParse(JSON.parse(body));}catch{return Response.json({error:'Invalid JSON'},{status:400});}
 if(!parsed.success)return Response.json({error:'Invalid telemetry'},{status:400});
 const p=parsed.data,now=Date.now();
 // Samples older than seven days are removed on every upload.
 await env.DB.batch([
 env.DB.prepare('INSERT INTO readings (received_at,boot_id,seq,raw,moisture,pump,sensor_fault,timeout_fault,rssi,uptime,dry_raw,wet_raw,on_percent,off_percent) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(boot_id,seq) DO NOTHING').bind(now,p.boot_id,p.seq,p.raw,p.moisture,+p.pump,+p.sensor_fault,+p.timeout_fault,p.rssi,p.uptime_s,p.dry_raw,p.wet_raw,p.threshold_on,p.threshold_off),
 env.DB.prepare('DELETE FROM readings WHERE received_at < ?').bind(now-7*86400000)
 ]);
 return Response.json({ok:true,received_at:now},{headers:{'Cache-Control':'no-store'}});
}
