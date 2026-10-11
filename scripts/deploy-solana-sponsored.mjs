// Mirrors solana-foundation/kora crates/kora-deploy loader-v3 deployment.
// Uses Node's HTTPS transport for Windows environments where the native CLI stalls.
import { readFile,writeFile } from 'node:fs/promises';
import { Connection,Keypair,PublicKey,SystemProgram,Transaction,TransactionInstruction,SYSVAR_RENT_PUBKEY,SYSVAR_CLOCK_PUBKEY } from '@solana/web3.js';

const endpoint='https://deployer.devnet.solana.com';
const connection=new Connection('https://api.devnet.solana.com','confirmed');
const owner=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile('.secrets/deployer.json','utf8'))));
const loader=new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
const registry=new PublicKey('CPoBCCbvawmR2S6joHjXgfFkh9pGqzSixBe2BaBwbVkx');
const binary=await readFile('chain/deploy/geo_duels.so');
const rpc=async(method,params)=>{
  const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(45000)});
  if(!response.ok)throw new Error(`Sponsor HTTP ${response.status}`);
  const data=await response.json(); if(data.error)throw new Error(`Sponsor: ${JSON.stringify(data.error)}`);
  return data.result;
};
const payer=new PublicKey((await rpc('getPayerSigner',[])).signer_address);
const meta=(pubkey,isWritable=false,isSigner=false)=>({pubkey,isWritable,isSigner});
const ix=(data,keys)=>new TransactionInstruction({programId:loader,data,keys});
const tag=(n)=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;};
const userId='geo-duels-20261011';
const receipts=[];
let blockhashRequest=null,blockhashAt=0;
const confirmations=new Map();let polling=false;
function confirmation(signature){
  const promise=new Promise((resolve,reject)=>confirmations.set(signature,{resolve,reject,expires:Date.now()+90000}));
  if(!polling){polling=true;void(async()=>{
    try{
      while(confirmations.size){
        const signatures=[...confirmations.keys()],statuses=(await connection.getSignatureStatuses(signatures)).value;
        statuses.forEach((status,index)=>{const signature=signatures[index],pending=confirmations.get(signature);if(!pending)return;
          if(status?.err){pending.reject(new Error(`Transaction rejected: ${JSON.stringify(status.err)}`));confirmations.delete(signature);}
          else if(status?.confirmationStatus==='confirmed'||status?.confirmationStatus==='finalized'){pending.resolve(signature);confirmations.delete(signature);}
          else if(Date.now()>pending.expires){pending.reject(new Error(`Confirmation timed out: ${signature}`));confirmations.delete(signature);}
        });
        if(confirmations.size)await new Promise(r=>setTimeout(r,1000));
      }
    }catch(error){for(const pending of confirmations.values())pending.reject(error);confirmations.clear();}
    finally{polling=false;}
  })();}
  return promise;
}
async function send(instructions,signers=[]){
  if(!blockhashRequest||Date.now()-blockhashAt>20000){blockhashAt=Date.now();blockhashRequest=connection.getLatestBlockhash('confirmed');}
  const {blockhash}=await blockhashRequest;
  const tx=new Transaction({feePayer:payer,recentBlockhash:blockhash}).add(...instructions);
  if(signers.length)tx.partialSign(...signers);
  const serialized=tx.serialize({requireAllSignatures:false,verifySignatures:false}).toString('base64');
  let result;
  try {result=await rpc('signAndSendTransaction',{transaction:serialized,user_id:userId});}
  catch(error){
    const simulation=await fetch('https://api.devnet.solana.com',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'simulateTransaction',params:[serialized,{encoding:'base64',sigVerify:false,commitment:'confirmed'}]})}).then(r=>r.json());
    console.error('Deployment simulation:',JSON.stringify(simulation.result?.value));throw error;
  }
  const sig=result.signature; if(!sig)throw new Error('Sponsor returned no receipt');
  await confirmation(sig);receipts.push(sig);return sig;
}
// Persist only public addresses/receipts. The sponsor is buffer authority and pays all rent.
const program=Keypair.generate(),buffer=Keypair.generate();
const bufferAddress=process.argv[2]?new PublicKey(process.argv[2]):buffer.publicKey;
const programData=PublicKey.findProgramAddressSync([program.publicKey.toBuffer()],loader)[0];
console.log(`Deploying ${binary.length} bytes with official devnet sponsor`);
console.log(`Upload buffer: ${bufferAddress.toBase58()}`);
let uploaded=Buffer.alloc(binary.length);
if(process.argv[2]){
  const stored=await connection.getAccountInfo(bufferAddress);
  if(!stored?.owner.equals(loader)||stored.data.length!==binary.length+37||!stored.data.subarray(5,37).equals(payer.toBuffer()))throw new Error('Resumed buffer has different terms or sponsor authority');
  uploaded=stored.data.subarray(37);
}else await send([SystemProgram.createAccount({fromPubkey:payer,newAccountPubkey:bufferAddress,lamports:await connection.getMinimumBalanceForRentExemption(binary.length+37),space:binary.length+37,programId:loader}),ix(tag(0),[meta(bufferAddress,true),meta(payer)])],[buffer]);
const pending=[];
for(let offset=0;offset<binary.length;offset+=900)if(!uploaded.subarray(offset,offset+900).equals(binary.subarray(offset,offset+900)))pending.push(offset);
let next=0,completed=0;
await Promise.all(Array.from({length:4},async()=>{
  while(next<pending.length){
    const offset=pending[next++],chunk=binary.subarray(offset,offset+900),header=Buffer.alloc(16);header.writeUInt32LE(1,0);header.writeUInt32LE(offset,4);header.writeBigUInt64LE(BigInt(chunk.length),8);
    await send([ix(Buffer.concat([header,chunk]),[meta(bufferAddress,true),meta(payer,false,true)])]);
    completed++;if(completed%20===0||completed===pending.length)console.log(`Confirmed ${completed}/${pending.length} remaining upload chunks`);
  }
}));
if(!(await connection.getAccountInfo(bufferAddress)).data.subarray(37).equals(binary))throw new Error('Upload digest mismatch');
const deployData=Buffer.alloc(12);deployData.writeUInt32LE(2);deployData.writeBigUInt64LE(BigInt(binary.length),4);
const entry=PublicKey.findProgramAddressSync([program.publicKey.toBuffer()],registry)[0];
const signature=await send([
  SystemProgram.createAccount({fromPubkey:payer,newAccountPubkey:program.publicKey,lamports:await connection.getMinimumBalanceForRentExemption(36),space:36,programId:loader}),
  ix(deployData,[meta(payer,true,true),meta(programData,true),meta(program.publicKey,true),meta(bufferAddress,true),meta(SYSVAR_RENT_PUBKEY),meta(SYSVAR_CLOCK_PUBKEY),meta(SystemProgram.programId),meta(payer,false,true)]),
  new TransactionInstruction({programId:registry,data:Buffer.from([0]),keys:[meta(payer,true,true),meta(program.publicKey,false,true),meta(owner.publicKey,false,true),meta(entry,true),meta(SystemProgram.programId)]})
],[program,owner]);
await writeFile('chain/sponsored-deployment.json',JSON.stringify({network:'devnet',programId:program.publicKey.toBase58(),programDataId:programData.toBase58(),upgradeAuthority:payer.toBase58(),registeredUpgradeOwner:owner.publicKey.toBase58(),sponsor:endpoint,idleRetentionDays:7,signature,receipts,checkedAt:new Date().toISOString()},null,2));
console.log(`Deployed program: ${program.publicKey.toBase58()}\nReceipt: ${signature}`);
