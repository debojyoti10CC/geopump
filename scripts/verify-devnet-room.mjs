import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import nacl from 'tweetnacl';
import {Connection,Keypair,SystemProgram,Transaction,sendAndConfirmTransaction} from '@solana/web3.js';

const base=process.env.GEO_TEST_ORIGIN||'http://127.0.0.1:4173';
const connection=new Connection('https://api.devnet.solana.com','confirmed');
const referee=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile('.secrets/referee.json','utf8'))));
const creator=Keypair.generate(),joiner=Keypair.generate();
const cookies=new Map(),receipts=[];
const sign=(key,message)=>Buffer.from(nacl.sign.detached(new TextEncoder().encode(message),key.secretKey)).toString('base64');
async function call(key,path,body){
  const response=await fetch(`${base}${path}`,{method:body?'POST':'GET',headers:{...(body?{'content-type':'application/json',origin:new URL(base).origin}:{}),cookie:cookies.get(key.publicKey.toBase58())||''},body:body?JSON.stringify(body):undefined});
  const set=response.headers.get('set-cookie');if(set)cookies.set(key.publicKey.toBase58(),set.split(';')[0]);
  const data=await response.json();assert.equal(response.ok,true,JSON.stringify(data));return data;
}
async function deposit(key,data){
  const tx=Transaction.from(Buffer.from(data.transaction,'base64'));tx.partialSign(key);
  const signature=await connection.sendRawTransaction(tx.serialize());await connection.confirmTransaction(signature,'confirmed');
  receipts.push({action:key===creator?'create':'join',signature});
  return (await call(key,`/api/rooms/${data.room.code}/confirm`,{wallet:key.publicKey.toBase58(),signature,authMessage:data.auth.message,authSignature:sign(key,data.auth.message)})).room;
}
assert.equal((await connection.getGenesisHash()),'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG');
const config=await call(creator,'/api/config');assert.equal(config.escrowReady,true,'Escrow must be deployed and referee funded');
const funding=await sendAndConfirmTransaction(connection,new Transaction().add(SystemProgram.transfer({fromPubkey:referee.publicKey,toPubkey:creator.publicKey,lamports:8000000}),SystemProgram.transfer({fromPubkey:referee.publicKey,toPubkey:joiner.publicKey,lamports:2000000})),[referee]);
receipts.push({action:'test-wallet-funding',signature:funding});
const stake='1000001';
let room=await deposit(creator,await call(creator,'/api/rooms',{wallet:creator.publicKey.toBase58(),stakeLamports:stake}));
console.log(`Created real devnet room ${room.code}`);
room=await deposit(joiner,await call(joiner,`/api/rooms/${room.code}/join`,{wallet:joiner.publicKey.toBase58()}));
for(let n=0;room.status!=='active'&&n<15;n++){await new Promise(r=>setTimeout(r,1000));room=(await call(creator,`/api/rooms/${room.code}?wallet=${creator.publicKey}`)).room;}
assert.equal(room.status,'active');assert.equal(room.result,null);
const privateScene=await fetch(`${base}${room.sceneUrl}`,{headers:{cookie:cookies.get(creator.publicKey.toBase58())||''}});
assert.equal(privateScene.status,200,'Authenticated panorama must work through the public host');
assert.match(privateScene.headers.get('content-type')||'',/^image\//);
assert.equal((await fetch(`${base}${room.sceneUrl}`)).status,404,'Panorama must remain private without the room cookie');
const guesses=[[creator,0,0],[joiner,45123456,90123456]];
for(const[key,latE6,lngE6]of guesses){
  const own=(await call(key,`/api/rooms/${room.code}?wallet=${key.publicKey}`)).room,c=own.challenge;
  assert.ok(c);const message=['Geo Duels guess v1','Network: devnet',`Program: ${c.programId}`,'RulesVersion: 1',`Room: ${room.code}`,`Wallet: ${key.publicKey}`,`Nonce: ${c.nonce}`,`LatitudeE6: ${latE6}`,`LongitudeE6: ${lngE6}`,`ExpiresAt: ${c.expiresAt}`].join('\n');
  const locked=await call(key,`/api/rooms/${room.code}/guess`,{wallet:key.publicKey.toBase58(),latE6,lngE6,message,signature:sign(key,message)});
  assert.equal(locked.room.ownLocked,true);assert.equal(locked.room.result,null);
}
const before=[await connection.getBalance(creator.publicKey),await connection.getBalance(joiner.publicKey)];
for(let n=0;n<60&&room.status!=='finished';n++){await new Promise(r=>setTimeout(r,1000));room=(await call(creator,`/api/rooms/${room.code}?wallet=${creator.publicKey}`)).room;}
assert.equal(room.status,'finished');assert.ok(room.result.signature);assert.equal(room.result.guesses.length,2);
const after=[await connection.getBalance(creator.publicKey),await connection.getBalance(joiner.publicKey)];
const expected=[creator,joiner].map(k=>room.result.tie?Number(stake):room.result.winnerWallet===k.publicKey.toBase58()?Number(stake)*2:0);
assert.deepEqual(after.map((amount,i)=>amount-before[i]),expected,'Payouts must match wallet balance changes exactly');
const payout=await connection.getSignatureStatuses([room.result.signature]);assert.equal(payout.value[0]?.err,null);
receipts.push({action:'payout',signature:room.result.signature});
await writeFile('chain/devnet-game-receipt.json',JSON.stringify({network:'devnet',programId:config.programId,roomCode:room.code,stakeLamports:stake,potLamports:(BigInt(stake)*2n).toString(),creator:creator.publicKey.toBase58(),joiner:joiner.publicKey.toBase58(),winner:room.result.winnerWallet,actualPayoutLamports:expected.map(String),signedGuesses:2,targetHiddenDuringRound:true,confirmedPayout:true,receipts,checkedAt:new Date().toISOString()},null,2));
// Return unused test balances; escrow rent remains with its payer until close becomes eligible.
for(const key of[creator,joiner]){const remaining=await connection.getBalance(key.publicKey);if(remaining>5000)await sendAndConfirmTransaction(connection,new Transaction().add(SystemProgram.transfer({fromPubkey:key.publicKey,toPubkey:referee.publicKey,lamports:remaining-5000})),[key]);}
console.log(`Confirmed devnet duel: two deposits, two signed guesses, exact ${Number(stake)*2} lamport pot and payout ${room.result.signature}`);
