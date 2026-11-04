import {readFile} from 'node:fs/promises';

export async function ensureQueue(pool) {
 await pool.query(await readFile(new URL('../migrations/002_ingest_queue.sql',import.meta.url),'utf8'));
}

export async function enqueueReading(pool,payload,receivedAt) {
 const result=await pool.query(`INSERT INTO public.soilsense_ingest_queue(boot_id,seq,received_at,payload)
  SELECT $1,$2,$3,$4::jsonb WHERE NOT EXISTS
  (SELECT 1 FROM public.soilsense_readings WHERE boot_id=$1 AND seq=$2)
  ON CONFLICT (boot_id,seq) DO NOTHING`,[payload.boot_id,payload.seq,receivedAt,JSON.stringify(payload)]);
 return result.rowCount===1;
}

// Claim and complete one bounded batch in the same transaction. A crash or DB
// failure rolls it back, leaving the inbox entries available for the next worker.
export async function processBatch(pool,batchSize=100) {
 // One SQL statement is one atomic PostgreSQL transaction, including when the
 // inbox is empty. This avoids BEGIN/SELECT/COMMIT polling round trips.
 const result=await pool.query(`WITH pending AS MATERIALIZED (
   SELECT id,received_at,payload FROM public.soilsense_ingest_queue
   ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED
  ), saved AS (
   INSERT INTO public.soilsense_readings
   (received_at,boot_id,seq,raw,moisture,pump,sensor_fault,timeout_fault,rssi,uptime,dry_raw,wet_raw,on_percent,off_percent)
   SELECT p.received_at,r.boot_id,r.seq,r.raw,r.moisture,r.pump::int,r.sensor_fault::int,r.timeout_fault::int,
    r.rssi,r.uptime_s,r.dry_raw,r.wet_raw,r.threshold_on,r.threshold_off
   FROM pending p CROSS JOIN LATERAL jsonb_to_record(p.payload) AS r(boot_id text,seq bigint,
    raw int,moisture float8,pump boolean,sensor_fault boolean,timeout_fault boolean,
    rssi int,uptime_s bigint,dry_raw int,wet_raw int,threshold_on int,threshold_off int)
   ON CONFLICT(boot_id,seq) DO NOTHING RETURNING 1
  ), completed AS (
   DELETE FROM public.soilsense_ingest_queue q USING pending p
   WHERE q.id=p.id AND (SELECT COUNT(*) FROM saved)>=0 RETURNING 1
  ) SELECT (SELECT COUNT(*) FROM completed) AS processed,(SELECT COUNT(*) FROM saved) AS inserted`,[batchSize]);
 return {processed:Number(result.rows[0].processed),inserted:Number(result.rows[0].inserted)};
}

// Only three supported history windows, with one in-flight query per window.
export function createReadCache(ttlMs=15000,clock=Date.now) {
 const entries=new Map();
 return (key,load)=>{
  const existing=entries.get(key);
  if(existing&&existing.expires>clock())return existing.promise;
  const entry={expires:Infinity,promise:null};
  entry.promise=Promise.resolve().then(load).then(value=>{entry.expires=clock()+ttlMs;return value},error=>{if(entries.get(key)===entry)entries.delete(key);throw error});
  entries.set(key,entry);
  return entry.promise;
 };
}
