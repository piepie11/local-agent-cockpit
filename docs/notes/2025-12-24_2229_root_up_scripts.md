# 2025-12-24_2229 — Root-level one-click launchers (Win + Linux/macOS)

## Summary

- Add root-level launchers for convenience:
  - Windows CMD: `up.cmd`
  - Windows PowerShell: `up.ps1`
  - Linux/macOS: `up.sh`
- Keep `scripts/up.js` as the single implementation.

## Changes

- `up.cmd`: calls `node scripts/up.js`
- `up.ps1`: calls `node scripts/up.js`
- `up.sh`: calls `node scripts/up.js`
- `README.md`: update launcher paths

## Commands

- `node scripts/up.js --help`
- `cmd /c "up.cmd --help"`
- `powershell -ExecutionPolicy Bypass -File .\up.ps1 --help`

## Results

- All three commands exit `0` and print the launcher usage.

## Questions

- None

