/**
 * M4 Ask API e2e (no browser):
 * - workspace-bound ask threads
 * - resume-only send flow
 * - queue: enqueue while busy + edit/delete
 * - messages + export (md/jsonl)
 *
 * Notes:
 * - Uses fake provider for determinism.
 * - Writes artifacts under runs/ask-e2e-* (gitignored).
 */

const fs = require('fs');
const path = require('path');

const { writeRunEnv } = require('../src/lib/run_env');

function getTimestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(
    now.getMinutes()
  )}${pad(now.getSeconds())}`;
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

async function fetchTextExpect(baseUrl, url, options, expectedStatus) {
  const res = await fetch(`${baseUrl}${url}`, options);
  const text = await res.text();
  if (expectedStatus !== undefined) {
    assert(res.status === expectedStatus, `Expected ${expectedStatus}, got ${res.status} for ${url}: ${text}`);
  } else {
    assert(res.ok, `HTTP ${res.status} for ${url}: ${text}`);
  }
  return { res, text };
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
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

async function main() {
  const projectRoot = path.resolve(__dirname, '..');
  const runsRoot = path.join(projectRoot, 'runs');
  const outDir = path.join(runsRoot, `ask-e2e-${getTimestamp()}`);
  fs.mkdirSync(outDir, { recursive: true });
  await writeRunEnv({ outDir, cwd: projectRoot, extra: { kind: 'script', script: 'm4_ask_e2e' } });

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
    assert(ws1.body.id, 'workspace id missing');

    // create ask thread (fake)
    const threadResp = await fetchJsonExpect(
      baseUrl,
      `/api/workspaces/${encodeURIComponent(ws1.body.id)}/ask/threads`,
      {
        method: 'POST',
        headers: jsonHeaders(token),
        body: JSON.stringify({ title: 't1', provider: 'fake', config: { sandbox: 'read-only' } }),
      },
      201
    );
    const threadId = threadResp.body.id;
    assert(threadId, 'thread id missing');
    assert(threadResp.body.provider === 'fake', 'thread provider should be fake');
    assert(!threadResp.body.providerSessionId, 'seed providerSessionId should be null');

    // send #1 (seed, async)
    const send1Ack = await fetchJsonExpect(
      baseUrl,
      `/api/ask/threads/${encodeURIComponent(threadId)}/send`,
      {
        method: 'POST',
        headers: jsonHeaders(token),
        body: JSON.stringify({ text: 'hello' }),
      },
      202
    );
    assert(send1Ack.body.ok === true, 'send1Ack.ok should be true');
    assert(send1Ack.body.queued === true, 'send1Ack.queued should be true');
    assert(send1Ack.body.queueItem?.id, 'send1Ack.queueItem.id should be set');

    const idle1 = await waitForAskIdle({ baseUrl, threadId, token, timeoutMs: 8000, minAssistantCount: 1 });
    assert(idle1.thread?.providerSessionId, 'providerSessionId should be set after seed');
    const resumeId = idle1.thread.providerSessionId;
    const assistant1 = idle1.messages.filter((m) => String(m.role || '').toLowerCase() === 'assistant').at(-1);
    assert(String(assistant1?.text || '').includes('Fake ask answer'), 'assistant should reply');

    const baselineAssistantCount = idle1.messages.filter((m) => String(m.role || '').toLowerCase() === 'assistant').length;

    // send #2 (resume, async)
    const send2Ack = await fetchJsonExpect(
      baseUrl,
      `/api/ask/threads/${encodeURIComponent(threadId)}/send`,
      {
        method: 'POST',
        headers: jsonHeaders(token),
        body: JSON.stringify({ text: 'second' }),
      },
      202
    );
    assert(send2Ack.body.ok === true, 'send2Ack.ok should be true');
    assert(send2Ack.body.queued === true, 'send2Ack.queued should be true');
    assert(send2Ack.body.queueItem?.id, 'send2Ack.queueItem.id should be set');

    const idle2 = await waitForAskIdle({
      baseUrl,
      threadId,
      token,
      timeoutMs: 8000,
      minAssistantCount: baselineAssistantCount + 1,
    });
    assert(idle2.thread?.providerSessionId === resumeId, 'resumeId should stay the same');

    // queue: enqueue while busy + edit/delete queued items
    const queueThreadResp = await fetchJsonExpect(
      baseUrl,
      `/api/workspaces/${encodeURIComponent(ws1.body.id)}/ask/threads`,
      {
        method: 'POST',
        headers: jsonHeaders(token),
        body: JSON.stringify({ title: 't-queue', provider: 'fake', config: { sandbox: 'read-only', delayMs: 600 } }),
      },
      201
    );
    const queueThreadId = queueThreadResp.body.id;
    assert(queueThreadId, 'queueThreadId missing');

    const q1Ack = await fetchJsonExpect(
      baseUrl,
      `/api/ask/threads/${encodeURIComponent(queueThreadId)}/send`,
      {
        method: 'POST',
        headers: jsonHeaders(token),
        body: JSON.stringify({ text: 'first slow' }),
      },
      202
    );
    const q1Id = q1Ack.body.queueItem?.id;
    assert(q1Id, 'q1 queueItem id missing');

    await sleep(60);

    const q2Ack = await fetchJsonExpect(
      baseUrl,
      `/api/ask/threads/${encodeURIComponent(queueThreadId)}/send`,
      {
        method: 'POST',
        headers: jsonHeaders(token),
        body: JSON.stringify({ text: 'second original' }),
      },
      202
    );
    const q2Id = q2Ack.body.queueItem?.id;
    assert(q2Id, 'q2 queueItem id missing');

    const q3Ack = await fetchJsonExpect(
      baseUrl,
      `/api/ask/threads/${encodeURIComponent(queueThreadId)}/send`,
      {
        method: 'POST',
        headers: jsonHeaders(token),
        body: JSON.stringify({ text: 'third to delete' }),
      },
      202
    );
    const q3Id = q3Ack.body.queueItem?.id;
    assert(q3Id, 'q3 queueItem id missing');

    const queueBefore = await fetchJsonExpect(
      baseUrl,
      `/api/ask/threads/${encodeURIComponent(queueThreadId)}/queue?limit=50`,
      { headers: { 'x-admin-token': token } },
      200
    );
    const queueBeforeItems = queueBefore.body.items || [];
    assert(queueBeforeItems.some((it) => it.id === q2Id), 'queue should include q2');
    assert(queueBeforeItems.some((it) => it.id === q3Id), 'queue should include q3');

    const q2Edited = await fetchJsonExpect(
      baseUrl,
      `/api/ask/queue/${encodeURIComponent(q2Id)}`,
      {
        method: 'PATCH',
        headers: jsonHeaders(token),
        body: JSON.stringify({ text: 'second edited' }),
      },
      200
    );
    assert(q2Edited.body.text === 'second edited', 'q2 edited text should be applied');

    const q3Deleted = await fetchJsonExpect(
      baseUrl,
      `/api/ask/queue/${encodeURIComponent(q3Id)}`,
      { method: 'DELETE', headers: { 'x-admin-token': token } },
      200
    );
    assert(q3Deleted.body.ok === true, 'q3 delete ok should be true');

    const idleQ = await waitForAskIdle({ baseUrl, threadId: queueThreadId, token, timeoutMs: 12000, minAssistantCount: 2 });
    const userTextsQ = idleQ.messages
      .filter((m) => String(m.role || '').toLowerCase() === 'user')
      .map((m) => String(m.text || ''));
    assert(userTextsQ.some((t) => t.includes('second edited')), 'edited user text should appear in messages');
    assert(!userTextsQ.some((t) => t.includes('second original')), 'original user text should not appear');
    assert(!userTextsQ.some((t) => t.includes('third to delete')), 'deleted queued item text should not appear in messages');

    const queueAfter = await fetchJsonExpect(
      baseUrl,
      `/api/ask/threads/${encodeURIComponent(queueThreadId)}/queue?limit=50`,
      { headers: { 'x-admin-token': token } },
      200
    );
    const pendingAfter = (queueAfter.body.items || []).filter((it) =>
      ['queued', 'running'].includes(String(it.status || '').toLowerCase())
    );
    assert(pendingAfter.length === 0, `expected no pending queue items, got ${pendingAfter.length}`);

    // stop (abort) flow
    const stopThreadResp = await fetchJsonExpect(
      baseUrl,
      `/api/workspaces/${encodeURIComponent(ws1.body.id)}/ask/threads`,
      {
        method: 'POST',
        headers: jsonHeaders(token),
        body: JSON.stringify({ title: 't-stop', provider: 'fake', config: { sandbox: 'read-only', delayMs: 5000 } }),
      },
      201
    );
    const stopThreadId = stopThreadResp.body.id;
    assert(stopThreadId, 'stopThreadId missing');

    const stopSendAck = await fetchJsonExpect(
      baseUrl,
      `/api/ask/threads/${encodeURIComponent(stopThreadId)}/send`,
      {
        method: 'POST',
        headers: jsonHeaders(token),
        body: JSON.stringify({ text: 'please take long so we can abort' }),
      },
      202
    );
    assert(stopSendAck.body.ok === true, 'stopSendAck.ok should be true');

    await sleep(120);

    const stopAck = await fetchJsonExpect(
      baseUrl,
      `/api/ask/threads/${encodeURIComponent(stopThreadId)}/stop`,
      {
        method: 'POST',
        headers: jsonHeaders(token),
        body: JSON.stringify({}),
      },
      200
    );
    assert(stopAck.body.ok === true, 'stopAck.ok should be true');
    assert(stopAck.body.stopped === true, 'stopAck.stopped should be true');

    const idleStop = await waitForAskIdle({ baseUrl, threadId: stopThreadId, token, timeoutMs: 8000, minAssistantCount: 1 });
    const stopAssistant = idleStop.messages.filter((m) => String(m.role || '').toLowerCase() === 'assistant').at(-1);
    assert(stopAssistant, 'stop assistant message missing');
    assert(
      stopAssistant.meta?.error === 'ASK_ABORTED' || String(stopAssistant.text || '').includes('(aborted)'),
      'stop assistant message should indicate abort'
    );

    // list messages
    const msgs = await fetchJsonExpect(
      baseUrl,
      `/api/ask/threads/${encodeURIComponent(threadId)}/messages?limit=5000`,
      { headers: { 'x-admin-token': token } },
      200
    );
    assert(Array.isArray(msgs.body.items), 'messages.items should be array');
    assert(msgs.body.items.length >= 4, `expected >=4 messages, got ${msgs.body.items.length}`);

    // tail=1 should return the most recent N messages (still in ASC order for UI)
    const tail2 = await fetchJsonExpect(
      baseUrl,
      `/api/ask/threads/${encodeURIComponent(threadId)}/messages?tail=1&limit=2`,
      { headers: { 'x-admin-token': token } },
      200
    );
    const fullItems = msgs.body.items || [];
    const tailItems = tail2.body.items || [];
    assert(Array.isArray(tailItems), 'tail messages.items should be array');
    assert(tailItems.length === 2, `expected 2 tail messages, got ${tailItems.length}`);
    const fullTailIds = fullItems.slice(-2).map((m) => m.id).join(',');
    const tailIds = tailItems.map((m) => m.id).join(',');
    assert(tailIds === fullTailIds, `tail ids should match last 2 ids (tail=${tailIds} full=${fullTailIds})`);

    // exports
    const md = await fetchTextExpect(
      baseUrl,
      `/api/ask/threads/${encodeURIComponent(threadId)}/export?format=md`,
      { headers: { 'x-admin-token': token } },
      200
    );
    assert(md.text.includes('# Ask:'), 'md export should include header');

    const jsonl = await fetchTextExpect(
      baseUrl,
      `/api/ask/threads/${encodeURIComponent(threadId)}/export?format=jsonl`,
      { headers: { 'x-admin-token': token } },
      200
    );
    assert(jsonl.text.split('\n').filter(Boolean).length >= 5, 'jsonl should have header + messages');

    // delete thread
    const del = await fetchJsonExpect(
      baseUrl,
      `/api/ask/threads/${encodeURIComponent(threadId)}`,
      { method: 'DELETE', headers: { 'x-admin-token': token } },
      200
    );
    assert(del.body.ok === true, 'delete.ok should be true');
  } finally {
    server.close();
  }

  // eslint-disable-next-line no-console
  console.log(`[m4_ask_e2e] PASS outDir=${outDir}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(`[m4_ask_e2e] FAIL: ${err.message}`);
  process.exit(1);
});
