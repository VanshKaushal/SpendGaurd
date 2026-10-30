import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { SpendGuard } from '../dist/packages/mcp-proxy/src/guard.js';
import { Ledger } from '../dist/packages/mcp-proxy/src/ledger.js';
import { FixedApprovalChannel } from '../dist/packages/mcp-proxy/src/approval.js';

const results=[];
for(const history of [0,100,1000]) {
 const dir=mkdtempSync(join(tmpdir(),'spendguard-benchmark-'));const config=join(dir,'config.yaml');let ledger;
 try {
  for(let i=0;i<20;i++)writeFileSync(join(dir,`source-${i}.txt`),'benchmark content\n'.repeat(20));
  writeFileSync(config,'task_id: benchmark\nrepo_path: .\ntracked_paths: [.]\ntask_budget_usd: 100000\nmax_calls_without_progress: 100000\nprovider_allowlist: [benchmark]\nprovider: {id: benchmark, transport: stdio, command: node}\ntool_prices_usd: {search: 0.01}\n');
  ledger=new Ledger(join(dir,'ledger.db'));const guard=new SpendGuard(config,ledger,new FixedApprovalChannel(true));
  // Seed synthetic historical records through real transactional ledger writes. Only complete live calls below are timed.
  for(let i=0;i<history;i++){
   const id=randomUUID(),timestamp=new Date().toISOString();
   ledger.recordRequest({id,taskId:'benchmark',repoId:'local-repo',agentId:'mcp:local',sessionId:'seed',tool:'search',provider:'benchmark',paramsHash:`seed-${i}`,fingerprint:`seed-${i}`,nearDuplicateKey:`seed-${i}`,repoStateHash:'historical-state',price:0.01,decision:'allow',reasonCode:'R7_ALLOWED',reason:'Synthetic benchmark history',approvalGranted:null,configHash:'',heartbeatPresent:true,timestamp});
   ledger.recordOutcome({requestId:id,repoStateAfterHash:'historical-state',testsBefore:null,testsAfter:null,diffSummary:'Synthetic benchmark history',outputHash:'synthetic',judgedUseful:null,testAssertionsBefore:0,testAssertionsAfter:0,testFilesHashAfter:'synthetic',suspiciousTestDelta:false,providerSucceeded:true,timestamp});
  }
  const samples=[];for(let i=0;i<20;i++){const start=performance.now();const r=await guard.call({tool:'search',params:{query:`sample-${i}`}},async()=>({ok:true}));if(!r.forwarded||r.error)throw Error('Unexpected benchmark denial');samples.push(performance.now()-start);}
  samples.sort((a,b)=>a-b);results.push({priorRequests:history,files:20,samples:20,p50Ms:+samples[9].toFixed(2),p95Ms:+samples[18].toFixed(2),rssBytes:process.memoryUsage().rss,chainValid:ledger.verifyChain().valid});
 }finally{ledger?.close();rmSync(dir,{recursive:true,force:true});}
}
const report={measuredAt:new Date().toISOString(),node:process.version,platform:process.platform,arch:process.arch,repositoryKind:'Filesystem fixture without Git metadata',scope:'Complete local guard.call with SQLite FULL durability, integrity verification, repository evidence, fixed synthetic approval and a no-network provider callback. Synthetic history is seeded through hash-chained ledger writes. Excludes Git process overhead, provider latency, human wait and wallet payments. Single run; no production throughput claim.',results};
mkdirSync(resolve('release'),{recursive:true});writeFileSync(resolve('release/benchmark.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
