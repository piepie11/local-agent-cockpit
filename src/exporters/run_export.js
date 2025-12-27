const fs = require('fs');
const path = require('path');

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function formatTs(ms) {
  if (!ms) return '';
  return new Date(ms).toISOString();
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

async function exportRunToMarkdown({ store, config, runId }) {
  const run = store.getRun(runId);
  if (!run) throw new Error('RUN_NOT_FOUND');
  const workspace = store.getWorkspace(run.workspaceId);
  if (!workspace) throw new Error('WORKSPACE_NOT_FOUND');
  const turns = store.listTurns(runId);
  const managerSession = store.getSession(run.managerSessionId);
  const executorSession = store.getSession(run.executorSessionId);

  const lines = [];
  lines.push(`# Run ${run.id}`);
  lines.push('');
  lines.push(`- workspace: ${workspace.name} (${workspace.id})`);
  lines.push(`- rootPath: ${workspace.rootPath}`);
  lines.push(`- status: ${run.status}`);
  lines.push(`- createdAt: ${formatTs(run.createdAt)}`);
  lines.push(`- startedAt: ${formatTs(run.startedAt)}`);
  lines.push(`- endedAt: ${formatTs(run.endedAt)}`);
  lines.push(`- managerSessionId: ${run.managerSessionId}`);
  lines.push(`- executorSessionId: ${run.executorSessionId}`);
  if (managerSession) {
    lines.push(`- manager: provider=${managerSession.provider} providerSessionId=${managerSession.providerSessionId || '-'}`);
  }
  if (executorSession) {
    lines.push(`- executor: provider=${executorSession.provider} providerSessionId=${executorSession.providerSessionId || '-'}`);
  }
  lines.push('');

  for (const t of turns) {
    const managerMeta = safeJsonParse(t.managerMetaJson, {});
    const executorMeta = safeJsonParse(t.executorMetaJson, {});

    lines.push(`## Turn ${t.idx}`);
    lines.push('');
    lines.push(`### Manager`);
    lines.push('');
    lines.push(t.managerOutput || '');
    lines.push('');
    lines.push(`### Manager meta`);
    lines.push('');
    lines.push('```json');
    lines.push(JSON.stringify(managerMeta, null, 2));
    lines.push('```');
    lines.push('');
    lines.push(`### Executor`);
    lines.push('');
    lines.push(t.executorOutput || '');
    lines.push('');
    lines.push(`### Executor meta`);
    lines.push('');
    lines.push('```json');
    lines.push(JSON.stringify(executorMeta, null, 2));
    lines.push('```');
    lines.push('');
  }

  const content = lines.join('\n');
  const filename = `run-${run.id}.md`;
  const outDir = path.join(config.runsDir, workspace.id, run.id);
  ensureDir(outDir);
  fs.writeFileSync(path.join(outDir, filename), content, 'utf-8');
  store.createArtifact({
    runId,
    type: 'export-md',
    path: path.join(outDir, filename),
    meta: { bytes: Buffer.byteLength(content, 'utf8') },
  });
  return { filename, content };
}

async function exportRunToJson({ store, config, runId }) {
  const run = store.getRun(runId);
  if (!run) throw new Error('RUN_NOT_FOUND');
  const workspace = store.getWorkspace(run.workspaceId);
  if (!workspace) throw new Error('WORKSPACE_NOT_FOUND');
  const turns = store.listTurns(runId);
  const managerSession = store.getSession(run.managerSessionId);
  const executorSession = store.getSession(run.executorSessionId);
  const options = safeJsonParse(run.optionsJson, {});

  const obj = {
    run: { ...run, options },
    workspace,
    sessions: { manager: managerSession, executor: executorSession },
    rollovers: store.listSessionRollovers(workspace.id).filter((r) => r.runId === run.id),
    turns: turns.map((t) => ({
      ...t,
      managerMeta: safeJsonParse(t.managerMetaJson, {}),
      executorMeta: safeJsonParse(t.executorMetaJson, {}),
    })),
  };
  const content = JSON.stringify(obj, null, 2);
  const filename = `run-${run.id}.json`;
  const outDir = path.join(config.runsDir, workspace.id, run.id);
  ensureDir(outDir);
  fs.writeFileSync(path.join(outDir, filename), content, 'utf-8');
  store.createArtifact({
    runId,
    type: 'export-json',
    path: path.join(outDir, filename),
    meta: { bytes: Buffer.byteLength(content, 'utf8') },
  });
  return { filename, content };
}

async function exportRunToJsonl({ store, config, runId }) {
  const run = store.getRun(runId);
  if (!run) throw new Error('RUN_NOT_FOUND');
  const workspace = store.getWorkspace(run.workspaceId);
  if (!workspace) throw new Error('WORKSPACE_NOT_FOUND');

  const events = store.listEventsAfter(runId, 0);
  const content = events.map((e) => JSON.stringify(e)).join('\n') + '\n';
  const filename = `run-${run.id}.jsonl`;
  const outDir = path.join(config.runsDir, workspace.id, run.id);
  ensureDir(outDir);
  fs.writeFileSync(path.join(outDir, filename), content, 'utf-8');
  store.createArtifact({
    runId,
    type: 'export-jsonl',
    path: path.join(outDir, filename),
    meta: { count: events.length, bytes: Buffer.byteLength(content, 'utf8') },
  });
  return { filename, content };
}

module.exports = { exportRunToMarkdown, exportRunToJson, exportRunToJsonl };
