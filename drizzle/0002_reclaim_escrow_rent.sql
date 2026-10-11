ALTER TABLE rooms ADD COLUMN terminal_at INTEGER;
ALTER TABLE rooms ADD COLUMN rent_reclaimed_at INTEGER;
ALTER TABLE rooms ADD COLUMN rent_signature TEXT;
CREATE INDEX rooms_rent_idx ON rooms(status,rent_reclaimed_at,terminal_at);
