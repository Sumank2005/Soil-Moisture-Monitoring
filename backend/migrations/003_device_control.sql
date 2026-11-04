CREATE TABLE IF NOT EXISTS soilsense_device_control (
 id SMALLINT PRIMARY KEY CHECK(id=1), boot_id TEXT NOT NULL,
 seq BIGINT NOT NULL, last_seen BIGINT NOT NULL, control_version INTEGER NOT NULL DEFAULT 0,
 mode TEXT NOT NULL DEFAULT 'auto', pump BOOLEAN NOT NULL,
 sensor_fault BOOLEAN NOT NULL, timeout_fault BOOLEAN NOT NULL,
 command_id UUID, command_action TEXT, command_boot_id TEXT,
 command_created_at BIGINT, command_expires_at BIGINT,
 command_status TEXT NOT NULL DEFAULT 'none', command_result TEXT
);
