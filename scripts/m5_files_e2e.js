/**
 * M5 Files API e2e (no browser):
 * - workspace fs list/read/blob/write
 * - hidden path gating via ADMIN_TOKEN
 * - optimistic lock via baseMtimeMs
 *
 * Notes:
 * - Writes artifacts under runs/files-e2e-* (gitignored).
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

async function fetchBufferExpect(baseUrl, url, options, expectedStatus) {
  const res = await fetch(`${baseUrl}${url}`, options);
  const buf = Buffer.from(await res.arrayBuffer());
  if (expectedStatus !== undefined) {
    assert(res.status === expectedStatus, `Expected ${expectedStatus}, got ${res.status} for ${url}`);
  } else {
    assert(res.ok, `HTTP ${res.status} for ${url}`);
  }
  return { res, buf };
}

function writePng1x1(filePath) {
  const base64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO3ZQ5kAAAAASUVORK5CYII=';
  fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
}

async function main() {
  const projectRoot = path.resolve(__dirname, '..');
  const runsRoot = path.join(projectRoot, 'runs');
  const outDir = path.join(runsRoot, `files-e2e-${getTimestamp()}`);
  fs.mkdirSync(outDir, { recursive: true });
  await writeRunEnv({ outDir, cwd: projectRoot, extra: { kind: 'script', script: 'm5_files_e2e' } });

  const token = `test-token-${Math.random().toString(16).slice(2)}`;

  const allowedRoot = path.join(outDir, 'allowed_root');
  const wsRoot1 = path.join(allowedRoot, 'ws1');
  fs.mkdirSync(wsRoot1, { recursive: true });
  fs.writeFileSync(path.join(wsRoot1, 'plan.md'), '# ws1 plan\n', 'utf-8');
  fs.writeFileSync(path.join(wsRoot1, 'hello.txt'), 'hello\n', 'utf-8');
  fs.writeFileSync(path.join(wsRoot1, 'doc.md'), '# doc\n\nhi\n', 'utf-8');
  fs.writeFileSync(path.join(wsRoot1, '.secret.txt'), 'secret\n', 'utf-8');
  fs.mkdirSync(path.join(wsRoot1, '.hdir'), { recursive: true });
  fs.writeFileSync(path.join(wsRoot1, '.hdir', 'x.txt'), 'x\n', 'utf-8');
  fs.mkdirSync(path.join(wsRoot1, 'dir1'), { recursive: true });
  fs.writeFileSync(path.join(wsRoot1, 'dir1', 'a.txt'), 'a\n', 'utf-8');
  writePng1x1(path.join(wsRoot1, 'img.png'));

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

    // list (no token): should hide dotfiles
    const listNoToken = await fetchJsonExpect(baseUrl, `/api/workspaces/${encodeURIComponent(workspaceId)}/fs/list?path=`, {}, 200);
    assert(listNoToken.body.ok === true, 'listNoToken.ok should be true');
    assert(listNoToken.body.includeHidden === false, 'listNoToken.includeHidden should be false');
    assert(listNoToken.body.readOnly === true, 'listNoToken.readOnly should be true');
    const namesNoToken = (listNoToken.body.items || []).map((x) => x.name);
    assert(namesNoToken.includes('hello.txt'), 'hello.txt should be listed without token');
    assert(!namesNoToken.includes('.secret.txt'), '.secret.txt should not be listed without token');
    assert(!namesNoToken.includes('.hdir'), '.hdir should not be listed without token');

    // list (with token): should include dotfiles
    const listWithToken = await fetchJsonExpect(
      baseUrl,
      `/api/workspaces/${encodeURIComponent(workspaceId)}/fs/list?path=`,
      { headers: { 'x-admin-token': token } },
      200
    );
    assert(listWithToken.body.includeHidden === true, 'listWithToken.includeHidden should be true');
    assert(listWithToken.body.readOnly === false, 'listWithToken.readOnly should be false');
    const namesWithToken = (listWithToken.body.items || []).map((x) => x.name);
    assert(namesWithToken.includes('.secret.txt'), '.secret.txt should be listed with token');
    assert(namesWithToken.includes('.hdir'), '.hdir should be listed with token');

    // dir listing
    const listDir1 = await fetchJsonExpect(
      baseUrl,
      `/api/workspaces/${encodeURIComponent(workspaceId)}/fs/list?path=dir1`,
      {},
      200
    );
    const dir1Names = (listDir1.body.items || []).map((x) => x.name);
    assert(dir1Names.includes('a.txt'), 'dir1/a.txt should be listed');

    // read visible text (no token)
    const readHello = await fetchJsonExpect(
      baseUrl,
      `/api/workspaces/${encodeURIComponent(workspaceId)}/fs/text?path=hello.txt`,
      {},
      200
    );
    assert(String(readHello.body.content || '').includes('hello'), 'hello.txt content should be readable without token');
    assert(readHello.body.readOnly === true, 'readHello.readOnly should be true');

    // read hidden (no token) forbidden
    const readHiddenNoToken = await fetchJsonExpect(
      baseUrl,
      `/api/workspaces/${encodeURIComponent(workspaceId)}/fs/text?path=.secret.txt`,
      {},
      403
    );
    assert(readHiddenNoToken.body.error === 'HIDDEN_PATH_FORBIDDEN', 'hidden read without token should be forbidden');

    // read hidden (with token)
    const readHiddenWithToken = await fetchJsonExpect(
      baseUrl,
      `/api/workspaces/${encodeURIComponent(workspaceId)}/fs/text?path=.secret.txt`,
      { headers: { 'x-admin-token': token } },
      200
    );
    assert(String(readHiddenWithToken.body.content || '').includes('secret'), 'hidden content should be readable with token');
    assert(readHiddenWithToken.body.readOnly === false, 'readHiddenWithToken.readOnly should be false');

    // write visible text (with token) + optimistic lock
    const beforeWrite = await fetchJsonExpect(
      baseUrl,
      `/api/workspaces/${encodeURIComponent(workspaceId)}/fs/text?path=hello.txt`,
      { headers: { 'x-admin-token': token } },
      200
    );
    const baseMtimeMs = beforeWrite.body.mtimeMs;
    assert(Number.isFinite(Number(baseMtimeMs)), 'baseMtimeMs should be a number');

    const writeOk = await fetchJsonExpect(
      baseUrl,
      `/api/workspaces/${encodeURIComponent(workspaceId)}/fs/text`,
      {
        method: 'PUT',
        headers: jsonHeaders(token),
        body: JSON.stringify({ path: 'hello.txt', content: 'updated\n', baseMtimeMs }),
      },
      200
    );
    assert(writeOk.body.ok === true, 'write ok should be true');

    const afterWrite = await fetchJsonExpect(
      baseUrl,
      `/api/workspaces/${encodeURIComponent(workspaceId)}/fs/text?path=hello.txt`,
      {},
      200
    );
    assert(String(afterWrite.body.content || '').includes('updated'), 'hello.txt should reflect updated content');

    // stale write should be rejected
    const beforeStale = await fetchJsonExpect(
      baseUrl,
      `/api/workspaces/${encodeURIComponent(workspaceId)}/fs/text?path=doc.md`,
      { headers: { 'x-admin-token': token } },
      200
    );
    const staleMtime = beforeStale.body.mtimeMs;
    fs.writeFileSync(path.join(wsRoot1, 'doc.md'), '# doc\n\nchanged outside\n', 'utf-8');

    const staleWrite = await fetchJsonExpect(
      baseUrl,
      `/api/workspaces/${encodeURIComponent(workspaceId)}/fs/text`,
      {
        method: 'PUT',
        headers: jsonHeaders(token),
        body: JSON.stringify({ path: 'doc.md', content: '# doc\n\nnew content\n', baseMtimeMs: staleMtime }),
      },
      409
    );
    assert(staleWrite.body.error === 'FILE_CHANGED', 'stale write should return FILE_CHANGED');

    // blob: image should be fetchable without token and have image content-type
    const img = await fetchBufferExpect(baseUrl, `/api/workspaces/${encodeURIComponent(workspaceId)}/fs/blob?path=img.png`, {}, 200);
    assert(img.buf.length > 8, 'img.png should return some bytes');
    const ct = String(img.res.headers.get('content-type') || '');
    assert(ct.includes('image/png'), `expected image/png, got ${ct}`);

    // write to binary should be blocked
    const writeBin = await fetchJsonExpect(
      baseUrl,
      `/api/workspaces/${encodeURIComponent(workspaceId)}/fs/text`,
      {
        method: 'PUT',
        headers: jsonHeaders(token),
        body: JSON.stringify({ path: 'img.png', content: 'oops', baseMtimeMs: 0 }),
      },
      400
    );
    assert(writeBin.body.error === 'FILE_NOT_TEXT', 'writing binary should return FILE_NOT_TEXT');
  } finally {
    server.close();
  }

  // eslint-disable-next-line no-console
  console.log(`[m5_files_e2e] PASS outDir=${outDir}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(`[m5_files_e2e] FAIL: ${err.message}`);
  process.exit(1);
});
