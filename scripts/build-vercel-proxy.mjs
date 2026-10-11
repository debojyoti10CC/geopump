import {mkdir, writeFile} from 'node:fs/promises';

// The game uses a Cloudflare Worker, D1, and a scheduled referee. Vercel serves
// its public domain through this origin; it does not execute the Worker bundle.
const backend='https://geo-duels-arcade.ddmpersonalworkspace.chatgpt.site';
await mkdir('.vercel/output/static',{recursive:true});
await writeFile('.vercel/output/config.json',JSON.stringify({
  version:3,
  routes:[{src:'/(.*)',dest:`${backend}/$1`}],
},null,2)+'\n');
console.log('Vercel routing prepared for the deployed Geo Duels backend.');
