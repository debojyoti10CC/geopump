import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { deriveRoomPda, fetchChainRoom, PROGRAM_ID, type ChainRoom } from "../lib/chain";
import bs58 from "bs58";

/** Server-only. Never import this module into a client component. */
export function parseRefereeSigner(secret: string): Keypair {
  const value = secret.trim();
  if (!value) throw new Error("SOLANA_REFEREE_SECRET is required");
  const bytes = value.startsWith("[") ? Uint8Array.from(JSON.parse(value) as number[]) : bs58.decode(value);
  if (bytes.length !== 64) throw new Error("Referee secret must contain 64 bytes");
  return Keypair.fromSecretKey(bytes);
}
export async function buildSignedTransaction(args: { connection: Connection; instructions: TransactionInstruction[]; feePayer: PublicKey; signers?: Keypair[] }): Promise<{ transaction: Transaction; base64: string; blockhash: string; lastValidBlockHeight: number }> {
  const latest = await args.connection.getLatestBlockhash("confirmed");
  const transaction = new Transaction({ feePayer: args.feePayer, ...latest }).add(...args.instructions);
  if (args.signers?.length) transaction.partialSign(...args.signers);
  return { transaction, base64: transaction.serialize({ requireAllSignatures: false, verifySignatures: true }).toString("base64"), ...latest };
}
export async function sendRefereeTransaction(args: { connection: Connection; instructions: TransactionInstruction[]; signer: Keypair }): Promise<string> {
  const { transaction, lastValidBlockHeight } = await buildSignedTransaction({ connection: args.connection, instructions: args.instructions, feePayer: args.signer.publicKey, signers: [args.signer] });
  const signature = await args.connection.sendRawTransaction(transaction.serialize(), { skipPreflight: false, maxRetries: 3 });
  // Worker runtimes cannot rely on the Node WebSocket implementation used by web3.js.
  // Read the actual receipt over HTTP before checking whether its blockhash expired.
  for (let attempt=0;attempt<60;attempt++) {
    const result=(await args.connection.getSignatureStatuses([signature],{searchTransactionHistory:true})).value[0];
    if (result?.err) throw new Error(`Solana transaction failed: ${JSON.stringify(result.err)}`);
    if (result?.confirmationStatus==="confirmed" || result?.confirmationStatus==="finalized") return signature;
    if (attempt%5===4 && await args.connection.getBlockHeight("confirmed")>lastValidBlockHeight) throw new Error(`Transaction ${signature} expired before confirmation`);
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  throw new Error(`Transaction ${signature} is still pending confirmation`);
}
/** A random signature or old room-state alone cannot serve as a deposit receipt. */
export async function verifyDepositTransaction(args: { connection: Connection; roomId: Uint8Array; wallet: PublicKey; kind: "create" | "join"; stakeLamports: bigint; signature: string; referee?: PublicKey; programId?: PublicKey }): Promise<ChainRoom> {
  const programId = args.programId ?? PROGRAM_ID;
  const transaction = await args.connection.getParsedTransaction(args.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  if (!transaction || transaction.meta?.err !== null) throw new Error("Deposit transaction is not confirmed successfully");
  const signer = transaction.transaction.message.accountKeys.find((entry) => entry.pubkey.equals(args.wallet));
  if (!signer?.signer) throw new Error("Deposit wallet did not sign this transaction");
  const pda = deriveRoomPda(args.roomId, programId);
  const expectedTag = args.kind === "create" ? 0 : 1;
  const matching = transaction.transaction.message.instructions.some((ix) => {
    if (!("data" in ix) || !ix.programId.equals(programId)) return false;
    const data = bs58.decode(ix.data);
    if (data[0] !== expectedTag) return false;
    const expectedRoomIndex = args.kind === "create" ? 1 : 0;
    const expectedWalletIndex = args.kind === "create" ? 0 : 1;
    if (!ix.accounts[expectedRoomIndex]?.equals(pda) || !ix.accounts[expectedWalletIndex]?.equals(args.wallet)) return false;
    if (args.kind === "create") {
      if (data.length !== 73 || !Buffer.from(data.subarray(1, 33)).equals(Buffer.from(args.roomId))) return false;
      const stake = new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(33, true);
      if (stake !== args.stakeLamports) return false;
      if (args.referee && !new PublicKey(data.subarray(41, 73)).equals(args.referee)) return false;
    } else if (data.length !== 1) return false;
    return true;
  });
  if (!matching) throw new Error("Transaction does not contain the expected room deposit");
  for (let attempt = 0; attempt < 4; attempt++) {
    // A receipt can become visible before the RPC account cache catches up.
    const room = await fetchChainRoom(args.connection, args.roomId, programId, transaction.slot);
    if (room) {
      if (room.stakeLamports !== args.stakeLamports) throw new Error("Confirmed room stake mismatch");
      if (args.referee && !room.referee.equals(args.referee)) throw new Error("Confirmed room referee mismatch");
      const participant = args.kind === "create" ? room.creator : room.joiner;
      if (participant.equals(args.wallet)) return room;
      const joinNotVisible = args.kind === "join" && room.state === 0 && room.joiner.equals(PublicKey.default);
      if (!joinNotVisible) throw new Error("Confirmed room depositor mismatch");
      if (attempt === 3) throw new Error("Confirmed room join is not yet visible");
    } else if (attempt === 3) throw new Error("Confirmed room account is not yet available");
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error("Confirmed room account is not yet available");
}
