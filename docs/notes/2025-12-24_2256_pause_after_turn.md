# 2025-12-24_2256 — Pause semantics: pause after current turn

## Summary

- Align `Pause` behavior with `plan.md`: **Pause should take effect after the current turn ends**, not abort mid-turn.
- Add an API e2e assertion to prevent regressions.

## Changes

- `src/orchestrator/orchestrator.js`
  - `pause()` now sets `pauseRequested` while RUNNING (no abort).
  - Run loop checks `pauseRequested` before starting the next turn and transitions to `PAUSED`.
- `scripts/m2_api_e2e.js`
  - Add a test that issues `/pause` during a running turn and asserts:
    - run ends in `PAUSED`
    - `turnIndex === 1`
    - the single turn has `endedAt` and `executorOutput` (not aborted mid-turn)

## Commands

- `npm run m2:api:e2e`

## Results

- PASS (`m2_api_e2e`).

## Notes

- `Stop` remains the “abort immediately” control; `Pause` is now “pause on turn boundary”.

