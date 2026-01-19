# M3.3 doc writer chat + config

## Summary
- Added Docs chat controls (send/stop/status/elapsed/usage) and config form with provider/model/effort/sandbox.
- Reused Ask APIs and rendering helpers for messages, status, elapsed, and usage with doc-specific state.

## Verification
- npm test

## Results
- npm test: PASS

## Next
- Implement preview loading/refresh and doc output wiring in M3.4.
