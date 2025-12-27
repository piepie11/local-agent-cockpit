const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const { LineBuffer } = require('../lib/line_buffer');
const { killProcessTree } = require('../lib/kill_tree');
const { isGitRepo } = require('../lib/git_repo');

function normalizeString(value) {
  const s = String(value ?? '').trim();
  return s ? s : null;
}

function tomlString(value) {
  return JSON.stringify(String(value ?? ''));
}

function normalizeReasoningEffort(value) {
  const raw = normalizeString(value);
  if (!raw) return null;
  const v = raw.toLowerCase();
  const allowed = new Set(['low', 'medium', 'high', 'xhigh']);
  if (!allowed.has(v)) throw new Error('MODEL_REASONING_EFFORT_INVALID');
  return v;
}

async function runCodexExec({
  prompt,
  cwd,
  outDir,
  sandbox = 'read-only',
  abortSignal,
  onStdoutJson,
  onStderrLine,
  providerConfig,
}) {
  fs.mkdirSync(outDir, { recursive: true });

  const eventsPath = path.join(outDir, 'events.jsonl');
  const stdoutPath = path.join(outDir, 'stdout.log');
  const stderrPath = path.join(outDir, 'stderr.log');
  const lastMessagePath = path.join(outDir, 'last_message.txt');

  const cfg = providerConfig || {};
  const resumeId = normalizeString(cfg.resume);
  const mode = normalizeString(cfg.mode);
  const model = normalizeString(cfg.model);
  const modelReasoningEffort = normalizeReasoningEffort(cfg.model_reasoning_effort ?? cfg.modelReasoningEffort);
  const jsonRequired = Boolean(cfg.jsonRequired);
  const resumeOnly = Boolean(cfg.resumeOnly);
  const requireProviderSessionId = Boolean(cfg.requireProviderSessionId);

  const preferResume = mode === 'stateful_resume' && Boolean(resumeId);

  const tryPlan = [];
  if (preferResume) {
    tryPlan.push({ label: 'resume-jsonl', useResume: true, useJson: true });
    if (!jsonRequired) tryPlan.push({ label: 'resume-text', useResume: true, useJson: false });
  }
  if (!preferResume || !resumeOnly) {
    tryPlan.push({ label: 'exec-jsonl', useResume: false, useJson: true });
    if (!jsonRequired) tryPlan.push({ label: 'exec-text', useResume: false, useJson: false });
  }

  const baseArgs = [
    '-a',
    'never',
    'exec',
    '--color',
    'never',
    '--output-last-message',
    lastMessagePath,
    '--sandbox',
    sandbox,
  ];

  if (model) baseArgs.push('-c', `model=${tomlString(model)}`);
  if (modelReasoningEffort) baseArgs.push('-c', `model_reasoning_effort=${tomlString(modelReasoningEffort)}`);

  if (!isGitRepo(cwd)) baseArgs.push('--skip-git-repo-check');

  const cmdBase = process.platform === 'win32' ? 'cmd.exe' : 'codex';

  const runOnce = ({ label, useResume, useJson }) =>
    new Promise((resolve, reject) => {
      const attemptDir = path.join(outDir, `attempt-${label}`);
      fs.mkdirSync(attemptDir, { recursive: true });

      const attemptEventsPath = path.join(attemptDir, 'events.jsonl');
      const attemptStdoutPath = path.join(attemptDir, 'stdout.log');
      const attemptStderrPath = path.join(attemptDir, 'stderr.log');
      const attemptLastMessagePath = path.join(attemptDir, 'last_message.txt');

      const args = [...baseArgs];
      args[args.indexOf(lastMessagePath)] = attemptLastMessagePath;
      if (useJson) args.push('--json');
      if (useResume) args.push('resume', resumeId);
      args.push('-');

      const spawnCommand = cmdBase;
      const spawnArgs =
        process.platform === 'win32' ? ['/d', '/s', '/c', 'codex', ...args] : args;

      const stderrStream = fs.createWriteStream(attemptStderrPath);
      const stdoutStream = fs.createWriteStream(useJson ? attemptEventsPath : attemptStdoutPath);

      const proc = spawn(spawnCommand, spawnArgs, {
        cwd,
        shell: false,
        detached: process.platform !== 'win32',
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let aborted = false;
      let providerSessionId = null;

      const stdoutBuffer = new LineBuffer((line) => {
        if (!line) return;
        try {
          const obj = JSON.parse(line);
          if (obj?.type === 'thread.started' && typeof obj.thread_id === 'string') {
            providerSessionId = obj.thread_id;
          }
          onStdoutJson?.(obj);
        } catch {}
      });

      const stderrBuffer = new LineBuffer((line) => {
        if (!line) return;
        onStderrLine?.(line);
      });

      proc.stdout.setEncoding('utf8');
      proc.stderr.setEncoding('utf8');

      proc.stdout.on('data', (chunk) => {
        stdoutStream.write(chunk);
        if (useJson) stdoutBuffer.push(chunk);
      });

      proc.stderr.on('data', (chunk) => {
        stderrStream.write(chunk);
        stderrBuffer.push(chunk);
      });

      const onAbort = async () => {
        aborted = true;
        await killProcessTree(proc.pid);
      };

      if (abortSignal) {
        if (abortSignal.aborted) onAbort();
        abortSignal.addEventListener('abort', onAbort, { once: true });
      }

      proc.stdin.write(prompt || '');
      proc.stdin.end();

      proc.on('error', (err) => {
        reject(err);
      });

      proc.on('close', (exitCode, signal) => {
        stdoutBuffer.flush();
        stderrBuffer.flush();
        stdoutStream.close();
        stderrStream.close();

        let lastMessage = '';
        try {
          if (fs.existsSync(attemptLastMessagePath)) lastMessage = fs.readFileSync(attemptLastMessagePath, 'utf-8');
        } catch {}

        resolve({
          exitCode,
          signal,
          lastMessage,
          outDir: attemptDir,
          usedShell: false,
          usedResume: useResume,
          usedJson: useJson,
          strategy: label,
          aborted,
          pid: proc.pid,
          providerSessionId,
          paths: {
            events: useJson ? attemptEventsPath : null,
            stdout: useJson ? null : attemptStdoutPath,
            stderr: attemptStderrPath,
            lastMessage: attemptLastMessagePath,
          },
        });
      });
    });

  const errors = [];
  for (const attempt of tryPlan) {
    try {
      const result = await runOnce(attempt);
      const ok =
        result.exitCode === 0 &&
        String(result.lastMessage || '').trim().length > 0 &&
        (!requireProviderSessionId || Boolean(result.providerSessionId));
      if (ok) return { ...result, errors };
      errors.push({ strategy: attempt.label, exitCode: result.exitCode, signal: result.signal });
    } catch (err) {
      errors.push({ strategy: attempt.label, error: String(err.message || err) });
    }
  }

  return {
    exitCode: 1,
    signal: null,
    lastMessage: '',
    outDir,
    usedShell: false,
    usedResume: false,
    usedJson: false,
    strategy: 'failed',
    aborted: false,
    pid: null,
    providerSessionId: null,
    errors,
    paths: {
      events: null,
      stdout: null,
      stderr: null,
      lastMessage: null,
    },
  };
}

module.exports = { runCodexExec };
