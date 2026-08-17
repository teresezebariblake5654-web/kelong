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
// ensure on home
await ev(`(()=>{const a=document.querySelector('a[href="/"]'); a?.click(); return !!a;})()`);
await new Promise(r=>setTimeout(r,800));
const before=await ev(`(()=>{
  const root=document.querySelector('.workstation-root');
  const scroll=document.querySelector('.workstation-scroll');
  const cards=[...document.querySelectorAll('[data-dept-card], .dept-card, [class*="Department"]')];
  const stack=document.querySelector('[class*="scroll"], .workstation-scroll');
  const transforms=[...document.querySelectorAll('.workstation-root [style*="transform"]')].slice(0,8).map(el=>({t:el.style.transform, op:el.style.opacity, z:el.style.zIndex}));
  const st=window.ScrollTrigger || (window.gsap && window.gsap.core?.globals?.()?.ScrollTrigger);
  return {
    hasRoot:!!root,
    scrollH: scroll?.scrollHeight||0,
    clientH: scroll?.clientHeight||0,
    scrollTop: scroll?.scrollTop||0,
    cardCount: document.querySelectorAll('.workstation-root [data-department], .workstation-home [class*="card"]').length,
    transformCount: transforms.length,
    transforms,
    text: (root?.innerText||'').slice(0,200)
  };
})()`);
console.log('[before]', JSON.stringify(before,null,2));
// scroll
await ev(`(()=>{const s=document.querySelector('.workstation-scroll'); if(s){s.scrollTop=Math.min(s.scrollHeight, 600); s.dispatchEvent(new Event('scroll'));} return s?.scrollTop;})()`);
await new Promise(r=>setTimeout(r,500));
const mid=await ev(`(()=>{
  const transforms=[...document.querySelectorAll('.workstation-root [style*="transform"]')].slice(0,10).map(el=>({t:el.style.transform, op:el.style.opacity}));
  const s=document.querySelector('.workstation-scroll');
  return {scrollTop:s?.scrollTop, transforms};
})()`);
console.log('[mid]', JSON.stringify(mid,null,2));
await ev(`(()=>{const s=document.querySelector('.workstation-scroll'); if(s){s.scrollTop=Math.min(s.scrollHeight, 1400);} return s?.scrollTop;})()`);
await new Promise(r=>setTimeout(r,500));
const after=await ev(`(()=>{
  const transforms=[...document.querySelectorAll('.workstation-root [style*="transform"]')].slice(0,10).map(el=>({t:el.style.transform, op:el.style.opacity}));
  return {scrollTop:document.querySelector('.workstation-scroll')?.scrollTop, transforms};
})()`);
console.log('[after]', JSON.stringify(after,null,2));
// leave page and check cleanup
await ev(`(()=>{const links=[...document.querySelectorAll('a')].filter(a=>/hr|人事|department/i.test(a.href+a.textContent)); links[0]?.click(); return links[0]?.href||links[0]?.textContent;})()`);
await new Promise(r=>setTimeout(r,1000));
const left=await ev(`!!document.querySelector('.workstation-scroll')`);
console.log('[leftHome]', !left, 'scrollExists', left);
console.log('GSAP_CHECK_DONE');
ws.close();
