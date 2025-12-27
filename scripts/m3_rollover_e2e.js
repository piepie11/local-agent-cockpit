/**
 * M3 e2e (API): session rollover + run session swap + rollovers listing.
 *
 * Notes:
 * - Uses fake provider (no external CLI required).
 * - Starts an in-process server and calls HTTP endpoints via fetch.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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
  const runsDir = path.join(projectRoot, 'runs');
  const outDir = path.join(runsDir, `rollover-e2e-${getTimestamp()}`);
  fs.mkdirSync(outDir, { recursive: true });
  await writeRunEnv({ outDir, cwd: projectRoot, extra: { kind: 'script', script: 'm3_rollover_e2e' } });

  const token = crypto.randomBytes(16).toString('hex');
  const allowedRoot = path.join(outDir, 'allowed_root');
  const wsRoot = path.join(allowedRoot, 'ws1');
  fs.mkdirSync(wsRoot, { recursive: true });
  fs.writeFileSync(path.join(wsRoot, 'plan.md'), '# ws1 plan\n', 'utf-8');

  process.env.HOST = '127.0.0.1';
  process.env.PORT = '0';
  process.env.ADMIN_TOKEN = token;
  process.env.ALLOWED_WORKSPACE_ROOTS = allowedRoot;
  process.env.DB_PATH = path.join(outDir, 'app.sqlite');
  process.env.RUNS_DIR = path.join(outDir, 'runs_artifacts');
  process.env.MAX_CONCURRENT_RUNS = '1';
  process.env.READ_ONLY_MODE = 'false';
  // Avoid spamming real push channels when running e2e locally.
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
        body: JSON.stringify({ name: 'ws1', rootPath: wsRoot }),
      },
      201
    );
    assert(ws.body.id, 'workspace id missing');

    const managerSession = await fetchJsonExpect(
      baseUrl,
      '/api/sessions',
      {
        method: 'POST',
        headers: jsonHeaders(token),
        body: JSON.stringify({
          workspaceId: ws.body.id,
          role: 'manager',
          provider: 'fake',
          config: { sandbox: 'read-only', mode: 'stateful_resume' },
        }),
      },
      201
    );

    const executorSession = await fetchJsonExpect(
      baseUrl,
      '/api/sessions',
      {
        method: 'POST',
        headers: jsonHeaders(token),
        body: JSON.stringify({
          workspaceId: ws.body.id,
          role: 'executor',
          provider: 'fake',
          config: { sandbox: 'read-only', mode: 'stateful_resume' },
        }),
      },
      201
    );

    const run = await fetchJsonExpect(
      baseUrl,
      '/api/runs',
      {
        method: 'POST',
        headers: jsonHeaders(token),
        body: JSON.stringify({
          workspaceId: ws.body.id,
          managerSessionId: managerSession.body.id,
          executorSessionId: executorSession.body.id,
          options: { maxTurns: 3, repoDigestEnabled: false, requireGitClean: false, noProgressLimit: 0 },
        }),
      },
      201
    );

    const rollover = await fetchJsonExpect(
      baseUrl,
      `/api/sessions/${encodeURIComponent(managerSession.body.id)}/rollover`,
      {
        method: 'POST',
        headers: jsonHeaders(token),
        body: JSON.stringify({ runId: run.body.id, reason: 'e2e-rollover' }),
      },
      201
    );

    assert(rollover.body.ok === true, 'rollover ok missing');
    assert(rollover.body.to?.id, 'new session id missing');
    assert(rollover.body.to.id !== managerSession.body.id, 'new session should differ');
    assert(String(rollover.body.to.configJson || '').includes('rolloverSummaryPath'), 'expected rolloverSummaryPath in config');

    const runAfter = await fetchJsonExpect(baseUrl, `/api/runs/${encodeURIComponent(run.body.id)}`, {}, undefined);
    assert(runAfter.body.managerSessionId === rollover.body.to.id, 'expected run managerSessionId updated');

    const rolloversList = await fetchJsonExpect(
      baseUrl,
      `/api/workspaces/${encodeURIComponent(ws.body.id)}/rollovers`,
      {},
      undefined
    );
    assert(Array.isArray(rolloversList.body.items), 'expected rollovers list');
    assert(rolloversList.body.items.length >= 1, 'expected at least one rollover record');
  } finally {
    server.close();
    store.close();
  }

  console.log(`[m3_rollover_e2e] PASS outDir=${outDir}`);
}

main().catch((err) => {
  console.error(`[m3_rollover_e2e] FAIL: ${err.message}`);
  process.exit(1);
});
