import WebSocket from "ws";
const list=await fetch("http://127.0.0.1:9222/json/list").then(r=>r.json());
const page=list.find(p=>p.type==="page")||list[0];
const ws=new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.once("open",res);ws.once("error",rej);});
let id=0; const pending=new Map();
ws.on("message",raw=>{const msg=JSON.parse(String(raw)); if(msg.id&&pending.has(msg.id)){const {resolve,reject}=pending.get(msg.id); pending.delete(msg.id); if(msg.error) reject(new Error(JSON.stringify(msg.error))); else resolve(msg.result);}});
const send=(m,p={})=>new Promise((resolve,reject)=>{const i=++id; pending.set(i,{resolve,reject}); ws.send(JSON.stringify({id:i,method:m,params:p}));});
const ev=async(expression)=>{const r=await send("Runtime.evaluate",{expression,returnByValue:true}); if(r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result?.value;};
await send("Runtime.enable");
const snap=await ev(`({
  title: document.title,
  hasLobster: /LobsterAI/i.test(document.body.innerText||''),
  hasWorkhorse: /Workhorse AI/i.test(document.body.innerText||''),
  sample: (document.body.innerText||'').split(/\\n/).filter(l=>/Workhorse|Lobster/i.test(l)).slice(0,8)
})`);
console.log(JSON.stringify(snap,null,2));
ws.close();
