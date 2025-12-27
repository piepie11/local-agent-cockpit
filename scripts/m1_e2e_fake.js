/**
 * M1 e2e (no UI): Orchestrator end-to-end with fake provider.
 *
 * Goal:
 * - Create workspace/sessions/run in SQLite
 * - Start orchestrator (auto)
 * - Expect: Turn1 manager+executor, Turn2 manager Done, run status DONE
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
  const outDir = path.join(runsDir, `e2e-fake-${getTimestamp()}`);
  fs.mkdirSync(outDir, { recursive: true });
  await writeRunEnv({ outDir, cwd: projectRoot, extra: { kind: 'script', script: 'm1_e2e_fake' } });

  const dbPath = path.join(outDir, 'app.sqlite');
  const store = new Store(dbPath);
  const sseHub = new SseHub({ store });
  const config = {
    runsDir,
    maxConcurrentRuns: 2,
  };
  const orchestrator = new Orchestrator({ store, sseHub, config });

  const ws = store.createWorkspace({
    name: 'e2e_fake',
    rootPath: projectRoot,
    planPath: path.join(projectRoot, 'plan.md'),
  });

  const managerSession = store.createSession({
    workspaceId: ws.id,
    role: 'manager',
    provider: 'fake',
    configJson: JSON.stringify({ sandbox: 'read-only' }),
  });
  const executorSession = store.createSession({
    workspaceId: ws.id,
    role: 'executor',
    provider: 'fake',
    configJson: JSON.stringify({ sandbox: 'read-only' }),
  });

  const run = store.createRun({
    workspaceId: ws.id,
    managerSessionId: managerSession.id,
    executorSessionId: executorSession.id,
    status: 'IDLE',
    optionsJson: JSON.stringify({
      maxTurns: 5,
      turnTimeoutMs: 5_000,
      repoDigestEnabled: false,
      requireGitClean: false,
      noProgressLimit: 0,
    }),
  });

  await orchestrator.start({ runId: run.id, mode: 'auto' });

  const c = orchestrator.getActiveRun(run.id);
  if (!c) throw new Error('run not started');

  let waitMs = 0;
  while (waitMs < 10_000) {
    const current = store.getRun(run.id);
    if (current?.status === 'DONE') break;
    await sleep(100);
    waitMs += 100;
  }

  const finalRun = store.getRun(run.id);
  const turns = store.listTurns(run.id);
  const lastTurn = turns[turns.length - 1];

  if (finalRun.status !== 'DONE') {
    throw new Error(`expected DONE, got ${finalRun.status}`);
  }
  if (finalRun.turnIndex !== 2) {
    throw new Error(`expected turnIndex=2, got ${finalRun.turnIndex}`);
  }
  if (turns.length !== 2) {
    throw new Error(`expected 2 turns, got ${turns.length}`);
  }
  if ((lastTurn.managerOutput || '').trim() !== 'Done') {
    throw new Error(`expected final manager output Done, got: ${JSON.stringify(lastTurn.managerOutput)}`);
  }

  console.log(`[m1_e2e_fake] PASS: run=${finalRun.id}, turns=${turns.length}, outDir=${outDir}`);
  store.close();
}

main().catch((err) => {
  console.error(`[m1_e2e_fake] FAIL: ${err.message}`);
  process.exit(1);
});
