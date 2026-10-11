import { env } from "cloudflare:workers";
import { PublicKey } from "@solana/web3.js";
import { GameStore, type RoomRecord, type SessionRecord, type PracticeRecord } from "./game-store";
import { ROUND_SECONDS, STAKE_MIN, STAKE_MAX, calculateResult, distanceMeters, formatGuessMessage, validateCoordinates } from "./game-math";
import { pickLocation, getLocation, getSceneAsset, getPreviewLocation } from "./locations.server";
import { escrowConfiguration, createDeposit, joinDeposit, verifyDeposit, readEscrow, startEscrow, settleEscrow, recoveryTransaction, automaticRefund, terminalReceipt, reclaimEscrowRent } from "./game-chain.server";

type GameEnvironment = { DB?: D1Database; GEO_OPERATOR_TOKEN?: string; SOLANA_PROGRAM_ID?: string; SOLANA_RPC_URL?: string; SOLANA_REFEREE_SECRET?: string };
export const gameEnvironment = () => env as unknown as GameEnvironment;
export class GameError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) { super(message); }
}
export function gameStore() {
  const binding = gameEnvironment().DB;
  if (!binding) throw new GameError("DATABASE_UNAVAILABLE", "The game service is not configured yet. Please try again shortly.", 503);
  return new GameStore(binding);
}
export function response(data: unknown, status = 200, cookie?: string) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store", ...(cookie ? { "Set-Cookie": cookie } : {}) } });
}
export async function api(action: () => Promise<Response>) {
  try { return await action(); } catch (error) {
    if (error instanceof GameError) return response({ error: error.code, message: error.message }, error.status);
    console.error("Geo Duels request failed", error instanceof Error ? error.message : "Unknown error");
    return response({ error: "SERVICE_UNAVAILABLE", message: "The game service could not complete this request. Your confirmed stake remains in its Solana escrow; retry or use recovery when its deadline passes." }, 503);
  }
}
export async function body(request: Request): Promise<Record<string, unknown>> {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) throw new GameError("INVALID_ORIGIN", "Use this game's website to submit a request.", 403);
  const raw = await request.text();
  if (raw.length > 8192) throw new GameError("REQUEST_TOO_LARGE", "This request is too large.", 413);
  try {
    const value = JSON.parse(raw || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new GameError("INVALID_REQUEST", "Send a valid game request."); }
}
export function walletAddress(value: unknown) {
  try { if (typeof value !== "string") throw new Error(); return new PublicKey(value).toBase58(); }
  catch { throw new GameError("INVALID_WALLET", "Connect a valid Solana wallet."); }
}
export function stakeAmount(value: unknown) {
  const amount=typeof value==="string" && /^[0-9]{1,10}$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(amount) || (amount as number)<STAKE_MIN || (amount as number)>STAKE_MAX) throw new GameError("INVALID_STAKE", "Choose a stake from 0.001 to 1 test SOL.");
  return amount as number;
}
export function roomCode(value: string) {
  const code = value.toUpperCase();
  if (!/^[A-Z2-9]{6}$/.test(code)) throw new GameError("INVALID_ROOM", "Enter the six-character room code.");
  return code;
}
export async function hash(value: string | Uint8Array) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource)));
}
export function hex(bytes: Uint8Array) { return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join(""); }
export function unhex(value: string) {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error("Invalid digest.");
  return Uint8Array.from(value.match(/.{2}/g)!, byte => parseInt(byte, 16));
}
function token(size = 24) { return hex(crypto.getRandomValues(new Uint8Array(size))); }
function cookieName(kind: "room" | "practice", id: string) { return `geo_${kind}_${id}`; }
function cookie(request: Request, kind: "room" | "practice", id: string, value: string) {
  return `${cookieName(kind,id)}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
}
function readCookie(request: Request, kind: "room" | "practice", id: string) {
  const value = (request.headers.get("cookie") || "").split(";").map(part => part.trim()).find(part => part.startsWith(`${cookieName(kind,id)}=`))?.split("=")[1];
  return value && /^[a-f0-9]{48}$/.test(value) ? value : null;
}
async function requireRoom(store: GameStore, code: string) {
  const room = await store.room(roomCode(code));
  if (!room) throw new GameError("ROOM_NOT_FOUND", "This room was not found. Check the invitation code.", 404);
  return room;
}
async function sessionFor(request: Request, store: GameStore, code: string, wallet?: string, authenticated = true) {
  const value = readCookie(request,"room",code);
  const session = value ? await store.session(await hash(value)) : null;
  if (!session || session.room_code !== code || session.expires_at <= Date.now() || (wallet && session.wallet !== wallet) || (authenticated && !session.authenticated)) return null;
  return session;
}
async function requireSession(request: Request, store: GameStore, code: string, wallet: string, authenticated = true) {
  const session = await sessionFor(request,store,code,wallet,authenticated);
  if (!session) throw new GameError("WALLET_AUTH_REQUIRED", "Sign the room's wallet message to continue.", 401);
  return session;
}
function authMessage(session: SessionRecord,programId:string) {
  return ["Geo Duels session v1", "Network: devnet", `Program: ${programId}`, `Room: ${session.room_code}`, `Wallet: ${session.wallet}`, `Nonce: ${session.nonce}`, `ExpiresAt: ${session.challenge_expires_at}`].join("\n");
}
async function issueSession(request: Request, store: GameStore, code: string, wallet: string) {
  const value = token(), now = Date.now();
  const session: SessionRecord = { token_hash: await hash(value), room_code: code, wallet, nonce: token(16), expires_at: now+86_400_000, challenge_expires_at: now+300_000, authenticated: 0 };
  await store.createSession(session);
  const room=(await store.room(code))!;
  return { session, cookie: cookie(request,"room",code,value), auth: { message: authMessage(session,room.program_id) } };
}
async function validSignature(wallet: string, message: string, signature: unknown) {
  if (typeof signature !== "string" || signature.length > 128) return false;
  try {
    const bytes = Uint8Array.from(atob(signature), char => char.charCodeAt(0));
    if (bytes.length !== 64) return false;
    const key = await crypto.subtle.importKey("raw", new PublicKey(wallet).toBytes() as BufferSource, { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify("Ed25519", key, bytes as BufferSource, new TextEncoder().encode(message));
  } catch { return false; }
}
async function authenticate(store: GameStore, session: SessionRecord, message: unknown, signature: unknown) {
  if (session.challenge_expires_at <= Date.now()) throw new GameError("AUTH_EXPIRED", "The wallet message expired. Reconnect to request another.", 401);
  const room=(await store.room(session.room_code))!;
  if (message !== authMessage(session,room.program_id) || !await validSignature(session.wallet, message as string, signature)) throw new GameError("INVALID_SIGNATURE", "The wallet message could not be verified.", 401);
  await store.authorizeSession(session.token_hash);
  session.authenticated = 1;
}
async function publicRoom(request: Request, store: GameStore, room: RoomRecord, wallet?: string) {
  const session = await sessionFor(request,store,room.code,wallet);
  const ownWallet = session?.wallet;
  const guesses = await store.guesses(room.code);
  const reveal = room.deadline !== null && Date.now() >= room.deadline;
  const location = await getLocation(room.location_id);
  return {
    code: room.code, status: room.status, programId:room.program_id, refereeWallet:room.referee_wallet, stakeLamports: String(room.stake_lamports), potLamports: String(room.stake_lamports * (room.opponent_confirmed ? 2 : room.creator_confirmed ? 1 : 0)),
    creatorWallet: room.creator_wallet, opponentWallet: room.opponent_wallet, roundSeconds: ROUND_SECONDS,
    deadline: room.deadline, refundAt: room.refund_at, serverTime: Date.now(),
    settlementSignature:room.settlement_signature,receiptStatus:["finished","cancelled"].includes(room.status)?room.settlement_signature?"confirmed":"unavailable":"pending",
    sceneUrl: session && ["active","settling","finished"].includes(room.status) ? `/api/scene/${room.scene_token}` : null,
    attribution: session ? { author: location.author, license: location.license, licenseUrl: location.licenseUrl } : null,
    ownLocked: !!ownWallet && guesses.some(guess => guess.wallet === ownWallet),
    players: [room.creator_wallet,room.opponent_wallet].filter(Boolean).map(player => ({ wallet: player, locked: reveal || player === ownWallet ? guesses.some(guess => guess.wallet === player) : false })),
    result: reveal && room.result_json ? { ...JSON.parse(room.result_json), receiptStatus:room.status==="finished"?room.settlement_signature?"confirmed":"unavailable":"pending",winnerPayoutLamports:String(JSON.parse(room.result_json).winnerPayoutLamports), location: { label: location.label, author: location.author, license: location.license, licenseUrl: location.licenseUrl, sourceUrl: location.sourceUrl }, targetCommitment: await escrowConfiguration().then(config => config.commitment(room)), commitmentSalt: room.salt, assetDigest: room.asset_digest, roomId: room.room_id } : null,
    challenge: session && room.status === "active" && room.deadline && Date.now() < room.deadline ? { nonce: session.nonce, expiresAt: room.deadline, programId: room.program_id, rulesVersion: 1 } : null,
  };
}

/** Reconcile against confirmed chain state, then relay an idempotent start/settlement. */
export async function synchronizeRoom(store: GameStore, room: RoomRecord): Promise<RoomRecord> {
  if (room.status === "cancelled" || room.status === "finished") return room;
  // Once the start is confirmed, only off-chain guesses change until the deadline.
  if (room.status === "active" && room.deadline && Date.now()<room.deadline) return room;
  const chain = await readEscrow(room);
  if (!chain) return room;
  if (chain.state === 3 || chain.state === 4) {
    const finished = chain.state === 3 ? "finished" : "cancelled";
    let signature=room.settlement_signature;
    if (!signature) {
      try { signature=await terminalReceipt(room,chain); } catch { /* State confirms settlement even if historical RPC lookup is unavailable. */ }
    }
    const result=room.result_json?JSON.parse(room.result_json):null;
    if (result && signature) result.signature=signature;
    await store.patchRoom(room.code,{status:finished,lease_until:0,settlement_signature:signature,...(Number.isSafeInteger(chain.terminalAt)?{terminal_at:chain.terminalAt*1000}:{}),...(result?{result_json:JSON.stringify(result)}:{})});
    return (await store.room(room.code))!;
  }
  await store.patchRoom(room.code, { creator_confirmed: 1, opponent_confirmed: chain.state >= 1 ? 1 : 0,
    opponent_wallet: chain.state >= 1 ? chain.joiner : room.opponent_wallet,
    deadline: chain.state === 2 ? chain.guessDeadline * 1000 : null,
    refund_at: (chain.state === 0 ? chain.joinDeadline : chain.state === 1 ? chain.startDeadline : chain.settleDeadline) * 1000,
    status: chain.state === 0 ? "waiting" : chain.state === 1 ? "starting" : Date.now() >= chain.guessDeadline * 1000 ? "settling" : "active" });
  room = (await store.room(room.code))!;
  const now = Date.now();
  if (room.refund_at && now >= room.refund_at) {
    await store.patchRoom(room.code,{status:"refundable"});
    if (await store.takeLease(room.code,now)) {
      try {
        const signature=await automaticRefund(room);
        const refunded=await readEscrow(room);
        if (refunded?.state===4) await store.patchRoom(room.code,{status:"cancelled",settlement_signature:signature,last_error:null});
      } catch { /* Keep the permissionless, wallet-paid recovery button available. */ }
      finally { await store.patchRoom(room.code,{lease_until:0}); }
    }
    return (await store.room(room.code))!;
  }
  if ((chain.state === 1 || (chain.state === 2 && now >= chain.guessDeadline*1000)) && await store.takeLease(room.code,now)) {
    try {
      if (chain.state === 1) {
        await startEscrow(room);
        const started = await readEscrow(room);
        if (started?.state === 2) await store.patchRoom(room.code,{status:"active",deadline:started.guessDeadline*1000,refund_at:started.settleDeadline*1000});
      } else {
        const result = calculateResult({latE6:room.target_lat_e6,lngE6:room.target_lng_e6},room.creator_wallet,room.opponent_wallet!,room.stake_lamports,await store.guesses(room.code));
        await store.patchRoom(room.code,{status:"settling",result_json:JSON.stringify(result)});
        const receipt = await settleEscrow(room,result);
        result.signature = receipt;
        await store.patchRoom(room.code,{status:"finished",result_json:JSON.stringify(result),settlement_signature:receipt,last_error:null});
      }
    } catch (error) {
      console.error("Escrow relay retry pending", room.code, error instanceof Error ? error.message : "Relay failed");
      await store.patchRoom(room.code,{last_error:"Relay retry pending"});
    } finally { await store.patchRoom(room.code,{lease_until:0}); }
  }
  return (await store.room(room.code))!;
}

export async function getConfig() {
  const config = await escrowConfiguration();
  return response({ network:"devnet", programId:config.programId, rpcUrl:config.rpcUrl, stakeMin:String(STAKE_MIN), stakeMax:String(STAKE_MAX), roundSeconds:ROUND_SECONDS, escrowReady:config.ready, feeBps:0, trustedReferee:true, serverTime:Date.now() });
}
export async function createRoom(request: Request) {
  const data = await body(request), wallet = walletAddress(data.wallet);
  const stakeLamports=stakeAmount(data.stakeLamports);
  const config=await escrowConfiguration();
  if (!config.ready || !config.refereeWallet) throw new GameError("ESCROW_NOT_CONFIGURED", "Room staking is temporarily unavailable. No test SOL has been requested.", 503);
  const store = gameStore(), location = await pickLocation();
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (const byte of crypto.getRandomValues(new Uint8Array(6))) code += alphabet[byte % alphabet.length];
  const room = { code,room_id:await hash(`geo-duels-room-v1:${code}:${token()}`),program_id:config.programId,referee_wallet:config.refereeWallet,creator_wallet:wallet,stake_lamports:stakeLamports,status:"funding",created_at:Date.now(),
    location_id:location.id,target_lat_e6:location.latE6,target_lng_e6:location.lngE6,asset_digest:location.assetDigest,salt:token(32),scene_token:token() };
  await store.createRoom(room);
  const fullRoom = (await store.room(code))!, issued = await issueSession(request,store,code,wallet);
  const transaction = await createDeposit(fullRoom);
  return response({ room:await publicRoom(request,store,fullRoom,wallet),transaction,auth:issued.auth },201,issued.cookie);
}
export async function joinRoom(request: Request, codeValue: string) {
  const data = await body(request),wallet = walletAddress(data.wallet),store = gameStore();
  let room = await requireRoom(store,codeValue);
  room = await synchronizeRoom(store,room);
  if (room.creator_wallet === wallet) throw new GameError("SAME_WALLET", "A friend needs a different wallet to join this duel.");
  if (room.status !== "waiting" || !room.creator_confirmed || (room.refund_at && Date.now() >= room.refund_at)) throw new GameError("ROOM_NOT_OPEN", "This room is not waiting for a funded opponent.",409);
  room = (await store.reserveOpponent(room.code,wallet))!;
  if (room.opponent_wallet !== wallet) throw new GameError("ROOM_FULL", "Another wallet has already taken this room's second seat.",409);
  const issued = await issueSession(request,store,room.code,wallet), transaction = await joinDeposit(room,wallet);
  return response({room:await publicRoom(request,store,room,wallet),transaction,auth:issued.auth},200,issued.cookie);
}
export async function confirmRoom(request: Request, codeValue: string) {
  const data = await body(request), wallet = walletAddress(data.wallet), store = gameStore();
  let room = await requireRoom(store,codeValue);
  const session = await requireSession(request,store,room.code,wallet,false);
  if (typeof data.signature !== "string" || data.signature.length < 64 || data.signature.length > 100) throw new GameError("INVALID_TRANSACTION", "A confirmed deposit transaction is required.");
  if (wallet !== room.creator_wallet && wallet !== room.opponent_wallet) throw new GameError("NOT_A_PLAYER", "This wallet has not been admitted to this room.",403);
  await authenticate(store,session,data.authMessage,data.authSignature);
  await verifyDeposit(room,wallet,data.signature);
  await store.patchRoom(room.code,wallet === room.creator_wallet ? {creator_confirmed:1,status:"waiting"} : {opponent_confirmed:1,status:"starting"});
  room = await synchronizeRoom(store,(await store.room(room.code))!);
  return response({room:await publicRoom(request,store,room,wallet)});
}
export async function getRoom(request: Request, codeValue: string) {
  const store = gameStore(), query = new URL(request.url).searchParams.get("wallet");
  const wallet = query ? walletAddress(query) : undefined;
  const room = await synchronizeRoom(store,await requireRoom(store,codeValue));
  return response({room:await publicRoom(request,store,room,wallet)});
}
export async function authRoom(request: Request, codeValue: string) {
  const data = await body(request),wallet = walletAddress(data.wallet),store = gameStore(),room = await requireRoom(store,codeValue);
  if (!(wallet === room.creator_wallet && room.creator_confirmed || wallet === room.opponent_wallet && room.opponent_confirmed)) throw new GameError("NOT_A_PLAYER", "Only a funded player can reconnect to this room.",403);
  if (!data.message) {
    const issued = await issueSession(request,store,room.code,wallet);
    return response({auth:issued.auth},200,issued.cookie);
  }
  const session = await requireSession(request,store,room.code,wallet,false);
  await authenticate(store,session,data.message,data.signature);
  return response({room:await publicRoom(request,store,room,wallet)});
}
export async function guessRoom(request: Request, codeValue: string) {
  const data = await body(request),wallet = walletAddress(data.wallet),store = gameStore(),room = await requireRoom(store,codeValue);
  const session = await requireSession(request,store,room.code,wallet);
  let point;
  try { point = validateCoordinates(data.latE6,data.lngE6); } catch { throw new GameError("INVALID_GUESS","Choose a valid point on the world map."); }
  if (!room.deadline) throw new GameError("ROUND_NOT_ACTIVE", "Wait for both confirmed deposits and the round to start.",409);
  const expected = formatGuessMessage(room.code,wallet,session.nonce,room.deadline,point,room.program_id);
  if (data.message !== expected || !await validSignature(wallet,expected,data.signature)) throw new GameError("INVALID_SIGNATURE", "The guess signature does not match this wallet, room and map point.",401);
  const acceptedAt = Date.now(),guess = {wallet,...point,message:expected,signature:data.signature as string,acceptedAt};
  const receipt = await store.acceptGuess(room.code,guess,acceptedAt);
  if (!receipt.stored) throw new GameError("ROUND_CLOSED", "The deadline passed before the server received this guess.",409);
  if (receipt.stored.latE6 !== point.latE6 || receipt.stored.lngE6 !== point.lngE6 || receipt.stored.message !== expected) throw new GameError("GUESS_ALREADY_LOCKED", "Your first accepted guess is already locked.",409);
  return response({accepted:true,acceptedAt:receipt.stored.acceptedAt,room:await publicRoom(request,store,room,wallet)});
}
export async function recoverRoom(request: Request, codeValue: string, cancel: boolean) {
  const data = await body(request),wallet = walletAddress(data.wallet),store = gameStore();
  let room = await requireRoom(store,codeValue);
  await requireSession(request,store,room.code,wallet);
  room = await synchronizeRoom(store,room);
  if (wallet !== room.creator_wallet && wallet !== room.opponent_wallet) throw new GameError("NOT_A_PLAYER", "Only a player can use this room's recovery button.",403);
  if (cancel ? room.status !== "waiting" || wallet !== room.creator_wallet : room.status !== "refundable") throw new GameError("REFUND_NOT_AVAILABLE", cancel ? "Only the creator can cancel while the room has no second deposit." : "Recovery becomes available at the room's fixed refund deadline.",409);
  return response({room:await publicRoom(request,store,room,wallet),transaction:await recoveryTransaction(room,wallet,cancel)});
}

async function requirePractice(request: Request, store: GameStore, id: string) {
  if (!/^[a-f0-9]{32}$/.test(id)) throw new GameError("PRACTICE_NOT_FOUND","This practice round was not found.",404);
  const practice = await store.practice(id),value = readCookie(request,"practice",id);
  if (!practice || !value || practice.token_hash !== await hash(value)) throw new GameError("PRACTICE_NOT_FOUND","This practice round was not found in this browser.",404);
  return practice;
}
async function practiceResult(practice: PracticeRecord, point: {latE6:number;lngE6:number} | null, now: number) {
  const target = {latE6:practice.target_lat_e6,lngE6:practice.target_lng_e6},location = await getLocation(practice.location_id);
  const distance = point ? distanceMeters(target,point) : null;
  return {target,guess:point,distanceMeters:distance,score:distance === null ? 0 : Math.round(5000*Math.exp(-distance/2_000_000)),remainingMs:Math.max(0,practice.deadline-now),
    timedOut:point === null,location:{label:location.label,author:location.author,license:location.license,licenseUrl:location.licenseUrl,sourceUrl:location.sourceUrl}};
}
export async function createPractice(request: Request) {
  await body(request);
  const store = gameStore(),location = await pickLocation(),now = Date.now(),id=token(16),value=token();
  await store.createPractice({id,token_hash:await hash(value),location_id:location.id,target_lat_e6:location.latE6,target_lng_e6:location.lngE6,scene_token:token(),created_at:now,deadline:now+ROUND_SECONDS*1000,result_json:null});
  const practice = (await store.practice(id))!;
  return response({id,sceneUrl:`/api/scene/${practice.scene_token}`,deadline:practice.deadline,roundSeconds:ROUND_SECONDS,serverTime:now,attribution:{author:location.author,license:location.license,licenseUrl:location.licenseUrl}},201,cookie(request,"practice",id,value));
}
export async function getPractice(request: Request, id: string) {
  const store=gameStore();
  let practice = await requirePractice(request,store,id);
  if (Date.now() >= practice.deadline && !practice.result_json) practice = (await store.finishPractice(id,JSON.stringify(await practiceResult(practice,null,Date.now()))))!;
  return response({id,sceneUrl:`/api/scene/${practice.scene_token}`,deadline:practice.deadline,roundSeconds:ROUND_SECONDS,serverTime:Date.now(),result:practice.result_json ? JSON.parse(practice.result_json) : null});
}
export async function guessPractice(request: Request, id: string) {
  const data = await body(request),store=gameStore();
  let practice = await requirePractice(request,store,id);
  if (practice.result_json) return response(JSON.parse(practice.result_json));
  let point;
  try { point=validateCoordinates(data.latE6,data.lngE6); } catch { throw new GameError("INVALID_GUESS","Choose a valid point on the world map."); }
  practice=(await store.finishPractice(id,JSON.stringify(await practiceResult(practice,Date.now()<practice.deadline?point:null,Date.now()))))!;
  return response(JSON.parse(practice.result_json!));
}
export async function scene(request: Request, sceneToken: string) {
  if (!/^[a-f0-9]{48}$/.test(sceneToken)) throw new GameError("SCENE_NOT_FOUND","This scene was not found.",404);
  const store=gameStore(),practice=await store.practiceForScene(sceneToken);
  if (practice) { await requirePractice(request,store,practice.id); return getSceneAsset(practice.location_id); }
  const room=await store.roomForScene(sceneToken);
  if (!room || !await sessionFor(request,store,room.code) || !["active","settling","finished"].includes(room.status)) throw new GameError("SCENE_NOT_FOUND","Join the funded room to view its scene.",404);
  return getSceneAsset(room.location_id);
}
export async function previewScene() {
  const location=await getPreviewLocation();
  return response({sceneUrl:"/api/preview-scene/image",attribution:{author:location.author,license:location.license,licenseUrl:location.licenseUrl}});
}
export async function previewImage() { return getSceneAsset((await getPreviewLocation()).id); }
export async function operatorTick(request: Request) {
  const secret=gameEnvironment().GEO_OPERATOR_TOKEN;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) throw new GameError("UNAUTHORIZED","Operator authentication is required.",401);
  return response(await runOperatorTick());
}
export async function runOperatorTick() {
  const store=gameStore(),rooms=await store.pendingRooms(Date.now());
  const results=await Promise.allSettled(rooms.map(room=>synchronizeRoom(store,room)));
  const terminalRooms=await store.rentCandidates(Date.now());
  const rentResults=await Promise.allSettled(terminalRooms.map(async room=>{
    if (!await store.takeLease(room.code,Date.now())) return false;
    try {
      const reclaim=await reclaimEscrowRent(room);
      await store.patchRoom(room.code,{terminal_at:reclaim.terminalAt,...(reclaim.closed?{rent_reclaimed_at:Date.now(),rent_signature:reclaim.signature}:{}),last_error:null});
      return reclaim.closed;
    } catch {
      await store.patchRoom(room.code,{last_error:"Rent reclamation retry pending"});
      return false;
    } finally { await store.patchRoom(room.code,{lease_until:0}); }
  }));
  await store.cleanup(Date.now());
  return {checked:rooms.length,processed:results.filter(result=>result.status==="fulfilled").length,rentChecked:terminalRooms.length,rentReclaimed:rentResults.filter(result=>result.status==="fulfilled" && result.value).length,serverTime:Date.now()};
}
export const sweepRooms=runOperatorTick;
