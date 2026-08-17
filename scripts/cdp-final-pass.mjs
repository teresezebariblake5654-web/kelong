import WebSocket from "ws";
import fs from "node:fs";
import path from "node:path";
const list=await fetch("http://127.0.0.1:9222/json/list").then(r=>r.json());
const page=list.find(p=>p.type==="page"&&String(p.url||"").includes("5175"))||list.find(p=>p.type==="page");
const ws=new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.once("open",res);ws.once("error",rej);});
let id=0; const pending=new Map();
ws.on("message",raw=>{const msg=JSON.parse(String(raw)); if(msg.id&&pending.has(msg.id)){const {resolve,reject}=pending.get(msg.id); pending.delete(msg.id); if(msg.error) reject(new Error(JSON.stringify(msg.error))); else resolve(msg.result);}});
const send=(m,p={})=>new Promise((resolve,reject)=>{const i=++id; pending.set(i,{resolve,reject}); ws.send(JSON.stringify({id:i,method:m,params:p}));});
const ev=async(expression,awaitPromise=false)=>{const r=await send("Runtime.evaluate",{expression,awaitPromise,returnByValue:true,userGesture:true}); if(r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result?.value;};
await send("Runtime.enable");

const chat=await ev(`(async()=>{
  const mod=await import('/src/renderer/workstation/services/lobsterChatBridge.ts');
  mod.clearWorkstationSessionBinding('hr');
  const r=await mod.startWorkstationChat({departmentId:'hr', prompt:'请只回复：联调成功', title:'final hr'});
  return {ok:true, sessionId:r.sessionId, content:String(r.content||'').slice(0,80)};
})()`, true);
console.log('[chat]', chat);

const upload=await ev(`(async()=>{
  const api=await import('/src/renderer/workstation/services/workstationApi.ts');
  localStorage.removeItem('lobsterai.workstation.userAccessToken');
  const login=await api.workstationFetch('/api/v1/auth/login',{method:'POST',body:JSON.stringify({email:'demo@example.com',password:'DemoPass123!'})});
  localStorage.setItem('lobsterai.workstation.userAccessToken', login.accessToken);
  if(login.organizations?.[0]?.id) localStorage.setItem('lobsterai.workstation.activeOrganizationId', login.organizations[0].id);
  const file=new File(['final-'+Date.now()],'final.txt',{type:'text/plain'});
  const up=await api.uploadWorkstationFile('/api/files/upload', file);
  return {ok:!!up.fileId, fileId:up.fileId};
})()`, true);
console.log('[upload]', upload);

const toLobster=await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/进入通用智能体/.test(x.textContent||'')); b?.click(); return !!b;})()`);
console.log('[toLobster]', toLobster);
await new Promise(r=>setTimeout(r,1200));

const lobster=await ev(`(async()=>{
  const {coworkService}=await import('/src/renderer/services/cowork.ts');
  const r=await coworkService.startSession({prompt:'请只回复：LOBSTER_OK', title:'final lobster'});
  return {ok:!!r.session, id:r.session?.id, agentId:r.session?.agentId, cwd:r.session?.cwd, title:r.session?.title};
})()`, true);
console.log('[lobster]', lobster);

const sessions=await ev(`(async()=>{
  const list=await window.electron.cowork.listSessions({limit:50, offset:0});
  return (list.sessions||[]).map(s=>({id:s.id,title:s.title,agentId:s.agentId,cwd:s.cwd}));
})()`, true);
console.log('[lobsterSidebarSessions]', sessions);
const leaked= (sessions||[]).filter(s=>String(s.title||'').startsWith('[WS:') || String(s.cwd||'').includes(`${String.raw`\\`}workstation${String.raw`\\`}`) || String(s.cwd||'').includes('/workstation/'));
console.log('[leakedIntoLobster]', leaked);

const back=await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/返回AI员工助手/.test(x.textContent||'')); b?.click(); return !!b;})()`);
console.log('[back]', back);
await new Promise(r=>setTimeout(r,1000));
console.log('[stillWs]', await ev(`!!document.querySelector('.workstation-root')`));

const map=await ev(`JSON.parse(localStorage.getItem('lobsterai.workstation.sessionMap.v1')||'{}')`);
console.log('[map]', map);
const reg=path.join(process.env.APPDATA,'Workhorse AI','workstation','_registry','sessions.json');
console.log('[registry]', fs.existsSync(reg)?fs.readFileSync(reg,'utf8').slice(0,500):'missing');

if(!chat?.ok || !String(chat.content||'').includes('联调')) throw new Error('chat fail');
if(!upload?.ok) throw new Error('upload fail');
if(!lobster?.ok) throw new Error('lobster fail');
if(leaked.length) throw new Error('workstation session leaked into lobster list');
if(!back) throw new Error('back button missing');
console.log('FINAL_PASS');
ws.close();
