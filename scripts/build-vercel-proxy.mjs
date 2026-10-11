import {copyFile, mkdir, writeFile} from 'node:fs/promises';

// The game uses a Cloudflare Worker, D1, and a scheduled referee. Vercel serves
// its public domain through this origin; it does not execute the Worker bundle.
const backend='https://geo-duels-arcade.ddmpersonalworkspace.chatgpt.site';
await mkdir('.vercel/output/static',{recursive:true});
const rpcFunction='.vercel/output/functions/api/rpc.func';
await mkdir(rpcFunction,{recursive:true});
await copyFile(new URL('./devnet-rpc-relay.cjs',import.meta.url),`${rpcFunction}/index.cjs`);
await writeFile(`${rpcFunction}/.vc-config.json`,JSON.stringify({
  runtime:'nodejs22.x',handler:'index.cjs',launcherType:'Nodejs',maxDuration:15,shouldAddHelpers:false,
},null,2)+'\n');
await writeFile('.vercel/output/config.json',JSON.stringify({
  version:3,
  routes:[{src:'^/api/rpc/?$',dest:'/api/rpc'},{src:'/(.*)',dest:`${backend}/$1`}],
},null,2)+'\n');
console.log('Vercel devnet RPC function and Geo Duels backend routing prepared.');
