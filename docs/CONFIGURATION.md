# Configuration

[English](CONFIGURATION.md) | [中文](CONFIGURATION.zh-CN.md)

`local-agent-cockpit` reads configuration from environment variables. It also supports loading `.env` and `.env.local` automatically on startup.

## Files

- `.env.example`: checked into git (safe placeholders)
- `.env.local`: recommended for local secrets (gitignored)

## Required

- `ADMIN_TOKEN`
  - Required for write APIs.
  - The server will generate a random token if not set, but that’s not recommended for long-running setups.

## Workspace safety

- `ALLOWED_WORKSPACE_ROOTS`
  - Semicolon/comma separated allowlist of directories where workspaces can live.
  - Example (Windows): `ALLOWED_WORKSPACE_ROOTS=C:\projects;D:\work`
  - Example (Linux/macOS): `ALLOWED_WORKSPACE_ROOTS=/home/me/projects,/mnt/work`

If not set, the default is the parent directory of the process working directory.

## Server

- `HOST` (default: `0.0.0.0`)
- `PORT` (default: `18787`)

## Data / artifacts

- `DB_PATH` (default: `data/app.sqlite`)
- `RUNS_DIR` (default: `runs/`)

## Safety switches

- `READ_ONLY_MODE=true`
  - Makes write endpoints reject requests even with `ADMIN_TOKEN`.

## Push notifications (optional)

See `.env.example` for the full matrix. Common ones:

- `PUSHPLUS_TOKEN`
- `PUSH_NOTIFICATIONS_ENABLED=true|false`
- `PUSH_NOTIFY_RUN_FINAL=true|false`
- `PUSH_NOTIFY_RUN_STEP=true|false`
- `PUSH_NOTIFY_ASK_REPLY=true|false`
