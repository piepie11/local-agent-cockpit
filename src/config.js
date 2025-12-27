const crypto = require('crypto');
const path = require('path');

const { loadProjectEnv } = require('./lib/env_file');

// Load `.env` / `.env.local` early so config can read from process.env.
// No override: explicit env vars win.
loadProjectEnv({ projectRoot: path.resolve(__dirname, '..') });

function parseList(value) {
  if (!value) return [];
  return value
    .split(/[;,]/g)
    .map((v) => v.trim())
    .filter(Boolean);
}

function resolveAbsolute(p) {
  if (!p) return '';
  return path.resolve(p);
}

function resolveAllowedWorkspaceRoots() {
  const rawRoots = parseList(process.env.ALLOWED_WORKSPACE_ROOTS);
  if (rawRoots.length) return rawRoots.map(resolveAbsolute);
  return [path.resolve(process.cwd(), '..')];
}

function parseIntOrDefault(value, fallback) {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

function parseBoolOrDefault(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const v = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(v)) return false;
  return fallback;
}

const config = {
  port: parseIntOrDefault(process.env.PORT, 18787),
  host: process.env.HOST || '0.0.0.0',
  adminToken: process.env.ADMIN_TOKEN || crypto.randomBytes(24).toString('hex'),
  adminTokenSource: process.env.ADMIN_TOKEN ? 'env' : 'generated',
  allowedWorkspaceRoots: resolveAllowedWorkspaceRoots(),
  maxConcurrentRuns: parseIntOrDefault(process.env.MAX_CONCURRENT_RUNS, 2),
  dbPath: resolveAbsolute(process.env.DB_PATH) || path.join(process.cwd(), 'data', 'app.sqlite'),
  runsDir: resolveAbsolute(process.env.RUNS_DIR) || path.join(process.cwd(), 'runs'),
  readOnlyMode: String(process.env.READ_ONLY_MODE || '').toLowerCase() === 'true',
  notifications: {
    baseUrl: String(process.env.PUSH_BASE_URL || '').trim() || null,
    enabled: parseBoolOrDefault(process.env.PUSH_NOTIFICATIONS_ENABLED, null),
    notifyRunFinal: parseBoolOrDefault(process.env.PUSH_NOTIFY_RUN_FINAL, true),
    notifyRunStep: parseBoolOrDefault(process.env.PUSH_NOTIFY_RUN_STEP, true),
    notifyAskReply: parseBoolOrDefault(process.env.PUSH_NOTIFY_ASK_REPLY, true),
    pushplus: {
      token: String(process.env.PUSHPLUS_TOKEN || '').trim() || null,
      endpoint: String(process.env.PUSHPLUS_ENDPOINT || '').trim() || 'https://www.pushplus.plus/send',
      channel: String(process.env.PUSHPLUS_CHANNEL || '').trim() || 'wechat',
      template: String(process.env.PUSHPLUS_TEMPLATE || '').trim() || 'markdown',
    },
  },
};

module.exports = { config };
