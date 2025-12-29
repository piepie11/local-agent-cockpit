/**
 * M5c Ask recovery minimal rerender check (headless Chrome + CDP).
 * Verifies input focus/selection and message scroll stay stable during recovery refresh.
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

async function waitForAskIdle({ baseUrl, threadId, token, timeoutMs = 8000, minAssistantCount = 1 }) {
  const deadline = Date.now() + timeoutMs;
  let lastThread = null;
  let lastMsgs = null;

  while (Date.now() < deadline) {
    const t0 = await fetchJsonExpect(
      baseUrl,
      `/api/ask/threads/${encodeURIComponent(threadId)}`,
      { headers: { 'x-admin-token': token } },
      200
    );
    lastThread = t0.body;

    const msgs = await fetchJsonExpect(
      baseUrl,
      `/api/ask/threads/${encodeURIComponent(threadId)}/messages?limit=200`,
      { headers: { 'x-admin-token': token } },
      200
    );
    lastMsgs = msgs.body.items || [];

    const assistantCount = lastMsgs.filter((m) => String(m.role || '').toLowerCase() === 'assistant').length;
    const busy = Boolean(lastThread?.busy);
    if (!busy && assistantCount >= minAssistantCount) return { thread: lastThread, messages: lastMsgs };

    await sleep(120);
  }

  const assistantCount = (lastMsgs || []).filter((m) => String(m.role || '').toLowerCase() === 'assistant').length;
  const busy = Boolean(lastThread?.busy);
  throw new Error(
    `timeout waiting for ask to become idle threadId=${threadId} busy=${busy} assistantCount=${assistantCount} messages=${(lastMsgs || []).length}`
  );
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

async function waitForCondition(evalFn, { timeoutMs = 5000, intervalMs = 100 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await evalFn();
    if (last) return last;
    await sleep(intervalMs);
  }
  throw new Error(`CDP_WAIT_TIMEOUT last=${JSON.stringify(last)}`);
}

async function main() {
  const projectRoot = path.resolve(__dirname, '..');
  const runsRoot = path.join(projectRoot, 'runs');
  const outDir = path.join(runsRoot, `ask-recovery-cdp-${getTimestamp()}`);
  fs.mkdirSync(outDir, { recursive: true });
  await writeRunEnv({ outDir, cwd: projectRoot, extra: { kind: 'script', script: 'm5c_ask_recovery_focus_cdp' } });

  const token = `test-token-${Math.random().toString(16).slice(2)}`;

  const allowedRoot = path.join(outDir, 'allowed_root');
  const wsRoot = path.join(allowedRoot, 'ws1');
  fs.mkdirSync(wsRoot, { recursive: true });
  fs.writeFileSync(path.join(wsRoot, 'plan.md'), '# ws1 plan\n', 'utf-8');

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
    const ws1 = await fetchJsonExpect(
      baseUrl,
      '/api/workspaces',
      {
        method: 'POST',
        headers: jsonHeaders(token),
        body: JSON.stringify({ name: 'ws1', rootPath: wsRoot }),
      },
      201
    );
    const workspaceId = ws1.body.id;
    assert(workspaceId, 'workspace id missing');

    const threadResp = await fetchJsonExpect(
      baseUrl,
      `/api/workspaces/${encodeURIComponent(workspaceId)}/ask/threads`,
      {
        method: 'POST',
        headers: jsonHeaders(token),
        body: JSON.stringify({ title: 't1', provider: 'fake', config: { sandbox: 'read-only', delayMs: 10 } }),
      },
      201
    );
    const threadId = threadResp.body.id;
    assert(threadId, 'thread id missing');

    for (let i = 0; i < 8; i += 1) {
      const text = `seed message ${i} ${'x'.repeat(240)}`;
      await fetchJsonExpect(
        baseUrl,
        `/api/ask/threads/${encodeURIComponent(threadId)}/send`,
        { method: 'POST', headers: jsonHeaders(token), body: JSON.stringify({ text }) },
        202
      );
      await waitForAskIdle({ baseUrl, threadId, token, timeoutMs: 5000, minAssistantCount: i + 1 });
    }

    await fetchJsonExpect(
      baseUrl,
      `/api/ask/threads/${encodeURIComponent(threadId)}`,
      {
        method: 'PATCH',
        headers: jsonHeaders(token),
        body: JSON.stringify({ config: { sandbox: 'read-only', delayMs: 1500 } }),
      },
      200
    );

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
    await cdp.send('DOM.enable');

    const initScript = `
      try { localStorage.setItem('adminToken', ${JSON.stringify(token)}); } catch {}
      try { localStorage.setItem('workspaceId', ${JSON.stringify(workspaceId)}); } catch {}
    `;
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: initScript });

    const askUrl = `${baseUrl}/ask?ws=${encodeURIComponent(workspaceId)}`;
    await cdp.send('Page.navigate', { url: askUrl });
    await cdp.waitForEvent('Page.loadEventFired', 10000);

    await waitForCondition(
      () => cdp.evalExpr('typeof state !== "undefined" && state.askThreadId && state.askMessages && state.askMessages.length > 0'),
      { timeoutMs: 10000 }
    );

    await cdp.evalExpr(`
      (() => {
        const ids = (state.askMessages || []).map((m) => m.id);
        const next = {};
        for (const id of ids) next[id] = true;
        state.askMessageOpen = next;
        renderAskMessages();
        return ids.length;
      })()
    `);

    const before = await cdp.evalExpr(`
      (() => {
        const input = document.querySelector('#askInput');
        const host = document.querySelector('#askMessages');
        if (!input || !host) return { ok: false };
        input.value = 'typing-next-message';
        input.focus();
        input.setSelectionRange(3, 9);
        host.scrollTop = Math.max(0, Math.floor(host.scrollHeight / 2));
        return {
          ok: true,
          active: document.activeElement === input,
          value: input.value,
          selStart: input.selectionStart,
          selEnd: input.selectionEnd,
          scrollTop: host.scrollTop,
          scrollHeight: host.scrollHeight,
          clientHeight: host.clientHeight,
        };
      })()
    `);

    assert(before.ok, 'DOM missing #askInput or #askMessages');
    assert(before.scrollHeight > before.clientHeight, 'messages not scrollable');

    const msgCountBefore = await cdp.evalExpr('state.askMessages ? state.askMessages.length : 0');

    await fetchJsonExpect(
      baseUrl,
      `/api/ask/threads/${encodeURIComponent(threadId)}/send`,
      { method: 'POST', headers: jsonHeaders(token), body: JSON.stringify({ text: 'trigger recovery flow' }) },
      202
    );

    await waitForCondition(() => cdp.evalExpr('Boolean(state && state.askRecovering)'), { timeoutMs: 4000 });
    await sleep(200);

    const after = await cdp.evalExpr(`
      (() => {
        const input = document.querySelector('#askInput');
        const host = document.querySelector('#askMessages');
        if (!input || !host) return { ok: false };
        return {
          ok: true,
          active: document.activeElement === input,
          value: input.value,
          selStart: input.selectionStart,
          selEnd: input.selectionEnd,
          scrollTop: host.scrollTop,
          scrollHeight: host.scrollHeight,
          clientHeight: host.clientHeight,
        };
      })()
    `);

    await waitForCondition(() => cdp.evalExpr('Boolean(state && state.askRecovering === false)'), { timeoutMs: 10000 });
    const msgCountAfter = await cdp.evalExpr('state.askMessages ? state.askMessages.length : 0');

    const focusOk = Boolean(after.active);
    const valueOk = String(after.value || '') === String(before.value || '');
    const selectionOk = Number(after.selStart) === Number(before.selStart) && Number(after.selEnd) === Number(before.selEnd);
    const scrollOk = Math.abs(Number(after.scrollTop) - Number(before.scrollTop)) <= 2;
    const messageAdvanced = Number(msgCountAfter) > Number(msgCountBefore);

    const summary = {
      focusOk,
      valueOk,
      selectionOk,
      scrollOk,
      scrollable: before.scrollHeight > before.clientHeight,
      recoveringStarted: true,
      recoveringEnded: true,
      messageCountBefore: msgCountBefore,
      messageCountAfter: msgCountAfter,
      messageAdvanced,
    };

    assert(focusOk, 'askInput focus lost during recovery');
    assert(valueOk, 'askInput value changed during recovery');
    assert(selectionOk, 'askInput selection changed during recovery');
    assert(scrollOk, 'askMessages scroll position changed during recovery');
    assert(messageAdvanced, 'ask messages did not advance after recovery');

    console.log(`[m5c_ask_recovery_focus_cdp] ${JSON.stringify(summary)}`);
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
  console.error(`[m5c_ask_recovery_focus_cdp] FAIL: ${err.message}`);
  process.exit(1);
});
