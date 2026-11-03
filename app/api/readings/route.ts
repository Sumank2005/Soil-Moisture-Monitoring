import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '@/app/chatgpt-auth';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 if(!await getChatGPTUser())return Response.json({error:'Please sign in'},{status:401});
 if(!env.DB)return Response.json({error:'Storage unavailable'},{status:503});
 const hours=Math.min(24,Math.max(1,Number(new URL(request.url).searchParams.get('hours'))||6));
 const since=Date.now()-hours*3600000,bucket=hours<=1?10000:hours<=6?60000:300000;
 const result=await env.DB.batch([
 env.DB.prepare('SELECT * FROM readings ORDER BY received_at DESC,id DESC LIMIT 1'),
 env.DB.prepare('SELECT CAST(received_at / ? AS INTEGER) * ? AS time, AVG(moisture) AS moisture, MAX(pump) AS pump FROM readings WHERE received_at >= ? GROUP BY CAST(received_at / ? AS INTEGER) ORDER BY time ASC LIMIT 500').bind(bucket,bucket,since,bucket),
 env.DB.prepare('SELECT MIN(moisture) AS min, MAX(moisture) AS max, AVG(moisture) AS avg, COUNT(*) AS count FROM readings WHERE received_at >= ?').bind(since),
 env.DB.prepare('SELECT * FROM readings WHERE received_at>=? ORDER BY received_at DESC,id DESC LIMIT 20').bind(since)
 ]);
 return Response.json({latest:result[0].results[0]||null,history:result[1].results,stats:result[2].results[0],recent:result[3].results,server_time:Date.now()},{headers:{'Cache-Control':'no-store'}});
}
