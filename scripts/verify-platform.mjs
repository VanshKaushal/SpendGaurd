import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const root=resolve(import.meta.dirname,'..');const npm=process.env.npm_execpath;
if(!npm)throw Error('Run npm run verify');mkdirSync(resolve(root,'.spendguard/qa'),{recursive:true});
function run(args){const r=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',windowsHide:true,timeout:240000,maxBuffer:10*1024*1024});if(r.status!==0)throw Error(`${args.join(' ')} failed:\n${r.stderr}\n${r.stdout}`);return r.stdout;}
run([npm,'run','typecheck']);console.log('Typecheck passed');
run([npm,'test','--','--coverage','--reporter=json','--outputFile=.spendguard/qa/platform-tests.json']);
const tests=JSON.parse(readFileSync(resolve(root,'.spendguard/qa/platform-tests.json'),'utf8'));console.log(`${tests.numPassedTests} core tests passed`);
const apiOutput=run(['--test','site-worker/test/api.test.mjs']);const apiTests=Number(apiOutput.match(/tests\s+(\d+)/)?.[1]);if(!apiTests)throw Error('Could not count API tests');
run([npm,'run','build']);console.log('Build passed');
const audit=JSON.parse(run([npm,'audit','--json']));if(audit.metadata.vulnerabilities.total!==0)throw Error('Dependency advisories remain');console.log('Full dependency audit passed');
run([npm,'run','benchmark']);console.log('Full-path benchmark captured');
run([npm,'run','release:verify']);console.log('Clean package install passed');
const release=JSON.parse(readFileSync(resolve(root,'release/verification.json'),'utf8'));
const file=readFileSync(release.archive);const version=JSON.parse(readFileSync(resolve(root,'package.json'),'utf8')).version;
const result={version,checkedAt:new Date().toISOString(),node:process.version,platform:process.platform,typecheck:true,build:true,
 coreTests:{passed:tests.numPassedTests,failed:tests.numFailedTests},pilotApiTests:apiTests,coverage:JSON.parse(readFileSync(resolve(root,'coverage/coverage-summary.json'),'utf8')).total,dependencyVulnerabilities:audit.metadata.vulnerabilities,
 cleanInstall:release.cleanInstall,archive:`spend-guard-${version}.tgz`,archiveSha256:createHash('sha256').update(file).digest('hex'),
 benchmark:JSON.parse(readFileSync(resolve(root,'release/benchmark.json'),'utf8')),walletPayments:'deferred by owner',pilotCheckout:'deferred by owner',scope:'Local single-agent/single-repository developer preview. Synthetic provider callbacks in tests/benchmarks. No customer savings, adoption or settlement claim.'};
writeFileSync(resolve(root,'release/platform-verification.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
