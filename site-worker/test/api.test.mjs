import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { pilotApi } from '../worker/lead-api.mjs';

function database() {
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../drizzle/0000_pilot_requests.sql',import.meta.url),'utf8'));
 function prepared(sql,args=[]){return {bind(...next){return prepared(sql,next)},async first(){return db.prepare(sql).get(...args)||null},async run(){return db.prepare(sql).run(...args)},sql,args};}
 return {db,env:{DB:{prepare:prepared,async batch(statements){db.exec('BEGIN');try{for(const stmt of statements)db.prepare(stmt.sql).run(...stmt.args);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}}}}};
}
const valid={name:'Test Visitor',email:'test@example.invalid',workflow:'My agent buys paid search queries',monthlyPaidToolBudgetUsd:100,consent:true};
function request(method,data,origin='https://spendguard.test'){
 return new Request('https://spendguard.test/api/pilot',{method,headers:{origin,'content-type':'application/json','cf-connecting-ip':'192.0.2.1'},...(data?{body:JSON.stringify(data)}:{})});
}
test('saves consented pilot enquiries privately and lets the receipt holder delete them',async()=>{
 const {db,env}=database();try{
 const saved=await pilotApi(request('POST',valid),env);assert.equal(saved.status,201);const receipt=await saved.json();
 assert.match(receipt.deletionToken,/^[a-f0-9]{64}$/);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pilot_requests').get().n,1);
 const hidden=await pilotApi(request('GET'),env);assert.equal(hidden.status,405);
 await pilotApi(request('DELETE',{requestId:receipt.requestId,deletionToken:'0'.repeat(64)}),env);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pilot_requests').get().n,1);
 await pilotApi(request('DELETE',{requestId:receipt.requestId,deletionToken:receipt.deletionToken}),env);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pilot_requests').get().n,0);
 }finally{db.close();}
});
test('rejects cross-origin submissions, missing consent, malformed email and oversized input',async()=>{
 const {db,env}=database();try{
 assert.equal((await pilotApi(request('POST',valid,'https://attacker.test'),env)).status,403);
 assert.equal((await pilotApi(request('POST',{...valid,consent:false}),env)).status,400);
 assert.equal((await pilotApi(request('POST',{...valid,email:'not-email'}),env)).status,400);
 assert.equal((await pilotApi(request('POST',{...valid,workflow:'x'.repeat(13000)}),env)).status,400);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pilot_requests').get().n,0);
 }finally{db.close();}
});
test('applies bounded rate limits and does not store honeypot submissions',async()=>{
 const {db,env}=database();try{
 await pilotApi(request('POST',{...valid,website:'bot'}),env);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pilot_requests').get().n,0);
 for(let i=0;i<5;i++)assert.equal((await pilotApi(request('POST',valid),env)).status,201);
 assert.equal((await pilotApi(request('POST',valid),env)).status,429);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pilot_requests').get().n,5);
 }finally{db.close();}
});
test('reports unavailable storage instead of pretending a signup succeeded',async()=>{
 assert.equal((await pilotApi(request('POST',valid),{})).status,503);
});
