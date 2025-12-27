const fs = require('fs');
const path = require('path');

const { getProvider } = require('../providers/provider_registry');
const { getRepoDigest } = require('../repo_digest');
const { writeRunEnv } = require('../lib/run_env');
const { spawnCapture } = require('../lib/spawn_capture');
const {
  buildManagerPrompt,
  buildManagerPromptResumeDelta,
  buildExecutorPrompt,
  buildExecutorPromptResumeSeed,
} = require('./prompt_builder');

function nowMs() {
  return Date.now();
}

function truncate(text, maxChars) {
  const t = String(text ?? '');
  if (t.length <= maxChars) return t;
  return `${t.slice(0, maxChars)}\n...(truncated)`;
}

function readText(p) {
  return fs.readFileSync(p, 'utf-8');
}

function readTextIfExists(p) {
  const filePath = String(p || '').trim();
  if (!filePath) return '';
  try {
    if (!fs.existsSync(filePath)) return '';
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

function readWorkspaceConvention({ workspaceRoot, conventionPath }) {
  const root = String(workspaceRoot || '').trim();
  const specified = String(conventionPath || '').trim();
  const workspaceConventionPath = specified ? path.resolve(specified) : root ? path.join(root, '约定.md') : '';

  if (workspaceConventionPath && fs.existsSync(workspaceConventionPath)) {
    return { source: 'workspace', path: workspaceConventionPath, text: readTextIfExists(workspaceConventionPath) };
  }

  const fallbackPath = path.join(process.cwd(), 'docs', 'templates', 'workspace_约定.md');
  if (fs.existsSync(fallbackPath)) {
    const fallbackText = readTextIfExists(fallbackPath);
    if (workspaceConventionPath) {
      const note = `NOTE: Workspace convention file not found at: ${workspaceConventionPath}\nUsing default convention template.\n\n`;
      return { source: 'default', path: fallbackPath, text: `${note}${fallbackText}` };
    }
    return { source: 'default', path: fallbackPath, text: fallbackText };
  }

  if (workspaceConventionPath) {
    return {
      source: 'missing',
      path: workspaceConventionPath,
      text: `NOTE: Workspace convention file not found at: ${workspaceConventionPath}\nNo default convention template available.\n`,
    };
  }

  return { source: 'none', path: '', text: '' };
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function mustBeOneOf(value, allowed, label) {
  if (!allowed.includes(value)) throw new Error(`${label}_INVALID`);
}

function parseOptions(optionsJson) {
  try {
    return JSON.parse(optionsJson || '{}');
  } catch {
    return {};
  }
}

function normalizeSessionMode(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'stateless_exec') return 'stateless_exec';
  if (v === 'stateful_resume') return 'stateful_resume';
  return 'stateful_resume';
}

class Orchestrator {
  constructor({ store, sseHub, config, notifier = null }) {
    this.store = store;
    this.sseHub = sseHub;
    this.config = config;
    this.notifier = notifier;

    this.controllers = new Map();
    this.runningWorkspace = new Map();
  }

  _notifySafe(event) {
    try {
      const p = this.notifier?.notify?.(event);
      if (p && typeof p.then === 'function') p.catch(() => {});
    } catch {}
  }

  _buildRunNotifyContent({ workspace, run, status, reason, turnIdx }) {
    const wsName = String(workspace?.name || '').trim() || workspace?.id || 'workspace';
    const wsRoot = String(workspace?.rootPath || '').trim();
    const err = String(run?.error || '').trim();
    const baseUrl = String(this.config?.notifications?.baseUrl || '').trim();

    const lines = [];
    lines.push(`**local-agent-cockpit: ${status}**`);
    lines.push('');
    lines.push(`- workspace: ${wsName}${wsRoot ? ` (${wsRoot})` : ''}`);
    lines.push(`- runId: ${run?.id || ''}`);
    if (Number.isFinite(Number(turnIdx))) lines.push(`- turn: ${turnIdx}`);
    if (reason) lines.push(`- reason: ${String(reason)}`);
    if (err && status === 'ERROR') lines.push(`- error: ${err}`);
    if (baseUrl) lines.push(`- open: ${baseUrl}`);
    return lines.join('\n');
  }

  getActiveRun(runId) {
    return this.controllers.get(runId) || null;
  }

  async start({ runId, mode }) {
    mustBeOneOf(mode, ['auto', 'step'], 'MODE');
    const existing = this.controllers.get(runId);
    if (existing) throw new Error('RUN_ALREADY_RUNNING');

    const run = this.store.getRun(runId);
    if (!run) throw new Error('RUN_NOT_FOUND');
    if (['DONE', 'STOPPED', 'ERROR'].includes(run.status)) throw new Error('RUN_FINISHED');
    if (run.status === 'RUNNING') throw new Error('RUN_ALREADY_RUNNING');
    const workspace = this.store.getWorkspace(run.workspaceId);
    if (!workspace) throw new Error('WORKSPACE_NOT_FOUND');

    if (this.runningWorkspace.has(run.workspaceId)) throw new Error('WORKSPACE_LOCKED');
    const runningCount = Array.from(this.controllers.values()).filter((c) => c.status === 'RUNNING').length;
    if (runningCount >= this.config.maxConcurrentRuns) throw new Error('MAX_CONCURRENT_RUNS_REACHED');

    const controller = {
      runId,
      workspaceId: run.workspaceId,
      status: 'RUNNING',
      mode,
      abortController: null,
      pauseRequested: false,
      pauseReason: '',
      injected: { manager: [], executor: [] },
      eventSeq: this.store.getMaxEventSeq(runId),
      lastManagerSignature: '',
      resumeConfirmed: { manager: false, executor: false },
      noProgressCount: 0,
    };

    this.controllers.set(runId, controller);
    this.runningWorkspace.set(run.workspaceId, runId);

    const startedAt = run.startedAt ?? nowMs();
    this.store.updateRunStatus(runId, 'RUNNING', { startedAt });
    await this._emit({ runId, role: null, kind: 'status', payload: { status: 'RUNNING', mode } });

    try {
      const runRoot = path.join(this.config.runsDir, workspace.id, runId);
      ensureDir(runRoot);
      await writeRunEnv({
        outDir: runRoot,
        cwd: workspace.rootPath,
        extra: { kind: 'run', runId, workspaceId: workspace.id },
      });
    } catch (err) {
      await this._emit({ runId, role: null, kind: 'meta', payload: { type: 'run_env_error', error: String(err.message || err) } });
    }

    controller.promise = this._runLoop(controller).finally(() => {
      this.controllers.delete(runId);
      if (this.runningWorkspace.get(run.workspaceId) === runId) this.runningWorkspace.delete(run.workspaceId);
    });
  }

  async pause({ runId, reason }) {
    const c = this.controllers.get(runId);
    const why = String(reason || '').trim() || 'paused';

    if (c && c.status === 'RUNNING') {
      c.pauseRequested = true;
      c.pauseReason = why;
      await this._emit({ runId, role: null, kind: 'status', payload: { status: 'PAUSE_REQUESTED', reason: why } });
      return;
    }

    if (c) c.status = 'PAUSED';
    this.store.updateRunStatus(runId, 'PAUSED', {});
    await this._emit({ runId, role: null, kind: 'status', payload: { status: 'PAUSED', reason: why } });
  }

  async stop({ runId, reason }) {
    const c = this.controllers.get(runId);
    if (c) {
      c.status = 'STOPPED';
      if (c.abortController) c.abortController.abort();
    }
    const updatedRun = this.store.updateRunStatus(runId, 'STOPPED', { endedAt: nowMs() });
    await this._emit({ runId, role: null, kind: 'status', payload: { status: 'STOPPED', reason } });

    const workspace = updatedRun ? this.store.getWorkspace(updatedRun.workspaceId) : null;
    if (updatedRun && workspace) {
      this._notifySafe({
        type: 'run_final',
        title: `Run STOPPED · ${workspace.name || workspace.id || ''}`.trim(),
        content: this._buildRunNotifyContent({
          workspace,
          run: updatedRun,
          status: 'STOPPED',
          reason: String(reason || '').trim() || null,
          turnIdx: updatedRun.turnIndex,
        }),
        dedupeKey: `run:${runId}:STOPPED`,
      });
    }
  }

  async inject({ runId, target, message }) {
    mustBeOneOf(target, ['manager', 'executor'], 'TARGET');
    const c = this.controllers.get(runId);
    if (c) c.injected[target].push(message);
    await this._emit({ runId, role: null, kind: 'meta', payload: { type: 'inject', target, message } });
  }

  async _emit({ runId, turnId = null, role, kind, payload }) {
    const c = this.controllers.get(runId);
    const seq = c ? ++c.eventSeq : this.store.getMaxEventSeq(runId) + 1;
    const evt = this.store.insertEvent({ runId, turnId, seq, role, kind, payload, ts: nowMs() });
    this.sseHub.broadcast(runId, evt);
    return evt;
  }

  async _runLoop(controller) {
    const runId = controller.runId;
    try {
      while (controller.status === 'RUNNING') {
        const run = this.store.getRun(runId);
        if (!run) throw new Error('RUN_NOT_FOUND');

        if (controller.pauseRequested) {
          controller.status = 'PAUSED';
          this.store.updateRunStatus(runId, 'PAUSED', { turnIndex: run.turnIndex });
          await this._emit({
            runId,
            role: null,
            kind: 'status',
            payload: { status: 'PAUSED', reason: controller.pauseReason || 'paused' },
          });
          break;
        }

        const options = parseOptions(run.optionsJson);

        const maxTurns = Number.isFinite(Number(options.maxTurns)) ? Number(options.maxTurns) : 1000;
        const turnTimeoutMs = Number.isFinite(Number(options.turnTimeoutMs))
          ? Number(options.turnTimeoutMs)
          : 200 * 60 * 1000;
        const repoDigestEnabled = options.repoDigestEnabled !== false;
        const requireGitClean = options.requireGitClean === true;
        const dangerousCommandGuard = options.dangerousCommandGuard === true;
        const noProgressLimit = Number.isFinite(Number(options.noProgressLimit)) ? Number(options.noProgressLimit) : 20;

        if (run.turnIndex >= maxTurns) {
          controller.status = 'ERROR';
          const updatedRun = this.store.updateRunStatus(runId, 'ERROR', { endedAt: nowMs(), error: 'MAX_TURNS' });
          await this._emit({ runId, role: null, kind: 'error', payload: { error: 'MAX_TURNS' } });
          const workspace = updatedRun ? this.store.getWorkspace(updatedRun.workspaceId) : null;
          if (updatedRun && workspace) {
            this._notifySafe({
              type: 'run_final',
              title: `Run ERROR · ${workspace.name || workspace.id || ''}`.trim(),
              content: this._buildRunNotifyContent({
                workspace,
                run: updatedRun,
                status: 'ERROR',
                reason: 'MAX_TURNS',
                turnIdx: run.turnIndex,
              }),
              dedupeKey: `run:${runId}:ERROR`,
            });
          }
          break;
        }

        const idx = run.turnIndex + 1;
        const turn = this.store.createTurn({ runId, idx, startedAt: nowMs() });

        await this._emit({ runId, turnId: turn.id, role: null, kind: 'status', payload: { status: 'TURN_START', idx } });

        const workspace = this.store.getWorkspace(run.workspaceId);
        const managerSession = this.store.getSession(run.managerSessionId);
        const executorSession = this.store.getSession(run.executorSessionId);
        if (!workspace || !managerSession || !executorSession) throw new Error('RUN_REFERENCES_MISSING');

        const prevTurn = idx > 1 ? this.store.getTurnByIdx(runId, idx - 1) : null;
        const lastExecLog = prevTurn?.executorOutput || '';
        const lastManagerPacket = prevTurn?.managerOutput || '';

        const managerConfig = safeSessionConfig(managerSession);
        const executorConfig = safeSessionConfig(executorSession);

        const managerMode = normalizeSessionMode(managerConfig?.mode);
        const executorMode = normalizeSessionMode(executorConfig?.mode);
        const managerSeed = managerMode === 'stateful_resume' && !managerSession.providerSessionId;
        const executorSeed = executorMode === 'stateful_resume' && !executorSession.providerSessionId;
        const managerIncludePlanEveryTurn = Boolean(managerConfig?.includePlanEveryTurn);

        const planText = readText(workspace.planPath);
        const convention = readWorkspaceConvention({ workspaceRoot: workspace.rootPath, conventionPath: workspace.conventionPath });
        const managerRolloverSummary =
          readTextIfExists(managerConfig?.rolloverSummaryPath) || String(managerConfig?.rolloverSummary || '').trim();
        const executorRolloverSummary =
          readTextIfExists(executorConfig?.rolloverSummaryPath) || String(executorConfig?.rolloverSummary || '').trim();
        const managerRolloverSeed = managerSeed && Boolean(managerRolloverSummary);
        const executorRolloverSeed = executorSeed && Boolean(executorRolloverSummary);

        let repoDigestFull = '';
        let repoDigestDelta = '';
        if (repoDigestEnabled) {
          const needFull =
            managerMode === 'stateless_exec' || (managerSeed && !managerRolloverSeed) || (executorSeed && !executorRolloverSeed);
          const needDelta = !needFull && managerMode === 'stateful_resume';
          if (needFull) repoDigestFull = await getRepoDigest(workspace.rootPath, {});
          else if (needDelta) repoDigestDelta = await getRepoDigest(workspace.rootPath, { includeTree: false });
        }
        const repoDigestForFullPrompt = repoDigestFull || repoDigestDelta;

        const managerSystemPath =
          managerConfig?.systemPromptPath ||
          path.join(process.cwd(), 'prompts', 'manager_system.md');
        const executorSystemPath =
          executorConfig?.systemPromptPath ||
          path.join(process.cwd(), 'prompts', 'executor_system.md');

        const managerSystem = readText(managerSystemPath);
        const executorSystem = readText(executorSystemPath);
        const managerProvider = getProvider(managerSession.provider);
        const executorProvider = getProvider(executorSession.provider);

        const managerOutDir = path.join(this.config.runsDir, workspace.id, runId, `turn-${String(idx).padStart(3, '0')}`, 'manager');
        ensureDir(managerOutDir);

        const managerInjected = controller.injected.manager.splice(0);
        const managerCanUseDelta =
          managerMode === 'stateful_resume' &&
          !managerSeed &&
          !managerIncludePlanEveryTurn &&
          Boolean(controller.resumeConfirmed?.manager);
        const managerPrompt =
          managerCanUseDelta
            ? buildManagerPromptResumeDelta({
                system: managerSystem,
                turnIdx: idx,
                repoDigestDelta: truncate(repoDigestDelta, 20_000),
                lastManagerPacket: truncate(lastManagerPacket, 30_000),
                lastExecLog: truncate(lastExecLog, 30_000),
                injected: managerInjected,
              })
            : buildManagerPrompt({
                system: managerSystem,
                turnIdx: idx,
                planText: truncate(managerRolloverSeed ? managerRolloverSummary : planText, 120_000),
                conventionText: truncate(convention?.text || '', 80_000),
                conventionPath: convention?.path || '',
                conventionSource: convention?.source || 'none',
                repoDigest: truncate(repoDigestForFullPrompt, 60_000),
                lastManagerPacket: truncate(lastManagerPacket, 30_000),
                lastExecLog: truncate(lastExecLog, 30_000),
                injected: managerInjected,
              });
        fs.writeFileSync(path.join(managerOutDir, 'prompt.txt'), managerPrompt, 'utf-8');

        await this._emit({
          runId,
          turnId: turn.id,
          role: 'manager',
          kind: 'prompt',
          payload: { idx, preview: truncate(managerPrompt, 2000) },
        });

        const managerSandbox = managerConfig?.sandbox || 'read-only';
        const managerProviderCfg = { ...managerConfig, mode: managerMode };
        if (managerMode === 'stateful_resume' && managerSession.providerSessionId) {
          managerProviderCfg.resume = managerSession.providerSessionId;
        } else {
          delete managerProviderCfg.resume;
        }
        controller.abortController = new AbortController();
        controller.activeRole = 'manager';

        const managerResult = await runWithTimeout(
          () =>
            managerProvider.run({
              prompt: managerPrompt,
              cwd: workspace.rootPath,
              outDir: managerOutDir,
              sandbox: managerSandbox,
              providerConfig: managerProviderCfg,
              abortSignal: controller.abortController.signal,
              onStdoutJson: (obj) => this._emit({ runId, turnId: turn.id, role: 'manager', kind: 'partial', payload: obj }),
              onStderrLine: (line) =>
                this._emit({ runId, turnId: turn.id, role: 'manager', kind: 'stderr', payload: { line } }),
            }),
          turnTimeoutMs,
          controller.abortController
        );

        controller.abortController = null;
        controller.activeRole = null;

        const managerOutputRaw = managerResult.lastMessage.trim();
        const normalizedManagerOutput = normalizeManagerOutput(managerOutputRaw);
        const managerOutput = normalizedManagerOutput.text;
        await this._emit({
          runId,
          turnId: turn.id,
          role: 'manager',
          kind: 'final',
          payload: { text: managerOutput, coerced: normalizedManagerOutput.coerced, kind: normalizedManagerOutput.kind },
        });
        if (managerResult.usedResume) controller.resumeConfirmed.manager = true;

        const managerMeta = {
          exitCode: managerResult.exitCode,
          signal: managerResult.signal,
          usedShell: managerResult.usedShell,
          strategy: managerResult.strategy,
          usedResume: managerResult.usedResume,
          usedJson: managerResult.usedJson,
          aborted: managerResult.aborted,
          sandbox: managerSandbox,
          providerSessionId: managerResult.providerSessionId || null,
          providerMode: managerMode,
          model: managerProviderCfg.model || null,
          errors: managerResult.errors || [],
          paths: managerResult.paths,
          outputCoercion: normalizedManagerOutput.coerced ? { kind: normalizedManagerOutput.kind } : null,
        };

        this.store.updateTurn(turn.id, {
          managerPromptPath: path.join(managerOutDir, 'prompt.txt'),
          managerOutput: truncate(managerOutput, 80_000),
          managerMetaJson: JSON.stringify(managerMeta),
        });

        if (managerResult.providerSessionId && managerResult.providerSessionId !== managerSession.providerSessionId) {
          this.store.updateSessionProviderSessionId(managerSession.id, managerResult.providerSessionId);
        } else {
          this.store.touchSession(managerSession.id);
        }

        if (controller.status !== 'RUNNING') {
          await this._emit({
            runId,
            turnId: turn.id,
            role: null,
            kind: 'status',
            payload: { status: 'TURN_ABORTED', idx, at: 'manager' },
          });
          break;
        }

        if (managerOutput === 'Done') {
          controller.status = 'DONE';
          const updatedRun = this.store.updateRunStatus(runId, 'DONE', { endedAt: nowMs(), turnIndex: idx });
          this.store.updateTurn(turn.id, { endedAt: nowMs() });
          await this._emit({ runId, turnId: turn.id, role: null, kind: 'status', payload: { status: 'DONE', idx } });

          const workspaceForNotify = updatedRun ? this.store.getWorkspace(updatedRun.workspaceId) : null;
          if (updatedRun && workspaceForNotify) {
            this._notifySafe({
              type: 'run_final',
              title: `Run DONE · ${workspaceForNotify.name || workspaceForNotify.id || ''}`.trim(),
              content: this._buildRunNotifyContent({
                workspace: workspaceForNotify,
                run: updatedRun,
                status: 'DONE',
                reason: null,
                turnIdx: idx,
              }),
              dedupeKey: `run:${runId}:DONE`,
            });
          }
          break;
        }

        controller.lastManagerSignature = managerOutput.replace(/\s+/g, ' ').trim();

        if (!managerOutput.includes('<MANAGER_PACKET>') || !managerOutput.includes('</MANAGER_PACKET>')) {
          controller.status = 'PAUSED';
          this.store.updateRunStatus(runId, 'PAUSED', { turnIndex: idx, error: 'MANAGER_OUTPUT_INVALID' });
          await this._emit({
            runId,
            turnId: turn.id,
            role: null,
            kind: 'error',
            payload: { error: 'MANAGER_OUTPUT_INVALID' },
          });
          break;
        }

        const executorOutDir = path.join(
          this.config.runsDir,
          workspace.id,
          runId,
          `turn-${String(idx).padStart(3, '0')}`,
          'executor'
        );
        ensureDir(executorOutDir);

        const executorInjected = controller.injected.executor.splice(0);
        const executorPrompt =
          executorMode === 'stateful_resume' && executorSeed
            ? buildExecutorPromptResumeSeed({
                system: executorSystem,
                turnIdx: idx,
                planText: truncate(executorRolloverSeed ? executorRolloverSummary : planText, 120_000),
                conventionText: truncate(convention?.text || '', 80_000),
                conventionPath: convention?.path || '',
                conventionSource: convention?.source || 'none',
                repoDigest: truncate(repoDigestForFullPrompt, 60_000),
                managerPacket: managerOutput,
                injected: executorInjected,
              })
            : buildExecutorPrompt({
                system: executorSystem,
                turnIdx: idx,
                managerPacket: managerOutput,
                injected: executorInjected,
              });
        fs.writeFileSync(path.join(executorOutDir, 'prompt.txt'), executorPrompt, 'utf-8');

        await this._emit({
          runId,
          turnId: turn.id,
          role: 'executor',
          kind: 'prompt',
          payload: { idx, preview: truncate(executorPrompt, 2000) },
        });

        const executorSandbox = executorConfig?.sandbox || 'workspace-write';
        const executorProviderCfg = { ...executorConfig, mode: executorMode };
        if (executorMode === 'stateful_resume' && executorSession.providerSessionId) {
          executorProviderCfg.resume = executorSession.providerSessionId;
        } else {
          delete executorProviderCfg.resume;
        }
        controller.abortController = new AbortController();
        controller.activeRole = 'executor';

        const executorResult = await runWithTimeout(
          () =>
            executorProvider.run({
              prompt: executorPrompt,
              cwd: workspace.rootPath,
              outDir: executorOutDir,
              sandbox: executorSandbox,
              providerConfig: executorProviderCfg,
              abortSignal: controller.abortController.signal,
              onStdoutJson: (obj) => this._emit({ runId, turnId: turn.id, role: 'executor', kind: 'partial', payload: obj }),
              onStderrLine: (line) =>
                this._emit({ runId, turnId: turn.id, role: 'executor', kind: 'stderr', payload: { line } }),
            }),
          turnTimeoutMs,
          controller.abortController
        );

        controller.abortController = null;
        controller.activeRole = null;

        const executorOutput = executorResult.lastMessage.trim();
        await this._emit({ runId, turnId: turn.id, role: 'executor', kind: 'final', payload: { text: executorOutput } });
        if (executorResult.usedResume) controller.resumeConfirmed.executor = true;

        const executorMeta = {
          exitCode: executorResult.exitCode,
          signal: executorResult.signal,
          usedShell: executorResult.usedShell,
          strategy: executorResult.strategy,
          usedResume: executorResult.usedResume,
          usedJson: executorResult.usedJson,
          aborted: executorResult.aborted,
          sandbox: executorSandbox,
          providerSessionId: executorResult.providerSessionId || null,
          providerMode: executorMode,
          model: executorProviderCfg.model || null,
          errors: executorResult.errors || [],
          paths: executorResult.paths,
        };

        this.store.updateTurn(turn.id, {
          executorPromptPath: path.join(executorOutDir, 'prompt.txt'),
          executorOutput: truncate(executorOutput, 120_000),
          executorMetaJson: JSON.stringify(executorMeta),
          endedAt: nowMs(),
        });

        if (executorResult.providerSessionId && executorResult.providerSessionId !== executorSession.providerSessionId) {
          this.store.updateSessionProviderSessionId(executorSession.id, executorResult.providerSessionId);
        } else {
          this.store.touchSession(executorSession.id);
        }

        if (controller.status !== 'RUNNING') {
          await this._emit({
            runId,
            turnId: turn.id,
            role: null,
            kind: 'status',
            payload: { status: 'TURN_ABORTED', idx, at: 'executor' },
          });
          break;
        }

        const nextIdx = idx;
        this.store.updateRunStatus(runId, controller.status === 'RUNNING' ? 'RUNNING' : controller.status, {
          turnIndex: nextIdx,
        });

        if (!executorOutput.includes('<EXEC_LOG>') || !executorOutput.includes('</EXEC_LOG>')) {
          controller.status = 'PAUSED';
          this.store.updateRunStatus(runId, 'PAUSED', { turnIndex: nextIdx, error: 'EXECUTOR_OUTPUT_INVALID' });
          await this._emit({
            runId,
            turnId: turn.id,
            role: null,
            kind: 'error',
            payload: { error: 'EXECUTOR_OUTPUT_INVALID' },
          });
          break;
        }

        const execLog = parseExecLog(executorOutput);
        if (dangerousCommandGuard && execLog) {
          const hit = detectDangerousCommand(execLog.commandsRaw);
          if (hit) {
            controller.status = 'PAUSED';
            this.store.updateRunStatus(runId, 'PAUSED', { turnIndex: nextIdx, error: 'DANGEROUS_COMMAND' });
            await this._emit({
              runId,
              turnId: turn.id,
              role: null,
              kind: 'error',
              payload: { error: 'DANGEROUS_COMMAND', pattern: hit.id, command: hit.command },
            });
            break;
          }
        }

        if (requireGitClean) {
          const git = await spawnCapture('git', ['-C', workspace.rootPath, 'status', '--porcelain'], {
            timeoutMs: 15_000,
          });
          const summary = (git.stdout || '').trim();
          if (git.exitCode !== 0) {
            controller.status = 'PAUSED';
            this.store.updateRunStatus(runId, 'PAUSED', { turnIndex: idx, error: 'GIT_STATUS_FAILED' });
            await this._emit({
              runId,
              turnId: turn.id,
              role: null,
              kind: 'error',
              payload: { error: 'GIT_STATUS_FAILED', stderr: (git.stderr || '').slice(0, 400) },
            });
            break;
          }
          if (summary) {
            controller.status = 'PAUSED';
            this.store.updateRunStatus(runId, 'PAUSED', { turnIndex: idx, error: 'GIT_DIRTY' });
            await this._emit({
              runId,
              turnId: turn.id,
              role: null,
              kind: 'error',
              payload: { error: 'GIT_DIRTY', status: summary.slice(0, 1200) },
            });
            break;
          }
        }

        if (noProgressLimit > 0) {
          const changesEmpty = execLog ? execLog.changesEmpty : false;
          const managerSame = controller.lastManagerSignature === controller.prevManagerSignature;
          controller.prevManagerSignature = controller.lastManagerSignature;

          if (changesEmpty && managerSame) controller.noProgressCount += 1;
          else controller.noProgressCount = 0;

          if (controller.noProgressCount >= noProgressLimit) {
            controller.status = 'PAUSED';
            this.store.updateRunStatus(runId, 'PAUSED', { turnIndex: nextIdx, error: 'NO_PROGRESS' });
            await this._emit({
              runId,
              turnId: turn.id,
              role: null,
              kind: 'error',
              payload: { error: 'NO_PROGRESS', turns: controller.noProgressCount, limit: noProgressLimit },
            });
            break;
          }
        }

        await this._emit({ runId, turnId: turn.id, role: null, kind: 'status', payload: { status: 'TURN_END', idx } });

        if (controller.mode === 'step') {
          controller.status = 'PAUSED';
          const updatedRun = this.store.updateRunStatus(runId, 'PAUSED', { turnIndex: nextIdx });
          await this._emit({ runId, role: null, kind: 'status', payload: { status: 'PAUSED', reason: 'step-complete' } });

          const workspace = updatedRun ? this.store.getWorkspace(updatedRun.workspaceId) : null;
          if (updatedRun && workspace) {
            this._notifySafe({
              type: 'run_step',
              title: `Run STEP · ${workspace.name || workspace.id || ''}`.trim(),
              content: this._buildRunNotifyContent({
                workspace,
                run: updatedRun,
                status: 'STEP_COMPLETE',
                reason: null,
                turnIdx: nextIdx,
              }),
              dedupeKey: `run:${runId}:step:${nextIdx}`,
            });
          }
          break;
        }
      }
    } catch (err) {
      controller.status = 'ERROR';
      const updatedRun = this.store.updateRunStatus(runId, 'ERROR', { endedAt: nowMs(), error: String(err.message || err) });
      await this._emit({ runId, role: null, kind: 'error', payload: { error: String(err.message || err) } });

      const workspace = updatedRun ? this.store.getWorkspace(updatedRun.workspaceId) : null;
      if (updatedRun && workspace) {
        this._notifySafe({
          type: 'run_final',
          title: `Run ERROR · ${workspace.name || workspace.id || ''}`.trim(),
          content: this._buildRunNotifyContent({
            workspace,
            run: updatedRun,
            status: 'ERROR',
            reason: null,
            turnIdx: updatedRun.turnIndex,
          }),
          dedupeKey: `run:${runId}:ERROR`,
        });
      }
    }
  }
}

function safeSessionConfig(session) {
  try {
    return JSON.parse(session.configJson || '{}');
  } catch {
    return {};
  }
}

function normalizeManagerOutput(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return { kind: 'unknown', coerced: false, text: raw };

  const packet = raw.match(/<MANAGER_PACKET>[\s\S]*?<\/MANAGER_PACKET>/);
  if (packet) {
    const normalized = packet[0].trim();
    return { kind: 'manager_packet', coerced: normalized !== raw, text: normalized };
  }

  const lines = raw.split(/\r?\n/g);
  let idx = lines.length - 1;
  while (idx >= 0 && !String(lines[idx] ?? '').trim()) idx -= 1;
  const last = idx >= 0 ? String(lines[idx] ?? '').trim() : '';
  if (last === 'Done') return { kind: 'done_line', coerced: raw !== 'Done', text: 'Done' };

  return { kind: 'unknown', coerced: false, text: raw };
}

function parseExecLog(text) {
  const blockMatch = String(text || '').match(/<EXEC_LOG>[\s\S]*?<\/EXEC_LOG>/);
  if (!blockMatch) return null;

  const block = blockMatch[0];
  const changesMatch = block.match(/\nCHANGES:\s*\n([\s\S]*?)\nCOMMANDS:\s*\n/i);
  const rawChanges = (changesMatch?.[1] || '').trim();
  const normalized = rawChanges.replace(/\r/g, '').trim();
  const changesEmpty =
    !normalized ||
    normalized === 'None' ||
    normalized === '- None' ||
    normalized === '(None)' ||
    normalized.split('\n').every((l) => l.trim() === '' || l.trim().toLowerCase() === 'none');

  const commandsMatch = block.match(/\nCOMMANDS:\s*\n([\s\S]*?)\nRESULTS:\s*\n/i);
  const commandsRaw = (commandsMatch?.[1] || '').trim();

  return { rawChanges, changesEmpty, commandsRaw };
}

function detectDangerousCommand(commandsRaw) {
  const text = String(commandsRaw || '');
  if (!text.trim()) return null;

  const lines = text
    .split(/\r?\n/g)
    .map((l) => l.trim())
    .filter((l) => l && l.toLowerCase() !== 'none')
    .slice(0, 80);

  const patterns = [
    { id: 'rm-rf', re: /\brm\s+-rf\b/i },
    { id: 'rm-fr', re: /\brm\s+-fr\b/i },
    { id: 'del-s', re: /\bdel\b[^\n]*\s\/s\b/i },
    { id: 'rd-s', re: /\brd\b[^\n]*\s\/s\b/i },
    { id: 'rmdir-s', re: /\brmdir\b[^\n]*\s\/s\b/i },
    { id: 'remove-item-rf', re: /\bremove-item\b[^\n]*-recurse\b[^\n]*-force\b/i },
    { id: 'diskpart', re: /\bdiskpart\b/i },
    { id: 'mkfs', re: /\bmkfs(\.|-)?/i },
    { id: 'format', re: /\bformat(?:\.com)?\b/i },
  ];

  for (const line of lines) {
    for (const p of patterns) {
      if (p.re.test(line)) return { id: p.id, command: line };
    }
  }
  return null;
}

async function runWithTimeout(fn, timeoutMs, abortController) {
  let timer;
  try {
    return await Promise.race([
      fn(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          try {
            abortController?.abort();
          } catch {}
          reject(new Error('TURN_TIMEOUT'));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { Orchestrator };
