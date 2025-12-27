const { sendPushPlus } = require('./pushplus');

function nowMs() {
  return Date.now();
}

function pruneMapByAge(map, ttlMs, now) {
  if (!map || map.size === 0) return;
  const cutoff = now - ttlMs;
  for (const [k, ts] of map.entries()) {
    if (ts < cutoff) map.delete(k);
  }
}

function normalizeString(value) {
  const s = String(value ?? '').trim();
  return s ? s : null;
}

function normalizeBool(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  const v = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(v)) return false;
  return fallback;
}

function buildEffectiveSettings(config) {
  const notifications = config?.notifications || {};
  const pushplus = notifications?.pushplus || {};

  const token = normalizeString(pushplus.token);
  const enabledConfig = notifications.enabled;
  const enabled =
    Boolean(token) && (enabledConfig === null || enabledConfig === undefined ? true : normalizeBool(enabledConfig, false));

  return {
    enabled,
    baseUrl: normalizeString(notifications.baseUrl),
    notifyRunFinal: normalizeBool(notifications.notifyRunFinal, true),
    notifyRunStep: normalizeBool(notifications.notifyRunStep, true),
    notifyAskReply: normalizeBool(notifications.notifyAskReply, true),
    pushplus: {
      token,
      endpoint: normalizeString(pushplus.endpoint) || 'https://www.pushplus.plus/send',
      channel: normalizeString(pushplus.channel) || 'wechat',
      template: normalizeString(pushplus.template) || 'markdown',
    },
  };
}

function shouldNotifyType(type, settings) {
  const t = String(type || '').trim().toLowerCase();
  if (t === 'run_final') return Boolean(settings.notifyRunFinal);
  if (t === 'run_step') return Boolean(settings.notifyRunStep);
  if (t === 'ask_reply') return Boolean(settings.notifyAskReply);
  return true;
}

class Notifier {
  constructor({ settings }) {
    this.settings = settings;
    this._chain = Promise.resolve();
    this._dedupe = new Map();
    this._dedupeTtlMs = 12 * 60 * 60 * 1000;
  }

  isEnabled() {
    return Boolean(this.settings?.enabled);
  }

  notify({ type, title, content, dedupeKey }) {
    if (!this.isEnabled()) return Promise.resolve({ ok: false, skipped: true, reason: 'disabled' });
    if (!shouldNotifyType(type, this.settings)) return Promise.resolve({ ok: false, skipped: true, reason: 'filtered' });

    const key = normalizeString(dedupeKey);
    if (key) {
      const now = nowMs();
      pruneMapByAge(this._dedupe, this._dedupeTtlMs, now);
      const prev = this._dedupe.get(key);
      if (prev && now - prev < this._dedupeTtlMs) {
        return Promise.resolve({ ok: false, skipped: true, reason: 'deduped' });
      }
      this._dedupe.set(key, now);
    }

    const task = async () => {
      try {
        const body = await sendPushPlus({
          endpoint: this.settings.pushplus.endpoint,
          token: this.settings.pushplus.token,
          title,
          content,
          template: this.settings.pushplus.template,
          channel: this.settings.pushplus.channel,
        });
        return { ok: true, body };
      } catch (err) {
        const msg = String(err?.message || err);
        // eslint-disable-next-line no-console
        console.error(`[notify] failed: ${msg}`);
        return { ok: false, error: msg };
      }
    };

    this._chain = this._chain.then(task, task);
    return this._chain;
  }
}

function createNotifier({ config }) {
  const settings = buildEffectiveSettings(config);
  return new Notifier({ settings });
}

module.exports = { createNotifier };

