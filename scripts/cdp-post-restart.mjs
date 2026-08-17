import WebSocket from "ws";
import fs from "node:fs";
import path from "node:path";

async function waitPage() {
  for (let i=0;i<40;i++) {
    const list=await fetch("http://127.0.0.1:9222/json/list").then(r=>r.json());
    const page=list.find(p=>p.type==="page"&&String(p.url||"").includes("5175"))||list.find(p=>p.type==="page" && p.webSocketDebuggerUrl);
    if (page?.webSocketDebuggerUrl) return page;
    await new Promise(r=>setTimeout(r,500));
  }
  throw new Error("no page");
}
const page=await waitPage();
const ws=new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.once("open",res);ws.once("error",rej);});
let id=0; const pending=new Map();
ws.on("message",raw=>{const msg=JSON.parse(String(raw)); if(msg.id&&pending.has(msg.id)){const {resolve,reject}=pending.get(msg.id); pending.delete(msg.id); if(msg.error) reject(new Error(JSON.stringify(msg.error))); else resolve(msg.result);}});
const send=(m,p={})=>new Promise((resolve,reject)=>{const i=++id; pending.set(i,{resolve,reject}); ws.send(JSON.stringify({id:i,method:m,params:p}));});
const ev=async(expression,awaitPromise=false)=>{const r=await send("Runtime.evaluate",{expression,awaitPromise,returnByValue:true,userGesture:true}); if(r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result?.value;};
await send("Runtime.enable");
await new Promise(r=>setTimeout(r,2500));

const ui=await ev(`(()=>{
  const root=document.querySelector('.workstation-root');
  const text=(root?.innerText||'').slice(0,300);
  const last=localStorage.getItem('lobsterai.workstation.lastDepartment');
  const map=JSON.parse(localStorage.getItem('lobsterai.workstation.sessionMap.v1')||'{}');
  const restoredDept = last && text.includes(last) || /生产|人事|财务|行政|电商|物流/.test(text);
  return {
    hasRoot:!!root,
    lastDept:last,
    mapHr:map.hr||null,
    mapKeys:Object.keys(map),
    textSnippet:text,
    looksLikeWorkbench: /智能聊天|工作模式|你好，我是/.test(text),
    looksLikeHome: !!document.querySelector('[data-testid="department-scroll-stack"]')
  };
})()`);
console.log('[ui]', JSON.stringify(ui,null,2));

// lobster sessions should not include WS titles
const sessions=await ev(`(async()=>{
  if(!window.electron?.cowork?.listSessions) return {error:'no api'};
  const list=await window.electron.cowork.listSessions({limit:50, offset:0});
  const all=(list.sessions||[]).map(s=>({id:s.id,title:s.title,cwd:s.cwd}));
  const leaked=all.filter(s=>String(s.title||'').startsWith('[WS:') || String(s.cwd||'').replace(/\\\\/g,'/').includes('/workstation/'));
  return {count:all.length, leaked, sample:all.slice(0,5)};
})()`, true);
console.log('[sessions]', JSON.stringify(sessions,null,2));

const reg=path.join(process.env.APPDATA,'Workhorse AI','workstation','_registry','sessions.json');
const regRaw=fs.existsSync(reg)?fs.readFileSync(reg,'utf8'):'';
console.log('[registryStill]', regRaw.slice(0,350));

const hrDir=path.join(process.env.APPDATA,'Workhorse AI','workstation','hr');
const lobsterCowork=path.join(process.env.APPDATA,'Workhorse AI','cowork');
console.log('[dirs]', {hrExists:fs.existsSync(hrDir), coworkExists:fs.existsSync(lobsterCowork)});

// continue hr chat after restart using bridge (should reuse or recreate)
const chat=await ev(`(async()=>{
  const mod=await import('/src/renderer/workstation/services/lobsterChatBridge.ts');
  const r=await mod.startWorkstationChat({departmentId:'hr', prompt:'请只回复：重启后仍可聊', title:'post restart hr'});
  return {ok:true, sessionId:r.sessionId, content:String(r.content||'').slice(0,100), meta:r};
})()`, true);
console.log('[chatAfterRestart]', JSON.stringify(chat,null,2));

if(!ui?.hasRoot) throw new Error('workstation not visible');
if(!ui?.lastDept) throw new Error('last department lost');
if(!ui?.mapHr) throw new Error('session map lost');
if((sessions?.leaked||[]).length) throw new Error('leak after restart');
if(!String(chat?.content||'').includes('重启')) throw new Error('chat after restart failed: '+chat?.content);
console.log('RESTART_PASS');
ws.close();
