// Cloudflare Worker: GitHub OAuth identity check + repository-scoped publishing.
// Private values are Cloudflare SECRETS, never put in GitHub Pages.
const GH='https://api.github.com';
function json(data,status=200,headers={}){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers}})}
function base64url(bytes){return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
function rawBytes(value){return new TextEncoder().encode(value)}
function utf8b64(value){let bytes=rawBytes(value);let out='';for(let i=0;i<bytes.length;i+=8192)out+=String.fromCharCode(...bytes.slice(i,i+8192));return btoa(out)}
function parseB64url(s){return Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(s.length/4)*4,'=')),c=>c.charCodeAt(0))}
async function mac(env,data){const key=await crypto.subtle.importKey('raw',rawBytes(env.SESSION_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);return base64url(new Uint8Array(await crypto.subtle.sign('HMAC',key,rawBytes(data))))}
async function token(env,user){let body=base64url(rawBytes(JSON.stringify({user,exp:Date.now()+2*60*60*1000})));return body+'.'+await mac(env,body)}
async function tokenUser(env,s){if(!s || s.length>2000)return null;const [body,sig,...extra]=s.split('.');if(!body||!sig||extra.length)return null;const wanted=await mac(env,body);if(wanted.length!==sig.length)return null;let mismatch=0;for(let i=0;i<sig.length;i++)mismatch|=sig.charCodeAt(i)^wanted.charCodeAt(i);if(mismatch)return null;try{const payload=JSON.parse(new TextDecoder().decode(parseB64url(body)));if(payload.exp<Date.now()||payload.exp>Date.now()+7200001)return null;return payload.user}catch{return null}}
function origin(env){return new URL(env.SITE_URL).origin}
function cors(env,req){const reqOrigin=req.headers.get('Origin');return reqOrigin===origin(env)?{'Access-Control-Allow-Origin':reqOrigin,'Vary':'Origin','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Allow-Methods':'POST, OPTIONS'}:{}}
async function gh(env,path,method='GET',body){const r=await fetch(`${GH}/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}/contents/${path}`,{method,headers:{'Authorization':'Bearer '+env.REPO_WRITE_TOKEN,'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'Guitar-Lesson-Publisher',...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const text=await r.text();let data;try{data=JSON.parse(text)}catch{data={message:text}};return{ok:r.ok,status:r.status,data}}
function checkSnippet(task){if(!task||typeof task!=='object')throw Error('Missing snippet');if(!/^[a-z0-9-]{3,90}$/.test(task.id||''))throw Error('Invalid ID');if(typeof task.title!=='string'||!task.title.trim()||task.title.length>100)throw Error('Invalid title');const p=task.snippet;if(p?.format!=='guitar-animation-snippet'||!p.variants?.original||!p.variants?.open)throw Error('Both variants are required');for(const key of ['original','open'])if(!Array.isArray(p.variants[key].events))throw Error('Missing variant events');const size=JSON.stringify(p).length;if(size>500000)throw Error('Snippet too large');return p}
async function publish(env,task){const packet=checkSnippet(task);const path=`snippets/${task.id}.json`;
  // Unique filenames: never silently overwrite an existing lesson.
  const existing=await gh(env,path);if(existing.ok)return json({error:'Snippet ID already exists; try again.'},409);if(existing.status!==404)return json({error:'Could not check snippet path: '+existing.data.message},502);
  const snippet={...packet,id:task.id,title:task.title};
  const put=await gh(env,path,'PUT',{message:`Add guitar snippet: ${task.title}`,content:utf8b64(JSON.stringify(snippet,null,2)+'\n')});if(!put.ok)return json({error:'Could not create snippet: '+put.data.message},502);
  // GitHub requires serial, SHA-checked updates. Retry catalog conflicts.
  for(let n=0;n<4;n++){
    const current=await gh(env,'snippets/index.json');if(!current.ok)return json({error:'Snippet saved, but catalog could not be read. Please contact administrator.'},502);
    let catalog;try{const raw=atob(current.data.content.replace(/\s/g,''));catalog=JSON.parse(new TextDecoder().decode(Uint8Array.from(raw,c=>c.charCodeAt(0))))}catch{return json({error:'Snippet saved, but catalog could not be decoded.'},502)}
    if(!Array.isArray(catalog.snippets))return json({error:'Snippet saved, but catalog is invalid.'},502);
    if(!catalog.snippets.some(s=>s.id===task.id))catalog.snippets.push({id:task.id,title:task.title,file:`${task.id}.json`});
    const update=await gh(env,'snippets/index.json','PUT',{message:`List guitar snippet: ${task.title}`,content:utf8b64(JSON.stringify(catalog,null,2)+'\n'),sha:current.data.sha});
    if(update.ok)return json({ok:true,id:task.id,title:task.title});
    if(update.status!==409)return json({error:'Snippet saved, but catalog update failed: '+update.data.message},502);
  }
  return json({error:'Snippet saved, but catalog changed concurrently. Please retry with support.'},409);
}
export default {async fetch(request,env){
  const url=new URL(request.url);const headers=cors(env,request);
  const respond=(obj,status)=>json(obj,status,headers);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(url.pathname==='/health')return respond({ok:true,configured:Boolean(env.GITHUB_OWNER&&env.GITHUB_REPO&&env.SITE_URL&&env.GITHUB_CLIENT_ID&&env.GITHUB_CLIENT_SECRET&&env.REPO_WRITE_TOKEN&&env.SESSION_SECRET)});
  if(url.pathname==='/auth/start'){
    const state=base64url(crypto.getRandomValues(new Uint8Array(24)));
    const authorize=new URL('https://github.com/login/oauth/authorize');authorize.searchParams.set('client_id',env.GITHUB_CLIENT_ID);authorize.searchParams.set('redirect_uri',new URL('/auth/callback',url.origin).href);authorize.searchParams.set('state',state);authorize.searchParams.set('scope','read:user');
    return new Response(null,{status:302,headers:{Location:authorize.href,'Set-Cookie':`publish_state=${state}; Path=/auth/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,'Cache-Control':'no-store'}});
  }
  if(url.pathname==='/auth/callback'){
    const cookie=request.headers.get('Cookie')||'';const state=/\bpublish_state=([^;]+)/.exec(cookie)?.[1];
    if(!state||state!==url.searchParams.get('state')||!url.searchParams.get('code'))return new Response('Authorization state mismatch. Start again from Lesson Builder.',{status:403});
    const exchange=await fetch('https://github.com/login/oauth/access_token',{method:'POST',headers:{'Accept':'application/json','Content-Type':'application/json','User-Agent':'Guitar-Lesson-Publisher'},body:JSON.stringify({client_id:env.GITHUB_CLIENT_ID,client_secret:env.GITHUB_CLIENT_SECRET,code:url.searchParams.get('code'),redirect_uri:new URL('/auth/callback',url.origin).href})});const auth=await exchange.json();if(!auth.access_token)return new Response('GitHub authorization failed.',{status:403});
    const who=await fetch('https://api.github.com/user',{headers:{'Authorization':'Bearer '+auth.access_token,'Accept':'application/vnd.github+json','User-Agent':'Guitar-Lesson-Publisher'}});const identity=await who.json();
    if(!who.ok||String(identity.login||'').toLowerCase()!==String(env.ALLOWED_GITHUB_USER||'').toLowerCase())return new Response('This GitHub account is not authorized to publish snippets.',{status:403});
    const session=await token(env,identity.login);
    return new Response(null,{status:302,headers:{Location:env.SITE_URL.split('#')[0]+'#publish_session='+encodeURIComponent(session),'Set-Cookie':'publish_state=; Path=/auth/; HttpOnly; Secure; SameSite=Lax; Max-Age=0','Referrer-Policy':'no-referrer','Cache-Control':'no-store'}});
  }
  if(url.pathname==='/publish'&&request.method==='POST'){
    if(request.headers.get('Origin')!==origin(env))return respond({error:'Wrong site origin'},403);
    const user=await tokenUser(env,(request.headers.get('Authorization')||'').replace(/^Bearer /,''));
    if(!user||user.toLowerCase()!==String(env.ALLOWED_GITHUB_USER||'').toLowerCase())return respond({error:'Sign in to GitHub again.'},401);
    let task;try{task=await request.json()}catch{return respond({error:'Invalid JSON'},400)}
    try{const result=await publish(env,task);const h=new Headers(result.headers);for(const [k,v]of Object.entries(headers))h.set(k,v);return new Response(result.body,{status:result.status,headers:h})}catch(error){return respond({error:'Server error: '+error.message},500)}
  }
  return respond({error:'Unknown endpoint'},404);
}};
