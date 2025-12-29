const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const { loadProjectEnv } = require('../src/lib/env_file');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true;
    args[key] = value;
    if (value !== true) i += 1;
  }
  return args;
}

function normalizeString(value) {
  const s = String(value ?? '').trim();
  return s ? s : null;
}

function normalizeInt(value) {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) ? n : null;
}

function usage() {
  const lines = [
    'auto_codex one-click launcher',
    '',
    'Usage:',
    '  node scripts/up.js [--host 0.0.0.0] [--port 18787] [--allowed-roots "C:\\\\projects;D:\\\\repo"] [--no-token-file]',
    '',
    'Notes:',
    '- If ADMIN_TOKEN is not set, this script will (by default) create/read `data/admin_token.txt` and set ADMIN_TOKEN.',
    '- If the port is in use, it will try the next ports.',
  ];
  // eslint-disable-next-line no-console
  console.log(lines.join('\n'));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readTokenFromFile(tokenPath) {
  try {
    if (!fs.existsSync(tokenPath)) return null;
    const value = fs.readFileSync(tokenPath, 'utf-8').trim();
    return value || null;
  } catch {
    return null;
  }
}

function writeTokenToFile(tokenPath, token) {
  try {
    ensureDir(path.dirname(tokenPath));
    fs.writeFileSync(tokenPath, `${token}\n`, 'utf-8');
    return true;
  } catch {
    return false;
  }
}

function generateToken() {
  return crypto.randomBytes(24).toString('hex');
}

function isPortFree(port, host) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

async function pickPort(basePort, host, tries) {
  if (basePort === 0) return 0;
  for (let i = 0; i < tries; i += 1) {
    const port = basePort + i;
    // eslint-disable-next-line no-await-in-loop
    const ok = await isPortFree(port, host);
    if (ok) return port;
  }
  throw new Error(`No free port found starting at ${basePort}`);
}

async function main() {
  loadProjectEnv({ projectRoot: path.resolve(__dirname, '..') });

  const args = parseArgs(process.argv);
  if (args.help) {
    usage();
    process.exit(0);
  }

  const projectRoot = path.resolve(__dirname, '..');

  const host = normalizeString(args.host) || process.env.HOST || '0.0.0.0';

  const envPort = process.env.PORT ? normalizeInt(process.env.PORT) : null;
  const requestedPort = normalizeInt(args.port) ?? envPort ?? 18787;
  const port = await pickPort(requestedPort, host, 20);

  const allowedRoots =
    normalizeString(args['allowed-roots']) ||
    process.env.ALLOWED_WORKSPACE_ROOTS ||
    path.resolve(projectRoot, '..');

  const noTokenFile = Boolean(args['no-token-file']);
  const tokenFilePath = path.join(projectRoot, 'data', 'admin_token.txt');

  let adminToken = process.env.ADMIN_TOKEN || null;
  if (!adminToken && !noTokenFile) {
    adminToken = readTokenFromFile(tokenFilePath);
    if (!adminToken) {
      adminToken = generateToken();
      writeTokenToFile(tokenFilePath, adminToken);
    }
  }

  // eslint-disable-next-line no-console
  console.log(`[up] HOST=${host}`);
  // eslint-disable-next-line no-console
  console.log(`[up] PORT=${port}`);
  // eslint-disable-next-line no-console
  console.log(`[up] ALLOWED_WORKSPACE_ROOTS=${allowedRoots}`);
  if (adminToken) {
    // eslint-disable-next-line no-console
    console.log(`[up] ADMIN_TOKEN=*** (loaded${noTokenFile ? '' : ' or saved'} at data/admin_token.txt)`);
  } else {
    // eslint-disable-next-line no-console
    console.log(`[up] ADMIN_TOKEN not set (server will generate a temporary token)`);
  }

  const child = spawn(process.execPath, [path.join(projectRoot, 'src', 'server.js')], {
    cwd: projectRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      HOST: host,
      PORT: String(port),
      ALLOWED_WORKSPACE_ROOTS: allowedRoots,
      ...(adminToken ? { ADMIN_TOKEN: adminToken } : {}),
    },
  });

  child.on('close', (code) => process.exit(code ?? 0));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(`[up] ERROR: ${err.message}`);
  process.exit(1);
});
