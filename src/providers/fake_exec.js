const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

function nowMs() {
  return Date.now();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parsePromptLine(prompt, key) {
  const re = new RegExp(`^${key}\\s*:\\s*(.+)$`, 'm');
  const match = String(prompt || '').match(re);
  return match ? String(match[1] || '').trim() : '';
}

function parsePromptUserText(prompt) {
  const text = String(prompt || '');
  const match = text.match(/\nUSER:\n([\s\S]*)$/);
  return match ? String(match[1] || '').trim() : '';
}

function resolveDocTarget({ cwd, targetRel }) {
  const rel = String(targetRel || '').trim();
  if (!rel) throw new Error('DOC_TARGET_REL_REQUIRED');
  if (path.isAbsolute(rel)) throw new Error(`DOC_TARGET_REL_NOT_RELATIVE path=${rel}`);
  const abs = path.resolve(cwd, rel);
  const relCheck = path.relative(cwd, abs);
  if (!relCheck || relCheck.startsWith('..') || path.isAbsolute(relCheck)) {
    throw new Error(`DOC_TARGET_OUTSIDE_WORKSPACE path=${abs}`);
  }
  return { abs, rel };
}

async function sleepWithAbort(ms, abortSignal) {
  const delay = Math.max(0, ms);
  if (!abortSignal) {
    await sleep(delay);
    return { aborted: false };
  }
  if (abortSignal.aborted) return { aborted: true };

  return await new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve({ aborted: true });
    };
    const timer = setTimeout(() => {
      abortSignal.removeEventListener('abort', onAbort);
      resolve({ aborted: false });
    }, delay);
    abortSignal.addEventListener('abort', onAbort, { once: true });
  });
}

async function runFakeExec({
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
  const stderrPath = path.join(outDir, 'stderr.log');
  const lastMessagePath = path.join(outDir, 'last_message.txt');

  let aborted = false;
  if (abortSignal?.aborted) aborted = true;

  let lastMessage = '';
  const p = String(prompt || '');
  const delayMsRaw = Number(providerConfig?.delayMs);
  const delayMs = Number.isFinite(delayMsRaw) ? delayMsRaw : 10;
  const dangerousExecLog = Boolean(providerConfig?.dangerousExecLog);
  const loopManagerPacket = Boolean(providerConfig?.loopManagerPacket);
  const wantResume = String(providerConfig?.mode || '').toLowerCase() === 'stateful_resume';
  const resumeId = providerConfig?.resume ? String(providerConfig.resume) : null;
  const usedResume = wantResume && Boolean(resumeId);
  const providerSessionId = wantResume ? (resumeId || `fake-${randomUUID()}`) : null;

  if (p.includes('DOC_MODE: true')) {
    const targetRel = parsePromptLine(p, 'TARGET_FILE_REL');
    if (sandbox !== 'workspace-write') {
      throw new Error(`DOC_WRITE_FORBIDDEN sandbox=${sandbox}`);
    }
    const { abs, rel } = resolveDocTarget({ cwd, targetRel });
    const userText = parsePromptUserText(p) || 'OK';
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const content = `# Doc Writer Output\n\n${userText}\n`;
    fs.writeFileSync(abs, content, 'utf-8');
    lastMessage = `DOC_WRITE_OK: ${rel}`;
  } else if (p.includes('ASK_MODE: true')) {
    const userLine = p.split(/\r?\n/g).slice(-1)[0] || '';
    lastMessage = `Fake ask answer: ${userLine || 'OK'}`;
  } else if (p.includes('\nMANAGER_PACKET:\n') || p.startsWith('MANAGER_PACKET:\n')) {
    lastMessage = dangerousExecLog
      ? `<EXEC_LOG>
SUMMARY: Fake executor response (dangerous)
CHANGES:
- None
COMMANDS:
- rm -rf /
RESULTS:
- tests: N/A
- build: N/A
RISKS:
- Dangerous command included intentionally for testing
QUESTIONS:
- None
</EXEC_LOG>`
      : `<EXEC_LOG>
SUMMARY: Fake executor response
CHANGES:
- None
COMMANDS:
- None
RESULTS:
- tests: N/A
- build: N/A
RISKS:
- None
QUESTIONS:
- None
</EXEC_LOG>`;
  } else if (loopManagerPacket && p.includes('\nLAST_MANAGER_PACKET:\n')) {
    const turnIdx = (String(p).match(/\nTURN_IDX:\s*([0-9]+)\s*\n/) || [])[1] || '?';
    lastMessage = `<MANAGER_PACKET>
GOAL: Loop test turn ${turnIdx}
DIAGNOSIS: Fake provider loop manager packet (for NO_PROGRESS testing).
INSTRUCTIONS:
1) Output one well-formed <EXEC_LOG> with CHANGES/COMMANDS set to None.
ACCEPTANCE:
- Executor output contains <EXEC_LOG> and </EXEC_LOG>
SCOPE_GUARD:
- Do not run commands or change files
</MANAGER_PACKET>`;
  } else if (
    p.includes('\nLAST_EXEC_LOG:\nNone\n\nHUMAN_INJECT:\n') ||
    p.includes('\r\nLAST_EXEC_LOG:\r\nNone\r\n\r\nHUMAN_INJECT:\r\n')
  ) {
    lastMessage = `<MANAGER_PACKET>
GOAL: Produce a minimal executor log
DIAGNOSIS: This is a fake provider e2e run.
INSTRUCTIONS:
1) Output one well-formed <EXEC_LOG> with CHANGES/COMMANDS set to None.
ACCEPTANCE:
- Executor output contains <EXEC_LOG> and </EXEC_LOG>
SCOPE_GUARD:
- Do not run commands or change files
</MANAGER_PACKET>`;
  } else {
    lastMessage = 'Done';
  }

  const evt = { ts: nowMs(), fake: true, cwd, sandbox, providerSessionId, usedResume };
  fs.writeFileSync(eventsPath, JSON.stringify(evt) + '\n', 'utf-8');
  fs.writeFileSync(stderrPath, '', 'utf-8');
  fs.writeFileSync(lastMessagePath, lastMessage, 'utf-8');

  onStdoutJson?.(evt);
  const slept = await sleepWithAbort(delayMs, abortSignal);
  if (slept.aborted) aborted = true;
  if (aborted) onStderrLine?.('aborted');

  return {
    exitCode: aborted ? 1 : 0,
    signal: null,
    lastMessage,
    outDir,
    usedShell: false,
    usedResume,
    usedJson: true,
    aborted,
    pid: null,
    providerSessionId,
    paths: {
      events: eventsPath,
      stderr: stderrPath,
      lastMessage: lastMessagePath,
    },
  };
}

module.exports = { runFakeExec };
