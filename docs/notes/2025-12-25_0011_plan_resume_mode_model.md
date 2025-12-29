# 2025-12-25_0011 — Update `plan.md` for resume + mode/model + downgrade

## Summary

- Refresh `plan.md` to explicitly support two execution modes:
  - `stateless_exec` (structured audit)
  - `stateful_resume` (strong context, for large repos)
- Add per-role `mode` + `model` requirements and clarify capability detection + downgrade strategy.
- Update milestone plan: M3 focuses on resume/model; strict schema work moved to M4 (optional).

## Changes

- `plan.md`
  - Clarify dual-mode goal and tradeoffs
  - Add `mode/model/providerSessionId/capabilities` into the Session model, API/DB suggestions, Orchestrator strategy
  - Add M3 (resume + model) and M4 (strict schema optional)
- `plan_new.md`: keep as a reference draft (input to the above edit)

## Verification

- `node -e "fs.readFileSync('plan.md','utf8'); ..."` (ensures updated keywords exist and file is readable)

