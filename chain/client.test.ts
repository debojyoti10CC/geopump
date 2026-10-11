import { test } from "node:test";
import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import { createHash } from "node:crypto";
import { buildTargetCommitment, createRoomInstruction, deriveRoomPda, lamportsToSol, roomIdFromCode, solToLamports, parseRoomAccount, PROGRAM_ID } from "../lib/chain";

test("SOL decimal arithmetic is exact to one lamport", () => {
  for (const value of ["0", "0.000000001", "0.001000001", "0.01", "1.234567891", "10"]) assert.equal(lamportsToSol(solToLamports(value)), value);
  assert.equal(solToLamports("0.01") * BigInt(2), BigInt(20_000_000));
  for (const value of ["-1", "1e-3", "0.0000000001", "NaN", "1,2"]) assert.throws(() => solToLamports(value));
});
test("target commitment matches the independent canonical SHA-256 encoding", () => {
  const roomId = Uint8Array.from({ length: 32 }, (_, i) => i); const asset = new Uint8Array(32).fill(5); const salt = new Uint8Array(32).fill(6);
  const latitude = Buffer.alloc(4); const longitude = Buffer.alloc(4); latitude.writeInt32LE(48_858_400); longitude.writeInt32LE(2_294_500);
  const expected = createHash("sha256").update(Buffer.concat([Buffer.from("geo-duels-target-v1"), PROGRAM_ID.toBuffer(), Buffer.from(roomId), Buffer.from(asset), latitude, longitude, Buffer.from(salt)])).digest();
  const actual = buildTargetCommitment({ roomId, targetLatE6: 48_858_400, targetLngE6: 2_294_500, assetDigest32: asset, salt32: salt });
  assert.deepEqual(Buffer.from(actual), expected);
});
test("room address is deterministic and create amount is integer little endian", () => {
  const roomId = roomIdFromCode("GEO-TEST"); const creator = new PublicKey(new Uint8Array(32).fill(1)); const referee = new PublicKey(new Uint8Array(32).fill(2));
  assert.equal(deriveRoomPda(roomId).toBase58(), deriveRoomPda(roomIdFromCode("GEO-TEST")).toBase58());
  const instruction = createRoomInstruction({ roomId, creator, referee, stakeLamports: BigInt(1_000_001) });
  assert.equal(instruction.data.length, 73); assert.equal(instruction.data.readBigUInt64LE(33), BigInt(1_000_001));
  assert.equal(instruction.keys[0].isSigner, true); assert.equal(instruction.keys[1].pubkey.toBase58(), deriveRoomPda(roomId).toBase58());
  assert.throws(() => createRoomInstruction({ roomId, creator, referee, stakeLamports: BigInt(0) }));
});
test("account parser rejects invalid format and validates offsets", () => {
  assert.throws(() => parseRoomAccount(new Uint8Array(10)));
  const data = Buffer.alloc(372); data.write("GEODUEL1"); data[8] = 1; data[9] = 2; data[10] = 255;
  data.fill(7, 12, 44); data.fill(1, 44, 76); data.fill(2, 76, 108); data.fill(3, 108, 140);
  data.writeBigUInt64LE(BigInt(1_000_001), 172); data.writeBigInt64LE(BigInt(123), 204); data.writeBigInt64LE(BigInt(153), 212); data.writeBigInt64LE(BigInt(453), 220);
  const room = parseRoomAccount(data); assert.equal(room.state, 2); assert.equal(room.stakeLamports, BigInt(1_000_001)); assert.equal(room.roundStart, 123); assert.equal(room.guessDeadline, 153); assert.equal(room.settleDeadline, 453);
  data[8] = 0; assert.throws(() => parseRoomAccount(data));
});
