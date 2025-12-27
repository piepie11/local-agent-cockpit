const fs = require('fs');
const path = require('path');

const { spawnCapture } = require('./lib/spawn_capture');

function shouldSkip(name) {
  return (
    name === '.git' ||
    name === 'node_modules' ||
    name === 'runs' ||
    name === 'data' ||
    name === '.next' ||
    name === 'dist' ||
    name === 'build'
  );
}

function treeDigest(rootPath, opts) {
  const maxDepth = opts?.maxDepth ?? 3;
  const maxLines = opts?.maxLines ?? 300;

  const lines = [];
  function walk(current, depth, prefix) {
    if (lines.length >= maxLines) return;
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (lines.length >= maxLines) break;
      if (shouldSkip(entry.name)) continue;
      const rel = path.relative(rootPath, path.join(current, entry.name));
      const label = entry.isDirectory() ? `${rel}/` : rel;
      lines.push(prefix + label);
      if (entry.isDirectory()) {
        walk(path.join(current, entry.name), depth + 1, prefix);
      }
    }
  }

  walk(rootPath, 0, '');
  if (lines.length >= maxLines) lines.push('...(tree truncated)');
  return lines.join('\n');
}

async function getRepoDigest(rootPath, opts) {
  const includeTree = opts?.includeTree ?? true;
  const includeGitStatus = opts?.includeGitStatus ?? true;
  const includeGitDiffStat = opts?.includeGitDiffStat ?? true;

  const parts = [];

  if (includeTree) {
    parts.push('## tree');
    parts.push(treeDigest(rootPath, opts?.tree));
  }

  if (includeGitStatus) {
    const r = await spawnCapture('git', ['-C', rootPath, 'status', '--porcelain'], { timeoutMs: 15_000 });
    parts.push('## git status --porcelain');
    parts.push((r.stdout || '').trim() || '(clean or not a git repo)');
  }

  if (includeGitDiffStat) {
    const r = await spawnCapture('git', ['-C', rootPath, 'diff', '--stat'], { timeoutMs: 15_000 });
    parts.push('## git diff --stat');
    parts.push((r.stdout || '').trim() || '(no diff or not a git repo)');
  }

  return parts.join('\n');
}

module.exports = { getRepoDigest };

