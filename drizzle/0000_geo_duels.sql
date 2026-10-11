CREATE TABLE rooms (
  code TEXT PRIMARY KEY NOT NULL,
  room_id TEXT NOT NULL,
  creator_wallet TEXT NOT NULL,
  opponent_wallet TEXT,
  stake_lamports INTEGER NOT NULL CHECK(stake_lamports BETWEEN 1000000 AND 1000000000),
  status TEXT NOT NULL DEFAULT 'funding',
  created_at INTEGER NOT NULL,
  creator_confirmed INTEGER NOT NULL DEFAULT 0,
  opponent_confirmed INTEGER NOT NULL DEFAULT 0,
  deadline INTEGER,
  refund_at INTEGER,
  location_id TEXT NOT NULL,
  target_lat_e6 INTEGER NOT NULL,
  target_lng_e6 INTEGER NOT NULL,
  asset_digest TEXT NOT NULL,
  salt TEXT NOT NULL,
  scene_token TEXT NOT NULL UNIQUE,
  result_json TEXT,
  settlement_signature TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
CREATE INDEX rooms_pending_idx ON rooms(status, deadline);
CREATE INDEX rooms_scene_idx ON rooms(scene_token);
CREATE TABLE guesses (
  room_code TEXT NOT NULL REFERENCES rooms(code),
  wallet TEXT NOT NULL,
  lat_e6 INTEGER NOT NULL CHECK(lat_e6 BETWEEN -90000000 AND 90000000),
  lng_e6 INTEGER NOT NULL CHECK(lng_e6 BETWEEN -180000000 AND 179999999),
  message TEXT NOT NULL,
  signature TEXT NOT NULL,
  accepted_at INTEGER NOT NULL,
  PRIMARY KEY(room_code,wallet)
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  room_code TEXT NOT NULL REFERENCES rooms(code),
  wallet TEXT NOT NULL,
  nonce TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  authenticated INTEGER NOT NULL DEFAULT 0,
  challenge_expires_at INTEGER NOT NULL
);
CREATE TABLE practices (
  id TEXT PRIMARY KEY NOT NULL,
  token_hash TEXT NOT NULL,
  location_id TEXT NOT NULL,
  target_lat_e6 INTEGER NOT NULL,
  target_lng_e6 INTEGER NOT NULL,
  scene_token TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  deadline INTEGER NOT NULL,
  result_json TEXT
);
CREATE INDEX practices_scene_idx ON practices(scene_token);
