-- Durable inbox: acknowledging an upload means it is committed here first.
CREATE TABLE IF NOT EXISTS soilsense_ingest_queue (
 id BIGSERIAL PRIMARY KEY,
 boot_id TEXT NOT NULL,
 seq BIGINT NOT NULL,
 received_at BIGINT NOT NULL,
 payload JSONB NOT NULL,
 CONSTRAINT soilsense_queue_sequence UNIQUE (boot_id, seq)
);
