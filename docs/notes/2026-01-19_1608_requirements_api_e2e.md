# M4.1 requirements API e2e

## Summary
- Extended m2_api_e2e to cover requirementsPath create/patch/read flows and PATH_OUTSIDE_WORKSPACE validation.
- Added requirements fixture files for e2e workspace setup.

## Verification
- npm test
- npm run m2:api:e2e

## Results
- npm test: PASS
- npm run m2:api:e2e: PASS (SQLite experimental warning only)

## Next
- Expand coverage for doc writer preview UX if needed.
