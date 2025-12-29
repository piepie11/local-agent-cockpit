# 2025-12-24_2224 — One-click launcher + default port 18787

## Summary

- Add a one-click launcher (`npm run up` / `scripts\up.cmd` / `.\scripts\up.ps1`)
- Bump default server port to `18787` to reduce conflicts
- Update docs and run full regression suite

## Changes

- `src/config.js`: default `PORT` fallback `8787` → `18787`
- `scripts/up.js`: launcher (port probing + token file + allowed roots passthrough)
- `scripts/up.cmd`: Windows CMD wrapper
- `scripts/up.ps1`: Windows PowerShell wrapper
- `package.json`: add `npm run up`
- `README.md`: document launcher + update default port

## Commands

- `node scripts/up.js --help`
- `npm run m2:deep`

## Results

- `node scripts/up.js --help` → exit `0`
- `npm run m2:deep` → PASS
  - smoke: `runs/smoke-20251224_222124/`
  - roundtrip: `runs/roundtrip-20251224_222133/`
  - e2e fake: `runs/e2e-fake-20251224_222226/`
  - e2e codex: `runs/e2e-codex-20251224_222235/`
  - e2e claude: `runs/e2e-claude-20251224_222327/`
  - api e2e: `runs/api-e2e-20251224_222415/` (baseUrl printed by test)

## Risks / Notes

- On Windows, `codex` resolution still requires `shell:true` fallback in some cases; launcher uses Node directly and is unaffected.
- Launcher stores a persistent token in `data/admin_token.txt` by default (ignored by git); use `--no-token-file` to disable.

## Questions

- None

