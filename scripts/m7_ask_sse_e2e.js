/**
 * M7 Ask SSE e2e (no browser):
 * - Ask updates are pushed via SSE to all clients (no polling needed).
 *
 * Notes:
 * - Uses fake provider for determinism.
 * - Writes artifacts under runs/ask-sse-e2e-* (gitignored).
 */

const fs = require('fs');
const path = require('path');
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

async function readSseSome({ baseUrl, url, token, maxEvents, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const events = [];
  const decoder = new TextDecoder();

  try {
    const res = await fetch(`${baseUrl}${url}`, {
      headers: { Accept: 'text/event-stream', ...(token ? { 'x-admin-token': token } : {}) },
      signal: controller.signal,
    });
    if (!res.ok) {
      return { status: res.status, events: [] };
    }
    const reader = res.body.getReader();
    let buf = '';

    while (events.length < maxEvents) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      buf = buf.replaceAll('\r', '');

      while (true) {
        const sep = buf.indexOf('\n\n');
        if (sep === -1) break;
        const raw = buf.slice(0, sep);
        buf = buf.slice(sep + 2);

        let event = null;
        const dataLines = [];

        for (const line of raw.split('\n')) {
          if (!line) continue;
          if (line.startsWith(':')) continue;
          if (line.startsWith('event:')) event = line.slice(6).trim();
          if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
        }

        const dataText = dataLines.join('\n');
        if (!event && !dataText) continue;
        let data = dataText;
        try {
          data = JSON.parse(dataText);
        } catch {}
        events.push({ event, data });
      }
    }
  } catch (err) {
    if (String(err?.name) !== 'AbortError') throw err;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }

  return { status: 200, events };
}

async function main() {
  const projectRoot = path.resolve(__dirname, '..');
  const runsRoot = path.join(projectRoot, 'runs');
  const outDir = path.join(runsRoot, `ask-sse-e2e-${getTimestamp()}`);
  fs.mkdirSync(outDir, { recursive: true });
  await writeRunEnv({ outDir, cwd: projectRoot, extra: { kind: 'script', script: 'm7_ask_sse_e2e' } });

  const token = `test-token-${Math.random().toString(16).slice(2)}`;

  const allowedRoot = path.join(outDir, 'allowed_root');
  const wsRoot1 = path.join(allowedRoot, 'ws1');
  fs.mkdirSync(wsRoot1, { recursive: true });
  fs.writeFileSync(path.join(wsRoot1, 'plan.md'), '# ws1 plan\n', 'utf-8');

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

  // Avoid spamming real push channels when running e2e locally.
  process.env.PUSH_NOTIFICATIONS_ENABLED = 'false';
  process.env.PUSHPLUS_TOKEN = '';

  const { createServer } = require('../src/server');
  const { app } = createServer();
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const ws1 = await fetchJsonExpect(
      baseUrl,
      '/api/workspaces',
      {
        method: 'POST',
        headers: jsonHeaders(token),
        body: JSON.stringify({ name: 'ws1', rootPath: wsRoot1 }),
      },
      201
    );
    const workspaceId = ws1.body.id;
    assert(workspaceId, 'workspace id missing');

    // SSE auth required
    const sseNoToken = await readSseSome({
      baseUrl,
      url: `/api/workspaces/${encodeURIComponent(workspaceId)}/ask/events`,
      token: '',
      maxEvents: 1,
      timeoutMs: 800,
    });
    assert(sseNoToken.status === 401 || sseNoToken.status === 403, `expected 401/403, got ${sseNoToken.status}`);

    // create ask thread (fake)
    const threadResp = await fetchJsonExpect(
      baseUrl,
      `/api/workspaces/${encodeURIComponent(workspaceId)}/ask/threads`,
      {
        method: 'POST',
        headers: jsonHeaders(token),
        body: JSON.stringify({ title: 't1', provider: 'fake', config: { sandbox: 'read-only' } }),
      },
      201
    );
    const threadId = threadResp.body.id;
    assert(threadId, 'thread id missing');

    // Start SSE capture before sending.
    const ssePromise = readSseSome({
      baseUrl,
      url: `/api/workspaces/${encodeURIComponent(workspaceId)}/ask/events`,
      token,
      maxEvents: 12,
      timeoutMs: 8000,
    });

    await fetchJsonExpect(
      baseUrl,
      `/api/ask/threads/${encodeURIComponent(threadId)}/send`,
      { method: 'POST', headers: jsonHeaders(token), body: JSON.stringify({ text: 'hello sse' }) },
      202
    );

    await waitForAskIdle({ baseUrl, threadId, token, timeoutMs: 8000, minAssistantCount: 1 });

    const sse = await ssePromise;
    assert(sse.status === 200, 'sse should be 200');
    const hasAskEvent = (sse.events || []).some((e) => e.event === 'event' && e.data && e.data.kind === 'ask');
    assert(hasAskEvent, `expected ask SSE events, got ${JSON.stringify(sse.events || []).slice(0, 800)}`);

    console.log(`[m7_ask_sse_e2e] PASS outDir=${outDir} events=${(sse.events || []).length}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((err) => {
  console.error(`[m7_ask_sse_e2e] FAIL: ${err.message}`);
  process.exit(1);
});

