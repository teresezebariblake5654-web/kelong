import WebSocket from "ws";
const list = await fetch("http://127.0.0.1:9222/json/list").then((r) => r.json());
const page = list.find((p) => p.type === "page" && String(p.url || "").includes("5175")) || list.find((p) => p.type === "page");
if (!page) throw new Error("no page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
let id = 0;
const pending = new Map();
ws.on("message", (raw) => {
  const msg = JSON.parse(String(raw));
  if (msg.method === "Runtime.consoleAPICalled") {
    const vals = (msg.params.args || []).map((a) => a.value ?? a.description ?? "").join(" ");
    console.log("[console]", msg.params.type, String(vals).slice(0, 500));
  }
  if (msg.method === "Runtime.exceptionThrown") {
    console.log("[exception]", JSON.stringify(msg.params.exceptionDetails).slice(0, 1000));
  }
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(JSON.stringify(msg.error)));
    else resolve(msg.result);
  }
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const i = ++id;
  pending.set(i, { resolve, reject });
  ws.send(JSON.stringify({ id: i, method, params }));
});
await send("Runtime.enable");
await send("Page.enable");
const before = await send("Runtime.evaluate", { expression: "({ rootChild: document.querySelector('#root')?.firstElementChild?.className || null, text: (document.body.innerText||'').slice(0,120) })", returnByValue: true });
console.log("before", before.result.value);
await send("Page.reload", { ignoreCache: true });
await new Promise((r) => setTimeout(r, 15000));
const after = await send("Runtime.evaluate", { expression: "({ rootChild: document.querySelector('#root')?.firstElementChild?.className || null, text: (document.body.innerText||'').slice(0,250), hasWorkstation: !!document.querySelector('.workstation-root'), hasSplash: !!document.querySelector('.splash') })", returnByValue: true });
console.log("after", after.result.value);
ws.close();
