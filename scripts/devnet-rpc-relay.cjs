'use strict';

const UPSTREAM='https://api.devnet.solana.com';
const ALLOWED_ORIGIN='https://geopumpp.vercel.app';
const BODY_LIMIT=64*1024;
const RESPONSE_LIMIT=2*1024*1024;
const METHODS=new Set([
  'getAccountInfo','getBalance','getBlockHeight','getFeeForMessage','getGenesisHash',
  'getLatestBlockhash','getMinimumBalanceForRentExemption','getMultipleAccounts',
  'getSignatureStatuses','getSignaturesForAddress','getSlot','getTransaction',
  'getVersion','isBlockhashValid','sendTransaction','simulateTransaction',
]);
const isObject=value=>value!==null && typeof value==='object' && !Array.isArray(value);
const validId=value=>value===null || (typeof value==='string' && value.length<=128) || Number.isSafeInteger(value);

function failure(res,status,id,code,message) {
  res.statusCode=status;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  res.end(JSON.stringify({jsonrpc:'2.0',id,error:{code,message}}));
}

function readBody(req) {
  return new Promise((resolve,reject)=>{
    let size=0,tooLarge=false;
    const chunks=[];
    req.on('data',chunk=>{
      if (tooLarge)return;
      const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
      size+=bytes.length;
      if (size>BODY_LIMIT) { tooLarge=true;chunks.length=0;reject(Object.assign(new Error('Request body is too large'),{status:413}));return; }
      chunks.push(bytes);
    });
    req.on('end',()=>resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error',reject);
    req.on('aborted',()=>reject(new Error('Request body was interrupted')));
  });
}

// Solana's wire transaction starts with a compact signature count and 64-byte
// signatures. No unsigned or partially signed transactions enter the relay.
function signedTransaction(params) {
  const encoded=params[0],config=params[1];
  if (params.length<1 || params.length>2 || typeof encoded!=='string' || encoded.length>1644 ||
      !isObject(config) || config.encoding!=='base64' || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))return false;
  const bytes=Buffer.from(encoded,'base64');
  if (bytes.length>1232 || bytes.toString('base64')!==encoded)return false;
  let count=0,offset=0;
  for (let shift=0;shift<=14;shift+=7) {
    if (offset>=bytes.length)return false;
    const byte=bytes[offset++];
    count|=(byte&127)<<shift;
    if (!(byte&128))break;
    if (shift===14)return false;
  }
  if (count<1 || count>19 || offset+count*64+4>bytes.length)return false;
  for (let index=0;index<count;index++) {
    const start=offset+index*64;
    if (bytes.subarray(start,start+64).every(byte=>byte===0))return false;
  }
  const messageOffset=offset+count*64;
  const version=bytes[messageOffset];
  if (version&128 && version!==128)return false;
  const header=messageOffset+(version&128?1:0);
  return bytes[header]===count;
}

function createRelayHandler({fetchImpl=globalThis.fetch,timeoutMs=8000}={}) {
  return async function relay(req,res) {
    if (req.method!=='POST') { res.setHeader('Allow','POST');failure(res,405,null,-32600,'Use POST for devnet JSON-RPC requests');return; }
    let payload,id=null;
    try {
      const length=req.headers['content-length'];
      if (length && (!/^\d+$/.test(length) || Number(length)>BODY_LIMIT)) { req.resume();failure(res,413,null,-32600,'Request body is too large');return; }
      const raw=await readBody(req);
      try { payload=JSON.parse(raw); } catch { failure(res,400,null,-32700,'Invalid JSON');return; }
      if (isObject(payload) && Object.hasOwn(payload,'id') && validId(payload.id))id=payload.id;
      const origin=req.headers.origin;
      if (origin!==undefined && origin!==ALLOWED_ORIGIN) { failure(res,403,id,-32003,'This RPC relay only accepts the game website origin');return; }
      if (!/^application\/json(?:\s*;.*)?$/i.test(req.headers['content-type']||'')) { failure(res,415,id,-32600,'Use application/json');return; }
      const url=new URL(req.url||'/api/rpc',ALLOWED_ORIGIN);
      if (url.search || !isObject(payload) || Object.keys(payload).some(key=>!['jsonrpc','id','method','params'].includes(key)) ||
          payload.jsonrpc!=='2.0' || !Object.hasOwn(payload,'id') || !validId(payload.id) || typeof payload.method!=='string' ||
          (payload.params!==undefined && (!Array.isArray(payload.params) || payload.params.length>100))) {
        failure(res,400,id,-32600,'Invalid JSON-RPC request');return;
      }
      if (!METHODS.has(payload.method)) { failure(res,403,id,-32601,'RPC method is not allowed');return; }
      const params=payload.params||[];
      if (['sendTransaction','simulateTransaction'].includes(payload.method) && (!signedTransaction(params) ||
          (payload.method==='simulateTransaction' && (params[1].sigVerify!==true || params[1].replaceRecentBlockhash===true)))) {
        failure(res,400,id,-32602,'A fully signed base64 transaction is required; simulation must verify signatures');return;
      }
    } catch (error) { failure(res,error.status||400,id,-32600,error.status===413?'Request body is too large':'Could not read the JSON-RPC request');return; }

    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try {
      const upstream=await fetchImpl(UPSTREAM,{
        method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},
        body:JSON.stringify(payload),signal:controller.signal,redirect:'error',
      });
      if (!upstream.ok) {
        failure(res,upstream.status===429?429:502,id,upstream.status===429?-32005:-32000,
          upstream.status===429?'Devnet RPC rate limit reached; try again shortly':'Devnet RPC is unavailable');return;
      }
      const raw=await upstream.text();
      if (Buffer.byteLength(raw)>RESPONSE_LIMIT) { failure(res,502,id,-32000,'Devnet RPC response is too large');return; }
      let result;
      try { result=JSON.parse(raw); } catch { failure(res,502,id,-32000,'Devnet RPC returned invalid JSON');return; }
      if (!isObject(result) || result.jsonrpc!=='2.0' || result.id!==id || Object.hasOwn(result,'result')===Object.hasOwn(result,'error') ||
          (Object.hasOwn(result,'error') && (!isObject(result.error) || !Number.isInteger(result.error.code) || typeof result.error.message!=='string'))) {
        failure(res,502,id,-32000,'Devnet RPC returned an invalid response');return;
      }
      res.statusCode=200;
      res.setHeader('Content-Type','application/json; charset=utf-8');
      res.setHeader('Cache-Control','no-store');
      res.end(JSON.stringify(result));
    } catch {
      failure(res,controller.signal.aborted?504:502,id,-32000,controller.signal.aborted?'Devnet RPC request timed out':'Devnet RPC is unavailable');
    } finally { clearTimeout(timer); }
  };
}

module.exports=createRelayHandler();
module.exports.createRelayHandler=createRelayHandler;
