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

const r=await ev(`(async()=>{
  const mod=await import('/src/renderer/workstation/state/userCenterStore.ts');
  // open then click backdrop area
  mod.useUserCenterStore.getState().openUserCenter();
  await new Promise(r=>setTimeout(r,200));
  const shell=document.querySelector('.uc-shell');
  const peShell=getComputedStyle(shell).pointerEvents;
  const peDrawer=getComputedStyle(document.querySelector('.uc-drawer')).pointerEvents;
  const peBack=getComputedStyle(document.querySelector('.uc-backdrop')).pointerEvents;
  // click center (should hit backdrop, close)
  document.querySelector('.uc-backdrop')?.click();
  await new Promise(r=>setTimeout(r,150));
  const openAfter=mod.useUserCenterStore.getState().open;
  // open again and click a dept tab / enter lobster while open - center should pass through shell
  mod.useUserCenterStore.getState().openUserCenter();
  await new Promise(r=>setTimeout(r,100));
  const mid=document.elementFromPoint(Math.floor(window.innerWidth*0.7), Math.floor(window.innerHeight*0.5));
  // close for user
  mod.useUserCenterStore.getState().closeUserCenter();
  return {peShell, peDrawer, peBack, openAfter, mid: mid&&(mid.tagName+'.'+String(mid.className).slice(0,70)), closed:!mod.useUserCenterStore.getState().open};
})()`, true);
console.log(JSON.stringify(r,null,2));
if(r.openAfter!==false) throw new Error('backdrop did not close');
if(r.peShell!=='none') throw new Error('shell pe');
console.log('CLICKPATH_OK');
ws.close();
