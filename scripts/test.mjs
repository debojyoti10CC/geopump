import {readdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {build} from 'esbuild';

// Bundle extensionless TypeScript imports for Node's test runner; generated files
// stay in the ignored work directory and never enter the deployment archive.
await build({
  entryPoints:['chain/client.test.ts','chain/referee.test.ts'],
  outdir:'work/chain-tests',bundle:true,packages:'external',platform:'node',
  format:'esm',target:'node22',outExtension:{'.js':'.mjs'},
});
const tests=(await readdir('tests')).filter(name=>name.endsWith('.test.mjs')).sort().map(name=>`tests/${name}`);
const child=spawn(process.execPath,['--experimental-strip-types','--test','--test-concurrency=2',...tests,'work/chain-tests/client.test.mjs','work/chain-tests/referee.test.mjs'],{stdio:'inherit'});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.on('exit',(code,signal)=>{process.exitCode=signal?1:code??1;});
