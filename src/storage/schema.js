const schemaSql = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  rootPath TEXT NOT NULL,
  planPath TEXT NOT NULL,
  conventionPath TEXT NOT NULL DEFAULT '',
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  workspaceId TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('manager', 'executor')),
  provider TEXT NOT NULL,
  providerSessionId TEXT,
  configJson TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  lastActiveAt INTEGER,
  FOREIGN KEY (workspaceId) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  workspaceId TEXT NOT NULL,
  managerSessionId TEXT NOT NULL,
  executorSessionId TEXT NOT NULL,
  status TEXT NOT NULL,
  turnIndex INTEGER NOT NULL DEFAULT 0,
  createdAt INTEGER NOT NULL,
  startedAt INTEGER,
  endedAt INTEGER,
  optionsJson TEXT NOT NULL,
  error TEXT,
  FOREIGN KEY (workspaceId) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (managerSessionId) REFERENCES sessions(id),
  FOREIGN KEY (executorSessionId) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS turns (
  id TEXT PRIMARY KEY,
  runId TEXT NOT NULL,
  idx INTEGER NOT NULL,
  startedAt INTEGER NOT NULL,
  endedAt INTEGER,
  managerPromptPath TEXT,
  managerOutput TEXT,
  managerMetaJson TEXT,
  executorPromptPath TEXT,
  executorOutput TEXT,
  executorMetaJson TEXT,
  outcomeJson TEXT,
  FOREIGN KEY (runId) REFERENCES runs(id) ON DELETE CASCADE,
  UNIQUE(runId, idx)
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  runId TEXT NOT NULL,
  turnId TEXT,
  seq INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  role TEXT,
  kind TEXT NOT NULL,
  payloadJson TEXT NOT NULL,
  FOREIGN KEY (runId) REFERENCES runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_events_run_seq ON events(runId, seq);
CREATE INDEX IF NOT EXISTS idx_turns_run_idx ON turns(runId, idx);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  valueJson TEXT NOT NULL,
  updatedAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS session_rollovers (
  id TEXT PRIMARY KEY,
  workspaceId TEXT NOT NULL,
  runId TEXT,
  role TEXT NOT NULL CHECK (role IN ('manager', 'executor')),
  provider TEXT NOT NULL,
  fromSessionId TEXT NOT NULL,
  toSessionId TEXT NOT NULL,
  reason TEXT,
  summaryPath TEXT,
  createdAt INTEGER NOT NULL,
  FOREIGN KEY (workspaceId) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_rollovers_workspace_created ON session_rollovers(workspaceId, createdAt DESC);
CREATE INDEX IF NOT EXISTS idx_rollovers_run ON session_rollovers(runId);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  runId TEXT NOT NULL,
  type TEXT NOT NULL,
  path TEXT NOT NULL,
  metaJson TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  FOREIGN KEY (runId) REFERENCES runs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ask_threads (
  id TEXT PRIMARY KEY,
  workspaceId TEXT NOT NULL,
  title TEXT NOT NULL,
  provider TEXT NOT NULL,
  providerSessionId TEXT,
  configJson TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  lastActiveAt INTEGER,
  FOREIGN KEY (workspaceId) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ask_threads_workspace_updated ON ask_threads(workspaceId, updatedAt DESC);

CREATE TABLE IF NOT EXISTS ask_messages (
  id TEXT PRIMARY KEY,
  threadId TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  text TEXT NOT NULL,
  metaJson TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  FOREIGN KEY (threadId) REFERENCES ask_threads(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ask_messages_thread_created ON ask_messages(threadId, createdAt ASC);

CREATE TABLE IF NOT EXISTS ask_queue_items (
  id TEXT PRIMARY KEY,
  threadId TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'error')),
  text TEXT NOT NULL,
  error TEXT,
  metaJson TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  startedAt INTEGER,
  endedAt INTEGER,
  FOREIGN KEY (threadId) REFERENCES ask_threads(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ask_queue_items_thread_status_created ON ask_queue_items(threadId, status, createdAt ASC);
CREATE INDEX IF NOT EXISTS idx_ask_queue_items_thread_created ON ask_queue_items(threadId, createdAt ASC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ask_queue_items_one_running_per_thread ON ask_queue_items(threadId) WHERE status = 'running';
`;

module.exports = { schemaSql };
