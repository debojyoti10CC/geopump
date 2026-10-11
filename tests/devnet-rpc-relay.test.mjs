import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Keypair,SystemProgram,Transaction} from '@solana/web3.js';
import relay from '../scripts/devnet-rpc-relay.cjs';

const {createRelayHandler}=relay;
const allowedOrigin='https://geopumpp.vercel.app';
const request=(id='request-1',method='getGenesisHash',params=[])=>({jsonrpc:'2.0',id,method,params});

async function call(handler,payload,options={}) {
  const raw=options.raw??JSON.stringify(payload);
  const req=Readable.from(options.chunks??[Buffer.from(raw)]);
  req.method=options.method??'POST';
  req.url=options.url??'/api/rpc';
  req.headers={'content-type':'application/json',...options.headers};
  const res={headers:{},setHeader(name,value){this.headers[name.toLowerCase()]=value;},end(body){this.body=JSON.parse(body);}};
  await handler(req,res);
  return res;
}

function successfulFetch(calls) {
  return async (url,options)=>{
    calls.push({url,options});
    const payload=JSON.parse(options.body);
    return new Response(JSON.stringify({jsonrpc:'2.0',id:payload.id,result:'devnet-result'}),{status:200});
  };
}

test('forwards valid JSON-RPC unchanged to the fixed official devnet endpoint',async()=>{
  const calls=[],handler=createRelayHandler({fetchImpl:successfulFetch(calls)});
  const payload=request(0,'getAccountInfo',['9knNnYeDQh1suoAx6tmhAgtmsYQvcoguTn6CkssZArsU',{encoding:'base64',commitment:'confirmed',minContextSlot:123}]);
  const response=await call(handler,payload,{headers:{origin:allowedOrigin,cookie:'private=must-not-forward',authorization:'must-not-forward'}});
  assert.equal(response.statusCode,200);
  assert.deepEqual(response.body,{jsonrpc:'2.0',id:0,result:'devnet-result'});
  assert.equal(response.headers['cache-control'],'no-store');
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,'https://api.devnet.solana.com');
  assert.deepEqual(JSON.parse(calls[0].options.body),payload);
  assert.deepEqual(calls[0].options.headers,{'Content-Type':'application/json','Accept':'application/json'});
  assert.equal(calls[0].options.redirect,'error');
  assert.ok(calls[0].options.signal instanceof AbortSignal);
});

test('server requests without Origin are allowed and disallowed origins preserve the request ID',async()=>{
  const calls=[],handler=createRelayHandler({fetchImpl:successfulFetch(calls)});
  assert.equal((await call(handler,request('server'))).statusCode,200);
  for (const origin of ['https://evil.example','https://geopumpp.vercel.app.evil.example','null']) {
    const response=await call(handler,request('blocked'),{headers:{origin}});
    assert.equal(response.statusCode,403);
    assert.equal(response.body.id,'blocked');
    assert.equal(response.body.error.code,-32003);
  }
  assert.equal(calls.length,1);
});

test('denies airdrops and unrelated RPC methods before any upstream call',async()=>{
  const calls=[],handler=createRelayHandler({fetchImpl:successfulFetch(calls)});
  for (const method of ['requestAirdrop','getProgramAccounts','setRpcUrl','unknown']) {
    const response=await call(handler,request(42,method));
    assert.equal(response.statusCode,403);
    assert.equal(response.body.id,42);
    assert.equal(response.body.error.code,-32601);
  }
  assert.equal(calls.length,0);
});

test('rejects invalid JSON-RPC, batches, notifications, and upstream URL injection',async()=>{
  const calls=[],handler=createRelayHandler({fetchImpl:successfulFetch(calls)});
  for (const payload of [
    [request()],null,{...request(),jsonrpc:'1.0'},{jsonrpc:'2.0',method:'getGenesisHash'},
    {...request(),id:{}},{...request(),params:{}},{...request(),upstream:'https://evil.example'},
    {...request(),params:new Array(101).fill('value')},
  ]) {
    const response=await call(handler,payload);
    assert.equal(response.statusCode,400);
    assert.equal(response.body.error.code,-32600);
  }
  const response=await call(handler,request('query'),{url:'/api/rpc?url=https://evil.example'});
  assert.equal(response.statusCode,400);
  assert.equal(response.body.id,'query');
  assert.equal(calls.length,0);
});

test('requires POST, JSON content type, and a bounded request body',async()=>{
  const calls=[],handler=createRelayHandler({fetchImpl:successfulFetch(calls)});
  const get=await call(handler,request(),{method:'GET'});
  assert.equal(get.statusCode,405);assert.equal(get.headers.allow,'POST');
  const type=await call(handler,request('type'),{headers:{'content-type':'text/plain'}});
  assert.equal(type.statusCode,415);assert.equal(type.body.id,'type');
  const oversized=await call(handler,request(),{chunks:[Buffer.alloc(33*1024,32),Buffer.alloc(33*1024,32)]});
  assert.equal(oversized.statusCode,413);assert.equal(oversized.body.id,null);
  const declared=await call(handler,request(),{headers:{'content-length':'65537'}});
  assert.equal(declared.statusCode,413);
  const malformed=await call(handler,null,{raw:'{broken json'});
  assert.equal(malformed.statusCode,400);assert.equal(malformed.body.error.code,-32700);
  assert.equal(calls.length,0);
});

test('only fully signed base64 transactions may be sent or simulated',async()=>{
  const calls=[],handler=createRelayHandler({fetchImpl:successfulFetch(calls)});
  const player=Keypair.generate(),referee=Keypair.generate();
  const transaction=new Transaction({feePayer:player.publicKey,recentBlockhash:Keypair.generate().publicKey.toBase58()});
  transaction.add(SystemProgram.transfer({fromPubkey:player.publicKey,toPubkey:referee.publicKey,lamports:1}));
  const unsigned=transaction.serialize({requireAllSignatures:false}).toString('base64');
  assert.equal((await call(handler,request('unsigned','sendTransaction',[unsigned,{encoding:'base64'}]))).statusCode,400);
  transaction.sign(player);
  const signed=transaction.serialize().toString('base64');
  assert.equal((await call(handler,request('send','sendTransaction',[signed,{encoding:'base64',skipPreflight:false}]))).statusCode,200);
  assert.equal((await call(handler,request('simulate','simulateTransaction',[signed,{encoding:'base64',sigVerify:true}]))).statusCode,200);
  for (const params of [[signed,{encoding:'base64',sigVerify:false}],[signed,{encoding:'base64',sigVerify:true,replaceRecentBlockhash:true}],[signed,{encoding:'base58'}],['malformed',{encoding:'base64'}]]) {
    assert.equal((await call(handler,request('invalid','simulateTransaction',params))).statusCode,400);
  }
  const partial=new Transaction({feePayer:player.publicKey,recentBlockhash:Keypair.generate().publicKey.toBase58()});
  partial.add({programId:SystemProgram.programId,keys:[{pubkey:player.publicKey,isSigner:true,isWritable:true},{pubkey:referee.publicKey,isSigner:true,isWritable:false}],data:Buffer.alloc(0)});
  partial.partialSign(player);
  assert.equal((await call(handler,request('partial','sendTransaction',[partial.serialize({requireAllSignatures:false}).toString('base64'),{encoding:'base64'}]))).statusCode,400);
  assert.equal(calls.length,2);
});

test('upstream rate and HTTP failures become JSON errors with the original ID',async()=>{
  for (const [status,expectedStatus,code] of [[429,429,-32005],[503,502,-32000],[403,502,-32000]]) {
    const handler=createRelayHandler({fetchImpl:async()=>new Response('not JSON',{status})});
    const response=await call(handler,request('upstream-error'));
    assert.equal(response.statusCode,expectedStatus);
    assert.equal(response.body.id,'upstream-error');
    assert.equal(response.body.error.code,code);
  }
});

test('upstream JSON-RPC errors are preserved, while wrong IDs and malformed responses are rejected',async()=>{
  const upstreamError={jsonrpc:'2.0',id:7,error:{code:-32002,message:'Transaction simulation failed',data:{err:'InvalidSignature'}}};
  const forwarded=await call(createRelayHandler({fetchImpl:async()=>new Response(JSON.stringify(upstreamError))}),request(7));
  assert.equal(forwarded.statusCode,200);assert.deepEqual(forwarded.body,upstreamError);
  for (const raw of ['not JSON',JSON.stringify({jsonrpc:'2.0',id:'wrong',result:null}),JSON.stringify({jsonrpc:'2.0',id:7,result:null,error:{code:1,message:'bad'}})]) {
    const response=await call(createRelayHandler({fetchImpl:async()=>new Response(raw)}),request(7));
    assert.equal(response.statusCode,502);assert.equal(response.body.id,7);
  }
});

test('fetch exceptions and aborted upstream calls retain IDs without exposing exception details',async()=>{
  const unavailable=await call(createRelayHandler({fetchImpl:async()=>{throw new Error('private internal detail');}}),request('network'));
  assert.equal(unavailable.statusCode,502);assert.equal(unavailable.body.id,'network');
  assert.doesNotMatch(JSON.stringify(unavailable.body),/private internal/);
  let signal;
  const handler=createRelayHandler({timeoutMs:10,fetchImpl:async(_url,options)=>{
    signal=options.signal;
    return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));
  }});
  const timeout=await call(handler,request('timed-out'));
  assert.equal(timeout.statusCode,504);assert.equal(timeout.body.id,'timed-out');
  assert.equal(signal.aborted,true);assert.match(timeout.body.error.message,/timed out/);
});

test('proxy build produces a Node 22 function before the existing Sites catchall',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'geopump-rpc-build-'));
  try {
    const built=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/build-vercel-proxy.mjs',import.meta.url))],{cwd:directory,encoding:'utf8'});
    assert.equal(built.status,0,built.stderr);
    const config=JSON.parse(await readFile(join(directory,'.vercel/output/config.json'),'utf8'));
    assert.deepEqual(config.routes[0],{src:'^/api/rpc/?$',dest:'/api/rpc'});
    assert.equal(config.routes[1].dest,'https://geo-duels-arcade.ddmpersonalworkspace.chatgpt.site/$1');
    const functionDirectory=join(directory,'.vercel/output/functions/api/rpc.func');
    const runtime=JSON.parse(await readFile(join(functionDirectory,'.vc-config.json'),'utf8'));
    assert.equal(runtime.runtime,'nodejs22.x');assert.equal(runtime.launcherType,'Nodejs');assert.equal(runtime.handler,'index.cjs');
    assert.equal(runtime.shouldAddHelpers,false);
    assert.equal(await readFile(join(functionDirectory,'index.cjs'),'utf8'),await readFile(new URL('../scripts/devnet-rpc-relay.cjs',import.meta.url),'utf8'));
  } finally {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir())+sep));
    await rm(directory,{recursive:true,force:true});
  }
});
