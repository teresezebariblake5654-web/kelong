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

// go home via header brand button
await ev(`(()=>{
  const btns=[...document.querySelectorAll('.workstation-root button')];
  const home=btns.find(b=>b.textContent?.trim()==='AI员工助手');
  home?.click();
  return home?.textContent;
})()`);
await new Promise(r=>setTimeout(r,1000));

const snap=await ev(`(()=>{
  const stack=document.querySelector('[data-testid="department-scroll-stack"]');
  const scroll=document.querySelector('.workstation-scroll');
  const cards=[...document.querySelectorAll('[data-testid="department-scroll-stack"] button.dept-card')];
  const transforms=cards.map((el,i)=>({i, name:el.querySelector('div')?.textContent, t:getComputedStyle(el).transform, op:getComputedStyle(el).opacity, z:getComputedStyle(el).zIndex}));
  return {
    hasStack:!!stack,
    scrollH:scroll?.scrollHeight, clientH:scroll?.clientHeight, scrollTop:scroll?.scrollTop,
    cardCount:cards.length,
    transforms,
    stCount: (window.ScrollTrigger? ScrollTrigger.getAll().length : 'no-global')
  };
})()`);
console.log('[home]', JSON.stringify(snap,null,2));

if(!snap?.hasStack) throw new Error('no stack on home');

// scroll progressively and sample transforms
const samples=[];
for (const top of [200,500,900,1400,2000]) {
  await ev(`(()=>{const s=document.querySelector('.workstation-scroll'); s.scrollTop=${top}; return s.scrollTop;})()`);
  await new Promise(r=>setTimeout(r,400));
  const s=await ev(`(()=>{
    const scroll=document.querySelector('.workstation-scroll');
    const cards=[...document.querySelectorAll('[data-testid="department-scroll-stack"] button.dept-card')];
    return {
      scrollTop:scroll?.scrollTop,
      cards:cards.map((el,i)=>({i,name:(el.innerText||'').split('\\n')[0], t:getComputedStyle(el).transform, op:Number(getComputedStyle(el).opacity).toFixed(2)}))
    };
  })()`);
  samples.push(s);
  console.log('[scroll', top, ']', JSON.stringify(s));
}

// uniqueness: at mid scroll, one card should be most opaque / near identity
const mid=samples[2];
const ops=(mid?.cards||[]).map(c=>Number(c.op));
const maxOp=Math.max(...ops);
const prominent=ops.filter(o=>o>=maxOp-0.05).length;
console.log('[prominentNearMax]', prominent, 'maxOp', maxOp);

// leave home -> cleanup
await ev(`(()=>{const cards=[...document.querySelectorAll('[data-testid="department-scroll-stack"] button.dept-card')]; cards[0]?.click(); return cards[0]?.innerText?.slice(0,40);})()`);
await new Promise(r=>setTimeout(r,800));
const afterLeave=await ev(`(()=>{
  const stack=document.querySelector('[data-testid="department-scroll-stack"]');
  return {stackGone:!stack, st: typeof ScrollTrigger!=='undefined' ? ScrollTrigger.getAll().length : 'n/a'};
})()`);
console.log('[afterLeave]', afterLeave);

const changed=samples.some(s=> (s.cards||[]).some(c=>c.t && c.t!=='none' && c.t!=='matrix(1, 0, 0, 1, 0, 0)'));
const scrolled=samples.some(s=> (s.scrollTop||0) > 0);
console.log({changed, scrolled, prominent});
if(!scrolled) throw new Error('scroll not working');
if(!changed) throw new Error('GSAP transforms not changing');
if(!afterLeave.stackGone) throw new Error('stack still mounted after leave');
console.log('GSAP_PASS');
ws.close();
