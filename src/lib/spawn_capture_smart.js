const { spawn } = require('child_process');

function nowMs() {
  return Date.now();
}

function truncate(text, maxChars) {
  const t = String(text ?? '');
  if (t.length <= maxChars) return t;
  return `${t.slice(0, maxChars)}...(truncated)`;
}

function withCmdExt(command) {
  const c = String(command || '').trim();
  if (!c) return c;
  if (/\.(cmd|exe|bat)$/i.test(c)) return c;
  return `${c}.cmd`;
}

function spawnCaptureAttempt(command, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const cwd = options.cwd;
  const shell = Boolean(options.shell);

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const startedAt = nowMs();

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
          elapsedMs: nowMs() - startedAt,
          error: null,
        });
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({
          exitCode: null,
          signal: null,
          stdout,
          stderr,
          elapsedMs: nowMs() - startedAt,
          error: { code: err.code, message: err.message },
        });
      });
    } catch (err) {
      clearTimeout(timer);
      resolve({
        exitCode: null,
        signal: null,
        stdout,
        stderr,
        elapsedMs: nowMs() - startedAt,
        error: { code: err.code, message: err.message },
      });
    }
  });
}

async function spawnCaptureSmart(command, args, options = {}) {
  const cwd = options.cwd;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const allowShellFallback = options.allowShellFallback !== false;
  const maxOutputChars = options.maxOutputChars ?? 12_000;

  const attempts = [];

  const tryOnce = async (resolvedCommand, resolvedArgs, shell, strategy) => {
    const r = await spawnCaptureAttempt(resolvedCommand, resolvedArgs, { cwd, timeoutMs, shell });
    const summary = {
      command: resolvedCommand,
      args: Array.isArray(resolvedArgs) ? resolvedArgs : [],
      shell,
      strategy,
      exitCode: r.exitCode,
      signal: r.signal,
      stdout: truncate((r.stdout || '').trim(), 800),
      stderr: truncate((r.stderr || '').trim(), 800),
      elapsedMs: r.elapsedMs,
      error: r.error,
    };
    attempts.push(summary);
    return r;
  };

  const candidates = [
    { command, args, shell: false, strategy: 'direct' },
  ];

  if (process.platform === 'win32') {
    candidates.push({
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', command, ...(Array.isArray(args) ? args : [])],
      shell: false,
      strategy: 'cmd-wrapper',
    });
  }

  if (process.platform === 'win32' && allowShellFallback) candidates.push({ command, args, shell: true, strategy: 'shell' });

  let last = null;
  for (const c of candidates) {
    const r = await tryOnce(c.command, c.args, c.shell, c.strategy);
    last = { ...r, command: c.command, args: c.args, usedShell: c.shell, strategy: c.strategy };
    if (r.exitCode !== null) break;
    if (r.error && r.error.code && String(r.error.code).toUpperCase() !== 'ENOENT') break;
  }

  const stdout = truncate(last?.stdout || '', maxOutputChars);
  const stderr = truncate(last?.stderr || '', maxOutputChars);

  return {
    ok: last?.exitCode === 0,
    command: last?.command || command,
    args: Array.isArray(last?.args) ? last.args : Array.isArray(args) ? args : [],
    exitCode: last?.exitCode ?? null,
    signal: last?.signal ?? null,
    stdout,
    stderr,
    elapsedMs: last?.elapsedMs ?? null,
    error: last?.error ?? null,
    usedShell: last?.usedShell ?? false,
    strategy: last?.strategy || 'direct',
    attempts,
  };
}

module.exports = { spawnCaptureSmart };
