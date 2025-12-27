const fs = require('fs');
const path = require('path');

const { spawnCaptureSmart } = require('./lib/spawn_capture_smart');

function nowIso() {
  return new Date().toISOString();
}

function safeLower(text) {
  return String(text || '').toLowerCase();
}

function hasFlag(helpText, needle) {
  return safeLower(helpText).includes(String(needle).toLowerCase());
}

function buildCodexFeatures(execHelpText, resumeHelpText) {
  return {
    hasExec: Boolean(execHelpText),
    hasResume: hasFlag(execHelpText, '\n  resume') || Boolean(resumeHelpText),
    hasResumeLast: hasFlag(resumeHelpText, '--last'),
    hasJson: hasFlag(execHelpText, '--json'),
    hasOutputLastMessage: hasFlag(execHelpText, '--output-last-message'),
    hasSandbox: hasFlag(execHelpText, '--sandbox') || hasFlag(execHelpText, '-s, --sandbox'),
    hasModel: hasFlag(execHelpText, '--model') || hasFlag(execHelpText, '-m, --model'),
    hasConfig: hasFlag(execHelpText, '--config') || hasFlag(execHelpText, '-c, --config'),
    hasCd: hasFlag(execHelpText, '--cd') || hasFlag(execHelpText, '-c, --cd') || hasFlag(execHelpText, '-C, --cd'),
  };
}

function buildClaudeFeatures(helpText) {
  return {
    hasHelp: Boolean(helpText),
    hasOutputFormat: hasFlag(helpText, '--output-format'),
    hasStreamJson: hasFlag(helpText, 'stream-json'),
    hasIncludePartial: hasFlag(helpText, '--include-partial-messages'),
    hasResume: hasFlag(helpText, '--resume'),
    hasContinue: hasFlag(helpText, '--continue'),
    hasModel: hasFlag(helpText, '--model'),
  };
}

async function probeCodex({ cwd, timeoutMs }) {
  const version = await spawnCaptureSmart('codex', ['--version'], { cwd, timeoutMs });
  const execHelp = await spawnCaptureSmart('codex', ['exec', '--help'], { cwd, timeoutMs });
  const resumeHelp = await spawnCaptureSmart('codex', ['exec', 'resume', '--help'], { cwd, timeoutMs });

  const features = buildCodexFeatures(execHelp.stdout, resumeHelp.exitCode === 0 ? resumeHelp.stdout : '');

  return { ok: version.ok || execHelp.ok, version, execHelp, resumeHelp, features };
}

async function probeClaude({ cwd, timeoutMs }) {
  const v1 = await spawnCaptureSmart('claude', ['-v'], { cwd, timeoutMs });
  const v2 = v1.ok ? null : await spawnCaptureSmart('claude', ['--version'], { cwd, timeoutMs });
  const version = v2 || v1;

  const help = await spawnCaptureSmart('claude', ['--help'], { cwd, timeoutMs });
  const features = buildClaudeFeatures(help.stdout);

  return { ok: version.ok || help.ok, version, help, features };
}

async function probeCapabilities({ cwd, timeoutMs = 8000 } = {}) {
  const snapshot = {
    ts: nowIso(),
    cwd: cwd || process.cwd(),
    platform: process.platform,
    nodeV: process.version,
    providers: {
      codex: await probeCodex({ cwd, timeoutMs }),
      claude: await probeClaude({ cwd, timeoutMs }),
    },
  };
  return snapshot;
}

function getCapabilitiesFilePath(config) {
  const dbPath = String(config?.dbPath || '').trim();
  const dataDir = dbPath ? path.dirname(dbPath) : path.join(process.cwd(), 'data');
  return path.join(dataDir, 'capabilities.json');
}

function loadCapabilitiesFromDisk(config) {
  try {
    const p = getCapabilitiesFilePath(config);
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function persistCapabilitiesToDisk(config, snapshot) {
  const p = getCapabilitiesFilePath(config);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(snapshot, null, 2) + '\n', 'utf-8');
  return { path: p };
}

module.exports = {
  probeCapabilities,
  loadCapabilitiesFromDisk,
  persistCapabilitiesToDisk,
  getCapabilitiesFilePath,
};
