# 2025-12-24_2303 — Run/script env recording (`run_env.json`)

## Summary

- Implement `约定.md` 7.4: each **Run** and key scripts record `cwd`, `node -v`, `codex --version` to disk.

## Changes

- `src/lib/run_env.js`: collect + write `run_env.json` (best-effort `codex --version`, Windows fallback to `codex.cmd` / `shell:true`)
- `src/orchestrator/orchestrator.js`: write `runs/<workspaceId>/<runId>/run_env.json` on run start (non-fatal on errors)
- Key scripts write `run_env.json` into their own output directories:
  - `scripts/codex_smoke.js`
  - `scripts/m0_roundtrip.js`
  - `scripts/m1_e2e_fake.js`
  - `scripts/m1_e2e_codex_readonly.js`
  - `scripts/m1_e2e_claude_readonly.js`
  - `scripts/m2_api_e2e.js` (also asserts per-run `run_env.json` exists)

## Commands

- `npm run m2:api:e2e`

## Results

- PASS (`m2_api_e2e`), and the test now asserts per-run `run_env.json` exists under `RUNS_DIR`.

## Notes

- `node -v` is recorded as `process.version` (same value).
- If Codex CLI is not installed, the file still records the error details (run does not fail).

