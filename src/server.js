const fs = require('fs');
const path = require('path');

const express = require('express');

const { config } = require('./config');
const { Store } = require('./storage/store');
const { SseHub } = require('./sse_hub');
const { requireAdmin, extractToken } = require('./http/auth');
const { isWorkspacePathAllowed, isInside } = require('./http/paths');
const { normalizeRelPath, isHiddenRelPath, listDir, readTextFile, writeTextFile, resolveWorkspaceAbsPath, assertInsideWorkspace } = require('./http/workspace_fs');
const { Orchestrator } = require('./orchestrator/orchestrator');
const { exportRunToMarkdown, exportRunToJson, exportRunToJsonl } = require('./exporters/run_export');
const { getRepoDigest } = require('./repo_digest');
const { createNotifier } = require('./notify/notifier');
const { TopicSseHub } = require('./topic_sse_hub');
const {
  queueAskSend,
  isAskThreadBusy,
  stopAskThread,
  exportAskThreadToMarkdown,
  exportAskThreadToJsonl,
} = require('./ask/ask_service');
const {
  probeCapabilities,
  loadCapabilitiesFromDisk,
  persistCapabilitiesToDisk,
} = require('./capabilities');

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function readTextPreview(filePath, maxChars) {
  if (!filePath) return null;
  try {
    if (!fs.existsSync(filePath)) return null;
    const text = fs.readFileSync(filePath, 'utf-8');
    if (text.length <= maxChars) return text;
    return `${text.slice(0, maxChars)}\n...(truncated)`;
  } catch {
    return null;
  }
}

function shortId(id) {
  const s = String(id || '');
  return s.length <= 8 ? s : s.slice(0, 8);
}

function nowIso() {
  return new Date().toISOString();
}

function truncateText(text, maxChars) {
  const t = String(text ?? '');
  if (t.length <= maxChars) return t;
  return `${t.slice(0, maxChars)}\n...(truncated)`;
}

function resolveWorkspaceFilePath(absRoot, filePath, defaultBasename) {
  const raw = String(filePath || '').trim();
  if (!raw) return path.join(absRoot, defaultBasename);
  if (path.isAbsolute(raw)) return path.resolve(raw);
  return path.resolve(absRoot, raw);
}

function createServer() {
  const store = new Store(config.dbPath);
  const sseHub = new SseHub({ store });
  const askSseHub = new TopicSseHub({ heartbeatMs: 25_000 });
  const notifier = createNotifier({ config });
  const orchestrator = new Orchestrator({ store, sseHub, config, notifier });

  const runtime = {
    allowedWorkspaceRoots: Array.isArray(config.allowedWorkspaceRoots) ? [...config.allowedWorkspaceRoots] : [],
    allowedWorkspaceRootsSource: 'env',
    allowedWorkspaceRootsUpdatedAt: null,
    allowedWorkspaceRootsError: null,
  };

  const app = express();
  app.use(express.json({ limit: '6mb' }));

  function isAdminRequest(req) {
    const token = extractToken(req);
    return Boolean(token && token === config.adminToken);
  }

  function normalizeAllowedWorkspaceRootsValue(value) {
    const v = value && typeof value === 'object' && !Array.isArray(value) ? value.roots : value;
    if (!Array.isArray(v)) return null;

    const out = [];
    for (const item of v) {
      const raw = String(item ?? '').trim();
      if (!raw) continue;
      if (raw.includes('\0')) throw new Error('ROOT_PATH_INVALID');
      if (!path.isAbsolute(raw)) throw new Error('ROOT_PATH_NOT_ABSOLUTE');
      const abs = path.resolve(raw);
      if (fs.existsSync(abs) && !fs.statSync(abs).isDirectory()) throw new Error('ROOT_PATH_NOT_DIR');
      out.push(abs);
    }

    const seen = new Set();
    const unique = [];
    for (const p of out) {
      const key = process.platform === 'win32' ? p.toLowerCase() : p;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(p);
    }

    return unique;
  }

  function refreshAllowedWorkspaceRootsFromStore() {
    const row = store.getSetting('allowedWorkspaceRoots');
    if (!row) {
      runtime.allowedWorkspaceRoots = Array.isArray(config.allowedWorkspaceRoots) ? [...config.allowedWorkspaceRoots] : [];
      runtime.allowedWorkspaceRootsSource = 'env';
      runtime.allowedWorkspaceRootsUpdatedAt = null;
      runtime.allowedWorkspaceRootsError = null;
      return;
    }

    const parsed = safeJsonParse(row.valueJson, null);
    let normalized = null;
    try {
      normalized = normalizeAllowedWorkspaceRootsValue(parsed);
      runtime.allowedWorkspaceRootsError = null;
    } catch (err) {
      runtime.allowedWorkspaceRootsError = String(err?.message || err);
      normalized = null;
    }
    if (!normalized || normalized.length === 0) {
      runtime.allowedWorkspaceRoots = Array.isArray(config.allowedWorkspaceRoots) ? [...config.allowedWorkspaceRoots] : [];
      runtime.allowedWorkspaceRootsSource = 'env';
      runtime.allowedWorkspaceRootsUpdatedAt = null;
      return;
    }

    runtime.allowedWorkspaceRoots = normalized;
    runtime.allowedWorkspaceRootsSource = 'db';
    runtime.allowedWorkspaceRootsUpdatedAt = row.updatedAt || null;
  }

  function getAllowedWorkspaceRoots() {
    return runtime.allowedWorkspaceRoots;
  }

  refreshAllowedWorkspaceRootsFromStore();

  function safeInlineImageContentType(ext) {
    const e = String(ext || '').toLowerCase();
    if (e === '.png') return 'image/png';
    if (e === '.jpg' || e === '.jpeg') return 'image/jpeg';
    if (e === '.gif') return 'image/gif';
    if (e === '.webp') return 'image/webp';
    if (e === '.avif') return 'image/avif';
    if (e === '.bmp') return 'image/bmp';
    if (e === '.ico') return 'image/x-icon';
    return null;
  }

  app.get('/api/health', (req, res) => {
    res.json({
      ok: true,
      name: 'auto_codex',
      adminTokenSource: config.adminTokenSource,
      allowedWorkspaceRoots: getAllowedWorkspaceRoots(),
      allowedWorkspaceRootsSource: runtime.allowedWorkspaceRootsSource,
      allowedWorkspaceRootsUpdatedAt: runtime.allowedWorkspaceRootsUpdatedAt,
      allowedWorkspaceRootsError: runtime.allowedWorkspaceRootsError,
      maxConcurrentRuns: config.maxConcurrentRuns,
      readOnlyMode: config.readOnlyMode,
    });
  });

  app.put('/api/settings/allowedWorkspaceRoots', requireAdmin({ config }), (req, res) => {
    try {
      const roots = req.body?.roots;
      let list = [];
      if (Array.isArray(roots)) {
        list = roots;
      } else if (typeof roots === 'string') {
        list = roots
          .split(/[\r\n;,]+/g)
          .map((s) => s.trim())
          .filter(Boolean);
      } else {
        return res.status(400).json({ error: 'ROOTS_REQUIRED' });
      }

      const normalized = normalizeAllowedWorkspaceRootsValue(list);
      if (!normalized || normalized.length === 0) return res.status(400).json({ error: 'ROOTS_EMPTY' });
      if (normalized.length > 80) return res.status(400).json({ error: 'ROOTS_TOO_MANY' });

      store.setSetting('allowedWorkspaceRoots', JSON.stringify(normalized));
      refreshAllowedWorkspaceRootsFromStore();
      res.json({
        ok: true,
        allowedWorkspaceRoots: getAllowedWorkspaceRoots(),
        allowedWorkspaceRootsSource: runtime.allowedWorkspaceRootsSource,
        allowedWorkspaceRootsUpdatedAt: runtime.allowedWorkspaceRootsUpdatedAt,
      });
    } catch (err) {
      const code = String(err?.message || 'ROOTS_INVALID');
      res.status(400).json({ error: code });
    }
  });

  app.delete('/api/settings/allowedWorkspaceRoots', requireAdmin({ config }), (req, res) => {
    store.deleteSetting('allowedWorkspaceRoots');
    refreshAllowedWorkspaceRootsFromStore();
    res.json({
      ok: true,
      allowedWorkspaceRoots: getAllowedWorkspaceRoots(),
      allowedWorkspaceRootsSource: runtime.allowedWorkspaceRootsSource,
      allowedWorkspaceRootsUpdatedAt: runtime.allowedWorkspaceRootsUpdatedAt,
    });
  });

  app.get('/api/capabilities', (req, res) => {
    const row = store.getSetting('capabilities');
    const fromDb = safeJsonParse(row?.valueJson, null);
    if (fromDb) return res.json({ ok: true, source: 'db', snapshot: fromDb });

    const fromDisk = loadCapabilitiesFromDisk(config);
    if (fromDisk) return res.json({ ok: true, source: 'disk', snapshot: fromDisk });

    res.json({ ok: false, error: 'NOT_PROBED' });
  });

  app.post('/api/capabilities/probe', requireAdmin({ config }), async (req, res) => {
    try {
      const snapshot = await probeCapabilities({ cwd: process.cwd() });
      store.setSetting('capabilities', JSON.stringify(snapshot));
      let persistedPath = null;
      try {
        persistedPath = persistCapabilitiesToDisk(config, snapshot).path;
      } catch {}
      res.json({ ok: true, source: 'probe', persistedPath, snapshot });
    } catch (err) {
      res.status(500).json({ ok: false, error: 'PROBE_FAILED', message: String(err.message || err) });
    }
  });

  app.get('/api/workspaces', (req, res) => {
    res.json({ items: store.listWorkspaces() });
  });

  // Home page: lightweight summaries across all workspaces.
  // - /api/home/summary: no ADMIN_TOKEN required (runs + workspace ids only)
  // - /api/home/ask: ADMIN_TOKEN required (ask thread status + last messages)
  app.get('/api/home/summary', (req, res) => {
    const workspaces = store.listWorkspaces();
    const items = workspaces.map((ws) => {
      const runs = store.listRuns(ws.id, 1);
      const latestRun = Array.isArray(runs) && runs.length ? runs[0] : null;
      return { workspaceId: ws.id, latestRun };
    });
    res.json({ ok: true, ts: Date.now(), items });
  });

  app.get('/api/home/ask', requireAdmin({ config }), (req, res) => {
    const workspaces = store.listWorkspaces();
    const items = workspaces.map((ws) => {
      const threads = store.listAskThreads(ws.id).map((t0) => {
        const lastMsg = store.listAskMessagesTail(t0.id, 1)[0] || null;
        const lastAssistant = store.getAskLastAssistantMessage(t0.id);
        const counts = store.getAskQueueCounts(t0.id);
        const lastQueueError = store.getAskLastQueueError(t0.id);
        return {
          ...t0,
          busy: isAskThreadBusy(t0.id),
          lastMessage: lastMsg
            ? {
                id: lastMsg.id,
                role: lastMsg.role,
                createdAt: lastMsg.createdAt,
                text: truncateText(String(lastMsg.text || '').trim(), 260),
              }
            : null,
          lastAssistant: lastAssistant
            ? {
                id: lastAssistant.id,
                createdAt: lastAssistant.createdAt,
                error: String(lastAssistant?.meta?.error || '').trim() || null,
                text: truncateText(String(lastAssistant.text || '').trim(), 400),
              }
            : null,
          queue: {
            queued: Number(counts?.queued || 0),
            running: Number(counts?.running || 0),
            error: Number(counts?.error || 0),
            lastError: lastQueueError
              ? {
                  id: lastQueueError.id,
                  error: String(lastQueueError.error || '').trim() || 'ASK_QUEUE_ERROR',
                  updatedAt: lastQueueError.updatedAt,
                  endedAt: lastQueueError.endedAt,
                }
              : null,
          },
        };
      });
      return { workspaceId: ws.id, threads };
    });
    res.json({ ok: true, ts: Date.now(), items });
  });

  app.get('/api/workspaces/:id/plan', (req, res) => {
    const ws = store.getWorkspace(req.params.id);
    if (!ws) return res.status(404).json({ error: 'WORKSPACE_NOT_FOUND' });
    if (!isInside(ws.rootPath, ws.planPath)) {
      return res.status(400).json({ error: 'PATH_OUTSIDE_WORKSPACE', field: 'planPath', path: ws.planPath });
    }
    try {
      const content = fs.readFileSync(ws.planPath, 'utf-8');
      const maxChars = 400_000;
      res.json({
        planPath: ws.planPath,
        truncated: content.length > maxChars,
        content: content.length > maxChars ? `${content.slice(0, maxChars)}\n...(truncated)` : content,
      });
    } catch (err) {
      res.status(500).json({ error: 'PLAN_READ_FAILED' });
    }
  });

  app.get('/api/workspaces/:id/convention', (req, res) => {
    const ws = store.getWorkspace(req.params.id);
    if (!ws) return res.status(404).json({ error: 'WORKSPACE_NOT_FOUND' });
    if (!isInside(ws.rootPath, ws.conventionPath)) {
      return res.status(400).json({ error: 'PATH_OUTSIDE_WORKSPACE', field: 'conventionPath', path: ws.conventionPath });
    }
    try {
      const content = fs.readFileSync(ws.conventionPath, 'utf-8');
      const maxChars = 400_000;
      res.json({
        conventionPath: ws.conventionPath,
        truncated: content.length > maxChars,
        content: content.length > maxChars ? `${content.slice(0, maxChars)}\n...(truncated)` : content,
      });
    } catch (err) {
      res.status(500).json({ error: 'CONVENTION_READ_FAILED' });
    }
  });

  app.get('/api/workspaces/:id/requirements', (req, res) => {
    const ws = store.getWorkspace(req.params.id);
    if (!ws) return res.status(404).json({ error: 'WORKSPACE_NOT_FOUND' });
    if (!isInside(ws.rootPath, ws.requirementsPath)) {
      return res
        .status(400)
        .json({ error: 'PATH_OUTSIDE_WORKSPACE', field: 'requirementsPath', path: ws.requirementsPath });
    }
    try {
      const content = fs.readFileSync(ws.requirementsPath, 'utf-8');
      const maxChars = 400_000;
      res.json({
        requirementsPath: ws.requirementsPath,
        truncated: content.length > maxChars,
        content: content.length > maxChars ? `${content.slice(0, maxChars)}\n...(truncated)` : content,
      });
    } catch (err) {
      if (String(err?.code || '') === 'ENOENT') {
        return res.status(404).json({ error: 'FILE_NOT_FOUND', requirementsPath: ws.requirementsPath });
      }
      res.status(500).json({ error: 'REQUIREMENTS_READ_FAILED', requirementsPath: ws.requirementsPath });
    }
  });

  app.get('/api/workspaces/:id/markdown', (req, res) => {
    const ws = store.getWorkspace(req.params.id);
    if (!ws) return res.status(404).json({ error: 'WORKSPACE_NOT_FOUND' });

    const relPath = String(req.query?.path || '').trim();
    if (!relPath) return res.status(400).json({ error: 'PATH_REQUIRED' });
    if (path.isAbsolute(relPath)) return res.status(400).json({ error: 'PATH_NOT_RELATIVE' });

    const absPath = path.resolve(ws.rootPath, relPath);
    if (!isInside(ws.rootPath, absPath)) return res.status(400).json({ error: 'PATH_OUTSIDE_WORKSPACE' });
    if (path.extname(absPath).toLowerCase() !== '.md') return res.status(400).json({ error: 'PATH_NOT_MARKDOWN' });

    try {
      const content = fs.readFileSync(absPath, 'utf-8');
      const maxChars = 400_000;
      res.json({
        path: absPath,
        truncated: content.length > maxChars,
        content: content.length > maxChars ? `${content.slice(0, maxChars)}\n...(truncated)` : content,
      });
    } catch (err) {
      if (String(err?.code || '') === 'ENOENT') return res.status(404).json({ error: 'FILE_NOT_FOUND' });
      res.status(500).json({ error: 'MARKDOWN_READ_FAILED' });
    }
  });

  app.get('/api/workspaces/:id/fs/list', (req, res) => {
    const ws = store.getWorkspace(req.params.id);
    if (!ws) return res.status(404).json({ error: 'WORKSPACE_NOT_FOUND' });
    const includeHidden = isAdminRequest(req);
    const relRaw = req.query?.path;

    let relPath = '';
    try {
      relPath = normalizeRelPath(relRaw);
    } catch (err) {
      const code = String(err?.message || 'PATH_INVALID');
      if (code === 'PATH_NOT_RELATIVE' || code === 'PATH_INVALID') return res.status(400).json({ error: code });
      return res.status(400).json({ error: 'PATH_INVALID' });
    }

    if (!includeHidden && isHiddenRelPath(relPath)) return res.status(403).json({ error: 'HIDDEN_PATH_FORBIDDEN' });

    try {
      const limitRaw = req.query?.limit;
      const result = listDir({ rootPath: ws.rootPath, relDirPath: relPath, includeHidden, limit: limitRaw });
      res.json({
        ok: true,
        workspaceId: ws.id,
        rootPath: ws.rootPath,
        path: result.relPath,
        absPath: result.absPath,
        includeHidden,
        readOnly: !includeHidden,
        truncated: result.truncated,
        items: result.items,
      });
    } catch (err) {
      const code = String(err?.message || 'FS_LIST_FAILED');
      if (code === 'FILE_NOT_FOUND') return res.status(404).json({ error: code });
      if (code === 'PATH_NOT_DIR') return res.status(400).json({ error: code });
      if (code === 'PATH_OUTSIDE_WORKSPACE') return res.status(400).json({ error: code });
      res.status(500).json({ error: code });
    }
  });

  app.get('/api/workspaces/:id/fs/text', (req, res) => {
    const ws = store.getWorkspace(req.params.id);
    if (!ws) return res.status(404).json({ error: 'WORKSPACE_NOT_FOUND' });
    const includeHidden = isAdminRequest(req);

    try {
      const relPath = req.query?.path;
      const result = readTextFile({ rootPath: ws.rootPath, relFilePath: relPath, includeHidden, maxChars: 1_200_000 });
      res.json({
        ok: true,
        workspaceId: ws.id,
        rootPath: ws.rootPath,
        path: result.relPath,
        absPath: result.absPath,
        truncated: result.truncated,
        sizeBytes: result.sizeBytes,
        mtimeMs: result.mtimeMs,
        content: result.content,
        readOnly: !includeHidden,
      });
    } catch (err) {
      const code = String(err?.message || 'FS_TEXT_READ_FAILED');
      if (code === 'PATH_REQUIRED') return res.status(400).json({ error: code });
      if (code === 'PATH_NOT_RELATIVE' || code === 'PATH_INVALID') return res.status(400).json({ error: code });
      if (code === 'HIDDEN_PATH_FORBIDDEN') return res.status(403).json({ error: code });
      if (code === 'FILE_NOT_FOUND') return res.status(404).json({ error: code });
      if (code === 'PATH_NOT_FILE') return res.status(400).json({ error: code });
      if (code === 'FILE_NOT_TEXT') return res.status(400).json({ error: code });
      if (code === 'PATH_OUTSIDE_WORKSPACE') return res.status(400).json({ error: code });
      res.status(500).json({ error: code });
    }
  });

  app.put('/api/workspaces/:id/fs/text', requireAdmin({ config }), (req, res) => {
    const ws = store.getWorkspace(req.params.id);
    if (!ws) return res.status(404).json({ error: 'WORKSPACE_NOT_FOUND' });

    const relPath = req.body?.path;
    const content = req.body?.content;
    const baseMtimeMs = req.body?.baseMtimeMs;

    try {
      const result = writeTextFile({
        rootPath: ws.rootPath,
        relFilePath: relPath,
        includeHidden: true,
        content,
        baseMtimeMs,
      });
      res.json({ ok: true, path: result.relPath, absPath: result.absPath, sizeBytes: result.sizeBytes, mtimeMs: result.mtimeMs });
    } catch (err) {
      const code = String(err?.message || 'FS_TEXT_WRITE_FAILED');
      if (code === 'PATH_REQUIRED') return res.status(400).json({ error: code });
      if (code === 'PATH_NOT_RELATIVE' || code === 'PATH_INVALID') return res.status(400).json({ error: code });
      if (code === 'HIDDEN_PATH_FORBIDDEN') return res.status(403).json({ error: code });
      if (code === 'FILE_NOT_FOUND') return res.status(404).json({ error: code });
      if (code === 'PATH_NOT_FILE') return res.status(400).json({ error: code });
      if (code === 'FILE_NOT_TEXT') return res.status(400).json({ error: code });
      if (code === 'FILE_CHANGED') return res.status(409).json({ error: code });
      if (code === 'PATH_OUTSIDE_WORKSPACE') return res.status(400).json({ error: code });
      res.status(500).json({ error: code });
    }
  });

  app.get('/api/workspaces/:id/fs/blob', (req, res) => {
    const ws = store.getWorkspace(req.params.id);
    if (!ws) return res.status(404).json({ error: 'WORKSPACE_NOT_FOUND' });
    const includeHidden = isAdminRequest(req);

    let relPath = '';
    try {
      relPath = normalizeRelPath(req.query?.path);
    } catch (err) {
      const code = String(err?.message || 'PATH_INVALID');
      if (code === 'PATH_NOT_RELATIVE' || code === 'PATH_INVALID') return res.status(400).json({ error: code });
      return res.status(400).json({ error: 'PATH_INVALID' });
    }

    if (!relPath) return res.status(400).json({ error: 'PATH_REQUIRED' });
    if (!includeHidden && isHiddenRelPath(relPath)) return res.status(403).json({ error: 'HIDDEN_PATH_FORBIDDEN' });

    try {
      const absPath = resolveWorkspaceAbsPath({ rootPath: ws.rootPath, relPath });
      if (!fs.existsSync(absPath)) return res.status(404).json({ error: 'FILE_NOT_FOUND' });
      assertInsideWorkspace({ rootPath: ws.rootPath, absPath });
      const stat = fs.statSync(absPath);
      if (!stat.isFile()) return res.status(400).json({ error: 'PATH_NOT_FILE' });

      const ext = path.extname(absPath).toLowerCase();
      const contentType = safeInlineImageContentType(ext);
      const filename = path.basename(absPath);
      if (contentType) {
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `inline; filename=\"${filename}\"`);
      } else {
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename=\"${filename}\"`);
      }

      const stream = fs.createReadStream(absPath);
      stream.on('error', () => res.status(500).end());
      stream.pipe(res);
    } catch (err) {
      const code = String(err?.message || 'FS_BLOB_FAILED');
      if (code === 'PATH_OUTSIDE_WORKSPACE') return res.status(400).json({ error: code });
      if (code === 'FILE_NOT_FOUND') return res.status(404).json({ error: code });
      if (code === 'PATH_NOT_FILE') return res.status(400).json({ error: code });
      res.status(500).json({ error: code });
    }
  });

  app.get('/api/workspaces/:id/repoDigest', async (req, res) => {
    const ws = store.getWorkspace(req.params.id);
    if (!ws) return res.status(404).json({ error: 'WORKSPACE_NOT_FOUND' });
    try {
      const digest = await getRepoDigest(ws.rootPath, {});
      res.json({ rootPath: ws.rootPath, digest });
    } catch (err) {
      res.status(500).json({ error: 'REPO_DIGEST_FAILED' });
    }
  });

  app.post('/api/workspaces', requireAdmin({ config }), (req, res) => {
    const name = String(req.body?.name || '').trim();
    const rootPath = String(req.body?.rootPath || '').trim();
    const planPath = String(req.body?.planPath || '').trim();
    const conventionPath = String(req.body?.conventionPath || '').trim();
    const requirementsPath = String(req.body?.requirementsPath || '').trim();

    if (!name) return res.status(400).json({ error: 'NAME_REQUIRED' });
    if (!rootPath) return res.status(400).json({ error: 'ROOT_PATH_REQUIRED' });

    const absRoot = path.resolve(rootPath);
    if (!isWorkspacePathAllowed(absRoot, getAllowedWorkspaceRoots())) {
      return res.status(400).json({ error: 'ROOT_PATH_NOT_ALLOWED' });
    }
    if (!fs.existsSync(absRoot) || !fs.statSync(absRoot).isDirectory()) {
      return res.status(400).json({ error: 'ROOT_PATH_NOT_DIR' });
    }

    const absPlan = resolveWorkspaceFilePath(absRoot, planPath, 'plan.md');
    const absConvention = resolveWorkspaceFilePath(absRoot, conventionPath, '约定.md');
    const absRequirements = resolveWorkspaceFilePath(absRoot, requirementsPath, '需求.md');
    if (!isInside(absRoot, absPlan)) {
      return res.status(400).json({ error: 'PATH_OUTSIDE_WORKSPACE', field: 'planPath', path: absPlan });
    }
    if (!isInside(absRoot, absConvention)) {
      return res.status(400).json({ error: 'PATH_OUTSIDE_WORKSPACE', field: 'conventionPath', path: absConvention });
    }
    if (!isInside(absRoot, absRequirements)) {
      return res.status(400).json({ error: 'PATH_OUTSIDE_WORKSPACE', field: 'requirementsPath', path: absRequirements });
    }
    const workspace = store.createWorkspace({
      name,
      rootPath: absRoot,
      planPath: absPlan,
      conventionPath: absConvention,
      requirementsPath: absRequirements,
    });
    res.status(201).json(workspace);
  });

  app.patch('/api/workspaces/:id', requireAdmin({ config }), (req, res) => {
    const id = req.params.id;
    const current = store.getWorkspace(id);
    if (!current) return res.status(404).json({ error: 'NOT_FOUND' });
    const patch = {};

    if (req.body?.name !== undefined) patch.name = String(req.body.name).trim();
    if (req.body?.rootPath !== undefined) patch.rootPath = path.resolve(String(req.body.rootPath).trim());
    const rootForResolve = patch.rootPath || current.rootPath;
    if (req.body?.planPath !== undefined) patch.planPath = resolveWorkspaceFilePath(rootForResolve, req.body.planPath, 'plan.md');
    if (req.body?.conventionPath !== undefined) {
      patch.conventionPath = resolveWorkspaceFilePath(rootForResolve, req.body.conventionPath, '约定.md');
    }
    if (req.body?.requirementsPath !== undefined) {
      patch.requirementsPath = resolveWorkspaceFilePath(rootForResolve, req.body.requirementsPath, '需求.md');
    }

    if (patch.rootPath) {
      if (!isWorkspacePathAllowed(patch.rootPath, getAllowedWorkspaceRoots())) {
        return res.status(400).json({ error: 'ROOT_PATH_NOT_ALLOWED' });
      }
      if (!fs.existsSync(patch.rootPath) || !fs.statSync(patch.rootPath).isDirectory()) {
        return res.status(400).json({ error: 'ROOT_PATH_NOT_DIR' });
      }
    }
    const nextRoot = patch.rootPath || current.rootPath;
    const nextPlan = patch.planPath ?? current.planPath;
    const nextConvention = patch.conventionPath ?? current.conventionPath;
    const nextRequirements = patch.requirementsPath ?? current.requirementsPath;
    if (!isInside(nextRoot, nextPlan)) {
      return res.status(400).json({ error: 'PATH_OUTSIDE_WORKSPACE', field: 'planPath', path: nextPlan });
    }
    if (!isInside(nextRoot, nextConvention)) {
      return res.status(400).json({ error: 'PATH_OUTSIDE_WORKSPACE', field: 'conventionPath', path: nextConvention });
    }
    if (!isInside(nextRoot, nextRequirements)) {
      return res.status(400).json({ error: 'PATH_OUTSIDE_WORKSPACE', field: 'requirementsPath', path: nextRequirements });
    }

    const updated = store.updateWorkspace(id, patch);
    res.json(updated);
  });

  app.delete('/api/workspaces/:id', requireAdmin({ config }), (req, res) => {
    const ok = store.deleteWorkspace(req.params.id);
    if (!ok) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ ok: true });
  });

  app.get('/api/workspaces/:id/sessions', (req, res) => {
    const ws = store.getWorkspace(req.params.id);
    if (!ws) return res.status(404).json({ error: 'WORKSPACE_NOT_FOUND' });
    res.json({ items: store.listSessions(req.params.id) });
  });

  app.get('/api/workspaces/:id/ask/threads', requireAdmin({ config }), (req, res) => {
    const ws = store.getWorkspace(req.params.id);
    if (!ws) return res.status(404).json({ error: 'WORKSPACE_NOT_FOUND' });
    const items = store.listAskThreads(ws.id).map((t0) => ({ ...t0, busy: isAskThreadBusy(t0.id) }));
    res.json({ items });
  });

  app.get('/api/workspaces/:id/ask/events', requireAdmin({ config }), (req, res) => {
    const ws = store.getWorkspace(req.params.id);
    if (!ws) return res.status(404).json({ error: 'WORKSPACE_NOT_FOUND' });
    try {
      askSseHub.subscribe({ topic: `ask_ws:${ws.id}`, req, res });
    } catch (err) {
      res.status(400).json({ error: String(err?.message || err) });
    }
  });

  app.post('/api/workspaces/:id/ask/threads', requireAdmin({ config }), (req, res) => {
    const ws = store.getWorkspace(req.params.id);
    if (!ws) return res.status(404).json({ error: 'WORKSPACE_NOT_FOUND' });

    const titleRaw = String(req.body?.title || '').trim();
    const provider = String(req.body?.provider || 'codex').trim().toLowerCase();
    const configObj = req.body?.config ?? {};

    if (!['codex', 'claude', 'fake'].includes(provider)) return res.status(400).json({ error: 'PROVIDER_INVALID' });

    const title = titleRaw || `Ask @ ${nowIso()}`;
    const thread = store.createAskThread({
      workspaceId: ws.id,
      title,
      provider,
      providerSessionId: null,
      configJson: JSON.stringify(configObj ?? {}),
    });
    res.status(201).json({ ...thread, busy: false });
  });

  app.post('/api/sessions', requireAdmin({ config }), (req, res) => {
    const workspaceId = String(req.body?.workspaceId || '').trim();
    const role = String(req.body?.role || '').trim();
    const provider = String(req.body?.provider || '').trim().toLowerCase();
    const providerSessionId = req.body?.providerSessionId ? String(req.body.providerSessionId).trim() : null;
    const configObj = req.body?.config ?? {};

    if (!workspaceId) return res.status(400).json({ error: 'WORKSPACE_ID_REQUIRED' });
    if (!['manager', 'executor'].includes(role)) return res.status(400).json({ error: 'ROLE_INVALID' });
    if (!provider) return res.status(400).json({ error: 'PROVIDER_REQUIRED' });
    if (!['codex', 'claude', 'fake'].includes(provider)) return res.status(400).json({ error: 'PROVIDER_INVALID' });

    const ws = store.getWorkspace(workspaceId);
    if (!ws) return res.status(404).json({ error: 'WORKSPACE_NOT_FOUND' });

    const session = store.createSession({
      workspaceId,
      role,
      provider,
      providerSessionId,
      configJson: JSON.stringify(configObj ?? {}),
    });
    res.status(201).json(session);
  });

  app.patch('/api/sessions/:id', requireAdmin({ config }), (req, res) => {
    const id = String(req.params.id || '').trim();
    const current = store.getSession(id);
    if (!current) return res.status(404).json({ error: 'NOT_FOUND' });

    const patch = {};

    if (req.body?.provider !== undefined) {
      const provider = String(req.body.provider || '').trim().toLowerCase();
      if (!provider) return res.status(400).json({ error: 'PROVIDER_REQUIRED' });
      if (!['codex', 'claude', 'fake'].includes(provider)) return res.status(400).json({ error: 'PROVIDER_INVALID' });
      patch.provider = provider;
    }

    if (req.body?.providerSessionId !== undefined) {
      const v = req.body.providerSessionId;
      patch.providerSessionId = v === null ? null : String(v || '').trim();
    }

    if (req.body?.config !== undefined) {
      if (!req.body.config || typeof req.body.config !== 'object') {
        return res.status(400).json({ error: 'CONFIG_INVALID' });
      }
      patch.configJson = JSON.stringify(req.body.config);
    }

    const updated = store.updateSession(id, patch);
    res.json(updated);
  });

  app.post('/api/sessions/:id/rollover', requireAdmin({ config }), (req, res) => {
    const fromId = String(req.params.id || '').trim();
    const from = store.getSession(fromId);
    if (!from) return res.status(404).json({ error: 'SESSION_NOT_FOUND' });

    const ws = store.getWorkspace(from.workspaceId);
    if (!ws) return res.status(404).json({ error: 'WORKSPACE_NOT_FOUND' });

    const runId = req.body?.runId ? String(req.body.runId).trim() : null;
    const reason = String(req.body?.reason || '').trim();
    const run = runId ? store.getRun(runId) : null;
    if (runId && !run) return res.status(404).json({ error: 'RUN_NOT_FOUND' });
    if (run && run.workspaceId !== ws.id) return res.status(400).json({ error: 'RUN_WORKSPACE_MISMATCH' });

    let cfg = safeJsonParse(from.configJson, {});
    cfg = { ...cfg };
    cfg.rolloverFromSessionId = from.id;
    cfg.rolloverAt = Date.now();

    const turns = run ? store.listTurns(run.id) : [];
    const lastTurn = turns.length ? turns[turns.length - 1] : null;
    const summaryLines = [];
    summaryLines.push(`# Rollover summary (${nowIso()})`);
    summaryLines.push('');
    summaryLines.push(`- workspace: ${ws.name} (${ws.id})`);
    summaryLines.push(`- role: ${from.role}`);
    summaryLines.push(`- provider: ${from.provider}`);
    summaryLines.push(`- fromSessionId: ${from.id}`);
    if (run) {
      summaryLines.push(`- runId: ${run.id}`);
      summaryLines.push(`- runStatus: ${run.status}`);
      summaryLines.push(`- runTurnIndex: ${run.turnIndex}`);
    }
    if (reason) summaryLines.push(`- reason: ${reason}`);
    summaryLines.push('');
    if (lastTurn) {
      summaryLines.push('## Last turn');
      summaryLines.push('');
      summaryLines.push(`- idx: ${lastTurn.idx}`);
      summaryLines.push('');
      summaryLines.push('### Manager output (tail)');
      summaryLines.push('');
      summaryLines.push(truncateText(lastTurn.managerOutput || '', 4000));
      summaryLines.push('');
      summaryLines.push('### Executor output (tail)');
      summaryLines.push('');
      summaryLines.push(truncateText(lastTurn.executorOutput || '', 4000));
      summaryLines.push('');
    }

    const to = store.createSession({
      workspaceId: ws.id,
      role: from.role,
      provider: from.provider,
      providerSessionId: null,
      configJson: JSON.stringify(cfg),
    });

    const rolloverDir = run
      ? path.join(config.runsDir, ws.id, run.id, 'rollover')
      : path.join(config.runsDir, ws.id, 'rollover');
    fs.mkdirSync(rolloverDir, { recursive: true });
    const summaryPath = path.join(
      rolloverDir,
      `rollover-${from.role}-${shortId(from.id)}-to-${shortId(to.id)}.md`
    );
    fs.writeFileSync(summaryPath, summaryLines.join('\n') + '\n', 'utf-8');

    // persist summary path into new session config (so seed prompt can include it)
    const toCfg = safeJsonParse(to.configJson, {});
    toCfg.rolloverSummaryPath = summaryPath;
    const toUpdated = store.updateSession(to.id, { configJson: JSON.stringify(toCfg) });

    const record = store.createSessionRollover({
      workspaceId: ws.id,
      runId: run ? run.id : null,
      role: from.role,
      provider: from.provider,
      fromSessionId: from.id,
      toSessionId: to.id,
      reason,
      summaryPath,
    });

    let updatedRun = null;
    if (run) {
      if (from.role === 'manager' && run.managerSessionId === from.id) {
        updatedRun = store.updateRunSessions(run.id, { managerSessionId: to.id });
      }
      if (from.role === 'executor' && run.executorSessionId === from.id) {
        updatedRun = store.updateRunSessions(run.id, { executorSessionId: to.id });
      }
      if (updatedRun) {
        const seq = store.getMaxEventSeq(run.id) + 1;
        const evt = store.insertEvent({
          runId: run.id,
          seq,
          ts: Date.now(),
          role: null,
          kind: 'meta',
          payload: { type: 'rollover', role: from.role, fromSessionId: from.id, toSessionId: to.id, summaryPath },
        });
        sseHub.broadcast(run.id, evt);
      }
    }

    res.status(201).json({ ok: true, rollover: record, from, to: toUpdated, run: updatedRun });
  });

  app.get('/api/ask/threads/:id', requireAdmin({ config }), (req, res) => {
    const thread = store.getAskThread(req.params.id);
    if (!thread) return res.status(404).json({ error: 'ASK_THREAD_NOT_FOUND' });
    res.json({ ...thread, busy: isAskThreadBusy(thread.id) });
  });

  app.patch('/api/ask/threads/:id', requireAdmin({ config }), (req, res) => {
    const id = req.params.id;
    const current = store.getAskThread(id);
    if (!current) return res.status(404).json({ error: 'ASK_THREAD_NOT_FOUND' });

    const patch = {};
    if (req.body?.title !== undefined) patch.title = String(req.body.title).trim();
    if (req.body?.provider !== undefined) patch.provider = String(req.body.provider).trim().toLowerCase();
    if (req.body?.providerSessionId !== undefined) {
      patch.providerSessionId = req.body.providerSessionId ? String(req.body.providerSessionId).trim() : null;
    }
    if (req.body?.resetProviderSessionId) patch.providerSessionId = null;
    if (req.body?.config !== undefined) patch.configJson = JSON.stringify(req.body.config ?? {});

    if (patch.provider && !['codex', 'claude', 'fake'].includes(patch.provider)) {
      return res.status(400).json({ error: 'PROVIDER_INVALID' });
    }
    if (patch.title !== undefined && !patch.title) return res.status(400).json({ error: 'TITLE_REQUIRED' });

    const updated = store.updateAskThread(id, patch);
    res.json(updated);
  });

  app.delete('/api/ask/threads/:id', requireAdmin({ config }), (req, res) => {
    const ok = store.deleteAskThread(req.params.id);
    if (!ok) return res.status(404).json({ error: 'ASK_THREAD_NOT_FOUND' });
    res.json({ ok: true });
  });

  app.get('/api/ask/threads/:id/messages', requireAdmin({ config }), (req, res) => {
    const thread = store.getAskThread(req.params.id);
    if (!thread) return res.status(404).json({ error: 'ASK_THREAD_NOT_FOUND' });
    const limitRaw = req.query?.limit;
    const limit = Number.isFinite(Number(limitRaw)) ? Number(limitRaw) : 500;
    const tailRaw = String(req.query?.tail || '').trim().toLowerCase();
    const tail = tailRaw === '1' || tailRaw === 'true' || tailRaw === 'yes';
    res.json({ items: tail ? store.listAskMessagesTail(thread.id, limit) : store.listAskMessages(thread.id, limit) });
  });

  app.get('/api/ask/threads/:id/queue', requireAdmin({ config }), (req, res) => {
    const thread = store.getAskThread(req.params.id);
    if (!thread) return res.status(404).json({ error: 'ASK_THREAD_NOT_FOUND' });
    const limitRaw = req.query?.limit;
    const limit = Number.isFinite(Number(limitRaw)) ? Number(limitRaw) : 200;
    res.json({ items: store.listAskQueueItems(thread.id, limit) });
  });

  app.patch('/api/ask/queue/:id', requireAdmin({ config }), (req, res) => {
    const item = store.getAskQueueItem(req.params.id);
    if (!item) return res.status(404).json({ error: 'ASK_QUEUE_ITEM_NOT_FOUND' });
    if (item.status !== 'queued') return res.status(409).json({ error: 'ASK_QUEUE_ITEM_NOT_EDITABLE' });
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ error: 'TEXT_REQUIRED' });
    const updated = store.updateAskQueueItem(item.id, { text, error: null });
    res.json(updated);
  });

  app.delete('/api/ask/queue/:id', requireAdmin({ config }), (req, res) => {
    const item = store.getAskQueueItem(req.params.id);
    if (!item) return res.status(404).json({ error: 'ASK_QUEUE_ITEM_NOT_FOUND' });
    if (item.status === 'running') return res.status(409).json({ error: 'ASK_QUEUE_ITEM_RUNNING' });
    const ok = store.deleteAskQueueItem(item.id);
    res.json({ ok });
  });

  app.post('/api/ask/threads/:id/send', requireAdmin({ config }), async (req, res) => {
    const threadId = req.params.id;
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ error: 'TEXT_REQUIRED' });
    try {
      const result = await queueAskSend({ store, config, notifier, eventsHub: askSseHub, threadId, userText: text });
      res.status(202).json({
        ok: true,
        queued: true,
        thread: { ...result.thread, busy: isAskThreadBusy(result.thread.id) },
        queueItem: result.queueItem,
      });
    } catch (err) {
      const code = String(err?.message || 'ASK_SEND_FAILED');
      if (code === 'ASK_THREAD_NOT_FOUND') return res.status(404).json({ ok: false, error: code });
      if (code === 'WORKSPACE_NOT_FOUND') return res.status(404).json({ ok: false, error: code });
      if (code === 'TEXT_REQUIRED') return res.status(400).json({ ok: false, error: code });
      res.status(500).json({ ok: false, error: code });
    }
  });

  app.post('/api/ask/threads/:id/stop', requireAdmin({ config }), (req, res) => {
    const threadId = req.params.id;
    const thread = store.getAskThread(threadId);
    if (!thread) return res.status(404).json({ ok: false, error: 'ASK_THREAD_NOT_FOUND' });
    const stopped = stopAskThread(thread.id);
    res.json({ ok: true, stopped, busy: isAskThreadBusy(thread.id) });
  });

  app.get('/api/ask/threads/:id/export', requireAdmin({ config }), (req, res) => {
    const format = String(req.query?.format || 'md').toLowerCase();
    try {
      if (format === 'md') {
        const result = exportAskThreadToMarkdown({ store, threadId: req.params.id });
        res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename=\"${result.filename}\"`);
        res.send(result.content);
        return;
      }
      if (format === 'jsonl') {
        const result = exportAskThreadToJsonl({ store, threadId: req.params.id });
        res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename=\"${result.filename}\"`);
        res.send(result.content);
        return;
      }
      res.status(400).json({ error: 'FORMAT_INVALID' });
    } catch (err) {
      res.status(500).json({ error: err.message || 'EXPORT_FAILED' });
    }
  });

  app.get('/api/workspaces/:id/rollovers', (req, res) => {
    const ws = store.getWorkspace(req.params.id);
    if (!ws) return res.status(404).json({ error: 'WORKSPACE_NOT_FOUND' });
    res.json({ items: store.listSessionRollovers(ws.id) });
  });

  app.get('/api/workspaces/:id/runs', (req, res) => {
    const ws = store.getWorkspace(req.params.id);
    if (!ws) return res.status(404).json({ error: 'WORKSPACE_NOT_FOUND' });
    const limitRaw = req.query?.limit;
    const limit0 = Number(limitRaw);
    const limit = Number.isFinite(limit0) && limit0 > 0 ? limit0 : null;
    res.json({ items: store.listRuns(req.params.id, limit) });
  });

  app.post('/api/runs', requireAdmin({ config }), (req, res) => {
    const workspaceId = String(req.body?.workspaceId || '').trim();
    const managerSessionId = String(req.body?.managerSessionId || '').trim();
    const executorSessionId = String(req.body?.executorSessionId || '').trim();
    const options = req.body?.options ?? {};

    if (!workspaceId) return res.status(400).json({ error: 'WORKSPACE_ID_REQUIRED' });
    if (!managerSessionId) return res.status(400).json({ error: 'MANAGER_SESSION_ID_REQUIRED' });
    if (!executorSessionId) return res.status(400).json({ error: 'EXECUTOR_SESSION_ID_REQUIRED' });

    const ws = store.getWorkspace(workspaceId);
    if (!ws) return res.status(404).json({ error: 'WORKSPACE_NOT_FOUND' });
    const managerSession = store.getSession(managerSessionId);
    const executorSession = store.getSession(executorSessionId);
    if (!managerSession || managerSession.workspaceId !== workspaceId) {
      return res.status(400).json({ error: 'MANAGER_SESSION_INVALID' });
    }
    if (!executorSession || executorSession.workspaceId !== workspaceId) {
      return res.status(400).json({ error: 'EXECUTOR_SESSION_INVALID' });
    }

    const run = store.createRun({
      workspaceId,
      managerSessionId,
      executorSessionId,
      status: 'IDLE',
      optionsJson: JSON.stringify(options ?? {}),
    });
    res.status(201).json(run);
  });

  app.get('/api/runs/:id', (req, res) => {
    const run = store.getRun(req.params.id);
    if (!run) return res.status(404).json({ error: 'NOT_FOUND' });
    const turns = store.listTurns(run.id).map((t) => ({
      ...t,
      managerMeta: safeJsonParse(t.managerMetaJson, {}),
      executorMeta: safeJsonParse(t.executorMetaJson, {}),
      managerPromptPreview: readTextPreview(t.managerPromptPath, 6000),
      executorPromptPreview: readTextPreview(t.executorPromptPath, 6000),
    }));
    res.json({
      ...run,
      options: safeJsonParse(run.optionsJson, {}),
      turns,
      artifacts: store.listArtifacts(run.id),
    });
  });

  app.get('/api/runs/:id/events', (req, res) => {
    const run = store.getRun(req.params.id);
    if (!run) return res.status(404).json({ error: 'NOT_FOUND' });
    const lastEventId = req.header('last-event-id') || req.query?.lastEventId || 0;
    sseHub.subscribe({ runId: run.id, req, res, lastEventId });
  });

  app.post('/api/runs/:id/start', requireAdmin({ config }), async (req, res) => {
    const run = store.getRun(req.params.id);
    if (!run) return res.status(404).json({ error: 'NOT_FOUND' });
    try {
      await orchestrator.start({ runId: run.id, mode: 'auto' });
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message || 'START_FAILED' });
    }
  });

  app.post('/api/runs/:id/step', requireAdmin({ config }), async (req, res) => {
    const run = store.getRun(req.params.id);
    if (!run) return res.status(404).json({ error: 'NOT_FOUND' });
    try {
      await orchestrator.start({ runId: run.id, mode: 'step' });
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message || 'STEP_FAILED' });
    }
  });

  app.post('/api/runs/:id/pause', requireAdmin({ config }), async (req, res) => {
    const run = store.getRun(req.params.id);
    if (!run) return res.status(404).json({ error: 'NOT_FOUND' });
    await orchestrator.pause({ runId: run.id, reason: String(req.body?.reason || '').trim() || 'paused' });
    res.json({ ok: true });
  });

  app.post('/api/runs/:id/stop', requireAdmin({ config }), async (req, res) => {
    const run = store.getRun(req.params.id);
    if (!run) return res.status(404).json({ error: 'NOT_FOUND' });
    await orchestrator.stop({ runId: run.id, reason: String(req.body?.reason || '').trim() || 'stopped' });
    res.json({ ok: true });
  });

  app.post('/api/runs/:id/inject', requireAdmin({ config }), async (req, res) => {
    const run = store.getRun(req.params.id);
    if (!run) return res.status(404).json({ error: 'NOT_FOUND' });
    const target = String(req.body?.target || '').trim();
    const message = String(req.body?.message || '').trim();
    if (!['manager', 'executor'].includes(target)) return res.status(400).json({ error: 'TARGET_INVALID' });
    if (!message) return res.status(400).json({ error: 'MESSAGE_REQUIRED' });
    await orchestrator.inject({ runId: run.id, target, message });
    res.json({ ok: true });
  });

  app.get('/api/runs/:id/export', requireAdmin({ config }), async (req, res) => {
    const run = store.getRun(req.params.id);
    if (!run) return res.status(404).json({ error: 'NOT_FOUND' });
    const format = String(req.query?.format || 'md').toLowerCase();
    try {
      if (format === 'md') {
        const result = await exportRunToMarkdown({ store, config, runId: run.id });
        res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
        res.send(result.content);
        return;
      }
      if (format === 'json') {
        const result = await exportRunToJson({ store, config, runId: run.id });
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
        res.send(result.content);
        return;
      }
      if (format === 'jsonl') {
        const result = await exportRunToJsonl({ store, config, runId: run.id });
        res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
        res.send(result.content);
        return;
      }
      res.status(400).json({ error: 'FORMAT_INVALID' });
    } catch (err) {
      res.status(500).json({ error: err.message || 'EXPORT_FAILED' });
    }
  });

  const webRoot = path.join(process.cwd(), 'web');
  app.use('/', express.static(webRoot));

  app.get('*', (req, res) => {
    const indexPath = path.join(webRoot, 'index.html');
    if (!fs.existsSync(indexPath)) return res.status(404).send('Not Found');
    res.sendFile(indexPath);
  });

  return { app, store, sseHub, orchestrator };
}

if (require.main === module) {
  const { app } = createServer();
  app.listen(config.port, config.host, () => {
    const addr = `http://${config.host}:${config.port}`;
    console.log(`[auto_codex] listening on ${addr}`);
    if (config.host === '0.0.0.0' || config.host === '::') {
      console.log(`[auto_codex] local: http://127.0.0.1:${config.port}`);
    }
    console.log(`[auto_codex] allowed roots: ${config.allowedWorkspaceRoots.join(', ')}`);
    console.log(`[auto_codex] ADMIN_TOKEN (${config.adminTokenSource}): ${config.adminToken}`);
  });
}

module.exports = { createServer };
