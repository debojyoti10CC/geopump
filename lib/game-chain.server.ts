import { env } from "cloudflare:workers";
import { Connection, PublicKey } from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha256";
import { DEVNET_RPC, PROGRAM_ID, deriveRoomPda, buildTargetCommitment, createRoomInstruction, joinRoomInstruction, startRoundInstruction,
  settleRoomInstruction, cancelWaitingInstruction, refundExpiredInstruction, fetchChainRoom, type ChainRoom } from "./chain";
import { parseRefereeSigner, buildSignedTransaction, sendRefereeTransaction, verifyDepositTransaction } from "../chain/referee";
import type { RoomRecord } from "./game-store";
import type { calculateResult } from "./game-math";
import { findConfirmedTerminalReceipt } from "./game-receipt";

type Settings = { SOLANA_PROGRAM_ID?: string; SOLANA_RPC_URL?: string; SOLANA_REFEREE_SECRET?: string };
const settings = () => env as unknown as Settings;
const bytes = (value:string) => Uint8Array.from(value.match(/.{2}/g)!,v=>parseInt(v,16));
const asHex = (value:Uint8Array) => Array.from(value,v=>v.toString(16).padStart(2,"0")).join("");
function publicDependencies(room?:RoomRecord) {
  const config=settings();
  const address=room?.program_id||config.SOLANA_PROGRAM_ID;
  if (!address) throw new Error("Escrow is not configured");
  return {programId:new PublicKey(address),connection:new Connection(config.SOLANA_RPC_URL||DEVNET_RPC,"confirmed")};
}
function dependencies(room?:RoomRecord) {
  const config=settings();
  if (!config.SOLANA_REFEREE_SECRET) throw new Error("Referee is unavailable; wallet-paid timeout recovery is still available");
  const signer=parseRefereeSigner(config.SOLANA_REFEREE_SECRET);
  if (room && signer.publicKey.toBase58()!==room.referee_wallet) throw new Error("This room's original referee must sign its result");
  return {...publicDependencies(room),signer};
}
const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
let readiness: {key:string;ready:boolean;checkedAt:number}|null=null;
function commitment(room:RoomRecord,programId:PublicKey) {
  return buildTargetCommitment({roomId:bytes(room.room_id),programId,targetLatE6:room.target_lat_e6,targetLngE6:room.target_lng_e6,assetDigest32:bytes(room.asset_digest),salt32:bytes(room.salt)});
}
export async function escrowConfiguration() {
  const config=settings(),programId=config.SOLANA_PROGRAM_ID||PROGRAM_ID.toBase58();
  let refereeWallet:string|null=null;
  let ready=false;
  if (config.SOLANA_PROGRAM_ID && config.SOLANA_REFEREE_SECRET) {
    try { refereeWallet=parseRefereeSigner(config.SOLANA_REFEREE_SECRET).publicKey.toBase58(); } catch { /* Unusable signer: fail closed for new deposits. */ }
    const key=`${programId}:${config.SOLANA_RPC_URL||DEVNET_RPC}`;
    if (readiness?.key===key && Date.now()-readiness.checkedAt<15_000) ready=readiness.ready;
    else {
      try {
        const {connection,programId:program,signer}=dependencies();
        const [account,genesis,balance]=await Promise.all([connection.getAccountInfo(program,"confirmed"),connection.getGenesisHash(),connection.getBalance(signer.publicKey,"confirmed")]);
        ready=!!account?.executable && genesis===DEVNET_GENESIS && balance>=100_000;
      } catch { ready=false; }
      readiness={key,ready,checkedAt:Date.now()};
    }
  }
  // Public wallets use the public devnet endpoint; server provider credentials stay private.
  return {ready,programId,refereeWallet,rpcUrl:DEVNET_RPC,commitment:(room:RoomRecord)=>asHex(commitment(room,new PublicKey(room.program_id)))};
}
export async function createDeposit(room:RoomRecord) {
  const {connection,programId,signer}=dependencies(room),creator=new PublicKey(room.creator_wallet);
  return (await buildSignedTransaction({connection,feePayer:creator,instructions:[createRoomInstruction({roomId:bytes(room.room_id),creator,referee:signer.publicKey,stakeLamports:BigInt(room.stake_lamports),programId})]})).base64;
}
export async function joinDeposit(room:RoomRecord,wallet:string) {
  const {connection,programId,signer}=dependencies(room),joiner=new PublicKey(wallet);
  return (await buildSignedTransaction({connection,feePayer:joiner,signers:[signer],instructions:[joinRoomInstruction({roomId:bytes(room.room_id),joiner,referee:signer.publicKey,programId})]})).base64;
}
export async function verifyDeposit(room:RoomRecord,wallet:string,signature:string) {
  const {connection,programId}=publicDependencies(room);
  return verifyDepositTransaction({connection,programId,referee:new PublicKey(room.referee_wallet),roomId:bytes(room.room_id),wallet:new PublicKey(wallet),signature,kind:wallet===room.creator_wallet?"create":"join",stakeLamports:BigInt(room.stake_lamports)});
}
type EscrowRoom = Omit<ChainRoom,"creator"|"joiner"|"referee"> & {creator:string;joiner:string;referee:string};
export async function readEscrow(room:RoomRecord):Promise<EscrowRoom|null> {
  const {connection,programId}=publicDependencies(room),chain=await fetchChainRoom(connection,bytes(room.room_id),programId);
  if (!chain) return null;
  if (chain.creator.toBase58()!==room.creator_wallet || chain.referee.toBase58()!==room.referee_wallet || chain.stakeLamports!==BigInt(room.stake_lamports)) throw new Error("Escrow does not match the durable room terms");
  return {...chain,creator:chain.creator.toBase58(),joiner:chain.joiner.toBase58(),referee:chain.referee.toBase58()};
}
export async function startEscrow(room:RoomRecord) {
  const {connection,programId,signer}=dependencies(room);
  return sendRefereeTransaction({connection,signer,instructions:[startRoundInstruction({roomId:bytes(room.room_id),programId,referee:signer.publicKey,targetCommitment:commitment(room,programId)})]});
}
export async function settleEscrow(room:RoomRecord,result:ReturnType<typeof calculateResult>) {
  const {connection,programId,signer}=dependencies(room);
  const transcriptDigest32=sha256(new TextEncoder().encode(JSON.stringify(result)));
  const signature=await sendRefereeTransaction({connection,signer,instructions:[settleRoomInstruction({roomId:bytes(room.room_id),programId,referee:signer.publicKey,
    creator:new PublicKey(room.creator_wallet),joiner:new PublicKey(room.opponent_wallet!),outcome:result.winnerWallet===null?3:result.winnerWallet===room.creator_wallet?1:2,
    targetLatE6:room.target_lat_e6,targetLngE6:room.target_lng_e6,assetDigest32:bytes(room.asset_digest),salt32:bytes(room.salt),transcriptDigest32})]});
  const chain=await fetchChainRoom(connection,bytes(room.room_id),programId);
  if (chain?.state!==3 || asHex(chain.transcriptDigest32)!==asHex(transcriptDigest32)) throw new Error("Settlement is not confirmed in the escrow account");
  return signature;
}
export async function recoveryTransaction(room:RoomRecord,wallet:string,cancel:boolean) {
  const {connection,programId}=publicDependencies(room),roomId=bytes(room.room_id),creator=new PublicKey(room.creator_wallet);
  const instructions=[cancel?cancelWaitingInstruction({roomId,programId,creator}):refundExpiredInstruction({roomId,programId,creator,joiner:room.opponent_confirmed&&room.opponent_wallet?new PublicKey(room.opponent_wallet):undefined})];
  return (await buildSignedTransaction({connection,instructions,feePayer:new PublicKey(wallet)})).base64;
}
export async function automaticRefund(room:RoomRecord) {
  const {connection,programId}=publicDependencies(room),signer=parseRefereeSigner(settings().SOLANA_REFEREE_SECRET||"");
  return sendRefereeTransaction({connection,signer,instructions:[refundExpiredInstruction({roomId:bytes(room.room_id),programId,creator:new PublicKey(room.creator_wallet),
    joiner:room.opponent_confirmed&&room.opponent_wallet?new PublicKey(room.opponent_wallet):undefined})]});
}
export async function terminalReceipt(room:RoomRecord,chain:EscrowRoom) {
  const {connection,programId}=publicDependencies(room);
  if (chain.state!==3 && chain.state!==4) return null;
  return findConfirmedTerminalReceipt({connection,programId,roomAddress:deriveRoomPda(bytes(room.room_id),programId),terminalState:chain.state,
    transcriptDigest:chain.state===3?chain.transcriptDigest32:undefined});
}
