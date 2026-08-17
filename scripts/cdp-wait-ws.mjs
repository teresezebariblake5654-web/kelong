import WebSocket from "ws";
const list = await fetch("http://127.0.0.1:9222/json/list").then(r=>r.json());
const page = list.find(p=>p.type==="page" && String(p.url||"").includes("5175")) || list.find(p=>p.type==="page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.once("open",res); ws.once("error",rej);});
let id=0; const pending=new Map();
ws.on("message", raw=>{
  const msg=JSON.parse(String(raw));
  if(msg.method==="Runtime.exceptionThrown") console.log("[ex]", JSON.stringify(msg.params.exceptionDetails).slice(0,500));
  if(msg.id && pending.has(msg.id)){ const {resolve,reject}=pending.get(msg.id); pending.delete(msg.id); if(msg.error) reject(new Error(JSON.stringify(msg.error))); else resolve(msg.result); }
});
const send=(method,params={})=>new Promise((resolve,reject)=>{const i=++id; pending.set(i,{resolve,reject}); ws.send(JSON.stringify({id:i,method,params}));});
await send("Runtime.enable");
for (let i=0;i<60;i++){
  const st = await send("Runtime.evaluate",{expression:`({
    hasWS: !!document.querySelector('.workstation-root'),
    cards: document.querySelectorAll('[data-testid="department-scroll-stack"] button').length,
    text: (document.body.innerText||'').slice(0,180),
    rootClass: document.querySelector('#root')?.firstElementChild?.className || null
  })`, returnByValue:true});
  console.log("t+"+i+"s", st.result.value);
  if (st.result.value?.hasWS) { console.log("FOUND_WS"); break; }
  await new Promise(r=>setTimeout(r,2000));
}
ws.close();
