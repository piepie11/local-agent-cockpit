const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const { schemaSql } = require('./schema');

function nowMs() {
  return Date.now();
}

class Store {
  constructor(dbPath) {
    const dir = path.dirname(dbPath);
    fs.mkdirSync(dir, { recursive: true });

    this.dbPath = dbPath;
    this.db = new DatabaseSync(dbPath);
    this.db.exec(schemaSql);
    this._migrate();
  }

  close() {
    this.db.close();
  }

  _migrate() {
    const cols = this.db.prepare(`PRAGMA table_info(workspaces)`).all().map((r) => r.name);
    if (!cols.includes('conventionPath')) {
      this.db.exec(`ALTER TABLE workspaces ADD COLUMN conventionPath TEXT NOT NULL DEFAULT ''`);
      const rows = this.db.prepare(`SELECT id, rootPath FROM workspaces`).all();
      for (const row of rows) {
        const p = path.join(row.rootPath, '约定.md');
        this.db.prepare(`UPDATE workspaces SET conventionPath = ? WHERE id = ?`).run(p, row.id);
      }
    }
    if (!cols.includes('requirementsPath')) {
      this.db.exec(`ALTER TABLE workspaces ADD COLUMN requirementsPath TEXT NOT NULL DEFAULT ''`);
    }
    const reqRows = this.db.prepare(`SELECT id, rootPath, requirementsPath FROM workspaces`).all();
    for (const row of reqRows) {
      const current = String(row.requirementsPath ?? '').trim();
      if (current) continue;
      const p = path.join(row.rootPath, '需求.md');
      this.db.prepare(`UPDATE workspaces SET requirementsPath = ? WHERE id = ?`).run(p, row.id);
    }

  }

  listWorkspaces() {
    return this.db
      .prepare(
        `SELECT id, name, rootPath, planPath, conventionPath, requirementsPath, createdAt, updatedAt
         FROM workspaces
         ORDER BY updatedAt DESC`
      )
      .all();
  }

  getWorkspace(id) {
    return this.db
      .prepare(
        `SELECT id, name, rootPath, planPath, conventionPath, requirementsPath, createdAt, updatedAt
         FROM workspaces
         WHERE id = ?`
      )
      .get(id);
  }

  createWorkspace({ id = randomUUID(), name, rootPath, planPath, conventionPath = '', requirementsPath = '' }) {
    const ts = nowMs();
    this.db
      .prepare(
        `INSERT INTO workspaces (id, name, rootPath, planPath, conventionPath, requirementsPath, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, name, rootPath, planPath, conventionPath, requirementsPath, ts, ts);
    return this.getWorkspace(id);
  }

  updateWorkspace(id, patch) {
    const current = this.getWorkspace(id);
    if (!current) return null;
    const next = {
      name: patch.name ?? current.name,
      rootPath: patch.rootPath ?? current.rootPath,
      planPath: patch.planPath ?? current.planPath,
      conventionPath: patch.conventionPath ?? current.conventionPath,
      requirementsPath: patch.requirementsPath ?? current.requirementsPath,
    };
    const ts = nowMs();
    this.db
      .prepare(
        `UPDATE workspaces
         SET name = ?, rootPath = ?, planPath = ?, conventionPath = ?, requirementsPath = ?, updatedAt = ?
         WHERE id = ?`
      )
      .run(next.name, next.rootPath, next.planPath, next.conventionPath, next.requirementsPath, ts, id);
    return this.getWorkspace(id);
  }

  deleteWorkspace(id) {
    const info = this.db.prepare(`DELETE FROM workspaces WHERE id = ?`).run(id);
    return info.changes > 0;
  }

  listSessions(workspaceId) {
    return this.db
      .prepare(
        `SELECT id, workspaceId, role, provider, providerSessionId, configJson, createdAt, lastActiveAt
         FROM sessions
         WHERE workspaceId = ?
         ORDER BY createdAt DESC`
      )
      .all(workspaceId);
  }

  getSession(id) {
    return this.db
      .prepare(
        `SELECT id, workspaceId, role, provider, providerSessionId, configJson, createdAt, lastActiveAt
         FROM sessions
         WHERE id = ?`
      )
      .get(id);
  }

  createSession({
    id = randomUUID(),
    workspaceId,
    role,
    provider,
    providerSessionId = null,
    configJson = '{}',
  }) {
    const ts = nowMs();
    this.db
      .prepare(
        `INSERT INTO sessions (id, workspaceId, role, provider, providerSessionId, configJson, createdAt, lastActiveAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, workspaceId, role, provider, providerSessionId, configJson, ts, ts);
    return this.getSession(id);
  }

  touchSession(id) {
    const ts = nowMs();
    this.db.prepare(`UPDATE sessions SET lastActiveAt = ? WHERE id = ?`).run(ts, id);
  }

  updateSessionProviderSessionId(id, providerSessionId) {
    const ts = nowMs();
    this.db
      .prepare(`UPDATE sessions SET providerSessionId = ?, lastActiveAt = ? WHERE id = ?`)
      .run(providerSessionId, ts, id);
    return this.getSession(id);
  }

  updateSession(id, patch) {
    const current = this.getSession(id);
    if (!current) return null;

    const next = {
      provider: patch.provider ?? current.provider,
      providerSessionId:
        patch.providerSessionId !== undefined ? patch.providerSessionId : current.providerSessionId,
      configJson: patch.configJson ?? current.configJson,
    };

    const ts = nowMs();
    this.db
      .prepare(
        `UPDATE sessions
         SET provider = ?, providerSessionId = ?, configJson = ?, lastActiveAt = ?
         WHERE id = ?`
      )
      .run(next.provider, next.providerSessionId, next.configJson, ts, id);

    return this.getSession(id);
  }

  getSetting(key) {
    return this.db
      .prepare(
        `SELECT key, valueJson, updatedAt
         FROM settings
         WHERE key = ?`
      )
      .get(String(key));
  }

  setSetting(key, valueJson) {
    const ts = nowMs();
    const k = String(key);
    const v = String(valueJson);
    this.db
      .prepare(
        `INSERT INTO settings (key, valueJson, updatedAt)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET valueJson = excluded.valueJson, updatedAt = excluded.updatedAt`
      )
      .run(k, v, ts);
    return this.getSetting(k);
  }

  deleteSetting(key) {
    const info = this.db.prepare(`DELETE FROM settings WHERE key = ?`).run(String(key));
    return info.changes > 0;
  }

  listRuns(workspaceId, limit) {
    const n0 = Number(limit);
    const n = Number.isFinite(n0) && n0 > 0 ? n0 : null;
    if (n !== null) {
      return this.db
        .prepare(
          `SELECT id, workspaceId, managerSessionId, executorSessionId, status, turnIndex,
                  createdAt, startedAt, endedAt, optionsJson, error
           FROM runs
           WHERE workspaceId = ?
           ORDER BY createdAt DESC
           LIMIT ?`
        )
        .all(workspaceId, n);
    }

    return this.db
      .prepare(
        `SELECT id, workspaceId, managerSessionId, executorSessionId, status, turnIndex,
                createdAt, startedAt, endedAt, optionsJson, error
         FROM runs
         WHERE workspaceId = ?
         ORDER BY createdAt DESC`
      )
      .all(workspaceId);
  }

  getRun(id) {
    return this.db
      .prepare(
        `SELECT id, workspaceId, managerSessionId, executorSessionId, status, turnIndex,
                createdAt, startedAt, endedAt, optionsJson, error
         FROM runs
         WHERE id = ?`
      )
      .get(id);
  }

  createRun({
    id = randomUUID(),
    workspaceId,
    managerSessionId,
    executorSessionId,
    status = 'IDLE',
    optionsJson = '{}',
  }) {
    const ts = nowMs();
    this.db
      .prepare(
        `INSERT INTO runs (id, workspaceId, managerSessionId, executorSessionId, status, turnIndex, createdAt, optionsJson)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
      )
      .run(id, workspaceId, managerSessionId, executorSessionId, status, ts, optionsJson);
    return this.getRun(id);
  }

  updateRunStatus(id, status, patch = {}) {
    const current = this.getRun(id);
    if (!current) return null;
    const next = {
      startedAt: patch.startedAt ?? current.startedAt,
      endedAt: patch.endedAt ?? current.endedAt,
      turnIndex: patch.turnIndex ?? current.turnIndex,
      error: patch.error ?? current.error,
    };
    this.db
      .prepare(
        `UPDATE runs
         SET status = ?, startedAt = ?, endedAt = ?, turnIndex = ?, error = ?
         WHERE id = ?`
      )
      .run(status, next.startedAt, next.endedAt, next.turnIndex, next.error, id);
    return this.getRun(id);
  }

  updateRunSessions(id, patch) {
    const current = this.getRun(id);
    if (!current) return null;
    const next = {
      managerSessionId: patch.managerSessionId ?? current.managerSessionId,
      executorSessionId: patch.executorSessionId ?? current.executorSessionId,
    };
    this.db
      .prepare(
        `UPDATE runs
         SET managerSessionId = ?, executorSessionId = ?
         WHERE id = ?`
      )
      .run(next.managerSessionId, next.executorSessionId, id);
    return this.getRun(id);
  }

  listTurns(runId) {
    return this.db
      .prepare(
        `SELECT id, runId, idx, startedAt, endedAt,
                managerPromptPath, managerOutput, managerMetaJson,
                executorPromptPath, executorOutput, executorMetaJson,
                outcomeJson
         FROM turns
         WHERE runId = ?
         ORDER BY idx ASC`
      )
      .all(runId);
  }

  listSessionRollovers(workspaceId) {
    return this.db
      .prepare(
        `SELECT id, workspaceId, runId, role, provider, fromSessionId, toSessionId, reason, summaryPath, createdAt
         FROM session_rollovers
         WHERE workspaceId = ?
         ORDER BY createdAt DESC`
      )
      .all(workspaceId);
  }

  createSessionRollover({
    id = randomUUID(),
    workspaceId,
    runId = null,
    role,
    provider,
    fromSessionId,
    toSessionId,
    reason = '',
    summaryPath = null,
  }) {
    const ts = nowMs();
    this.db
      .prepare(
        `INSERT INTO session_rollovers (id, workspaceId, runId, role, provider, fromSessionId, toSessionId, reason, summaryPath, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, workspaceId, runId, role, provider, fromSessionId, toSessionId, reason, summaryPath, ts);
    return this.db
      .prepare(
        `SELECT id, workspaceId, runId, role, provider, fromSessionId, toSessionId, reason, summaryPath, createdAt
         FROM session_rollovers
         WHERE id = ?`
      )
      .get(id);
  }

  getTurnByIdx(runId, idx) {
    return this.db
      .prepare(
        `SELECT id, runId, idx, startedAt, endedAt,
                managerPromptPath, managerOutput, managerMetaJson,
                executorPromptPath, executorOutput, executorMetaJson,
                outcomeJson
         FROM turns
         WHERE runId = ? AND idx = ?`
      )
      .get(runId, idx);
  }

  getLatestTurn(runId) {
    return this.db
      .prepare(
        `SELECT id, runId, idx, startedAt, endedAt,
                managerPromptPath, managerOutput, managerMetaJson,
                executorPromptPath, executorOutput, executorMetaJson,
                outcomeJson
         FROM turns
         WHERE runId = ?
         ORDER BY idx DESC
         LIMIT 1`
      )
      .get(runId);
  }

  getTurn(id) {
    return this.db
      .prepare(
        `SELECT id, runId, idx, startedAt, endedAt,
                managerPromptPath, managerOutput, managerMetaJson,
                executorPromptPath, executorOutput, executorMetaJson,
                outcomeJson
         FROM turns
         WHERE id = ?`
      )
      .get(id);
  }

  createTurn({ id = randomUUID(), runId, idx, startedAt = nowMs() }) {
    this.db
      .prepare(
        `INSERT INTO turns (id, runId, idx, startedAt)
         VALUES (?, ?, ?, ?)`
      )
      .run(id, runId, idx, startedAt);
    return this.getTurn(id);
  }

  updateTurn(id, patch) {
    const current = this.getTurn(id);
    if (!current) return null;

    const next = {
      endedAt: patch.endedAt ?? current.endedAt,
      managerPromptPath: patch.managerPromptPath ?? current.managerPromptPath,
      managerOutput: patch.managerOutput ?? current.managerOutput,
      managerMetaJson: patch.managerMetaJson ?? current.managerMetaJson,
      executorPromptPath: patch.executorPromptPath ?? current.executorPromptPath,
      executorOutput: patch.executorOutput ?? current.executorOutput,
      executorMetaJson: patch.executorMetaJson ?? current.executorMetaJson,
      outcomeJson: patch.outcomeJson ?? current.outcomeJson,
    };

    this.db
      .prepare(
        `UPDATE turns
         SET endedAt = ?,
             managerPromptPath = ?, managerOutput = ?, managerMetaJson = ?,
             executorPromptPath = ?, executorOutput = ?, executorMetaJson = ?,
             outcomeJson = ?
         WHERE id = ?`
      )
      .run(
        next.endedAt,
        next.managerPromptPath,
        next.managerOutput,
        next.managerMetaJson,
        next.executorPromptPath,
        next.executorOutput,
        next.executorMetaJson,
        next.outcomeJson,
        id
      );

    return this.getTurn(id);
  }

  getMaxEventSeq(runId) {
    const row = this.db
      .prepare(`SELECT COALESCE(MAX(seq), 0) AS maxSeq FROM events WHERE runId = ?`)
      .get(runId);
    return row?.maxSeq ?? 0;
  }

  insertEvent({ runId, turnId = null, seq, ts = nowMs(), role = null, kind, payload }) {
    const payloadJson = JSON.stringify(payload ?? null);
    this.db
      .prepare(
        `INSERT INTO events (runId, turnId, seq, ts, role, kind, payloadJson)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(runId, turnId, seq, ts, role, kind, payloadJson);
    return { runId, turnId, seq, ts, role, kind, payload };
  }

  listEventsAfter(runId, afterSeq) {
    const rows = this.db
      .prepare(
        `SELECT runId, turnId, seq, ts, role, kind, payloadJson
         FROM events
         WHERE runId = ? AND seq > ?
         ORDER BY seq ASC
         LIMIT 2000`
      )
      .all(runId, afterSeq);
    return rows.map((r) => ({
      runId: r.runId,
      turnId: r.turnId,
      seq: r.seq,
      ts: r.ts,
      role: r.role,
      kind: r.kind,
      payload: JSON.parse(r.payloadJson),
    }));
  }

  createArtifact({ id = randomUUID(), runId, type, path: artifactPath, meta = {} }) {
    const ts = nowMs();
    this.db
      .prepare(
        `INSERT INTO artifacts (id, runId, type, path, metaJson, createdAt)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, runId, type, artifactPath, JSON.stringify(meta ?? {}), ts);
    return { id, runId, type, path: artifactPath, meta, createdAt: ts };
  }

  listArtifacts(runId) {
    return this.db
      .prepare(
        `SELECT id, runId, type, path, metaJson, createdAt
         FROM artifacts
         WHERE runId = ?
         ORDER BY createdAt ASC`
      )
      .all(runId)
      .map((r) => ({
        id: r.id,
        runId: r.runId,
        type: r.type,
        path: r.path,
        meta: JSON.parse(r.metaJson),
        createdAt: r.createdAt,
      }));
  }

  listAskThreads(workspaceId) {
    return this.db
      .prepare(
        `SELECT id, workspaceId, title, provider, providerSessionId, configJson, createdAt, updatedAt, lastActiveAt
         FROM ask_threads
         WHERE workspaceId = ?
         ORDER BY updatedAt DESC`
      )
      .all(workspaceId);
  }

  getAskThread(id) {
    return this.db
      .prepare(
        `SELECT id, workspaceId, title, provider, providerSessionId, configJson, createdAt, updatedAt, lastActiveAt
         FROM ask_threads
         WHERE id = ?`
      )
      .get(id);
  }

  createAskThread({
    id = randomUUID(),
    workspaceId,
    title,
    provider = 'codex',
    providerSessionId = null,
    configJson = '{}',
  }) {
    const ts = nowMs();
    this.db
      .prepare(
        `INSERT INTO ask_threads (id, workspaceId, title, provider, providerSessionId, configJson, createdAt, updatedAt, lastActiveAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, workspaceId, title, provider, providerSessionId, configJson, ts, ts, ts);
    return this.getAskThread(id);
  }

  updateAskThread(id, patch) {
    const current = this.getAskThread(id);
    if (!current) return null;
    const next = {
      title: patch.title ?? current.title,
      provider: patch.provider ?? current.provider,
      providerSessionId: patch.providerSessionId ?? current.providerSessionId,
      configJson: patch.configJson ?? current.configJson,
      lastActiveAt: patch.lastActiveAt ?? current.lastActiveAt,
    };
    const ts = nowMs();
    this.db
      .prepare(
        `UPDATE ask_threads
         SET title = ?, provider = ?, providerSessionId = ?, configJson = ?, updatedAt = ?, lastActiveAt = ?
         WHERE id = ?`
      )
      .run(next.title, next.provider, next.providerSessionId, next.configJson, ts, next.lastActiveAt, id);
    return this.getAskThread(id);
  }

  deleteAskThread(id) {
    const info = this.db.prepare(`DELETE FROM ask_threads WHERE id = ?`).run(id);
    return info.changes > 0;
  }

  listAskMessages(threadId, limit = 500) {
    const n = Number.isFinite(Number(limit)) ? Number(limit) : 500;
    return this.db
      .prepare(
        `SELECT id, threadId, role, text, metaJson, createdAt
         FROM ask_messages
         WHERE threadId = ?
         ORDER BY createdAt ASC
         LIMIT ?`
      )
      .all(threadId, n)
      .map((r) => ({
        id: r.id,
        threadId: r.threadId,
        role: r.role,
        text: r.text,
        meta: JSON.parse(r.metaJson),
        createdAt: r.createdAt,
      }));
  }

  // List the most recent N messages, returned in chronological (ASC) order.
  listAskMessagesTail(threadId, limit = 500) {
    const n = Number.isFinite(Number(limit)) ? Number(limit) : 500;
    const items = this.db
      .prepare(
        `SELECT id, threadId, role, text, metaJson, createdAt
         FROM ask_messages
         WHERE threadId = ?
         ORDER BY createdAt DESC
         LIMIT ?`
      )
      .all(threadId, n)
      .map((r) => ({
        id: r.id,
        threadId: r.threadId,
        role: r.role,
        text: r.text,
        meta: JSON.parse(r.metaJson),
        createdAt: r.createdAt,
      }));
    items.reverse();
    return items;
  }

  getAskLastAssistantMessage(threadId) {
    const row = this.db
      .prepare(
        `SELECT id, threadId, role, text, metaJson, createdAt
         FROM ask_messages
         WHERE threadId = ? AND role = 'assistant'
         ORDER BY createdAt DESC
         LIMIT 1`
      )
      .get(String(threadId || ''));
    if (!row) return null;
    return {
      id: row.id,
      threadId: row.threadId,
      role: row.role,
      text: row.text,
      meta: JSON.parse(row.metaJson),
      createdAt: row.createdAt,
    };
  }

  createAskMessage({ id = randomUUID(), threadId, role, text, metaJson = '{}', createdAt = nowMs() }) {
    this.db
      .prepare(
        `INSERT INTO ask_messages (id, threadId, role, text, metaJson, createdAt)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, threadId, role, String(text ?? ''), String(metaJson ?? '{}'), createdAt);
    return {
      id,
      threadId,
      role,
      text: String(text ?? ''),
      meta: JSON.parse(String(metaJson ?? '{}')),
      createdAt,
    };
  }

  getAskQueueCounts(threadId) {
    const rows = this.db
      .prepare(
        `SELECT status, COUNT(*) AS n
         FROM ask_queue_items
         WHERE threadId = ?
         GROUP BY status`
      )
      .all(String(threadId || ''));
    const out = { queued: 0, running: 0, error: 0 };
    for (const r of rows) {
      const status = String(r?.status || '');
      if (status === 'queued' || status === 'running' || status === 'error') out[status] = Number(r?.n || 0);
    }
    return out;
  }

  getAskLastQueueError(threadId) {
    const row = this.db
      .prepare(
        `SELECT id, threadId, status, text, error, metaJson, createdAt, updatedAt, startedAt, endedAt
         FROM ask_queue_items
         WHERE threadId = ? AND status = 'error'
         ORDER BY updatedAt DESC
         LIMIT 1`
      )
      .get(String(threadId || ''));
    if (!row) return null;
    return {
      id: row.id,
      threadId: row.threadId,
      status: row.status,
      text: row.text,
      error: row.error ?? null,
      meta: JSON.parse(row.metaJson),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      startedAt: row.startedAt ?? null,
      endedAt: row.endedAt ?? null,
    };
  }

  listAskQueueItems(threadId, limit = 200) {
    const n = Number.isFinite(Number(limit)) ? Number(limit) : 200;
    return this.db
      .prepare(
        `SELECT id, threadId, status, text, error, metaJson, createdAt, updatedAt, startedAt, endedAt
         FROM ask_queue_items
         WHERE threadId = ?
         ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'queued' THEN 1 ELSE 2 END, createdAt ASC
         LIMIT ?`
      )
      .all(String(threadId || ''), n)
      .map((r) => ({
        id: r.id,
        threadId: r.threadId,
        status: r.status,
        text: r.text,
        error: r.error ?? null,
        meta: JSON.parse(r.metaJson),
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        startedAt: r.startedAt ?? null,
        endedAt: r.endedAt ?? null,
      }));
  }

  getAskQueueItem(id) {
    const row = this.db
      .prepare(
        `SELECT id, threadId, status, text, error, metaJson, createdAt, updatedAt, startedAt, endedAt
         FROM ask_queue_items
         WHERE id = ?`
      )
      .get(String(id || ''));
    if (!row) return null;
    return {
      id: row.id,
      threadId: row.threadId,
      status: row.status,
      text: row.text,
      error: row.error ?? null,
      meta: JSON.parse(row.metaJson),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      startedAt: row.startedAt ?? null,
      endedAt: row.endedAt ?? null,
    };
  }

  createAskQueueItem({
    id = randomUUID(),
    threadId,
    status = 'queued',
    text,
    error = null,
    metaJson = '{}',
    createdAt = nowMs(),
  }) {
    const ts = nowMs();
    this.db
      .prepare(
        `INSERT INTO ask_queue_items (id, threadId, status, text, error, metaJson, createdAt, updatedAt, startedAt, endedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        String(threadId || ''),
        String(status || 'queued'),
        String(text ?? ''),
        error !== null ? String(error) : null,
        String(metaJson ?? '{}'),
        createdAt,
        ts,
        null,
        null
      );
    return this.getAskQueueItem(id);
  }

  updateAskQueueItem(id, patch) {
    const current = this.getAskQueueItem(id);
    if (!current) return null;
    const next = {
      status: patch.status ?? current.status,
      text: patch.text ?? current.text,
      error: patch.error !== undefined ? patch.error : current.error,
      metaJson: patch.metaJson ?? JSON.stringify(current.meta ?? {}),
      startedAt: patch.startedAt !== undefined ? patch.startedAt : current.startedAt,
      endedAt: patch.endedAt !== undefined ? patch.endedAt : current.endedAt,
    };
    const ts = nowMs();
    this.db
      .prepare(
        `UPDATE ask_queue_items
         SET status = ?, text = ?, error = ?, metaJson = ?, updatedAt = ?, startedAt = ?, endedAt = ?
         WHERE id = ?`
      )
      .run(
        String(next.status || 'queued'),
        String(next.text ?? ''),
        next.error !== null ? String(next.error) : null,
        String(next.metaJson ?? '{}'),
        ts,
        next.startedAt ?? null,
        next.endedAt ?? null,
        String(id || '')
      );
    return this.getAskQueueItem(id);
  }

  deleteAskQueueItem(id) {
    const info = this.db.prepare(`DELETE FROM ask_queue_items WHERE id = ?`).run(String(id || ''));
    return info.changes > 0;
  }

  claimNextAskQueueItem(threadId) {
    const threadKey = String(threadId || '');
    if (!threadKey) return null;

    this.db.exec('BEGIN IMMEDIATE');
    try {
      const next = this.db
        .prepare(
          `SELECT id
           FROM ask_queue_items
           WHERE threadId = ? AND status = 'queued'
           ORDER BY createdAt ASC
           LIMIT 1`
        )
        .get(threadKey);
      if (!next?.id) {
        this.db.exec('COMMIT');
        return null;
      }
      const ts = nowMs();
      const updated = this.db
        .prepare(
          `UPDATE ask_queue_items
           SET status = 'running', startedAt = ?, updatedAt = ?
           WHERE id = ? AND status = 'queued'`
        )
        .run(ts, ts, next.id);
      if (!updated.changes) {
        this.db.exec('COMMIT');
        return null;
      }
      const item = this.getAskQueueItem(next.id);
      this.db.exec('COMMIT');
      return item;
    } catch (err) {
      try {
        this.db.exec('ROLLBACK');
      } catch {}
      throw err;
    }
  }
}

module.exports = { Store };
