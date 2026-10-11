import type { AcceptedGuess } from "./game-math";

export interface RoomRecord {
  code: string; room_id: string; program_id: string; referee_wallet: string; creator_wallet: string; opponent_wallet: string | null;
  stake_lamports: number; status: string; created_at: number; creator_confirmed: number; opponent_confirmed: number;
  deadline: number | null; refund_at: number | null; location_id: string; target_lat_e6: number; target_lng_e6: number;
  asset_digest: string; salt: string; scene_token: string; result_json: string | null;
  settlement_signature: string | null; lease_until: number; last_error: string | null;
  terminal_at: number | null; rent_reclaimed_at: number | null; rent_signature: string | null;
}
export interface PracticeRecord {
  id: string; token_hash: string; location_id: string; target_lat_e6: number; target_lng_e6: number;
  scene_token: string; created_at: number; deadline: number; result_json: string | null;
}
export interface SessionRecord {
  token_hash: string; room_code: string; wallet: string; nonce: string; expires_at: number;
  authenticated: number; challenge_expires_at: number;
}

/** Every acknowledged guess is a committed D1 insert with a unique room/wallet key. */
export class GameStore {
  readonly db: D1Database;
  constructor(db: D1Database) { this.db=db; }
  room(code: string) { return this.db.prepare("SELECT * FROM rooms WHERE code = ?").bind(code).first<RoomRecord>(); }
  roomForScene(token: string) { return this.db.prepare("SELECT * FROM rooms WHERE scene_token = ?").bind(token).first<RoomRecord>(); }
  async createRoom(room: Omit<RoomRecord, "opponent_wallet" | "creator_confirmed" | "opponent_confirmed" | "deadline" | "refund_at" | "result_json" | "settlement_signature" | "lease_until" | "last_error" | "terminal_at" | "rent_reclaimed_at" | "rent_signature">) {
    await this.db.prepare("INSERT INTO rooms(code,room_id,program_id,referee_wallet,creator_wallet,stake_lamports,status,created_at,location_id,target_lat_e6,target_lng_e6,asset_digest,salt,scene_token) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(room.code,room.room_id,room.program_id,room.referee_wallet,room.creator_wallet,room.stake_lamports,room.status,room.created_at,room.location_id,room.target_lat_e6,room.target_lng_e6,room.asset_digest,room.salt,room.scene_token).run();
  }
  async reserveOpponent(code: string, wallet: string) {
    await this.db.prepare("UPDATE rooms SET opponent_wallet=? WHERE code=? AND creator_confirmed=1 AND opponent_wallet IS NULL AND status='waiting'").bind(wallet,code).run();
    return this.room(code);
  }
  async patchRoom(code: string, values: Partial<RoomRecord>) {
    const allowed = new Set(["opponent_wallet","creator_confirmed","opponent_confirmed","deadline","refund_at","status","result_json","settlement_signature","lease_until","last_error","terminal_at","rent_reclaimed_at","rent_signature"]);
    const entries = Object.entries(values);
    if (!entries.length || entries.some(([key]) => !allowed.has(key))) throw new Error("Invalid room update.");
    await this.db.prepare(`UPDATE rooms SET ${entries.map(([key]) => `${key}=?`).join(",")} WHERE code=?`).bind(...entries.map(([,value]) => value), code).run();
  }
  async takeLease(code: string, now: number) {
    const result = await this.db.prepare("UPDATE rooms SET lease_until=? WHERE code=? AND lease_until<?").bind(now+60_000,code,now).run();
    return result.meta.changes === 1;
  }
  async pendingRooms(now: number) {
    const result = await this.db.prepare("SELECT * FROM rooms WHERE status IN ('funding','waiting','starting','active','settling','refundable') AND lease_until<? ORDER BY CASE WHEN status IN ('starting','settling') THEN 0 WHEN status='active' AND deadline<? THEN 1 ELSE 2 END,COALESCE(deadline,created_at) LIMIT 20").bind(now,now).all<RoomRecord>();
    return result.results;
  }
  async rentCandidates(now: number) {
    const result=await this.db.prepare("SELECT * FROM rooms WHERE status IN ('finished','cancelled') AND rent_reclaimed_at IS NULL AND lease_until<? AND (terminal_at IS NULL OR terminal_at<=?) ORDER BY COALESCE(terminal_at,created_at) LIMIT 20").bind(now,now-86_400_000).all<RoomRecord>();
    return result.results;
  }
  async guesses(code: string): Promise<AcceptedGuess[]> {
    const result = await this.db.prepare("SELECT wallet,lat_e6 AS latE6,lng_e6 AS lngE6,message,signature,accepted_at AS acceptedAt FROM guesses WHERE room_code=? ORDER BY wallet").bind(code).all<AcceptedGuess>();
    return result.results;
  }
  async acceptGuess(code: string, guess: AcceptedGuess, now: number) {
    // Check deadline and player admission in the same SQL statement as the insert.
    const result = await this.db.prepare("INSERT INTO guesses(room_code,wallet,lat_e6,lng_e6,message,signature,accepted_at) SELECT ?,?,?,?,?,?,? FROM rooms WHERE code=? AND status='active' AND deadline>? AND ((creator_wallet=? AND creator_confirmed=1) OR (opponent_wallet=? AND opponent_confirmed=1)) ON CONFLICT(room_code,wallet) DO NOTHING")
      .bind(code,guess.wallet,guess.latE6,guess.lngE6,guess.message,guess.signature,now,code,now,guess.wallet,guess.wallet).run();
    const stored = (await this.guesses(code)).find(value => value.wallet === guess.wallet);
    return { inserted: result.meta.changes === 1, stored };
  }
  session(hash: string) { return this.db.prepare("SELECT * FROM sessions WHERE token_hash=?").bind(hash).first<SessionRecord>(); }
  async createSession(session: SessionRecord) {
    await this.db.prepare("INSERT INTO sessions(token_hash,room_code,wallet,nonce,expires_at,authenticated,challenge_expires_at) VALUES(?,?,?,?,?,?,?)")
      .bind(session.token_hash,session.room_code,session.wallet,session.nonce,session.expires_at,session.authenticated,session.challenge_expires_at).run();
  }
  async authorizeSession(hash: string) { await this.db.prepare("UPDATE sessions SET authenticated=1 WHERE token_hash=?").bind(hash).run(); }
  practice(id: string) { return this.db.prepare("SELECT * FROM practices WHERE id=?").bind(id).first<PracticeRecord>(); }
  practiceForScene(token: string) { return this.db.prepare("SELECT * FROM practices WHERE scene_token=?").bind(token).first<PracticeRecord>(); }
  async createPractice(practice: PracticeRecord) {
    await this.db.prepare("INSERT INTO practices(id,token_hash,location_id,target_lat_e6,target_lng_e6,scene_token,created_at,deadline,result_json) VALUES(?,?,?,?,?,?,?,?,?)")
      .bind(practice.id,practice.token_hash,practice.location_id,practice.target_lat_e6,practice.target_lng_e6,practice.scene_token,practice.created_at,practice.deadline,practice.result_json).run();
  }
  async finishPractice(id: string, result: string) {
    await this.db.prepare("UPDATE practices SET result_json=? WHERE id=? AND result_json IS NULL").bind(result,id).run();
    return this.practice(id);
  }
  async cleanup(now: number) {
    await this.db.batch([
      this.db.prepare("DELETE FROM sessions WHERE expires_at<?").bind(now),
      this.db.prepare("DELETE FROM practices WHERE deadline<?").bind(now-86_400_000),
      this.db.prepare("DELETE FROM rooms WHERE status='funding' AND created_at<? AND creator_confirmed=0").bind(now-86_400_000),
    ]);
  }
}
