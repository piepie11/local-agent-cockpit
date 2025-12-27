const path = require('path');

function isInside(parentDir, childPath) {
  const rel = path.relative(parentDir, childPath);
  if (!rel) return true;
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

function isWorkspacePathAllowed(absPath, allowedRoots) {
  const resolved = path.resolve(absPath);
  for (const root of allowedRoots) {
    const resolvedRoot = path.resolve(root);
    if (isInside(resolvedRoot, resolved)) return true;
  }
  return false;
}

module.exports = { isWorkspacePathAllowed, isInside };
