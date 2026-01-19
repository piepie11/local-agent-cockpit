/**
 * M10 doc writer e2e (fake provider writes file):
 * - create workspace with requirements/plan/convention
 * - create doc thread (requirements)
 * - send message and verify requirements file updated via API
 */

const fs = require('fs');
const path = require('path');
const { setTimeout: sleep } = require('timers/promises');
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

async function main() {
  const projectRoot = path.resolve(__dirname, '..');
  const runsRoot = path.join(projectRoot, 'runs');
  const outDir = path.join(runsRoot, `doc-writer-e2e-${getTimestamp()}`);
  fs.mkdirSync(outDir, { recursive: true });
  await writeRunEnv({ outDir, cwd: projectRoot, extra: { kind: 'script', script: 'm10_doc_writer_e2e' } });

  const token = `test-token-${Math.random().toString(16).slice(2)}`;

  const allowedRoot = path.join(outDir, 'allowed_root');
  const wsRoot = path.join(allowedRoot, 'ws_doc');
  fs.mkdirSync(wsRoot, { recursive: true });
  fs.writeFileSync(path.join(wsRoot, 'plan.md'), '# plan\n', 'utf-8');
  fs.writeFileSync(path.join(wsRoot, 'convention.md'), '# convention\n', 'utf-8');
  fs.writeFileSync(path.join(wsRoot, 'requirements.md'), '# requirements\n', 'utf-8');

  const dbPath = path.join(outDir, 'app.sqlite');
  const runsDir = path.join(outDir, 'runs_artifacts');

  process.env.HOST = '127.0.0.1';
  process.env.PORT = '0';
  process.env.ADMIN_TOKEN = token;
  process.env.ALLOWED_WORKSPACE_ROOTS = allowedRoot;
  process.env.DB_PATH = dbPath;
  process.env.RUNS_DIR = runsDir;
  process.env.READ_ONLY_MODE = 'false';
  process.env.PUSH_NOTIFICATIONS_ENABLED = 'false';
  process.env.PUSHPLUS_TOKEN = '';

  const { createServer } = require('../src/server');
  const { app, store } = createServer();
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const ws = await fetchJsonExpect(
      baseUrl,
      '/api/workspaces',
      {
        method: 'POST',
        headers: jsonHeaders(token),
        body: JSON.stringify({
          name: 'ws_doc',
          rootPath: wsRoot,
          planPath: 'plan.md',
          conventionPath: 'convention.md',
          requirementsPath: 'requirements.md',
        }),
      },
      201
    );
    const expectedReqPath = path.join(wsRoot, 'requirements.md');
    assert(ws.body.requirementsPath === expectedReqPath, 'requirementsPath mismatch');

    const thread = await fetchJsonExpect(
      baseUrl,
      `/api/workspaces/${encodeURIComponent(ws.body.id)}/ask/threads`,
      {
        method: 'POST',
        headers: jsonHeaders(token),
        body: JSON.stringify({
          title: 'Doc:requirements',
          provider: 'fake',
          config: { docKind: 'requirements', sandbox: 'workspace-write', systemPromptPath: 'prompts/doc_writer_system.md' },
        }),
      },
      201
    );
    assert(thread.body.id, 'thread id missing');

    const userText = 'Add acceptance criteria for login flow.';
    await fetchJsonExpect(
      baseUrl,
      `/api/ask/threads/${encodeURIComponent(thread.body.id)}/send`,
      {
        method: 'POST',
        headers: jsonHeaders(token),
        body: JSON.stringify({ text: userText }),
      },
      202
    );

    let updated = false;
    let lastContent = '';
    const started = Date.now();
    const timeoutMs = 12_000;
    while (Date.now() - started < timeoutMs) {
      const req = await fetchJsonExpect(baseUrl, `/api/workspaces/${encodeURIComponent(ws.body.id)}/requirements`, {}, undefined);
      lastContent = String(req.body.content || '');
      if (lastContent.includes(userText)) {
        updated = true;
        break;
      }
      await sleep(200);
    }

    assert(updated, `requirements not updated in time. lastContent=${lastContent.slice(0, 200)}`);

    console.log(`[m10_doc_writer_e2e] PASS baseUrl=${baseUrl} outDir=${outDir}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    store.close();
  }
}

main().catch((err) => {
  console.error(`[m10_doc_writer_e2e] FAIL: ${err.message}`);
  process.exit(1);
});
