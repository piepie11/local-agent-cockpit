# local-agent-cockpit

[English](README.md) | [中文](README.zh-CN.md)

Mobile-friendly local Web control plane to orchestrate a **Manager <-> Executor** workflow on top of CLI agents (Codex CLI / Claude Code CLI).

## Features

- Dashboard: create sessions/runs; `Start` / `Step` / `Pause` / `Stop` / `Inject`
- Ask: per-workspace chat + queue; cross-device live sync via SSE (no polling)
- Files: browse workspace files; preview images; edit & save text/Markdown
- History: replay every turn; export `.md` / `.json` / `.jsonl`
- Notifications (optional): WeChat push via PushPlus

## Quick start

### Requirements

- Node.js `>= 22` (uses `node:sqlite`; the experimental warning is expected)

### Run

1) Install dependencies

`npm install`

2) Create `.env.local` (recommended)

- Copy from `.env.example` → `.env.local` (this file is gitignored)
- Set at least:
  - `ADMIN_TOKEN` (required for write APIs)
  - `ALLOWED_WORKSPACE_ROOTS` (restrict where a workspace can be registered)

Example (Windows):

`ALLOWED_WORKSPACE_ROOTS=C:\projects;D:\work`

3) Start server

- Dev: `npm run dev`
- One-click (auto port selection): `npm run up` (or `up.cmd` / `./up.sh`)

4) Open in browser

- Desktop: `http://127.0.0.1:18787/`
- Phone (LAN/VPN/Tailscale): `http://<your-ip>:18787/`

## Security (read this)

This project can read/write files and run commands on your machine.

- Always set `ADMIN_TOKEN` and keep it secret
- Restrict `ALLOWED_WORKSPACE_ROOTS`
- Do not expose directly to the public Internet (use LAN/VPN/ACL/HTTPS reverse proxy)

See [`SECURITY.md`](SECURITY.md) for the full threat model & deployment checklist.

## Documentation

- [`docs/README.md`](docs/README.md) (index)
- [`docs/README.zh-CN.md`](docs/README.zh-CN.md) (中文索引)
- [`docs/TUTORIAL.md`](docs/TUTORIAL.md) (step-by-step tutorial)
- [`docs/TUTORIAL.zh-CN.md`](docs/TUTORIAL.zh-CN.md) (中文上手教程)
- [`docs/PROJECT_REPORT.md`](docs/PROJECT_REPORT.md) (deep dive: architecture + file map)
- [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md) (env vars & config)
- [`docs/CONFIGURATION.zh-CN.md`](docs/CONFIGURATION.zh-CN.md) (中文配置说明)
- [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) (dev & tests)
- [`docs/DEVELOPMENT.zh-CN.md`](docs/DEVELOPMENT.zh-CN.md) (中文开发与测试)

## Example workspace

- [`examples/minimal-workspace/`](examples/minimal-workspace/) contains a tiny `plan.md` + `约定.md` you can register as a workspace for a quick demo.

## Tests

- `npm test` runs the core e2e suite (no Codex/Claude CLI required)
- Optional: `npm run m0:smoke` / `npm run m0:roundtrip` / `npm run m1:e2e:codex` / `npm run m1:e2e:claude` require local CLI installs and login

## License

MIT. See [`LICENSE`](LICENSE).
