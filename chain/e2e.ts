import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { Connection, Keypair, Transaction, TransactionInstruction, sendAndConfirmTransaction, PublicKey, SystemProgram } from "@solana/web3.js";
import { buildTargetCommitment, createRoomInstruction, joinRoomInstruction, startRoundInstruction, settleRoomInstruction, cancelWaitingInstruction, refundExpiredInstruction, fetchChainRoom, deriveRoomPda, PROGRAM_ID, ROOM_ACCOUNT_SIZE } from "../lib/chain";

const rpc = process.env.TEST_SOLANA_RPC ?? "http://127.0.0.1:18899";
if (rpc.includes("mainnet")) throw new Error("Tests must never use mainnet");
const connection = new Connection(rpc, "confirmed");
const referee = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(".secrets/referee.json", "utf8"))));
const creator = Keypair.generate(); const joiner = Keypair.generate(); const outsider = Keypair.generate();
const receipts: { name: string; signature: string; room?: string }[] = [];
await mkdir(".secrets", { recursive: true });
await writeFile(".secrets/test-creator.json", JSON.stringify([...creator.secretKey]));
await writeFile(".secrets/test-joiner.json", JSON.stringify([...joiner.secretKey]));
async function fund(wallet: Keypair, lamports = 200_000_000) {
  if (rpc.startsWith("http://127.0.0.1")) {
    const signature = await connection.requestAirdrop(wallet.publicKey, lamports);
    await connection.confirmTransaction(signature, "confirmed");
  } else {
    const deployer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(".secrets/deployer.json", "utf8"))));
    await sendAndConfirmTransaction(connection, new Transaction().add(SystemProgram.transfer({ fromPubkey: deployer.publicKey, toPubkey: wallet.publicKey, lamports })), [deployer]);
  }
}
async function send(name: string, ix: TransactionInstruction, signers: Keypair[], roomId?: Uint8Array) {
  const feePayer = signers[0];
  const signature = await sendAndConfirmTransaction(connection, new Transaction({ feePayer: feePayer.publicKey }).add(ix), signers, { commitment: "confirmed" });
  receipts.push({ name, signature, room: roomId ? deriveRoomPda(roomId).toBase58() : undefined });
  return signature;
}
async function rejected(ix: TransactionInstruction, signers: Keypair[]) {
  let failed = false; try { await send("unexpected", ix, signers); } catch { failed = true; }
  assert.equal(failed, true, "Invalid transaction must be rejected");
}
for (const wallet of [creator, joiner, outsider, referee]) await fund(wallet, 50_000_000);
const stake = 1_000_001n;
const rent = await connection.getMinimumBalanceForRentExemption(ROOM_ACCOUNT_SIZE);
const games: { id: Uint8Array; outcome: 1 | 2 | 3; lat: number; lng: number; salt: Uint8Array; asset: Uint8Array }[] = [];
for (const outcome of [1, 2, 3] as const) {
  const id = randomBytes(32); const salt = randomBytes(32); const asset = randomBytes(32);
  await send(`create-${outcome}`, createRoomInstruction({ roomId: id, creator: creator.publicKey, referee: referee.publicKey, stakeLamports: stake }), [creator], id);
  assert.equal((await connection.getBalance(deriveRoomPda(id))), rent + Number(stake));
  await rejected(joinRoomInstruction({ roomId: id, joiner: creator.publicKey, referee: referee.publicKey }), [creator, referee]);
  await rejected(joinRoomInstruction({ roomId: id, joiner: joiner.publicKey, referee: outsider.publicKey }), [joiner, outsider]);
  await send(`join-${outcome}`, joinRoomInstruction({ roomId: id, joiner: joiner.publicKey, referee: referee.publicKey }), [joiner, referee], id);
  await rejected(cancelWaitingInstruction({ roomId: id, creator: creator.publicKey }), [creator]);
  await rejected(refundExpiredInstruction({ roomId: id, creator: creator.publicKey, joiner: joiner.publicKey }), [outsider]);
  const lat = 48_858_400; const lng = 2_294_500;
  const targetCommitment = buildTargetCommitment({ roomId: id, targetLatE6: lat, targetLngE6: lng, assetDigest32: asset, salt32: salt });
  await send(`start-${outcome}`, startRoundInstruction({ roomId: id, referee: referee.publicKey, targetCommitment }), [referee], id);
  assert.equal((await fetchChainRoom(connection, id))?.state, 2);
  games.push({ id, outcome, lat, lng, salt, asset });
}
const cancelId = randomBytes(32);
await send("prefund-cancel", SystemProgram.transfer({ fromPubkey: outsider.publicKey, toPubkey: deriveRoomPda(cancelId), lamports: 1_000_000 }), [outsider], cancelId);
const creatorBeforePrefunded = await connection.getBalance(creator.publicKey);
await send("create-cancel", createRoomInstruction({ roomId: cancelId, creator: creator.publicKey, referee: referee.publicKey, stakeLamports: stake }), [creator], cancelId);
const creatorAfterPrefunded = await connection.getBalance(creator.publicKey);
assert.equal(creatorBeforePrefunded - creatorAfterPrefunded, rent - 1_000_000 + Number(stake) + 5000, "PDA pre-funding covers rent but never discounts the stake");
await send("cancel", cancelWaitingInstruction({ roomId: cancelId, creator: creator.publicKey }), [creator], cancelId);
await rejected(cancelWaitingInstruction({ roomId: cancelId, creator: creator.publicKey }), [creator]);
assert.equal((await connection.getBalance(deriveRoomPda(cancelId))), rent);
for (const game of games) {
  const deadline = (await fetchChainRoom(connection, game.id))!.guessDeadline;
  while ((await connection.getBlockTime(await connection.getSlot()))! < deadline + 2) await new Promise((resolve) => setTimeout(resolve, 1000));
  const args = { roomId: game.id, creator: creator.publicKey, joiner: joiner.publicKey, referee: referee.publicKey, outcome: game.outcome, targetLatE6: game.lat, targetLngE6: game.lng, assetDigest32: game.asset, salt32: game.salt, transcriptDigest32: randomBytes(32) };
  await rejected(settleRoomInstruction({ ...args, targetLatE6: game.lat + 1 }), [referee]);
  const creatorBefore = await connection.getBalance(creator.publicKey); const joinerBefore = await connection.getBalance(joiner.publicKey);
  await send(`settle-${game.outcome}`, settleRoomInstruction(args), [referee], game.id);
  const creatorExpected = game.outcome === 1 ? 2n * stake : game.outcome === 3 ? stake : 0n;
  const joinerExpected = game.outcome === 2 ? 2n * stake : game.outcome === 3 ? stake : 0n;
  assert.equal((await connection.getBalance(creator.publicKey)) - creatorBefore, Number(creatorExpected));
  assert.equal((await connection.getBalance(joiner.publicKey)) - joinerBefore, Number(joinerExpected));
  assert.equal((await connection.getBalance(deriveRoomPda(game.id))), rent);
  assert.equal((await fetchChainRoom(connection, game.id))?.outcome, game.outcome);
  await rejected(settleRoomInstruction(args), [referee]);
  await rejected(refundExpiredInstruction({ roomId: game.id, creator: creator.publicKey, joiner: joiner.publicKey }), [outsider]);
}
await writeFile("chain/e2e-receipts.json", JSON.stringify({ rpc, programId: PROGRAM_ID.toBase58(), creator: creator.publicKey.toBase58(), joiner: joiner.publicKey.toBase58(), referee: referee.publicKey.toBase58(), stakeLamports: stake.toString(), rentLamports: rent, checkedAt: new Date().toISOString(), receipts }, null, 2));
console.log(`Escrow execution checks passed: ${receipts.length} confirmed transactions; exact payouts, rent, authorizations, target consistency and replay protection.`);
