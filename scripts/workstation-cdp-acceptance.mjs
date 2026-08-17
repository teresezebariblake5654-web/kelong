/**
 * CDP-driven runtime acceptance for workstation inside Workhorse AI Electron.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import WebSocket from 'ws';

const CDP_LIST = 'http://127.0.0.1:9222/json/list';
const userData = path.join(process.env.APPDATA || '', 'Workhorse AI');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getPageWsUrl() {
  const list = await fetch(CDP_LIST).then((r) => r.json());
  const page = list.find((p) => p.type === 'page' && p.url?.includes('5175')) || list.find((p) => p.type === 'page');
  if (!page?.webSocketDebuggerUrl) throw new Error('No CDP page target');
  return page.webSocketDebuggerUrl;
}

class Cdp {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.id = 0;
    this.pending = new Map();
  }
  async connect() {
    this.ws = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.ws.once('open', resolve);
      this.ws.once('error', reject);
    });
    this.ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression, awaitPromise = true) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || JSON.stringify(result.exceptionDetails));
    }
    return result.result?.value;
  }
  close() {
    this.ws?.close();
  }
}

async function main() {
  const wsUrl = await getPageWsUrl();
  const cdp = new Cdp(wsUrl);
  await cdp.connect();
  await cdp.send('Runtime.enable');

  // Wait for React app + workstation root
  let ready = false;
  for (let i = 0; i < 60; i += 1) {
    const state = await cdp.eval(`(() => {
      const root = document.querySelector('.workstation-root');
      const cards = document.querySelectorAll('[data-testid="department-scroll-stack"] button, .dept-card');
      return {
        hasRoot: !!root,
        cardCount: cards.length,
        title: document.title,
        bodyText: (document.body?.innerText || '').slice(0, 200),
      };
    })()`, false);
    console.log('[poll]', state);
    if (state?.hasRoot || (state?.bodyText || '').includes('AI员工助手') || (state?.bodyText || '').includes('工作智能体')) {
      ready = true;
      break;
    }
    // Maybe welcome dialog still up — try dismiss/custom model if visible
    await cdp.eval(`(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const custom = buttons.find(b => /自定义模型|Custom model|custom/i.test(b.textContent || ''));
      const login = buttons.find(b => /登录|Login/i.test(b.textContent || ''));
      // Prefer skipping welcome if already configured: click backdrop? else leave
      return { custom: !!custom, login: !!login, btnCount: buttons.length };
    })()`, false);
    await sleep(1000);
  }
  if (!ready) {
    // Force navigate mainView via localStorage/React is hard; try clicking nothing and report DOM
    const html = await cdp.eval(`document.body.innerHTML.slice(0, 1500)`, false);
    console.log('[dom snippet]', html);
    throw new Error('Workstation UI not visible after wait');
  }
  console.log('[ok] workstation UI visible');

  // GSAP stack presence
  const gsapInfo = await cdp.eval(`(() => {
    const stack = document.querySelector('[data-testid="department-scroll-stack"]');
    const cards = stack ? Array.from(stack.querySelectorAll('button.dept-card, button')) : [];
    const scroll = document.querySelector('.workstation-scroll');
    return {
      hasStack: !!stack,
      cards: cards.map(c => (c.innerText || '').split('\\n')[0]).slice(0, 8),
      hasScroller: !!scroll,
      scrollHeight: scroll ? scroll.scrollHeight : 0,
      clientHeight: scroll ? scroll.clientHeight : 0,
    };
  })()`, false);
  console.log('[gsap]', gsapInfo);
  if (!gsapInfo?.hasStack || (gsapInfo.cards?.length || 0) < 2) {
    throw new Error('GSAP department stack missing or too few cards');
  }
  console.log('[ok] GSAP cards present');

  // Scroll the workstation scroller to exercise ScrollTrigger
  await cdp.eval(`(() => {
    const scroll = document.querySelector('.workstation-scroll');
    if (!scroll) return false;
    scroll.scrollTop = Math.min(scroll.scrollHeight, scroll.clientHeight + 400);
    return true;
  })()`, false);
  await sleep(500);
  await cdp.eval(`(() => {
    const scroll = document.querySelector('.workstation-scroll');
    if (!scroll) return false;
    scroll.scrollTop = 0;
    return true;
  })()`, false);
  console.log('[ok] scrolled stack both directions');

  // Enter first department card
  const entered = await cdp.eval(`(() => {
    const stack = document.querySelector('[data-testid="department-scroll-stack"]');
    const btn = stack?.querySelector('button');
    if (!btn) return { ok: false, reason: 'no button' };
    btn.click();
    return { ok: true, label: (btn.innerText || '').slice(0, 40) };
  })()`, false);
  console.log('[enter]', entered);
  await sleep(1500);

  // Send chat via lobsterChatBridge (real OpenClaw path)
  const chat = await cdp.eval(`(async () => {
    try {
      const mod = await import('/src/renderer/workstation/services/lobsterChatBridge.ts');
      const departmentId = 'hr';
      const result = await mod.startWorkstationChat({
        departmentId,
        prompt: '请只回复：工作站联调成功',
        title: 'CDP smoke hr',
      });
      return {
        ok: true,
        sessionId: result.sessionId,
        contentPreview: String(result.content || '').slice(0, 200),
        map: mod.getBoundWorkstationSessionId?.(departmentId) || null,
      };
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e) };
    }
  })()`, true);
  console.log('[chat]', chat);
  if (!chat?.ok) throw new Error(`chat failed: ${chat?.error || 'unknown'}`);
  console.log('[ok] workstation chat via OpenClaw');

  // Upload via lobster chat service helper
  const upload = await cdp.eval(`(async () => {
    try {
      const mod = await import('/src/renderer/workstation/services/chat/lobsterChat.service.ts');
      const file = new File(['cdp upload ' + Date.now()], 'cdp-upload.txt', { type: 'text/plain' });
      const result = await mod.uploadChatAttachmentViaBackend(file);
      return { ok: true, result };
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e) };
    }
  })()`, true);
  console.log('[upload]', upload);
  if (!upload?.ok) throw new Error(`upload failed: ${upload?.error || 'unknown'}`);
  console.log('[ok] file upload');

  // Switch to lobster view if button exists
  await cdp.eval(`(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const enter = buttons.find(b => /进入通用智能体/.test(b.textContent || ''));
    enter?.click();
    return !!enter;
  })()`, false);
  await sleep(1000);
  console.log('[ok] switched toward lobster (if button present)');

  // Return to workstation
  await cdp.eval(`(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const back = buttons.find(b => /返回AI员工助手/.test(b.textContent || ''));
    back?.click();
    return !!back;
  })()`, false);
  await sleep(1000);

  // Registry persistence
  const registryPath = path.join(userData, 'workstation', '_registry', 'sessions.json');
  let registry = null;
  if (fs.existsSync(registryPath)) {
    registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  }
  console.log('[registry]', registryPath, registry ? JSON.stringify(registry).slice(0, 400) : 'missing');

  // Isolation dirs
  for (const dept of ['hr', 'finance']) {
    const p = path.join(userData, 'workstation', dept);
    console.log('[cwd]', p, 'exists=', fs.existsSync(p));
  }

  cdp.close();
  console.log('\nCDP_ACCEPTANCE_PASS');
}

main().catch((err) => {
  console.error('CDP_ACCEPTANCE_FAIL', err);
  process.exit(1);
});
