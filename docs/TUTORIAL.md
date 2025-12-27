# Tutorial (first-time setup)

[English](TUTORIAL.md) | [中文](TUTORIAL.zh-CN.md)

This doc is a practical walkthrough for getting `local-agent-cockpit` running on desktop + phone, safely.

## 0) Install

- Node.js `>= 22`

## 1) Start the server

1) Install dependencies:

`npm install`

2) Create `.env.local` (recommended; gitignored):

- Copy `.env.example` → `.env.local`
- Set at least:
  - `ADMIN_TOKEN` (required for write APIs / Ask / hidden files)
  - `ALLOWED_WORKSPACE_ROOTS` (restrict where workspaces can be registered)

Examples:

- Windows: `ALLOWED_WORKSPACE_ROOTS=C:\projects;D:\work`
- Linux/macOS: `ALLOWED_WORKSPACE_ROOTS=/home/me/projects,/mnt/work`

3) Run:

- Dev: `npm run dev`
- One-click launcher (auto port selection): `npm run up` (or `up.cmd` / `./up.sh`)

4) Open:

- Desktop: `http://127.0.0.1:18787/`
- Phone (LAN/VPN/Tailscale): `http://<your-ip>:18787/`

## 2) Security checklist (do this before real use)

- Do not expose the server directly to the public Internet.
- Always set `ADMIN_TOKEN` (don’t rely on auto-generated tokens).
- Keep `ALLOWED_WORKSPACE_ROOTS` minimal (do not use wide roots like `C:\`).

More details: `SECURITY.md`.

## 3) Register a workspace

Go to **Settings → Workspaces** and create one.

- `rootPath`: the project folder you want to orchestrate
- `planPath`:
  - empty → defaults to `<rootPath>/plan.md`
  - relative path → resolved relative to `rootPath` (e.g. `docs/plan.md`)
  - absolute path → used as-is
- `conventionPath`:
  - empty → defaults to `<rootPath>/约定.md`
  - relative/absolute rules are the same as `planPath`

Quick demo option:

- Register `examples/minimal-workspace/` as a workspace.

## 4) Run a Manager <-> Executor workflow (safe demo)

1) Go to **Dashboard**
2) Create sessions:
   - provider: `fake` (safe, deterministic)
   - sandbox: `read-only`
3) Create a run and click `Start` (or use `Step` mode).
4) Open **History** to replay the run.

Note: runtime artifacts will be written to `data/` (SQLite) and `runs/` (exports/logs). They are gitignored.

## 5) Use Ask (chat)

1) Open **Ask**
2) Create a thread and send messages
3) Optional: queue multiple commands and let it drain
4) Open the same workspace Ask page on another device to see live updates (SSE)

## 6) Use Files (browse / preview / edit)

- Without `ADMIN_TOKEN`:
  - browse non-hidden files only
  - read-only (no save)
- With `ADMIN_TOKEN`:
  - can browse hidden files (dotfiles)
  - can edit & save text/Markdown
  - can preview images

## 7) Optional: WeChat notifications (PushPlus)

If you want push notifications on run completion / step completion / Ask replies:

1) Put your PushPlus token into `.env.local`:
   - `PUSHPLUS_TOKEN=...`
2) Restart the server.

See `.env.example` and `docs/CONFIGURATION.md` for all options.
