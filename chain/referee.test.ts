import { test } from "node:test";
import assert from "node:assert/strict";
import { PublicKey, type AccountInfo, type Commitment, type Connection, type GetAccountInfoConfig, type ParsedTransactionWithMeta } from "@solana/web3.js";
import bs58 from "bs58";
import { createRoomInstruction, deriveRoomPda, fetchChainRoom, joinRoomInstruction, PROGRAM_ID, ROOM_ACCOUNT_SIZE, roomIdFromCode } from "../lib/chain";
import { verifyDepositTransaction } from "./referee";

const roomId = roomIdFromCode("DEPOSIT-CONSISTENCY");
const creator = new PublicKey(new Uint8Array(32).fill(11));
const joiner = new PublicKey(new Uint8Array(32).fill(12));
const referee = new PublicKey(new Uint8Array(32).fill(13));
const stranger = new PublicKey(new Uint8Array(32).fill(14));
const stakeLamports = 1_000_001n;
const receiptSlot = 456_789;
const signature = "confirmed-deposit-receipt";

function account(options: { state?: 0 | 1; stake?: bigint; referee?: PublicKey; creator?: PublicKey; joiner?: PublicKey; owner?: PublicKey; roomId?: Uint8Array } = {}): AccountInfo<Buffer> {
  const data = Buffer.alloc(ROOM_ACCOUNT_SIZE);
  data.write("GEODUEL1"); data[8] = 1; data[9] = options.state ?? 0; data[10] = 254;
  data.set(options.roomId ?? roomId, 12);
  data.set((options.creator ?? creator).toBytes(), 44);
  data.set((options.joiner ?? PublicKey.default).toBytes(), 76);
  data.set((options.referee ?? referee).toBytes(), 108);
  data.set(creator.toBytes(), 140);
  data.writeBigUInt64LE(options.stake ?? stakeLamports, 172);
  data.writeBigInt64LE(100n, 180); data.writeBigInt64LE(1_000n, 188);
  return { data, owner: options.owner ?? PROGRAM_ID, executable: false, lamports: 4_000_000, rentEpoch: 0 };
}

function receipt(kind: "create" | "join" = "create"): ParsedTransactionWithMeta {
  const instruction = kind === "create"
    ? createRoomInstruction({ roomId, creator, referee, stakeLamports })
    : joinRoomInstruction({ roomId, joiner, referee });
  return {
    slot: receiptSlot, blockTime: 100,
    meta: { err: null, fee: 5_000, preBalances: [], postBalances: [] },
    transaction: { signatures: [signature], message: {
      recentBlockhash: PublicKey.default.toBase58(),
      accountKeys: instruction.keys.map(key => ({ pubkey: key.pubkey, signer: key.isSigner, writable: key.isWritable })),
      instructions: [{ programId: instruction.programId, accounts: instruction.keys.map(key => key.pubkey), data: bs58.encode(instruction.data) }],
    } },
  };
}

function connectionFixture(accounts: (AccountInfo<Buffer> | null | Error)[], transaction: ParsedTransactionWithMeta | null = receipt()) {
  const reads: { address: PublicKey; config: Commitment | GetAccountInfoConfig | undefined }[] = [];
  const connection = {
    getParsedTransaction: async (requestedSignature: string, config: unknown) => {
      assert.equal(requestedSignature, signature);
      assert.deepEqual(config, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      return transaction;
    },
    getAccountInfo: async (address: PublicKey, config: Commitment | GetAccountInfoConfig | undefined) => {
      reads.push({ address, config });
      const result = accounts[Math.min(reads.length - 1, accounts.length - 1)];
      if (result instanceof Error) throw result;
      return result;
    },
  } as unknown as Connection;
  return { connection, reads };
}

function verify(connection: Connection, kind: "create" | "join" = "create") {
  return verifyDepositTransaction({ connection, roomId, wallet: kind === "create" ? creator : joiner, kind, stakeLamports, referee, signature });
}

test("deposit account reads require the confirmed receipt slot and retain exact terms", async () => {
  const { connection, reads } = connectionFixture([account()]);
  const room = await verify(connection);
  assert.equal(room.stakeLamports, stakeLamports);
  assert.equal(room.referee.toBase58(), referee.toBase58());
  assert.equal(room.creator.toBase58(), creator.toBase58());
  assert.equal(reads.length, 1);
  assert.equal(reads[0].address.toBase58(), deriveRoomPda(roomId).toBase58());
  assert.deepEqual(reads[0].config, { commitment: "confirmed", minContextSlot: receiptSlot });
});

test("a temporarily missing account is retried at the receipt slot", async () => {
  const { connection, reads } = connectionFixture([null, account()]);
  await verify(connection);
  assert.equal(reads.length, 2);
  for (const read of reads) assert.deepEqual(read.config, { commitment: "confirmed", minContextSlot: receiptSlot });
});

test("a waiting account is retried until the confirmed join becomes visible", async () => {
  const { connection, reads } = connectionFixture([account(), account({ state: 1, joiner })], receipt("join"));
  const room = await verify(connection, "join");
  assert.equal(reads.length, 2);
  assert.equal(room.joiner.toBase58(), joiner.toBase58());
});

test("an account that stays missing fails after four reads", async () => {
  const { connection, reads } = connectionFixture([null]);
  await assert.rejects(verify(connection), /Confirmed room account is not yet available/);
  assert.equal(reads.length, 4);
});

test("a join that stays absent fails after four reads", async () => {
  const { connection, reads } = connectionFixture([account()], receipt("join"));
  await assert.rejects(verify(connection, "join"), /Confirmed room join is not yet visible/);
  assert.equal(reads.length, 4);
});

test("wrong stake, referee, and nonempty depositor fail immediately without accepting a later account", async () => {
  for (const [invalid, message, kind] of [
    [account({ stake: stakeLamports + 1n }), /Confirmed room stake mismatch/, "create"],
    [account({ referee: stranger }), /Confirmed room referee mismatch/, "create"],
    [account({ creator: stranger }), /Confirmed room depositor mismatch/, "create"],
    [account({ state: 1, joiner: stranger }), /Confirmed room depositor mismatch/, "join"],
  ] as const) {
    const { connection, reads } = connectionFixture([invalid, account({ state: 1, joiner })], receipt(kind));
    await assert.rejects(verify(connection, kind), message);
    assert.equal(reads.length, 1);
  }
});

test("account identity and RPC errors are not retried", async () => {
  for (const [invalid, message] of [
    [account({ owner: stranger }), /Room owner mismatch/],
    [account({ roomId: roomIdFromCode("OTHER-ROOM") }), /Room ID mismatch/],
    [new Error("RPC unavailable"), /RPC unavailable/],
  ] as const) {
    const { connection, reads } = connectionFixture([invalid, account()]);
    await assert.rejects(verify(connection), message);
    assert.equal(reads.length, 1);
  }
});

test("receipt validation rejects an unsigned wallet and mismatched deposit amount or referee before account reads", async () => {
  for (const mutation of ["signer", "stake", "referee"] as const) {
    const transaction = receipt();
    if (mutation === "signer") transaction.transaction.message.accountKeys[0].signer = false;
    else {
      const instruction = transaction.transaction.message.instructions[0];
      assert.ok("data" in instruction);
      const data = Buffer.from(bs58.decode(instruction.data));
      if (mutation === "stake") data.writeBigUInt64LE(stakeLamports + 1n, 33);
      else data.set(stranger.toBytes(), 41);
      instruction.data = bs58.encode(data);
    }
    const { connection, reads } = connectionFixture([account()], transaction);
    await assert.rejects(verify(connection), mutation === "signer" ? /Deposit wallet did not sign/ : /expected room deposit/);
    assert.equal(reads.length, 0);
  }
});

test("fetchChainRoom preserves ordinary confirmed reads when no minimum slot is supplied", async () => {
  const { connection, reads } = connectionFixture([account()]);
  await fetchChainRoom(connection, roomId);
  assert.equal(reads[0].config, "confirmed");
});
