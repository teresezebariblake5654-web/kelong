import WebSocket from 'ws';

const list = await fetch('http://127.0.0.1:9222/json/list').then((r) => r.json());
const page =
  list.find((p) => p.type === 'page' && String(p.url || '').includes('5175')) ||
  list.find((p) => p.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.once('open', res);
  ws.once('error', rej);
});
let id = 0;
const pending = new Map();
const logs = [];
ws.on('message', (raw) => {
  const msg = JSON.parse(String(raw));
  if (msg.method === 'Runtime.consoleAPICalled') {
    const vals = (msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
    logs.push(['console', msg.params.type, String(vals).slice(0, 400)]);
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    logs.push(['exception', JSON.stringify(msg.params.exceptionDetails).slice(0, 800)]);
  }
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(JSON.stringify(msg.error)));
    else resolve(msg.result);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const i = ++id;
    pending.set(i, { resolve, reject });
    ws.send(JSON.stringify({ id: i, method, params }));
  });

await send('Runtime.enable');
await send('Page.enable');
await send('Page.reload', { ignoreCache: true });

for (let i = 0; i < 45; i += 1) {
  await new Promise((r) => setTimeout(r, 2000));
  const st = await send('Runtime.evaluate', {
    expression: `({
      hasSplash: !!document.querySelector('.splash'),
      hasWorkstation: !!document.querySelector('.workstation-root'),
      hasReact: !!(window.__REACT_DEVTOOLS_GLOBAL_HOOK__ || document.querySelector('#root')?.childElementCount),
      rootClass: document.querySelector('#root')?.firstElementChild?.className || null,
      text: (document.body.innerText||'').slice(0,120),
    })`,
    returnByValue: true,
  });
  console.log('t+' + i * 2 + 's', st.result.value);
  if (st.result.value?.hasWorkstation || (st.result.value?.rootClass && st.result.value.rootClass !== 'splash')) {
    break;
  }
}

console.log('--- recent logs ---');
for (const row of logs.slice(-30)) console.log(row.join(' | '));
ws.close();
