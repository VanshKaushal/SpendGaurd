const json = (data, status = 200) => Response.json(data, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
async function hash(value) {
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(b=>b.toString(16).padStart(2,'0')).join('');
}
async function readBody(request) {
 if(!request.headers.get('content-type')?.startsWith('application/json'))throw new Error('JSON required');
 const reader=request.body?.getReader();if(!reader)throw new Error('Body required');let size=0;let content='';const decoder=new TextDecoder();
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>12000)throw new Error('Too large');content+=decoder.decode(value,{stream:true});}return JSON.parse(content+decoder.decode());}finally{await reader.cancel();}
}
function validSubmission(data) {
 if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).some(k=>!['name','email','workflow','monthlyPaidToolBudgetUsd','consent','website'].includes(k)))return false;
 return typeof data.name==='string'&&data.name.trim().length>=2&&data.name.length<=120&&typeof data.email==='string'&&data.email.length<=254&&/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(data.email)&&typeof data.workflow==='string'&&data.workflow.trim().length>=10&&data.workflow.length<=3000&&data.consent===true&&
 (data.monthlyPaidToolBudgetUsd==null||(typeof data.monthlyPaidToolBudgetUsd==='number'&&Number.isFinite(data.monthlyPaidToolBudgetUsd)&&data.monthlyPaidToolBudgetUsd>=0&&data.monthlyPaidToolBudgetUsd<=1e9))&&
 (data.website===undefined||(typeof data.website==='string'&&data.website.length<=200));
}
export async function pilotApi(request,env) {
 if(!['POST','DELETE'].includes(request.method))return json({error:'Pilot submissions are private'},405);
 if(request.headers.get('origin')!==new URL(request.url).origin)return json({error:'Submit from the Spend Guard website'},403);
 let data;try{data=await readBody(request);}catch{return json({error:'Use a bounded JSON request'},400);}
 if(request.method==='DELETE'){
  if(!data||typeof data.requestId!=='string'||!/^[a-f0-9-]{36}$/.test(data.requestId)||typeof data.deletionToken!=='string'||!/^[a-f0-9]{64}$/.test(data.deletionToken))return json({error:'Use the ID and deletion token from your receipt'},400);
  if(!env.DB)return json({error:'Service unavailable'},503);
  try{await env.DB.prepare('DELETE FROM pilot_requests WHERE id = ? AND deletion_hash = ?').bind(data.requestId,await hash(data.deletionToken)).run();return json({deleted:true});}catch{return json({error:'Unable to delete now'},503);}
 }
 if(!validSubmission(data))return json({error:'Enter a valid name, email, workflow, and consent'},400);
 if(data.website)return json({accepted:true});
 if(!env.DB)return json({error:'Signup unavailable. Download a local copy and try again later'},503);
 try{
  const now=Date.now();const hour=Math.floor(now/3600000);
  const key=await hash(hour+':'+(request.headers.get('cf-connecting-ip')||'local'));
  const limit=await env.DB.prepare('INSERT INTO request_limits(id,count,expires_at) VALUES (?,1,?) ON CONFLICT(id) DO UPDATE SET count=count+1 RETURNING count').bind(key,(hour+1)*3600000).first();
  if(!limit||limit.count>5)return json({error:'Too many requests. Try again in an hour'},429);
  const id=crypto.randomUUID();const token=Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b=>b.toString(16).padStart(2,'0')).join('');
  const budget=data.monthlyPaidToolBudgetUsd==null?null:Math.round(data.monthlyPaidToolBudgetUsd*100);
  await env.DB.batch([
   env.DB.prepare("INSERT INTO pilot_requests(id,name,email,workflow,monthly_budget_cents,proposed_fee_usd,status,deletion_hash,consent_at,created_at) VALUES (?,?,?,?,?,149,'new',?,?,?)").bind(id,data.name.trim(),data.email.trim().toLowerCase(),data.workflow.trim(),budget,await hash(token),now,now),
   env.DB.prepare('DELETE FROM request_limits WHERE expires_at < ?').bind(now),
   env.DB.prepare('DELETE FROM pilot_requests WHERE created_at < ?').bind(now-90*24*3600000)
  ]);
  return json({accepted:true,requestId:id,deletionToken:token,message:'Request received. No payment collected; scope and availability will be confirmed personally'},201);
 }catch{return json({error:'Signup could not be saved. Download a local copy and try again later'},503);}
}
