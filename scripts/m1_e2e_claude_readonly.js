/**
 * M1 e2e (no UI): Orchestrator end-to-end with Claude provider.
 *
 * Notes:
 * - Uses --print mode and disables tools via `--tools ""` (no edits/commands).
 * - Uses stream-json to exercise the streaming parser and lastMessage extraction.
 */

const path = require('path');
const fs = require('fs');

const { Store } = require('../src/storage/store');
const { SseHub } = require('../src/sse_hub');
const { Orchestrator } = require('../src/orchestrator/orchestrator');
const { writeRunEnv } = require('../src/lib/run_env');

function getTimestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(
    now.getMinutes()
  )}${pad(now.getSeconds())}`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const projectRoot = path.resolve(__dirname, '..');
  const runsDir = path.join(projectRoot, 'runs');
  const outDir = path.join(runsDir, `e2e-claude-${getTimestamp()}`);
  fs.mkdirSync(outDir, { recursive: true });
  await writeRunEnv({ outDir, cwd: projectRoot, extra: { kind: 'script', script: 'm1_e2e_claude_readonly' } });

  const dbPath = path.join(outDir, 'app.sqlite');
  const store = new Store(dbPath);
  const sseHub = new SseHub({ store });
  const config = {
    runsDir,
    maxConcurrentRuns: 1,
  };
  const orchestrator = new Orchestrator({ store, sseHub, config });

  const ws = store.createWorkspace({
    name: 'e2e_claude_readonly',
    rootPath: projectRoot,
    planPath: path.join(projectRoot, 'plan.md'),
  });

  const managerSession = store.createSession({
    workspaceId: ws.id,
    role: 'manager',
    provider: 'claude',
    configJson: JSON.stringify({
      sandbox: 'read-only',
      systemPromptPath: 'prompts/tests/m1_e2e_claude_manager_system.md',
      outputFormat: 'stream-json',
      includePartialMessages: true,
      permissionMode: 'dontAsk',
      tools: '',
      sessionPersistence: false,
    }),
  });
  const executorSession = store.createSession({
    workspaceId: ws.id,
    role: 'executor',
    provider: 'claude',
    configJson: JSON.stringify({
      sandbox: 'read-only',
      systemPromptPath: 'prompts/tests/m1_e2e_claude_executor_system.md',
      outputFormat: 'stream-json',
      includePartialMessages: true,
      permissionMode: 'dontAsk',
      tools: '',
      sessionPersistence: false,
    }),
  });

  const run = store.createRun({
    workspaceId: ws.id,
    managerSessionId: managerSession.id,
    executorSessionId: executorSession.id,
    status: 'IDLE',
    optionsJson: JSON.stringify({
      maxTurns: 5,
      turnTimeoutMs: 6 * 60 * 1000,
      repoDigestEnabled: false,
      requireGitClean: false,
      noProgressLimit: 0,
      dangerousCommandGuard: true,
    }),
  });

  await orchestrator.start({ runId: run.id, mode: 'auto' });

  let waitMs = 0;
  while (waitMs < 12 * 60 * 1000) {
    const current = store.getRun(run.id);
    if (current?.status === 'DONE') break;
    if (current?.status === 'ERROR' || current?.status === 'PAUSED') break;
    await sleep(250);
    waitMs += 250;
  }

  const finalRun = store.getRun(run.id);
  const turns = store.listTurns(run.id);
  const lastTurn = turns[turns.length - 1];

  if (finalRun.status !== 'DONE') {
    if (finalRun.status === 'RUNNING') {
      await orchestrator.stop({ runId: run.id, reason: 'e2e-timeout' });
    }
    throw new Error(`expected DONE, got ${finalRun.status} (${finalRun.error || '-'})`);
  }
  if ((lastTurn.managerOutput || '').trim() !== 'Done') {
    throw new Error(`expected final manager output Done, got: ${JSON.stringify(lastTurn.managerOutput)}`);
  }

  console.log(`[m1_e2e_claude_readonly] PASS: run=${finalRun.id}, turns=${turns.length}, outDir=${outDir}`);
  store.close();
}

main().catch((err) => {
  console.error(`[m1_e2e_claude_readonly] FAIL: ${err.message}`);
  process.exit(1);
});
