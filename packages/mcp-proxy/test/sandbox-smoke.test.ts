import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { initialize } from "../../report-cli/src/setup.js";
import { Ledger } from "../src/ledger.js";

it("onboards an unseeded MCP sandbox through browser approval, duplicate detection and the hard cap", async () => {
  const dir=mkdtempSync(join(tmpdir(),"spendguard-sandbox-smoke-"));
  const config=join(dir,"config.yaml"),ledgerPath=join(dir,"ledger.db");
  writeFileSync(join(dir,"tracked.txt"),"state");initialize(config,dir,true);
  writeFileSync(config,readFileSync(config,"utf8").replace("task_budget_usd: 5","task_budget_usd: 0.5"));
  const proxy=fileURLToPath(new URL("../src/server.ts",import.meta.url));
  const transport=new StdioClientTransport({command:process.execPath,args:[resolve("node_modules/tsx/dist/cli.mjs"),proxy,"--config",config,"--ledger",ledgerPath,"--approval","browser"],stderr:"pipe"});
  let log="";transport.stderr?.on("data",(chunk:Buffer)=>{log+=chunk.toString();});
  const client=new Client({name:"sandbox-onboarding-test",version:"1.0.0"});
  try {
    await client.connect(transport);const tools=await client.listTools();expect(tools.tools.map(t=>t.name)).toEqual(["search"]);
    const matched=log.match(/http:\/\/127\.0\.0\.1:\d+\/#([a-f0-9]+)/u);if(!matched)throw Error("Approval inbox was not announced");
    const url=new URL(matched[0]);const headers={authorization:`Bearer ${url.hash.slice(1)}`};
    const first=client.callTool({name:"search",arguments:{query:"onboarding"}});
    let pending:Array<{id:string;request:Record<string,unknown>}>=[];
    for(let i=0;i<100&&!pending.length;i++){pending=await(await fetch(`${url.origin}/api/pending`,{headers})).json();if(!pending.length)await new Promise(done=>setTimeout(done,20));}
    expect(pending).toHaveLength(1);expect(pending[0]!.request.fingerprint).toMatch(/^[a-f0-9]{64}$/u);
    expect((await fetch(`${url.origin}/api/decision`,{method:"POST",headers:{...headers,origin:url.origin,"content-type":"application/json"},body:JSON.stringify({id:pending[0]!.id,approved:true})})).status).toBe(200);
    expect(JSON.stringify((await first).content)).toContain("simulation");
    const duplicate=await client.callTool({name:"search",arguments:{query:"onboarding"}});expect(duplicate.isError).toBe(true);expect(JSON.stringify(duplicate.content)).toContain("already seen");
    const distinct=await client.callTool({name:"search",arguments:{query:"different"}});expect(distinct.isError).not.toBe(true);
    const cap=await client.callTool({name:"search",arguments:{query:"over budget"}});expect(cap.isError).toBe(true);expect(JSON.stringify(cap.content)).toContain("exceed");
    const ledger=new Ledger(ledgerPath);try{expect(ledger.verifyChain().valid).toBe(true);expect(ledger.report()).toMatchObject({allowed:2,blocked:2});}finally{ledger.close();}
  } finally {await client.close();rmSync(dir,{recursive:true,force:true});}
},30000);
