const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function nowIso() {
  return new Date().toISOString();
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function truncate(text, maxChars) {
  const t = String(text ?? '');
  if (t.length <= maxChars) return t;
  return `${t.slice(0, maxChars)}...(truncated)`;
}

function spawnCapture(command, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? 5000;
  const cwd = options.cwd;
  const shell = Boolean(options.shell);

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const startedAt = Date.now();

    let timer;
    try {
      const child = spawn(command, args, {
        cwd,
        shell,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (d) => {
        stdout += d;
      });
      child.stderr.on('data', (d) => {
        stderr += d;
      });

      timer = setTimeout(() => {
        try {
          child.kill();
        } catch {}
      }, timeoutMs);

      child.on('close', (exitCode, signal) => {
        clearTimeout(timer);
        resolve({
          exitCode,
          signal,
          stdout,
          stderr,
          elapsedMs: Date.now() - startedAt,
          error: null,
          usedShell: shell,
        });
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({
          exitCode: null,
          signal: null,
          stdout,
          stderr,
          elapsedMs: Date.now() - startedAt,
          error: { code: err.code, message: err.message },
          usedShell: shell,
        });
      });
    } catch (err) {
      clearTimeout(timer);
      resolve({
        exitCode: null,
        signal: null,
        stdout,
        stderr,
        elapsedMs: Date.now() - startedAt,
        error: { code: err.code, message: err.message },
        usedShell: shell,
      });
    }
  });
}

async function getCodexVersion({ cwd } = {}) {
  const args = ['--version'];
  const tryCmd = async (command, shell) => spawnCapture(command, args, { cwd, shell, timeoutMs: 5000 });

  let result = await tryCmd('codex', false);
  if (result.exitCode === null && process.platform === 'win32') {
    const cmdResult = await tryCmd('codex.cmd', false);
    if (cmdResult.exitCode !== null) result = cmdResult;
  }
  if (result.exitCode === null && process.platform === 'win32') {
    result = await tryCmd('codex', true);
  }

  return {
    command: 'codex',
    args,
    ok: result.exitCode === 0,
    exitCode: result.exitCode,
    signal: result.signal,
    stdout: truncate(String(result.stdout || '').trim(), 800),
    stderr: truncate(String(result.stderr || '').trim(), 800),
    error: result.error,
    usedShell: result.usedShell,
    elapsedMs: result.elapsedMs,
  };
}

async function collectRunEnv({ cwd, includeCodexVersion = true } = {}) {
  const base = {
    ts: nowIso(),
    cwd: cwd || process.cwd(),
    serverCwd: process.cwd(),
    platform: process.platform,
    nodeV: process.version,
    nodeExecPath: process.execPath,
  };

  if (!includeCodexVersion) return base;

  return {
    ...base,
    codex: await getCodexVersion({ cwd }),
  };
}

async function writeRunEnv({ outDir, cwd, extra, includeCodexVersion = true } = {}) {
  if (!outDir) throw new Error('OUT_DIR_REQUIRED');
  ensureDir(outDir);

  const env = await collectRunEnv({ cwd, includeCodexVersion });
  const payload = extra ? { ...env, extra } : env;
  const p = path.join(outDir, 'run_env.json');
  fs.writeFileSync(p, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
  return { path: p, env: payload };
}

module.exports = { writeRunEnv, collectRunEnv, getCodexVersion };

