/**
 * M6 Notify e2e (no browser):
 * - PushPlus notifications are emitted for:
 *   - run final (DONE)
 *   - run step-complete (PAUSED w/ step)
 *   - ask reply completion
 *
 * Notes:
 * - Uses a local mock HTTP endpoint instead of calling PushPlus.
 * - Writes artifacts under runs/notify-e2e-* (gitignored).
 */

const fs = require('fs');
const http = require('http');
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

async function pollRun(baseUrl, runId, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const { body } = await fetchJsonExpect(baseUrl, `/api/runs/${encodeURIComponent(runId)}`, {}, undefined);
    if (['DONE', 'PAUSED', 'ERROR', 'STOPPED'].includes(body.status)) return body;
    await sleep(100);
  }
  throw new Error(`Timeout waiting run ${runId}`);
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

async function startMockPushPlus() {
  const received = [];
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/send') {
      res.statusCode = 404;
      res.end('not found');
      return;
    }

    let buf = '';
    req.setEncoding('utf-8');
    req.on('data', (chunk) => {
      buf += chunk;
    });
    req.on('end', () => {
      let payload = null;
      try {
        payload = JSON.parse(buf);
      } catch {
        payload = { raw: buf };
      }

      received.push({ payload, ts: Date.now() });
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ code: 200, msg: 'success', data: 'mock' }));
    });
  });

  const instance = await new Promise((resolve) => {
    const s = server.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = instance.address().port;
  const endpoint = `http://127.0.0.1:${port}/send`;
  return { server: instance, endpoint, received };
}

async function waitForPushCount({ received, n, timeoutMs = 8000 }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (received.length >= n) return;
    await sleep(50);
  }
  throw new Error(`timeout waiting for push count >= ${n}, got ${received.length}`);
}

async function main() {
  const projectRoot = path.resolve(__dirname, '..');
  const runsRoot = path.join(projectRoot, 'runs');
  const outDir = path.join(runsRoot, `notify-e2e-${getTimestamp()}`);
  fs.mkdirSync(outDir, { recursive: true });
  await writeRunEnv({ outDir, cwd: projectRoot, extra: { kind: 'script', script: 'm6_notify_e2e' } });

  const token = `test-token-${Math.random().toString(16).slice(2)}`;
  const pushToken = `push-token-${Math.random().toString(16).slice(2)}`;

  const mock = await startMockPushPlus();

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

  process.env.PUSHPLUS_TOKEN = pushToken;
  process.env.PUSHPLUS_ENDPOINT = mock.endpoint;
  process.env.PUSH_NOTIFICATIONS_ENABLED = 'true';
  process.env.PUSH_NOTIFY_RUN_FINAL = 'true';
  process.env.PUSH_NOTIFY_RUN_STEP = 'true';
  process.env.PUSH_NOTIFY_ASK_REPLY = 'true';

  const { createServer } = require('../src/server');
  const { app } = createServer();
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    // create workspace
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

    // create sessions (fake)
    const managerSession = await fetchJsonExpect(
      baseUrl,
      '/api/sessions',
      {
        method: 'POST',
        headers: jsonHeaders(token),
        body: JSON.stringify({ workspaceId, role: 'manager', provider: 'fake', config: { sandbox: 'read-only' } }),
      },
      201
    );
    const executorSession = await fetchJsonExpect(
      baseUrl,
      '/api/sessions',
      {
        method: 'POST',
        headers: jsonHeaders(token),
        body: JSON.stringify({ workspaceId, role: 'executor', provider: 'fake', config: { sandbox: 'read-only' } }),
      },
      201
    );

    // run auto -> DONE => push (run_final)
    const run1 = await fetchJsonExpect(
      baseUrl,
      '/api/runs',
      {
        method: 'POST',
        headers: jsonHeaders(token),
        body: JSON.stringify({
          workspaceId,
          managerSessionId: managerSession.body.id,
          executorSessionId: executorSession.body.id,
          options: {
            maxTurns: 5,
            turnTimeoutMs: 5_000,
            repoDigestEnabled: false,
            requireGitClean: false,
            noProgressLimit: 0,
          },
        }),
      },
      201
    );
    await fetchJsonExpect(baseUrl, `/api/runs/${encodeURIComponent(run1.body.id)}/start`, { method: 'POST', headers: jsonHeaders(token) }, 200);
    const final1 = await pollRun(baseUrl, run1.body.id, 10_000);
    assert(final1.status === 'DONE', `expected run1 DONE, got ${final1.status}`);

    await waitForPushCount({ received: mock.received, n: 1, timeoutMs: 8000 });
    assert(mock.received[0]?.payload?.token === pushToken, 'push token mismatch for run1');
    assert(String(mock.received[0]?.payload?.title || '').includes('DONE'), 'run1 push title should include DONE');

    // run step -> PAUSED => push (run_step)
    const run2 = await fetchJsonExpect(
      baseUrl,
      '/api/runs',
      {
        method: 'POST',
        headers: jsonHeaders(token),
        body: JSON.stringify({
          workspaceId,
          managerSessionId: managerSession.body.id,
          executorSessionId: executorSession.body.id,
          options: {
            maxTurns: 5,
            turnTimeoutMs: 5_000,
            repoDigestEnabled: false,
            requireGitClean: false,
            noProgressLimit: 0,
          },
        }),
      },
      201
    );
    await fetchJsonExpect(baseUrl, `/api/runs/${encodeURIComponent(run2.body.id)}/step`, { method: 'POST', headers: jsonHeaders(token) }, 200);
    const final2 = await pollRun(baseUrl, run2.body.id, 10_000);
    assert(final2.status === 'PAUSED', `expected run2 PAUSED, got ${final2.status}`);

    await waitForPushCount({ received: mock.received, n: 2, timeoutMs: 8000 });
    assert(mock.received[1]?.payload?.token === pushToken, 'push token mismatch for run2');
    assert(String(mock.received[1]?.payload?.title || '').includes('STEP'), 'run2 push title should include STEP');

    // ask reply => push (ask_reply)
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

    await fetchJsonExpect(
      baseUrl,
      `/api/ask/threads/${encodeURIComponent(threadId)}/send`,
      { method: 'POST', headers: jsonHeaders(token), body: JSON.stringify({ text: 'hello notify' }) },
      202
    );
    await waitForAskIdle({ baseUrl, threadId, token, timeoutMs: 8000, minAssistantCount: 1 });

    await waitForPushCount({ received: mock.received, n: 3, timeoutMs: 8000 });
    assert(mock.received[2]?.payload?.token === pushToken, 'push token mismatch for ask');
    assert(String(mock.received[2]?.payload?.title || '').includes('Ask'), 'ask push title should include Ask');
    assert(String(mock.received[2]?.payload?.content || '').includes('hello notify'), 'ask push content should include user text');

    console.log(`[m6_notify_e2e] PASS: pushes=${mock.received.length}, outDir=${outDir}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => mock.server.close(resolve));
  }
}

main().catch((err) => {
  console.error(`[m6_notify_e2e] FAIL: ${err.message}`);
  process.exit(1);
});

