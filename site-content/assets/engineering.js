const row=(values)=>{const tr=document.createElement('tr');for(const value of values){const td=document.createElement('td');td.textContent=String(value);tr.append(td);}return tr;};
try {
 const response=await fetch('/proof.json',{cache:'no-store'});if(!response.ok)throw Error('Release proof unavailable');const p=await response.json();
 document.getElementById('proof-status').textContent=`v${p.version} · checked ${new Date(p.checkedAt).toLocaleString()} · ${p.node} / ${p.platform}`;
 const checks=[['Core tests',`${p.coreTests.passed} passed; ${p.coreTests.failed} failed`],['Pilot enquiry API',`${p.pilotApiTests} tests passed`],['Typecheck / build',p.typecheck&&p.build?'Passed':'Incomplete'],['Dependency audit',`${p.dependencyVulnerabilities.total} reported vulnerabilities, including development tooling`],['Source line coverage',`${p.coverage.lines.pct}% (subprocess coverage may be undercounted; integration tests run separately)`],['Clean package install',p.cleanInstall?'Passed with registry access':'Incomplete'],['Wallet and checkout', 'Deferred by owner'],['Package SHA-256',p.archiveSha256]];
 document.getElementById('checks').replaceChildren(...checks.map(row));
 document.getElementById('benchmark').replaceChildren(...p.benchmark.results.map(r=>row([r.priorRequests,`${r.p50Ms} ms`,`${r.p95Ms} ms`,r.samples])));
 document.getElementById('benchmark-context').textContent=`${p.benchmark.node} · ${p.benchmark.platform}/${p.benchmark.arch} · 20 tracked files · ${p.benchmark.repositoryKind} · ${p.benchmark.measuredAt}`;
}catch(error){document.getElementById('proof-status').textContent=error.message;}
