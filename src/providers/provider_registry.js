const { runCodexExec } = require('./codex_exec');
const { runClaudeExec } = require('./claude_exec');
const { runFakeExec } = require('./fake_exec');

function getProvider(name) {
  const key = String(name || '').toLowerCase();
  if (key === 'codex') return { name: 'codex', run: runCodexExec };
  if (key === 'claude') return { name: 'claude', run: runClaudeExec };
  if (key === 'fake') return { name: 'fake', run: runFakeExec };
  throw new Error(`PROVIDER_UNSUPPORTED:${name}`);
}

module.exports = { getProvider };
