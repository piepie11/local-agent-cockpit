function q(sel) {
  return document.querySelector(sel);
}

function qa(sel) {
  return Array.from(document.querySelectorAll(sel));
}

function mustGetEl(sel) {
  const el = q(sel);
  if (!el) throw new Error(`MISSING_ELEMENT: ${sel}`);
  return el;
}

function eventTargetElement(target) {
  const t = target;
  if (!t) return null;
  if (t.nodeType === 1) return t; // Element
  if (t.nodeType === 3) return t.parentElement; // Text
  return null;
}

function readSseLinesToEvent(lines) {
  const evt = { id: null, event: null, data: '' };
  const dataLines = [];

  for (const raw of lines) {
    const line = String(raw ?? '');
    if (!line) continue;
    if (line.startsWith(':')) continue;
    if (line.startsWith('id:')) evt.id = line.slice(3).trim();
    if (line.startsWith('event:')) evt.event = line.slice(6).trim();
    if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
  }

  evt.data = dataLines.join('\n');
  return evt;
}

function openSseStreamViaFetch(url, { headers, onEvent, onError, onStatus } = {}) {
  const targetUrl = String(url || '').trim();
  if (!targetUrl) throw new Error('SSE_URL_REQUIRED');

  let closed = false;
  let reconnectTimer = null;
  let controller = null;
  let attempt = 0;

  function emitStatus(status) {
    try {
      onStatus?.(status);
    } catch {}
  }

  async function readStream(body) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    while (!closed) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      buf = buf.replaceAll('\r', '');

      while (true) {
        const sep = buf.indexOf('\n\n');
        if (sep === -1) break;
        const block = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        const lines = block.split('\n');
        const evt = readSseLinesToEvent(lines);
        if (!evt.event && !evt.data) continue;
        try {
          onEvent?.(evt);
        } catch {}
      }
    }
  }

  function scheduleReconnect(delayMs) {
    if (closed) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => connect().catch(() => {}), delayMs);
  }

  async function connect() {
    if (closed) return;
    attempt += 1;
    emitStatus({ state: 'connecting', attempt });

    controller = new AbortController();
    let res;
    try {
      res = await fetch(targetUrl, {
        method: 'GET',
        headers: { Accept: 'text/event-stream', ...(headers || {}) },
        signal: controller.signal,
      });
    } catch (err) {
      emitStatus({ state: 'error', attempt, error: String(err?.message || err) });
      scheduleReconnect(Math.min(6000, 800 + attempt * 500));
      return;
    }

    if (!res.ok) {
      const status = res.status;
      emitStatus({ state: 'error', attempt, error: `HTTP ${status}` });
      // Auth errors: stop retrying until the user updates token/refreshes.
      if (status === 401 || status === 403) return;
      scheduleReconnect(Math.min(8000, 1200 + attempt * 600));
      return;
    }

    attempt = 0;
    emitStatus({ state: 'connected' });

    try {
      await readStream(res.body);
    } catch (err) {
      if (closed) return;
      emitStatus({ state: 'error', attempt, error: String(err?.message || err) });
    }

    if (!closed) scheduleReconnect(1500);
  }

  connect().catch((err) => {
    emitStatus({ state: 'error', attempt, error: String(err?.message || err) });
  });

  return {
    close() {
      closed = true;
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
      try {
        controller?.abort();
      } catch {}
      controller = null;
    },
  };
}

function formatTs(ms) {
  if (!ms) return '-';
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return String(ms);
  }
}

function isNearBottom(el, thresholdPx = 80) {
  if (!el) return true;
  const threshold = Number.isFinite(Number(thresholdPx)) ? Number(thresholdPx) : 80;
  const remaining = el.scrollHeight - el.clientHeight - el.scrollTop;
  return remaining <= threshold;
}

function getAdminToken() {
  return localStorage.getItem('adminToken') || '';
}

function setAdminToken(token) {
  localStorage.setItem('adminToken', token);
}

function authHeaders() {
  const token = getAdminToken();
  return token ? { 'x-admin-token': token } : {};
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(body?.error || res.statusText);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

const UI_LANG_KEY = 'uiLang';
const WORKSPACE_ID_KEY = 'workspaceId';
const WORKSPACE_MRU_KEY = 'workspaceMru';
const WORKSPACE_MRU_MAX = 40;
const ASK_THREADS_COLLAPSED_KEY = 'askThreadsCollapsed';
const ASK_CONFIG_COLLAPSED_KEY = 'askConfigCollapsed';
const ASK_RENDER_MD_KEY = 'askRenderMd';
const HISTORY_LIST_COLLAPSED_KEY = 'historyListCollapsed';
const HISTORY_RENDER_MD_KEY = 'historyRenderMd';
const ONBOARDING_HIDE_KEY = 'ui.hideOnboardingEmptyWorkspace';

function parseStoredBool(value, fallback) {
  if (value === undefined || value === null) return fallback;
  const v = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(v)) return false;
  return fallback;
}

function getStoredBool(key, fallback) {
  try {
    return parseStoredBool(localStorage.getItem(key), fallback);
  } catch {
    return fallback;
  }
}

function setStoredBool(key, value) {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {}
}

function loadAskLayoutPrefs() {
  state.askThreadsCollapsed = getStoredBool(ASK_THREADS_COLLAPSED_KEY, false);
  state.askConfigCollapsed = getStoredBool(ASK_CONFIG_COLLAPSED_KEY, false);
  state.askRenderMarkdown = getStoredBool(ASK_RENDER_MD_KEY, false);
}

function persistAskLayoutPrefs() {
  setStoredBool(ASK_THREADS_COLLAPSED_KEY, Boolean(state.askThreadsCollapsed));
  setStoredBool(ASK_CONFIG_COLLAPSED_KEY, Boolean(state.askConfigCollapsed));
}

function loadHistoryLayoutPrefs() {
  state.historyListCollapsed = getStoredBool(HISTORY_LIST_COLLAPSED_KEY, false);
  state.historyRenderMarkdown = getStoredBool(HISTORY_RENDER_MD_KEY, false);
}

function persistHistoryLayoutPrefs() {
  setStoredBool(HISTORY_LIST_COLLAPSED_KEY, Boolean(state.historyListCollapsed));
}

function normalizeLang(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'en') return 'en';
  return 'zh';
}

function getUiLang() {
  try {
    return normalizeLang(localStorage.getItem(UI_LANG_KEY));
  } catch {
    return 'zh';
  }
}

function setUiLang(lang) {
  try {
    localStorage.setItem(UI_LANG_KEY, normalizeLang(lang));
  } catch {}
}

function getStoredWorkspaceId() {
  try {
    const v = localStorage.getItem(WORKSPACE_ID_KEY);
    return v ? String(v).trim() : null;
  } catch {
    return null;
  }
}

function setStoredWorkspaceId(workspaceId) {
  try {
    const v = String(workspaceId || '').trim();
    if (!v) localStorage.removeItem(WORKSPACE_ID_KEY);
    else localStorage.setItem(WORKSPACE_ID_KEY, v);
  } catch {}
}

function getStoredWorkspaceMruIds() {
  try {
    const raw = localStorage.getItem(WORKSPACE_MRU_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const items = Array.isArray(parsed) ? parsed : [];
    const out = [];
    for (const it of items) {
      const id = String(it || '').trim();
      if (!id) continue;
      if (out.includes(id)) continue;
      out.push(id);
      if (out.length >= WORKSPACE_MRU_MAX) break;
    }
    return out;
  } catch {
    return [];
  }
}

function setStoredWorkspaceMruIds(ids) {
  try {
    const list = Array.isArray(ids) ? ids : [];
    localStorage.setItem(WORKSPACE_MRU_KEY, JSON.stringify(list));
  } catch {}
}

function bumpWorkspaceMru(workspaceId) {
  const id = String(workspaceId || '').trim();
  if (!id) return;
  const current = getStoredWorkspaceMruIds();
  if (current[0] === id) return;
  const next = [id, ...current.filter((x) => x !== id)].slice(0, WORKSPACE_MRU_MAX);
  setStoredWorkspaceMruIds(next);
}

function orderWorkspacesByMru(workspaces, mruIds) {
  const items = Array.isArray(workspaces) ? workspaces : [];
  const ids = Array.isArray(mruIds) ? mruIds : [];

  const rank = new Map();
  let r = 0;
  for (const id0 of ids) {
    const id = String(id0 || '').trim();
    if (!id) continue;
    if (rank.has(id)) continue;
    rank.set(id, r);
    r += 1;
  }

  return items
    .map((ws, idx) => ({ ws, idx }))
    .sort((a, b) => {
      const aId = String(a.ws?.id || '').trim();
      const bId = String(b.ws?.id || '').trim();
      const ai = rank.has(aId) ? rank.get(aId) : Number.POSITIVE_INFINITY;
      const bi = rank.has(bId) ? rank.get(bId) : Number.POSITIVE_INFINITY;
      if (ai !== bi) return ai - bi;
      return a.idx - b.idx;
    })
    .map((x) => x.ws);
}

function syncWorkspaceIdToUrl(workspaceId) {
  try {
    const url = new URL(window.location.href);
    const v = String(workspaceId || '').trim();
    if (!v) url.searchParams.delete('ws');
    else url.searchParams.set('ws', v);
    window.history.replaceState({}, '', url.toString());
  } catch {}
}

function formatTemplate(text, vars) {
  const s = String(text ?? '');
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (_, key) => {
    const v = vars[key];
    return v === undefined || v === null ? `{${key}}` : String(v);
  });
}

const I18N = {
  zh: {
    'top.workspace_select_title': '工作区',
    'top.add_workspace_title': '添加工作区',
    'top.add': '新增',
    'top.ask': 'Codex 用户窗口',
    'top.ask_title': '打开 Codex 用户窗口（新窗口）',
    'top.admin_token_label': '口令（ADMIN_TOKEN）',
    'top.admin_token_placeholder': '写操作必填',
    'top.lang_toggle': 'EN',
    'top.lang_toggle_title': '切换语言（中文/English）',

    'nav.dashboard': '控制台',
    'nav.history': '历史',
    'nav.sessions': '会话',
    'nav.ask': 'Codex 用户窗口',
    'nav.files': '文件',
    'nav.settings': '设置',

    'workspace_modal.title': '新建工作区',
    'workspace_modal.name_label': '名称（可选）',
    'workspace_modal.name_placeholder': '名称（可选）',
    'workspace_modal.root_label': 'rootPath（必填）',
    'workspace_modal.root_placeholder': 'rootPath（绝对路径）',
    'workspace_modal.plan_label': 'planPath（默认 plan.md）',
    'workspace_modal.plan_placeholder': 'plan.md',
    'workspace_modal.convention_label': 'conventionPath（默认 约定.md）',
    'workspace_modal.convention_placeholder': '约定.md',
    'workspace_modal.allowed_title': '允许的 rootPath（来自 /api/health）',
    'workspace_modal.allowed_hint': 'rootPath 必须位于允许列表内，否则会 PATH_NOT_ALLOWED。',
    'workspace_modal.create': '创建',
    'workspace_modal.title_edit': '编辑工作区',
    'workspace_modal.save': '保存',
    'doc_modal.title_plan': '加载计划',
    'doc_modal.title_convention': '加载约定',

    'onboarding.title': '新手引导：先跑通最小闭环',
    'onboarding.subtitle': '按 3 步走通：设置 token → 新建 workspace → Start/Step',
    'onboarding.step1': 'Step 1：设置 ADMIN_TOKEN（右上角）',
    'onboarding.step2': 'Step 2：点击“新增”创建 workspace（rootPath / planPath）',
    'onboarding.step3': 'Step 3：Load plan 后 Start/Step（或打开 Codex 用户窗口发送一条消息）',
    'onboarding.ask_note': '提示：Codex 用户窗口 = 用户直接对话窗口（provider 直聊）',
    'onboarding.dismiss': '不再提示',

    'role.manager': '主管',
    'role.executor': '执行者',
    'role.manager_opt': '主管（manager）',
    'role.executor_opt': '执行者（executor）',

    'sandbox.read_only': '只读（read-only）',
    'sandbox.workspace_write': '可写（workspace-write）',
    'sandbox.danger_full_access': '完全访问（danger-full-access）',

    'dash.workspace': '工作区',
    'dash.kv.name': '名称',
    'dash.kv.root': '根目录',
    'dash.kv.plan': '计划',
    'dash.kv.convention': '约定',
    'dash.load_plan': '加载计划',
    'dash.load_convention': '加载约定',
    'dash.load_digest': '加载仓库摘要（repoDigest）',
    'dash.edit_workspace': '编辑工作区',
    'dash.sessions': '会话',
    'dash.create_default_sessions': '创建默认会话',
    'dash.selected_manager_session': '已选主管会话（属性）',
    'dash.selected_executor_session': '已选执行者会话（属性）',
    'dash.session_info_raw_config': '原始配置（JSON）',
    'dash.run': '运行',
    'dash.create_run': '创建运行',
    'dash.start': '开始',
    'dash.step': '单步',
    'dash.pause': '暂停',
    'dash.stop': '停止',
    'dash.kv.status': '状态',
    'dash.kv.turn': '回合',
    'dash.kv.sse': '推送',
    'dash.inject_export': '插话 / 导出',
    'dash.inject_placeholder': '消息…',
    'dash.send': '发送',
    'dash.export_md': '导出 .md',
    'dash.export_json': '导出 .json',
    'dash.export_jsonl': '导出 .jsonl',
    'dash.rollover_reason_placeholder': '换血原因（可选）…',
    'dash.rollover_manager': '主管换血',
    'dash.rollover_executor': '执行者换血',

    'tab.manager': '主管',
    'tab.executor': '执行者',
    'tab.events': '事件',
    'tab.plan': '计划',
    'tab.digest': '仓库摘要（repoDigest）',

    'md.kind_plan': '计划',
    'md.kind_convention': '约定',
    'md.kind_path': '文件',
    'md.path_placeholder': '相对工作区根目录，例如 docs/plan.md',
    'md.load': '加载',
    'md.render': 'MD 渲染',
    'md.render_title': '将内容按 Markdown 渲染（手机如有问题可关闭）',
    'md.truncated': '（已截断）',
    'model.preset_title': '选择模型预设（移动端推荐）',
    'model.preset_placeholder': 'model（预设）',

    'run.maxTurns': '最大回合',
    'run.timeoutMin': '超时（分钟）',
    'run.repoDigest': '仓库摘要（repoDigest）',
    'run.requireGitClean': '要求 git 干净',
    'run.cmdGuard': '危险命令防护',
    'run.noProgressLimit': '无进展上限',

    'history.title': '历史',
    'history.toggle_list_hide': '收起列表',
    'history.toggle_list_show': '展开列表',
    'history.filter_placeholder': '按 id/状态过滤…',
    'history.open_in_dashboard': '在控制台打开',
    'history.turn_search_placeholder': '在回合内容里搜索（prompt/output/commands）…',

    'sessions.title': '会话',
    'sessions.create_title': '创建会话',
    'sessions.create_btn': '创建',
    'sessions.edit_title': '编辑会话',
    'sessions.save': '保存',
    'sessions.reset_provider_session_id': '重置 providerSessionId',
    'sessions.copy_id': '复制 id',
    'sessions.hint_reset': '注：Save/Reset 需要带 ADMIN_TOKEN；Reset 会清空 providerSessionId，下一次运行会重新创建 thread/session。',
    'sessions.rollovers_title': '换血记录',
    'sessions.new_provider_title': '提供方（provider）',
    'sessions.new_mode_title': '会话模式',
    'sessions.new_system_prompt_path_placeholder': 'systemPromptPath（例如 prompts/manager_system.md）',
    'sessions.new_model_placeholder': 'model（可选）',
    'sessions.new_effort_title': '推理强度（effort）',
    'sessions.effort_default': 'effort（默认）',
    'sessions.new_output_format_title': 'claude 输出格式',
    'sessions.output_format_default': 'outputFormat（默认）',
    'sessions.new_permission_mode_title': 'claude 权限模式',
    'sessions.permission_mode_default': 'permissionMode（默认）',
    'sessions.new_tools_disabled_title': "claude：用 --tools '' 禁用工具",
    'sessions.tools_off': '禁用工具',
    'sessions.new_tools_placeholder': 'tools（可选，例如 default, Read,Edit）',
    'sessions.new_include_partial_title': 'claude：仅 stream-json 有效',
    'sessions.include_partial': '包含 partial',
    'sessions.new_session_persistence_title': 'claude：将 session 落盘',
    'sessions.session_persistence': '会话持久化',
    'sessions.mode_default': 'mode（默认：stateful_resume）',
    'sessions.mode_stateless': 'stateless_exec（一次性）',
    'sessions.mode_resume': 'stateful_resume（续聊）',
    'sessions.edit_session_select_title': '会话',
    'sessions.edit_provider_title': '提供方（provider）',
    'sessions.edit_provider_keep': 'provider（保持不变）',
    'sessions.edit_sandbox_title': '权限',
    'sessions.edit_sandbox_keep': '权限（保持不变）',
    'sessions.edit_mode_title': '模式（mode）',
    'sessions.edit_mode_keep': 'mode（保持不变）',
    'sessions.edit_model_placeholder': 'model（保持/留空）',
    'sessions.edit_effort_title': '推理强度（effort）',
    'sessions.effort_keep': 'effort（默认/清空）',

    'ask.title': 'Codex 用户窗口',
    'ask.hint': '注：Codex 用户窗口绑定当前工作区，并使用 resume 续聊；写接口需要 ADMIN_TOKEN。',
    'ask.threads_title': '对话',
    'ask.thread_search_placeholder': '搜索…',
    'ask.new_thread': '新建',
    'ask.export_md': '导出 .md',
    'ask.export_jsonl': '导出 .jsonl',
    'ask.input_placeholder': '输入你的问题…',
    'ask.send': '发送',
    'ask.stop': '终止',
    'ask.send_hint': '快捷键：Ctrl+Enter 发送。',
    'ask.status_idle': '就绪',
    'ask.status_sending': '回复中',
    'ask.status_recovering': '恢复中',
    'ask.status_failed': '失败',
    'ask.send_sending': '发送中…',
    'ask.elapsed_label': '耗时',
    'ask.elapsed_pending': '等待回复完成',
    'ask.elapsed_unavailable': '耗时不可用（刷新/未记录）',
    'ask.usage_label': '用量',
    'ask.usage_unavailable': '用量不可用（provider 未提供 usage）',
    'ask.queue_title': '队列',
    'ask.queue_empty': '(队列为空)',
    'ask.queue_status_queued': 'queued',
    'ask.queue_status_running': 'running',
    'ask.queue_status_error': 'error',
    'ask.queue_edit': '编辑',
    'ask.queue_delete': '删除',
    'ask.queue_save': '保存',
    'ask.queue_cancel': '取消',
    'ask.confirm_queue_delete': '确认删除该队列项？',

    'ask.toggle_threads_hide': '收起对话',
    'ask.toggle_threads_show': '展开对话',
    'ask.toggle_config_hide': '收起配置',
    'ask.toggle_config_show': '展开配置',

    'ask.config_title': '配置',
    'ask.kv.provider': '提供方',
    'ask.kv.model': '模型',
    'ask.kv.effort': '推理强度',
    'ask.kv.sandbox': '沙盒',
    'ask.title_placeholder': '标题',
    'ask.save_title': '保存标题',
    'ask.model_placeholder': 'model（可选）',
    'ask.effort_title': '推理强度（effort）',
    'ask.effort_default': 'effort（默认）',
    'ask.save_config': '保存配置',
    'ask.reset_resume': '重置续聊',
    'ask.delete_thread': '删除',
    'ask.confirm_reset': '确认重置续聊？下次发送将开启新的 provider 对话。',
    'ask.confirm_delete': '确认删除该对话？',
    'ask.debug': '调试',

    'files.title': '文件',
    'files.hint': '提示：无 ADMIN_TOKEN 时仅可只读浏览非隐藏文件；填写 ADMIN_TOKEN 后可浏览隐藏文件并编辑保存文本/Markdown。',
    'files.up': '上一级',
    'files.search_placeholder': '搜索...',
    'files.save': '保存',
    'files.reload': '重新加载',
    'files.unsupported': '(暂不支持预览)',
    'files.confirm_discard': '有未保存修改，确认丢弃？',
    'files.truncated_no_save': '文件过大已截断：为避免覆盖损坏，已禁用保存。',

    'settings.title': '设置',
    'settings.allowed_roots_title': '允许的 rootPath（白名单）',
    'settings.allowed_roots_hint':
      '注：用于限制可注册 workspace 的目录范围；写入需要 ADMIN_TOKEN；修改会持久化到 DB 并立即生效（重启后仍有效）。',
    'settings.allowed_roots_placeholder': '每行一个绝对路径，例如 E:\\\\sjt\\\\others',
    'settings.allowed_roots_load': '从 health 填充',
    'settings.allowed_roots_save': '保存',
    'settings.allowed_roots_reset': '恢复为环境变量',
    'settings.allowed_roots_confirm_overwrite': '确认用 health 覆盖编辑框内容？',
    'settings.allowed_roots_confirm_reset': '确认恢复为环境变量？（将删除 DB 覆盖值）',
    'settings.capabilities_title': '能力探测',
    'settings.probe': '探测',
    'settings.probe_hint': '注：Probe 会执行本机 CLI 探测命令，需要带 ADMIN_TOKEN。',
    'settings.add_workspace_title': '添加工作区',
    'settings.ws_name_placeholder': '名称',
    'settings.ws_root_placeholder': 'rootPath（绝对路径）',
    'settings.ws_plan_placeholder': 'planPath（可选，绝对路径或相对 rootPath）',
    'settings.ws_convention_placeholder': 'conventionPath（可选，绝对路径或相对 rootPath）',
    'settings.add_workspace_btn': '添加工作区',
    'settings.workspace_hint': '注：写接口必须带 ADMIN_TOKEN；workspace root 必须在 ALLOWED_WORKSPACE_ROOTS 白名单内。',
    'settings.onboarding_title': '新手引导',
    'settings.onboarding_reset': '重置新手引导',
    'settings.onboarding_hint': '清除“不再提示”，下次无 workspace 时会重新显示引导。',

    'common.refresh': '刷新',
    'common.cancel': '取消',
    'common.close': '关闭',

    'placeholder.no_data': '(无数据)',
    'placeholder.not_loaded': '(未加载)',
    'placeholder.loading': '(加载中…)',
    'placeholder.not_probed': '(未探测)',
    'placeholder.no_workspaces': '(无工作区)',
    'placeholder.no_sessions': '(无会话)',
    'placeholder.no_runs': '(无运行)',
    'placeholder.no_rollovers': '(无换血记录)',
    'placeholder.no_run_selected': '(未选择运行)',
    'placeholder.no_manager_output_yet': '(主管暂无输出)',
    'placeholder.no_executor_output_yet': '(执行者暂无输出)',
    'placeholder.no_events_yet': '(暂无事件)',
    'placeholder.select_a_run': '(请选择一个运行)',
    'placeholder.no_matching_turns': '(没有匹配的回合)',
    'placeholder.empty': '(空)',
    'placeholder.default': '(默认)',
    'placeholder.none': '(无)',

    'label.mode': '模式',
    'label.model': '模型',
    'label.provider_session_id': 'providerSessionId（会话续聊 id）',
    'label.turn': '回合',
    'label.created': '创建',
    'label.started': '开始',
    'label.ended': '结束',
    'label.view': '查看',
    'label.dashboard': '控制台',
    'label.manager_prompt': '主管 prompt',
    'label.manager_output': '主管输出',
    'label.manager_meta': '主管 meta',
    'label.executor_prompt': '执行者 prompt',
    'label.executor_output': '执行者输出',
    'label.executor_meta': '执行者 meta',
    'label.from': 'from',
    'label.to': 'to',
    'label.run_id': 'runId',

    'session_info.k.session': '会话',
    'session_info.k.id': '会话ID',
    'session_info.k.role': '角色',
    'session_info.k.provider': '提供方',
    'session_info.k.sandbox': '权限',
    'session_info.k.prompt': 'System Prompt',
    'session_info.k.created_at': '创建时间',
    'session_info.k.last_active_at': '最近活跃',

    'sse.connecting': '连接中',
    'sse.connected': '已连接',
    'sse.disconnected_retrying': '已断开（重试中）',
    'sse.idle': '-',

    'status.IDLE': '空闲',
    'status.RUNNING': '运行中',
    'status.PAUSED': '已暂停',
    'status.DONE': '已完成',
    'status.ERROR': '错误',
    'status.STOPPED': '已停止',

    'run_error.MAX_TURNS': '超过最大回合',
    'run_error.GIT_DIRTY': 'git 未干净',
    'run_error.GIT_STATUS_FAILED': 'git status 失败',
    'run_error.DANGEROUS_COMMAND': '检测到危险命令',
    'run_error.NO_PROGRESS': '多轮无进展',
    'run_error.MANAGER_OUTPUT_INVALID': '主管输出不符合协议',
    'run_error.EXECUTOR_OUTPUT_INVALID': '执行者输出不符合协议',

    'toast.copied': '已复制',
    'toast.copy_session_id_prompt': '复制 session id：',
    'toast.rollover_ok': '换血：OK',
    'toast.export_failed': '导出失败：HTTP {status}',
    'toast.ADMIN_TOKEN_REQUIRED': '需要 ADMIN_TOKEN（右上角填写）',
    'toast.RUN_NOT_SELECTED': '未选择运行',
    'toast.WORKSPACE_NOT_SELECTED': '未选择工作区',
    'toast.SESSIONS_REQUIRED': '需要选择主管/执行者会话',
    'toast.SESSION_NOT_SELECTED': '未选择会话',
    'toast.default_sessions_created': '已创建默认会话并已选中：主管 {manager}，执行者 {executor}',
    'toast.default_sessions_selected': '已选择默认会话：主管 {manager}，执行者 {executor}',
    'toast.UNAUTHORIZED': '需要正确的 ADMIN_TOKEN（右上角填写）',
    'toast.ASK_THREAD_BUSY': '该对话正在发送中，请稍等…',
    'toast.ASK_THREAD_NOT_FOUND': '对话不存在（可能已删除）',
    'toast.ASK_PROVIDER_FAILED': 'Ask 调用失败（见调试信息/日志）',
    'toast.ASK_RESUME_ID_MISSING': 'Ask 初始化失败：未获取到 resumeId（thread_id）',
    'toast.ASK_STOP_REQUESTED': '已请求终止（等待对话停止）',
    'toast.ASK_STOP_NOT_RUNNING': '当前没有进行中的 Ask',
    'toast.FILE_CHANGED': '文件已变更，请重新加载后再保存',
    'toast.FILE_TRUNCATED': '文件已截断：为避免覆盖损坏，无法保存',
    'toast.FILE_NOT_TEXT': '不是文本文件，无法预览/编辑',
    'toast.HIDDEN_PATH_FORBIDDEN': '无权限访问隐藏文件/目录（需要 ADMIN_TOKEN）',
    'toast.PATH_NOT_DIR': '路径不是目录',
    'toast.PATH_NOT_FILE': '路径不是文件',
  },
  en: {
    'top.workspace_select_title': 'Workspace',
    'top.add_workspace_title': 'Add workspace',
    'top.add': 'Add',
    'top.ask': 'User Window',
    'top.ask_title': 'Open User Window (new window)',
    'top.admin_token_label': 'ADMIN_TOKEN',
    'top.admin_token_placeholder': 'required for write ops',
    'top.lang_toggle': '中文',
    'top.lang_toggle_title': 'Switch language (中文/English)',

    'nav.dashboard': 'Dashboard',
    'nav.history': 'History',
    'nav.sessions': 'Sessions',
    'nav.ask': 'User Window',
    'nav.files': 'Files',
    'nav.settings': 'Settings',

    'workspace_modal.title': 'Create workspace',
    'workspace_modal.name_label': 'Name (optional)',
    'workspace_modal.name_placeholder': 'name (optional)',
    'workspace_modal.root_label': 'rootPath (required)',
    'workspace_modal.root_placeholder': 'rootPath (absolute)',
    'workspace_modal.plan_label': 'planPath (default plan.md)',
    'workspace_modal.plan_placeholder': 'plan.md',
    'workspace_modal.convention_label': 'conventionPath (default 约定.md)',
    'workspace_modal.convention_placeholder': '约定.md',
    'workspace_modal.allowed_title': 'Allowed rootPath list (from /api/health)',
    'workspace_modal.allowed_hint': 'rootPath must be within the allowed list or you will get PATH_NOT_ALLOWED.',
    'workspace_modal.create': 'Create',
    'workspace_modal.title_edit': 'Edit workspace',
    'workspace_modal.save': 'Save',
    'doc_modal.title_plan': 'Load plan',
    'doc_modal.title_convention': 'Load convention',

    'onboarding.title': 'Getting started: finish the minimal loop',
    'onboarding.subtitle': '3 steps: set token → create workspace → Start/Step',
    'onboarding.step1': 'Step 1: set ADMIN_TOKEN (top-right)',
    'onboarding.step2': 'Step 2: click Add to create a workspace (rootPath / planPath)',
    'onboarding.step3': 'Step 3: Load plan then Start/Step (or open Codex User Window and send a message)',
    'onboarding.ask_note': 'Note: User Window = direct provider chat.',
    'onboarding.dismiss': "Don't show again",

    'role.manager': 'Manager',
    'role.executor': 'Executor',
    'role.manager_opt': 'manager',
    'role.executor_opt': 'executor',

    'sandbox.read_only': 'read-only',
    'sandbox.workspace_write': 'workspace-write',
    'sandbox.danger_full_access': 'danger-full-access',

    'dash.workspace': 'Workspace',
    'dash.kv.name': 'Name',
    'dash.kv.root': 'Root',
    'dash.kv.plan': 'Plan',
    'dash.kv.convention': 'Convention',
    'dash.load_plan': 'Load plan',
    'dash.load_convention': 'Load convention',
    'dash.load_digest': 'Load repoDigest',
    'dash.edit_workspace': 'Edit workspace',
    'dash.sessions': 'Sessions',
    'dash.create_default_sessions': 'Create default sessions',
    'dash.selected_manager_session': 'Selected manager session (details)',
    'dash.selected_executor_session': 'Selected executor session (details)',
    'dash.session_info_raw_config': 'Raw config (JSON)',
    'dash.run': 'Run',
    'dash.create_run': 'Create run',
    'dash.start': 'Start',
    'dash.step': 'Step',
    'dash.pause': 'Pause',
    'dash.stop': 'Stop',
    'dash.kv.status': 'Status',
    'dash.kv.turn': 'Turn',
    'dash.kv.sse': 'SSE',
    'dash.inject_export': 'Inject / Export',
    'dash.inject_placeholder': 'message...',
    'dash.send': 'Send',
    'dash.export_md': 'Export .md',
    'dash.export_json': 'Export .json',
    'dash.export_jsonl': 'Export .jsonl',
    'dash.rollover_reason_placeholder': 'rollover reason (optional)...',
    'dash.rollover_manager': 'Rollover manager',
    'dash.rollover_executor': 'Rollover executor',

    'tab.manager': 'Manager',
    'tab.executor': 'Executor',
    'tab.events': 'Events',
    'tab.plan': 'Plan',
    'tab.digest': 'repoDigest',

    'md.kind_plan': 'Plan',
    'md.kind_convention': 'Convention',
    'md.kind_path': 'File',
    'md.path_placeholder': 'Path relative to workspace root (e.g. docs/plan.md)',
    'md.load': 'Load',
    'md.render': 'Render MD',
    'md.render_title': 'Render content as Markdown (turn off if it looks wrong on mobile)',
    'md.truncated': '(truncated)',
    'model.preset_title': 'Pick a model preset (mobile-friendly)',
    'model.preset_placeholder': 'model presets',

    'run.maxTurns': 'maxTurns',
    'run.timeoutMin': 'timeout (min)',
    'run.repoDigest': 'repoDigest',
    'run.requireGitClean': 'require git clean',
    'run.cmdGuard': 'cmd guard',
    'run.noProgressLimit': 'noProgressLimit',

    'history.title': 'History',
    'history.toggle_list_hide': 'Hide list',
    'history.toggle_list_show': 'Show list',
    'history.filter_placeholder': 'filter by id/status...',
    'history.open_in_dashboard': 'Open in Dashboard',
    'history.turn_search_placeholder': 'search in turns (prompt/output/commands)...',

    'sessions.title': 'Sessions',
    'sessions.create_title': 'Create session',
    'sessions.create_btn': 'Create',
    'sessions.edit_title': 'Edit session',
    'sessions.save': 'Save',
    'sessions.reset_provider_session_id': 'Reset providerSessionId',
    'sessions.copy_id': 'Copy id',
    'sessions.hint_reset': 'Note: Save/Reset requires ADMIN_TOKEN; Reset clears providerSessionId so the next run creates a new thread/session.',
    'sessions.rollovers_title': 'Rollovers',
    'sessions.new_provider_title': 'provider',
    'sessions.new_mode_title': 'session mode',
    'sessions.new_system_prompt_path_placeholder': 'systemPromptPath (e.g. prompts/manager_system.md)',
    'sessions.new_model_placeholder': 'model (optional)',
    'sessions.new_effort_title': 'reasoning effort',
    'sessions.effort_default': 'effort (default)',
    'sessions.new_output_format_title': 'claude output format',
    'sessions.output_format_default': 'outputFormat (default)',
    'sessions.new_permission_mode_title': 'claude permission mode',
    'sessions.permission_mode_default': 'permissionMode (default)',
    'sessions.new_tools_disabled_title': "claude: disable tools via --tools ''",
    'sessions.tools_off': 'tools off',
    'sessions.new_tools_placeholder': 'tools (optional, e.g. default, Read,Edit)',
    'sessions.new_include_partial_title': 'claude stream-json only',
    'sessions.include_partial': 'include partial',
    'sessions.new_session_persistence_title': 'claude: persist sessions to disk',
    'sessions.session_persistence': 'session persistence',
    'sessions.mode_default': 'mode (default: stateful_resume)',
    'sessions.mode_stateless': 'stateless_exec',
    'sessions.mode_resume': 'stateful_resume',
    'sessions.edit_session_select_title': 'session',
    'sessions.edit_provider_title': 'provider',
    'sessions.edit_provider_keep': 'provider (keep)',
    'sessions.edit_sandbox_title': 'sandbox',
    'sessions.edit_sandbox_keep': 'sandbox (keep)',
    'sessions.edit_mode_title': 'mode',
    'sessions.edit_mode_keep': 'mode (keep)',
    'sessions.edit_model_placeholder': 'model (keep/empty)',
    'sessions.edit_effort_title': 'reasoning effort',
    'sessions.effort_keep': 'effort (default/clear)',

    'ask.title': 'User Window',
    'ask.hint': 'Note: User Window is bound to the current workspace and uses resume; write APIs require ADMIN_TOKEN.',
    'ask.threads_title': 'Threads',
    'ask.thread_search_placeholder': 'search...',
    'ask.new_thread': 'New',
    'ask.export_md': 'Export .md',
    'ask.export_jsonl': 'Export .jsonl',
    'ask.input_placeholder': 'Type your question...',
    'ask.send': 'Send',
    'ask.stop': 'Stop',
    'ask.send_hint': 'Shortcut: Ctrl+Enter to send.',
    'ask.status_idle': 'Idle',
    'ask.status_sending': 'Replying',
    'ask.status_recovering': 'Recovering',
    'ask.status_failed': 'Failed',
    'ask.send_sending': 'Sending…',
    'ask.elapsed_label': 'Elapsed',
    'ask.elapsed_pending': 'Waiting for reply to finish',
    'ask.elapsed_unavailable': 'Elapsed unavailable (no start/end in this session)',
    'ask.usage_label': 'Usage',
    'ask.usage_unavailable': 'Usage unavailable (provider did not return usage)',
    'ask.queue_title': 'Queue',
    'ask.queue_empty': '(empty)',
    'ask.queue_status_queued': 'queued',
    'ask.queue_status_running': 'running',
    'ask.queue_status_error': 'error',
    'ask.queue_edit': 'Edit',
    'ask.queue_delete': 'Delete',
    'ask.queue_save': 'Save',
    'ask.queue_cancel': 'Cancel',
    'ask.confirm_queue_delete': 'Delete this queued item?',

    'ask.toggle_threads_hide': 'Hide threads',
    'ask.toggle_threads_show': 'Show threads',
    'ask.toggle_config_hide': 'Hide config',
    'ask.toggle_config_show': 'Show config',

    'ask.config_title': 'Config',
    'ask.kv.provider': 'provider',
    'ask.kv.model': 'model',
    'ask.kv.effort': 'effort',
    'ask.kv.sandbox': 'sandbox',
    'ask.title_placeholder': 'title',
    'ask.save_title': 'Save title',
    'ask.model_placeholder': 'model (optional)',
    'ask.effort_title': 'reasoning effort',
    'ask.effort_default': 'effort (default)',
    'ask.save_config': 'Save config',
    'ask.reset_resume': 'Reset resume',
    'ask.delete_thread': 'Delete',
    'ask.confirm_reset': 'Reset resumeId? Next send will start a new provider conversation.',
    'ask.confirm_delete': 'Delete this ask thread?',
    'ask.debug': 'Debug',

    'files.title': 'Files',
    'files.hint': 'Note: Without ADMIN_TOKEN, you can only browse non-hidden files in read-only mode. With ADMIN_TOKEN you can browse hidden files and edit/save text/Markdown.',
    'files.up': 'Up',
    'files.search_placeholder': 'search...',
    'files.save': 'Save',
    'files.reload': 'Reload',
    'files.unsupported': '(preview unsupported)',
    'files.confirm_discard': 'You have unsaved changes. Discard them?',
    'files.truncated_no_save': 'File is truncated. Save is disabled to avoid overwriting the file.',

    'settings.title': 'Settings',
    'settings.allowed_roots_title': 'Allowed rootPath (allowlist)',
    'settings.allowed_roots_hint':
      'Note: limits where workspaces can be registered; requires ADMIN_TOKEN to write; saved to DB and takes effect immediately (persists after restart).',
    'settings.allowed_roots_placeholder': 'One absolute path per line, e.g. E:\\\\projects',
    'settings.allowed_roots_load': 'Fill from health',
    'settings.allowed_roots_save': 'Save',
    'settings.allowed_roots_reset': 'Reset to env',
    'settings.allowed_roots_confirm_overwrite': 'Overwrite the editor with the health value?',
    'settings.allowed_roots_confirm_reset': 'Reset to env? (This removes the DB override)',
    'settings.capabilities_title': 'Capabilities',
    'settings.probe': 'Probe',
    'settings.probe_hint': 'Note: Probe runs local CLI capability checks and requires ADMIN_TOKEN.',
    'settings.add_workspace_title': 'Add workspace',
    'settings.ws_name_placeholder': 'name',
    'settings.ws_root_placeholder': 'rootPath (absolute)',
    'settings.ws_plan_placeholder': 'planPath (optional, absolute or relative to rootPath)',
    'settings.ws_convention_placeholder': 'conventionPath (optional, absolute or relative to rootPath)',
    'settings.add_workspace_btn': 'Add workspace',
    'settings.workspace_hint': 'Note: write APIs require ADMIN_TOKEN; workspace root must be within ALLOWED_WORKSPACE_ROOTS.',
    'settings.onboarding_title': 'Onboarding',
    'settings.onboarding_reset': 'Reset onboarding',
    'settings.onboarding_hint': 'Clears the hide flag so the empty-workspace guide shows again.',

    'common.refresh': 'Refresh',
    'common.cancel': 'Cancel',
    'common.close': 'Close',

    'placeholder.no_data': '(no data)',
    'placeholder.not_loaded': '(not loaded)',
    'placeholder.loading': '(loading...)',
    'placeholder.not_probed': '(not probed)',
    'placeholder.no_workspaces': '(no workspaces)',
    'placeholder.no_sessions': '(no sessions)',
    'placeholder.no_runs': '(no runs)',
    'placeholder.no_rollovers': '(no rollovers)',
    'placeholder.no_run_selected': '(no run selected)',
    'placeholder.no_manager_output_yet': '(no manager output yet)',
    'placeholder.no_executor_output_yet': '(no executor output yet)',
    'placeholder.no_events_yet': '(no events yet)',
    'placeholder.select_a_run': '(select a run)',
    'placeholder.no_matching_turns': '(no matching turns)',
    'placeholder.empty': '(empty)',
    'placeholder.default': '(default)',
    'placeholder.none': '(none)',

    'label.mode': 'mode',
    'label.model': 'model',
    'label.provider_session_id': 'providerSessionId',
    'label.turn': 'Turn',
    'label.created': 'created',
    'label.started': 'started',
    'label.ended': 'ended',
    'label.view': 'View',
    'label.dashboard': 'Dashboard',
    'label.manager_prompt': 'manager prompt',
    'label.manager_output': 'manager output',
    'label.manager_meta': 'manager meta',
    'label.executor_prompt': 'executor prompt',
    'label.executor_output': 'executor output',
    'label.executor_meta': 'executor meta',
    'label.from': 'from',
    'label.to': 'to',
    'label.run_id': 'runId',

    'session_info.k.session': 'Session',
    'session_info.k.id': 'Session ID',
    'session_info.k.role': 'Role',
    'session_info.k.provider': 'Provider',
    'session_info.k.sandbox': 'Sandbox',
    'session_info.k.prompt': 'System prompt',
    'session_info.k.created_at': 'Created',
    'session_info.k.last_active_at': 'Last active',

    'sse.connecting': 'connecting',
    'sse.connected': 'connected',
    'sse.disconnected_retrying': 'disconnected (retrying)',
    'sse.idle': '-',

    'status.IDLE': 'IDLE',
    'status.RUNNING': 'RUNNING',
    'status.PAUSED': 'PAUSED',
    'status.DONE': 'DONE',
    'status.ERROR': 'ERROR',
    'status.STOPPED': 'STOPPED',

    'run_error.MAX_TURNS': 'MAX_TURNS',
    'run_error.GIT_DIRTY': 'GIT_DIRTY',
    'run_error.GIT_STATUS_FAILED': 'GIT_STATUS_FAILED',
    'run_error.DANGEROUS_COMMAND': 'DANGEROUS_COMMAND',
    'run_error.NO_PROGRESS': 'NO_PROGRESS',
    'run_error.MANAGER_OUTPUT_INVALID': 'MANAGER_OUTPUT_INVALID',
    'run_error.EXECUTOR_OUTPUT_INVALID': 'EXECUTOR_OUTPUT_INVALID',

    'toast.copied': 'copied',
    'toast.copy_session_id_prompt': 'Copy session id:',
    'toast.rollover_ok': 'rollover: OK',
    'toast.export_failed': 'export failed: HTTP {status}',
    'toast.ADMIN_TOKEN_REQUIRED': 'ADMIN_TOKEN required',
    'toast.RUN_NOT_SELECTED': 'RUN_NOT_SELECTED',
    'toast.WORKSPACE_NOT_SELECTED': 'WORKSPACE_NOT_SELECTED',
    'toast.SESSIONS_REQUIRED': 'SESSIONS_REQUIRED',
    'toast.SESSION_NOT_SELECTED': 'SESSION_NOT_SELECTED',
    'toast.default_sessions_created': 'Created default sessions and selected: manager {manager}, executor {executor}',
    'toast.default_sessions_selected': 'Selected default sessions: manager {manager}, executor {executor}',
    'toast.UNAUTHORIZED': 'ADMIN_TOKEN required (top-right)',
    'toast.ASK_THREAD_BUSY': 'This thread is busy (sending)...',
    'toast.ASK_THREAD_NOT_FOUND': 'Thread not found',
    'toast.ASK_PROVIDER_FAILED': 'Ask provider failed (see debug/logs)',
    'toast.ASK_RESUME_ID_MISSING': 'Ask seed failed: missing resumeId (thread_id)',
    'toast.ASK_STOP_REQUESTED': 'Stop requested',
    'toast.ASK_STOP_NOT_RUNNING': 'No active Ask to stop',
    'toast.FILE_CHANGED': 'File changed on disk. Reload before saving.',
    'toast.FILE_TRUNCATED': 'File is truncated. Save is disabled to avoid overwriting.',
    'toast.FILE_NOT_TEXT': 'Not a text file',
    'toast.HIDDEN_PATH_FORBIDDEN': 'Hidden path forbidden (ADMIN_TOKEN required)',
    'toast.PATH_NOT_DIR': 'Path is not a directory',
    'toast.PATH_NOT_FILE': 'Path is not a file',
  },
};

function t(key, vars) {
  const lang = state?.lang || 'zh';
  const dict = I18N[lang] || I18N.zh;
  const raw = dict[key] ?? I18N.zh[key] ?? key;
  return formatTemplate(raw, vars);
}

function applyDomI18n() {
  const lang = state.lang;
  document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';

  qa('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  qa('[data-i18n-placeholder]').forEach((el) => {
    el.setAttribute('placeholder', t(el.dataset.i18nPlaceholder));
  });
  qa('[data-i18n-title]').forEach((el) => {
    el.setAttribute('title', t(el.dataset.i18nTitle));
  });
}

function getRoleLabel(role, variant) {
  const r = String(role || '').toLowerCase();
  if (variant === 'opt') {
    if (r === 'manager') return t('role.manager_opt');
    if (r === 'executor') return t('role.executor_opt');
  }
  if (r === 'manager') return t('role.manager');
  if (r === 'executor') return t('role.executor');
  return r;
}

function formatStatus(status) {
  const s = String(status || '').toUpperCase();
  const key = `status.${s}`;
  const translated = t(key);
  return translated === key ? s : translated;
}

function formatRunError(code) {
  const c = String(code || '').trim();
  if (!c) return '';
  const key = `run_error.${c}`;
  const translated = t(key);
  return translated === key ? c : translated;
}

const state = {
  lang: getUiLang(),
  health: null,
  capabilities: null,
  workspaces: [],
  workspaceId: null,
  managerSessionId: null,
  executorSessionId: null,
  sessions: [],
  rollovers: [],
  runs: [],
  runId: null,
  runDetail: null,
  historyRunId: null,
  historyRunDetail: null,
  historyListCollapsed: false,
  historyRenderMarkdown: false,
  page: 'dashboard',
  tab: 'manager',
  mdKind: 'plan',
  mdPath: '',
  mdLoadedPath: '',
  mdTruncated: false,
  planText: '',
  digestText: '',
  events: [],
  eventSource: null,
  sseStatusKey: 'sse.idle',
  pendingRefreshTimer: null,
  filesDir: '',
  filesItems: [],
  filesTruncated: false,
  filesIncludeHidden: false,
  filesReadOnly: true,
  filesSearch: '',
  filesSelectedRelPath: null,
  filesSelectedKind: null,
  filesSelectedLoading: false,
  filesSelectedError: '',
  filesSelectedText: '',
  filesSelectedTextOriginal: '',
  filesSelectedTextTruncated: false,
  filesSelectedMtimeMs: null,
  filesSelectedSizeBytes: null,
  filesSelectedMode: null,
  filesImageUrl: '',
  filesSaving: false,
  askPollTimer: null,
  askPollToken: 0,
  askThreads: [],
  askThreadId: null,
  askThreadsSig: null,
  askMessages: [],
  askMessagesSig: null,
  askMessageOpen: {},
  askQueueItems: [],
  askQueueSig: null,
  askQueueItemOpen: {},
  askQueueEditId: null,
  askQueueEditText: '',
  askThreadFilter: '',
  askSendInFlight: false,
  askRecovering: false,
  askForceScrollToBottom: false,
  askThreadsCollapsed: false,
  askConfigCollapsed: false,
  askRenderMarkdown: false,
  askLastSendThreadId: null,
  askLastSendStartedAt: null,
  askLastSendEndedAt: null,
  askLastSendElapsedMs: null,
  askSse: null,
  askSseKey: null,
  askSseRefreshTimer: null,
  askDebugText: '',
  workspaceModalMode: 'create',
  workspaceModalWorkspaceId: null,
  workspaceDocModalKind: 'plan',
  workspaceDocModalPath: '',
  workspaceDocModalText: '',
  workspaceDocModalTruncated: false,
  workspaceDocModalLoaded: false,
  workspaceDocRenderMarkdown: true,
};

function normalizePage(value) {
  const p = String(value || '').trim().toLowerCase();
  if (['dashboard', 'history', 'sessions', 'ask', 'files', 'settings'].includes(p)) return p;
  return 'dashboard';
}

function getInitialPageFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search || '');
    const fromQuery = params.get('page');
    if (fromQuery) return normalizePage(fromQuery);
    const path = String(window.location.pathname || '').toLowerCase();
    if (path === '/ask' || path.startsWith('/ask/')) return 'ask';
    if (path === '/files' || path.startsWith('/files/')) return 'files';
  } catch {}
  return null;
}

function getInitialWorkspaceIdFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search || '');
    const v = params.get('ws') || params.get('workspaceId');
    return v ? String(v).trim() : null;
  } catch {}
  return null;
}

const URL_INITIAL_WORKSPACE_ID = getInitialWorkspaceIdFromUrl();
state.page = getInitialPageFromUrl() || state.page;

function setPage(page) {
  const p = normalizePage(page);
  if (state.page === 'files' && p !== 'files') {
    if (!confirmDiscardFilesChangesIfAny()) return;
  }
  state.page = p;
  qa('.page').forEach((el) => el.classList.add('hidden'));
  q(`#page-${p}`).classList.remove('hidden');
  qa('.nav__btn').forEach((btn) => {
    btn.classList.toggle('nav__btn--active', btn.dataset.page === p);
  });
  renderOnboarding();
  if (p === 'ask' && state.workspaceId) {
    loadAskThreads(state.workspaceId).catch(toast);
  }
  ensureAskSse();
  if (p === 'files' && state.workspaceId) {
    loadFilesList(state.workspaceId, state.filesDir).catch(toast);
  }
}

function setTab(tab) {
  state.tab = tab;
  qa('.tab').forEach((el) => el.classList.add('hidden'));
  q(`#tab-${tab}`).classList.remove('hidden');
  qa('.tabs__btn').forEach((btn) => {
    btn.classList.toggle('tabs__btn--active', btn.dataset.tab === tab);
  });
}

function selectedWorkspace() {
  return state.workspaces.find((w) => w.id === state.workspaceId) || null;
}

function selectedRun() {
  return state.runs.find((r) => r.id === state.runId) || null;
}

function selectedAskThread() {
  return state.askThreads.find((t) => t.id === state.askThreadId) || null;
}

function askThreadsSignature(items) {
  const threads = Array.isArray(items) ? items : [];
  return threads
    .map((t) => {
      const id = String(t?.id || '');
      const updatedAt = Number(t?.updatedAt || 0);
      const busy = t?.busy ? '1' : '0';
      return `${id}:${updatedAt}:${busy}`;
    })
    .join('|');
}

function askMessagesSignature(threadId, items) {
  const msgs = Array.isArray(items) ? items : [];
  const n = msgs.length;
  const firstId = n ? String(msgs[0]?.id || '') : '';
  const last = n ? msgs[n - 1] : null;
  const lastId = last ? String(last?.id || '') : '';
  const lastTs = last ? Number(last?.createdAt || 0) : 0;
  const lastLen = last ? Number(String(last?.text || '').length) : 0;
  return `${String(threadId || '')}|${n}|${firstId}|${lastId}|${lastTs}|${lastLen}`;
}

function askQueueSignature(threadId, items) {
  const queue = Array.isArray(items) ? items : [];
  const parts = queue.map((it) => {
    const id = String(it?.id || '');
    const status = String(it?.status || '');
    const updatedAt = Number(it?.updatedAt || 0);
    const err = it?.error ? String(it.error) : '';
    return `${id}:${status}:${updatedAt}:${err}`;
  });
  return `${String(threadId || '')}|${parts.join('|')}`;
}

function sessionLabel(s) {
  if (!s) return t('placeholder.none');
  const provider = s.provider || 'provider?';
  const shortId = s.id ? `${s.id.slice(0, 8)}…` : 'id?';
  return `${provider} ${shortId}`;
}

function formatSandbox(value) {
  const v = String(value || '').trim();
  if (!v) return t('placeholder.none');
  if (v === 'read-only') return t('sandbox.read_only');
  if (v === 'workspace-write') return t('sandbox.workspace_write');
  if (v === 'danger-full-access') return t('sandbox.danger_full_access');
  return v;
}

const MODEL_LIST_IDS = {
  codex: 'modelOptionsCodex',
  claude: 'modelOptionsClaude',
};

function modelListIdForProvider(provider) {
  const p = String(provider || '').trim().toLowerCase();
  return MODEL_LIST_IDS[p] || '';
}

function setModelInputProvider(inputEl, provider) {
  if (!inputEl) return;
  const id = modelListIdForProvider(provider);
  if (id) inputEl.setAttribute('list', id);
  else inputEl.removeAttribute('list');
}

function getModelPresets(provider) {
  const listId = modelListIdForProvider(provider);
  if (!listId) return [];
  const listEl = document.getElementById(listId);
  if (!listEl) return [];
  return Array.from(listEl.querySelectorAll('option'))
    .map((opt) => String(opt.value || '').trim())
    .filter(Boolean);
}

function refreshModelPresetSelect(selectEl, inputEl, provider) {
  if (!selectEl || !inputEl) return;
  const presets = getModelPresets(provider);

  selectEl.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.dataset.i18n = 'model.preset_placeholder';
  placeholder.textContent = t('model.preset_placeholder');
  selectEl.appendChild(placeholder);

  for (const model of presets) {
    const opt = document.createElement('option');
    opt.value = model;
    opt.textContent = model;
    selectEl.appendChild(opt);
  }

  const current = String(inputEl.value || '').trim();
  selectEl.value = current;
  if (selectEl.value !== current) selectEl.value = '';
  selectEl.disabled = presets.length === 0;
}

function syncModelPresetSelectToInput(selectEl, inputEl) {
  if (!selectEl || !inputEl) return;
  const v = String(inputEl.value || '').trim();
  selectEl.value = v;
  if (selectEl.value !== v) selectEl.value = '';
}

function pickBestSession(role) {
  const candidates = state.sessions
    .filter((s) => s.role === role)
    .slice()
    .sort((a, b) => {
      const at = Number(a.lastActiveAt || a.createdAt || 0);
      const bt = Number(b.lastActiveAt || b.createdAt || 0);
      return bt - at;
    });
  return candidates[0] || null;
}

function renderSelectedSessionInfo() {
  const managerBox = q('#managerSessionInfo');
  const executorBox = q('#executorSessionInfo');
  const managerRaw = q('#managerSessionInfoRaw');
  const executorRaw = q('#executorSessionInfoRaw');
  if (!managerBox || !executorBox) return;

  const managerId = q('#managerSessionSelect')?.value || '';
  const executorId = q('#executorSessionSelect')?.value || '';
  const manager = managerId ? getSessionById(managerId) : null;
  const executor = executorId ? getSessionById(executorId) : null;

  function renderOne(container, rawContainer, s) {
    container.innerHTML = '';
    if (rawContainer) rawContainer.textContent = '';
    if (!s) {
      container.textContent = t('placeholder.none');
      if (rawContainer) rawContainer.textContent = t('placeholder.none');
      return;
    }

    const cfg = readConfigJson(s.configJson);

    const kv = document.createElement('div');
    kv.className = 'kv kv--wrap kv--compact';

    function addRow(k, v, { mono } = {}) {
      const kk = document.createElement('div');
      kk.className = 'kv__k';
      kk.textContent = k;
      const vv = document.createElement('div');
      vv.className = 'kv__v';
      if (mono) vv.classList.add('mono');
      vv.textContent = v;
      kv.appendChild(kk);
      kv.appendChild(vv);
    }

    addRow(t('session_info.k.session'), sessionLabel(s), { mono: true });
    addRow(t('session_info.k.id'), s.id || t('placeholder.none'), { mono: true });
    addRow(t('session_info.k.role'), `${getRoleLabel(s.role)} (${s.role})`);
    addRow(t('session_info.k.provider'), s.provider || t('placeholder.none'), { mono: true });
    addRow(t('label.provider_session_id'), s.providerSessionId || t('placeholder.none'), { mono: true });
    addRow(t('label.mode'), cfg.mode || t('placeholder.default'), { mono: true });
    addRow(t('label.model'), cfg.model || t('placeholder.default'), { mono: true });
    addRow(t('session_info.k.sandbox'), formatSandbox(cfg.sandbox), { mono: true });
    addRow(t('session_info.k.prompt'), cfg.systemPromptPath || t('placeholder.none'), { mono: true });
    addRow(t('session_info.k.created_at'), formatTs(s.createdAt), { mono: true });
    addRow(
      t('session_info.k.last_active_at'),
      s.lastActiveAt ? formatTs(s.lastActiveAt) : t('placeholder.none'),
      { mono: true }
    );

    container.appendChild(kv);

    if (rawContainer) rawContainer.textContent = JSON.stringify(cfg, null, 2);
  }

  renderOne(managerBox, managerRaw, manager);
  renderOne(executorBox, executorRaw, executor);
}

function renderWorkspaceHeader() {
  const ws = selectedWorkspace();
  q('#wsName').textContent = ws?.name || '-';
  q('#wsRoot').textContent = ws?.rootPath || '-';
  q('#wsPlan').textContent = ws?.planPath || '-';
  q('#wsConvention').textContent = ws?.conventionPath || '-';
}

function isOnboardingHidden() {
  return getStoredBool(ONBOARDING_HIDE_KEY, false);
}

function setOnboardingHidden(hidden) {
  setStoredBool(ONBOARDING_HIDE_KEY, Boolean(hidden));
}

function shouldShowOnboarding() {
  return state.page === 'dashboard' && state.workspaces.length === 0 && !isOnboardingHidden();
}

function renderOnboarding() {
  const card = mustGetEl('#onboardingEmptyWorkspace');
  const show = shouldShowOnboarding();
  card.classList.toggle('hidden', !show);

  const tokenInput = mustGetEl('#adminToken');
  const addWorkspaceBtn = mustGetEl('#addWorkspaceBtn');
  [tokenInput, addWorkspaceBtn].forEach((el) => el.classList.toggle('onboarding-highlight', show));
}

function renderWorkspacesSelect() {
  const select = q('#workspaceSelect');
  select.innerHTML = '';
  const editBtn = mustGetEl('#editWorkspaceBtn');

  if (!state.workspaces.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = t('placeholder.no_workspaces');
    select.appendChild(opt);
    state.workspaceId = null;
    renderWorkspaceHeader();
    setStoredWorkspaceId(null);
    syncWorkspaceIdToUrl(null);
    editBtn.disabled = true;
    editBtn.setAttribute('aria-disabled', 'true');
    renderOnboarding();
    return;
  }

  const workspaceIdSet = new Set(state.workspaces.map((w) => String(w?.id || '').trim()).filter(Boolean));
  const isValidWorkspaceId = (id) => {
    const v = String(id || '').trim();
    return v && workspaceIdSet.has(v);
  };

  if (!isValidWorkspaceId(state.workspaceId)) {
    const fallbackId = getStoredWorkspaceMruIds().find((id) => isValidWorkspaceId(id)) || state.workspaces[0].id;
    state.workspaceId = fallbackId;
  }

  bumpWorkspaceMru(state.workspaceId);
  const orderedWorkspaces = orderWorkspacesByMru(state.workspaces, getStoredWorkspaceMruIds());

  for (const ws of orderedWorkspaces) {
    const opt = document.createElement('option');
    opt.value = ws.id;
    opt.textContent = ws.name;
    select.appendChild(opt);
  }

  select.value = state.workspaceId;
  renderWorkspaceHeader();
  setStoredWorkspaceId(state.workspaceId);
  syncWorkspaceIdToUrl(state.workspaceId);
  editBtn.disabled = false;
  editBtn.setAttribute('aria-disabled', 'false');
  renderOnboarding();
}

function renderSessions() {
  const managerSelect = q('#managerSessionSelect');
  const executorSelect = q('#executorSessionSelect');
  const prevManagerId = state.managerSessionId || managerSelect.value;
  const prevExecutorId = state.executorSessionId || executorSelect.value;
  managerSelect.innerHTML = '';
  executorSelect.innerHTML = '';

  const managers = state.sessions.filter((s) => s.role === 'manager');
  const executors = state.sessions.filter((s) => s.role === 'executor');

  if (!managers.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = t('placeholder.none');
    managerSelect.appendChild(opt);
  }
  for (const s of managers) {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = sessionLabel(s);
    managerSelect.appendChild(opt);
  }

  if (!executors.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = t('placeholder.none');
    executorSelect.appendChild(opt);
  }
  for (const s of executors) {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = sessionLabel(s);
    executorSelect.appendChild(opt);
  }

  if (prevManagerId && managers.some((s) => s.id === prevManagerId)) managerSelect.value = prevManagerId;
  if (prevExecutorId && executors.some((s) => s.id === prevExecutorId)) executorSelect.value = prevExecutorId;
  state.managerSessionId = managerSelect.value || null;
  state.executorSessionId = executorSelect.value || null;

  const list = q('#sessionsList');
  if (!state.sessions.length) {
    list.textContent = t('placeholder.no_sessions');
  } else {
    list.innerHTML = state.sessions
      .map((s) => {
        let cfg = {};
        try {
          cfg = JSON.parse(s.configJson || '{}') || {};
        } catch {
          cfg = {};
        }
        const mode = cfg.mode || t('placeholder.default');
        const model = cfg.model || t('placeholder.default');
        const roleLabel = getRoleLabel(s.role);
        return `<div class="list__item">
  <div class="list__title">${roleLabel} · ${s.provider}</div>
  <div class="list__meta mono">${s.id}</div>
  <div class="list__meta">${t('label.mode')}: <span class="mono">${mode}</span> · ${t('label.model')}: <span class="mono">${model}</span></div>
  <div class="list__meta">${t('label.provider_session_id')}: <span class="mono">${s.providerSessionId || t('placeholder.none')}</span></div>
  <div class="list__meta mono">${JSON.stringify(cfg)}</div>
</div>`;
      })
      .join('');
  }

  const editSelect = q('#editSessionSelect');
  if (editSelect) {
    editSelect.innerHTML = '';
    if (!state.sessions.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = t('placeholder.no_sessions');
      editSelect.appendChild(opt);
    } else {
      for (const s of state.sessions) {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = `${getRoleLabel(s.role)} · ${s.provider} · ${s.id.slice(0, 8)}…`;
        editSelect.appendChild(opt);
      }
    }
    if (editSelect.value) fillEditSessionForm(editSelect.value);
  }

  renderSelectedSessionInfo();
}

function renderRollovers() {
  const host = q('#rolloversList');
  if (!host) return;
  if (!state.rollovers.length) {
    host.textContent = t('placeholder.no_rollovers');
    return;
  }
  host.innerHTML = state.rollovers
    .slice(0, 200)
    .map((r) => {
      const createdAt = formatTs(r.createdAt);
      const reason = r.reason ? String(r.reason) : '';
      const roleLabel = getRoleLabel(r.role);
      return `<div class="list__item">
  <div class="list__title">${roleLabel} · ${r.provider} · ${createdAt}</div>
  <div class="list__meta mono">${t('label.from')}: ${r.fromSessionId} → ${t('label.to')}: ${r.toSessionId}</div>
  <div class="list__meta mono">${t('label.run_id')}: ${r.runId || t('placeholder.none')}</div>
  <div class="list__meta">${reason || ''}</div>
</div>`;
    })
    .join('');
}

function renderRuns() {
  const select = q('#runSelect');
  select.innerHTML = '';

  if (!state.runs.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = t('placeholder.no_runs');
    select.appendChild(opt);
    state.runId = null;
    renderRunHeader();
    return;
  }

  for (const r of state.runs) {
    const opt = document.createElement('option');
    opt.value = r.id;
    opt.textContent = `${formatStatus(r.status)} #${r.turnIndex} ${r.id.slice(0, 8)}…`;
    select.appendChild(opt);
  }

  if (!state.runId || !selectedRun()) state.runId = state.runs[0].id;
  select.value = state.runId;
  renderRunHeader();
}

function renderRunHeader() {
  const run = state.runDetail || selectedRun();
  q('#runStatus').textContent = run
    ? `${formatStatus(run.status)}${run.error ? ` (${formatRunError(run.error)})` : ''}`
    : '-';
  q('#runTurn').textContent = run ? String(run.turnIndex ?? '-') : '-';
}

function renderFeedsFromRunDetail() {
  const run = state.runDetail;
  if (!run) {
    q('#managerFeed').textContent = t('placeholder.no_run_selected');
    q('#executorFeed').textContent = t('placeholder.no_run_selected');
    return;
  }

  const managerLines = [];
  const executorLines = [];

  for (const turn of run.turns || []) {
    if (turn.managerOutput) {
      managerLines.push(`=== ${t('label.turn')} ${turn.idx} ===\n${turn.managerOutput}\n`);
    }
    if (turn.executorOutput) {
      executorLines.push(`=== ${t('label.turn')} ${turn.idx} ===\n${turn.executorOutput}\n`);
    }
  }

  q('#managerFeed').textContent = managerLines.join('\n') || t('placeholder.no_manager_output_yet');
  q('#executorFeed').textContent = executorLines.join('\n') || t('placeholder.no_executor_output_yet');
}

function renderEvents() {
  const last = state.events.slice(-400);
  q('#eventsFeed').textContent =
    last.map((e) => JSON.stringify({ seq: e.seq, ts: e.ts, role: e.role, kind: e.kind, payload: e.payload })).join('\n') ||
    t('placeholder.no_events_yet');
}

function renderHistory() {
  renderHistoryLayout();

  const filter = q('#historyFilter').value.trim().toLowerCase();
  const items = (state.runs || []).filter((r) => {
    if (!filter) return true;
    return String(r.id).toLowerCase().includes(filter) || String(r.status).toLowerCase().includes(filter);
  });

  const host = q('#historyList');
  if (!items.length) {
    host.textContent = t('placeholder.no_runs');
    return;
  }
  host.innerHTML = items
    .map(
      (r) => `<div class="list__item">
  <div class="list__title">${formatStatus(r.status)} · ${t('label.turn')} ${r.turnIndex}</div>
  <div class="list__meta mono">${r.id}</div>
  <div class="list__meta">${t('label.created')}: ${formatTs(r.createdAt)} · ${t('label.started')}: ${formatTs(r.startedAt)} · ${t('label.ended')}: ${formatTs(r.endedAt)}</div>
  <div class="row">
    <button class="btn btn--ghost" data-action="view-run" data-run-id="${r.id}">${t('label.view')}</button>
    <button class="btn btn--ghost" data-action="dashboard-run" data-run-id="${r.id}">${t('label.dashboard')}</button>
  </div>
</div>`
    )
    .join('');
}

function renderHistoryLayout() {
  const grid = q('#historyGrid');
  if (!grid) return;

  const collapsed = Boolean(state.historyListCollapsed);
  grid.classList.toggle('grid2--collapsed', collapsed);

  const panel = q('#historyListPanel');
  if (panel) panel.classList.toggle('hidden', collapsed);

  const btn = q('#historyToggleListBtn');
  if (btn) {
    btn.textContent = collapsed ? t('history.toggle_list_show') : t('history.toggle_list_hide');
    btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    btn.setAttribute('aria-controls', 'historyListPanel');
  }
}

function escapeHtml(s) {
  return String(s || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function safeMarkdownLinkHref(rawUrl) {
  const s = String(rawUrl || '').trim();
  if (!s) return '';
  const unwrapped = s.startsWith('<') && s.endsWith('>') ? s.slice(1, -1).trim() : s;
  try {
    const u = new URL(unwrapped, window.location.origin);
    if (['http:', 'https:', 'mailto:'].includes(u.protocol)) return u.href;
  } catch {}
  return '';
}

function extractMarkdownCodeSpans(text) {
  const codes = [];
  const replaced = String(text || '').replace(/`([^`\n]+)`/g, (_, code) => {
    const idx = codes.push(String(code)) - 1;
    return `@@MD_CODE_${idx}@@`;
  });
  return { text: replaced, codes };
}

function extractMarkdownLinks(text) {
  const links = [];
  const replaced = String(text || '').replace(/\[([^\]\n]+)\]\(([^)\n]+)\)/g, (_, label, url) => {
    const idx = links.push({ label: String(label), url: String(url) }) - 1;
    return `@@MD_LINK_${idx}@@`;
  });
  return { text: replaced, links };
}

function renderMarkdownInline(rawText) {
  const raw = String(rawText || '');
  const { text: withCodes, codes } = extractMarkdownCodeSpans(raw);
  const { text: withLinks, links } = extractMarkdownLinks(withCodes);

  let out = escapeHtml(withLinks);

  // Bold / italic (minimal, safe).
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');

  // Restore links.
  out = out.replace(/@@MD_LINK_(\d+)@@/g, (_, i) => {
    const link = links[Number(i)];
    if (!link) return '';
    const href = safeMarkdownLinkHref(link.url);
    const label = escapeHtml(link.label);
    if (!href) return label;
    return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });

  // Restore code spans.
  out = out.replace(/@@MD_CODE_(\d+)@@/g, (_, i) => {
    const code = codes[Number(i)] ?? '';
    return `<code class="md__code">${escapeHtml(code)}</code>`;
  });

  return out;
}

function renderMarkdownSafe(rawText) {
  const src = String(rawText || '').replace(/\r\n?/g, '\n');
  if (!src) return '';
  const lines = src.split('\n');
  const blocks = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';

    const fence = line.match(/^```(\S*)\s*$/);
    if (fence) {
      const lang = String(fence[1] || '').trim();
      i += 1;
      const codeLines = [];
      while (i < lines.length && !String(lines[i] || '').match(/^```\s*$/)) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length && String(lines[i] || '').match(/^```\s*$/)) i += 1;
      const cls = lang ? ` class="language-${escapeHtml(lang)}"` : '';
      blocks.push(`<pre class="md__pre"><code${cls}>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
      continue;
    }

    if (!String(line || '').trim()) {
      i += 1;
      continue;
    }

    const heading = String(line || '').match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      blocks.push(`<h${level} class="md__h">${renderMarkdownInline(heading[2])}</h${level}>`);
      i += 1;
      continue;
    }

    if (String(line || '').match(/^>\s?/)) {
      const quoteLines = [];
      while (i < lines.length && String(lines[i] || '').match(/^>\s?/)) {
        quoteLines.push(String(lines[i] || '').replace(/^>\s?/, ''));
        i += 1;
      }
      const inner = renderMarkdownInline(quoteLines.join('\n')).replace(/\n/g, '<br>');
      blocks.push(`<blockquote class="md__blockquote">${inner}</blockquote>`);
      continue;
    }

    if (String(line || '').match(/^\s*[-+*]\s+/)) {
      const items = [];
      while (i < lines.length) {
        const m = String(lines[i] || '').match(/^\s*[-+*]\s+(.*)$/);
        if (!m) break;
        items.push(`<li>${renderMarkdownInline(m[1])}</li>`);
        i += 1;
      }
      blocks.push(`<ul class="md__ul">${items.join('')}</ul>`);
      continue;
    }

    if (String(line || '').match(/^\s*\d+\.\s+/)) {
      const items = [];
      while (i < lines.length) {
        const m = String(lines[i] || '').match(/^\s*\d+\.\s+(.*)$/);
        if (!m) break;
        items.push(`<li>${renderMarkdownInline(m[1])}</li>`);
        i += 1;
      }
      blocks.push(`<ol class="md__ol">${items.join('')}</ol>`);
      continue;
    }

    const paraLines = [line];
    i += 1;
    while (i < lines.length) {
      const next = String(lines[i] || '');
      if (!next.trim()) break;
      if (next.match(/^```/)) break;
      if (next.match(/^(#{1,6})\s+/)) break;
      if (next.match(/^>\s?/)) break;
      if (next.match(/^\s*[-+*]\s+/)) break;
      if (next.match(/^\s*\d+\.\s+/)) break;
      paraLines.push(next);
      i += 1;
    }
    const html = renderMarkdownInline(paraLines.join('\n')).replace(/\n/g, '<br>');
    blocks.push(`<p class="md__p">${html}</p>`);
  }

  return blocks.join('');
}

function isLongText(text, { maxChars = 1400, maxLines = 3 } = {}) {
  const t0 = String(text || '');
  if (t0.length > maxChars) return true;
  const lines = t0.split(/\r?\n/g).length;
  return lines > maxLines;
}

function previewLines(text, maxLines = 3) {
  const t0 = String(text || '').replaceAll('\r', '');
  const lines = t0.split('\n');
  if (lines.length <= maxLines) return t0.trimEnd();

  const picked = lines.slice(0, maxLines);
  const lastIdx = picked.length - 1;
  const last = String(picked[lastIdx] || '').trimEnd();
  picked[lastIdx] = last ? `${last} …` : '…';
  return picked.join('\n').trimEnd();
}

function renderHistoryDetail() {
  const host = q('#historyDetail');
  const run = state.historyRunDetail;
  if (!run) {
    host.textContent = t('placeholder.select_a_run');
    return;
  }

  const query = q('#historyTurnSearch').value.trim().toLowerCase();
  const turns = (run.turns || []).filter((t) => {
    if (!query) return true;
    const hay = `${t.managerPromptPreview || ''}\n${t.managerOutput || ''}\n${t.executorPromptPreview || ''}\n${t.executorOutput || ''}`.toLowerCase();
    return hay.includes(query);
  });

  if (!turns.length) {
    host.textContent = t('placeholder.no_matching_turns');
    return;
  }

  host.innerHTML = turns
    .map((turn) => {
      const mpRaw = String(turn.managerPromptPreview || '');
      const epRaw = String(turn.executorPromptPreview || '');
      const moRaw = String(turn.managerOutput || '');
      const eoRaw = String(turn.executorOutput || '');
      const mmRaw = JSON.stringify(turn.managerMeta || {}, null, 2);
      const emRaw = JSON.stringify(turn.executorMeta || {}, null, 2);

      const mp = escapeHtml(mpRaw);
      const mo = escapeHtml(moRaw);
      const mm = escapeHtml(JSON.stringify(turn.managerMeta || {}, null, 2));
      const ep = escapeHtml(epRaw);
      const eo = escapeHtml(eoRaw);
      const em = escapeHtml(JSON.stringify(turn.executorMeta || {}, null, 2));

      const mpPreview = escapeHtml(previewLines(mpRaw, 3));
      const moPreview = escapeHtml(previewLines(moRaw, 3));
      const mmPreview = escapeHtml(previewLines(mmRaw, 3));
      const epPreview = escapeHtml(previewLines(epRaw, 3));
      const eoPreview = escapeHtml(previewLines(eoRaw, 3));
      const emPreview = escapeHtml(previewLines(emRaw, 3));

      const emptyHtml = escapeHtml(t('placeholder.empty'));
      const mpBody = state.historyRenderMarkdown
        ? `<div class="pre pre--manager md">${renderMarkdownSafe(mpRaw) || emptyHtml}</div>`
        : `<pre class="pre pre--manager">${mp || t('placeholder.empty')}</pre>`;
      const moBody = state.historyRenderMarkdown
        ? `<div class="pre pre--manager md">${renderMarkdownSafe(moRaw) || emptyHtml}</div>`
        : `<pre class="pre pre--manager">${mo || t('placeholder.empty')}</pre>`;
      const epBody = state.historyRenderMarkdown
        ? `<div class="pre pre--executor md">${renderMarkdownSafe(epRaw) || emptyHtml}</div>`
        : `<pre class="pre pre--executor">${ep || t('placeholder.empty')}</pre>`;
      const eoBody = state.historyRenderMarkdown
        ? `<div class="pre pre--executor md">${renderMarkdownSafe(eoRaw) || emptyHtml}</div>`
        : `<pre class="pre pre--executor">${eo || t('placeholder.empty')}</pre>`;

      return `<div class="list__item">
  <div class="list__title">${t('label.turn')} ${turn.idx}</div>
  <details>
    <summary class="hist__summary">
      <span class="mono">${t('label.manager_prompt')}</span>
      <span class="hist__summaryPreview">${mpPreview}</span>
    </summary>
    ${mpBody}
  </details>
  <details>
    <summary class="hist__summary">
      <span class="mono">${t('label.manager_output')}</span>
      <span class="hist__summaryPreview">${moPreview}</span>
    </summary>
    ${moBody}
  </details>
  <details>
    <summary class="hist__summary">
      <span class="mono">${t('label.manager_meta')}</span>
      <span class="hist__summaryPreview">${mmPreview}</span>
    </summary>
    <pre class="pre pre--meta">${mm}</pre>
  </details>
  <details>
    <summary class="hist__summary">
      <span class="mono">${t('label.executor_prompt')}</span>
      <span class="hist__summaryPreview">${epPreview}</span>
    </summary>
    ${epBody}
  </details>
  <details>
    <summary class="hist__summary">
      <span class="mono">${t('label.executor_output')}</span>
      <span class="hist__summaryPreview">${eoPreview}</span>
    </summary>
    ${eoBody}
  </details>
  <details>
    <summary class="hist__summary">
      <span class="mono">${t('label.executor_meta')}</span>
      <span class="hist__summaryPreview">${emPreview}</span>
    </summary>
    <pre class="pre pre--meta">${em}</pre>
  </details>
</div>`;
    })
    .join('');
}

function renderAskLayout() {
  const grid = q('#askGrid');
  if (!grid) return;

  const threadsCollapsed = Boolean(state.askThreadsCollapsed);
  const configCollapsed = Boolean(state.askConfigCollapsed);

  const threadsPanel = q('#askThreadsPanel');
  const configPanel = q('#askConfigPanel');
  if (threadsPanel) threadsPanel.classList.toggle('hidden', threadsCollapsed);
  if (configPanel) configPanel.classList.toggle('hidden', configCollapsed);

  grid.classList.toggle('askGrid--threadsCollapsed', threadsCollapsed);
  grid.classList.toggle('askGrid--configCollapsed', configCollapsed);

  const btnThreads = q('#askToggleThreadsBtn');
  if (btnThreads) {
    btnThreads.textContent = threadsCollapsed ? t('ask.toggle_threads_show') : t('ask.toggle_threads_hide');
    btnThreads.setAttribute('aria-expanded', threadsCollapsed ? 'false' : 'true');
    btnThreads.setAttribute('aria-controls', 'askThreadsPanel');
  }

  const btnConfig = q('#askToggleConfigBtn');
  if (btnConfig) {
    btnConfig.textContent = configCollapsed ? t('ask.toggle_config_show') : t('ask.toggle_config_hide');
    btnConfig.setAttribute('aria-expanded', configCollapsed ? 'false' : 'true');
    btnConfig.setAttribute('aria-controls', 'askConfigPanel');
  }
}

function reportAskRenderError(err, context) {
  const msg = `ASK_RENDER_ERROR · ${context} · ${err?.message || err}`;
  state.askDebugText = msg;
  try {
    toast(msg);
  } catch {}
  const debug = q('#askDebug');
  if (debug) debug.textContent = msg;
}

function preserveAskInputSelection(fn) {
  const input = q('#askInput');
  const isActive = input && document.activeElement === input;
  const start = isActive ? input.selectionStart : null;
  const end = isActive ? input.selectionEnd : null;
  fn();
  if (!isActive || !input) return;
  try {
    if (document.activeElement !== input) input.focus({ preventScroll: true });
    if (Number.isFinite(start) && Number.isFinite(end)) input.setSelectionRange(start, end);
  } catch {}
}

function getAskStatusInfo(thread, { isSelected = false } = {}) {
  const statuses = {
    idle: { label: t('ask.status_idle'), className: 'pill--status-idle' },
    sending: { label: t('ask.status_sending'), className: 'pill--status-sending' },
    recovering: { label: t('ask.status_recovering'), className: 'pill--status-recovering' },
    failed: { label: t('ask.status_failed'), className: 'pill--status-failed' },
  };

  if (!thread) return { key: 'idle', ...statuses.idle };

  const busy = Boolean(thread.busy);
  const sending = Boolean(isSelected && state.askSendInFlight);
  const recovering = Boolean(isSelected && state.askRecovering);
  const hasError = Boolean(isSelected && state.askDebugText);

  let key = 'idle';
  if (hasError && !sending && !recovering && !busy) key = 'failed';
  else if (recovering) key = 'recovering';
  else if (sending || busy) key = 'sending';

  const info = statuses[key];
  if (!info) throw new Error(`ASK_STATUS_UNKNOWN: ${key}`);
  return { key, ...info };
}

function formatElapsedMs(ms) {
  if (!Number.isFinite(ms) || ms < 0) return null;
  return `${(ms / 1000).toFixed(1)}s`;
}

function getAskElapsedInfo(thread) {
  const label = t('ask.elapsed_label');
  if (!thread || state.askLastSendThreadId !== thread.id || !state.askLastSendStartedAt) {
    return { text: `${label} —`, title: t('ask.elapsed_unavailable') };
  }
  if (!state.askLastSendEndedAt) {
    return { text: `${label} —`, title: t('ask.elapsed_pending') };
  }
  const ms =
    state.askLastSendElapsedMs ??
    (state.askLastSendStartedAt && state.askLastSendEndedAt
      ? state.askLastSendEndedAt - state.askLastSendStartedAt
      : null);
  const formatted = formatElapsedMs(ms);
  if (!formatted) return { text: `${label} —`, title: t('ask.elapsed_unavailable') };
  const title = `${formatTs(state.askLastSendStartedAt)} → ${formatTs(state.askLastSendEndedAt)}`;
  return { text: `${label} ${formatted}`, title };
}

function readAskUsageFromMeta(meta) {
  if (!meta) return null;
  const usage = meta.usage || {};
  const prompt =
    usage.prompt ??
    usage.prompt_tokens ??
    meta.prompt_tokens ??
    usage.input_tokens ??
    meta.input_tokens ??
    meta.promptTokens ??
    null;
  const completion =
    usage.completion ??
    usage.completion_tokens ??
    meta.completion_tokens ??
    usage.output_tokens ??
    meta.output_tokens ??
    meta.completionTokens ??
    null;
  let total =
    usage.total ??
    usage.total_tokens ??
    meta.total_tokens ??
    meta.totalTokens ??
    null;
  const hasPrompt = Number.isFinite(Number(prompt));
  const hasCompletion = Number.isFinite(Number(completion));
  const hasTotal = Number.isFinite(Number(total));
  if (!hasTotal && hasPrompt && hasCompletion) total = Number(prompt) + Number(completion);

  if (!hasPrompt && !hasCompletion && !Number.isFinite(Number(total))) return null;
  return {
    prompt: hasPrompt ? Number(prompt) : null,
    completion: hasCompletion ? Number(completion) : null,
    total: Number.isFinite(Number(total)) ? Number(total) : null,
  };
}

function getAskUsageInfo(thread) {
  const label = t('ask.usage_label');
  if (!thread) return { text: `${label} —`, title: t('ask.usage_unavailable') };
  const msgs = state.askMessages || [];
  const lastAssistant = [...msgs].reverse().find((m) => {
    if (String(m?.threadId || '') !== String(thread.id || '')) return false;
    return String(m?.role || '').toLowerCase() === 'assistant';
  });
  const usage = readAskUsageFromMeta(lastAssistant?.meta);
  if (!usage) return { text: `${label} —`, title: t('ask.usage_unavailable') };

  const parts = [];
  if (Number.isFinite(Number(usage.prompt))) parts.push(`P:${usage.prompt}`);
  if (Number.isFinite(Number(usage.completion))) parts.push(`C:${usage.completion}`);
  if (Number.isFinite(Number(usage.total))) parts.push(`T:${usage.total}`);

  const detail = parts.join(' ');
  return { text: `${label} ${detail}`, title: detail || t('ask.usage_unavailable') };
}

function renderAskStatusPill(thread) {
  const pill = q('#askStatusPill');
  if (!pill) return;
  let info = null;
  try {
    info = getAskStatusInfo(thread, { isSelected: Boolean(thread && thread.id === state.askThreadId) });
  } catch (err) {
    reportAskRenderError(err, `renderAskStatusPill · threadId=${thread?.id || '-'}`);
    throw err;
  }
  pill.textContent = info.label;
  pill.classList.remove('pill--status-idle', 'pill--status-sending', 'pill--status-recovering', 'pill--status-failed');
  pill.classList.add('pill--status', info.className);
}

function renderAskStatusMeta(thread) {
  const elapsedEl = q('#askElapsed');
  const usageEl = q('#askUsage');
  if (elapsedEl) {
    const elapsed = getAskElapsedInfo(thread);
    elapsedEl.textContent = elapsed.text;
    elapsedEl.title = elapsed.title || '';
  }
  if (usageEl) {
    const usage = getAskUsageInfo(thread);
    usageEl.textContent = usage.text;
    usageEl.title = usage.title || '';
  }
}

function renderAskDebugText() {
  const debug = q('#askDebug');
  if (!debug) return;
  debug.textContent = state.askDebugText ? state.askDebugText : t('placeholder.none');
}

function updateAskElapsedFromMessages(threadId, items) {
  if (!state.askLastSendStartedAt) return;
  if (state.askLastSendThreadId !== threadId) return;
  if (state.askLastSendEndedAt) return;

  const startedAt = Number(state.askLastSendStartedAt);
  if (!Number.isFinite(startedAt)) return;
  const match = (items || []).find((m) => {
    if (!m) return false;
    const role = String(m.role || '').toLowerCase();
    if (role !== 'assistant') return false;
    const createdAt = Number(m.createdAt || 0);
    return Number.isFinite(createdAt) && createdAt >= startedAt;
  });
  if (!match) return;
  const endedAt = Number(match.createdAt || 0);
  if (!Number.isFinite(endedAt)) return;
  state.askLastSendEndedAt = endedAt;
  state.askLastSendElapsedMs = endedAt - startedAt;
}

function finalizeAskElapsedNow() {
  if (!state.askLastSendStartedAt || state.askLastSendEndedAt) return;
  const endedAt = Date.now();
  state.askLastSendEndedAt = endedAt;
  state.askLastSendElapsedMs = endedAt - Number(state.askLastSendStartedAt);
}

function renderAskRuntimeControls(thread) {
  const sendBtn = mustGetEl('#askSendBtn');
  const stopBtn = mustGetEl('#askStopBtn');

  renderAskStatusPill(thread);
  renderAskStatusMeta(thread);
  renderAskDebugText();

  if (!thread) {
    sendBtn.disabled = true;
    sendBtn.textContent = t('ask.send');
    stopBtn.disabled = true;
    stopBtn.textContent = t('ask.stop');
    return;
  }

  sendBtn.disabled = Boolean(state.askSendInFlight);
  sendBtn.textContent = state.askSendInFlight ? t('ask.send_sending') : t('ask.send');
  stopBtn.disabled = !Boolean(thread.busy);
  stopBtn.textContent = t('ask.stop');
}

function renderAskPanelOnly(context) {
  const ctx = String(context || 'ASK_PANEL_ONLY');
  try {
    mustGetEl('#askMessages');
    mustGetEl('#askQueue');
    mustGetEl('#askStatusPill');
    mustGetEl('#askSendBtn');
    mustGetEl('#askStopBtn');
  } catch (err) {
    reportAskRenderError(err, ctx);
    throw err;
  }
  preserveAskInputSelection(() => {
    renderAskMessages();
    renderAskQueue();
    renderAskRuntimeControls(selectedAskThread());
  });
}

function renderAskThreads() {
  renderAskLayout();

  const host = q('#askThreadsList');
  if (!host) return;

  if (!state.workspaceId) {
    host.textContent = t('placeholder.no_workspaces');
    return;
  }
  if (!getAdminToken()) {
    host.textContent = t('toast.ADMIN_TOKEN_REQUIRED');
    return;
  }

  const filter = String(state.askThreadFilter || '').trim().toLowerCase();
  const threads = (state.askThreads || []).filter((th) => {
    if (!filter) return true;
    return (
      String(th.title || '').toLowerCase().includes(filter) ||
      String(th.id || '').toLowerCase().includes(filter) ||
      String(th.providerSessionId || '').toLowerCase().includes(filter)
    );
  });

  if (!threads.length) {
    host.textContent = t('placeholder.no_data');
    return;
  }

  host.innerHTML = threads
    .map((th) => {
      const selected = th.id === state.askThreadId;
      const title = escapeHtml(th.title || '(untitled)');
      const statusInfo = getAskStatusInfo(th, { isSelected: selected });
      const status = statusInfo.label;
      const meta = [
        `status=${escapeHtml(status)}`,
        `provider=${escapeHtml(th.provider || '-')}`,
        `last=${escapeHtml(formatTs(th.lastActiveAt || th.updatedAt || th.createdAt))}`,
        th.providerSessionId ? `resume=${escapeHtml(String(th.providerSessionId).slice(0, 10))}…` : 'resume=-',
      ].join(' · ');
      return `<div class="list__item${selected ? ' list__item--selected' : ''}" data-ask-thread-id="${escapeHtml(th.id)}">
  <div class="list__title">${title}</div>
  <div class="list__meta mono">${meta}</div>
  <div class="list__meta mono">${escapeHtml(th.id)}</div>
</div>`;
    })
    .join('');
}

function renderAskMessages() {
  const host = q('#askMessages');
  if (!host) return;

  const wasNearBottom = isNearBottom(host, 80);
  const prevScrollTop = host.scrollTop;

  const thread = selectedAskThread();
  if (!thread) {
    host.textContent = t('placeholder.none');
    return;
  }

  const msgs = state.askMessages || [];
  if (!msgs.length) {
    host.textContent = t('placeholder.no_data');
    return;
  }

  host.innerHTML = msgs
    .map((m) => {
      const role = String(m.role || '').toLowerCase();
      const ts = formatTs(m.createdAt);
      const rawText = String(m.text || '');
      const text = escapeHtml(rawText);
      const outDir = m.meta?.outDir ? escapeHtml(String(m.meta.outDir)) : '';
      const msgId = String(m.id || '');
      const roleLabel = role === 'assistant' ? 'assistant' : role === 'system' ? 'system' : 'user';
      const hasOpen = Object.prototype.hasOwnProperty.call(state.askMessageOpen || {}, msgId);
      const open = hasOpen ? Boolean(state.askMessageOpen[msgId]) : false;
      const openAttr = open ? ' open' : '';
      const preview = escapeHtml(previewLines(rawText, 3));
      const body = state.askRenderMarkdown
        ? `<div class="chat__bubble md">${renderMarkdownSafe(rawText) || ''}</div>`
        : `<pre class="chat__bubble">${text || ''}</pre>`;
      return `<details class="chat__msg chat__msg--${roleLabel}" data-ask-msg-id="${escapeHtml(msgId)}"${openAttr}>
  <summary class="chat__summary">
    <span class="chat__summaryMeta mono">${escapeHtml(roleLabel)} · ${escapeHtml(ts)}</span>
    <span class="chat__summaryPreview">${preview}</span>
  </summary>
  ${outDir ? `<div class="chat__meta mono">outDir: ${outDir}</div>` : ''}
  ${body}
</details>`;
    })
    .join('');

  host.querySelectorAll('details[data-ask-msg-id]').forEach((el) => {
    el.addEventListener('toggle', () => {
      const id = el.dataset.askMsgId;
      if (!id) return;
      state.askMessageOpen[id] = Boolean(el.open);
    });
  });

  // Only stick to bottom if the user was already near bottom (or explicitly requested).
  const force = Boolean(state.askForceScrollToBottom);
  state.askForceScrollToBottom = false;

  try {
    if (force || wasNearBottom) host.scrollTop = host.scrollHeight;
    else host.scrollTop = prevScrollTop;
  } catch {}
}

function renderAskQueue() {
  const host = q('#askQueue');
  if (!host) return;

  if (state.askQueueEditId) {
    try {
      const active = document.activeElement;
      const isTextarea = String(active?.tagName || '').toLowerCase() === 'textarea';
      if (isTextarea && active && typeof active.closest === 'function' && active.closest('#askQueue')) return;
    } catch {}
  }

  const countEl = q('#askQueueCount');
  const thread = selectedAskThread();
  if (!thread) {
    if (countEl) countEl.textContent = '';
    host.textContent = t('placeholder.none');
    return;
  }

  const items = state.askQueueItems || [];
  const counts = { running: 0, queued: 0, error: 0 };
  for (const it of items) {
    const s = String(it?.status || '').toLowerCase();
    if (s === 'running') counts.running += 1;
    else if (s === 'queued') counts.queued += 1;
    else if (s === 'error') counts.error += 1;
  }
  if (countEl) {
    const parts = [];
    if (counts.running) parts.push(`running=${counts.running}`);
    if (counts.queued) parts.push(`queued=${counts.queued}`);
    if (counts.error) parts.push(`error=${counts.error}`);
    countEl.textContent = parts.length ? `(${parts.join(', ')})` : '';
  }

  if (!items.length) {
    host.textContent = t('ask.queue_empty');
    return;
  }

  host.innerHTML = items
    .map((it) => {
      const id = String(it.id || '');
      const status = String(it.status || 'queued').toLowerCase();
      const statusKey = `ask.queue_status_${status}`;
      const statusLabel = t(statusKey) === statusKey ? status : t(statusKey);
      const ts = formatTs(it.createdAt);
      const rawText = String(it.text || '');
      const preview = escapeHtml(previewLines(rawText, 3));
      const textHtml = escapeHtml(rawText);

      const error = it.error ? escapeHtml(String(it.error)) : '';
      const meta = `${escapeHtml(statusLabel)} · ${escapeHtml(ts)}${error ? ` · ${error}` : ''}`;

      const isEditing = state.askQueueEditId === id;
      const hasOpen = Object.prototype.hasOwnProperty.call(state.askQueueItemOpen || {}, id);
      const open = isEditing ? true : hasOpen ? Boolean(state.askQueueItemOpen[id]) : false;
      const openAttr = open ? ' open' : '';

      const actions = (() => {
        if (isEditing) {
          return `<div class="queue__actions">
  <button class="btn btn--accent" data-ask-queue-save="${escapeHtml(id)}">${escapeHtml(t('ask.queue_save'))}</button>
  <button class="btn btn--ghost" data-ask-queue-cancel="${escapeHtml(id)}">${escapeHtml(t('ask.queue_cancel'))}</button>
</div>`;
        }
        if (status === 'queued') {
          return `<div class="queue__actions">
  <button class="btn btn--ghost" data-ask-queue-edit="${escapeHtml(id)}">${escapeHtml(t('ask.queue_edit'))}</button>
  <button class="btn btn--danger" data-ask-queue-delete="${escapeHtml(id)}">${escapeHtml(t('ask.queue_delete'))}</button>
</div>`;
        }
        if (status === 'error') {
          return `<div class="queue__actions">
  <button class="btn btn--danger" data-ask-queue-delete="${escapeHtml(id)}">${escapeHtml(t('ask.queue_delete'))}</button>
</div>`;
        }
        return '';
      })();

      const body = isEditing
        ? `<textarea class="input input--textarea queue__edit" rows="4" data-ask-queue-edit-text="${escapeHtml(id)}">${escapeHtml(
            String(state.askQueueEditText ?? '')
          )}</textarea>${actions}`
        : `<pre class="queue__text">${textHtml || ''}</pre>${actions}`;

      return `<details class="queue__item queue__item--${escapeHtml(status)}" data-ask-queue-id="${escapeHtml(id)}"${openAttr}>
  <summary class="queue__summary">
    <span class="queue__summaryMeta mono">${meta}</span>
    <span class="queue__summaryPreview">${preview}</span>
  </summary>
  ${body}
</details>`;
    })
    .join('');

  host.querySelectorAll('details[data-ask-queue-id]').forEach((el) => {
    el.addEventListener('toggle', () => {
      const id = el.dataset.askQueueId;
      if (!id) return;
      state.askQueueItemOpen[id] = Boolean(el.open);
    });
  });

  host.querySelectorAll('[data-ask-queue-edit]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.dataset.askQueueEdit;
      const item = (state.askQueueItems || []).find((x) => String(x.id) === String(id));
      if (!id || !item) return;
      state.askQueueEditId = String(id);
      state.askQueueEditText = String(item.text || '');
      state.askQueueItemOpen[id] = true;
      renderAskQueue();
    });
  });

  host.querySelectorAll('[data-ask-queue-cancel]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      state.askQueueEditId = null;
      state.askQueueEditText = '';
      renderAskQueue();
    });
  });

  host.querySelectorAll('[data-ask-queue-save]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.dataset.askQueueSave;
      if (!id) return;
      saveAskQueueEditFromUi(id).catch(toast);
    });
  });

  host.querySelectorAll('[data-ask-queue-delete]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.dataset.askQueueDelete;
      if (!id) return;
      deleteAskQueueItemFromUi(id).catch(toast);
    });
  });

  host.querySelectorAll('textarea[data-ask-queue-edit-text]').forEach((ta) => {
    ta.addEventListener('input', () => {
      const id = ta.dataset.askQueueEditText;
      if (!id || state.askQueueEditId !== id) return;
      state.askQueueEditText = ta.value || '';
    });
  });
}

function renderAskThread() {
  const header = q('#askThreadHeader');
  if (!header) return;

  const thread = selectedAskThread();
  const pill = q('#askStatusPill');
  const sendBtn = q('#askSendBtn');
  const stopBtn = q('#askStopBtn');
  const debug = q('#askDebug');
  if (debug) debug.textContent = state.askDebugText ? state.askDebugText : t('placeholder.none');

  if (!thread) {
    header.textContent = t('placeholder.none');
    if (pill) {
      renderAskStatusPill(null);
    }
    renderAskStatusMeta(null);
    if (sendBtn) {
      sendBtn.disabled = true;
      sendBtn.textContent = t('ask.send');
    }
    if (stopBtn) {
      stopBtn.disabled = true;
      stopBtn.textContent = t('ask.stop');
    }
    q('#askThreadId').textContent = '-';
    q('#askResumeId').textContent = '-';
    q('#askProvider').textContent = '-';
    q('#askModelView').textContent = '-';
    q('#askEffortView').textContent = '-';
    q('#askSandboxView').textContent = '-';
    q('#askTitleInput').value = '';
    q('#askModelInput').value = '';
    q('#askEffortSelect').value = '';
    q('#askSandboxSelect').value = 'read-only';
    setModelInputProvider(q('#askModelInput'), 'codex');
    refreshModelPresetSelect(q('#askModelPreset'), q('#askModelInput'), 'codex');
    return;
  }

  const cfg = readConfigJson(thread.configJson);

  header.textContent = `${thread.title || '(untitled)'} · ${thread.id.slice(0, 8)}…`;
  q('#askThreadId').textContent = thread.id;
  q('#askResumeId').textContent = thread.providerSessionId || '-';
  q('#askProvider').textContent = thread.provider || '-';
  q('#askModelView').textContent = cfg.model || '-';
  q('#askEffortView').textContent = cfg.model_reasoning_effort || '-';
  q('#askSandboxView').textContent = cfg.sandbox || '-';

  const titleInput = q('#askTitleInput');
  const modelInput = q('#askModelInput');
  const effortSelect = q('#askEffortSelect');
  const sandboxSelect = q('#askSandboxSelect');
  const modelPreset = q('#askModelPreset');

  const active = (() => {
    try {
      return document.activeElement;
    } catch {
      return null;
    }
  })();

  const nextTitle = String(thread.title || '');
  if (titleInput && active !== titleInput && titleInput.value !== nextTitle) titleInput.value = nextTitle;

  const nextModel = String(cfg.model || '');
  if (modelInput && active !== modelInput && modelInput.value !== nextModel) modelInput.value = nextModel;

  const nextEffort = String(cfg.model_reasoning_effort || '');
  if (effortSelect && active !== effortSelect && effortSelect.value !== nextEffort) effortSelect.value = nextEffort;

  const nextSandbox = String(cfg.sandbox || 'read-only');
  if (sandboxSelect && active !== sandboxSelect && sandboxSelect.value !== nextSandbox) sandboxSelect.value = nextSandbox;

  setModelInputProvider(modelInput, thread.provider);
  if (modelPreset && modelInput && active !== modelPreset && active !== modelInput) {
    refreshModelPresetSelect(modelPreset, modelInput, thread.provider);
  }

  renderAskStatusPill(thread);
  renderAskStatusMeta(thread);

  if (sendBtn) {
    sendBtn.disabled = Boolean(state.askSendInFlight);
    sendBtn.textContent = state.askSendInFlight ? t('ask.send_sending') : t('ask.send');
  }

  if (stopBtn) {
    stopBtn.disabled = !Boolean(thread.busy);
    stopBtn.textContent = t('ask.stop');
  }
}

function normalizeSlashPath(p) {
  return String(p || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/g, '')
    .replace(/\/+$/g, '');
}

function parentRelDir(relDir) {
  const p = normalizeSlashPath(relDir);
  if (!p) return '';
  const parts = p.split('/');
  parts.pop();
  return parts.join('/');
}

function isImageRelPath(relPath) {
  const p = String(relPath || '').toLowerCase();
  return (
    p.endsWith('.png') ||
    p.endsWith('.jpg') ||
    p.endsWith('.jpeg') ||
    p.endsWith('.gif') ||
    p.endsWith('.webp') ||
    p.endsWith('.bmp') ||
    p.endsWith('.ico') ||
    p.endsWith('.avif')
  );
}

function clearFilesImageUrl() {
  if (!state.filesImageUrl) return;
  try {
    URL.revokeObjectURL(state.filesImageUrl);
  } catch {}
  state.filesImageUrl = '';
}

function filesHasUnsavedChanges() {
  if (state.filesSelectedMode !== 'text') return false;
  return String(state.filesSelectedText ?? '') !== String(state.filesSelectedTextOriginal ?? '');
}

function confirmDiscardFilesChangesIfAny() {
  if (!filesHasUnsavedChanges()) return true;
  return confirm(t('files.confirm_discard'));
}

function renderFilesBreadcrumb() {
  const host = q('#filesBreadcrumb');
  if (!host) return;

  const relDir = normalizeSlashPath(state.filesDir);
  const parts = relDir ? relDir.split('/') : [];

  const segments = [];
  segments.push(`<span class="breadcrumb__part" data-files-bc="">/</span>`);
  let acc = '';
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : part;
    segments.push(`<span class="breadcrumb__sep">/</span>`);
    segments.push(`<span class="breadcrumb__part" data-files-bc="${escapeHtml(acc)}">${escapeHtml(part)}</span>`);
  }
  host.innerHTML = segments.join('');
}

function renderFilesList() {
  const host = q('#filesList');
  if (!host) return;

  const meta = q('#filesListMeta');

  if (!state.workspaceId) {
    host.textContent = t('placeholder.no_workspaces');
    if (meta) meta.textContent = '';
    return;
  }

  const filter = String(state.filesSearch || '').trim().toLowerCase();
  const items = (state.filesItems || []).filter((it) => {
    if (!filter) return true;
    return String(it.name || '').toLowerCase().includes(filter) || String(it.relPath || '').toLowerCase().includes(filter);
  });

  if (!items.length) {
    host.textContent = t('placeholder.no_data');
  } else {
    host.innerHTML = items
      .map((it) => {
        const selected = String(it.relPath || '') === String(state.filesSelectedRelPath || '');
        const kind = String(it.kind || '');
        const title = escapeHtml(kind === 'dir' ? `${it.name}/` : it.name);
        const metaLine = escapeHtml(kind || '-');
        return `<button type="button" class="list__item${selected ? ' list__item--selected' : ''}" data-files-path="${escapeHtml(
          it.relPath
        )}" data-files-kind="${escapeHtml(kind)}" aria-selected="${selected ? 'true' : 'false'}">
  <div class="list__title">${title}</div>
  <div class="list__meta mono">${metaLine}</div>
</button>`;
      })
      .join('');
  }

  if (meta) {
    const p = normalizeSlashPath(state.filesDir);
    const where = p ? `/${p}` : '/';
    const flags = [state.filesIncludeHidden ? 'hidden=on' : 'hidden=off', state.filesReadOnly ? 'readOnly=true' : 'readOnly=false'];
    const tail = state.filesTruncated ? ' · truncated' : '';
    meta.textContent = `${where} · ${flags.join(' · ')}${tail}`;
  }
}

function renderFilesPreview() {
  const pathEl = q('#filesSelectedPath');
  const metaEl = q('#filesSelectedMeta');
  const hintEl = q('#filesPreviewHint');

  const imgPanel = q('#filesImagePanel');
  const imgEl = q('#filesImage');
  const textPanel = q('#filesTextPanel');
  const editor = q('#filesEditor');
  const unsupported = q('#filesUnsupported');

  const saveBtn = q('#filesSaveBtn');
  const reloadBtn = q('#filesReloadBtn');
  const statusEl = q('#filesEditStatus');

  if (!pathEl || !metaEl || !hintEl || !imgPanel || !imgEl || !textPanel || !editor || !unsupported) return;

  const selectedPath = String(state.filesSelectedRelPath || '');
  const kind = String(state.filesSelectedKind || '');
  const mode = String(state.filesSelectedMode || '');

  const busy = Boolean(state.filesSelectedLoading || state.filesSaving);
  const pillText = mode ? mode : kind ? kind : '-';
  metaEl.textContent = pillText;

  if (!selectedPath) {
    pathEl.textContent = '(未选择文件)';
    hintEl.textContent = '';
    imgPanel.classList.add('hidden');
    textPanel.classList.add('hidden');
    unsupported.classList.remove('hidden');
    if (saveBtn) saveBtn.disabled = true;
    if (reloadBtn) reloadBtn.disabled = true;
    if (statusEl) statusEl.textContent = '';
    return;
  }

  pathEl.textContent = selectedPath;

  if (state.filesSelectedError) {
    hintEl.textContent = String(state.filesSelectedError);
  } else if (state.filesSelectedLoading) {
    hintEl.textContent = t('placeholder.loading');
  } else {
    hintEl.textContent = '';
  }

  imgPanel.classList.toggle('hidden', mode !== 'image');
  textPanel.classList.toggle('hidden', mode !== 'text');
  unsupported.classList.toggle('hidden', mode === 'image' || mode === 'text');

  if (mode === 'image') {
    imgEl.src = state.filesImageUrl || '';
  } else {
    imgEl.src = '';
  }

  if (mode === 'text') {
    const shouldSetValue = document.activeElement !== editor;
    if (shouldSetValue && editor.value !== String(state.filesSelectedText ?? '')) {
      editor.value = String(state.filesSelectedText ?? '');
    }
    editor.readOnly = Boolean(state.filesReadOnly || state.filesSelectedTextTruncated || busy);

    const dirty = filesHasUnsavedChanges();
    const disableSave = Boolean(state.filesReadOnly || state.filesSelectedTextTruncated || !dirty || state.filesSaving);
    if (saveBtn) saveBtn.disabled = disableSave;
    if (reloadBtn) reloadBtn.disabled = Boolean(state.filesSelectedLoading || state.filesSaving);

    const pieces = [];
    if (state.filesSelectedTextTruncated) pieces.push(t('files.truncated_no_save'));
    if (dirty) pieces.push('dirty');
    if (state.filesSelectedMtimeMs) pieces.push(`mtime=${state.filesSelectedMtimeMs}`);
    if (state.filesSelectedSizeBytes !== null && state.filesSelectedSizeBytes !== undefined) pieces.push(`size=${state.filesSelectedSizeBytes}`);
    if (statusEl) statusEl.textContent = pieces.join(' · ');
  } else {
    if (saveBtn) saveBtn.disabled = true;
    if (reloadBtn) reloadBtn.disabled = true;
    if (statusEl) statusEl.textContent = busy ? t('placeholder.loading') : '';
  }
}

function renderFiles() {
  renderFilesBreadcrumb();
  renderFilesList();
  renderFilesPreview();
}

function closeEventSource() {
  if (state.eventSource) {
    try {
      state.eventSource.close();
    } catch {}
  }
  state.eventSource = null;
  state.sseStatusKey = 'sse.idle';
  q('#sseStatus').textContent = t(state.sseStatusKey);
}

function scheduleRunRefresh() {
  clearTimeout(state.pendingRefreshTimer);
  state.pendingRefreshTimer = setTimeout(() => {
    if (!state.runId) return;
    loadRunDetail(state.runId).catch(() => {});
  }, 400);
}

function openRunStream(runId) {
  closeEventSource();
  state.events = [];
  renderEvents();

  state.sseStatusKey = 'sse.connecting';
  q('#sseStatus').textContent = t(state.sseStatusKey);
  const es = new EventSource(`/api/runs/${encodeURIComponent(runId)}/events`);
  state.eventSource = es;

  es.onopen = () => {
    state.sseStatusKey = 'sse.connected';
    q('#sseStatus').textContent = t(state.sseStatusKey);
  };

  es.addEventListener('event', (ev) => {
    try {
      const data = JSON.parse(ev.data);
      state.events.push(data);
      if (state.events.length > 4000) state.events.shift();
      renderEvents();

      if (data.kind === 'status' || data.kind === 'error' || data.kind === 'final') scheduleRunRefresh();
    } catch {}
  });

  es.addEventListener('ready', () => {});

  es.onerror = () => {
    state.sseStatusKey = 'sse.disconnected_retrying';
    q('#sseStatus').textContent = t(state.sseStatusKey);
  };
}

async function loadHealth() {
  state.health = await fetchJson('/api/health');
  renderHealth();
  renderAllowedRootsControlsFromHealth({ autoFill: true });
}

function renderHealth() {
  q('#health').textContent = state.health ? JSON.stringify(state.health, null, 2) : t('placeholder.loading');
}

function setAllowedRootsError(message) {
  const box = q('#allowedRootsError');
  if (!box) return;
  if (!message) {
    box.textContent = '';
    box.classList.add('hidden');
    return;
  }
  box.textContent = String(message);
  box.classList.remove('hidden');
}

function setAllowedRootsStatus(text) {
  const el = q('#allowedRootsStatus');
  if (!el) return;
  el.textContent = String(text || '');
}

function fillAllowedRootsEditorFromHealth({ overwrite = false } = {}) {
  const editor = q('#allowedRootsEditor');
  if (!editor) return;
  const roots = Array.isArray(state.health?.allowedWorkspaceRoots) ? state.health.allowedWorkspaceRoots : [];
  const next = roots
    .map((r) => String(r || '').trim())
    .filter(Boolean)
    .join('\n');
  if (!overwrite && String(editor.value || '').trim()) return;
  editor.value = next;
}

function renderAllowedRootsControlsFromHealth({ autoFill = false } = {}) {
  const roots = Array.isArray(state.health?.allowedWorkspaceRoots) ? state.health.allowedWorkspaceRoots : [];
  const source = String(state.health?.allowedWorkspaceRootsSource || '').trim() || 'unknown';
  const updatedAtMs = Number(state.health?.allowedWorkspaceRootsUpdatedAt || 0);
  const updatedAtText = updatedAtMs ? formatTs(updatedAtMs) : '-';
  const err = String(state.health?.allowedWorkspaceRootsError || '').trim();
  setAllowedRootsStatus(`source=${source} · updatedAt=${updatedAtText} · count=${roots.length}`);
  if (err) setAllowedRootsError(`health.allowedWorkspaceRootsError: ${err}`);
  else setAllowedRootsError('');
  if (autoFill) fillAllowedRootsEditorFromHealth({ overwrite: false });
}

function renderCapabilities() {
  q('#capabilities').textContent = state.capabilities
    ? JSON.stringify(state.capabilities, null, 2)
    : t('placeholder.not_probed');
}

async function loadCapabilities() {
  state.capabilities = await fetchJson('/api/capabilities');
  renderCapabilities();
}

async function probeCapabilities() {
  state.capabilities = await fetchJson('/api/capabilities/probe', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify({}),
  });
  renderCapabilities();
}

async function loadWorkspaces() {
  const data = await fetchJson('/api/workspaces');
  state.workspaces = data.items || [];
  renderWorkspacesSelect();
}

async function loadSessions(workspaceId) {
  const data = await fetchJson(`/api/workspaces/${encodeURIComponent(workspaceId)}/sessions`);
  state.sessions = data.items || [];
  renderSessions();
}

async function loadRollovers(workspaceId) {
  const data = await fetchJson(`/api/workspaces/${encodeURIComponent(workspaceId)}/rollovers`);
  state.rollovers = data.items || [];
  renderRollovers();
}

async function loadRuns(workspaceId) {
  const data = await fetchJson(`/api/workspaces/${encodeURIComponent(workspaceId)}/runs`);
  state.runs = data.items || [];
  renderRuns();
  renderHistory();
}

async function loadRunDetail(runId) {
  state.runDetail = await fetchJson(`/api/runs/${encodeURIComponent(runId)}`);
  renderRunHeader();
  renderFeedsFromRunDetail();
}

async function loadHistoryRunDetail(runId) {
  state.historyRunId = runId;
  state.historyRunDetail = await fetchJson(`/api/runs/${encodeURIComponent(runId)}`);
  renderHistoryDetail();
}

function normalizeWorkspaceDocKind(kind) {
  const k = String(kind || '').trim().toLowerCase();
  return k === 'convention' ? 'convention' : 'plan';
}

function getWorkspaceDocEndpoint(kind) {
  return normalizeWorkspaceDocKind(kind) === 'convention' ? 'convention' : 'plan';
}

function getWorkspaceDocPathKey(kind) {
  return normalizeWorkspaceDocKind(kind) === 'convention' ? 'conventionPath' : 'planPath';
}

function getWorkspaceDocTitleKey(kind) {
  return normalizeWorkspaceDocKind(kind) === 'convention' ? 'doc_modal.title_convention' : 'doc_modal.title_plan';
}

function formatWorkspaceDocKey(key) {
  return String(key || '')
    .replace(/([A-Z])/g, '_$1')
    .toUpperCase();
}

async function fetchWorkspaceDoc(workspaceId, kind) {
  const wsId = String(workspaceId || '').trim();
  if (!wsId) throw new Error('WORKSPACE_ID_REQUIRED');
  const k = normalizeWorkspaceDocKind(kind);
  const endpoint = getWorkspaceDocEndpoint(k);
  const data = await fetchJson(`/api/workspaces/${encodeURIComponent(wsId)}/${endpoint}`);
  return {
    kind: k,
    path: k === 'convention' ? data.conventionPath : data.planPath,
    truncated: Boolean(data.truncated),
    text: data.content || '',
  };
}

async function loadWorkspaceDocToTab(kind, workspaceId) {
  const wsId = String(workspaceId || '').trim();
  if (!wsId) throw new Error('WORKSPACE_NOT_SELECTED');
  const data = await fetchWorkspaceDoc(wsId, kind);
  state.mdKind = data.kind;
  state.mdLoadedPath = data.path || '';
  state.mdTruncated = Boolean(data.truncated);
  state.planText = data.text || '';
  renderMdControls();
  renderPlanText();
}

async function loadPlan(workspaceId) {
  return loadWorkspaceDocToTab('plan', workspaceId);
}

async function loadConvention(workspaceId) {
  return loadWorkspaceDocToTab('convention', workspaceId);
}

async function loadMarkdownPath(workspaceId, relPath) {
  const p = String(relPath || '').trim();
  state.mdKind = 'path';
  state.mdPath = p;
  renderMdControls();

  const data = await fetchJson(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/markdown?path=${encodeURIComponent(p)}`
  );
  state.mdLoadedPath = data.path || p;
  state.mdTruncated = Boolean(data.truncated);
  state.planText = data.content || '';
  renderPlanText();
}

async function loadMarkdownFromUi() {
  const workspaceId = state.workspaceId;
  if (!workspaceId) throw new Error('WORKSPACE_NOT_SELECTED');

  const kind = String(q('#mdKindSelect')?.value || state.mdKind || 'plan').trim().toLowerCase();
  state.mdKind = kind;
  if (kind === 'plan') return loadPlan(workspaceId);
  if (kind === 'convention') return loadConvention(workspaceId);

  const relPath = q('#mdPathInput')?.value || '';
  return loadMarkdownPath(workspaceId, relPath);
}

async function loadDigest(workspaceId) {
  const data = await fetchJson(`/api/workspaces/${encodeURIComponent(workspaceId)}/repoDigest`);
  state.digestText = data.digest || '';
  renderDigestText();
}

async function loadFilesList(workspaceId, relDir, { preserveSelection = false } = {}) {
  const wsId = String(workspaceId || '').trim();
  if (!wsId) return;
  const rel = normalizeSlashPath(relDir);
  const url = `/api/workspaces/${encodeURIComponent(wsId)}/fs/list?path=${encodeURIComponent(rel)}&limit=500`;

  const data = await fetchJson(url, { headers: { ...authHeaders() } });
  state.filesDir = normalizeSlashPath(data.path || '');
  state.filesItems = data.items || [];
  state.filesTruncated = Boolean(data.truncated);
  state.filesIncludeHidden = Boolean(data.includeHidden);
  state.filesReadOnly = Boolean(data.readOnly);

  if (!preserveSelection) {
    state.filesSelectedRelPath = null;
    state.filesSelectedKind = null;
    state.filesSelectedMode = null;
    state.filesSelectedLoading = false;
    state.filesSelectedError = '';
    state.filesSelectedText = '';
    state.filesSelectedTextOriginal = '';
    state.filesSelectedTextTruncated = false;
    state.filesSelectedMtimeMs = null;
    state.filesSelectedSizeBytes = null;
    clearFilesImageUrl();
  }

  renderFiles();
}

async function openFilesDirFromUi(relDir) {
  if (!state.workspaceId) throw new Error('WORKSPACE_NOT_SELECTED');
  if (!confirmDiscardFilesChangesIfAny()) return;
  state.filesDir = normalizeSlashPath(relDir);
  state.filesSearch = '';
  state.filesSelectedRelPath = null;
  state.filesSelectedKind = null;
  state.filesSelectedMode = null;
  state.filesSelectedLoading = false;
  state.filesSelectedError = '';
  state.filesSelectedText = '';
  state.filesSelectedTextOriginal = '';
  state.filesSelectedTextTruncated = false;
  state.filesSelectedMtimeMs = null;
  state.filesSelectedSizeBytes = null;
  clearFilesImageUrl();
  renderFiles();
  await loadFilesList(state.workspaceId, state.filesDir, { preserveSelection: false });
}

async function selectFilesItemFromUi(relPath, kind) {
  if (!state.workspaceId) throw new Error('WORKSPACE_NOT_SELECTED');
  const rel = normalizeSlashPath(relPath);
  const k = String(kind || '').toLowerCase();

  if (k === 'dir') {
    await openFilesDirFromUi(rel);
    return;
  }

  if (state.filesSelectedRelPath && state.filesSelectedRelPath !== rel) {
    if (!confirmDiscardFilesChangesIfAny()) return;
  }

  state.filesSelectedRelPath = rel;
  state.filesSelectedKind = k;
  state.filesSelectedLoading = true;
  state.filesSelectedError = '';
  state.filesSelectedMode = null;
  state.filesSelectedText = '';
  state.filesSelectedTextOriginal = '';
  state.filesSelectedTextTruncated = false;
  state.filesSelectedMtimeMs = null;
  state.filesSelectedSizeBytes = null;
  clearFilesImageUrl();
  renderFiles();

  if (isImageRelPath(rel)) {
    await loadFilesImage(state.workspaceId, rel);
    return;
  }

  await loadFilesText(state.workspaceId, rel);
}

async function loadFilesText(workspaceId, relPath) {
  const wsId = String(workspaceId || '').trim();
  const rel = normalizeSlashPath(relPath);
  if (!wsId || !rel) return;

  try {
    const data = await fetchJson(
      `/api/workspaces/${encodeURIComponent(wsId)}/fs/text?path=${encodeURIComponent(rel)}`,
      { headers: { ...authHeaders() } }
    );
    state.filesSelectedMode = 'text';
    state.filesSelectedLoading = false;
    state.filesSelectedError = '';
    state.filesSelectedText = data.content || '';
    state.filesSelectedTextOriginal = data.content || '';
    state.filesSelectedTextTruncated = Boolean(data.truncated);
    state.filesSelectedMtimeMs = data.mtimeMs ?? null;
    state.filesSelectedSizeBytes = data.sizeBytes ?? null;
  } catch (err) {
    state.filesSelectedMode = null;
    state.filesSelectedLoading = false;
    state.filesSelectedError = err?.body?.error ? String(err.body.error) : String(err?.message || err);
  }

  renderFiles();
}

async function loadFilesImage(workspaceId, relPath) {
  const wsId = String(workspaceId || '').trim();
  const rel = normalizeSlashPath(relPath);
  if (!wsId || !rel) return;

  try {
    const res = await fetch(
      `/api/workspaces/${encodeURIComponent(wsId)}/fs/blob?path=${encodeURIComponent(rel)}`,
      { headers: { ...authHeaders() } }
    );
    if (!res.ok) {
      const text = await res.text();
      let body = null;
      try {
        body = JSON.parse(text);
      } catch {
        body = { raw: text };
      }
      const err = new Error(body?.error || res.statusText);
      err.status = res.status;
      err.body = body;
      throw err;
    }
    const blob = await res.blob();
    clearFilesImageUrl();
    state.filesImageUrl = URL.createObjectURL(blob);
    state.filesSelectedMode = 'image';
    state.filesSelectedLoading = false;
    state.filesSelectedError = '';
  } catch (err) {
    state.filesSelectedMode = null;
    state.filesSelectedLoading = false;
    state.filesSelectedError = err?.body?.error ? String(err.body.error) : String(err?.message || err);
  }

  renderFiles();
}

async function saveFilesTextFromUi() {
  const token = getAdminToken();
  if (!token) throw new Error('ADMIN_TOKEN_REQUIRED');
  if (!state.workspaceId) throw new Error('WORKSPACE_NOT_SELECTED');
  const rel = normalizeSlashPath(state.filesSelectedRelPath);
  if (!rel) throw new Error('PATH_REQUIRED');
  if (state.filesSelectedMode !== 'text') return;
  if (state.filesSelectedTextTruncated) throw new Error('FILE_TRUNCATED');
  if (!filesHasUnsavedChanges()) return;

  state.filesSaving = true;
  renderFiles();
  try {
    const data = await fetchJson(`/api/workspaces/${encodeURIComponent(state.workspaceId)}/fs/text`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ path: rel, content: state.filesSelectedText, baseMtimeMs: state.filesSelectedMtimeMs }),
    });
    state.filesSelectedMtimeMs = data.mtimeMs ?? state.filesSelectedMtimeMs;
    state.filesSelectedSizeBytes = data.sizeBytes ?? state.filesSelectedSizeBytes;
    state.filesSelectedTextOriginal = state.filesSelectedText;
    state.filesSaving = false;
    await loadFilesList(state.workspaceId, state.filesDir, { preserveSelection: true });
  } catch (err) {
    state.filesSaving = false;
    renderFiles();
    throw err;
  }
}

async function reloadFilesSelectedFromUi() {
  if (!state.workspaceId) throw new Error('WORKSPACE_NOT_SELECTED');
  const rel = normalizeSlashPath(state.filesSelectedRelPath);
  if (!rel) return;
  if (!confirmDiscardFilesChangesIfAny()) return;

  state.filesSelectedLoading = true;
  state.filesSelectedError = '';
  renderFiles();

  if (isImageRelPath(rel)) {
    await loadFilesImage(state.workspaceId, rel);
  } else {
    await loadFilesText(state.workspaceId, rel);
  }
}

async function loadAskThreads(workspaceId, options = {}) {
  const token = getAdminToken();
  if (!token) throw new Error('ADMIN_TOKEN_REQUIRED');
  const renderMode = options?.renderMode === 'list' ? 'list' : 'full';
  const context = String(options?.context || 'ASK_THREADS');
  const data = await fetchJson(`/api/workspaces/${encodeURIComponent(workspaceId)}/ask/threads`, {
    headers: { ...authHeaders() },
  });
  const items = data.items || [];
  const threadsSig = askThreadsSignature(items);
  const threadsChanged = threadsSig !== state.askThreadsSig;
  if (threadsChanged) {
    state.askThreads = items;
    state.askThreadsSig = threadsSig;
  }

  let selectionChanged = false;
  if (state.askThreadId && !items.some((t) => t.id === state.askThreadId)) {
    state.askThreadId = null;
    state.askMessages = [];
    state.askMessagesSig = null;
    state.askQueueItems = [];
    state.askQueueSig = null;
    state.askQueueItemOpen = {};
    state.askQueueEditId = null;
    state.askQueueEditText = '';
    state.askDebugText = '';
    selectionChanged = true;
  }
  if (!state.askThreadId && items.length) {
    state.askThreadId = items[0].id;
    state.askMessages = [];
    state.askMessagesSig = null;
    state.askQueueItems = [];
    state.askQueueSig = null;
    selectionChanged = true;
    await loadAskMessages(state.askThreadId).catch(toast);
    await loadAskQueue(state.askThreadId).catch(toast);
  }
  if (threadsChanged || selectionChanged) {
    renderAskThreads();
    if (selectionChanged || renderMode === 'full') {
      renderAskThread();
      if (!state.askThreadId) {
        renderAskMessages();
        renderAskQueue();
      }
    }
  }

  const shouldEnsureRecovery = (() => {
    if (threadsChanged || selectionChanged) return true;
    const th = selectedAskThread();
    if (!th) return false;
    if (state.askPollTimer) return false;
    return Boolean(th.busy) || hasPendingAskQueue(state.askQueueItems);
  })();
  if (shouldEnsureRecovery) maybeStartAskRecovery({ context, renderMode });
  return { threadsChanged, selectionChanged };
}

async function loadAskMessages(threadId) {
  const token = getAdminToken();
  if (!token) throw new Error('ADMIN_TOKEN_REQUIRED');
  const data = await fetchJson(`/api/ask/threads/${encodeURIComponent(threadId)}/messages?limit=2000`, {
    headers: { ...authHeaders() },
  });
  const items = data.items || [];
  const sig = askMessagesSignature(threadId, items);
  if (sig === state.askMessagesSig) return;
  state.askMessages = items;
  state.askMessagesSig = sig;
  renderAskMessages();
  updateAskElapsedFromMessages(threadId, items);
  if (state.askThreadId === threadId) renderAskStatusMeta(selectedAskThread());
}

async function loadAskQueue(threadId) {
  const token = getAdminToken();
  if (!token) throw new Error('ADMIN_TOKEN_REQUIRED');
  const data = await fetchJson(`/api/ask/threads/${encodeURIComponent(threadId)}/queue?limit=200`, {
    headers: { ...authHeaders() },
  });
  const items = data.items || [];
  const sig = askQueueSignature(threadId, items);
  if (sig === state.askQueueSig) return;
  state.askQueueItems = items;
  state.askQueueSig = sig;
  if (state.askQueueEditId) return;
  renderAskQueue();
}

function closeAskSse() {
  if (state.askSse) {
    try {
      state.askSse.close();
    } catch {}
  }
  state.askSse = null;
  state.askSseKey = null;
  clearTimeout(state.askSseRefreshTimer);
  state.askSseRefreshTimer = null;
}

async function refreshAskFromRealtimeEvent() {
  if (state.page !== 'ask') return;
  if (!state.workspaceId) return;
  if (!getAdminToken()) return;

  const { selectionChanged } = await loadAskThreads(state.workspaceId, { renderMode: 'list', context: 'ASK_SSE_REFRESH' });
  if (state.askThreadId) {
    try {
      await loadAskMessages(state.askThreadId);
    } catch (err) {
      reportAskRenderError(err, 'ASK_SSE_REFRESH loadAskMessages');
      throw err;
    }
    try {
      await loadAskQueue(state.askThreadId);
    } catch (err) {
      reportAskRenderError(err, 'ASK_SSE_REFRESH loadAskQueue');
      throw err;
    }
  }
  if (!selectionChanged) renderAskPanelOnly('ASK_SSE_REFRESH');
}

function scheduleAskSseRefresh() {
  if (state.askSseRefreshTimer) return;
  state.askSseRefreshTimer = setTimeout(() => {
    state.askSseRefreshTimer = null;
    refreshAskFromRealtimeEvent().catch(() => {});
  }, 120);
}

function ensureAskSse() {
  const workspaceId = state.workspaceId;
  if (state.page !== 'ask') {
    closeAskSse();
    return;
  }
  const token = getAdminToken();
  if (!workspaceId || !token) {
    closeAskSse();
    return;
  }
  const key = `${workspaceId}:${token}`;
  if (state.askSse && state.askSseKey === key) return;

  closeAskSse();
  state.askSseKey = key;
  state.askSse = openSseStreamViaFetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/ask/events`, {
    headers: { ...authHeaders() },
    onEvent: (evt) => {
      if (evt.event !== 'event') return;
      let data = null;
      try {
        data = JSON.parse(evt.data || '{}');
      } catch {
        data = null;
      }
      if (!data) return;
      if (data.kind !== 'ask') return;
      if (String(data.workspaceId || '') !== String(state.workspaceId || '')) return;
      scheduleAskSseRefresh();
    },
    onStatus: (st) => {
      const s = String(st?.state || '');
      if (s === 'connected') {
        // If we were stale and just reconnected, do an immediate refresh.
        scheduleAskSseRefresh();
      }
    },
    onError: () => {},
  });
}

function clearAskPoll() {
  state.askPollToken = (state.askPollToken || 0) + 1;
  state.askRecovering = false;
  if (!state.askPollTimer) return;
  clearTimeout(state.askPollTimer);
  state.askPollTimer = null;
}

async function refreshAskThread(threadId) {
  const token = getAdminToken();
  if (!token) throw new Error('ADMIN_TOKEN_REQUIRED');
  const thread = await fetchJson(`/api/ask/threads/${encodeURIComponent(threadId)}`, {
    headers: { ...authHeaders() },
  });
  const next = { ...thread };
  state.askThreads = (state.askThreads || []).map((t0) => (t0.id === next.id ? next : t0));
  return next;
}

function hasPendingAskQueue(items) {
  return (items || []).some((it) => {
    const s = String(it?.status || '').toLowerCase();
    return s === 'queued' || s === 'running';
  });
}

function maybeStartAskRecovery(options = {}) {
  const context = String(options?.context || 'ASK_RECOVERY');
  const thread = selectedAskThread();
  if (!thread) {
    clearAskPoll();
    renderAskThread();
    renderAskQueue();
    return;
  }
  if (!thread.busy && !hasPendingAskQueue(state.askQueueItems)) {
    clearAskPoll();
    renderAskPanelOnly(`${context} | idle`);
    return;
  }
  startAskRecoveryPoll(thread.id, { context });
}

function startAskRecoveryPoll(threadId, options = {}) {
  if (!threadId) return;
  clearAskPoll();
  const pollToken = state.askPollToken;
  const context = String(options?.context || 'ASK_RECOVERY');
  state.askRecovering = true;
  renderAskPanelOnly(`${context} | start`);

  const startedAt = Date.now();
  const maxMs = 60 * 60 * 1000;
  const intervalMs = 1400;

  const tick = async () => {
    if (state.askPollToken !== pollToken) return;
    if (state.askThreadId !== threadId) {
      clearAskPoll();
      maybeStartAskRecovery();
      return;
    }

    let thread = null;
    try {
      thread = await refreshAskThread(threadId);
      await loadAskMessages(threadId);
      await loadAskQueue(threadId);
    } catch (err) {
      const status = err?.status;
      if (status === 401 || status === 403 || String(err?.message || '') === 'ADMIN_TOKEN_REQUIRED') {
        state.askRecovering = false;
        clearAskPoll();
        renderAskPanelOnly(`${context} | auth`);
        return;
      }
      state.askDebugText = err?.body ? JSON.stringify(err.body, null, 2) : String(err?.message || err);
      renderAskPanelOnly(`${context} | error`);
    }

    if (state.askPollToken !== pollToken) return;

    if (thread && !thread.busy && !hasPendingAskQueue(state.askQueueItems)) {
      state.askRecovering = false;
      clearAskPoll();
      renderAskThreads();
      renderAskPanelOnly(`${context} | done`);
      return;
    }

    if (Date.now() - startedAt > maxMs) {
      state.askRecovering = false;
      clearAskPoll();
      renderAskPanelOnly(`${context} | timeout`);
      return;
    }

    if (state.askPollToken !== pollToken) return;
    state.askPollTimer = setTimeout(() => tick().catch(() => {}), intervalMs);
  };

  state.askPollTimer = setTimeout(() => tick().catch(() => {}), 0);
}

function renderPlanText() {
  q('#planText').textContent = state.planText ? state.planText : t('placeholder.not_loaded');
  const info = q('#mdInfo');
  if (!info) return;
  if (!state.mdLoadedPath) {
    info.textContent = t('placeholder.not_loaded');
    return;
  }
  info.textContent = state.mdTruncated ? `${state.mdLoadedPath} ${t('md.truncated')}` : state.mdLoadedPath;
}

function renderMdControls() {
  const kindSelect = q('#mdKindSelect');
  const pathInput = q('#mdPathInput');
  if (!kindSelect || !pathInput) return;

  const kind = String(state.mdKind || 'plan').trim().toLowerCase();
  kindSelect.value = ['plan', 'convention', 'path'].includes(kind) ? kind : 'plan';

  const showPath = kindSelect.value === 'path';
  pathInput.classList.toggle('hidden', !showPath);
  pathInput.value = state.mdPath || '';
}

function renderDigestText() {
  q('#digestText').textContent = state.digestText ? state.digestText : t('placeholder.not_loaded');
}

const WORKSPACE_MODAL_DEFAULT_PLAN = 'plan.md';
const WORKSPACE_MODAL_DEFAULT_CONVENTION = '约定.md';

function guessWorkspaceNameFromRoot(rootPath) {
  const trimmed = String(rootPath || '').trim().replace(/[\\/]+$/, '');
  if (!trimmed) return '';
  const parts = trimmed.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || '';
}

function buildWorkspacePayload(
  { name, rootPath, planPath, conventionPath },
  { allowNameGuess = true, includeEmptyPaths = false } = {}
) {
  const root = String(rootPath || '').trim();
  if (!root) throw new Error('ROOT_PATH_REQUIRED');

  let finalName = String(name || '').trim();
  if (!finalName && allowNameGuess) finalName = guessWorkspaceNameFromRoot(root);
  if (!finalName) throw new Error('NAME_REQUIRED');

  const payload = { name: finalName, rootPath: root };
  const plan = String(planPath || '').trim();
  const convention = String(conventionPath || '').trim();
  if (includeEmptyPaths || plan) payload.planPath = plan;
  if (includeEmptyPaths || convention) payload.conventionPath = convention;
  return payload;
}

function formatApiError(err, context) {
  const status = err?.status;
  const code = err?.body?.error;
  const message = err?.body?.message || err?.message;
  const parts = [];
  if (context) parts.push(context);
  if (status) parts.push(`HTTP ${status}`);
  if (code) parts.push(String(code));
  if (message && message !== code) parts.push(String(message));
  return parts.length ? parts.join(' · ') : 'UNKNOWN_ERROR';
}

function parseAllowedRootsText(text) {
  return String(text || '')
    .split(/[\r\n;,]+/g)
    .map((s) => String(s || '').trim())
    .filter(Boolean);
}

async function saveAllowedRootsFromUi() {
  const token = getAdminToken();
  if (!token) {
    setAllowedRootsError('ADMIN_TOKEN_REQUIRED');
    throw new Error('ADMIN_TOKEN_REQUIRED');
  }
  const editor = mustGetEl('#allowedRootsEditor');
  const roots = parseAllowedRootsText(editor.value);

  setAllowedRootsError('');
  try {
    await fetchJson('/api/settings/allowedWorkspaceRoots', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ roots }),
    });
    await loadHealth();
    renderAllowedRootsControlsFromHealth({ autoFill: false });
  } catch (err) {
    setAllowedRootsError(formatApiError(err, 'ALLOWED_ROOTS_SAVE'));
    throw err;
  }
}

function loadAllowedRootsEditorFromHealthFromUi() {
  const editor = q('#allowedRootsEditor');
  if (!editor) return;
  if (String(editor.value || '').trim()) {
    if (!confirm(t('settings.allowed_roots_confirm_overwrite'))) return;
  }
  fillAllowedRootsEditorFromHealth({ overwrite: true });
  renderAllowedRootsControlsFromHealth({ autoFill: false });
}

async function resetAllowedRootsFromUi() {
  const token = getAdminToken();
  if (!token) {
    setAllowedRootsError('ADMIN_TOKEN_REQUIRED');
    throw new Error('ADMIN_TOKEN_REQUIRED');
  }
  if (!confirm(t('settings.allowed_roots_confirm_reset'))) return;

  setAllowedRootsError('');
  try {
    await fetchJson('/api/settings/allowedWorkspaceRoots', {
      method: 'DELETE',
      headers: { ...authHeaders() },
    });
    await loadHealth();
    renderAllowedRootsControlsFromHealth({ autoFill: true });
  } catch (err) {
    setAllowedRootsError(formatApiError(err, 'ALLOWED_ROOTS_RESET'));
    throw err;
  }
}

function createWorkspace(payload) {
  const body = buildWorkspacePayload(payload, { allowNameGuess: true, includeEmptyPaths: true });
  return fetchJson('/api/workspaces', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });
}

function patchWorkspace(workspaceId, payload) {
  const wsId = String(workspaceId || '').trim();
  if (!wsId) throw new Error('WORKSPACE_ID_REQUIRED');
  const body = buildWorkspacePayload(payload, { allowNameGuess: false, includeEmptyPaths: true });
  return fetchJson(`/api/workspaces/${encodeURIComponent(wsId)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });
}

function setWorkspaceModalError(message) {
  const box = mustGetEl('#workspaceModalError');
  if (!message) {
    box.textContent = '';
    box.classList.add('hidden');
    return;
  }
  box.textContent = message;
  box.classList.remove('hidden');
}

function setWorkspaceModalAllowedError(message) {
  const box = mustGetEl('#workspaceModalAllowedError');
  if (!message) {
    box.textContent = '';
    box.classList.add('hidden');
    return;
  }
  box.textContent = message;
  box.classList.remove('hidden');
}

function renderWorkspaceModalAllowedRoots(roots) {
  const host = mustGetEl('#workspaceModalAllowedRoots');
  const list = Array.isArray(roots) ? roots.map((r) => String(r || '')).filter(Boolean) : [];
  host.textContent = list.length ? list.join('\n') : t('placeholder.none');
}

function requireWorkspaceValue(workspace, key) {
  const value = String(workspace?.[key] ?? '').trim();
  if (!value) throw new Error(`WORKSPACE_${String(key).toUpperCase()}_REQUIRED`);
  return value;
}

async function loadWorkspaceModalHealth() {
  const host = mustGetEl('#workspaceModalAllowedRoots');
  host.textContent = t('placeholder.loading');
  setWorkspaceModalAllowedError('');
  try {
    const data = await fetchJson('/api/health');
    state.health = data;
    renderHealth();
    renderWorkspaceModalAllowedRoots(data.allowedWorkspaceRoots);
  } catch (err) {
    renderWorkspaceModalAllowedRoots([]);
    setWorkspaceModalAllowedError(formatApiError(err, 'GET /api/health'));
  }
}

function setWorkspaceModalMode(mode) {
  const next = mode === 'edit' ? 'edit' : 'create';
  state.workspaceModalMode = next;
  const title = mustGetEl('#workspaceModalTitle');
  const submitBtn = mustGetEl('#workspaceModalCreateBtn');
  if (next === 'edit') {
    title.dataset.i18n = 'workspace_modal.title_edit';
    submitBtn.dataset.i18n = 'workspace_modal.save';
  } else {
    title.dataset.i18n = 'workspace_modal.title';
    submitBtn.dataset.i18n = 'workspace_modal.create';
  }
  applyDomI18n();
}

function openWorkspaceModalBase() {
  const modal = mustGetEl('#workspaceModal');
  setWorkspaceModalError('');
  setWorkspaceModalAllowedError('');
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  loadWorkspaceModalHealth().catch((err) => setWorkspaceModalAllowedError(formatApiError(err, 'GET /api/health')));
}

function openCreateWorkspaceModal() {
  state.workspaceModalWorkspaceId = null;
  setWorkspaceModalMode('create');
  mustGetEl('#workspaceModalName').value = '';
  mustGetEl('#workspaceModalRoot').value = '';
  mustGetEl('#workspaceModalPlan').value = WORKSPACE_MODAL_DEFAULT_PLAN;
  mustGetEl('#workspaceModalConvention').value = WORKSPACE_MODAL_DEFAULT_CONVENTION;
  openWorkspaceModalBase();
}

function openEditWorkspaceModal(workspace) {
  const ws = workspace || selectedWorkspace();
  if (!ws) throw new Error('WORKSPACE_NOT_SELECTED');
  state.workspaceModalWorkspaceId = requireWorkspaceValue(ws, 'id');
  setWorkspaceModalMode('edit');
  mustGetEl('#workspaceModalName').value = requireWorkspaceValue(ws, 'name');
  mustGetEl('#workspaceModalRoot').value = requireWorkspaceValue(ws, 'rootPath');
  mustGetEl('#workspaceModalPlan').value = requireWorkspaceValue(ws, 'planPath');
  mustGetEl('#workspaceModalConvention').value = requireWorkspaceValue(ws, 'conventionPath');
  openWorkspaceModalBase();
}

function closeWorkspaceModal() {
  const modal = mustGetEl('#workspaceModal');
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
}

async function submitWorkspaceModal() {
  setWorkspaceModalError('');
  const token = getAdminToken();
  if (!token) {
    setWorkspaceModalError(t('toast.ADMIN_TOKEN_REQUIRED'));
    return;
  }

  const payload = {
    name: mustGetEl('#workspaceModalName').value,
    rootPath: mustGetEl('#workspaceModalRoot').value,
    planPath: mustGetEl('#workspaceModalPlan').value,
    conventionPath: mustGetEl('#workspaceModalConvention').value,
  };
  const mode = state.workspaceModalMode === 'edit' ? 'edit' : 'create';

  try {
    if (mode === 'edit') {
      const workspaceId = String(state.workspaceModalWorkspaceId || '').trim();
      if (!workspaceId) throw new Error('WORKSPACE_ID_REQUIRED');
      const updated = await patchWorkspace(workspaceId, payload);
      closeWorkspaceModal();
      state.workspaceId = updated.id;
      await loadWorkspaces();
      await onWorkspaceChanged();
      return;
    }

    const created = await createWorkspace(payload);
    closeWorkspaceModal();
    state.workspaceId = created.id;
    await loadWorkspaces();
    await onWorkspaceChanged();
  } catch (err) {
    const ctx =
      mode === 'edit'
        ? `PATCH /api/workspaces/${state.workspaceModalWorkspaceId || ''}`
        : 'POST /api/workspaces';
    setWorkspaceModalError(formatApiError(err, ctx));
  }
}

function setWorkspaceDocModalError(message) {
  const box = mustGetEl('#workspaceDocModalError');
  if (!message) {
    box.textContent = '';
    box.classList.add('hidden');
    return;
  }
  box.textContent = message;
  box.classList.remove('hidden');
}

function setWorkspaceDocModalTitle(kind) {
  const title = mustGetEl('#workspaceDocModalTitle');
  title.dataset.i18n = getWorkspaceDocTitleKey(kind);
  applyDomI18n();
}

function renderWorkspaceDocModalInfo() {
  const info = mustGetEl('#workspaceDocModalInfo');
  if (!state.workspaceDocModalLoaded) {
    info.textContent = t('placeholder.not_loaded');
    return;
  }
  if (!state.workspaceDocModalPath) {
    info.textContent = t('placeholder.not_loaded');
    return;
  }
  info.textContent = state.workspaceDocModalTruncated
    ? `${state.workspaceDocModalPath} ${t('md.truncated')}`
    : state.workspaceDocModalPath;
}

function renderWorkspaceDocModalBody() {
  const body = mustGetEl('#workspaceDocModalBody');
  const rawText = String(state.workspaceDocModalText || '');
  if (!rawText) {
    body.classList.remove('md');
    body.textContent = state.workspaceDocModalLoaded ? '' : t('placeholder.not_loaded');
    return;
  }
  if (state.workspaceDocRenderMarkdown) {
    body.classList.add('md');
    body.innerHTML = renderMarkdownSafe(rawText) || '';
    return;
  }
  body.classList.remove('md');
  body.textContent = rawText;
}

function renderWorkspaceDocModal() {
  renderWorkspaceDocModalInfo();
  renderWorkspaceDocModalBody();
}

async function loadWorkspaceDocForModal(kind) {
  const k = normalizeWorkspaceDocKind(kind);
  const wsId = String(state.workspaceId || '').trim();

  state.workspaceDocModalKind = k;
  state.workspaceDocModalLoaded = false;
  state.workspaceDocModalText = '';
  state.workspaceDocModalPath = '';
  state.workspaceDocModalTruncated = false;
  setWorkspaceDocModalError('');
  renderWorkspaceDocModal();

  if (!wsId) {
    setWorkspaceDocModalError('WORKSPACE_NOT_SELECTED');
    renderWorkspaceDocModal();
    return;
  }
  const ws = selectedWorkspace();
  if (!ws) {
    setWorkspaceDocModalError(`WORKSPACE_NOT_FOUND · workspaceId=${wsId}`);
    renderWorkspaceDocModal();
    return;
  }

  const pathKey = getWorkspaceDocPathKey(k);
  const configuredPath = String(ws[pathKey] || '').trim();
  if (k === 'convention' && !configuredPath) {
    const code = `${formatWorkspaceDocKey(pathKey)}_REQUIRED`;
    setWorkspaceDocModalError(`${code} · workspaceId=${wsId} · kind=convention · edit workspace to set ${pathKey}`);
    renderWorkspaceDocModal();
    return;
  }

  try {
    const data = await fetchWorkspaceDoc(wsId, k);
    state.workspaceDocModalKind = data.kind;
    state.workspaceDocModalPath = data.path || configuredPath || '';
    state.workspaceDocModalTruncated = Boolean(data.truncated);
    state.workspaceDocModalText = data.text || '';
    state.workspaceDocModalLoaded = true;
    renderWorkspaceDocModal();
  } catch (err) {
    const endpoint = getWorkspaceDocEndpoint(k);
    const ctx = `GET /api/workspaces/${wsId}/${endpoint} · workspaceId=${wsId} · kind=${k} · path=${configuredPath}`;
    setWorkspaceDocModalError(formatApiError(err, ctx));
    state.workspaceDocModalPath = configuredPath || '';
    renderWorkspaceDocModal();
  }
}

async function openWorkspaceDocModal(kind) {
  const modal = mustGetEl('#workspaceDocModal');
  const k = normalizeWorkspaceDocKind(kind);
  state.workspaceDocModalKind = k;
  state.workspaceDocModalLoaded = false;
  state.workspaceDocModalText = '';
  state.workspaceDocModalPath = '';
  state.workspaceDocModalTruncated = false;
  setWorkspaceDocModalError('');
  setWorkspaceDocModalTitle(k);
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  const toggle = mustGetEl('#workspaceDocRenderToggle');
  toggle.checked = Boolean(state.workspaceDocRenderMarkdown);
  renderWorkspaceDocModal();
  await loadWorkspaceDocForModal(k);
}

function closeWorkspaceDocModal() {
  const modal = mustGetEl('#workspaceDocModal');
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
}

async function createWorkspaceFromSettings() {
  const token = getAdminToken();
  if (!token) throw new Error('ADMIN_TOKEN_REQUIRED');

  const created = await createWorkspace({
    name: mustGetEl('#wsAddName').value,
    rootPath: mustGetEl('#wsAddRoot').value,
    planPath: mustGetEl('#wsAddPlan').value,
    conventionPath: mustGetEl('#wsAddConvention').value,
  });
  state.workspaceId = created.id;
  await loadWorkspaces();
  await onWorkspaceChanged();
  setPage('dashboard');
}

function openAskWindow() {
  if (!state.workspaceId) throw new Error('WORKSPACE_NOT_SELECTED');
  const url = `/ask?ws=${encodeURIComponent(state.workspaceId)}`;
  window.open(url, '_blank', 'noopener');
}

async function selectAskThreadById(threadId) {
  state.askThreadId = threadId;
  state.askDebugText = '';
  state.askLastSendThreadId = threadId;
  state.askLastSendStartedAt = null;
  state.askLastSendEndedAt = null;
  state.askLastSendElapsedMs = null;
  state.askForceScrollToBottom = true;
  state.askQueueItems = [];
  state.askQueueSig = null;
  state.askQueueItemOpen = {};
  state.askQueueEditId = null;
  state.askQueueEditText = '';
  clearAskPoll();
  renderAskThreads();
  renderAskThread();
  renderAskQueue();
  await loadAskMessages(threadId);
  await loadAskQueue(threadId);
  maybeStartAskRecovery();
}

async function createAskThreadFromUi() {
  const token = getAdminToken();
  if (!token) throw new Error('ADMIN_TOKEN_REQUIRED');
  const workspaceId = state.workspaceId;
  if (!workspaceId) throw new Error('WORKSPACE_NOT_SELECTED');

  const ws = selectedWorkspace();
  const title = `Ask · ${ws?.name || workspaceId} · ${new Date().toLocaleString()}`;

  const created = await fetchJson(`/api/workspaces/${encodeURIComponent(workspaceId)}/ask/threads`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      title,
      provider: 'codex',
      config: { sandbox: 'read-only', systemPromptPath: 'prompts/ask_system.md' },
    }),
  });

  await loadAskThreads(workspaceId);
  await selectAskThreadById(created.id);
}

async function saveAskQueueEditFromUi(queueItemId) {
  const token = getAdminToken();
  if (!token) throw new Error('ADMIN_TOKEN_REQUIRED');
  const thread = selectedAskThread();
  if (!thread) throw new Error('ASK_THREAD_NOT_FOUND');

  const text = String(state.askQueueEditText ?? '').trim();
  if (!text) throw new Error('TEXT_REQUIRED');

  await fetchJson(`/api/ask/queue/${encodeURIComponent(queueItemId)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ text }),
  });

  state.askQueueEditId = null;
  state.askQueueEditText = '';
  await loadAskQueue(thread.id);
  maybeStartAskRecovery();
}

async function deleteAskQueueItemFromUi(queueItemId) {
  const token = getAdminToken();
  if (!token) throw new Error('ADMIN_TOKEN_REQUIRED');
  const thread = selectedAskThread();
  if (!thread) throw new Error('ASK_THREAD_NOT_FOUND');
  if (!confirm(t('ask.confirm_queue_delete'))) return;

  await fetchJson(`/api/ask/queue/${encodeURIComponent(queueItemId)}`, {
    method: 'DELETE',
    headers: { ...authHeaders() },
  });

  if (state.askQueueEditId === queueItemId) {
    state.askQueueEditId = null;
    state.askQueueEditText = '';
  }

  await loadAskQueue(thread.id);
  maybeStartAskRecovery();
}

async function sendAskFromUi() {
  const token = getAdminToken();
  if (!token) throw new Error('ADMIN_TOKEN_REQUIRED');
  const thread = selectedAskThread();
  if (!thread) throw new Error('ASK_THREAD_NOT_FOUND');
  const text = q('#askInput').value.trim();
  if (!text) return;
  if (state.askSendInFlight) return;

  q('#askInput').value = '';

  state.askDebugText = '';
  state.askSendInFlight = true;
  state.askLastSendThreadId = thread.id;
  state.askLastSendStartedAt = Date.now();
  state.askLastSendEndedAt = null;
  state.askLastSendElapsedMs = null;
  renderAskThread();

  let resp = null;
  try {
    resp = await fetchJson(`/api/ask/threads/${encodeURIComponent(thread.id)}/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ text }),
    });
  } catch (err) {
    const status = err?.status;
    if (status === 401 || status === 403 || String(err?.message || '') === 'ADMIN_TOKEN_REQUIRED') {
      state.askSendInFlight = false;
      finalizeAskElapsedNow();
      renderAskThread();
      throw err;
    }
    state.askSendInFlight = false;
    finalizeAskElapsedNow();
    state.askDebugText = err?.body ? JSON.stringify(err.body, null, 2) : String(err?.message || err);
    renderAskThread();
    startAskRecoveryPoll(thread.id);
    return;
  }

  state.askSendInFlight = false;
  const updatedThread = resp.thread || null;
  if (updatedThread) state.askThreads = (state.askThreads || []).map((t0) => (t0.id === updatedThread.id ? updatedThread : t0));
  if (state.askThreadId === thread.id) await loadAskQueue(thread.id).catch(() => {});

  renderAskThreads();
  state.askForceScrollToBottom = true;
  renderAskMessages();
  renderAskQueue();
  renderAskThread();

  startAskRecoveryPoll(thread.id);
}

async function stopAskFromUi() {
  const token = getAdminToken();
  if (!token) throw new Error('ADMIN_TOKEN_REQUIRED');
  const thread = selectedAskThread();
  if (!thread) throw new Error('ASK_THREAD_NOT_FOUND');

  if (!thread.busy) {
    toast('ASK_STOP_NOT_RUNNING');
    return;
  }

  state.askDebugText = '';
  renderAskThread();

  try {
    const resp = await fetchJson(`/api/ask/threads/${encodeURIComponent(thread.id)}/stop`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({}),
    });
    if (!resp?.stopped) toast('ASK_STOP_NOT_RUNNING');
  } catch (err) {
    const status = err?.status;
    if (status === 401 || status === 403 || String(err?.message || '') === 'ADMIN_TOKEN_REQUIRED') throw err;
    state.askDebugText = err?.body ? JSON.stringify(err.body, null, 2) : String(err?.message || err);
    renderAskThread();
  }

  startAskRecoveryPoll(thread.id);
}

async function saveAskTitleFromUi() {
  const token = getAdminToken();
  if (!token) throw new Error('ADMIN_TOKEN_REQUIRED');
  const thread = selectedAskThread();
  if (!thread) throw new Error('ASK_THREAD_NOT_FOUND');
  const title = q('#askTitleInput').value.trim();
  if (!title) throw new Error('TITLE_REQUIRED');

  const updated = await fetchJson(`/api/ask/threads/${encodeURIComponent(thread.id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ title }),
  });

  state.askThreads = (state.askThreads || []).map((t0) => (t0.id === updated.id ? updated : t0));
  renderAskThreads();
  renderAskThread();
}

async function saveAskConfigFromUi() {
  const token = getAdminToken();
  if (!token) throw new Error('ADMIN_TOKEN_REQUIRED');
  const thread = selectedAskThread();
  if (!thread) throw new Error('ASK_THREAD_NOT_FOUND');

  const cfg = readConfigJson(thread.configJson);
  const model = q('#askModelInput').value.trim();
  const effort = q('#askEffortSelect').value;
  const sandbox = q('#askSandboxSelect').value;

  if (model) cfg.model = model;
  else delete cfg.model;
  if (effort) cfg.model_reasoning_effort = effort;
  else delete cfg.model_reasoning_effort;
  cfg.sandbox = sandbox;
  if (!cfg.systemPromptPath) cfg.systemPromptPath = 'prompts/ask_system.md';

  const updated = await fetchJson(`/api/ask/threads/${encodeURIComponent(thread.id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ config: cfg }),
  });

  state.askThreads = (state.askThreads || []).map((t0) => (t0.id === updated.id ? updated : t0));
  renderAskThreads();
  renderAskThread();
}

async function resetAskResumeFromUi() {
  const token = getAdminToken();
  if (!token) throw new Error('ADMIN_TOKEN_REQUIRED');
  const thread = selectedAskThread();
  if (!thread) throw new Error('ASK_THREAD_NOT_FOUND');
  if (!confirm(t('ask.confirm_reset'))) return;

  const updated = await fetchJson(`/api/ask/threads/${encodeURIComponent(thread.id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ resetProviderSessionId: true }),
  });

  state.askThreads = (state.askThreads || []).map((t0) => (t0.id === updated.id ? updated : t0));
  renderAskThreads();
  renderAskThread();
}

async function deleteAskThreadFromUi() {
  const token = getAdminToken();
  if (!token) throw new Error('ADMIN_TOKEN_REQUIRED');
  const thread = selectedAskThread();
  if (!thread) throw new Error('ASK_THREAD_NOT_FOUND');
  if (!confirm(t('ask.confirm_delete'))) return;

  await fetchJson(`/api/ask/threads/${encodeURIComponent(thread.id)}`, {
    method: 'DELETE',
    headers: { ...authHeaders() },
  });

  state.askThreadId = null;
  state.askThreadsSig = null;
  state.askMessages = [];
  state.askMessagesSig = null;
  state.askQueueItems = [];
  state.askQueueSig = null;
  state.askQueueItemOpen = {};
  state.askQueueEditId = null;
  state.askQueueEditText = '';
  state.askDebugText = '';
  await loadAskThreads(state.workspaceId);
  renderAskMessages();
  renderAskQueue();
  renderAskThread();
}

async function exportAskThread(format) {
  const token = getAdminToken();
  if (!token) throw new Error('ADMIN_TOKEN_REQUIRED');
  const thread = selectedAskThread();
  if (!thread) throw new Error('ASK_THREAD_NOT_FOUND');

  const res = await fetch(`/api/ask/threads/${encodeURIComponent(thread.id)}/export?format=${encodeURIComponent(format)}`, {
    headers: { ...authHeaders() },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || t('toast.export_failed', { status: res.status }));
  }
  const blob = await res.blob();
  const ext = format === 'md' ? 'md' : 'jsonl';
  downloadBlob(`ask-${thread.id}.${ext}`, blob);
}

async function createSession({
  workspaceId,
  role,
  provider,
  sandbox,
  systemPromptPath,
  mode,
  model,
  modelReasoningEffort,
  outputFormat,
  includePartialMessages,
  permissionMode,
  tools,
  toolsDisabled,
  sessionPersistence,
}) {
  const cfg = { sandbox };
  if (systemPromptPath) cfg.systemPromptPath = systemPromptPath;
  if (mode) cfg.mode = mode;
  if (model) cfg.model = model;
  if (modelReasoningEffort) cfg.model_reasoning_effort = modelReasoningEffort;
  if (outputFormat) cfg.outputFormat = outputFormat;
  if (includePartialMessages !== undefined) cfg.includePartialMessages = includePartialMessages;
  if (permissionMode) cfg.permissionMode = permissionMode;
  if (toolsDisabled) cfg.tools = '';
  else if (tools) cfg.tools = tools;
  if (sessionPersistence !== undefined) cfg.sessionPersistence = sessionPersistence;
  return fetchJson('/api/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ workspaceId, role, provider: provider || 'codex', config: cfg }),
  });
}

function getSessionById(id) {
  return state.sessions.find((s) => s.id === id) || null;
}

function readConfigJson(json) {
  try {
    return JSON.parse(json || '{}') || {};
  } catch {
    return {};
  }
}

function fillEditSessionForm(sessionId) {
  const s = getSessionById(sessionId);
  if (!s) return;
  const cfg = readConfigJson(s.configJson);
  q('#editSessionProvider').value = s.provider || '';
  q('#editSessionSandbox').value = cfg.sandbox || '';
  q('#editSessionMode').value = cfg.mode || '';
  q('#editSessionModel').value = cfg.model || '';
  q('#editSessionEffort').value = cfg.model_reasoning_effort || '';
  setModelInputProvider(q('#editSessionModel'), s.provider);
  refreshModelPresetSelect(q('#editSessionModelPreset'), q('#editSessionModel'), s.provider);
}

async function saveEditedSession() {
  const id = q('#editSessionSelect').value;
  if (!id) throw new Error('SESSION_NOT_SELECTED');
  const current = getSessionById(id);
  if (!current) throw new Error('SESSION_NOT_FOUND');

  const provider = q('#editSessionProvider').value || current.provider;
  const sandbox = q('#editSessionSandbox').value;
  const mode = q('#editSessionMode').value;
  const model = q('#editSessionModel').value.trim();
  const effort = q('#editSessionEffort').value;

  const cfg = readConfigJson(current.configJson);
  if (sandbox) cfg.sandbox = sandbox;
  if (mode) cfg.mode = mode;
  else delete cfg.mode;
  if (model) cfg.model = model;
  else delete cfg.model;
  if (effort) cfg.model_reasoning_effort = effort;
  else delete cfg.model_reasoning_effort;

  await fetchJson(`/api/sessions/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ provider, config: cfg }),
  });
  await loadSessions(state.workspaceId);
  fillEditSessionForm(id);
}

async function resetProviderSessionId() {
  const id = q('#editSessionSelect').value;
  if (!id) throw new Error('SESSION_NOT_SELECTED');
  await fetchJson(`/api/sessions/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ providerSessionId: null }),
  });
  await loadSessions(state.workspaceId);
  fillEditSessionForm(id);
}

async function copySessionId() {
  const id = q('#editSessionSelect').value;
  if (!id) throw new Error('SESSION_NOT_SELECTED');
  try {
    await navigator.clipboard.writeText(id);
    toast('copied');
  } catch {
    window.prompt(t('toast.copy_session_id_prompt'), id);
  }
}

async function createDefaultSessions() {
  const workspaceId = state.workspaceId;
  if (!workspaceId) throw new Error('WORKSPACE_NOT_SELECTED');
  await loadSessions(workspaceId);

  const hasManager = state.sessions.some((s) => s.role === 'manager');
  const hasExecutor = state.sessions.some((s) => s.role === 'executor');
  let createdManager = null;
  let createdExecutor = null;

  if (!hasManager) {
    createdManager = await createSession({
      workspaceId,
      role: 'manager',
      provider: 'codex',
      sandbox: 'read-only',
      systemPromptPath: 'prompts/manager_system.md',
      mode: 'stateful_resume',
    });
  }
  if (!hasExecutor) {
    createdExecutor = await createSession({
      workspaceId,
      role: 'executor',
      provider: 'codex',
      sandbox: 'workspace-write',
      systemPromptPath: 'prompts/executor_system.md',
      mode: 'stateful_resume',
    });
  }

  await loadSessions(workspaceId);

  const manager = (createdManager && getSessionById(createdManager.id)) || pickBestSession('manager');
  const executor = (createdExecutor && getSessionById(createdExecutor.id)) || pickBestSession('executor');
  state.managerSessionId = manager?.id || null;
  state.executorSessionId = executor?.id || null;
  renderSessions();

  const messageKey = createdManager || createdExecutor ? 'toast.default_sessions_created' : 'toast.default_sessions_selected';
  alert(t(messageKey, { manager: sessionLabel(manager), executor: sessionLabel(executor) }));
}

async function createRun() {
  const workspaceId = state.workspaceId;
  if (!workspaceId) throw new Error('WORKSPACE_NOT_SELECTED');

  const managerSessionId = q('#managerSessionSelect').value;
  const executorSessionId = q('#executorSessionSelect').value;
  if (!managerSessionId || !executorSessionId) throw new Error('SESSIONS_REQUIRED');

  const maxTurns = Number.parseInt(q('#optMaxTurns').value || '1000', 10);
  const timeoutMin = Number.parseInt(q('#optTimeoutMin').value || '200', 10);
  const noProgressLimit = Number.parseInt(q('#optNoProgressLimit').value || '20', 10);

  const options = {
    maxTurns: Number.isFinite(maxTurns) ? maxTurns : 1000,
    turnTimeoutMs: Number.isFinite(timeoutMin) ? timeoutMin * 60 * 1000 : 200 * 60 * 1000,
    repoDigestEnabled: Boolean(q('#optRepoDigest').checked),
    requireGitClean: Boolean(q('#optRequireGitClean').checked),
    dangerousCommandGuard: Boolean(q('#optDangerousGuard').checked),
    noProgressLimit: Number.isFinite(noProgressLimit) ? noProgressLimit : 20,
  };

  const run = await fetchJson('/api/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ workspaceId, managerSessionId, executorSessionId, options }),
  });
  await loadRuns(workspaceId);
  state.runId = run.id;
  renderRuns();
  await selectRun(run.id);
}

async function startRun(mode) {
  if (!state.runId) throw new Error('RUN_NOT_SELECTED');
  await fetchJson(`/api/runs/${encodeURIComponent(state.runId)}/${mode}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify({}),
  });
}

async function pauseRun() {
  if (!state.runId) throw new Error('RUN_NOT_SELECTED');
  await fetchJson(`/api/runs/${encodeURIComponent(state.runId)}/pause`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ reason: 'paused-by-ui' }),
  });
}

async function stopRun() {
  if (!state.runId) throw new Error('RUN_NOT_SELECTED');
  await fetchJson(`/api/runs/${encodeURIComponent(state.runId)}/stop`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ reason: 'stopped-by-ui' }),
  });
}

async function injectMessage() {
  if (!state.runId) throw new Error('RUN_NOT_SELECTED');
  const target = q('#injectTarget').value;
  const message = q('#injectMessage').value.trim();
  if (!message) return;
  await fetchJson(`/api/runs/${encodeURIComponent(state.runId)}/inject`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ target, message }),
  });
  q('#injectMessage').value = '';
}

async function exportRun(format) {
  if (!state.runId) throw new Error('RUN_NOT_SELECTED');
  return exportRunById(state.runId, format);
}

async function exportRunById(runId, format) {
  const token = getAdminToken();
  if (!token) throw new Error('ADMIN_TOKEN_REQUIRED');

  const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/export?format=${encodeURIComponent(format)}`, {
    headers: { ...authHeaders() },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || t('toast.export_failed', { status: res.status }));
  }
  const blob = await res.blob();
  const ext = format === 'md' ? 'md' : format;
  downloadBlob(`run-${runId}.${ext}`, blob);
}

async function rolloverRunSession(role) {
  if (!state.runId) throw new Error('RUN_NOT_SELECTED');
  if (!['manager', 'executor'].includes(role)) throw new Error('ROLE_INVALID');

  const run = state.runDetail || (await fetchJson(`/api/runs/${encodeURIComponent(state.runId)}`));
  const sessionId = role === 'manager' ? run.managerSessionId : run.executorSessionId;
  if (!sessionId) throw new Error('SESSION_NOT_FOUND');

  const reason = q('#rolloverReason').value.trim();

  const result = await fetchJson(`/api/sessions/${encodeURIComponent(sessionId)}/rollover`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ runId: state.runId, reason: reason || undefined }),
  });

  // Refresh lists and keep the current run selected.
  await loadSessions(state.workspaceId);
  await loadRuns(state.workspaceId);
  await selectRun(state.runId);

  // Best-effort: update selection for creating future runs.
  if (result?.to?.id) {
    if (role === 'manager') q('#managerSessionSelect').value = result.to.id;
    if (role === 'executor') q('#executorSessionSelect').value = result.to.id;
  }

  toast('rollover_ok');
}

async function selectRun(runId) {
  state.runId = runId;
  q('#runSelect').value = runId;
  await loadRunDetail(runId);
  openRunStream(runId);
}

async function onWorkspaceChanged() {
  const workspaceId = state.workspaceId;
  if (!workspaceId) return;
  renderWorkspaceHeader();
  await loadSessions(workspaceId);
  await loadRollovers(workspaceId);
  await loadRuns(workspaceId);
  if (state.page === 'ask') await loadAskThreads(workspaceId).catch(toast);
  if (state.page === 'ask') ensureAskSse();
  if (state.page === 'files') await loadFilesList(workspaceId, state.filesDir).catch(toast);
  if (state.runId) {
    await selectRun(state.runId);
  } else {
    state.runDetail = null;
    closeEventSource();
    state.events = [];
    renderRunHeader();
    renderFeedsFromRunDetail();
    renderEvents();
  }
}

function toast(err) {
  const code =
    typeof err === 'string'
      ? err
      : String(err?.body?.error || err?.message || err);
  const key = `toast.${code}`;
  const translated = t(key);
  alert(translated !== key ? translated : code);
}

function rerenderAll() {
  applyDomI18n();
  renderHealth();
  renderWorkspacesSelect();
  renderSessions();
  renderRollovers();
  renderRuns();
  renderRunHeader();
  renderFeedsFromRunDetail();
  renderEvents();
  renderMdControls();
  renderPlanText();
  renderDigestText();
  renderHistory();
  renderHistoryDetail();
  renderAskThreads();
  renderAskMessages();
  renderAskThread();
  renderFiles();
  renderCapabilities();
  q('#sseStatus').textContent = t(state.sseStatusKey || 'sse.idle');
}

function setLanguage(lang) {
  state.lang = normalizeLang(lang);
  setUiLang(state.lang);
  rerenderAll();
}

function initI18n() {
  rerenderAll();
  const btn = q('#langToggleBtn');
  if (!btn) return;
  btn.addEventListener('click', () => setLanguage(state.lang === 'zh' ? 'en' : 'zh'));
}

function initTokenBox() {
  const input = q('#adminToken');
  input.value = getAdminToken();
  input.addEventListener('input', () => {
    setAdminToken(input.value);
    renderFiles();
    renderAskThreads();
    renderAskThread();
    ensureAskSse();
    if (state.page === 'ask' && state.workspaceId && getAdminToken()) loadAskThreads(state.workspaceId).catch(() => {});
    if (state.page === 'files' && state.workspaceId) loadFilesList(state.workspaceId, state.filesDir, { preserveSelection: true }).catch(() => {});
  });
}

function initOnboarding() {
  const dismissBtn = mustGetEl('#onboardingDismissBtn');
  dismissBtn.addEventListener('click', () => {
    setOnboardingHidden(true);
    renderOnboarding();
  });

  const resetBtn = mustGetEl('#resetOnboardingBtn');
  resetBtn.addEventListener('click', () => {
    setOnboardingHidden(false);
    renderOnboarding();
  });
}

function initNav() {
  qa('.nav__btn').forEach((btn) => {
    btn.addEventListener('click', () => setPage(btn.dataset.page));
  });
  setPage(state.page || 'dashboard');
}

function initTabs() {
  qa('.tabs__btn').forEach((btn) => {
    btn.addEventListener('click', () => setTab(btn.dataset.tab));
  });
  setTab('manager');
}

function initHandlers() {
  q('#workspaceSelect').addEventListener('change', async (e) => {
    const nextWorkspaceId = e.target.value || null;
    if (state.page === 'files' && nextWorkspaceId !== state.workspaceId) {
      if (!confirmDiscardFilesChangesIfAny()) {
        e.target.value = state.workspaceId || '';
        return;
      }
    }

    state.workspaceId = nextWorkspaceId;
    renderWorkspacesSelect();

    state.managerSessionId = null;
    state.executorSessionId = null;
    state.sessions = [];
    state.rollovers = [];
    state.runId = null;
    state.runDetail = null;
    state.runs = [];
    state.historyRunId = null;
    state.historyRunDetail = null;
    state.mdKind = 'plan';
    state.mdPath = '';
    state.mdLoadedPath = '';
    state.mdTruncated = false;
    state.planText = '';
    state.digestText = '';
    state.events = [];
    state.filesDir = '';
    state.filesItems = [];
    state.filesTruncated = false;
    state.filesIncludeHidden = false;
    state.filesReadOnly = true;
    state.filesSearch = '';
    state.filesSelectedRelPath = null;
    state.filesSelectedKind = null;
    state.filesSelectedLoading = false;
    state.filesSelectedError = '';
    state.filesSelectedText = '';
    state.filesSelectedTextOriginal = '';
    state.filesSelectedTextTruncated = false;
    state.filesSelectedMtimeMs = null;
    state.filesSelectedSizeBytes = null;
    state.filesSelectedMode = null;
    state.filesSaving = false;
    clearFilesImageUrl();
    state.askThreadId = null;
    state.askThreads = [];
    state.askThreadsSig = null;
    state.askMessages = [];
    state.askMessagesSig = null;
    state.askMessageOpen = {};
    state.askQueueItems = [];
    state.askQueueSig = null;
    state.askQueueItemOpen = {};
    state.askQueueEditId = null;
    state.askQueueEditText = '';
    state.askSendInFlight = false;
    state.askRecovering = false;
    state.askForceScrollToBottom = false;
    state.askDebugText = '';

    clearAskPoll();
    closeAskSse();
    closeEventSource();
    renderSessions();
    renderRollovers();
    renderRuns();
    renderRunHeader();
    renderFeedsFromRunDetail();
    renderEvents();
    renderMdControls();
    renderPlanText();
    renderDigestText();
    renderHistory();
    renderHistoryDetail();
    renderFiles();
    renderAskThreads();
    renderAskMessages();
    renderAskQueue();
    renderAskThread();
    await onWorkspaceChanged();
  });

  const refreshAskIfVisible = () => {
    if (document.visibilityState === 'hidden') return;
    if (state.page !== 'ask') return;
    if (!state.workspaceId) return;
    if (!getAdminToken()) return;
    ensureAskSse();
    scheduleAskSseRefresh();
  };
  document.addEventListener('visibilitychange', refreshAskIfVisible);
  window.addEventListener('focus', refreshAskIfVisible);
  window.addEventListener('online', refreshAskIfVisible);

  q('#addWorkspaceBtn').addEventListener('click', () => {
    try {
      openCreateWorkspaceModal();
    } catch (err) {
      toast(err);
    }
  });
  mustGetEl('#editWorkspaceBtn').addEventListener('click', () => {
    try {
      openEditWorkspaceModal();
    } catch (err) {
      toast(err);
    }
  });
  q('#openAskBtn').addEventListener('click', () => {
    try {
      openAskWindow();
    } catch (err) {
      toast(err);
    }
  });

  const modal = mustGetEl('#workspaceModal');
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeWorkspaceModal();
  });
  mustGetEl('#workspaceModalCloseBtn').addEventListener('click', () => closeWorkspaceModal());
  mustGetEl('#workspaceModalCancelBtn').addEventListener('click', () => closeWorkspaceModal());
  mustGetEl('#workspaceModalCreateBtn').addEventListener('click', () => {
    submitWorkspaceModal().catch((err) => setWorkspaceModalError(formatApiError(err, 'WORKSPACE_MODAL_SUBMIT')));
  });

  const docModal = mustGetEl('#workspaceDocModal');
  docModal.addEventListener('click', (e) => {
    if (e.target === docModal) closeWorkspaceDocModal();
  });
  mustGetEl('#workspaceDocModalCloseBtn').addEventListener('click', () => closeWorkspaceDocModal());
  const docRenderToggle = mustGetEl('#workspaceDocRenderToggle');
  docRenderToggle.checked = Boolean(state.workspaceDocRenderMarkdown);
  docRenderToggle.addEventListener('change', (e) => {
    state.workspaceDocRenderMarkdown = Boolean(e.target.checked);
    renderWorkspaceDocModalBody();
  });

  q('#managerSessionSelect').addEventListener('change', (e) => {
    state.managerSessionId = e.target.value || null;
    renderSelectedSessionInfo();
  });
  q('#executorSessionSelect').addEventListener('change', (e) => {
    state.executorSessionId = e.target.value || null;
    renderSelectedSessionInfo();
  });

  q('#refreshHealthBtn').addEventListener('click', () => loadHealth().catch(toast));
  q('#allowedRootsLoadBtn').addEventListener('click', () => loadAllowedRootsEditorFromHealthFromUi());
  q('#allowedRootsSaveBtn').addEventListener('click', () => saveAllowedRootsFromUi().catch(() => {}));
  q('#allowedRootsResetBtn').addEventListener('click', () => resetAllowedRootsFromUi().catch(() => {}));
  q('#refreshHistoryBtn').addEventListener('click', () => loadRuns(state.workspaceId).catch(toast));
  q('#refreshSessionsBtn').addEventListener('click', () => loadSessions(state.workspaceId).catch(toast));
  q('#refreshRolloversBtn').addEventListener('click', () => loadRollovers(state.workspaceId).catch(toast));

  q('#historyToggleListBtn').addEventListener('click', () => {
    state.historyListCollapsed = !state.historyListCollapsed;
    persistHistoryLayoutPrefs();
    renderHistoryLayout();
  });

  q('#historyFilter').addEventListener('input', () => renderHistory());
  q('#historyTurnSearch').addEventListener('input', () => renderHistoryDetail());
  q('#historyList').addEventListener('click', async (e) => {
    const targetEl = eventTargetElement(e.target);
    const viewBtn = targetEl ? targetEl.closest('button[data-action="view-run"]') : null;
    if (viewBtn) {
      await loadHistoryRunDetail(viewBtn.dataset.runId);
      return;
    }
    const dashBtn = targetEl ? targetEl.closest('button[data-action="dashboard-run"]') : null;
    if (dashBtn) {
      setPage('dashboard');
      await selectRun(dashBtn.dataset.runId);
    }
  });
  q('#historyToDashboardBtn').addEventListener('click', async () => {
    if (!state.historyRunId) return;
    setPage('dashboard');
    await selectRun(state.historyRunId);
  });
  q('#historyExportMdBtn').addEventListener('click', () => {
    if (!state.historyRunId) return toast('RUN_NOT_SELECTED');
    exportRunById(state.historyRunId, 'md').catch(toast);
  });
  q('#historyExportJsonBtn').addEventListener('click', () => {
    if (!state.historyRunId) return toast('RUN_NOT_SELECTED');
    exportRunById(state.historyRunId, 'json').catch(toast);
  });
  const historyMdToggle = q('#historyRenderMdToggle');
  if (historyMdToggle) {
    historyMdToggle.checked = Boolean(state.historyRenderMarkdown);
    historyMdToggle.addEventListener('change', (e) => {
      state.historyRenderMarkdown = Boolean(e.target.checked);
      setStoredBool(HISTORY_RENDER_MD_KEY, state.historyRenderMarkdown);
      renderHistoryDetail();
    });
  }

  q('#refreshCapabilitiesBtn').addEventListener('click', () => loadCapabilities().catch(toast));
  q('#probeCapabilitiesBtn').addEventListener('click', () => probeCapabilities().catch(toast));
  q('#createDefaultSessionsBtn').addEventListener('click', () => createDefaultSessions().catch(toast));
  q('#createSessionBtn').addEventListener('click', async () => {
    const workspaceId = state.workspaceId;
    if (!workspaceId) return toast('WORKSPACE_NOT_SELECTED');
    const provider = q('#newSessionProvider').value;
    const role = q('#newSessionRole').value;
    const sandbox = q('#newSessionSandbox').value;
    const mode = q('#newSessionMode').value;
    const systemPromptPath = q('#newSessionPromptPath').value.trim();
    const model = q('#newSessionModel').value.trim();
    const modelReasoningEffort = q('#newSessionEffort').value;
    const outputFormat = q('#newSessionOutputFormat').value;
    const permissionMode = q('#newSessionPermissionMode').value;
    const toolsDisabled = Boolean(q('#newSessionToolsDisabled').checked);
    const tools = q('#newSessionTools').value.trim();
    const includePartialMessages = Boolean(q('#newSessionIncludePartial').checked);
    const sessionPersistence = Boolean(q('#newSessionSessionPersistence').checked);

    await createSession({
      workspaceId,
      role,
      provider,
      sandbox,
      mode: mode || undefined,
      systemPromptPath,
      model: model || undefined,
      modelReasoningEffort: modelReasoningEffort || undefined,
      outputFormat: outputFormat || undefined,
      includePartialMessages,
      permissionMode: permissionMode || undefined,
      tools: tools || undefined,
      toolsDisabled,
      sessionPersistence,
    });
    await loadSessions(workspaceId);
  });

  setModelInputProvider(q('#newSessionModel'), q('#newSessionProvider').value);
  refreshModelPresetSelect(q('#newSessionModelPreset'), q('#newSessionModel'), q('#newSessionProvider').value);
  q('#newSessionProvider').addEventListener('change', (e) => {
    setModelInputProvider(q('#newSessionModel'), e.target.value);
    refreshModelPresetSelect(q('#newSessionModelPreset'), q('#newSessionModel'), e.target.value);
  });
  q('#editSessionProvider').addEventListener('change', (e) => {
    const provider = e.target.value || getSessionById(q('#editSessionSelect').value)?.provider;
    setModelInputProvider(q('#editSessionModel'), provider);
    refreshModelPresetSelect(q('#editSessionModelPreset'), q('#editSessionModel'), provider);
  });

  q('#newSessionModelPreset').addEventListener('change', (e) => {
    const v = String(e.target.value || '').trim();
    if (!v) return;
    q('#newSessionModel').value = v;
    syncModelPresetSelectToInput(q('#newSessionModelPreset'), q('#newSessionModel'));
  });
  q('#newSessionModel').addEventListener('input', () => {
    syncModelPresetSelectToInput(q('#newSessionModelPreset'), q('#newSessionModel'));
  });

  q('#editSessionModelPreset').addEventListener('change', (e) => {
    const v = String(e.target.value || '').trim();
    if (!v) return;
    q('#editSessionModel').value = v;
    syncModelPresetSelectToInput(q('#editSessionModelPreset'), q('#editSessionModel'));
  });
  q('#editSessionModel').addEventListener('input', () => {
    syncModelPresetSelectToInput(q('#editSessionModelPreset'), q('#editSessionModel'));
  });

  q('#askModelPreset').addEventListener('change', (e) => {
    const v = String(e.target.value || '').trim();
    if (!v) return;
    q('#askModelInput').value = v;
    syncModelPresetSelectToInput(q('#askModelPreset'), q('#askModelInput'));
  });
  q('#askModelInput').addEventListener('input', () => {
    syncModelPresetSelectToInput(q('#askModelPreset'), q('#askModelInput'));
  });

  q('#editSessionSelect').addEventListener('change', (e) => fillEditSessionForm(e.target.value));
  q('#saveSessionBtn').addEventListener('click', () => saveEditedSession().catch(toast));
  q('#resetProviderSessionBtn').addEventListener('click', () => resetProviderSessionId().catch(toast));
  q('#copySessionIdBtn').addEventListener('click', () => copySessionId().catch(toast));

  q('#createRunBtn').addEventListener('click', () => createRun().catch(toast));
  q('#runSelect').addEventListener('change', (e) => {
    const id = e.target.value;
    if (!id) return;
    selectRun(id).catch(toast);
  });

  q('#startRunBtn').addEventListener('click', () => startRun('start').catch(toast));
  q('#stepRunBtn').addEventListener('click', () => startRun('step').catch(toast));
  q('#pauseRunBtn').addEventListener('click', () => pauseRun().catch(toast));
  q('#stopRunBtn').addEventListener('click', () => stopRun().catch(toast));

  q('#injectSendBtn').addEventListener('click', () => injectMessage().catch(toast));
  q('#injectMessage').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') injectMessage().catch(toast);
  });

  q('#exportMdBtn').addEventListener('click', () => exportRun('md').catch(toast));
  q('#exportJsonBtn').addEventListener('click', () => exportRun('json').catch(toast));
  q('#exportJsonlBtn').addEventListener('click', () => exportRun('jsonl').catch(toast));
  q('#rolloverManagerBtn').addEventListener('click', () => rolloverRunSession('manager').catch(toast));
  q('#rolloverExecutorBtn').addEventListener('click', () => rolloverRunSession('executor').catch(toast));

  q('#loadPlanBtn').addEventListener('click', () => openWorkspaceDocModal('plan').catch(toast));
  q('#loadConventionBtn').addEventListener('click', () => openWorkspaceDocModal('convention').catch(toast));
  q('#loadDigestBtn').addEventListener('click', () => loadDigest(state.workspaceId).catch(toast));

  q('#mdKindSelect').addEventListener('change', (e) => {
    state.mdKind = e.target.value || 'plan';
    renderMdControls();
    if (!state.workspaceId) return;
    if (state.mdKind === 'plan') loadPlan(state.workspaceId).catch(toast);
    if (state.mdKind === 'convention') loadConvention(state.workspaceId).catch(toast);
  });
  q('#mdPathInput').addEventListener('input', (e) => {
    state.mdPath = e.target.value || '';
  });
  q('#mdPathInput').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    loadMarkdownFromUi().catch(toast);
  });
  q('#loadMdBtn').addEventListener('click', () => loadMarkdownFromUi().catch(toast));

  q('#filesBreadcrumb').addEventListener('click', (e) => {
    const targetEl = eventTargetElement(e.target);
    const el = targetEl ? targetEl.closest('[data-files-bc]') : null;
    if (!el) return;
    openFilesDirFromUi(el.dataset.filesBc || '').catch(toast);
  });
  q('#filesUpBtn').addEventListener('click', () => openFilesDirFromUi(parentRelDir(state.filesDir)).catch(toast));
  q('#filesRefreshBtn').addEventListener('click', () => loadFilesList(state.workspaceId, state.filesDir, { preserveSelection: true }).catch(toast));
  q('#filesSearch').addEventListener('input', (e) => {
    state.filesSearch = e.target.value || '';
    renderFilesList();
  });
  q('#filesList').addEventListener('click', (e) => {
    const targetEl = eventTargetElement(e.target);
    const item = targetEl ? targetEl.closest('[data-files-path]') : null;
    if (!item) return;
    selectFilesItemFromUi(item.dataset.filesPath, item.dataset.filesKind).catch(toast);
  });
  q('#filesEditor').addEventListener('input', (e) => {
    state.filesSelectedText = e.target.value || '';
    renderFilesPreview();
  });
  q('#filesEditor').addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && String(e.key || '').toLowerCase() === 's') {
      e.preventDefault();
      saveFilesTextFromUi().catch(toast);
    }
  });
  q('#filesSaveBtn').addEventListener('click', () => {
    saveFilesTextFromUi().catch((err) => {
      if (err?.status === 409 && String(err?.body?.error || '') === 'FILE_CHANGED') {
        if (confirm(`${t('toast.FILE_CHANGED')}\n\n${t('files.reload')}?`)) {
          reloadFilesSelectedFromUi().catch(() => {});
          return;
        }
      }
      toast(err);
    });
  });
  q('#filesReloadBtn').addEventListener('click', () => reloadFilesSelectedFromUi().catch(toast));

  q('#wsAddSubmit').addEventListener('click', () => createWorkspaceFromSettings().catch(toast));

  q('#askToggleThreadsBtn').addEventListener('click', () => {
    state.askThreadsCollapsed = !state.askThreadsCollapsed;
    persistAskLayoutPrefs();
    renderAskLayout();
  });
  q('#askToggleConfigBtn').addEventListener('click', () => {
    state.askConfigCollapsed = !state.askConfigCollapsed;
    persistAskLayoutPrefs();
    renderAskLayout();
  });

  q('#askThreadSearch').addEventListener('input', (e) => {
    state.askThreadFilter = e.target.value || '';
    renderAskThreads();
  });
  q('#askNewThreadBtn').addEventListener('click', () => createAskThreadFromUi().catch(toast));
  q('#askThreadsList').addEventListener('click', (e) => {
    const targetEl = eventTargetElement(e.target);
    const item = targetEl ? targetEl.closest('[data-ask-thread-id]') : null;
    if (!item) return;
    selectAskThreadById(item.dataset.askThreadId).catch(toast);
  });
  q('#askSendBtn').addEventListener('click', () => sendAskFromUi().catch(toast));
  q('#askStopBtn').addEventListener('click', () => stopAskFromUi().catch(toast));
  q('#askInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      sendAskFromUi().catch(toast);
    }
  });
  q('#askExportMdBtn').addEventListener('click', () => exportAskThread('md').catch(toast));
  q('#askExportJsonlBtn').addEventListener('click', () => exportAskThread('jsonl').catch(toast));
  const askMdToggle = q('#askRenderMdToggle');
  if (askMdToggle) {
    askMdToggle.checked = Boolean(state.askRenderMarkdown);
    askMdToggle.addEventListener('change', (e) => {
      state.askRenderMarkdown = Boolean(e.target.checked);
      setStoredBool(ASK_RENDER_MD_KEY, state.askRenderMarkdown);
      renderAskMessages();
    });
  }
  q('#askSaveTitleBtn').addEventListener('click', () => saveAskTitleFromUi().catch(toast));
  q('#askSaveConfigBtn').addEventListener('click', () => saveAskConfigFromUi().catch(toast));
  q('#askResetResumeBtn').addEventListener('click', () => resetAskResumeFromUi().catch(toast));
  q('#askDeleteThreadBtn').addEventListener('click', () => deleteAskThreadFromUi().catch(toast));
}

async function init() {
  loadAskLayoutPrefs();
  loadHistoryLayoutPrefs();
  initI18n();
  initTokenBox();
  initOnboarding();
  initNav();
  initTabs();
  initHandlers();

  await loadHealth();
  await loadCapabilities();
  await loadWorkspaces();

  const preferredWorkspaceId = URL_INITIAL_WORKSPACE_ID || getStoredWorkspaceId();
  if (preferredWorkspaceId && state.workspaces.some((w) => w.id === preferredWorkspaceId)) {
    state.workspaceId = preferredWorkspaceId;
    renderWorkspacesSelect();
  }
  if (state.workspaceId) {
    setStoredWorkspaceId(state.workspaceId);
    syncWorkspaceIdToUrl(state.workspaceId);
    await onWorkspaceChanged();
  }
}

init().catch(toast);
