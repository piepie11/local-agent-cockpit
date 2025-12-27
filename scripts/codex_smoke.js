/**
 * codex_smoke.js - Smoke test for codex exec wrapper
 * 
 * 验证：
 * - codex exec 能正常调用
 * - last_message.txt 落盘成功
 * - lastMessage.trim() === "OK"
 */

const path = require('path');
const fs = require('fs');
const { runCodexExec } = require('./lib/run_codex_exec');
const { writeRunEnv } = require('../src/lib/run_env');

// 生成时间戳目录名
function getTimestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

async function main() {
  const projectRoot = path.resolve(__dirname, '..');
  const runsDir = path.join(projectRoot, 'runs');
  const outDir = path.join(runsDir, `smoke-${getTimestamp()}`);

  console.log(`[smoke] Output directory: ${outDir}`);
  await writeRunEnv({ outDir, cwd: projectRoot, extra: { kind: 'script', script: 'codex_smoke' } });

  // Prompt 强约束：禁止跑命令/禁止多余字符，最终回复必须严格为 OK
  const prompt = `You are in a smoke test. 
RULES:
- Do NOT run any shell commands
- Do NOT write any files
- Do NOT output any extra characters, explanations, or markdown
- Your ENTIRE response must be exactly the two characters: OK

Respond now.`;

  // 用于留痕的摘要信息
  const summary = {
    stderrSummary: '',
    usedShell: false,
  };

  try {
    const result = await runCodexExec({
      prompt,
      cwd: projectRoot,
      outDir,
      sandbox: 'read-only',
    });

    console.log(`[smoke] Exit code: ${result.exitCode}`);
    console.log(`[smoke] Signal: ${result.signal}`);
    console.log(`[smoke] usedShell: ${result.usedShell}`);
    console.log(`[smoke] last_message.txt content:`);
    console.log('---');
    console.log(result.lastMessage);
    console.log('---');

    summary.usedShell = result.usedShell;

    // 读取 stderr.log 并检查是否非空
    let stderrContent = '';
    try {
      stderrContent = fs.readFileSync(result.paths.stderr, 'utf-8');
    } catch {}

    if (stderrContent.trim()) {
      summary.stderrSummary = stderrContent.slice(0, 300);
      console.warn('[smoke] WARN: stderr.log is not empty (first 300 chars):');
      console.warn(summary.stderrSummary);
    }

    // 严格校验 1: exitCode 必须为 0
    if (result.exitCode !== 0) {
      console.error(`[smoke] ✗ FAIL: exitCode=${result.exitCode} (expected 0)`);
      process.exit(1);
    }

    // 严格校验 2: signal 必须为 null
    if (result.signal !== null) {
      console.error(`[smoke] ✗ FAIL: signal=${result.signal} (expected null)`);
      process.exit(1);
    }

    // 严格校验 3: lastMessage 必须为 OK
    const trimmed = result.lastMessage.trim();
    if (trimmed !== 'OK') {
      console.error(`[smoke] ✗ FAIL: expected "OK", got "${trimmed}"`);
      console.error(`[smoke] Check stderr.log at: ${result.paths.stderr}`);
      process.exit(1);
    }

    console.log('[smoke] ✓ PASS: exitCode=0, signal=null, lastMessage="OK"');
    process.exit(0);
  } catch (err) {
    console.error(`[smoke] ERROR: ${err.message}`);
    process.exit(1);
  }
}

main();
