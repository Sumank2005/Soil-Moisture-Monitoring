CREATE TABLE `readings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`received_at` integer NOT NULL,
	`boot_id` text NOT NULL,
	`seq` integer NOT NULL,
	`raw` integer NOT NULL,
	`moisture` real NOT NULL,
	`pump` integer NOT NULL,
	`sensor_fault` integer NOT NULL,
	`timeout_fault` integer NOT NULL,
	`rssi` integer NOT NULL,
	`uptime` integer NOT NULL,
	`dry_raw` integer NOT NULL,
	`wet_raw` integer NOT NULL,
	`on_percent` integer NOT NULL,
	`off_percent` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `readings_time` ON `readings` (`received_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `reading_sequence` ON `readings` (`boot_id`,`seq`);