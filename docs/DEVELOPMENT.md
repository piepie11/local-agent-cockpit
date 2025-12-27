# Development

[English](DEVELOPMENT.md) | [中文](DEVELOPMENT.zh-CN.md)

## Run locally

`npm run dev`

The server serves the static web UI from `web/` and exposes JSON APIs + SSE endpoints.

## Project layout (high level)

- `src/`: backend (Express API, orchestrator, providers, storage, Ask, notifications)
- `web/`: frontend (no build step; plain HTML/CSS/JS)
- `scripts/`: regression/e2e scripts
- `prompts/`: system prompts for manager/executor roles

For a detailed file-by-file guide, see `docs/PROJECT_REPORT.md`.

## Tests

- `npm test`: core e2e suite (does not require Codex/Claude CLI)
- `npm run m2:api:e2e`: API regression (fake provider)
- `npm run m4:ask:e2e`: Ask regression
- `npm run m5:files:e2e`: Files regression
- `npm run m6:notify:e2e`: notifications regression (local mock PushPlus)
- `npm run m7:ask:sse:e2e`: Ask SSE regression

## Coding notes

- This repo intentionally avoids heavyweight frontend tooling to keep “edit and run” simple.
- Prefer small, well-tested changes: update one module, run the closest e2e script, then widen coverage.
