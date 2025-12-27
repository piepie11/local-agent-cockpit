const fs = require('fs');
const path = require('path');

function isGitRepo(dir) {
  try {
    let current = path.resolve(dir);
    const root = path.parse(current).root;

    while (current !== root) {
      const gitDir = path.join(current, '.git');
      if (fs.existsSync(gitDir)) return true;
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }

    const rootGitDir = path.join(root, '.git');
    return fs.existsSync(rootGitDir);
  } catch {
    return false;
  }
}

module.exports = { isGitRepo };

