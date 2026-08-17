import WebSocket from "ws";
const list=await fetch("http://127.0.0.1:9222/json/list").then(r=>r.json());
const page=list.find(p=>p.type==="page"&&String(p.url||"").includes("5175"))||list.find(p=>p.type==="page");
if(!page) throw new Error("no page");
const ws=new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.once("open",res);ws.once("error",rej);});
let id=0; const pending=new Map(); const logs=[];
ws.on("message",raw=>{
  const msg=JSON.parse(String(raw));
  if(msg.id&&pending.has(msg.id)){const {resolve,reject}=pending.get(msg.id); pending.delete(msg.id); if(msg.error) reject(new Error(JSON.stringify(msg.error))); else resolve(msg.result);}
  if(msg.method==="Runtime.consoleAPICalled"){
    const t=msg.params?.type;
    const text=(msg.params?.args||[]).map(a=>a.value??a.description??"").join(" ");
    if(t==="error"||t==="warning") logs.push({t,text:String(text).slice(0,300)});
  }
  if(msg.method==="Runtime.exceptionThrown"){
    logs.push({t:"exception",text:String(msg.params?.exceptionDetails?.exception?.description||msg.params?.exceptionDetails?.text||"").slice(0,500)});
  }
});
const send=(m,p={})=>new Promise((resolve,reject)=>{const i=++id; pending.set(i,{resolve,reject}); ws.send(JSON.stringify({id:i,method:m,params:p}));});
const ev=async(expression,awaitPromise=false)=>{const r=await send("Runtime.evaluate",{expression,awaitPromise,returnByValue:true,userGesture:true}); if(r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result?.value;};
await send("Runtime.enable");
await send("Console.enable");
await send("Page.enable");

const snap=await ev(`(()=>{
  const wsRoot=document.querySelector('.workstation-root');
  const overlays=[...document.querySelectorAll('body *')].filter(el=>{
    const s=getComputedStyle(el);
    if(s.pointerEvents==='none' || s.display==='none' || s.visibility==='hidden') return false;
    const r=el.getBoundingClientRect();
    if(r.width<100||r.height<100) return false;
    const z=parseInt(s.zIndex||'0',10);
    const fixed=s.position==='fixed'||s.position==='absolute';
    const covers=r.top<=10 && r.left<=10 && r.right>=window.innerWidth-10 && r.bottom>=window.innerHeight-10;
    return covers && (fixed || z>=10);
  }).slice(0,15).map(el=>({
    tag:el.tagName, id:el.id, cls:String(el.className).slice(0,120),
    pe:getComputedStyle(el).pointerEvents, z:getComputedStyle(el).zIndex,
    pos:getComputedStyle(el).position, op:getComputedStyle(el).opacity,
    display:getComputedStyle(el).display
  }));
  const center=document.elementFromPoint(window.innerWidth/2, window.innerHeight/2);
  const homeBtn=[...document.querySelectorAll('button,a,[role=button]')].filter(b=>/进入|岗位|部门|生产|人事|通用/.test(b.textContent||'')).slice(0,8).map(b=>({
    text:(b.textContent||'').trim().slice(0,40),
    pe:getComputedStyle(b).pointerEvents,
    disabled:b.disabled,
    rect:(()=>{const r=b.getBoundingClientRect(); return {w:r.width,h:r.height,t:r.top,l:r.left};})()
  }));
  const pin=document.querySelector('.pin-spacer, [class*=pin-spacer]');
  const gsapPinned=[...document.querySelectorAll('.workstation-root *')].filter(el=>el.style&&/translate/i.test(el.style.transform||'')).length;
  return {
    mainViewHint: (document.body.innerText||'').slice(0,200),
    hasWorkstation:!!wsRoot,
    wsDisplay: wsRoot?getComputedStyle(wsRoot).display:null,
    wsPe: wsRoot?getComputedStyle(wsRoot).pointerEvents:null,
    wsVisibility: wsRoot?getComputedStyle(wsRoot.parentElement||wsRoot).visibility:null,
    centerTag: center&&(center.tagName+'.'+String(center.className).slice(0,80)),
    overlays,
    homeBtn,
    pin:!!pin,
    href:location.href
  };
})()`);
console.log(JSON.stringify(snap,null,2));
console.log('LOGS', JSON.stringify(logs.slice(-20),null,2));
ws.close();
