const { spawn } = require('child_process');

function spawnCapture(command, args, options) {
  const timeoutMs = options?.timeoutMs ?? 30_000;
  const cwd = options?.cwd;

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const child = spawn(command, args, {
      cwd,
      shell: false,
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

    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {}
    }, timeoutMs);

    child.on('close', (exitCode, signal) => {
      clearTimeout(timer);
      resolve({ exitCode, signal, stdout, stderr });
    });

    child.on('error', () => {
      clearTimeout(timer);
      resolve({ exitCode: null, signal: null, stdout, stderr });
    });
  });
}

module.exports = { spawnCapture };

