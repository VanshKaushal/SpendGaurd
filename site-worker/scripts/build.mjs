import { mkdir,readFile,writeFile,copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const root=resolve(import.meta.dirname,'..');
const content=resolve(root,'../site-content');
const core=resolve(root,'../dist/packages/mcp-proxy/src');
const version=JSON.parse(await readFile(resolve(root,'../package.json'),'utf8')).version;
const mappings=[['/','index.html','text/html; charset=utf-8'],['/engineering','engineering.html','text/html; charset=utf-8'],['/engineering.js','assets/engineering.js','text/javascript'],['/styles.css','assets/styles.css','text/css'],['/app.js','assets/app.js','text/javascript'],['/mark.svg','assets/mark.svg','image/svg+xml'],['/site-config.json','assets/site-config.json','application/json']];
const assets={};
// Keep previously deployed versioned downloads byte-for-byte while adding a new release.
const prior=await readFile(resolve(root,'worker/index.js'),'utf8').catch(()=> '');
const priorJson=prior.match(/\nconst assets=([\s\S]*?);\s*export default /u)?.[1];
if(priorJson){let saved;try{saved=JSON.parse(priorJson);}catch{throw Error('Could not preserve prior versioned downloads');}
 for(const [url,asset]of Object.entries(saved))if(/^\/downloads\/spend-guard-\d+\.\d+\.\d+\.tgz$/.test(url))assets[url]=asset;}
for(const [url,file,type]of mappings)assets[url]={type,body:await readFile(resolve(content,file),'utf8')};
for(const file of ['policy-engine.js','money.js'])assets['/vendor/'+file]={type:'text/javascript',body:await readFile(resolve(core,file),'utf8')};
assets[`/downloads/spend-guard-${version}.tgz`]={type:'application/gzip',base64: (await readFile(resolve(root,`../release/spend-guard-${version}.tgz`))).toString('base64')};
const proof=JSON.parse(await readFile(resolve(root,'../release/platform-verification.json'),'utf8'));
if(proof.version!==version||proof.coreTests.failed!==0||!proof.cleanInstall)throw Error('Run npm run verify before preparing the public release');
if(createHash('sha256').update(await readFile(resolve(root,`../release/spend-guard-${version}.tgz`))).digest('hex')!==proof.archiveSha256)throw Error('Release archive differs from its verification record');
assets['/proof.json']={type:'application/json',body:JSON.stringify(proof,null,2)};
for(const name of ['QUICKSTART','SHOWCASE','INTERVIEW_GUIDE','RECOVERY','THREAT_MODEL','SOLANA_X402'])assets[`/docs/${name}.md`]={type:'text/plain; charset=utf-8',body:await readFile(resolve(root,`../docs/${name}.md`),'utf8')};
const api=await readFile(resolve(root,'worker/lead-api.mjs'),'utf8');
const source=api+'\nconst assets='+JSON.stringify(assets)+';\n'+`
export default {async fetch(request,env){
 const url=new URL(request.url);if(url.pathname==='/api/pilot')return pilotApi(request,env);
 if(request.method!=='GET'&&request.method!=='HEAD')return new Response('Method not allowed',{status:405});
 const asset=assets[url.pathname];if(!asset)return new Response('Not found',{status:404});
 const headers={'content-type':asset.type,'x-content-type-options':'nosniff','referrer-policy':'strict-origin-when-cross-origin','cache-control':url.pathname==='/'?'no-cache':'public,max-age=300'};
 if(asset.type.startsWith('text/html'))headers['content-security-policy']="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
 const body=asset.base64?Uint8Array.from(atob(asset.base64),c=>c.charCodeAt(0)):asset.body;
 return new Response(request.method==='HEAD'?null:body,{headers});
}};
`;
await mkdir(resolve(root,'dist/server'),{recursive:true});await mkdir(resolve(root,'dist/.openai'),{recursive:true});
await writeFile(resolve(root,'worker/index.js'),source);await writeFile(resolve(root,'dist/server/index.js'),source);
await copyFile(resolve(root,'.openai/hosting.json'),resolve(root,'dist/.openai/hosting.json'));
console.log('Built dependency-free showcase, pilot API, and embedded release download');
