import WebSocket from "ws";
const list=await fetch("http://127.0.0.1:9222/json/list").then(r=>r.json());
const page=list.find(p=>p.type==="page"&&String(p.url||"").includes("5175"))||list.find(p=>p.type==="page");
const ws=new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.once("open",res);ws.once("error",rej);});
let id=0; const pending=new Map();
ws.on("message",raw=>{const msg=JSON.parse(String(raw)); if(msg.id&&pending.has(msg.id)){const {resolve,reject}=pending.get(msg.id); pending.delete(msg.id); if(msg.error) reject(new Error(JSON.stringify(msg.error))); else resolve(msg.result);}});
const send=(m,p={})=>new Promise((resolve,reject)=>{const i=++id; pending.set(i,{resolve,reject}); ws.send(JSON.stringify({id:i,method:m,params:p}));});
const ev=async(expression,awaitPromise=false)=>{const r=await send("Runtime.evaluate",{expression,awaitPromise,returnByValue:true,userGesture:true}); if(r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result?.value;};
await send("Runtime.enable");
await send("Page.reload",{ignoreCache:true});
await new Promise(r=>setTimeout(r,2500));

const closed=await ev(`(async()=>{
  const mod=await import('/src/renderer/workstation/state/userCenterStore.ts');
  mod.useUserCenterStore.getState().closeUserCenter();
  return mod.useUserCenterStore.getState().open;
})()`, true);
console.log('openAfterClose', closed);

// go home
await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent?.trim()==='AI员工助手'); b?.click(); return !!b;})()`);
await new Promise(r=>setTimeout(r,800));

const check=await ev(`(()=>{
  const shell=document.querySelector('.uc-shell');
  const open=shell?.classList.contains('uc-shell--open');
  const pe=shell&&getComputedStyle(shell).pointerEvents;
  const mid=document.elementFromPoint(window.innerWidth/2, window.innerHeight/2);
  const stack=document.querySelector('[data-testid="department-scroll-stack"]');
  const card=stack?.querySelector('button.dept-card');
  return {
    open, pe,
    mid: mid&&(mid.tagName+'.'+String(mid.className).slice(0,60)),
    hasStack:!!stack,
    cardPe: card&&getComputedStyle(card).pointerEvents
  };
})()`);
console.log(JSON.stringify(check,null,2));
if(check?.open) throw new Error('still open');
if(check?.pe!=='none') throw new Error('shell still capturing: '+check?.pe);
console.log('UC_FIX_OK');
ws.close();
