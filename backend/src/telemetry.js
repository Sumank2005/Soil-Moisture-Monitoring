import { z } from 'zod';
export const telemetrySchema = z.object({
 boot_id:z.string().regex(/^[a-fA-F0-9-]{8,40}$/),seq:z.number().int().min(0).max(4294967295),
 raw:z.number().int().min(0).max(4095),moisture:z.number().min(0).max(100),
 pump:z.boolean(),sensor_fault:z.boolean(),timeout_fault:z.boolean(),
 rssi:z.number().int().min(-127).max(0),uptime_s:z.number().int().min(0).max(4294967295),
 dry_raw:z.number().int().min(0).max(4095),wet_raw:z.number().int().min(0).max(4095),
 threshold_on:z.number().int().min(0).max(99),threshold_off:z.number().int().min(1).max(100),
 control_version:z.literal(1).optional(),control_mode:z.enum(['auto','manual_on','manual_off']).optional(),
 command_ack:z.object({id:z.string().uuid(),result:z.enum(['applied','sensor_fault','timeout_locked','expired','disabled'])}).strict().optional(),
}).strict().refine(x=>x.dry_raw>x.wet_raw+200 && x.threshold_off>x.threshold_on);
