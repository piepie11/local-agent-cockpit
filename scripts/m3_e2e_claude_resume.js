/**
 * M3 e2e (no UI): Orchestrator end-to-end with real Claude provider in stateful_resume mode.
 *
 * Validates:
 * - session_id extraction (providerSessionId)
 * - resume path is used for turns >= 2 (manager + executor)
 * - providerSessionId stays stable across multiple turns
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
  const outDir = path.join(runsDir, `e2e-claude-resume-${getTimestamp()}`);
  fs.mkdirSync(outDir, { recursive: true });
  await writeRunEnv({ outDir, cwd: projectRoot, extra: { kind: 'script', script: 'm3_e2e_claude_resume' } });

  const planPath = path.join(outDir, 'plan.md');
  fs.writeFileSync(
    planPath,
    `# e2e plan (claude resume)\n\n- For TURN_IDX 1..5: Manager must output one <MANAGER_PACKET> to request one <EXEC_LOG>.\n- For TURN_IDX >= 6: Manager must output exactly Done.\n`,
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
    name: 'e2e_claude_resume',
    rootPath: projectRoot,
    planPath,
  });

  const baseSessionCfg = {
    sandbox: 'read-only',
    mode: 'stateful_resume',
    includePlanEveryTurn: true,
    outputFormat: 'stream-json',
    includePartialMessages: true,
    permissionMode: 'dontAsk',
    tools: '',
    sessionPersistence: true,
  };

  const managerSession = store.createSession({
    workspaceId: ws.id,
    role: 'manager',
    provider: 'claude',
    configJson: JSON.stringify({
      ...baseSessionCfg,
      systemPromptPath: 'prompts/tests/m3_e2e_claude_resume_manager_system.md',
    }),
  });

  const executorSession = store.createSession({
    workspaceId: ws.id,
    role: 'executor',
    provider: 'claude',
    configJson: JSON.stringify({
      ...baseSessionCfg,
      systemPromptPath: 'prompts/tests/m1_e2e_claude_executor_system.md',
    }),
  });

  const run = store.createRun({
    workspaceId: ws.id,
    managerSessionId: managerSession.id,
    executorSessionId: executorSession.id,
    status: 'IDLE',
    optionsJson: JSON.stringify({
      maxTurns: 10,
      turnTimeoutMs: 4 * 60 * 1000,
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
    if (['DONE', 'ERROR', 'PAUSED', 'STOPPED'].includes(current?.status)) break;
    await sleep(250);
    waitMs += 250;
  }

  const finalRun = store.getRun(run.id);
  const turns = store.listTurns(run.id);
  assert(finalRun.status === 'DONE', `expected DONE, got ${finalRun.status} (${finalRun.error || '-'})`);
  assert(finalRun.turnIndex >= 6, `expected turnIndex >= 6, got ${finalRun.turnIndex}`);
  assert(turns.length >= 6, `expected >= 6 turns, got ${turns.length}`);
  assert((turns[turns.length - 1].managerOutput || '').trim() === 'Done', 'expected final manager output Done');

  const managerSessionFinal = store.getSession(managerSession.id);
  const executorSessionFinal = store.getSession(executorSession.id);
  assert(managerSessionFinal.providerSessionId, 'manager providerSessionId missing');
  assert(executorSessionFinal.providerSessionId, 'executor providerSessionId missing');

  const managerIds = [];
  const executorIds = [];

  for (const t of turns.slice(0, 5)) {
    const mm = safeJsonParse(t.managerMetaJson);
    const em = safeJsonParse(t.executorMetaJson);
    if (mm.providerSessionId) managerIds.push(mm.providerSessionId);
    if (em.providerSessionId) executorIds.push(em.providerSessionId);

    if (t.idx >= 2) {
      assert(mm.usedResume === true, `expected manager usedResume on turn ${t.idx}`);
      assert(em.usedResume === true, `expected executor usedResume on turn ${t.idx}`);
      assert(String(mm.strategy || '').startsWith('resume'), `expected manager strategy resume* on turn ${t.idx}`);
      assert(String(em.strategy || '').startsWith('resume'), `expected executor strategy resume* on turn ${t.idx}`);
    } else {
      assert(mm.usedResume === false, `expected manager usedResume=false on turn ${t.idx}`);
      assert(em.usedResume === false, `expected executor usedResume=false on turn ${t.idx}`);
    }
  }

  assert(
    managerIds.every((id) => id === managerSessionFinal.providerSessionId),
    `manager providerSessionId should stay stable: ${JSON.stringify(managerIds)} vs ${managerSessionFinal.providerSessionId}`
  );
  assert(
    executorIds.every((id) => id === executorSessionFinal.providerSessionId),
    `executor providerSessionId should stay stable: ${JSON.stringify(executorIds)} vs ${executorSessionFinal.providerSessionId}`
  );

  console.log(`[m3_e2e_claude_resume] PASS: run=${finalRun.id} turns=${turns.length} outDir=${outDir}`);
  store.close();
}

main().catch((err) => {
  console.error(`[m3_e2e_claude_resume] FAIL: ${err.message}`);
  process.exit(1);
});

