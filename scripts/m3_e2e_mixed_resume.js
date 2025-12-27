/**
 * M3 e2e (no UI): Mixed providers in stateful_resume mode.
 *
 * Scenario:
 * - manager = codex (resume)
 * - executor = claude (resume)
 *
 * Goal: validate mixed-provider session_id/thread_id persistence and resume usage at least once.
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

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function safeJsonParse(s) {
  try {
    return JSON.parse(s || '{}');
  } catch {
    return {};
  }
}

async function main() {
  const projectRoot = path.resolve(__dirname, '..');
  const runsDir = path.join(projectRoot, 'runs');
  const outDir = path.join(runsDir, `e2e-mixed-resume-${getTimestamp()}`);
  fs.mkdirSync(outDir, { recursive: true });
  await writeRunEnv({ outDir, cwd: projectRoot, extra: { kind: 'script', script: 'm3_e2e_mixed_resume' } });

  const planPath = path.join(outDir, 'plan.md');
  fs.writeFileSync(
    planPath,
    `# e2e plan (mixed resume)\n\n- For TURN_IDX 1..2: Manager must output one <MANAGER_PACKET> to request one <EXEC_LOG>.\n- For TURN_IDX >= 3: Manager must output exactly Done.\n`,
    'utf-8'
  );

  const dbPath = path.join(outDir, 'app.sqlite');
  const store = new Store(dbPath);
  const sseHub = new SseHub({ store });
  const config = {
    runsDir,
    maxConcurrentRuns: 1,
  };
  const orchestrator = new Orchestrator({ store, sseHub, config });

  const ws = store.createWorkspace({
    name: 'e2e_mixed_resume',
    rootPath: projectRoot,
    planPath,
  });

  const managerSession = store.createSession({
    workspaceId: ws.id,
    role: 'manager',
    provider: 'codex',
    configJson: JSON.stringify({
      sandbox: 'read-only',
      mode: 'stateful_resume',
      includePlanEveryTurn: true,
      systemPromptPath: 'prompts/tests/m3_e2e_mixed_manager_system.md',
    }),
  });

  const executorSession = store.createSession({
    workspaceId: ws.id,
    role: 'executor',
    provider: 'claude',
    configJson: JSON.stringify({
      sandbox: 'read-only',
      mode: 'stateful_resume',
      outputFormat: 'stream-json',
      includePartialMessages: true,
      permissionMode: 'dontAsk',
      tools: '',
      sessionPersistence: true,
      systemPromptPath: 'prompts/tests/m1_e2e_claude_executor_system.md',
    }),
  });

  const run = store.createRun({
    workspaceId: ws.id,
    managerSessionId: managerSession.id,
    executorSessionId: executorSession.id,
    status: 'IDLE',
    optionsJson: JSON.stringify({
      maxTurns: 6,
      turnTimeoutMs: 4 * 60 * 1000,
      repoDigestEnabled: false,
      requireGitClean: false,
      noProgressLimit: 0,
      dangerousCommandGuard: true,
    }),
  });

  await orchestrator.start({ runId: run.id, mode: 'auto' });

  let waitMs = 0;
  while (waitMs < 8 * 60 * 1000) {
    const current = store.getRun(run.id);
    if (['DONE', 'ERROR', 'PAUSED', 'STOPPED'].includes(current?.status)) break;
    await sleep(250);
    waitMs += 250;
  }

  const finalRun = store.getRun(run.id);
  const turns = store.listTurns(run.id);
  assert(finalRun.status === 'DONE', `expected DONE, got ${finalRun.status} (${finalRun.error || '-'})`);
  assert(finalRun.turnIndex >= 3, `expected turnIndex >= 3, got ${finalRun.turnIndex}`);
  assert(turns.length >= 3, `expected >= 3 turns, got ${turns.length}`);
  assert((turns[turns.length - 1].managerOutput || '').trim() === 'Done', 'expected final manager output Done');

  const managerSessionFinal = store.getSession(managerSession.id);
  const executorSessionFinal = store.getSession(executorSession.id);
  assert(managerSessionFinal.providerSessionId, 'manager providerSessionId missing');
  assert(executorSessionFinal.providerSessionId, 'executor providerSessionId missing');

  const t1 = turns.find((t) => t.idx === 1);
  const t2 = turns.find((t) => t.idx === 2);
  assert(t1 && t2, 'expected turn 1 and 2');

  const m1 = safeJsonParse(t1.managerMetaJson);
  const m2 = safeJsonParse(t2.managerMetaJson);
  const e1 = safeJsonParse(t1.executorMetaJson);
  const e2 = safeJsonParse(t2.executorMetaJson);

  assert(m1.usedResume === false, 'expected manager usedResume=false on turn 1');
  assert(e1.usedResume === false, 'expected executor usedResume=false on turn 1');
  assert(m2.usedResume === true, 'expected manager usedResume=true on turn 2');
  assert(e2.usedResume === true, 'expected executor usedResume=true on turn 2');

  assert(m1.providerSessionId === m2.providerSessionId, 'expected manager providerSessionId stable between turn 1 and 2');
  assert(e1.providerSessionId === e2.providerSessionId, 'expected executor providerSessionId stable between turn 1 and 2');

  console.log(`[m3_e2e_mixed_resume] PASS: run=${finalRun.id} turns=${turns.length} outDir=${outDir}`);
  store.close();
}

main().catch((err) => {
  console.error(`[m3_e2e_mixed_resume] FAIL: ${err.message}`);
  process.exit(1);
});

