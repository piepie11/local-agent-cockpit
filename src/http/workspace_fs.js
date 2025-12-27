const fs = require('fs');
const path = require('path');

const { isInside } = require('./paths');

function normalizeRelPath(raw) {
  const value = String(raw ?? '').trim();
  if (!value || value === '.') return '';
  if (value.includes('\0')) throw new Error('PATH_INVALID');
  if (path.isAbsolute(value)) throw new Error('PATH_NOT_RELATIVE');
  if (/^[a-zA-Z]:/.test(value)) throw new Error('PATH_NOT_RELATIVE');
  if (value.startsWith('\\\\')) throw new Error('PATH_NOT_RELATIVE');
  if (value.startsWith('/') || value.startsWith('\\')) throw new Error('PATH_NOT_RELATIVE');
  return value.replace(/\\/g, '/');
}

function splitRelPath(relPath) {
  const raw = String(relPath ?? '').trim();
  if (!raw) return [];
  return raw.split(/[\\/]+/g).filter(Boolean);
}

function isHiddenRelPath(relPath) {
  const parts = splitRelPath(relPath);
  for (const p of parts) {
    if (p === '.' || p === '..') continue;
    if (p.startsWith('.')) return true;
  }
  return false;
}

function normalizeFsPathForInsideCheck(p) {
  const resolved = path.resolve(String(p || ''));
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function assertInsideWorkspace({ rootPath, absPath }) {
  const rootReal = fs.realpathSync(rootPath);
  const absReal = fs.realpathSync(absPath);
  const rootCheck = normalizeFsPathForInsideCheck(rootReal);
  const absCheck = normalizeFsPathForInsideCheck(absReal);
  if (!isInside(rootCheck, absCheck)) throw new Error('PATH_OUTSIDE_WORKSPACE');
  return { rootReal, absReal };
}

function resolveWorkspaceAbsPath({ rootPath, relPath }) {
  const absPath = path.resolve(rootPath, relPath || '.');
  if (!isInside(normalizeFsPathForInsideCheck(rootPath), normalizeFsPathForInsideCheck(absPath))) {
    throw new Error('PATH_OUTSIDE_WORKSPACE');
  }
  return absPath;
}

function listDir({ rootPath, relDirPath, includeHidden, limit = 500 }) {
  const relPath = normalizeRelPath(relDirPath);
  const absPath = resolveWorkspaceAbsPath({ rootPath, relPath });
  if (!fs.existsSync(absPath)) throw new Error('FILE_NOT_FOUND');
  assertInsideWorkspace({ rootPath, absPath });

  const stat = fs.statSync(absPath);
  if (!stat.isDirectory()) throw new Error('PATH_NOT_DIR');

  const maxEntries = Number.isFinite(Number(limit)) ? Number(limit) : 500;
  const out = [];
  let truncated = false;
  const dir = fs.opendirSync(absPath);
  try {
    while (true) {
      const dirent = dir.readSync();
      if (!dirent) break;
      const name = dirent.name;
      if (!includeHidden && name.startsWith('.')) continue;
      out.push({
        name,
        relPath: relPath ? `${relPath}/${name}` : name,
        kind: dirent.isDirectory() ? 'dir' : dirent.isFile() ? 'file' : dirent.isSymbolicLink() ? 'symlink' : 'other',
      });
      if (out.length >= maxEntries) {
        truncated = true;
        break;
      }
    }
  } finally {
    try {
      dir.closeSync();
    } catch {}
  }

  out.sort((a, b) => {
    const rank = (k) => (k === 'dir' ? 0 : k === 'file' ? 1 : 2);
    const r0 = rank(a.kind);
    const r1 = rank(b.kind);
    if (r0 !== r1) return r0 - r1;
    return String(a.name).localeCompare(String(b.name));
  });

  return { relPath, absPath, items: out, truncated };
}

function looksBinary(buf) {
  if (!buf || buf.length === 0) return false;
  const sample = buf.subarray(0, Math.min(buf.length, 8192));
  for (const byte of sample) {
    if (byte === 0) return true;
  }
  return false;
}

function readTextFile({ rootPath, relFilePath, includeHidden, maxChars = 1_000_000 }) {
  const relPath = normalizeRelPath(relFilePath);
  if (!relPath) throw new Error('PATH_REQUIRED');
  if (!includeHidden && isHiddenRelPath(relPath)) throw new Error('HIDDEN_PATH_FORBIDDEN');

  const absPath = resolveWorkspaceAbsPath({ rootPath, relPath });
  if (!fs.existsSync(absPath)) throw new Error('FILE_NOT_FOUND');
  assertInsideWorkspace({ rootPath, absPath });

  const stat = fs.statSync(absPath);
  if (!stat.isFile()) throw new Error('PATH_NOT_FILE');

  const buf = fs.readFileSync(absPath);
  if (looksBinary(buf)) throw new Error('FILE_NOT_TEXT');

  const text = buf.toString('utf-8');
  const truncated = text.length > maxChars;
  const content = truncated ? `${text.slice(0, maxChars)}\n...(truncated)` : text;

  return {
    relPath,
    absPath,
    content,
    truncated,
    sizeBytes: stat.size,
    mtimeMs: Math.floor(stat.mtimeMs),
  };
}

function writeTextFile({ rootPath, relFilePath, includeHidden, content, baseMtimeMs }) {
  const relPath = normalizeRelPath(relFilePath);
  if (!relPath) throw new Error('PATH_REQUIRED');
  if (!includeHidden && isHiddenRelPath(relPath)) throw new Error('HIDDEN_PATH_FORBIDDEN');

  const absPath = resolveWorkspaceAbsPath({ rootPath, relPath });
  if (!fs.existsSync(absPath)) throw new Error('FILE_NOT_FOUND');
  assertInsideWorkspace({ rootPath, absPath });

  const stat = fs.statSync(absPath);
  if (!stat.isFile()) throw new Error('PATH_NOT_FILE');

  if (stat.size > 0) {
    let fd;
    try {
      fd = fs.openSync(absPath, 'r');
      const sampleSize = Math.min(8192, stat.size);
      const sample = Buffer.alloc(sampleSize);
      fs.readSync(fd, sample, 0, sampleSize, 0);
      if (looksBinary(sample)) throw new Error('FILE_NOT_TEXT');
    } finally {
      try {
        if (fd !== undefined) fs.closeSync(fd);
      } catch {}
    }
  }

  if (baseMtimeMs !== undefined && baseMtimeMs !== null) {
    const base = Number(baseMtimeMs);
    if (Number.isFinite(base)) {
      const current = Math.floor(stat.mtimeMs);
      if (current !== Math.floor(base)) throw new Error('FILE_CHANGED');
    }
  }

  fs.writeFileSync(absPath, String(content ?? ''), 'utf-8');
  const nextStat = fs.statSync(absPath);
  return {
    relPath,
    absPath,
    sizeBytes: nextStat.size,
    mtimeMs: Math.floor(nextStat.mtimeMs),
  };
}

module.exports = {
  normalizeRelPath,
  isHiddenRelPath,
  listDir,
  readTextFile,
  writeTextFile,
  resolveWorkspaceAbsPath,
  assertInsideWorkspace,
};
