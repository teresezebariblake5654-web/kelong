import WebSocket from "ws";
import fs from "node:fs";
import path from "node:path";
const list = await fetch("http://127.0.0.1:9222/json/list").then(r=>r.json());
const page = list.find(p=>p.type==="page" && String(p.url||"").includes("5175")) || list.find(p=>p.type==="page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.once("open",res); ws.once("error",rej);});
let id=0; const pending=new Map();
ws.on("message", raw=>{ const msg=JSON.parse(String(raw)); if(msg.id&&pending.has(msg.id)){ const {resolve,reject}=pending.get(msg.id); pending.delete(msg.id); if(msg.error) reject(new Error(JSON.stringify(msg.error))); else resolve(msg.result);} });
const send=(method,params={})=>new Promise((resolve,reject)=>{const i=++id; pending.set(i,{resolve,reject}); ws.send(JSON.stringify({id:i,method,params}));});
const ev=async(expression,awaitPromise=false)=>{ const r=await send("Runtime.evaluate",{expression,awaitPromise,returnByValue:true,userGesture:true}); if(r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result?.value; };
await send("Runtime.enable");

console.log("[ui]", await ev(`({hasWS:!!document.querySelector('.workstation-root'), text:(document.body.innerText||'').slice(0,120)})`));

// clear stale bindings
await ev(`(()=>{ localStorage.removeItem('lobsterai.workstation.sessionMap.v1'); return true; })()`);

const health = await ev(`(async()=>{ const m=await import('/src/renderer/workstation/services/workstationApi.ts'); return m.healthCheck(4000); })()`, true);
console.log("[health ipc]", health);

const chat = await ev(`(async()=>{
  const mod=await import('/src/renderer/workstation/services/lobsterChatBridge.ts');
  mod.clearWorkstationSessionBinding('hr');
  const result=await mod.startWorkstationChat({ departmentId:'hr', prompt:'请只回复四个字：联调成功', title:'CDP hr smoke2' });
  return { ok:true, sessionId:result.sessionId, agentId: mod.formatWorkstationAgentId('hr'), content:String(result.content||'').slice(0,300) };
})()`, true);
console.log("[chat]", chat);

const upload = await ev(`(async()=>{
  const mod=await import('/src/renderer/workstation/services/chat/lobsterChat.service.ts');
  const file=new File(['cdp-upload-'+Date.now()],'cdp-upload.txt',{type:'text/plain'});
  const result=await mod.uploadChatAttachmentViaBackend(file);
  return { ok:true, result };
})()`, true);
console.log("[upload]", upload);

const toLobster = await ev(`(()=>{ const b=[...document.querySelectorAll('button')].find(x=>/进入通用智能体/.test(x.textContent||'')); b?.click(); return !!b; })()`);
console.log("[toLobster]", toLobster);
await new Promise(r=>setTimeout(r,1500));

const lobster = await ev(`(async()=>{
  const { coworkService } = await import('/src/renderer/services/cowork.ts');
  const result = await coworkService.startSession({ prompt:'请只回复：LOBSTER_OK', title:'CDP lobster smoke2' });
  return { ok:!!result.session, sessionId:result.session?.id||null, agentId:result.session?.agentId||null, cwd:result.session?.cwd||null, error:result.error||null };
})()`, true);
console.log("[lobster]", lobster);

const back = await ev(`(()=>{ const b=[...document.querySelectorAll('button')].find(x=>/返回AI员工助手/.test(x.textContent||'')); b?.click(); return !!b; })()`);
console.log("[back]", back);
await new Promise(r=>setTimeout(r,1000));
console.log("[stillWs]", await ev(`!!document.querySelector('.workstation-root')`));

const map = await ev(`JSON.parse(localStorage.getItem('lobsterai.workstation.sessionMap.v1')||'{}')`);
console.log("[map]", map);

const registryPath = path.join(process.env.APPDATA,'Workhorse AI','workstation','_registry','sessions.json');
console.log("[registry]", fs.existsSync(registryPath)?fs.readFileSync(registryPath,'utf8').slice(0,600):'missing');

if(!chat?.ok) throw new Error('chat failed '+chat?.error);
if(!upload?.ok) throw new Error('upload failed '+upload?.error);
if(!lobster?.ok) throw new Error('lobster failed '+lobster?.error);
console.log("ACCEPT_PASS");
ws.close();
