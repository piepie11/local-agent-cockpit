const fs = require('fs');
const path = require('path');

function stripBOM(text) {
  if (!text) return '';
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function parseEnvLine(rawLine) {
  const line = String(rawLine ?? '').trim();
  if (!line) return null;
  if (line.startsWith('#')) return null;

  const normalized = line.startsWith('export ') ? line.slice('export '.length).trim() : line;
  const eq = normalized.indexOf('=');
  if (eq === -1) return null;

  const key = normalized.slice(0, eq).trim();
  if (!key) return null;

  let value = normalized.slice(eq + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }

  return { key, value };
}

function loadEnvFile(filePath, { override = false } = {}) {
  const p = String(filePath || '').trim();
  if (!p) return { ok: false, loaded: false, count: 0 };

  try {
    if (!fs.existsSync(p)) return { ok: true, loaded: false, count: 0 };
    const text = stripBOM(fs.readFileSync(p, 'utf-8'));
    let count = 0;
    for (const rawLine of text.split(/\r?\n/g)) {
      const kv = parseEnvLine(rawLine);
      if (!kv) continue;
      if (!override && process.env[kv.key] !== undefined) continue;
      process.env[kv.key] = kv.value;
      count += 1;
    }
    return { ok: true, loaded: true, count };
  } catch (err) {
    return { ok: false, loaded: false, count: 0, error: String(err?.message || err) };
  }
}

function loadProjectEnv({ projectRoot } = {}) {
  const root = projectRoot ? path.resolve(projectRoot) : process.cwd();
  const results = [];
  results.push(loadEnvFile(path.join(root, '.env'), { override: false }));
  results.push(loadEnvFile(path.join(root, '.env.local'), { override: false }));
  return results;
}

module.exports = { loadEnvFile, loadProjectEnv };

