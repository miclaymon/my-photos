-- Migration 0010: Add reverse-geocoded location label to media
ALTER TABLE media ADD COLUMN location_label TEXT;
ALTER TABLE media ADD COLUMN location_processed_at INTEGER;
