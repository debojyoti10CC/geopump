import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair, SystemProgram, Transaction} from '@solana/web3.js';
import {sendDeposit} from '../lib/wallet.ts';

test('wallet signing broadcasts through the game RPC and preserves other signatures', async()=>{
  const player=Keypair.generate(),referee=Keypair.generate();
  const tx=new Transaction({feePayer:player.publicKey,recentBlockhash:Keypair.generate().publicKey.toBase58()});
  tx.add({programId:SystemProgram.programId,keys:[{pubkey:player.publicKey,isSigner:true,isWritable:true},{pubkey:referee.publicKey,isSigner:true,isWritable:false}],data:Buffer.alloc(0)});
  tx.partialSign(referee);
  let broadcast=false;
  const signature='confirmed-test-signature';
  const provider={
    signAndSendTransaction:async()=>{throw Error('Wallet-selected network must not broadcast this deposit');},
    signTransaction:async transaction=>{transaction.partialSign(player);return transaction;},
  };
  const connection={
    sendRawTransaction:async bytes=>{const signed=Transaction.from(bytes);assert.equal(signed.verifySignatures(),true);broadcast=true;return signature;},
    getSignatureStatuses:async signatures=>{assert.deepEqual(signatures,[signature]);return {value:[{err:null,confirmationStatus:'confirmed'}]};},
  };
  const encoded=tx.serialize({requireAllSignatures:false}).toString('base64');
  assert.equal(await sendDeposit(provider,encoded,'https://api.devnet.solana.com',connection),signature);
  assert.equal(broadcast,true);
});

test('a send-only wallet cannot silently select another chain',async()=>{
  const player=Keypair.generate();
  const tx=new Transaction({feePayer:player.publicKey,recentBlockhash:Keypair.generate().publicKey.toBase58()}).add(SystemProgram.transfer({fromPubkey:player.publicKey,toPubkey:Keypair.generate().publicKey,lamports:1}));
  await assert.rejects(sendDeposit({signAndSendTransaction:async()=>{throw Error('must not send');}},tx.serialize({requireAllSignatures:false}).toString('base64'),'https://api.devnet.solana.com',{}),/must support transaction signing/);
});
