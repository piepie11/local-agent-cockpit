const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const { getProvider } = require('../providers/provider_registry');
const { writeRunEnv } = require('../lib/run_env');
const { isInside } = require('../http/paths');
const { readTextFile } = require('../http/workspace_fs');

function nowMs() {
  return Date.now();
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(String(value ?? ''));
  } catch {
    return fallback;
  }
}

function normalizeString(value) {
  const s = String(value ?? '').trim();
  return s ? s : null;
}

function normalizeDocKind(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return null;
  if (raw === 'plan' || raw === 'convention' || raw === 'requirements') return raw;
  throw new Error(`DOC_KIND_INVALID · docKind=${raw}`);
}

function truncateText(text, maxChars) {
  const t = String(text ?? '');
  if (t.length <= maxChars) return t;
  return `${t.slice(0, maxChars)}\n...(truncated)`;
}

function notifySafe(notifier, event) {
  try {
    const p = notifier?.notify?.(event);
    if (p && typeof p.then === 'function') p.catch(() => {});
  } catch {}
}

function timestampForDir() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(
    d.getSeconds()
  )}`;
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf-8');
}

function resolveAskSystemPromptPath(configObj) {
  const raw = normalizeString(configObj?.systemPromptPath);
  if (raw) return path.resolve(raw);
  return path.join(process.cwd(), 'prompts', 'ask_system.md');
}

function resolveDocWriterSystemPromptPath() {
  return path.join(process.cwd(), 'prompts', 'doc_writer_system.md');
}

function getWorkspaceDocTarget({ workspace, docKind }) {
  const wsId = workspace?.id || '';
  const root = workspace?.rootPath;
  const kind = normalizeDocKind(docKind);
  if (!kind) throw new Error(`DOC_KIND_REQUIRED · workspaceId=${wsId}`);

  let absPath = '';
  let field = '';
  if (kind === 'plan') {
    absPath = workspace?.planPath;
    field = 'planPath';
  } else if (kind === 'convention') {
    absPath = workspace?.conventionPath;
    field = 'conventionPath';
  } else {
    absPath = workspace?.requirementsPath;
    field = 'requirementsPath';
  }

  const absValue = String(absPath || '').trim();
  if (!absValue) {
    throw new Error(`DOC_PATH_REQUIRED · workspaceId=${wsId} · docKind=${kind} · field=${field}`);
  }
  if (!root || !isInside(root, absValue)) {
    throw new Error(`DOC_PATH_OUTSIDE_WORKSPACE · workspaceId=${wsId} · docKind=${kind} · path=${absValue}`);
  }
  const rel = path.relative(root, absValue).replace(/\\/g, '/');
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`DOC_PATH_OUTSIDE_WORKSPACE · workspaceId=${wsId} · docKind=${kind} · path=${absValue}`);
  }
  return { absPath: absValue, relPath: rel, field };
}

function loadRequirementsContext(workspace) {
  const wsId = workspace?.id || '';
  const root = workspace?.rootPath;
  const absValue = String(workspace?.requirementsPath || '').trim();
  if (!absValue) {
    throw new Error(`REQUIREMENTS_PATH_REQUIRED · workspaceId=${wsId} · docKind=plan · requirementsPath=${absValue}`);
  }
  if (!root || !isInside(root, absValue)) {
    throw new Error(`PATH_OUTSIDE_WORKSPACE · workspaceId=${wsId} · docKind=plan · requirementsPath=${absValue}`);
  }
  const rel = path.relative(root, absValue).replace(/\\/g, '/');
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`PATH_OUTSIDE_WORKSPACE · workspaceId=${wsId} · docKind=plan · requirementsPath=${absValue}`);
  }
  try {
    const data = readTextFile({ rootPath: root, relFilePath: rel, includeHidden: true, maxChars: 200_000 });
    const content = String(data.content || '');
    if (!content.trim()) {
      throw new Error('REQUIREMENTS_CONTENT_EMPTY');
    }
    return { content: data.content, truncated: Boolean(data.truncated), relPath: rel, absPath: absValue };
  } catch (err) {
    throw new Error(
      `REQUIREMENTS_READ_FAILED · workspaceId=${wsId} · docKind=plan · requirementsPath=${absValue} · ${String(
        err.message || err
      )}`
    );
  }
}

function resolveConventionTemplateCandidates() {
  const candidates = [];
  const envPath = normalizeString(process.env.DOC_WRITER_CONVENTION_TEMPLATE_PATH);
  if (envPath) {
    candidates.push({ source: 'DOC_WRITER_CONVENTION_TEMPLATE_PATH', path: path.resolve(envPath) });
  }
  candidates.push({
    source: 'doc_writer_convention_template',
    path: path.join(process.cwd(), 'docs', 'templates', 'doc_writer_convention_template.md'),
  });
  candidates.push({
    source: 'workspace_约定',
    path: path.join(process.cwd(), 'docs', 'templates', 'workspace_约定.md'),
  });
  return candidates;
}

function loadConventionTemplate({ workspaceId }) {
  const tried = [];
  for (const candidate of resolveConventionTemplateCandidates()) {
    const targetPath = candidate.path;
    try {
      if (!fs.existsSync(targetPath)) {
        tried.push(`${candidate.source}=${targetPath} (missing)`);
        continue;
      }
      const content = readText(targetPath);
      if (!String(content || '').trim()) throw new Error('TEMPLATE_EMPTY');
      return { content, sourcePath: targetPath };
    } catch (err) {
      tried.push(`${candidate.source}=${targetPath} (${String(err.message || err)})`);
    }
  }
  throw new Error(`CONVENTION_TEMPLATE_LOAD_FAILED 路 workspaceId=${workspaceId} 路 tried=${tried.join(' | ')}`);
}

function buildConventionTemplateBlock({ content, sourcePath }) {
  const truncated = truncateText(content, 80_000);
  return `TEMPLATE_REFERENCE_CONVENTION:\nSOURCE: ${sourcePath}\n${truncated}`;
}

function buildDocContentRequirements(docKind) {
  if (docKind === 'requirements') {
    return 'Capture scope, user goals, constraints, assumptions, and acceptance criteria; keep items testable.';
  }
  if (docKind === 'convention') {
    return 'Define coding standards, structure, naming, and workflow practices; keep rules consistent and explicit.';
  }
  return 'Make the plan detailed and actionable: goals, milestones, tasks, risks, and validation steps.';
}

function buildDocPrefix({ docKind, targetAbs, targetRel }) {
  const contentReq = buildDocContentRequirements(docKind);
  return [
    'DOC_MODE: true',
    `DOC_KIND: ${docKind}`,
    `TARGET_FILE_ABS: ${targetAbs}`,
    `TARGET_FILE_REL: ${targetRel}`,
    'WRITE_POLICY: only edit target file',
    `CONTENT_REQUIREMENTS: ${contentReq}`,
  ].join('\n');
}

function buildAskPrompt({ systemPrompt, isSeed, userText, workspace, docPrefix, docContext }) {
  const base = `ASK_MODE: true\nWORKSPACE_ROOT: ${workspace.rootPath}\nWORKSPACE_NAME: ${workspace.name}\n`;
  const parts = [];
  if (isSeed && systemPrompt) parts.push(String(systemPrompt).trim());
  parts.push(base.trim());
  if (docPrefix) parts.push(String(docPrefix).trim());
  if (docContext) parts.push(String(docContext).trim());
  parts.push(`USER:\n${userText}\n`);
  return parts.filter(Boolean).join('\n\n');
}

function validateProvider(name) {
  const key = String(name || '').toLowerCase();
  if (!['codex', 'claude', 'fake'].includes(key)) throw new Error('PROVIDER_INVALID');
  return key;
}

function notifyAskEvent(eventsHub, payload) {
  try {
    if (!eventsHub || typeof eventsHub.broadcast !== 'function') return;
    const workspaceId = normalizeString(payload?.workspaceId);
    if (!workspaceId) return;
    eventsHub.broadcast(`ask_ws:${workspaceId}`, payload);
  } catch {}
}

const activeThreadSends = new Set();
const activeThreadAbortControllers = new Map();
const askThreadDrainChains = new Map();

function kickAskQueueDrain({ store, config, notifier, eventsHub, threadId }) {
  const id = String(threadId || '');
  if (!id) return;

  const prev = askThreadDrainChains.get(id) || Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(() => drainAskQueue({ store, config, notifier, eventsHub, threadId: id }))
    .finally(() => {
      if (askThreadDrainChains.get(id) === next) askThreadDrainChains.delete(id);
    });

  askThreadDrainChains.set(id, next);
}

function isAskThreadBusy(threadId) {
  return activeThreadSends.has(String(threadId || ''));
}

function stopAskThread(threadId) {
  const id = String(threadId || '');
  const controller = activeThreadAbortControllers.get(id);
  if (!controller) return false;
  try {
    controller.abort();
  } catch {}
  return true;
}

async function prepareAskSend({ store, config, threadId, userText }) {
  const text = String(userText ?? '').trim();
  if (!text) throw new Error('TEXT_REQUIRED');

  const thread = store.getAskThread(threadId);
  if (!thread) throw new Error('ASK_THREAD_NOT_FOUND');

  const workspace = store.getWorkspace(thread.workspaceId);
  if (!workspace) throw new Error('WORKSPACE_NOT_FOUND');

  const threadCfg = safeJsonParse(thread.configJson, {});
  const providerName = validateProvider(thread.provider || 'codex');

  const sandbox = normalizeString(threadCfg?.sandbox) || 'read-only';
  const model = normalizeString(threadCfg?.model);

  const docKind = normalizeDocKind(threadCfg?.docKind);
  const systemPromptPath = resolveAskSystemPromptPath(threadCfg);
  let systemPrompt = fs.existsSync(systemPromptPath) ? readText(systemPromptPath) : '';
  let docPrefix = '';
  let docContext = '';

  if (docKind) {
    const docPromptPath = resolveDocWriterSystemPromptPath();
    if (!fs.existsSync(docPromptPath)) {
      throw new Error(`DOC_WRITER_PROMPT_NOT_FOUND · path=${docPromptPath}`);
    }
    systemPrompt = readText(docPromptPath);

    const target = getWorkspaceDocTarget({ workspace, docKind });
    docPrefix = buildDocPrefix({ docKind, targetAbs: target.absPath, targetRel: target.relPath });

    if (docKind === 'plan') {
      const req = loadRequirementsContext(workspace);
      docContext = `REQUIREMENTS_CONTEXT:\n${req.content}`;
    }
    if (docKind === 'convention') {
      const tpl = loadConventionTemplate({ workspaceId: workspace.id });
      docContext = buildConventionTemplateBlock(tpl);
    }
  }

  const outDir = path.join(config.runsDir, 'ask', workspace.id, thread.id, `msg-${timestampForDir()}`);
  ensureDir(outDir);

  await writeRunEnv({
    outDir,
    cwd: workspace.rootPath,
    extra: { kind: 'ask', workspaceId: workspace.id, threadId: thread.id, provider: providerName },
  });

  const resumeId = normalizeString(thread.providerSessionId);
  const isSeed = !resumeId;
  const prompt = buildAskPrompt({ systemPrompt, isSeed, userText: text, workspace, docPrefix, docContext });
  fs.writeFileSync(path.join(outDir, 'prompt.txt'), prompt, 'utf-8');

  const userMsg = store.createAskMessage({
    threadId: thread.id,
    role: 'user',
    text,
    metaJson: JSON.stringify({ outDir, ts: nowMs() }),
  });

  const updatedThread = store.updateAskThread(thread.id, {
    provider: providerName,
    lastActiveAt: nowMs(),
    configJson: JSON.stringify(threadCfg || {}),
  });

  return {
    text,
    thread: updatedThread,
    workspace,
    outDir,
    prompt,
    isSeed,
    resumeId,
    providerName,
    sandbox,
    model,
    threadCfg,
    userMessage: userMsg,
  };
}

function buildAskReplyNotification({ config, context, resultOk, assistantMessage }) {
  const wsName = String(context.workspace?.name || '').trim() || context.workspace?.id || 'workspace';
  const threadTitle = String(context.thread?.title || '').trim() || context.thread?.id || 'thread';
  const error = normalizeString(assistantMessage?.meta?.error) || (resultOk ? null : 'ASK_FAILED');
  const baseUrl = String(config?.notifications?.baseUrl || '').trim();

  const kind = error === 'ASK_ABORTED' ? 'Ask 已中止' : resultOk ? 'Ask 回复完成' : 'Ask 失败';
  const titleThread = threadTitle.length > 24 ? `${threadTitle.slice(0, 24)}…` : threadTitle;
  const title = `${kind} · ${wsName}${titleThread ? ` · ${titleThread}` : ''}`;

  const lines = [];
  lines.push(`**auto_codex: ${kind}**`);
  lines.push('');
  lines.push(`- workspace: ${wsName}`);
  lines.push(`- thread: ${threadTitle} (${context.thread?.id || ''})`);
  lines.push(`- user: ${truncateText(context.text || '', 240)}`);
  if (error) lines.push(`- error: ${error}`);
  const assistantPreview = truncateText(String(assistantMessage?.text || '').trim(), 600);
  if (assistantPreview) lines.push(`- assistant:\n\n${assistantPreview}`);
  if (baseUrl) lines.push(`\n- open: ${baseUrl}`);

  return {
    type: 'ask_reply',
    title,
    content: lines.join('\n'),
    dedupeKey: `ask:${context.thread?.id || ''}:${assistantMessage?.id || ''}`,
  };
}

async function finalizeAskSend(context, { store, config, notifier, eventsHub, throwOnError, abortSignal }) {
  const provider = getProvider(context.providerName);

  const providerConfig = {
    ...(context.threadCfg || {}),
    mode: 'stateful_resume',
    ...(context.model ? { model: context.model } : {}),
    ...(context.resumeId ? { resume: context.resumeId } : {}),
    resumeOnly: true,
    jsonRequired: context.isSeed,
    requireProviderSessionId: context.isSeed,
    allowContinueFallback: false,
  };

  let result = null;
  try {
    result = await provider.run({
      prompt: context.prompt,
      cwd: context.workspace.rootPath,
      outDir: context.outDir,
      sandbox: context.sandbox,
      providerConfig,
      abortSignal,
    });
  } catch (err) {
    const metaJson = JSON.stringify({ outDir: context.outDir, error: 'ASK_PROVIDER_EXCEPTION', message: String(err.message || err) });
    const assistantMessage = store.createAskMessage({
      threadId: context.thread.id,
      role: 'assistant',
      text: '',
      metaJson,
    });
    notifyAskEvent(eventsHub, {
      kind: 'ask',
      op: 'message_assistant',
      ok: false,
      workspaceId: context.workspace.id,
      threadId: context.thread.id,
      messageId: assistantMessage.id,
      ts: nowMs(),
    });
    notifySafe(notifier, buildAskReplyNotification({ config, context, resultOk: false, assistantMessage }));
    if (throwOnError) throw new Error('ASK_PROVIDER_EXCEPTION');
    return { ok: false, thread: context.thread, userMessage: context.userMessage, assistantMessage };
  }

  if (result?.aborted) {
    const metaJson = JSON.stringify({
      outDir: context.outDir,
      sandbox: context.sandbox,
      model: context.model || null,
      providerSessionId: result?.providerSessionId || null,
      error: 'ASK_ABORTED',
    });
    const assistantMessage = store.createAskMessage({
      threadId: context.thread.id,
      role: 'assistant',
      text: '(aborted)',
      metaJson,
    });
    notifyAskEvent(eventsHub, {
      kind: 'ask',
      op: 'message_assistant',
      ok: false,
      workspaceId: context.workspace.id,
      threadId: context.thread.id,
      messageId: assistantMessage.id,
      ts: nowMs(),
    });
    notifySafe(notifier, buildAskReplyNotification({ config, context, resultOk: false, assistantMessage }));
    if (throwOnError) throw new Error('ASK_ABORTED');
    return { ok: false, thread: context.thread, userMessage: context.userMessage, assistantMessage };
  }

  const assistantText = String(result?.lastMessage || '').trim();
  if (result?.exitCode !== 0 || !assistantText) {
    const meta = {
      exitCode: result?.exitCode ?? null,
      signal: result?.signal ?? null,
      usedShell: result?.usedShell ?? false,
      usedResume: result?.usedResume ?? false,
      usedJson: result?.usedJson ?? false,
      strategy: result?.strategy ?? null,
      errors: result?.errors ?? [],
      paths: result?.paths ?? {},
      outDir: context.outDir,
      error: 'ASK_PROVIDER_FAILED',
    };
    const assistantMessage = store.createAskMessage({
      threadId: context.thread.id,
      role: 'assistant',
      text: '',
      metaJson: JSON.stringify(meta),
    });
    notifyAskEvent(eventsHub, {
      kind: 'ask',
      op: 'message_assistant',
      ok: false,
      workspaceId: context.workspace.id,
      threadId: context.thread.id,
      messageId: assistantMessage.id,
      ts: nowMs(),
    });
    notifySafe(notifier, buildAskReplyNotification({ config, context, resultOk: false, assistantMessage }));
    if (throwOnError) throw new Error('ASK_PROVIDER_FAILED');
    return { ok: false, thread: context.thread, userMessage: context.userMessage, assistantMessage };
  }

  const providerSessionId = normalizeString(result?.providerSessionId) || context.resumeId;
  if (context.isSeed && !providerSessionId) {
    const assistantMessage = store.createAskMessage({
      threadId: context.thread.id,
      role: 'assistant',
      text: assistantText,
      metaJson: JSON.stringify({ outDir: context.outDir, error: 'ASK_RESUME_ID_MISSING' }),
    });
    notifyAskEvent(eventsHub, {
      kind: 'ask',
      op: 'message_assistant',
      ok: false,
      workspaceId: context.workspace.id,
      threadId: context.thread.id,
      messageId: assistantMessage.id,
      ts: nowMs(),
    });
    notifySafe(notifier, buildAskReplyNotification({ config, context, resultOk: false, assistantMessage }));
    if (throwOnError) throw new Error('ASK_RESUME_ID_MISSING');
    return { ok: false, thread: context.thread, userMessage: context.userMessage, assistantMessage };
  }

  const meta = {
    exitCode: result.exitCode,
    signal: result.signal,
    usedShell: result.usedShell,
    usedResume: result.usedResume,
    usedJson: result.usedJson,
    strategy: result.strategy,
    providerSessionId: result.providerSessionId || null,
    sandbox: context.sandbox,
    model: context.model || null,
    errors: result.errors || [],
    paths: result.paths || {},
    outDir: context.outDir,
  };

  const assistantMessage = store.createAskMessage({
    threadId: context.thread.id,
    role: 'assistant',
    text: assistantText,
    metaJson: JSON.stringify(meta),
  });
  notifyAskEvent(eventsHub, {
    kind: 'ask',
    op: 'message_assistant',
    ok: true,
    workspaceId: context.workspace.id,
    threadId: context.thread.id,
    messageId: assistantMessage.id,
    ts: nowMs(),
  });
  notifySafe(notifier, buildAskReplyNotification({ config, context, resultOk: true, assistantMessage }));

  const thread = store.updateAskThread(context.thread.id, {
    provider: context.providerName,
    providerSessionId: providerSessionId || null,
    lastActiveAt: nowMs(),
    configJson: JSON.stringify(context.threadCfg || {}),
  });

  return { ok: true, thread, userMessage: context.userMessage, assistantMessage };
}

async function sendAskMessage({ store, config, notifier, eventsHub, threadId, userText }) {
  const id = String(threadId || '');
  if (activeThreadSends.has(id)) throw new Error('ASK_THREAD_BUSY');
  activeThreadSends.add(id);
  const abortController = new AbortController();
  activeThreadAbortControllers.set(id, abortController);
  try {
    const context = await prepareAskSend({ store, config, threadId, userText });
    notifyAskEvent(eventsHub, {
      kind: 'ask',
      op: 'message_user',
      workspaceId: context.workspace.id,
      threadId: context.thread.id,
      messageId: context.userMessage.id,
      ts: nowMs(),
    });
    const result = await finalizeAskSend(context, {
      store,
      config,
      notifier,
      eventsHub,
      throwOnError: true,
      abortSignal: abortController.signal,
    });
    return { thread: result.thread, userMessage: result.userMessage, assistantMessage: result.assistantMessage };
  } finally {
    activeThreadSends.delete(id);
    activeThreadAbortControllers.delete(id);
  }
}

async function drainAskQueue({ store, config, notifier, eventsHub, threadId }) {
  const id = String(threadId || '');
  if (!id) return;
  if (activeThreadSends.has(id)) return;

  activeThreadSends.add(id);

  try {
    while (true) {
      const item = store.claimNextAskQueueItem(id);
      if (!item) break;
      const thread = store.getAskThread(id);
      const workspaceId = thread?.workspaceId || null;
      if (workspaceId) {
        notifyAskEvent(eventsHub, {
          kind: 'ask',
          op: 'queue_running',
          workspaceId,
          threadId: id,
          queueItemId: item.id,
          ts: nowMs(),
        });
      }

      const abortController = new AbortController();
      activeThreadAbortControllers.set(id, abortController);

      try {
        const context = await prepareAskSend({ store, config, threadId: id, userText: item.text });
        notifyAskEvent(eventsHub, {
          kind: 'ask',
          op: 'message_user',
          workspaceId: context.workspace.id,
          threadId: context.thread.id,
          messageId: context.userMessage.id,
          ts: nowMs(),
        });
        const result = await finalizeAskSend(context, {
          store,
          config,
          notifier,
          eventsHub,
          throwOnError: false,
          abortSignal: abortController.signal,
        });

        if (result.ok) {
          store.deleteAskQueueItem(item.id);
          notifyAskEvent(eventsHub, {
            kind: 'ask',
            op: 'queue_done',
            workspaceId: context.workspace.id,
            threadId: context.thread.id,
            queueItemId: item.id,
            ts: nowMs(),
          });
          continue;
        }

        const code =
          normalizeString(result.assistantMessage?.meta?.error) ||
          normalizeString(result.assistantMessage?.meta?.message) ||
          'ASK_PROVIDER_FAILED';

        store.updateAskQueueItem(item.id, { status: 'error', error: code, endedAt: nowMs() });
        notifyAskEvent(eventsHub, {
          kind: 'ask',
          op: 'queue_error',
          workspaceId: context.workspace.id,
          threadId: context.thread.id,
          queueItemId: item.id,
          ts: nowMs(),
        });
      } catch (err) {
        const code = String(err?.message || 'ASK_QUEUE_ITEM_FAILED');
        store.updateAskQueueItem(item.id, { status: 'error', error: code, endedAt: nowMs() });
        const thread = store.getAskThread(id);
        const workspace = thread ? store.getWorkspace(thread.workspaceId) : null;
        if (workspace && thread) {
          notifyAskEvent(eventsHub, {
            kind: 'ask',
            op: 'queue_error',
            workspaceId: workspace.id,
            threadId: thread.id,
            queueItemId: item.id,
            ts: nowMs(),
          });
        }
      } finally {
        const current = activeThreadAbortControllers.get(id);
        if (current === abortController) activeThreadAbortControllers.delete(id);
      }
    }
  } finally {
    activeThreadSends.delete(id);
    activeThreadAbortControllers.delete(id);
  }
}

async function queueAskSend({ store, config, notifier, eventsHub, threadId, userText }) {
  const text = String(userText ?? '').trim();
  if (!text) throw new Error('TEXT_REQUIRED');

  const thread = store.getAskThread(threadId);
  if (!thread) throw new Error('ASK_THREAD_NOT_FOUND');

  const workspace = store.getWorkspace(thread.workspaceId);
  if (!workspace) throw new Error('WORKSPACE_NOT_FOUND');

  const queueItem = store.createAskQueueItem({
    threadId: thread.id,
    status: 'queued',
    text,
    metaJson: JSON.stringify({ ts: nowMs() }),
  });

  const updatedThread = store.updateAskThread(thread.id, { lastActiveAt: nowMs() });
  notifyAskEvent(eventsHub, {
    kind: 'ask',
    op: 'queue_enqueued',
    workspaceId: workspace.id,
    threadId: thread.id,
    queueItemId: queueItem.id,
    ts: nowMs(),
  });
  kickAskQueueDrain({ store, config, notifier, eventsHub, threadId: thread.id });

  return { thread: updatedThread, queueItem };
}

function exportAskThreadToMarkdown({ store, threadId }) {
  const thread = store.getAskThread(threadId);
  if (!thread) throw new Error('ASK_THREAD_NOT_FOUND');
  const workspace = store.getWorkspace(thread.workspaceId);
  if (!workspace) throw new Error('WORKSPACE_NOT_FOUND');

  const msgs = store.listAskMessages(thread.id, 2000);

  const lines = [];
  lines.push(`# Ask: ${thread.title}`);
  lines.push('');
  lines.push(`- workspace: ${workspace.name} (${workspace.rootPath})`);
  lines.push(`- provider: ${thread.provider}`);
  lines.push(`- resumeId: ${thread.providerSessionId || ''}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const m of msgs) {
    const ts = m.createdAt ? new Date(m.createdAt).toLocaleString() : '';
    lines.push(`## ${m.role}${ts ? ` @ ${ts}` : ''}`);
    lines.push('');
    lines.push(m.text || '');
    lines.push('');
  }

  const safeTitle = String(thread.title || 'ask')
    .replace(/[^\w\u4e00-\u9fa5\- ]/g, '')
    .trim()
    .slice(0, 40) || 'ask';
  const filename = `ask-${safeTitle}-${thread.id.slice(0, 8)}.md`;

  return { filename, content: lines.join('\n') + '\n' };
}

function exportAskThreadToJsonl({ store, threadId }) {
  const thread = store.getAskThread(threadId);
  if (!thread) throw new Error('ASK_THREAD_NOT_FOUND');
  const workspace = store.getWorkspace(thread.workspaceId);
  if (!workspace) throw new Error('WORKSPACE_NOT_FOUND');

  const msgs = store.listAskMessages(thread.id, 5000);
  const header = {
    kind: 'ask_thread',
    thread: {
      id: thread.id,
      title: thread.title,
      workspaceId: thread.workspaceId,
      provider: thread.provider,
      providerSessionId: thread.providerSessionId,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
      lastActiveAt: thread.lastActiveAt,
    },
    workspace: { id: workspace.id, name: workspace.name, rootPath: workspace.rootPath },
  };

  const lines = [JSON.stringify(header)];
  for (const m of msgs) {
    lines.push(
      JSON.stringify({
        kind: 'ask_message',
        id: m.id,
        threadId: m.threadId,
        role: m.role,
        text: m.text,
        meta: m.meta,
        createdAt: m.createdAt,
      })
    );
  }
  const filename = `ask-${thread.id.slice(0, 8)}.jsonl`;
  return { filename, content: lines.join('\n') + '\n' };
}

module.exports = { sendAskMessage, queueAskSend, isAskThreadBusy, stopAskThread, exportAskThreadToMarkdown, exportAskThreadToJsonl };
