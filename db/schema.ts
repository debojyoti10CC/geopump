import { integer, primaryKey, sqliteTable, text, index } from "drizzle-orm/sqlite-core";

export const rooms = sqliteTable("rooms", {
  code: text("code").primaryKey(),
  roomId: text("room_id").notNull(),
  programId: text("program_id").notNull(),
  refereeWallet: text("referee_wallet").notNull(),
  creatorWallet: text("creator_wallet").notNull(),
  opponentWallet: text("opponent_wallet"),
  stakeLamports: integer("stake_lamports").notNull(),
  status: text("status").notNull().default("funding"),
  createdAt: integer("created_at").notNull(),
  creatorConfirmed: integer("creator_confirmed").notNull().default(0),
  opponentConfirmed: integer("opponent_confirmed").notNull().default(0),
  deadline: integer("deadline"),
  refundAt: integer("refund_at"),
  locationId: text("location_id").notNull(),
  targetLatE6: integer("target_lat_e6").notNull(),
  targetLngE6: integer("target_lng_e6").notNull(),
  assetDigest: text("asset_digest").notNull(),
  salt: text("salt").notNull(),
  sceneToken: text("scene_token").notNull(),
  resultJson: text("result_json"),
  settlementSignature: text("settlement_signature"),
  terminalAt: integer("terminal_at"),
  rentReclaimedAt: integer("rent_reclaimed_at"),
  rentSignature: text("rent_signature"),
  leaseUntil: integer("lease_until").notNull().default(0),
  lastError: text("last_error"),
}, (table) => [index("rooms_pending_idx").on(table.status, table.deadline), index("rooms_scene_idx").on(table.sceneToken),index("rooms_rent_idx").on(table.status,table.rentReclaimedAt,table.terminalAt)]);

export const guesses = sqliteTable("guesses", {
  roomCode: text("room_code").notNull().references(() => rooms.code),
  wallet: text("wallet").notNull(),
  latE6: integer("lat_e6").notNull(),
  lngE6: integer("lng_e6").notNull(),
  message: text("message").notNull(),
  signature: text("signature").notNull(),
  acceptedAt: integer("accepted_at").notNull(),
}, (table) => [primaryKey({ columns: [table.roomCode, table.wallet] })]);

export const sessions = sqliteTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  roomCode: text("room_code").notNull().references(() => rooms.code),
  wallet: text("wallet").notNull(),
  nonce: text("nonce").notNull(),
  expiresAt: integer("expires_at").notNull(),
  authenticated: integer("authenticated").notNull().default(0),
  challengeExpiresAt: integer("challenge_expires_at").notNull(),
});

export const practices = sqliteTable("practices", {
  id: text("id").primaryKey(),
  tokenHash: text("token_hash").notNull(),
  locationId: text("location_id").notNull(),
  targetLatE6: integer("target_lat_e6").notNull(),
  targetLngE6: integer("target_lng_e6").notNull(),
  sceneToken: text("scene_token").notNull(),
  createdAt: integer("created_at").notNull(),
  deadline: integer("deadline").notNull(),
  resultJson: text("result_json"),
}, (table) => [index("practices_scene_idx").on(table.sceneToken)]);
