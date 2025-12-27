const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const { LineBuffer } = require('../lib/line_buffer');
const { killProcessTree } = require('../lib/kill_tree');

function normalizeBool(value) {
  return Boolean(value);
}

function normalizeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeString(value) {
  const s = String(value ?? '').trim();
  return s ? s : null;
}

function normalizeReasoningEffort(value) {
  const raw = normalizeString(value);
  if (!raw) return null;
  const v = raw.toLowerCase();
  const allowed = new Set(['low', 'medium', 'high', 'xhigh']);
  if (!allowed.has(v)) throw new Error('MODEL_REASONING_EFFORT_INVALID');
  return v;
}

function joinList(value) {
  if (!value) return null;
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean).join(',');
  const s = String(value).trim();
  return s ? s : null;
}

function buildReasoningEffortSystemPrompt(effort) {
  const v = normalizeReasoningEffort(effort);
  if (!v) return null;
  return `REASONING_EFFORT: ${v}\nFollow the requested reasoning effort for this session while still obeying all output contracts.`;
}

function buildArgs(providerConfig) {
  const cfg = providerConfig || {};
  const outputFormat = normalizeString(cfg.outputFormat) || 'stream-json';
  const includePartialMessages =
    cfg.includePartialMessages === undefined ? true : normalizeBool(cfg.includePartialMessages);

  const model = normalizeString(cfg.model);
  const reasoningEffort = normalizeReasoningEffort(cfg.model_reasoning_effort ?? cfg.modelReasoningEffort);
  const agent = normalizeString(cfg.agent);
  const permissionMode = normalizeString(cfg.permissionMode);
  const maxBudgetUsd = normalizeNumber(cfg.maxBudgetUsd);
  const maxTurns = normalizeNumber(cfg.maxTurns);

  const tools = cfg.tools === undefined ? null : joinList(cfg.tools);
  const allowedTools = joinList(cfg.allowedTools);
  const disallowedTools = joinList(cfg.disallowedTools);

  const dangerouslySkipPermissions = normalizeBool(cfg.dangerouslySkipPermissions);
  const sessionPersistence = cfg.sessionPersistence === undefined ? false : normalizeBool(cfg.sessionPersistence);
  const resume = normalizeString(cfg.resume);
  const forkSession = normalizeBool(cfg.forkSession);
  const continueSession = normalizeBool(cfg.continueSession);

  const jsonSchema = normalizeString(cfg.jsonSchema);

  const args = ['-p', '--output-format', outputFormat];

  if (outputFormat === 'stream-json') {
    args.push('--verbose');
    if (includePartialMessages) args.push('--include-partial-messages');
  }

  if (jsonSchema) args.push('--json-schema', jsonSchema);
  if (model) args.push('--model', model);
  if (reasoningEffort) args.push('--append-system-prompt', buildReasoningEffortSystemPrompt(reasoningEffort));
  if (agent) args.push('--agent', agent);
  if (permissionMode) args.push('--permission-mode', permissionMode);
  if (maxBudgetUsd !== null) args.push('--max-budget-usd', String(maxBudgetUsd));
  if (maxTurns !== null) args.push('--max-turns', String(maxTurns));

  if (dangerouslySkipPermissions) args.push('--dangerously-skip-permissions');
  if (!sessionPersistence && !resume && !continueSession) args.push('--no-session-persistence');

  if (continueSession) args.push('--continue');
  if (resume) args.push('--resume', resume);
  if (forkSession) args.push('--fork-session');

  if (tools !== null) args.push('--tools', tools);
  if (allowedTools) args.push('--allowed-tools', allowedTools);
  if (disallowedTools) args.push('--disallowed-tools', disallowedTools);

  return { args, outputFormat };
}

async function runClaudeExec({
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

  const cfg = providerConfig || {};
  const mode = normalizeString(cfg.mode);
  const resumeId = normalizeString(cfg.resume);
  const allowContinueFallback = normalizeBool(cfg.allowContinueFallback);

  const isResumeMode = mode === 'stateful_resume';
  const baseCfg = isResumeMode ? { ...cfg, sessionPersistence: true } : { ...cfg };

  const wantResume = isResumeMode && Boolean(resumeId);
  const needsSessionIdFromSeed = isResumeMode && !wantResume;

  const attemptPlan = [];
  if (wantResume) {
    attemptPlan.push({
      label: 'resume-stream-json',
      cfg: { ...baseCfg, resume: resumeId, continueSession: false, outputFormat: 'stream-json', includePartialMessages: true },
    });
    attemptPlan.push({
      label: 'resume-json',
      cfg: { ...baseCfg, resume: resumeId, continueSession: false, outputFormat: 'json', includePartialMessages: false },
    });
    if (allowContinueFallback) {
      attemptPlan.push({
        label: 'continue-stream-json',
        cfg: { ...baseCfg, resume: null, continueSession: true, outputFormat: 'stream-json', includePartialMessages: true },
      });
    }
  } else {
    attemptPlan.push({
      label: 'exec-stream-json',
      cfg: { ...baseCfg, resume: null, continueSession: false, outputFormat: 'stream-json', includePartialMessages: true },
    });
    attemptPlan.push({
      label: 'exec-json',
      cfg: { ...baseCfg, resume: null, continueSession: false, outputFormat: 'json', includePartialMessages: false },
    });
  }
  attemptPlan.push({
    label: 'exec-text',
    cfg: { ...baseCfg, resume: null, continueSession: false, outputFormat: 'text', includePartialMessages: false },
  });

  const cmdBase = process.platform === 'win32' ? 'cmd.exe' : 'claude';

  const errors = [];

  const runOnce = ({ label, cfg: attemptCfg }) =>
    new Promise((resolve, reject) => {
      const attemptDir = path.join(outDir, `attempt-${label}`);
      fs.mkdirSync(attemptDir, { recursive: true });

      const attemptEventsPath = path.join(attemptDir, 'events.jsonl');
      const attemptStdoutPath = path.join(attemptDir, 'stdout.log');
      const attemptStderrPath = path.join(attemptDir, 'stderr.log');
      const attemptLastMessagePath = path.join(attemptDir, 'last_message.txt');

      const { args, outputFormat } = buildArgs(attemptCfg);

      const spawnCommand = cmdBase;
      const spawnArgs =
        process.platform === 'win32' ? ['/d', '/s', '/c', 'claude', ...args] : args;

      const stderrStream = fs.createWriteStream(attemptStderrPath);
      const stdoutStream = fs.createWriteStream(outputFormat === 'text' ? attemptStdoutPath : attemptEventsPath);

      const proc = spawn(spawnCommand, spawnArgs, {
        cwd,
        shell: false,
        detached: process.platform !== 'win32',
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let aborted = false;
      let lastMessage = '';
      let providerSessionId = null;
      let stdoutText = '';
      let aggregatedText = '';

      const stdoutBuffer = new LineBuffer((line) => {
        if (!line) return;
        try {
          const obj = JSON.parse(line);
          onStdoutJson?.(obj);

          if (typeof obj?.session_id === 'string') providerSessionId = obj.session_id;
          if (typeof obj?.result === 'string') lastMessage = obj.result;

          const event = obj?.type === 'stream_event' ? obj.event : null;
          if (
            event?.type === 'content_block_delta' &&
            event?.delta?.type === 'text_delta' &&
            typeof event.delta.text === 'string'
          ) {
            aggregatedText += event.delta.text;
          }
        } catch {
          // ignore non-JSON lines
        }
      });

      const stderrBuffer = new LineBuffer((line) => {
        if (!line) return;
        onStderrLine?.(line);
      });

      proc.stdout.setEncoding('utf8');
      proc.stderr.setEncoding('utf8');

      proc.stdout.on('data', (chunk) => {
        stdoutStream.write(chunk);
        if (outputFormat === 'text') stdoutText += chunk;
        else stdoutBuffer.push(chunk);
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

        if (!lastMessage) lastMessage = outputFormat === 'text' ? stdoutText : aggregatedText;
        try {
          fs.writeFileSync(attemptLastMessagePath, lastMessage || '', 'utf-8');
        } catch {}

        resolve({
          exitCode,
          signal,
          lastMessage,
          outDir: attemptDir,
          usedShell: false,
          usedResume: Boolean(attemptCfg.resume || attemptCfg.continueSession),
          usedJson: outputFormat !== 'text',
          strategy: label,
          aborted,
          pid: proc.pid,
          sandbox,
          providerSessionId,
          paths: {
            events: outputFormat === 'text' ? null : attemptEventsPath,
            stdout: outputFormat === 'text' ? attemptStdoutPath : null,
            stderr: attemptStderrPath,
            lastMessage: attemptLastMessagePath,
          },
        });
      });
    });

  for (const attempt of attemptPlan) {
    try {
      const result = await runOnce(attempt);
      const ok = result.exitCode === 0 && String(result.lastMessage || '').trim().length > 0;
      const okSession = !needsSessionIdFromSeed || Boolean(result.providerSessionId);
      if (ok && okSession) return { ...result, errors };
      errors.push({
        strategy: attempt.label,
        exitCode: result.exitCode,
        signal: result.signal,
        providerSessionId: result.providerSessionId || null,
        okSession,
      });
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
    sandbox,
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

module.exports = { runClaudeExec };
