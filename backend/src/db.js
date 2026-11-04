import pg from 'pg';
import {config} from './config.js';
// Require CA and hostname verification, including with future pg versions.
const connection=new URL(config.databaseUrl);connection.searchParams.set('sslmode','verify-full');
export const pool=new pg.Pool({connectionString:connection.toString(),max:5,connectionTimeoutMillis:10000,idleTimeoutMillis:30000});
pool.on('error',()=>console.error('Postgres connection interrupted.'));
