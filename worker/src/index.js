const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const DEFAULT_FILES = {
  "catalogue.json": { products: [], collections: [], settings: {} },
  "orders/orders.json": { orders: [] },
  "products/inventory.json": { inventory: {} },
  "configuration/whatsapp.json": { contacts: [] },
  "activity-logs/activity.json": { entries: [] }
};
const response = (data, status=200, headers={}) => new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...headers } });
const fail = (message,status=400) => response({error:message},status);
const enc = s => new TextEncoder().encode(s);
const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");
const b64str = s => btoa(unescape(encodeURIComponent(s))).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");
async function hmac(secret, value){const key=await crypto.subtle.importKey("raw",enc(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);return b64(await crypto.subtle.sign("HMAC",key,enc(value)));}
async function sha256(s){return b64(await crypto.subtle.digest("SHA-256",enc(s)));}
function cookie(req,name){return (req.headers.get("Cookie")||"").split(";").map(x=>x.trim()).find(x=>x.startsWith(name+"="))?.slice(name.length+1)||"";}
function safeEqual(a,b){if(a.length!==b.length)return false;let n=0;for(let i=0;i<a.length;i++)n|=a.charCodeAt(i)^b.charCodeAt(i);return n===0;}
function allowed(env,email){return (env.ADMIN_EMAILS||"").split(",").map(x=>x.trim().toLowerCase()).includes(email.toLowerCase());}
function cors(req,env){const origin=req.headers.get("Origin")||"";if(origin!==env.ALLOWED_ORIGIN)return {};return {"access-control-allow-origin":origin,"access-control-allow-credentials":"true","access-control-allow-methods":"GET,POST,PUT,DELETE,OPTIONS","access-control-allow-headers":"Content-Type, X-CSRF-Token","vary":"Origin"};}
async function githubToken(env){
  const pem=env.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g,"\n").replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,"");
  const binary=Uint8Array.from(atob(pem),c=>c.charCodeAt(0));
  const key=await crypto.subtle.importKey("pkcs8",binary,{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["sign"]);
  const now=Math.floor(Date.now()/1000), header=b64str(JSON.stringify({alg:"RS256",typ:"JWT"})), payload=b64str(JSON.stringify({iat:now-30,exp:now+540,iss:env.GITHUB_APP_ID}));
  const unsigned=header+"."+payload, sig=await crypto.subtle.sign("RSASSA-PKCS1-v1_5",key,enc(unsigned));
  const jwt=unsigned+"."+b64(sig);
  const r=await fetch(`https://api.github.com/app/installations/${env.GITHUB_INSTALLATION_ID}/access_tokens`,{method:"POST",headers:{Authorization:`Bearer ${jwt}`,"Accept":"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28","User-Agent":"Tantsiri-Store"},body:"{}"});
  if(!r.ok)throw new Error("GitHub App token request failed");return (await r.json()).token;
}
async function gh(env,path,opts={}){
  const token=await githubToken(env), r=await fetch(`https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}`,{...opts,headers:{Authorization:`Bearer ${token}`,"Accept":"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28","User-Agent":"Tantsiri-Store",...(opts.headers||{})}});
  const data=await r.json().catch(()=>({}));if(!r.ok&&r.status!==404){const e=new Error(data.message||"Private storage request failed");e.status=r.status;throw e;}return {r,data};
}
async function readFile(env,path){const {r,data}=await gh(env,path);if(r.status===404)return {value:DEFAULT_FILES[path]??{},sha:null};return {value:JSON.parse(decodeURIComponent(escape(atob(data.content.replace(/\n/g,""))))),sha:data.sha};}
async function writeFile(env,path,value,sha,message){
  const body={message,content:btoa(unescape(encodeURIComponent(JSON.stringify(value,null,2)))),branch:env.GITHUB_BRANCH||"main"};if(sha)body.sha=sha;
  const {r,data}=await gh(env,path,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  if(r.status===409||r.status===422){const e=new Error("Storage conflict. Another update may have occurred; reload and try again.");e.status=409;throw e;}
  if(!r.ok)throw new Error(data.message||"Could not save private data");return data;
}
async function log(env,admin,action,recordId,details={}){try{const f=await readFile(env,"activity-logs/activity.json");f.value.entries.unshift({id:crypto.randomUUID(),at:new Date().toISOString(),admin,action,recordId,details});f.value.entries=f.value.entries.slice(0,1000);await writeFile(env,"activity-logs/activity.json",f.value,f.sha,`Audit: ${action}`);}catch(e){console.error("Audit log failed",e.message);}}
async function session(req,env){const token=cookie(req,"tantsiri_session");if(!token)return null;const [id,sig]=token.split(".");if(!id||!sig)return null;const expected=await hmac(env.SESSION_SECRET,id);if(!safeEqual(sig,expected))return null;const raw=await env.AUTH_KV.get("session:"+id);if(!raw)return null;const s=JSON.parse(raw);if(s.expires<Date.now())return null;return s;}
async function requireAdmin(req,env,role){const s=await session(req,env);if(!s)return null;if(role==="owner"&&s.role!=="owner")return null;return s;}
function cookieHeaders(req,env,value,maxAge){const origin=req.headers.get("Origin")||"";const secure=origin.startsWith("https://")?"; Secure":"";return {"set-cookie":`tantsiri_session=${value}; HttpOnly; SameSite=None; Path=/; Max-Age=${maxAge}${secure}`};}
async function sendOtp(env,email,otp){const r=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":`Bearer ${env.RESEND_API_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({from:env.RESEND_FROM,to:[email],subject:"Your Tantsiri admin sign-in code",html:`<div style="font-family:Arial"><h2>Tantsiri admin verification</h2><p>Your one-time code is:</p><h1 style="letter-spacing:8px">${otp}</h1><p>This code expires in 10 minutes. If you did not request it, ignore this email.</p></div>`})});if(!r.ok)throw new Error("Email delivery failed");}
async function body(req){try{return await req.json();}catch{return null;}}
function validProduct(p){return p&&typeof p.name==="string"&&p.name.trim().length>0&&Number.isFinite(Number(p.price))&&Number(p.price)>=0&&Number(p.price)<=10000000&&Number.isFinite(Number(p.stock))&&Number(p.stock)>=0&&Array.isArray(p.images||[]);}
export default {
 async fetch(req,env){
  const corsHeaders=cors(req,env);if(req.method==="OPTIONS")return new Response(null,{status:204,headers:{...corsHeaders,"access-control-max-age":"86400"}});
  const url=new URL(req.url), path=url.pathname;
  try{
   if(path==="/api/health")return response({ok:true,service:"tantsiri-api"},200,corsHeaders);
   if(path==="/api/catalogue"&&req.method==="GET"){const f=await readFile(env,"catalogue.json");return response(f.value,200,{...corsHeaders,"cache-control":"public, max-age=60"});}
   if(path==="/api/auth/request-otp"&&req.method==="POST"){
    const b=await body(req),email=String(b?.email||"").trim().toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return fail("Enter a valid email address.");
    const key="otp-rate:"+await sha256(email), last=Number(await env.AUTH_KV.get(key)||0);if(Date.now()-last<60000)return fail("Please wait before requesting another code.",429);
    await env.AUTH_KV.put(key,String(Date.now()),{expirationTtl:600});if(!allowed(env,email))return response({ok:true},200,corsHeaders);
    const otp=String(crypto.getRandomValues(new Uint32Array(1))[0]%1000000).padStart(6,"0"), salt=crypto.randomUUID(), hash=await sha256(otp+salt);
    await env.AUTH_KV.put("otp:"+await sha256(email),JSON.stringify({hash,salt,attempts:0,expires:Date.now()+600000}),{expirationTtl:600});
    await sendOtp(env,email,otp);return response({ok:true},200,corsHeaders);
   }
   if(path==="/api/auth/verify-otp"&&req.method==="POST"){
    const b=await body(req),email=String(b?.email||"").trim().toLowerCase(),otp=String(b?.otp||"");if(!allowed(env,email)||!/^\d{6}$/.test(otp))return fail("Invalid or expired code.",401);
    const key="otp:"+await sha256(email),raw=await env.AUTH_KV.get(key);if(!raw)return fail("Invalid or expired code.",401);const record=JSON.parse(raw);
    if(record.expires<Date.now()||record.attempts>=5){await env.AUTH_KV.delete(key);return fail("Invalid or expired code.",401);}
    const hash=await sha256(otp+record.salt);if(!safeEqual(hash,record.hash)){record.attempts++;await env.AUTH_KV.put(key,JSON.stringify(record),{expirationTtl:600});return fail("Invalid or expired code.",401);}
    await env.AUTH_KV.delete(key);const id=crypto.randomUUID(),role=email===(env.OWNER_EMAIL||"").toLowerCase()?"owner":"admin",expires=Date.now()+8*60*60*1000;
    await env.AUTH_KV.put("session:"+id,JSON.stringify({email,role,expires}),{expirationTtl:28800});const sig=await hmac(env.SESSION_SECRET,id);
    await log(env,email,"admin.login",null);return response({ok:true,role},200,{...corsHeaders,...cookieHeaders(req,env,id+"."+sig,28800)});
   }
   if(path==="/api/auth/logout"&&req.method==="POST"){const s=await session(req,env);if(s){const token=cookie(req,"tantsiri_session").split(".")[0];await env.AUTH_KV.delete("session:"+token);}return response({ok:true},200,{...corsHeaders,"set-cookie":"tantsiri_session=; HttpOnly; SameSite=None; Path=/; Max-Age=0; Secure"});}
   if(path==="/api/orders"&&req.method==="POST"){
    const b=await body(req);if(!Array.isArray(b?.items)||b.items.length<1||b.items.length>30)return fail("Your bag is empty or invalid.");
    const cat=(await readFile(env,"catalogue.json")).value, orderItems=[];let total=0;
    for(const item of b.items){const p=cat.products.find(x=>x.id===item.productId&&x.active!==false);const q=Number(item.quantity);if(!p||!Number.isInteger(q)||q<1||q>20)return fail("A product or quantity is no longer valid.",409);if(p.stock!=null&&q>p.stock)return fail(`${p.name} does not have enough stock.`,409);const variant=String(item.variant||"");if((p.variants||[]).length&&!p.variants.includes(variant))return fail(`Choose a valid option for ${p.name}.`,409);const lineTotal=Number(p.price)*q;total+=lineTotal;orderItems.push({productId:p.id,name:p.name,variant,quantity:q,unitPrice:Number(p.price),lineTotal});}
    const f=await readFile(env,"orders/orders.json"),id="TAN-"+new Date().toISOString().slice(0,10).replace(/-/g,"")+"-"+crypto.randomUUID().slice(0,8).toUpperCase();
    const order={id,createdAt:new Date().toISOString(),status:"Pending",paymentStatus:"Unpaid",items:orderItems,total,customer:{},internalNotes:[]};f.value.orders.unshift(order);
    await writeFile(env,"orders/orders.json",f.value,f.sha,`Create order ${id}`);
    const contacts=(await readFile(env,"configuration/whatsapp.json")).value.contacts||[],primary=contacts.find(x=>x.enabled&&x.primary)||contacts.find(x=>x.enabled);
    await log(env,"customer","order.created",id,{total});return response({order,whatsappNumber:primary?.number||null},201,corsHeaders);
   }
   const admin=await requireAdmin(req,env);if(path.startsWith("/api/admin/")&&!admin)return fail("Administrator sign-in required.",401);
   if(path==="/api/admin/summary"&&req.method==="GET"){
    const [cat,orders]=await Promise.all([readFile(env,"catalogue.json"),readFile(env,"orders/orders.json")]);const products=cat.value.products||[],os=orders.value.orders||[];
    return response({stats:{"Total products":products.length,"Active products":products.filter(p=>p.active!==false).length,"Collections":(cat.value.collections||[]).length,"Total orders":os.length,"Pending orders":os.filter(o=>o.status==="Pending").length,"Completed orders":os.filter(o=>o.status==="Delivered").length,"Order value":os.reduce((n,o)=>n+o.total,0),"Low stock":products.filter(p=>p.stock!=null&&p.stock<=5).length},products,orders:os.slice(0,10)},200,corsHeaders);
   }
   if(path==="/api/admin/products"&&req.method==="POST"){
    const p=await body(req);if(!validProduct(p))return fail("Product details are invalid.");const f=await readFile(env,"catalogue.json");p.id=crypto.randomUUID();p.createdAt=new Date().toISOString();p.images=(p.images||[]).slice(0,8);f.value.products.push(p);await writeFile(env,"catalogue.json",f.value,f.sha,"Create product");await log(env,admin.email,"product.created",p.id);return response({product:p},201,corsHeaders);
   }
   const pm=path.match(/^\/api\/admin\/products\/([a-f0-9-]+)$/i);
   if(pm&&req.method==="PUT"){const p=await body(req);if(!validProduct(p))return fail("Product details are invalid.");const f=await readFile(env,"catalogue.json"),i=f.value.products.findIndex(x=>x.id===pm[1]);if(i<0)return fail("Product not found.",404);f.value.products[i]={...f.value.products[i],...p,id:pm[1],updatedAt:new Date().toISOString()};await writeFile(env,"catalogue.json",f.value,f.sha,"Update product");await log(env,admin.email,"product.updated",pm[1]);return response({product:f.value.products[i]},200,corsHeaders);}
   if(pm&&req.method==="DELETE"){const f=await readFile(env,"catalogue.json");f.value.products=f.value.products.filter(x=>x.id!==pm[1]);await writeFile(env,"catalogue.json",f.value,f.sha,"Delete product");await log(env,admin.email,"product.deleted",pm[1]);return response({ok:true},200,corsHeaders);}
   if(path==="/api/admin/orders"&&req.method==="GET"){const f=await readFile(env,"orders/orders.json");return response({orders:f.value.orders||[]},200,corsHeaders);}
   if(path==="/api/admin/whatsapp"&&req.method==="GET"){const f=await readFile(env,"configuration/whatsapp.json");return response(f.value,200,corsHeaders);}
   return fail("Not found.",404);
  }catch(e){console.error(e);return fail(e.status===409?e.message:"The service could not complete this request. Please try again.",e.status||500);}
 }
};