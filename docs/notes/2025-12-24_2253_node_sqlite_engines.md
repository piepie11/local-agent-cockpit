# 2025-12-24_2253 — Align Node engines with `node:sqlite`

## Summary

- Fix runtime requirement mismatch: code uses `node:sqlite` (Node 22+) but `package.json.engines` said Node 18+.
- Update docs to state the real runtime requirement and adjust `plan.md` wording (JS/CommonJS).

## Changes

- `package.json`: set `engines.node` to `>=22.0.0`
- `README.md`: add Node runtime requirement note (and `node:sqlite` experimental warning note)
- `plan.md`: change “Node.js / TypeScript” → “Node.js / JavaScript（CommonJS）”

## Commands

- `node -e "require('node:sqlite'); console.log(process.version)"`

## Results

- Command prints `v22.x` and successfully loads `node:sqlite` (experimental warning is expected).

## Risks / Notes

- `node:sqlite` is still marked experimental by Node; long-term stability may require switching to a stable SQLite dependency if needed.

## Questions

- None

