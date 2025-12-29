# 2025-12-24_2308 — Full regression after alignment fixes

## Summary

- Run full regression suite after fixing remaining plan/implementation inconsistencies:
  - Node engines alignment (`node:sqlite`)
  - Pause semantics (pause on turn boundary)
  - Run/script env recording (`run_env.json`)

## Commands

- `npm run m2:deep`

## Results

- PASS
  - smoke: `runs/smoke-20251224_230450/`
  - roundtrip: `runs/roundtrip-20251224_230500/`
  - e2e fake: `runs/e2e-fake-20251224_230538/`
  - e2e codex: `runs/e2e-codex-20251224_230540/`
  - e2e claude: `runs/e2e-claude-20251224_230631/`
  - api e2e: `runs/api-e2e-20251224_230801/`

## Notes

- Node prints `node:sqlite` experimental warnings in e2e scripts; expected.

