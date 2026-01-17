/**
 * M9 e2e (UI): Home page overview (runs + ask) with attention + ignore + hide.
 *
 * Goals:
 * - Create 2 workspaces (wsA, wsB)
 * - Seed wsA with:
 *   - latest run in DONE state (should show attention highlight until ignored)
 *   - one ask thread with an assistant message (should show attention highlight until ignored)
 * - Verify:
 *   - Home renders both workspaces
 *   - Attention highlights appear for wsA run + ask
 *   - Clicking Ignore clears highlights and persists across reload
 *   - Home config can hide/unhide workspaces
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
        const timer = setTimeout(() => rejectWait(new Error(`CDP_EVENT_TIMEOUT ${method}`)), timeoutMs);
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
      if (res.exceptionDetails) throw new Error(`CDP_EVAL_ERROR ${res.exceptionDetails.text || 'unknown'}`);
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
  const outDir = path.join(runsRoot, `home-e2e-${getTimestamp()}`);
  fs.mkdirSync(outDir, { recursive: true });
  await writeRunEnv({ outDir, cwd: projectRoot, extra: { kind: 'script', script: 'm9_home_e2e' } });

  const token = `test-token-${Math.random().toString(16).slice(2)}`;

  const allowedRoot = path.join(outDir, 'allowed_root');
  const wsRootA = path.join(allowedRoot, 'wsA');
  const wsRootB = path.join(allowedRoot, 'wsB');
  [wsRootA, wsRootB].forEach((p) => fs.mkdirSync(p, { recursive: true }));
  [wsRootA, wsRootB].forEach((p) => fs.writeFileSync(path.join(p, 'plan.md'), `# ${path.basename(p)} plan\n`, 'utf-8'));

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
  const { app, store } = createServer();
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  let chrome = null;
  let cdp = null;
  try {
    const wsA = await fetchJsonExpect(
      baseUrl,
      '/api/workspaces',
      { method: 'POST', headers: jsonHeaders(token), body: JSON.stringify({ name: 'wsA', rootPath: wsRootA }) },
      201
    );
    const wsB = await fetchJsonExpect(
      baseUrl,
      '/api/workspaces',
      { method: 'POST', headers: jsonHeaders(token), body: JSON.stringify({ name: 'wsB', rootPath: wsRootB }) },
      201
    );
    const wsAId = String(wsA.body?.id || '').trim();
    const wsBId = String(wsB.body?.id || '').trim();
    assert(wsAId && wsBId, 'workspace ids missing');

    // Seed wsA with one finished run (DONE) as "latest run".
    const mgr = await fetchJsonExpect(
      baseUrl,
      '/api/sessions',
      { method: 'POST', headers: jsonHeaders(token), body: JSON.stringify({ workspaceId: wsAId, role: 'manager', provider: 'fake' }) },
      201
    );
    const exe = await fetchJsonExpect(
      baseUrl,
      '/api/sessions',
      { method: 'POST', headers: jsonHeaders(token), body: JSON.stringify({ workspaceId: wsAId, role: 'executor', provider: 'fake' }) },
      201
    );
    const run = await fetchJsonExpect(
      baseUrl,
      '/api/runs',
      {
        method: 'POST',
        headers: jsonHeaders(token),
        body: JSON.stringify({ workspaceId: wsAId, managerSessionId: mgr.body.id, executorSessionId: exe.body.id, options: {} }),
      },
      201
    );
    const runId = String(run.body?.id || '').trim();
    assert(runId, 'run id missing');
    store.updateRunStatus(runId, 'DONE', { startedAt: Date.now() - 1500, endedAt: Date.now() - 500, turnIndex: 2, error: null });

    // Seed wsA with one ask thread + assistant message (for attention highlight).
    const th = await fetchJsonExpect(
      baseUrl,
      `/api/workspaces/${encodeURIComponent(wsAId)}/ask/threads`,
      { method: 'POST', headers: jsonHeaders(token), body: JSON.stringify({ title: 'home-thread', provider: 'fake', config: {} }) },
      201
    );
    const threadId = String(th.body?.id || '').trim();
    assert(threadId, 'ask thread id missing');
    store.createAskMessage({ threadId, role: 'user', text: 'ping', metaJson: JSON.stringify({ ts: Date.now() }) });
    store.createAskMessage({ threadId, role: 'assistant', text: 'pong', metaJson: JSON.stringify({ ts: Date.now() }) });
    store.updateAskThread(threadId, { lastActiveAt: Date.now() });

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
        const k = '__m9_home_inited';
        if (!localStorage.getItem(k)) {
          localStorage.setItem(k, '1');
          localStorage.removeItem('workspaceMru');
          localStorage.removeItem('workspaceId');
          localStorage.removeItem('homeHiddenWorkspaces');
          localStorage.removeItem('homeSeenRuns');
          localStorage.removeItem('homeSeenAsk');
        }
      } catch {}
    `;
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: initScript });

    await cdp.send('Page.navigate', { url: `${baseUrl}/` });
    await cdp.waitForEvent('Page.loadEventFired', 10000);

    await waitForCondition(() => cdp.evalExpr('typeof state !== \"undefined\"'), { timeoutMs: 15000, label: 'state defined' });
    await waitForCondition(() => cdp.evalExpr('Array.isArray(state.workspaces) && state.workspaces.length === 2'), {
      timeoutMs: 15000,
      label: 'workspaces loaded',
    });
    await waitForCondition(() => cdp.evalExpr('document.querySelectorAll(\"#homeWorkspaceList > .card\").length === 2'), {
      timeoutMs: 15000,
      label: 'home cards rendered',
    });

    // Wait for DONE run attention on wsA.
    await waitForCondition(
      () =>
        cdp.evalExpr(
          `(() => {
            const btn = document.querySelector('[data-home-view-run][data-ws-id=${JSON.stringify(wsAId)}][data-run-id=${JSON.stringify(runId)}]');
            if (!btn) return false;
            const item = btn.closest('.homeItem');
            return item && item.classList.contains('homeItem--attn-good');
          })()`
        ),
      { timeoutMs: 15000, label: 'wsA run attn' }
    );

    // Wait for ask attention on wsA.
    await waitForCondition(
      () =>
        cdp.evalExpr(
          `(() => {
            const el = document.querySelector('[data-home-ask-thread=${JSON.stringify(threadId)}][data-ws-id=${JSON.stringify(wsAId)}]');
            return Boolean(el && el.classList.contains('homeItem--attn-good'));
          })()`
        ),
      { timeoutMs: 15000, label: 'wsA ask attn' }
    );

    // Ignore run attention.
    await cdp.evalExpr(
      `(() => {
        const btn = document.querySelector('[data-home-ignore-run][data-ws-id=${JSON.stringify(wsAId)}]');
        if (!btn) return false;
        btn.click();
        return true;
      })()`
    );
    await waitForCondition(
      () =>
        cdp.evalExpr(
          `(() => {
            const btn = document.querySelector('[data-home-view-run][data-ws-id=${JSON.stringify(wsAId)}][data-run-id=${JSON.stringify(runId)}]');
            if (!btn) return false;
            const item = btn.closest('.homeItem');
            return item && !item.classList.contains('homeItem--attn-good');
          })()`
        ),
      { timeoutMs: 10000, label: 'wsA run ignored' }
    );

    // Ignore ask attention.
    await cdp.evalExpr(
      `(() => {
        const btn = document.querySelector('[data-home-ignore-ask][data-thread-id=${JSON.stringify(threadId)}]');
        if (!btn) return false;
        btn.click();
        return true;
      })()`
    );
    await waitForCondition(
      () =>
        cdp.evalExpr(
          `(() => {
            const el = document.querySelector('[data-home-ask-thread=${JSON.stringify(threadId)}][data-ws-id=${JSON.stringify(wsAId)}]');
            return Boolean(el && !el.classList.contains('homeItem--attn-good'));
          })()`
        ),
      { timeoutMs: 10000, label: 'wsA ask ignored' }
    );

    // Home config: hide wsB.
    await cdp.evalExpr(
      `(() => {
        const btn = document.querySelector('#homeConfigBtn');
        if (!btn) return false;
        btn.click();
        return true;
      })()`
    );
    await waitForCondition(() => cdp.evalExpr('!document.querySelector(\"#homeConfigModal\").classList.contains(\"hidden\")'), {
      timeoutMs: 5000,
      label: 'config modal open',
    });

    await cdp.evalExpr(
      `(() => {
        const input = document.querySelector('[data-home-hide-toggle=${JSON.stringify(wsBId)}]');
        if (!input) return false;
        input.checked = true;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()`
    );
    await waitForCondition(() => cdp.evalExpr('document.querySelectorAll(\"#homeWorkspaceList > .card\").length === 1'), {
      timeoutMs: 5000,
      label: 'wsB hidden',
    });

    // Show all.
    await cdp.evalExpr(
      `(() => {
        const btn = document.querySelector('#homeConfigShowAllBtn');
        if (!btn) return false;
        btn.click();
        return true;
      })()`
    );
    await waitForCondition(() => cdp.evalExpr('document.querySelectorAll(\"#homeWorkspaceList > .card\").length === 2'), {
      timeoutMs: 5000,
      label: 'show all',
    });

    // Reload: ignore state should persist.
    await cdp.send('Page.navigate', { url: `${baseUrl}/` });
    await cdp.waitForEvent('Page.loadEventFired', 10000);
    await waitForCondition(() => cdp.evalExpr('document.querySelectorAll(\"#homeWorkspaceList > .card\").length === 2'), {
      timeoutMs: 15000,
      label: 'home cards rendered after reload',
    });
    const persisted = await cdp.evalExpr(
      `(() => {
        const runBtn = document.querySelector('[data-home-view-run][data-ws-id=${JSON.stringify(wsAId)}][data-run-id=${JSON.stringify(runId)}]');
        const runItem = runBtn ? runBtn.closest('.homeItem') : null;
        const askEl = document.querySelector('[data-home-ask-thread=${JSON.stringify(threadId)}][data-ws-id=${JSON.stringify(wsAId)}]');
        return {
          runOk: Boolean(runItem && !runItem.classList.contains('homeItem--attn-good')),
          askOk: Boolean(askEl && !askEl.classList.contains('homeItem--attn-good')),
        };
      })()`
    );
    assert(persisted && persisted.runOk && persisted.askOk, `ignore state not persisted: ${JSON.stringify(persisted)}`);

    console.log('[m9_home_e2e] PASS', JSON.stringify({ baseUrl, wsAId, wsBId, runId, threadId, outDir }));
  } finally {
    try {
      cdp?.close?.();
    } catch {}
    try {
      chrome?.kill?.();
    } catch {}
    try {
      server?.close?.();
    } catch {}
  }
}

main().catch((err) => {
  console.error('[m9_home_e2e] FAIL', String(err?.stack || err?.message || err));
  process.exit(1);
});

