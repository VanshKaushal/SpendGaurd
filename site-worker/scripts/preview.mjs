import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync,existsSync,readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import worker from '../dist/server/index.js';
const local=resolve(import.meta.dirname,'../../.spendguard/site-preview');mkdirSync(local,{recursive:true});
const dbPath=resolve(local,'pilot-preview.db');const fresh=!existsSync(dbPath);const db=new DatabaseSync(dbPath);
if(fresh)db.exec(readFileSync(resolve(import.meta.dirname,'../drizzle/0000_pilot_requests.sql'),'utf8'));
function prepared(sql,args=[]){return {sql,args,bind(...next){return prepared(sql,next)},async first(){return db.prepare(sql).get(...args)||null},async run(){return db.prepare(sql).run(...args)}};}
const env={DB:{prepare:prepared,async batch(statements){db.exec('BEGIN');try{for(const stmt of statements)db.prepare(stmt.sql).run(...stmt.args);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}}}};
const server=createServer(async(req,res)=>{
 try{
  if(!['127.0.0.1:4173','localhost:4173'].includes(req.headers.host)){res.writeHead(403).end();return;}
  const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>12000){res.writeHead(413).end();return;}chunks.push(chunk);}
  const method=req.method||'GET';const headers=new Headers();for(const [name,value]of Object.entries(req.headers))if(typeof value==='string')headers.set(name,value);
  const response=await worker.fetch(new Request('http://'+req.headers.host+req.url,{method,headers,...(!['GET','HEAD'].includes(method)?{body:new Uint8Array(Buffer.concat(chunks)).buffer}:{})}),env);
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 }catch(error){res.writeHead(500).end(String(error));}
});
server.listen(4173,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:4173 (preview database only)'));
let stopping=false;const stop=()=>{if(stopping)return;stopping=true;server.closeAllConnections();server.close(()=>db.close());};process.once('SIGINT',stop);process.once('SIGTERM',stop);
