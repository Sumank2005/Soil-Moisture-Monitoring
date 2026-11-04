import pg from 'pg';
import {isMainThread} from 'node:worker_threads';
import {config} from './config.js';
// Require CA and hostname verification, including with future pg versions.
const connection=new URL(config.databaseUrl);connection.searchParams.set('sslmode','verify-full');
// API and worker together use at most five database connections per instance.
export const pool=new pg.Pool({connectionString:connection.toString(),max:isMainThread?3:2,connectionTimeoutMillis:10000,idleTimeoutMillis:30000,query_timeout:15000,statement_timeout:15000});
pool.on('error',()=>console.error('Postgres connection interrupted.'));
