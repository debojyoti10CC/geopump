import { Connection, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha256";
import { Buffer } from "buffer";

export const DEVNET_RPC = "https://api.devnet.solana.com";
export const PROGRAM_ID = new PublicKey("9knNnYeDQh1suoAx6tmhAgtmsYQvcoguTn6CkssZArsU");
export const REFEREE_PUBLIC_KEY = new PublicKey("6HzMz4vsXsSko7e2y3PkL2fuEdRGkpPjSyJDyp6XcT4P");
export const ROOM_ACCOUNT_SIZE = 372;
export const ROUND_SECONDS = 30;
export const JOIN_SECONDS = 900;
export const START_SECONDS = 60;
export const SETTLE_SECONDS = 300;
export const MAX_STAKE_LAMPORTS = 10_000_000_000n;
export type RoomStatus = 0 | 1 | 2 | 3 | 4;
export type Outcome = 0 | 1 | 2 | 3;
export type SettlementOutcome = 1 | 2 | 3;
export interface ChainRoom {
  version: 1; state: RoomStatus; bump: number; outcome: Outcome; roomId: Uint8Array;
  creator: PublicKey; joiner: PublicKey; referee: PublicKey; rentPayer: PublicKey;
  stakeLamports: bigint; createdAt: number; joinDeadline: number; startDeadline: number;
  roundStart: number; guessDeadline: number; settleDeadline: number; terminalAt: number;
  targetCommitment: Uint8Array; transcriptDigest32: Uint8Array; targetLatE6: number;
  targetLngE6: number; assetDigest32: Uint8Array; salt32: Uint8Array;
}
type Base = { roomId: Uint8Array; programId?: PublicKey };
function bytes32(value: Uint8Array, label: string) { if (value.length !== 32) throw new Error(`${label} must contain 32 bytes`); return value; }
function concat(...parts: Uint8Array[]) { const data = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let offset = 0; for (const part of parts) { data.set(part, offset); offset += part.length; } return data; }
function u64(value: bigint) { if (value < 0n || value > 0xffffffffffffffffn) throw new Error("Lamports out of range"); const data = new Uint8Array(8); new DataView(data.buffer).setBigUint64(0, value, true); return data; }
function i32(value: number) { if (!Number.isSafeInteger(value) || value < -2147483648 || value > 2147483647) throw new Error("Coordinate must be an i32"); const data = new Uint8Array(4); new DataView(data.buffer).setInt32(0, value, true); return data; }
function instruction(programId: PublicKey, keys: TransactionInstruction["keys"], data: Uint8Array) { return new TransactionInstruction({ programId, keys, data: Buffer.from(data) }); }
function readonly(pubkey: PublicKey, isSigner = false) { return { pubkey, isSigner, isWritable: false }; }
function writable(pubkey: PublicKey, isSigner = false) { return { pubkey, isSigner, isWritable: true }; }
export function roomIdFromCode(code: string): Uint8Array { return sha256(new TextEncoder().encode(code)); }
export function deriveRoomPda(roomId: Uint8Array, programId = PROGRAM_ID): PublicKey { return PublicKey.findProgramAddressSync([Buffer.from("room"), bytes32(roomId, "roomId")], programId)[0]; }
export function buildTargetCommitment(args: Base & { targetLatE6: number; targetLngE6: number; assetDigest32: Uint8Array; salt32: Uint8Array }): Uint8Array {
  return sha256(concat(new TextEncoder().encode("geo-duels-target-v1"), (args.programId ?? PROGRAM_ID).toBytes(), bytes32(args.roomId, "roomId"), bytes32(args.assetDigest32, "assetDigest32"), i32(args.targetLatE6), i32(args.targetLngE6), bytes32(args.salt32, "salt32")));
}
export function createRoomInstruction(args: Base & { creator: PublicKey; referee: PublicKey; stakeLamports: bigint }): TransactionInstruction {
  const programId = args.programId ?? PROGRAM_ID;
  if (args.stakeLamports <= 0n || args.stakeLamports > MAX_STAKE_LAMPORTS) throw new Error("Stake must be greater than zero and at most 10 SOL");
  return instruction(programId, [writable(args.creator, true), writable(deriveRoomPda(args.roomId, programId)), readonly(SystemProgram.programId)], concat(Uint8Array.of(0), bytes32(args.roomId, "roomId"), u64(args.stakeLamports), args.referee.toBytes()));
}
export function joinRoomInstruction(args: Base & { joiner: PublicKey; referee: PublicKey }): TransactionInstruction {
  const programId = args.programId ?? PROGRAM_ID;
  return instruction(programId, [writable(deriveRoomPda(args.roomId, programId)), writable(args.joiner, true), readonly(args.referee, true), readonly(SystemProgram.programId)], Uint8Array.of(1));
}
export function startRoundInstruction(args: Base & { referee: PublicKey; targetCommitment: Uint8Array }): TransactionInstruction {
  const programId = args.programId ?? PROGRAM_ID;
  return instruction(programId, [writable(deriveRoomPda(args.roomId, programId)), readonly(args.referee, true)], concat(Uint8Array.of(2), bytes32(args.targetCommitment, "targetCommitment")));
}
export function settleRoomInstruction(args: Base & { referee: PublicKey; creator: PublicKey; joiner: PublicKey; outcome: SettlementOutcome; targetLatE6: number; targetLngE6: number; assetDigest32: Uint8Array; salt32: Uint8Array; transcriptDigest32: Uint8Array }): TransactionInstruction {
  const programId = args.programId ?? PROGRAM_ID;
  if (![1, 2, 3].includes(args.outcome)) throw new Error("Invalid settlement outcome");
  if (args.targetLatE6 < -90_000_000 || args.targetLatE6 > 90_000_000 || args.targetLngE6 < -180_000_000 || args.targetLngE6 >= 180_000_000) throw new Error("Invalid target coordinates");
  return instruction(programId, [writable(deriveRoomPda(args.roomId, programId)), readonly(args.referee, true), writable(args.creator), writable(args.joiner)], concat(Uint8Array.of(3, args.outcome), i32(args.targetLatE6), i32(args.targetLngE6), bytes32(args.assetDigest32, "assetDigest32"), bytes32(args.salt32, "salt32"), bytes32(args.transcriptDigest32, "transcriptDigest32")));
}
export function cancelWaitingInstruction(args: Base & { creator: PublicKey }): TransactionInstruction {
  const programId = args.programId ?? PROGRAM_ID;
  return instruction(programId, [writable(deriveRoomPda(args.roomId, programId)), writable(args.creator, true)], Uint8Array.of(4));
}
export function refundExpiredInstruction(args: Base & { creator: PublicKey; joiner?: PublicKey }): TransactionInstruction {
  const programId = args.programId ?? PROGRAM_ID;
  return instruction(programId, [writable(deriveRoomPda(args.roomId, programId)), writable(args.creator), writable(args.joiner ?? args.creator)], Uint8Array.of(5));
}
export function closeRoomInstruction(args: Base & { rentPayer: PublicKey }): TransactionInstruction {
  const programId = args.programId ?? PROGRAM_ID;
  return instruction(programId, [writable(deriveRoomPda(args.roomId, programId)), writable(args.rentPayer)], Uint8Array.of(6));
}
export function parseRoomAccount(input: Uint8Array): ChainRoom {
  const data = Uint8Array.from(input);
  if (data.length !== ROOM_ACCOUNT_SIZE || new TextDecoder().decode(data.subarray(0, 8)) !== "GEODUEL1" || data[8] !== 1 || data[9] > 4 || data[11] > 3) throw new Error("Invalid Geo Duels account");
  const view = new DataView(data.buffer);
  const key = (offset: number) => new PublicKey(data.subarray(offset, offset + 32));
  const time = (offset: number) => { const value = view.getBigInt64(offset, true); if (value < BigInt(Number.MIN_SAFE_INTEGER) || value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Invalid chain timestamp"); return Number(value); };
  return { version: 1, state: data[9] as RoomStatus, bump: data[10], outcome: data[11] as Outcome,
    roomId: data.slice(12, 44), creator: key(44), joiner: key(76), referee: key(108), rentPayer: key(140),
    stakeLamports: view.getBigUint64(172, true), createdAt: time(180), joinDeadline: time(188), startDeadline: time(196), roundStart: time(204), guessDeadline: time(212), settleDeadline: time(220), terminalAt: time(228),
    targetCommitment: data.slice(236, 268), transcriptDigest32: data.slice(268, 300), targetLatE6: view.getInt32(300, true), targetLngE6: view.getInt32(304, true), assetDigest32: data.slice(308, 340), salt32: data.slice(340, 372) };
}
export async function fetchChainRoom(connection: Connection, roomId: Uint8Array, programId = PROGRAM_ID): Promise<ChainRoom | null> {
  const account = await connection.getAccountInfo(deriveRoomPda(roomId, programId), "confirmed");
  if (!account) return null;
  if (!account.owner.equals(programId)) throw new Error("Room owner mismatch");
  const room = parseRoomAccount(account.data);
  if (!Buffer.from(room.roomId).equals(Buffer.from(roomId))) throw new Error("Room ID mismatch");
  return room;
}
/** Parse SOL using decimals only; money never passes through floating point. */
export function solToLamports(input: string): bigint {
  const value = input.trim();
  if (!/^\d+(?:\.\d{0,9})?$/.test(value)) throw new Error("Enter SOL with at most 9 decimal places");
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 1_000_000_000n + BigInt(fraction.padEnd(9, "0"));
}
export function lamportsToSol(value: bigint): string {
  if (value < 0n) throw new Error("Negative lamports");
  const whole = value / 1_000_000_000n; const remainder = (value % 1_000_000_000n).toString().padStart(9, "0").replace(/0+$/, "");
  return remainder ? `${whole}.${remainder}` : whole.toString();
}
export function explorerTransaction(signature: string): string { return `https://explorer.solana.com/tx/${encodeURIComponent(signature)}?cluster=devnet`; }
export function explorerAddress(address: PublicKey | string): string { return `https://explorer.solana.com/address/${encodeURIComponent(address.toString())}?cluster=devnet`; }
