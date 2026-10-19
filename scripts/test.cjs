
'use strict';
const path=require('node:path'), {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
for(const args of [
 [require.resolve('mocha/bin/mocha'), '--require', path.join(root,'tests/setup.cjs'), 'tests/test-*.js'],
 ['--test', 'tests/conference-security.cjs', 'tests/kaigi-security.cjs'],
]) {
 const result=spawnSync(process.execPath,args,{cwd:root,stdio:'inherit',env:{...process.env,CONFERENCE_SOURCE:root}});
 if(result.error)throw result.error;
 if(result.status!==0)process.exit(result.status||1);
}
