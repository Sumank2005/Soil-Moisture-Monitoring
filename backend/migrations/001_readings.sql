CREATE TABLE IF NOT EXISTS soilsense_readings (
 id BIGSERIAL PRIMARY KEY, received_at BIGINT NOT NULL,
 boot_id TEXT NOT NULL, seq BIGINT NOT NULL CHECK(seq BETWEEN 0 AND 4294967295),
 raw INTEGER NOT NULL CHECK(raw BETWEEN 0 AND 4095),
 moisture DOUBLE PRECISION NOT NULL CHECK(moisture BETWEEN 0 AND 100),
 pump SMALLINT NOT NULL CHECK(pump IN (0,1)),
 sensor_fault SMALLINT NOT NULL CHECK(sensor_fault IN (0,1)),
 timeout_fault SMALLINT NOT NULL CHECK(timeout_fault IN (0,1)),
 rssi INTEGER NOT NULL CHECK(rssi BETWEEN -127 AND 0), uptime BIGINT NOT NULL,
 dry_raw INTEGER NOT NULL, wet_raw INTEGER NOT NULL, on_percent INTEGER NOT NULL, off_percent INTEGER NOT NULL,
 CONSTRAINT soilsense_sequence UNIQUE(boot_id,seq)
);
CREATE INDEX IF NOT EXISTS soilsense_received_at ON soilsense_readings(received_at DESC);
