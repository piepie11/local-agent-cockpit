/**
 * M3 (probe): Capability detection for Codex CLI and Claude Code CLI.
 *
 * Purpose:
 * - Produce a reproducible snapshot of local CLI availability / flags (no model calls).
 * - Write artifacts under runs/capabilities-* (gitignored).
 */

const fs = require('fs');
const path = require('path');

const { writeRunEnv } = require('../src/lib/run_env');
const { probeCapabilities } = require('../src/capabilities');

function getTimestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(
    now.getMinutes()
  )}${pad(now.getSeconds())}`;
}

async function main() {
  const projectRoot = path.resolve(__dirname, '..');
  const outDir = path.join(projectRoot, 'runs', `capabilities-${getTimestamp()}`);
  fs.mkdirSync(outDir, { recursive: true });
  await writeRunEnv({ outDir, cwd: projectRoot, extra: { kind: 'script', script: 'm3_capabilities' } });

  const snapshot = await probeCapabilities({ cwd: projectRoot });
  const outPath = path.join(outDir, 'capabilities.json');
  fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf-8');

  const codex = snapshot.providers?.codex;
  const claude = snapshot.providers?.claude;

  console.log(`[m3_capabilities] out=${outPath}`);
  console.log(`[m3_capabilities] codex.ok=${Boolean(codex?.ok)} features=${JSON.stringify(codex?.features || {})}`);
  console.log(`[m3_capabilities] claude.ok=${Boolean(claude?.ok)} features=${JSON.stringify(claude?.features || {})}`);
}

main().catch((err) => {
  console.error(`[m3_capabilities] FAIL: ${err.message}`);
  process.exit(1);
});

