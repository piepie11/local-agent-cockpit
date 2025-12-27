const { spawn } = require('child_process');

function killProcessTree(pid) {
  if (!pid || typeof pid !== 'number') return Promise.resolve();

  if (process.platform === 'win32') {
    return new Promise((resolve) => {
      const proc = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      proc.on('close', () => resolve());
      proc.on('error', () => resolve());
    });
  }

  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {}
  }

  return Promise.resolve();
}

module.exports = { killProcessTree };

