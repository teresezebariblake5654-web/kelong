import WebSocket from "ws";
import fs from "node:fs";
import path from "node:path";

const list = await fetch("http://127.0.0.1:9222/json/list").then(r=>r.json());
const page = list.find(p=>p.type==="page" && String(p.url||"").includes("5175")) || list.find(p=>p.type==="page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.once("open",res); ws.once("error",rej);});
let id=0; const pending=new Map();
ws.on("message", raw=>{
  const msg=JSON.parse(String(raw));
  if(msg.id && pending.has(msg.id)){ const {resolve,reject}=pending.get(msg.id); pending.delete(msg.id); if(msg.error) reject(new Error(JSON.stringify(msg.error))); else resolve(msg.result); }
});
const send=(method,params={})=>new Promise((resolve,reject)=>{const i=++id; pending.set(i,{resolve,reject}); ws.send(JSON.stringify({id:i,method,params}));});
const evalExpr = async (expression, awaitPromise=false) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true, userGesture: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result?.value;
};
await send("Runtime.enable");

const health = await evalExpr(`(async()=>{ try{ const r=await fetch('http://localhost:3001/api/health'); return {ok:r.ok, text:await r.text()}; } catch(e){ return {ok:false, error:String(e)} } })()`, true);
console.log("[health from page]", health);

// click retry if present
await evalExpr(`(()=>{ const b=[...document.querySelectorAll('button')].find(x=>/重试/.test(x.textContent||'')); b?.click(); return !!b; })()`);
await new Promise(r=>setTimeout(r,2000));

// scroll cards
const scroll = await evalExpr(`(()=>{
  const sc=document.querySelector('.workstation-scroll');
  if(!sc) return {ok:false};
  const before=sc.scrollTop;
  sc.scrollTop = Math.min(sc.scrollHeight, 600);
  const mid=sc.scrollTop;
  sc.scrollTop = 0;
  return {ok:true, before, mid, after: sc.scrollTop, sh: sc.scrollHeight, ch: sc.clientHeight};
})()`);
console.log("[scroll]", scroll);

// enter hr card (2nd or find by text)
const enter = await evalExpr(`(()=>{
  const buttons=[...document.querySelectorAll('[data-testid="department-scroll-stack"] button')];
  const hr=buttons.find(b=>/人事/.test(b.innerText||'')) || buttons[1] || buttons[0];
  if(!hr) return {ok:false};
  hr.click();
  return {ok:true, label:(hr.innerText||'').slice(0,60)};
})()`);
console.log("[enter]", enter);
await new Promise(r=>setTimeout(r,2000));

const onWorkbench = await evalExpr(`({
  text:(document.body.innerText||'').slice(0,250),
  hasTaskInput: !!document.querySelector('textarea') || !!document.querySelector('[contenteditable="true"]'),
})`);
console.log("[workbench]", onWorkbench);

// real chat via bridge
const chat = await evalExpr(`(async()=>{
  try{
    const mod=await import('/src/renderer/workstation/services/lobsterChatBridge.ts');
    const result=await mod.startWorkstationChat({
      departmentId:'hr',
      prompt:'请只回复四个字：联调成功',
      title:'CDP hr smoke'
    });
    return {ok:true, sessionId:result.sessionId, content:String(result.content||'').slice(0,300)};
  }catch(e){ return {ok:false, error:String(e&&e.message?e.message:e)}; }
})()`, true);
console.log("[chat]", chat);

// upload
const upload = await evalExpr(`(async()=>{
  try{
    const mod=await import('/src/renderer/workstation/services/chat/lobsterChat.service.ts');
    const file=new File(['cdp-upload-'+Date.now()],'cdp-upload.txt',{type:'text/plain'});
    const result=await mod.uploadChatAttachmentViaBackend(file);
    return {ok:true, result};
  }catch(e){ return {ok:false, error:String(e&&e.message?e.message:e)}; }
})()`, true);
console.log("[upload]", upload);

// switch to lobster
const toLobster = await evalExpr(`(()=>{ const b=[...document.querySelectorAll('button')].find(x=>/进入通用智能体/.test(x.textContent||'')); b?.click(); return !!b; })()`);
console.log("[toLobster]", toLobster);
await new Promise(r=>setTimeout(r,1500));

// start a lobster cowork session via coworkService
const lobsterChat = await evalExpr(`(async()=>{
  try{
    const { coworkService } = await import('/src/renderer/services/cowork.ts');
    const result = await coworkService.startSession({ prompt: '请只回复：LOBSTER_OK', title: 'CDP lobster smoke' });
    return { ok: !!result.session, sessionId: result.session?.id || null, error: result.error || null, agentId: result.session?.agentId || null, cwd: result.session?.cwd || null };
  }catch(e){ return {ok:false, error:String(e&&e.message?e.message:e)}; }
})()`, true);
console.log("[lobsterChat]", lobsterChat);

// back to workstation
const back = await evalExpr(`(()=>{ const b=[...document.querySelectorAll('button')].find(x=>/返回AI员工助手/.test(x.textContent||'')); b?.click(); return !!b; })()`);
console.log("[back]", back);
await new Promise(r=>setTimeout(r,1000));

const stillWs = await evalExpr(`!!document.querySelector('.workstation-root')`);
console.log("[stillWs]", stillWs);

// session map from localStorage
const map = await evalExpr(`(()=>{ try{ return JSON.parse(localStorage.getItem('lobsterai.workstation.sessionMap.v1')||'{}'); }catch{return {}} })()`);
console.log("[sessionMap]", map);

const registryPath = path.join(process.env.APPDATA,'Workhorse AI','workstation','_registry','sessions.json');
console.log("[registryExists]", fs.existsSync(registryPath));
if (fs.existsSync(registryPath)) console.log("[registry]", fs.readFileSync(registryPath,'utf8').slice(0,500));

const hrDir = path.join(process.env.APPDATA,'Workhorse AI','workstation','hr');
console.log("[hrDir]", hrDir, fs.existsSync(hrDir), fs.existsSync(hrDir)?fs.readdirSync(hrDir).slice(0,10):[]);

if (!chat?.ok) throw new Error('chat failed: '+chat?.error);
if (!upload?.ok) throw new Error('upload failed: '+upload?.error);
console.log("\\nFULL_ACCEPT_PASS");
ws.close();
