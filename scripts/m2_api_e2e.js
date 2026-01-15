/**
 * M2 deep-ish API e2e (no browser):
 * - auth (ADMIN_TOKEN)
 * - workspace registry + path allowlist
 * - sessions + provider validation
 * - runs: create/start/step/pause/stop
 * - SSE basic stream sanity
 * - exports
 * - workspace lock + max concurrent runs
 * - dangerousCommandGuard + requireGitClean
 *
 * Notes:
 * - Uses fake provider for determinism.
 * - Writes all test artifacts under runs/api-e2e-* (gitignored).
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

async function pollRun(baseUrl, runId, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const { body } = await fetchJsonExpect(baseUrl, `/api/runs/${encodeURIComponent(runId)}`, {}, undefined);
    if (['DONE', 'PAUSED', 'ERROR', 'STOPPED'].includes(body.status)) return body;
    await sleep(100);
  }
  throw new Error(`Timeout waiting run ${runId}`);
}

async function readSseSome(baseUrl, url, maxEvents, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const events = [];
  const decoder = new TextDecoder();

  try {
    const res = await fetch(`${baseUrl}${url}`, {
      headers: { Accept: 'text/event-stream' },
      signal: controller.signal,
    });
    assert(res.ok, `SSE failed: ${res.status}`);
    const reader = res.body.getReader();
    let buf = '';

    while (events.length < maxEvents) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      while (true) {
        const sep = buf.indexOf('\n\n');
        if (sep === -1) break;
        const raw = buf.slice(0, sep);
        buf = buf.slice(sep + 2);

        let id = null;
        let event = null;
        let data = null;

        for (const line of raw.split(/\r?\n/g)) {
          if (line.startsWith('id:')) id = line.slice(3).trim();
          if (line.startsWith('event:')) event = line.slice(6).trim();
          if (line.startsWith('data:')) data = line.slice(5).trim();
        }

        if (data) {
          try {
            events.push({ id, event, data: JSON.parse(data) });
          } catch {
            events.push({ id, event, data });
          }
        }
      }
    }
  } catch (err) {
    if (String(err?.name) !== 'AbortError') throw err;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }

  return events;
}

async function main() {
  const projectRoot = path.resolve(__dirname, '..');
  const runsRoot = path.join(projectRoot, 'runs');
  const outDir = path.join(runsRoot, `api-e2e-${getTimestamp()}`);
  fs.mkdirSync(outDir, { recursive: true });
  await writeRunEnv({ outDir, cwd: projectRoot, extra: { kind: 'script', script: 'm2_api_e2e' } });

  const token = `test-token-${Math.random().toString(16).slice(2)}`;

  const allowedRoot = path.join(outDir, 'allowed_root');
  const wsRoot1 = path.join(allowedRoot, 'ws1');
  const wsRoot2 = path.join(allowedRoot, 'ws2');
  const notAllowedRoot = path.join(outDir, 'not_allowed');
  fs.mkdirSync(wsRoot1, { recursive: true });
  fs.mkdirSync(wsRoot2, { recursive: true });
  fs.mkdirSync(notAllowedRoot, { recursive: true });
  fs.writeFileSync(path.join(wsRoot1, 'plan.md'), '# ws1 plan\n', 'utf-8');
  fs.writeFileSync(path.join(wsRoot1, 'convention.md'), '# ws1 convention\n', 'utf-8');
  fs.mkdirSync(path.join(wsRoot1, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(wsRoot1, 'docs', 'notes.md'), '# ws1 notes\n', 'utf-8');
  fs.writeFileSync(path.join(wsRoot1, 'not_markdown.txt'), 'x\n', 'utf-8');
  fs.writeFileSync(path.join(wsRoot2, 'plan.md'), '# ws2 plan\n', 'utf-8');
  fs.writeFileSync(path.join(notAllowedRoot, 'plan.md'), '# bad plan\n', 'utf-8');

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
  const { app, store } = createServer();
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const tmpDirtyFile = path.join(projectRoot, '__tmp_git_dirty_api_e2e__.txt');

  try {
    // health
    const health = await fetchJsonExpect(baseUrl, '/api/health', {}, undefined);
    assert(health.body.ok === true, 'health.ok should be true');

    // auth required
    await fetchJsonExpect(
      baseUrl,
      '/api/workspaces',
      {
        method: 'POST',
        headers: jsonHeaders(''),
        body: JSON.stringify({ name: 'x', rootPath: wsRoot1 }),
      },
      401
    );

    // workspace allowlist
    const ws1 = await fetchJsonExpect(
      baseUrl,
      '/api/workspaces',
      {
        method: 'POST',
        headers: jsonHeaders(token),
        body: JSON.stringify({ name: 'ws1', rootPath: wsRoot1, conventionPath: 'convention.md' }),
      },
      201
    );
    assert(ws1.body.id, 'workspace id missing');

    await fetchJsonExpect(
      baseUrl,
      '/api/workspaces',
      {
        method: 'POST',
        headers: jsonHeaders(token),
        body: JSON.stringify({ name: 'bad', rootPath: notAllowedRoot }),
      },
      400
    );

    const fileAsRoot = path.join(allowedRoot, 'not_a_dir.txt');
    fs.writeFileSync(fileAsRoot, 'x', 'utf-8');
    const notDir = await fetchJsonExpect(
      baseUrl,
      '/api/workspaces',
      {
        method: 'POST',
        headers: jsonHeaders(token),
        body: JSON.stringify({ name: 'notdir', rootPath: fileAsRoot }),
      },
      400
    );
    assert(notDir.body.error === 'ROOT_PATH_NOT_DIR', `expected ROOT_PATH_NOT_DIR, got ${notDir.body.error}`);

    // settings: runtime-editable allowedWorkspaceRoots (persisted in DB)
    const settingsNoAuth = await fetchJsonExpect(
      baseUrl,
      '/api/settings/allowedWorkspaceRoots',
      { method: 'PUT', headers: jsonHeaders(''), body: JSON.stringify({ roots: [allowedRoot] }) },
      401
    );
    assert(settingsNoAuth.body.error === 'UNAUTHORIZED', `expected UNAUTHORIZED, got ${settingsNoAuth.body.error}`);

    const badRoots = await fetchJsonExpect(
      baseUrl,
      '/api/settings/allowedWorkspaceRoots',
      { method: 'PUT', headers: jsonHeaders(token), body: JSON.stringify({ roots: ['relative/path'] }) },
      400
    );
    assert(badRoots.body.error === 'ROOT_PATH_NOT_ABSOLUTE', `expected ROOT_PATH_NOT_ABSOLUTE, got ${badRoots.body.error}`);

    const putRoots = await fetchJsonExpect(
      baseUrl,
      '/api/settings/allowedWorkspaceRoots',
      { method: 'PUT', headers: jsonHeaders(token), body: JSON.stringify({ roots: [allowedRoot, notAllowedRoot] }) },
      200
    );
    assert(putRoots.body.ok === true, 'expected ok=true for put allowed roots');

    const healthAfterPut = await fetchJsonExpect(baseUrl, '/api/health', {}, undefined);
    assert(healthAfterPut.body.allowedWorkspaceRootsSource === 'db', `expected source=db, got ${healthAfterPut.body.allowedWorkspaceRootsSource}`);
    assert(
      Array.isArray(healthAfterPut.body.allowedWorkspaceRoots) && healthAfterPut.body.allowedWorkspaceRoots.some((p) => p === notAllowedRoot),
      'expected notAllowedRoot present in allowedWorkspaceRoots'
    );

    const wsNotAllowedNowAllowed = await fetchJsonExpect(
      baseUrl,
      '/api/workspaces',
      {
        method: 'POST',
        headers: jsonHeaders(token),
        body: JSON.stringify({ name: 'ws_now_allowed', rootPath: notAllowedRoot }),
      },
      201
    );
    assert(wsNotAllowedNowAllowed.body.id, 'workspace id missing for ws_now_allowed');

    const resetRoots = await fetchJsonExpect(
      baseUrl,
      '/api/settings/allowedWorkspaceRoots',
      { method: 'DELETE', headers: jsonHeaders(token) },
      200
    );
    assert(resetRoots.body.ok === true, 'expected ok=true for reset allowed roots');

    const healthAfterReset = await fetchJsonExpect(baseUrl, '/api/health', {}, undefined);
    assert(healthAfterReset.body.allowedWorkspaceRootsSource === 'env', `expected source=env, got ${healthAfterReset.body.allowedWorkspaceRootsSource}`);

    const stillNotAllowed = await fetchJsonExpect(
      baseUrl,
      '/api/workspaces',
      {
        method: 'POST',
        headers: jsonHeaders(token),
        body: JSON.stringify({ name: 'bad_again', rootPath: notAllowedRoot }),
      },
      400
    );
    assert(stillNotAllowed.body.error === 'ROOT_PATH_NOT_ALLOWED', `expected ROOT_PATH_NOT_ALLOWED, got ${stillNotAllowed.body.error}`);

    // plan endpoint
    const plan = await fetchJsonExpect(baseUrl, `/api/workspaces/${ws1.body.id}/plan`, {}, undefined);
    assert(String(plan.body.content || '').includes('# ws1 plan'), 'plan content mismatch');

    // convention endpoint
    const convention = await fetchJsonExpect(baseUrl, `/api/workspaces/${ws1.body.id}/convention`, {}, undefined);
    assert(String(convention.body.content || '').includes('# ws1 convention'), 'convention content mismatch');

    // markdown endpoint (workspace-root relative paths only)
    const mdPlan = await fetchJsonExpect(
      baseUrl,
      `/api/workspaces/${ws1.body.id}/markdown?path=${encodeURIComponent('plan.md')}`,
      {},
      undefined
    );
    assert(String(mdPlan.body.content || '').includes('# ws1 plan'), 'markdown plan content mismatch');

    const mdNotes = await fetchJsonExpect(
      baseUrl,
      `/api/workspaces/${ws1.body.id}/markdown?path=${encodeURIComponent('docs/notes.md')}`,
      {},
      undefined
    );
    assert(String(mdNotes.body.content || '').includes('# ws1 notes'), 'markdown notes content mismatch');

    const mdNotFound = await fetchJsonExpect(
      baseUrl,
      `/api/workspaces/${ws1.body.id}/markdown?path=${encodeURIComponent('missing.md')}`,
      {},
      404
    );
    assert(mdNotFound.body.error === 'FILE_NOT_FOUND', `expected FILE_NOT_FOUND, got ${mdNotFound.body.error}`);

    const mdNotMarkdown = await fetchJsonExpect(
      baseUrl,
      `/api/workspaces/${ws1.body.id}/markdown?path=${encodeURIComponent('not_markdown.txt')}`,
      {},
      400
    );
    assert(mdNotMarkdown.body.error === 'PATH_NOT_MARKDOWN', `expected PATH_NOT_MARKDOWN, got ${mdNotMarkdown.body.error}`);

    const absMd = await fetchJsonExpect(
      baseUrl,
      `/api/workspaces/${ws1.body.id}/markdown?path=${encodeURIComponent(path.join(wsRoot1, 'plan.md'))}`,
      {},
      400
    );
    assert(absMd.body.error === 'PATH_NOT_RELATIVE', `expected PATH_NOT_RELATIVE, got ${absMd.body.error}`);

    const outsideMd = await fetchJsonExpect(
      baseUrl,
      `/api/workspaces/${ws1.body.id}/markdown?path=${encodeURIComponent('../ws2/plan.md')}`,
      {},
      400
    );
    assert(outsideMd.body.error === 'PATH_OUTSIDE_WORKSPACE', `expected PATH_OUTSIDE_WORKSPACE, got ${outsideMd.body.error}`);

    // sessions provider validation
    const invalidProvider = await fetchJsonExpect(
      baseUrl,
      '/api/sessions',
      {
        method: 'POST',
        headers: jsonHeaders(token),
        body: JSON.stringify({ workspaceId: ws1.body.id, role: 'manager', provider: 'nope', config: {} }),
      },
      400
    );
    assert(invalidProvider.body.error === 'PROVIDER_INVALID', 'expected PROVIDER_INVALID');

    const managerSession = await fetchJsonExpect(
      baseUrl,
      '/api/sessions',
      {
        method: 'POST',
        headers: jsonHeaders(token),
        body: JSON.stringify({
          workspaceId: ws1.body.id,
          role: 'manager',
          provider: 'fake',
          config: { sandbox: 'read-only', delayMs: 250 },
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
          workspaceId: ws1.body.id,
          role: 'executor',
          provider: 'fake',
          config: { sandbox: 'read-only', delayMs: 250 },
        }),
      },
      201
    );

    // sessions patch: mode/model/providerSessionId
    await fetchJsonExpect(
      baseUrl,
      `/api/sessions/${encodeURIComponent(managerSession.body.id)}`,
      {
        method: 'PATCH',
        headers: jsonHeaders(''),
        body: JSON.stringify({ config: {} }),
      },
      401
    );

    const patchedManager = await fetchJsonExpect(
      baseUrl,
      `/api/sessions/${encodeURIComponent(managerSession.body.id)}`,
      {
        method: 'PATCH',
        headers: jsonHeaders(token),
        body: JSON.stringify({
          provider: 'fake',
          providerSessionId: 'sid-1',
          config: { sandbox: 'read-only', delayMs: 250, mode: 'stateful_resume', model: 'o3' },
        }),
      },
      200
    );
    assert(patchedManager.body.providerSessionId === 'sid-1', 'expected providerSessionId sid-1');

    const sessionsAfterPatch = await fetchJsonExpect(
      baseUrl,
      `/api/workspaces/${encodeURIComponent(ws1.body.id)}/sessions`,
      {},
      undefined
    );
    const foundManager = (sessionsAfterPatch.body.items || []).find((s) => s.id === managerSession.body.id);
    assert(foundManager, 'expected manager session in list');
    assert(foundManager.providerSessionId === 'sid-1', 'expected providerSessionId in list');
    assert(String(foundManager.configJson || '').includes('stateful_resume'), 'expected mode in configJson');
    assert(String(foundManager.configJson || '').includes('o3'), 'expected model in configJson');

    await fetchJsonExpect(
      baseUrl,
      `/api/sessions/${encodeURIComponent(managerSession.body.id)}`,
      {
        method: 'PATCH',
        headers: jsonHeaders(token),
        body: JSON.stringify({ providerSessionId: null }),
      },
      200
    );

    // step -> paused -> start -> done
    const runStep = await fetchJsonExpect(
      baseUrl,
      '/api/runs',
      {
        method: 'POST',
        headers: jsonHeaders(token),
        body: JSON.stringify({
          workspaceId: ws1.body.id,
          managerSessionId: managerSession.body.id,
          executorSessionId: executorSession.body.id,
          options: { maxTurns: 10, repoDigestEnabled: false, requireGitClean: false, noProgressLimit: 0 },
        }),
      },
      201
    );

    const runIdStep = runStep.body.id;
    const ssePre = await readSseSome(baseUrl, `/api/runs/${runIdStep}/events`, 1, 1500);
    assert(ssePre.length >= 1, 'expected SSE ready/event pre');

    await fetchJsonExpect(
      baseUrl,
      `/api/runs/${runIdStep}/step`,
      { method: 'POST', headers: jsonHeaders(token), body: '{}' },
      200
    );

    const afterStep = await pollRun(baseUrl, runIdStep, 10_000);
    assert(afterStep.status === 'PAUSED', `expected PAUSED after step, got ${afterStep.status}`);
    assert(afterStep.turnIndex === 1, `expected turnIndex=1 after step, got ${afterStep.turnIndex}`);

    await fetchJsonExpect(
      baseUrl,
      `/api/runs/${runIdStep}/start`,
      { method: 'POST', headers: jsonHeaders(token), body: '{}' },
      200
    );
    const doneAfterResume = await pollRun(baseUrl, runIdStep, 15_000);
    assert(doneAfterResume.status === 'DONE', `expected DONE, got ${doneAfterResume.status}`);
    assert(doneAfterResume.turnIndex === 2, `expected turnIndex=2, got ${doneAfterResume.turnIndex}`);

    // run_env.json should be written per run (约定.md 7.4)
    const runEnvPath = path.join(runsDir, ws1.body.id, runIdStep, 'run_env.json');
    assert(fs.existsSync(runEnvPath), `expected ${runEnvPath} to exist`);
    const runEnv = JSON.parse(fs.readFileSync(runEnvPath, 'utf-8'));
    assert(runEnv.cwd === wsRoot1, `expected run_env.cwd === wsRoot1, got ${runEnv.cwd}`);
    assert(String(runEnv.nodeV || '').startsWith('v'), 'expected run_env.nodeV like v22.x');

    // export
    const md = await fetchTextExpect(baseUrl, `/api/runs/${runIdStep}/export?format=md`, { headers: { 'x-admin-token': token } }, 200);
    assert(md.text.includes(`# Run ${runIdStep}`), 'md export missing header');
    const js = await fetchTextExpect(baseUrl, `/api/runs/${runIdStep}/export?format=json`, { headers: { 'x-admin-token': token } }, 200);
    assert(js.text.includes(`"id": "${runIdStep}"`), 'json export missing id');
    const jsl = await fetchTextExpect(baseUrl, `/api/runs/${runIdStep}/export?format=jsonl`, { headers: { 'x-admin-token': token } }, 200);
    assert(jsl.text.trim().length > 0, 'jsonl export empty');

    // pause semantics: should pause AFTER the current turn ends (no abort mid-turn)
    const managerSlow = await fetchJsonExpect(
      baseUrl,
      '/api/sessions',
      {
        method: 'POST',
        headers: jsonHeaders(token),
        body: JSON.stringify({
          workspaceId: ws1.body.id,
          role: 'manager',
          provider: 'fake',
          config: { sandbox: 'read-only', delayMs: 500 },
        }),
      },
      201
    );
    const executorSlow = await fetchJsonExpect(
      baseUrl,
      '/api/sessions',
      {
        method: 'POST',
        headers: jsonHeaders(token),
        body: JSON.stringify({
          workspaceId: ws1.body.id,
          role: 'executor',
          provider: 'fake',
          config: { sandbox: 'read-only', delayMs: 500 },
        }),
      },
      201
    );
    const runPause = await fetchJsonExpect(
      baseUrl,
      '/api/runs',
      {
        method: 'POST',
        headers: jsonHeaders(token),
        body: JSON.stringify({
          workspaceId: ws1.body.id,
          managerSessionId: managerSlow.body.id,
          executorSessionId: executorSlow.body.id,
          options: { maxTurns: 10, repoDigestEnabled: false, requireGitClean: false, noProgressLimit: 0 },
        }),
      },
      201
    );

    const runIdPause = runPause.body.id;
    await fetchJsonExpect(baseUrl, `/api/runs/${runIdPause}/start`, { method: 'POST', headers: jsonHeaders(token), body: '{}' }, 200);
    await sleep(50);
    await fetchJsonExpect(
      baseUrl,
      `/api/runs/${runIdPause}/pause`,
      { method: 'POST', headers: jsonHeaders(token), body: JSON.stringify({ reason: 'user-pause' }) },
      200
    );

    const pausedAfterPause = await pollRun(baseUrl, runIdPause, 20_000);
    assert(pausedAfterPause.status === 'PAUSED', `expected PAUSED after pause, got ${pausedAfterPause.status}`);
    assert(pausedAfterPause.turnIndex === 1, `expected turnIndex=1 after pause, got ${pausedAfterPause.turnIndex}`);
    assert(Array.isArray(pausedAfterPause.turns) && pausedAfterPause.turns.length === 1, 'expected exactly 1 completed turn');
    assert(pausedAfterPause.turns[0].endedAt, 'expected turn endedAt set (pause must not abort current turn)');
    assert(
      String(pausedAfterPause.turns[0].executorOutput || '').includes('<EXEC_LOG>'),
      'expected executorOutput present (pause must not stop mid-turn)'
    );

    // dangerousCommandGuard
    const executorDanger = await fetchJsonExpect(
      baseUrl,
      '/api/sessions',
      {
        method: 'POST',
        headers: jsonHeaders(token),
        body: JSON.stringify({
          workspaceId: ws1.body.id,
          role: 'executor',
          provider: 'fake',
          config: { sandbox: 'read-only', delayMs: 50, dangerousExecLog: true },
        }),
      },
      201
    );
    const runDanger = await fetchJsonExpect(
      baseUrl,
      '/api/runs',
      {
        method: 'POST',
        headers: jsonHeaders(token),
        body: JSON.stringify({
          workspaceId: ws1.body.id,
          managerSessionId: managerSession.body.id,
          executorSessionId: executorDanger.body.id,
          options: { maxTurns: 10, repoDigestEnabled: false, requireGitClean: false, noProgressLimit: 0, dangerousCommandGuard: true },
        }),
      },
      201
    );
    await fetchJsonExpect(
      baseUrl,
      `/api/runs/${runDanger.body.id}/start`,
      { method: 'POST', headers: jsonHeaders(token), body: '{}' },
      200
    );
    const pausedDanger = await pollRun(baseUrl, runDanger.body.id, 15_000);
    assert(pausedDanger.status === 'PAUSED', `expected PAUSED for dangerous run, got ${pausedDanger.status}`);
    assert(pausedDanger.error === 'DANGEROUS_COMMAND', `expected DANGEROUS_COMMAND, got ${pausedDanger.error}`);

    // workspace lock + max concurrent runs
    const ws2 = await fetchJsonExpect(
      baseUrl,
      '/api/workspaces',
      {
        method: 'POST',
        headers: jsonHeaders(token),
        body: JSON.stringify({ name: 'ws2', rootPath: wsRoot2 }),
      },
      201
    );
    const mgr2 = await fetchJsonExpect(
      baseUrl,
      '/api/sessions',
      {
        method: 'POST',
        headers: jsonHeaders(token),
        body: JSON.stringify({ workspaceId: ws2.body.id, role: 'manager', provider: 'fake', config: { sandbox: 'read-only', delayMs: 350 } }),
      },
      201
    );
    const ex2 = await fetchJsonExpect(
      baseUrl,
      '/api/sessions',
      {
        method: 'POST',
        headers: jsonHeaders(token),
        body: JSON.stringify({ workspaceId: ws2.body.id, role: 'executor', provider: 'fake', config: { sandbox: 'read-only', delayMs: 350 } }),
      },
      201
    );

    const runA = await fetchJsonExpect(
      baseUrl,
      '/api/runs',
      {
        method: 'POST',
        headers: jsonHeaders(token),
        body: JSON.stringify({
          workspaceId: ws1.body.id,
          managerSessionId: managerSession.body.id,
          executorSessionId: executorSession.body.id,
          options: { maxTurns: 10, repoDigestEnabled: false, requireGitClean: false, noProgressLimit: 0 },
        }),
      },
      201
    );
    const runB = await fetchJsonExpect(
      baseUrl,
      '/api/runs',
      {
        method: 'POST',
        headers: jsonHeaders(token),
        body: JSON.stringify({
          workspaceId: ws2.body.id,
          managerSessionId: mgr2.body.id,
          executorSessionId: ex2.body.id,
          options: { maxTurns: 10, repoDigestEnabled: false, requireGitClean: false, noProgressLimit: 0 },
        }),
      },
      201
    );

    await fetchJsonExpect(
      baseUrl,
      `/api/runs/${runA.body.id}/start`,
      { method: 'POST', headers: jsonHeaders(token), body: '{}' },
      200
    );

    const locked = await fetchJsonExpect(
      baseUrl,
      `/api/runs/${runA.body.id}/start`,
      { method: 'POST', headers: jsonHeaders(token), body: '{}' },
      400
    );
    assert(locked.body.error === 'RUN_ALREADY_RUNNING', `expected RUN_ALREADY_RUNNING, got ${locked.body.error}`);

    const concurrent = await fetchJsonExpect(
      baseUrl,
      `/api/runs/${runB.body.id}/start`,
      { method: 'POST', headers: jsonHeaders(token), body: '{}' },
      400
    );
    assert(
      concurrent.body.error === 'MAX_CONCURRENT_RUNS_REACHED',
      `expected MAX_CONCURRENT_RUNS_REACHED, got ${concurrent.body.error}`
    );

    const doneA = await pollRun(baseUrl, runA.body.id, 20_000);
    assert(doneA.status === 'DONE', `expected DONE for runA, got ${doneA.status}`);

    await fetchJsonExpect(
      baseUrl,
      `/api/runs/${runB.body.id}/start`,
      { method: 'POST', headers: jsonHeaders(token), body: '{}' },
      200
    );
    const doneB = await pollRun(baseUrl, runB.body.id, 25_000);
    assert(doneB.status === 'DONE', `expected DONE for runB, got ${doneB.status}`);

    // requireGitClean (force dirty and expect pause)
    fs.writeFileSync(tmpDirtyFile, 'dirty', 'utf-8');
    const runDirty = await fetchJsonExpect(
      baseUrl,
      '/api/runs',
      {
        method: 'POST',
        headers: jsonHeaders(token),
        body: JSON.stringify({
          workspaceId: ws1.body.id,
          managerSessionId: managerSession.body.id,
          executorSessionId: executorSession.body.id,
          options: { maxTurns: 10, repoDigestEnabled: false, requireGitClean: true, noProgressLimit: 0 },
        }),
      },
      201
    );
    await fetchJsonExpect(
      baseUrl,
      `/api/runs/${runDirty.body.id}/start`,
      { method: 'POST', headers: jsonHeaders(token), body: '{}' },
      200
    );
    const pausedDirty = await pollRun(baseUrl, runDirty.body.id, 20_000);
    assert(pausedDirty.status === 'PAUSED', `expected PAUSED for dirty run, got ${pausedDirty.status}`);
    assert(pausedDirty.error === 'GIT_DIRTY', `expected GIT_DIRTY, got ${pausedDirty.error}`);

    // noProgressLimit: when manager keeps looping and executor reports no changes, should auto-pause
    const mgrLoop = await fetchJsonExpect(
      baseUrl,
      '/api/sessions',
      {
        method: 'POST',
        headers: jsonHeaders(token),
        body: JSON.stringify({
          workspaceId: ws2.body.id,
          role: 'manager',
          provider: 'fake',
          config: { sandbox: 'read-only', delayMs: 10, loopManagerPacket: true },
        }),
      },
      201
    );
    const exLoop = await fetchJsonExpect(
      baseUrl,
      '/api/sessions',
      {
        method: 'POST',
        headers: jsonHeaders(token),
        body: JSON.stringify({ workspaceId: ws2.body.id, role: 'executor', provider: 'fake', config: { sandbox: 'read-only', delayMs: 10 } }),
      },
      201
    );

    const runLoop = await fetchJsonExpect(
      baseUrl,
      '/api/runs',
      {
        method: 'POST',
        headers: jsonHeaders(token),
        body: JSON.stringify({
          workspaceId: ws2.body.id,
          managerSessionId: mgrLoop.body.id,
          executorSessionId: exLoop.body.id,
          options: { maxTurns: 20, repoDigestEnabled: false, requireGitClean: false, noProgressLimit: 1 },
        }),
      },
      201
    );
    await fetchJsonExpect(
      baseUrl,
      `/api/runs/${runLoop.body.id}/start`,
      { method: 'POST', headers: jsonHeaders(token), body: '{}' },
      200
    );
    const pausedNoProgress = await pollRun(baseUrl, runLoop.body.id, 20_000);
    assert(pausedNoProgress.status === 'PAUSED', `expected PAUSED for no-progress run, got ${pausedNoProgress.status}`);
    assert(pausedNoProgress.error === 'NO_PROGRESS', `expected NO_PROGRESS, got ${pausedNoProgress.error}`);
    assert(pausedNoProgress.turnIndex >= 2, `expected turnIndex>=2, got ${pausedNoProgress.turnIndex}`);

    console.log(`[m2_api_e2e] PASS baseUrl=${baseUrl} outDir=${outDir}`);
  } finally {
    try {
      if (fs.existsSync(tmpDirtyFile)) fs.unlinkSync(tmpDirtyFile);
    } catch {}
    await new Promise((resolve) => server.close(resolve));
    store.close();
  }
}

main().catch((err) => {
  console.error(`[m2_api_e2e] FAIL: ${err.message}`);
  process.exit(1);
});
