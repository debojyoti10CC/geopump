import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { build } from "esbuild";
import { Keypair } from "@solana/web3.js";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { GameStore } from "../lib/game-store.ts";
import { distanceMeters, calculateResult, formatGuessMessage, validateCoordinates } from "../lib/game-math.ts";
import { findConfirmedTerminalReceipt } from "../lib/game-receipt.ts";

const programId="9akMspt9zUEXS5Yp8NBZGNKhRgtdLMi7oMhxpC7G1BAk";
const target={latE6:12_345_678,lngE6:-23_456_789};
const fixture={id:"private-photo",...target,label:"Secret city",author:"Test photographer",license:"CC-BY-SA 4.0",licenseUrl:"https://creativecommons.org/licenses/by-sa/4.0/",sourceUrl:"https://example.invalid/secret-coordinates",assetDigest:"1".repeat(64)};
let mf,db,store;
before(async()=>{
  const bundled=await build({
    stdin:{contents:`import * as game from './lib/game-server';
export default {async fetch(request){let url=new URL(request.url),p=url.pathname.split('/').filter(Boolean);return game.api(async()=>{
if(p[1]==='config')return game.getConfig();
if(p[1]==='preview-scene')return p[2]?game.previewImage():game.previewScene();
if(p[1]==='practice')return !p[2]?game.createPractice(request):p[3]==='guess'?game.guessPractice(request,p[2]):game.getPractice(request,p[2]);
if(p[1]==='scene')return game.scene(request,p[2]);
if(p[1]==='rooms')return !p[2]?game.createRoom(request):p[3]==='auth'?game.authRoom(request,p[2]):p[3]==='guess'?game.guessRoom(request,p[2]):game.getRoom(request,p[2]);
return new Response('not found',{status:404});});}};`,resolveDir:process.cwd(),sourcefile:"service-test-entry.ts"},
    bundle:true,write:false,platform:"browser",format:"esm",target:"es2022",external:["cloudflare:workers"],
    plugins:[{name:"isolated-service-dependencies",setup(build){
      build.onResolve({filter:/locations\.server$/},()=>({path:"locations",namespace:"fixture"}));
      build.onResolve({filter:/game-chain\.server$/},()=>({path:"chain",namespace:"fixture"}));
      build.onLoad({filter:/.*/,namespace:"fixture"},args=>({contents:args.path==="locations"?`
const location=${JSON.stringify(fixture)};
export const pickLocation=()=>location,getLocation=()=>location,getPreviewLocation=()=>location;
export const getSceneAsset=async()=>new Response(new Uint8Array([255,216,255,217]),{headers:{'Content-Type':'image/jpeg','Cache-Control':'private, no-store'}});`:`
export const escrowConfiguration=async()=>({ready:false,programId:'${programId}',rpcUrl:'https://api.devnet.solana.com',commitment:()=>null});
export const createDeposit=async()=>{throw Error('No escrow')},joinDeposit=createDeposit,verifyDeposit=createDeposit,startEscrow=createDeposit,settleEscrow=createDeposit,recoveryTransaction=createDeposit,automaticRefund=createDeposit;
export const readEscrow=async(room)=>room.last_error?.startsWith('TEST_TERMINAL_')?{state:3}:null;
export const terminalReceipt=async(room)=>{if(room.last_error==='TEST_TERMINAL_HISTORY_UNAVAILABLE')throw Error('Historical RPC unavailable');return 'confirmed-settlement-receipt';};`,loader:"js"}));
    }}],
  });
  mf=new Miniflare({modules:true,script:bundled.outputFiles[0].text,compatibilityDate:"2026-05-15",compatibilityFlags:["nodejs_compat"],d1Databases:{DB:"geo-duels-service-test"},bindings:{SOLANA_PROGRAM_ID:programId}});
  db=await mf.getD1Database("DB");
  await db.exec((await readFile(new URL("../drizzle/0000_geo_duels.sql",import.meta.url),"utf8")).replaceAll(/\r?\n/g," "));
  await db.exec((await readFile(new URL("../drizzle/0001_pin_escrow_authorities.sql",import.meta.url),"utf8")).replaceAll(/\r?\n/g," "));
  store=new GameStore(db);
});
after(async()=>{await mf?.dispose();});

async function call(path,options={}){
  const response=await mf.dispatchFetch(`https://geo.test${path}`,options);
  const contentType=response.headers.get("content-type")||"";
  return {response,data:contentType.includes("json")?await response.json():null};
}
function post(data,cookie){return {method:"POST",headers:{"Content-Type":"application/json",...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(data)};}
function cookieFrom(response){return response.headers.get("set-cookie").split(";")[0];}
function signed(keypair,message){return Buffer.from(nacl.sign.detached(new TextEncoder().encode(message),keypair.secretKey)).toString("base64");}
async function seededRoom(code,creator,opponent=null){
  await store.createRoom({code,room_id:"2".repeat(64),program_id:programId,referee_wallet:"6HzMz4vsXsSko7e2y3PkL2fuEdRGkpPjSyJDyp6XcT4P",creator_wallet:creator,stake_lamports:1_000_000,status:"active",created_at:Date.now(),location_id:fixture.id,target_lat_e6:target.latE6,target_lng_e6:target.lngE6,asset_digest:fixture.assetDigest,salt:"3".repeat(64),scene_token:crypto.randomUUID().replaceAll("-","")+"4".repeat(16)});
  await store.patchRoom(code,{creator_confirmed:1,opponent_wallet:opponent,opponent_confirmed:opponent?1:0,deadline:Date.now()+30_000});
  return store.room(code);
}

test("spherical scoring is stable at poles, antipodes and the date line",()=>{
  assert.equal(distanceMeters({latE6:0,lngE6:0},{latE6:0,lngE6:0}),0);
  assert.equal(distanceMeters({latE6:0,lngE6:0},{latE6:0,lngE6:90_000_000}),10_007_543);
  assert.equal(distanceMeters({latE6:0,lngE6:179_000_000},{latE6:0,lngE6:-179_000_000}),222_390);
  assert.equal(distanceMeters({latE6:90_000_000,lngE6:0},{latE6:90_000_000,lngE6:180_000_000}),0);
  assert.equal(distanceMeters({latE6:0,lngE6:0},{latE6:0,lngE6:180_000_000}),20_015_087);
  assert.deepEqual(validateCoordinates(0,180_000_000),{latE6:0,lngE6:-180_000_000});
  assert.throws(()=>validateCoordinates(90_000_001,0));assert.throws(()=>validateCoordinates(1.2,0));
});

test("payouts conserve every lamport for wins, ties and missing guesses",()=>{
  const guess=(wallet,point)=>({wallet,...point,message:"signed",signature:"signature",acceptedAt:1});
  const origin={latE6:0,lngE6:0},far={latE6:30_000_000,lngE6:50_000_000};
  for(const guesses of [[guess("a",origin),guess("b",far)],[guess("a",far),guess("b",origin)],[guess("a",origin),guess("b",origin)],[guess("a",origin)],[guess("b",origin)],[]]){
    const result=calculateResult(origin,"a","b",1_000_001,guesses);
    assert.equal(result.payouts.reduce((sum,payout)=>sum+payout.lamports,0),2_000_002);
    assert.equal(result.winnerPayoutLamports,result.winnerWallet?2_000_002:1_000_001);
  }
  assert.equal(calculateResult(origin,"a","b",1_000_001,[]).reason,"both_missed");
});

test("unconfigured escrow fails closed and accepts exact decimal lamport strings",async()=>{
  const config=await call("/api/config");assert.equal(config.data.network,"devnet");assert.equal(config.data.escrowReady,false);
  const wallet=Keypair.generate().publicKey.toBase58();
  const response=await call("/api/rooms",post({wallet,stakeLamports:"1000000"}));
  assert.equal(response.response.status,503);assert.equal(response.data.error,"ESCROW_NOT_CONFIGURED");
  for(const stakeLamports of ["1e6","0.001","1000000.5",NaN,0,-1,1_000_000_001]){
    const response=await call("/api/rooms",post({wallet,stakeLamports}));assert.equal(response.data.error,"INVALID_STAKE");
  }
  const count=await db.prepare("SELECT COUNT(*) AS n FROM rooms").first();assert.equal(count.n,0);
});

test("practice keeps targets private, uses browser-bound scenes and locks one durable guess",async()=>{
  const started=await call("/api/practice",post({}));assert.equal(started.response.status,201);
  assert.ok(!JSON.stringify(started.data).includes(String(target.latE6)));assert.ok(!JSON.stringify(started.data).includes("sourceUrl"));
  assert.match(started.response.headers.get("set-cookie"),/HttpOnly; SameSite=Strict/);
  const cookie=cookieFrom(started.response);
  assert.equal((await call(started.data.sceneUrl)).response.status,404);
  assert.equal((await call(started.data.sceneUrl,{headers:{Cookie:cookie}})).response.status,200);
  const guesses=await Promise.all([call(`/api/practice/${started.data.id}/guess`,post(target,cookie)),call(`/api/practice/${started.data.id}/guess`,post({latE6:0,lngE6:0},cookie))]);
  assert.deepEqual(guesses[0].data,guesses[1].data);
  const stored=await store.practice(started.data.id);assert.deepEqual(JSON.parse(stored.result_json),guesses[0].data);
  const replay=await call(`/api/practice/${started.data.id}/guess`,post({latE6:90_000_000,lngE6:0},cookie));assert.deepEqual(replay.data,guesses[0].data);
  const outsider=await call(`/api/practice/${started.data.id}`);assert.equal(outsider.response.status,404);
});

test("expired practice reveals a timeout result and ignores later guesses",async()=>{
  const started=await call("/api/practice",post({})),cookie=cookieFrom(started.response);
  await db.prepare("UPDATE practices SET deadline=? WHERE id=?").bind(Date.now()-1,started.data.id).run();
  const timed=await call(`/api/practice/${started.data.id}`,{headers:{Cookie:cookie}});
  assert.equal(timed.data.result.timedOut,true);assert.equal(timed.data.result.guess,null);assert.equal(timed.data.result.score,0);
  const late=await call(`/api/practice/${started.data.id}/guess`,post(target,cookie));assert.deepEqual(late.data,timed.data.result);
});

test("room sessions require a wallet signature; public polls conceal opponent and answer",async()=>{
  const creator=Keypair.generate(),opponent=Keypair.generate(),code="ABCD23";
  const room=await seededRoom(code,creator.publicKey.toBase58(),opponent.publicKey.toBase58());
  const stranger=await call(`/api/rooms/${code}?wallet=${creator.publicKey.toBase58()}`);
  assert.equal(stranger.data.room.sceneUrl,null);assert.equal(stranger.data.room.challenge,null);assert.equal(stranger.data.room.result,null);
  const challenge=await call(`/api/rooms/${code}/auth`,post({wallet:creator.publicKey.toBase58()})),cookie=cookieFrom(challenge.response);
  const wrong=await call(`/api/rooms/${code}/auth`,post({wallet:creator.publicKey.toBase58(),message:challenge.data.auth.message,signature:signed(opponent,challenge.data.auth.message)},cookie));assert.equal(wrong.response.status,401);
  const authorized=await call(`/api/rooms/${code}/auth`,post({wallet:creator.publicKey.toBase58(),message:challenge.data.auth.message,signature:signed(creator,challenge.data.auth.message)},cookie));
  assert.equal(authorized.response.status,200);assert.ok(authorized.data.room.sceneUrl);assert.equal(authorized.data.room.attribution.author,fixture.author);
  assert.ok(!JSON.stringify(authorized.data).includes("sourceUrl"));assert.ok(!JSON.stringify(authorized.data).includes("Secret city"));assert.ok(!JSON.stringify(authorized.data).includes(String(target.latE6)));
  await store.acceptGuess(code,{wallet:opponent.publicKey.toBase58(),latE6:0,lngE6:0,message:"private",signature:"private",acceptedAt:Date.now()},Date.now());
  const poll=await call(`/api/rooms/${code}`,{headers:{Cookie:cookie}});
  assert.equal(poll.data.room.players.find(player=>player.wallet===opponent.publicKey.toBase58()).locked,false);
  assert.equal((await call(`/api/scene/${room.scene_token}`)).response.status,404);
  assert.equal((await call(`/api/scene/${room.scene_token}`,{headers:{Cookie:cookie}})).response.status,200);
});

test("signed guesses bind room, wallet, deployment and coordinates, and cannot be replaced",async()=>{
  const player=Keypair.generate(),wallet=player.publicKey.toBase58(),code="EFGH45";
  await seededRoom(code,wallet);
  const challenge=await call(`/api/rooms/${code}/auth`,post({wallet})),cookie=cookieFrom(challenge.response);
  const auth=await call(`/api/rooms/${code}/auth`,post({wallet,message:challenge.data.auth.message,signature:signed(player,challenge.data.auth.message)},cookie));
  const {nonce,expiresAt}=auth.data.room.challenge;
  const message=formatGuessMessage(code,wallet,nonce,expiresAt,target,programId),signature=signed(player,message);
  const tampered=await call(`/api/rooms/${code}/guess`,post({wallet,...target,latE6:0,message,signature},cookie));assert.equal(tampered.response.status,401);
  const accepted=await call(`/api/rooms/${code}/guess`,post({wallet,...target,message,signature},cookie));assert.equal(accepted.data.accepted,true);assert.equal(accepted.data.room.ownLocked,true);
  const replay=await call(`/api/rooms/${code}/guess`,post({wallet,...target,message,signature},cookie));assert.equal(replay.data.acceptedAt,accepted.data.acceptedAt);
  const changed={latE6:0,lngE6:0},secondMessage=formatGuessMessage(code,wallet,nonce,expiresAt,changed,programId);
  const second=await call(`/api/rooms/${code}/guess`,post({wallet,...changed,message:secondMessage,signature:signed(player,secondMessage)},cookie));assert.equal(second.data.error,"GUESS_ALREADY_LOCKED");
  assert.equal((await store.guesses(code)).length,1);
});

test("D1 admission/deadline guards and settlement lease remain atomic under concurrency",async()=>{
  const code="JKLM67";await seededRoom(code,"creator","opponent");
  const base={wallet:"creator",latE6:0,lngE6:0,message:"first",signature:"signature",acceptedAt:Date.now()};
  const results=await Promise.all([store.acceptGuess(code,base,Date.now()),store.acceptGuess(code,{...base,latE6:1,message:"second"},Date.now())]);
  assert.equal(results.filter(result=>result.inserted).length,1);assert.equal((await store.guesses(code)).length,1);
  assert.equal((await store.acceptGuess(code,{...base,wallet:"stranger"},Date.now())).inserted,false);
  const now=Date.now(),leases=await Promise.all([store.takeLease(code,now),store.takeLease(code,now)]);assert.equal(leases.filter(Boolean).length,1);
  await store.patchRoom(code,{deadline:now});
  assert.equal((await store.acceptGuess(code,{...base,wallet:"opponent"},now)).inserted,false);
});

test("preview API and cross-origin mutation protection match browser integration",async()=>{
  const preview=await call("/api/preview-scene");assert.equal(preview.data.sceneUrl,"/api/preview-scene/image");
  assert.match((await call(preview.data.sceneUrl)).response.headers.get("content-type"),/image\/jpeg/);
  const cross=await call("/api/practice",{...post({}),headers:{"Content-Type":"application/json",Origin:"https://attacker.invalid"}});assert.equal(cross.response.status,403);
});

test("terminal receipt search rejects wrong PDA, failed/unconfirmed transactions and altered transcripts",async()=>{
  const roomAddress=Keypair.generate().publicKey,program=Keypair.generate().publicKey,otherRoom=Keypair.generate().publicKey;
  const transcript=new Uint8Array(32).fill(7),validData=new Uint8Array(106);validData[0]=3;validData.set(transcript,74);
  const altered=Uint8Array.from(validData);altered[74]=8;
  const transaction=(room,data,err=null)=>({meta:{err},transaction:{message:{instructions:[{programId:program,accounts:[room],data:bs58.encode(data)}]}}});
  const candidates=[
    {signature:"unconfirmed",err:null,confirmationStatus:"processed"},
    {signature:"failed",err:{InstructionError:[0,"Custom"]},confirmationStatus:"confirmed"},
    {signature:"other-room",err:null,confirmationStatus:"confirmed"},
    {signature:"altered-transcript",err:null,confirmationStatus:"confirmed"},
    {signature:"successful",err:null,confirmationStatus:"finalized"},
  ];
  const lookedUp=[];
  const connection={
    getSignaturesForAddress:async()=>candidates,
    getParsedTransaction:async(signature)=>{lookedUp.push(signature);return signature==="other-room"?transaction(otherRoom,validData):signature==="altered-transcript"?transaction(roomAddress,altered):transaction(roomAddress,validData);},
  };
  assert.equal(await findConfirmedTerminalReceipt({connection,programId:program,roomAddress,terminalState:3,transcriptDigest:transcript}),"successful");
  assert.deepEqual(lookedUp,["other-room","altered-transcript","successful"]);
  assert.equal(await findConfirmedTerminalReceipt({connection,programId:program,roomAddress,terminalState:4}),null);
});

test("already settled escrow restores the displayed receipt without submitting another payout",async()=>{
  for(const [code,lastError,expectedSignature] of [["PQRS23","TEST_TERMINAL_CONFIRMED","confirmed-settlement-receipt"],["TUVW45","TEST_TERMINAL_HISTORY_UNAVAILABLE",null]]){
    const wallet=Keypair.generate().publicKey.toBase58();await seededRoom(code,wallet,"opponent");
    const result=calculateResult(target,wallet,"opponent",1_000_000,[{wallet,...target,message:"signed",signature:"signed",acceptedAt:Date.now()-1000}]);
    await store.patchRoom(code,{status:"settling",deadline:Date.now()-1,last_error:lastError,result_json:JSON.stringify(result)});
    const reconciled=await call(`/api/rooms/${code}`);
    assert.equal(reconciled.response.status,200);assert.equal(reconciled.data.room.status,"finished");
    assert.equal(reconciled.data.room.result.signature,expectedSignature);
    assert.equal(reconciled.data.room.result.receiptStatus,expectedSignature?"confirmed":"unavailable");
    const stored=await store.room(code);assert.equal(stored.settlement_signature,expectedSignature);
    assert.equal(JSON.parse(stored.result_json).signature,expectedSignature);
    // A second poll observes the persisted terminal state; the mocked payout relay would throw if called.
    assert.equal((await call(`/api/rooms/${code}`)).data.room.result.receiptStatus,expectedSignature?"confirmed":"unavailable");
  }
});
