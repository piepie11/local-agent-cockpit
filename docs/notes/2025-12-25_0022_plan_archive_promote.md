# 2025-12-25_0022 — Archive legacy `plan.md`, promote `plan_new.md` to `plan.md`

## Summary

- Archive the previous `plan.md` to avoid confusion.
- Promote `plan_new.md` to become the canonical `plan.md`.
- Adjust `约定.md` / `思路.md` wording to match the new plan structure.

## Changes

- `docs/archive/plans/plan_legacy_2025-12-25_0019.md`: archived legacy plan (was the previous root `plan.md`)
- `plan.md`: now uses the new resume/mode/model upgrade plan (from `plan_new.md`)
- `plan_new.md`: removed (promoted to `plan.md`)
- `约定.md`: update progress/milestone wording to align with the new plan
- `思路.md`: mark as historical draft and point to `plan.md`

## Commands

- `node -e "const fs=require('fs'); ['plan.md','约定.md','思路.md','docs/archive/plans/plan_legacy_2025-12-25_0019.md'].forEach(p=>fs.readFileSync(p,'utf8')); console.log('ok')"`
- `rg -n \"plan_new\\.md\" -S`

## Results

- All files read successfully (UTF-8) and `rg` shows no functional references to `plan_new.md` (only historical notes).

