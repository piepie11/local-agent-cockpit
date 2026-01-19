# M2.2 doc writer prompt injection

## Summary
- Added docKind-aware prompt injection in ask_service with doc writer prefix fields.
- Plan docKind now reads requirements content as context and errors clearly on missing/invalid paths.

## Verification
- npm test

## Results
- npm test: PASS

## Next
- Implement doc template loading for convention/plan in M2.3.
