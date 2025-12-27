/**
 * M0-2 roundtrip: Manager -> Executor -> Manager(Done)
 *
 * Purpose: validate prompt assets + Done termination with minimal orchestration.
 *
 * Notes:
 * - Uses codex exec in read-only sandbox for all three calls (no side effects).
 * - Persists per-call artifacts under runs/roundtrip-<timestamp>/XX_role/
 */

const fs = require('fs');
const path = require('path');
const { runCodexExec } = require('./lib/run_codex_exec');
const { writeRunEnv } = require('../src/lib/run_env');

function getTimestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function readText(p) {
  return fs.readFileSync(p, 'utf-8');
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function mustContain(str, token, label) {
  if (!str.includes(token)) {
    throw new Error(`${label} missing required token: ${token}`);
  }
}

async function main() {
  const projectRoot = path.resolve(__dirname, '..');
  const runsRoot = path.join(projectRoot, 'runs');
  const runDir = path.join(runsRoot, `roundtrip-${getTimestamp()}`);

  ensureDir(runDir);
  await writeRunEnv({ outDir: runDir, cwd: projectRoot, extra: { kind: 'script', script: 'm0_roundtrip' } });

  const planText = readText(path.join(projectRoot, 'plan.md'));
  const managerSystem = readText(path.join(projectRoot, 'prompts', 'manager_system.md'));
  const executorSystem = readText(path.join(projectRoot, 'prompts', 'executor_system.md'));

  const managerPrompt1 = `${managerSystem}

CONTEXT:
<PLAN>
${planText}
</PLAN>

The executor has not run anything yet. There is no prior EXEC_LOG.

TASK:
- Output exactly one <MANAGER_PACKET> that instructs the Executor to do ONE thing:
  return a well-formed <EXEC_LOG> that follows the Executor output contract, and semantically means:
  - No code changes (CHANGES is "None", either as a single "None" line or "- None" bullet, but no file paths)
  - No commands run (COMMANDS is "None", either single line or "- None")
  - No results to report (RESULTS is "N/A", either single line or "- N/A")
  - No risks (RISKS is "None")
  - No questions (QUESTIONS is "None")
- Do NOT include anything outside <MANAGER_PACKET>.
- Do NOT output Done in this turn.
`;

  const manager1Dir = path.join(runDir, '01_manager');
  const manager1 = await runCodexExec({
    prompt: managerPrompt1,
    cwd: projectRoot,
    outDir: manager1Dir,
    sandbox: 'read-only',
  });

  const manager1Text = manager1.lastMessage.trim();
  mustContain(manager1Text, '<MANAGER_PACKET>', 'Manager turn 1');
  mustContain(manager1Text, '</MANAGER_PACKET>', 'Manager turn 1');

  const executorPrompt = `${executorSystem}

MANAGER_INSTRUCTION:
${manager1.lastMessage}

TASK:
- Follow the Manager instruction.
- Output ONLY one <EXEC_LOG> block. No extra text.
`;

  const executorDir = path.join(runDir, '02_executor');
  const executor = await runCodexExec({
    prompt: executorPrompt,
    cwd: projectRoot,
    outDir: executorDir,
    sandbox: 'read-only',
  });

  const executorText = executor.lastMessage.trim();
  mustContain(executorText, '<EXEC_LOG>', 'Executor');
  mustContain(executorText, '</EXEC_LOG>', 'Executor');

  const managerPrompt2 = `${managerSystem}

CONTEXT:
<PLAN>
${planText}
</PLAN>

LAST_MANAGER_PACKET:
${manager1.lastMessage}

LAST_EXEC_LOG:
${executor.lastMessage}

TASK:
- If the Executor output is well-formed and satisfies the instruction, output exactly:
Done
- Otherwise output a <MANAGER_PACKET> with fixes (but prefer Done if acceptable).
- Notes:
  - SUMMARY is allowed.
  - Treat "None" and "- None" as equivalent for section bodies.
  - Treat "N/A" and "- N/A" as equivalent for section bodies.
  - Do NOT require reformatting if the semantics match (prefer Done).
`;

  const manager2Dir = path.join(runDir, '03_manager');
  const manager2 = await runCodexExec({
    prompt: managerPrompt2,
    cwd: projectRoot,
    outDir: manager2Dir,
    sandbox: 'read-only',
  });

  const manager2Text = manager2.lastMessage.trim();
  if (manager2Text !== 'Done') {
    throw new Error(`Expected final manager message to be Done, got: ${JSON.stringify(manager2Text)}`);
  }

  console.log(`[roundtrip] PASS: final manager message is Done`);
  console.log(`[roundtrip] Run dir: ${runDir}`);
}

main().catch((err) => {
  console.error(`[roundtrip] FAIL: ${err.message}`);
  process.exit(1);
});
