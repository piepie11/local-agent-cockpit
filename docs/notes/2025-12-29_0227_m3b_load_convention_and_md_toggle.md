# M3b: Load convention + Markdown toggle (doc modal)

## What changed
- Added a shared workspace doc loader for plan/convention and wired the doc modal flow.
- Added a dashboard Load convention button next to Load plan.
- Added doc modal Markdown toggle (default on) and modal error handling for missing workspace/conventionPath.
- Updated missing-convention error to include `kind=convention` for clearer context.

## Manual verification
- Headless Chrome + CDP (PowerShell + inline Node script):
  - Command: `$env:CHROME_PATH = (Get-Command chrome.exe).Source; @'...script...'@ | node -`
  - Result summary: `{"scenarioA":{"planLoaded":true,"conventionLoaded":true,"modalVisible":true},"scenarioB":{"toggleDefaultOn":true,"toggleOffHasContent":true,"toggleOffModalOpen":true,"toggleOffWorkspaceSame":true,"toggleOffIsPlain":true,"toggleOnIsMd":true},"scenarioC":{"errorVisible":true,"errorHasWorkspace":true,"errorHasKind":true,"errorHasConvention":true},"scenarioD":{"errorVisible":true,"errorHasStatus":true,"errorHasCode":true,"errorHasWorkspace":true,"errorHasPath":true}}`
  - Covered scenarios:
    - A: Load plan / Load convention both open modal and load content.
    - B: Markdown toggle defaults on; toggling preserves content, modal stays open, workspace selection unchanged.
    - C: Missing conventionPath shows error with workspaceId/kind/convention context.
    - D: Missing plan file shows HTTP 500 + PLAN_READ_FAILED + path/workspaceId in modal error.

## Automated verification
- npm test
- npm run m2:api:e2e

## Results
- npm test: pass
- npm run m2:api:e2e: pass (SQLite experimental warning)
- Headless UI verification: pass (see JSON summary above)

## Next step
- Wait for next instruction.
