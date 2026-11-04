import {readFile} from 'node:fs/promises';
import {pool} from './db.js';
try{await pool.query(await readFile(new URL('../migrations/001_readings.sql',import.meta.url),'utf8'));console.log('SoilSense Postgres schema is ready.')}catch{console.error('Migration failed. Check DATABASE_URL and database connectivity.');process.exitCode=1}finally{await pool.end()}
