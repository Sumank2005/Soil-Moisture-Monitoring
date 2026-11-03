import {integer, real, sqliteTable, text, index, uniqueIndex} from 'drizzle-orm/sqlite-core';
export const readings = sqliteTable('readings', {
 id: integer('id').primaryKey({autoIncrement:true}),
 receivedAt: integer('received_at').notNull(),
 bootId: text('boot_id').notNull(), seq: integer('seq').notNull(),
 raw: integer('raw').notNull(), moisture: real('moisture').notNull(),
 pump: integer('pump').notNull(), sensorFault: integer('sensor_fault').notNull(),
 timeoutFault: integer('timeout_fault').notNull(), rssi: integer('rssi').notNull(),
 uptime: integer('uptime').notNull(), dryRaw: integer('dry_raw').notNull(),
 wetRaw: integer('wet_raw').notNull(), onPercent: integer('on_percent').notNull(),
 offPercent: integer('off_percent').notNull(),
}, t=>[index('readings_time').on(t.receivedAt),uniqueIndex('reading_sequence').on(t.bootId,t.seq)]);
