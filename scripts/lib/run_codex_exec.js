/**
 * run_codex_exec.js - 通用封装：调用 codex exec 并落盘
 * 
 * 功能：
 * - spawn codex exec，prompt 通过 stdin 传入
 * - stdout -> events.jsonl
 * - stderr -> stderr.log
 * - 读取 --output-last-message 产出的 last_message.txt
 * - 自动检测无 .git 时追加 --skip-git-repo-check
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * 检测目录是否在 git 仓库内（向上查找父目录直到根目录）
 * @param {string} dir 
 * @returns {boolean}
 */
function isGitRepo(dir) {
  try {
    let current = path.resolve(dir);
    const root = path.parse(current).root;
    
    while (current !== root) {
      const gitDir = path.join(current, '.git');
      if (fs.existsSync(gitDir)) {
        return true;
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    
    // 检查根目录
    const rootGitDir = path.join(root, '.git');
    return fs.existsSync(rootGitDir);
  } catch {
    return false;
  }
}

/**
 * 运行 codex exec
 * @param {Object} options
 * @param {string} options.prompt - 发送给 codex 的 prompt
 * @param {string} options.cwd - 工作目录
 * @param {string} options.outDir - 输出目录（存放 events.jsonl, stderr.log, last_message.txt）
 * @param {string} [options.sandbox='read-only'] - sandbox 模式
 * @returns {Promise<{exitCode: number|null, signal: string|null, lastMessage: string, outDir: string}>}
 */
async function runCodexExec(options) {
  const { prompt, cwd, outDir, sandbox = 'read-only' } = options;

  // 确保输出目录存在
  fs.mkdirSync(outDir, { recursive: true });

  const eventsPath = path.join(outDir, 'events.jsonl');
  const stderrPath = path.join(outDir, 'stderr.log');
  const lastMessagePath = path.join(outDir, 'last_message.txt');

  // 构建参数
  const args = [
    '-a', 'never',
    'exec',
    '--json',
    '--color', 'never',
    '--output-last-message', lastMessagePath,
    '--sandbox', sandbox,
  ];

  // 检测无 .git 时追加 --skip-git-repo-check
  if (!isGitRepo(cwd)) {
    args.push('--skip-git-repo-check');
  }

  // 用 - 让 codex 从 stdin 读 prompt
  args.push('-');

  const trySpawn = (command, useShell) => {
    return new Promise((resolve, reject) => {
      const eventsStream = fs.createWriteStream(eventsPath);
      const stderrStream = fs.createWriteStream(stderrPath);

      const proc = spawn(command, args, {
        cwd,
        shell: useShell,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // pipe stdout -> events.jsonl
      proc.stdout.pipe(eventsStream);

      // pipe stderr -> stderr.log
      proc.stderr.pipe(stderrStream);

      // 写入 prompt 到 stdin，然后关闭
      proc.stdin.write(prompt);
      proc.stdin.end();

      proc.on('error', (err) => {
        eventsStream.close();
        stderrStream.close();
        reject(err);
      });

      proc.on('close', (exitCode, signal) => {
        eventsStream.close();
        stderrStream.close();

        // 读取 last_message.txt
        let lastMessage = '';
        try {
          if (fs.existsSync(lastMessagePath)) {
            lastMessage = fs.readFileSync(lastMessagePath, 'utf-8');
          }
        } catch (err) {
          // 读取失败时留空
        }

        resolve({
          exitCode,
          signal,
          lastMessage,
          outDir,
          usedShell: useShell,
          paths: {
            events: eventsPath,
            stderr: stderrPath,
            lastMessage: lastMessagePath,
          },
        });
      });
    });
  };

  // 执行策略：
  // - 所有平台优先尝试 shell:false（更安全，子进程树更易管理）
  // - 仅当 shell:false 启动失败（ENOENT/EINVAL 等）时，fallback 到 shell:true
  // - usedShell 真实反映本次是否走了 fallback
  try {
    return await trySpawn('codex', false);
  } catch (err) {
    // 启动失败，fallback 到 shell:true
    console.error(`[run_codex_exec] shell:false failed (${err.code}), fallback to shell:true`);
    return trySpawn('codex', true);
  }
}

module.exports = { runCodexExec, isGitRepo };
