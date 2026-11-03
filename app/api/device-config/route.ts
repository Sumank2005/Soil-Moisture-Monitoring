import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '@/app/chatgpt-auth';
export const dynamic='force-dynamic';
export async function GET(){
 if(!await getChatGPTUser())return new Response('Please sign in',{status:401});
 const token=(env as unknown as Record<string,string>).ESP_SERVICE_TOKEN;
 if(!token)return new Response('Device configuration not available',{status:503});
 // Provision credentials only through an owner-authenticated, non-cacheable download.
 const content=`#pragma once\n// Keep this file private. Only change Wi-Fi name and password.\nconst char WIFI_SSID[] = "YOUR_WIFI_NAME";\nconst char WIFI_PASSWORD[] = "YOUR_WIFI_PASSWORD";\nconst char UPLOAD_URL[] = "https://soil-monitor-suman.sumank2053.chatgpt.site/api/ingest";\nconst char SITE_TOKEN[] = ${JSON.stringify(token)};\n`;
 return new Response(content,{headers:{'Content-Type':'text/plain; charset=utf-8','Content-Disposition':'attachment; filename="config.h"','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
}
