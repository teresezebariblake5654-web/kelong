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

const info=await ev(`(()=>{
  const el=document.querySelector('.uc-shell');
  if(!el) return {missing:true};
  const s=getComputedStyle(el);
  const r=el.getBoundingClientRect();
  const kids=[...el.children].slice(0,8).map(c=>({tag:c.tagName,cls:String(c.className).slice(0,100),text:(c.textContent||'').slice(0,80)}));
  // try click brand home
  const home=[...document.querySelectorAll('button')].find(b=>b.textContent?.trim()==='AI员工助手');
  // what is under various points
  const pts=[
    [100,100],[400,200],[700,400],[window.innerWidth/2, window.innerHeight/2],[200,700]
  ].map(([x,y])=>{
    const e=document.elementFromPoint(x,y);
    return {x,y, tag:e&&(e.tagName+'.'+String(e.className).slice(0,60)), pe:e&&getComputedStyle(e).pointerEvents};
  });
  return {
    cls:el.className,
    pe:s.pointerEvents, z:s.zIndex, pos:s.position, op:s.opacity, display:s.display,
    rect:{w:r.width,h:r.height,t:r.top,l:r.left},
    html:el.outerHTML.slice(0,500),
    kids,
    pts,
    parent: el.parentElement && (el.parentElement.tagName+'.'+String(el.parentElement.className).slice(0,80))
  };
})()`);
console.log(JSON.stringify(info,null,2));

// Try clicking department card / home navigation and see if handlers fire
const clickTest=await ev(`(()=>{
  const stack=document.querySelector('[data-testid="department-scroll-stack"]');
  const cards=stack?[...stack.querySelectorAll('button.dept-card')]:[];
  const enter=[...document.querySelectorAll('button')].find(b=>/进入通用智能体/.test(b.textContent||''));
  // simulate click on enter
  let entered=false;
  if(enter){ enter.click(); entered=true; }
  return {hasStack:!!stack, cardCount:cards.length, clickedEnter:entered, afterText:(document.body.innerText||'').slice(0,120)};
})()`);
console.log('clickTest', JSON.stringify(clickTest,null,2));
await new Promise(r=>setTimeout(r,800));
const after=await ev(`({hasWs:!!document.querySelector('.workstation-root'), text:(document.body.innerText||'').slice(0,150), mainHint:[...document.querySelectorAll('button')].some(b=>/返回企业/.test(b.textContent||''))})`);
console.log('after', after);
ws.close();
