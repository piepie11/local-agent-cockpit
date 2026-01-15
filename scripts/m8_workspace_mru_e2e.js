/**
 * M8 e2e (UI): Workspace dropdown MRU ordering.
 *
 * Goal:
 * - Create 3 workspaces
 * - Verify initial order is store order (updatedAt desc)
 * - Select ws1 -> dropdown moves ws1 to top
 * - Select ws2 -> dropdown order becomes ws2, ws1, ws3 (MRU)
 * - Reload -> order persists
 *
 * Requires: Chrome (for headless CDP)
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { setTimeout: sleep } = require('timers/promises');

const { writeRunEnv } = require('../src/lib/run_env');

function getTimestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(
    now.getSeconds()
  )}`;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function jsonHeaders(token) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers['x-admin-token'] = token;
  return headers;
}

async function fetchJsonExpect(baseUrl, url, options, expectedStatus) {
  const res = await fetch(`${baseUrl}${url}`, options);
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  if (expectedStatus !== undefined) {
    assert(res.status === expectedStatus, `Expected ${expectedStatus}, got ${res.status} for ${url}: ${text}`);
  } else {
    assert(res.ok, `HTTP ${res.status} for ${url}: ${text}`);
  }
  return { res, body, text };
}

async function waitForChromeReady(port, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  const url = `http://127.0.0.1:${port}/json/version`;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {}
    await sleep(100);
  }
  throw new Error(`CHROME_DEBUG_PORT_NOT_READY port=${port}`);
}

function resolveChromePath() {
  const candidates = [process.env.CHROME_PATH, process.env.CHROME_BIN].filter(Boolean);
  const winDefault = path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe');
  if (fs.existsSync(winDefault)) candidates.push(winDefault);
  const winX86 = path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe');
  if (fs.existsSync(winX86)) candidates.push(winX86);
  const first = candidates.find((p) => p && fs.existsSync(p));
  if (!first) throw new Error('CHROME_PATH_NOT_FOUND');
  return first;
}

async function findExistingTarget(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!res.ok) throw new Error(`CDP_TARGET_LIST_FAILED status=${res.status}`);
  const items = await res.json();
  const page = (items || []).find((t) => t.type === 'page' && t.webSocketDebuggerUrl) || (items || [])[0];
  if (!page || !page.webSocketDebuggerUrl) throw new Error('CDP_TARGET_WS_MISSING');
  return page.webSocketDebuggerUrl;
}

function connectCdp(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    const eventWaiters = new Map();
    let nextId = 1;

    function send(method, params) {
      const id = nextId++;
      const payload = JSON.stringify({ id, method, params });
      return new Promise((resolveSend, rejectSend) => {
        pending.set(id, { resolve: resolveSend, reject: rejectSend, method });
        ws.send(payload);
      });
    }

    function waitForEvent(method, timeoutMs = 5000) {
      return new Promise((resolveWait, rejectWait) => {
        const timer = setTimeout(() => {
          rejectWait(new Error(`CDP_EVENT_TIMEOUT ${method}`));
        }, timeoutMs);
        const list = eventWaiters.get(method) || [];
        list.push((params) => {
          clearTimeout(timer);
          resolveWait(params);
        });
        eventWaiters.set(method, list);
      });
    }

    async function evalExpr(expression, { awaitPromise = false } = {}) {
      const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
      if (res.exceptionDetails) {
        throw new Error(`CDP_EVAL_ERROR ${res.exceptionDetails.text || 'unknown'}`);
      }
      return res.result ? res.result.value : null;
    }

    ws.onmessage = (evt) => {
      let msg;
      try {
        msg = JSON.parse(evt.data);
      } catch {
        return;
      }
      if (msg.id) {
        const handler = pending.get(msg.id);
        if (!handler) return;
        pending.delete(msg.id);
        if (msg.error) handler.reject(new Error(`CDP_ERROR ${handler.method}: ${msg.error.message || 'unknown'}`));
        else handler.resolve(msg.result);
        return;
      }
      if (msg.method) {
        const list = eventWaiters.get(msg.method);
        if (list && list.length) {
          const next = list.shift();
          if (next) next(msg.params);
        }
      }
    };

    ws.onerror = (err) => reject(err);
    ws.onopen = () => resolve({ send, waitForEvent, evalExpr, close: () => ws.close() });
  });
}

async function waitForCondition(evalFn, { timeoutMs = 5000, intervalMs = 100, label = '' } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await evalFn();
    if (last) return last;
    await sleep(intervalMs);
  }
  const prefix = label ? `CDP_WAIT_TIMEOUT ${label}` : 'CDP_WAIT_TIMEOUT';
  throw new Error(`${prefix} last=${JSON.stringify(last)}`);
}

async function main() {
  const projectRoot = path.resolve(__dirname, '..');
  const runsRoot = path.join(projectRoot, 'runs');
  const outDir = path.join(runsRoot, `workspace-mru-e2e-${getTimestamp()}`);
  fs.mkdirSync(outDir, { recursive: true });
  await writeRunEnv({ outDir, cwd: projectRoot, extra: { kind: 'script', script: 'm8_workspace_mru_e2e' } });

  const token = `test-token-${Math.random().toString(16).slice(2)}`;

  const allowedRoot = path.join(outDir, 'allowed_root');
  const wsRoot1 = path.join(allowedRoot, 'ws1');
  const wsRoot2 = path.join(allowedRoot, 'ws2');
  const wsRoot3 = path.join(allowedRoot, 'ws3');
  [wsRoot1, wsRoot2, wsRoot3].forEach((p) => fs.mkdirSync(p, { recursive: true }));
  [wsRoot1, wsRoot2, wsRoot3].forEach((p) => fs.writeFileSync(path.join(p, 'plan.md'), `# ${path.basename(p)} plan\n`, 'utf-8'));

  const dbPath = path.join(outDir, 'app.sqlite');
  const runsDir = path.join(outDir, 'runs_artifacts');

  process.env.HOST = '127.0.0.1';
  process.env.PORT = '0';
  process.env.ADMIN_TOKEN = token;
  process.env.ALLOWED_WORKSPACE_ROOTS = allowedRoot;
  process.env.DB_PATH = dbPath;
  process.env.RUNS_DIR = runsDir;
  process.env.MAX_CONCURRENT_RUNS = '1';
  process.env.READ_ONLY_MODE = 'false';
  process.env.PUSH_NOTIFICATIONS_ENABLED = 'false';
  process.env.PUSHPLUS_TOKEN = '';

  const { createServer } = require('../src/server');
  const { app } = createServer();
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  let chrome = null;
  let cdp = null;
  try {
    const w1 = await fetchJsonExpect(
      baseUrl,
      '/api/workspaces',
      { method: 'POST', headers: jsonHeaders(token), body: JSON.stringify({ name: 'ws1', rootPath: wsRoot1 }) },
      201
    );
    const w2 = await fetchJsonExpect(
      baseUrl,
      '/api/workspaces',
      { method: 'POST', headers: jsonHeaders(token), body: JSON.stringify({ name: 'ws2', rootPath: wsRoot2 }) },
      201
    );
    const w3 = await fetchJsonExpect(
      baseUrl,
      '/api/workspaces',
      { method: 'POST', headers: jsonHeaders(token), body: JSON.stringify({ name: 'ws3', rootPath: wsRoot3 }) },
      201
    );

    const ws1Id = String(w1.body?.id || '').trim();
    const ws2Id = String(w2.body?.id || '').trim();
    const ws3Id = String(w3.body?.id || '').trim();
    assert(ws1Id && ws2Id && ws3Id, 'workspace ids missing');

    const chromePath = resolveChromePath();
    const debugPort = 9222 + Math.floor(Math.random() * 400);
    const chromeProfile = path.join(outDir, 'chrome_profile');
    fs.mkdirSync(chromeProfile, { recursive: true });

    chrome = spawn(
      chromePath,
      [
        `--remote-debugging-port=${debugPort}`,
        '--headless=new',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        `--user-data-dir=${chromeProfile}`,
        '--disable-background-networking',
        '--disable-sync',
        '--disable-extensions',
        '--disable-popup-blocking',
        '--disable-translate',
        '--metrics-recording-only',
      ],
      { stdio: 'ignore' }
    );

    await waitForChromeReady(debugPort, 8000);
    const wsUrl = await findExistingTarget(debugPort);
    cdp = await connectCdp(wsUrl);

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    const initScript = `
      try { localStorage.setItem('adminToken', ${JSON.stringify(token)}); } catch {}
      try {
        const k = '__m8_workspace_mru_inited';
        if (!localStorage.getItem(k)) {
          localStorage.setItem(k, '1');
          localStorage.removeItem('workspaceMru');
          localStorage.removeItem('workspaceId');
        }
      } catch {}
    `;
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: initScript });

    await cdp.send('Page.navigate', { url: `${baseUrl}/` });
    await cdp.waitForEvent('Page.loadEventFired', 10000);

    const href0 = await cdp.evalExpr('String(window.location.href || "")');
    assert(String(href0 || '').startsWith(`${baseUrl}/`), `unexpected url after navigation: ${href0}`);

    await waitForCondition(() => cdp.evalExpr('typeof state !== "undefined"'), { timeoutMs: 15000, label: 'state defined' });
    await waitForCondition(() => cdp.evalExpr('Array.isArray(state.workspaces) && state.workspaces.length === 3'), {
      timeoutMs: 15000,
      label: 'workspaces loaded',
    });
    await waitForCondition(() => cdp.evalExpr('document.querySelectorAll("#workspaceSelect option").length === 3'), {
      timeoutMs: 15000,
      label: 'workspaceSelect rendered',
    });

    const snapshot0 = await cdp.evalExpr(`
      (() => {
        const sel = document.querySelector('#workspaceSelect');
        if (!sel) return null;
        return Array.from(sel.options).map((o) => ({ value: o.value, text: String(o.textContent || '').trim() }));
      })()
    `);
    assert(Array.isArray(snapshot0) && snapshot0.length === 3, 'workspaceSelect snapshot missing');
    assert(snapshot0[0].text === 'ws3' && snapshot0[1].text === 'ws2' && snapshot0[2].text === 'ws1', `unexpected initial order: ${JSON.stringify(snapshot0)}`);

    await cdp.evalExpr(`
      (() => {
        const sel = document.querySelector('#workspaceSelect');
        if (!sel) return false;
        sel.value = ${JSON.stringify(ws1Id)};
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()
    `);

    await waitForCondition(
      () =>
        cdp.evalExpr(
          '(() => { const sel = document.querySelector("#workspaceSelect"); return sel && sel.options && sel.options.length && sel.options[0].textContent.trim() === "ws1"; })()'
        ),
      { timeoutMs: 10000 }
    );

    const snapshot1 = await cdp.evalExpr(`
      (() => {
        const sel = document.querySelector('#workspaceSelect');
        if (!sel) return null;
        return Array.from(sel.options).map((o) => ({ value: o.value, text: String(o.textContent || '').trim() }));
      })()
    `);
    assert(snapshot1[0].text === 'ws1', `expected ws1 at top after selecting ws1, got: ${JSON.stringify(snapshot1)}`);
    assert(
      snapshot1.map((x) => x.text).join(',') === 'ws1,ws3,ws2',
      `expected MRU order after selecting ws1: ws1,ws3,ws2; got: ${JSON.stringify(snapshot1)}`
    );

    await cdp.evalExpr(`
      (() => {
        const sel = document.querySelector('#workspaceSelect');
        if (!sel) return false;
        sel.value = ${JSON.stringify(ws2Id)};
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()
    `);

    await waitForCondition(
      () =>
        cdp.evalExpr(
          '(() => { const sel = document.querySelector("#workspaceSelect"); return sel && sel.options && sel.options.length && sel.options[0].textContent.trim() === "ws2"; })()'
        ),
      { timeoutMs: 10000 }
    );

    const snapshot2 = await cdp.evalExpr(`
      (() => {
        const sel = document.querySelector('#workspaceSelect');
        if (!sel) return null;
        return Array.from(sel.options).map((o) => ({ value: o.value, text: String(o.textContent || '').trim() }));
      })()
    `);
    assert(
      snapshot2.map((x) => x.text).join(',') === 'ws2,ws1,ws3',
      `expected MRU order after selecting ws2: ws2,ws1,ws3; got: ${JSON.stringify(snapshot2)}`
    );

    await cdp.send('Page.navigate', { url: `${baseUrl}/` });
    await cdp.waitForEvent('Page.loadEventFired', 10000);

    await waitForCondition(
      () =>
        cdp.evalExpr(
          '(() => { const sel = document.querySelector("#workspaceSelect"); return sel && sel.options && sel.options.length === 3 && sel.options[0].textContent.trim() === "ws2"; })()'
        ),
      { timeoutMs: 10000 }
    );

    const snapshot3 = await cdp.evalExpr(`
      (() => {
        const sel = document.querySelector('#workspaceSelect');
        if (!sel) return null;
        return Array.from(sel.options).map((o) => ({ value: o.value, text: String(o.textContent || '').trim() }));
      })()
    `);
    assert(
      snapshot3.map((x) => x.text).join(',') === 'ws2,ws1,ws3',
      `expected MRU order after reload: ws2,ws1,ws3; got: ${JSON.stringify(snapshot3)}`
    );

    console.log(
      `[m8_workspace_mru_e2e] PASS ${JSON.stringify({
        baseUrl,
        ws1Id,
        ws2Id,
        ws3Id,
        snapshot0: snapshot0.map((x) => x.text),
        snapshot1: snapshot1.map((x) => x.text),
        snapshot2: snapshot2.map((x) => x.text),
        snapshot3: snapshot3.map((x) => x.text),
        outDir,
      })}`
    );
  } finally {
    try {
      if (cdp) cdp.close();
    } catch {}
    try {
      if (chrome) chrome.kill('SIGKILL');
    } catch {}
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((err) => {
  console.error(`[m8_workspace_mru_e2e] FAIL: ${err.message}`);
  process.exit(1);
});
