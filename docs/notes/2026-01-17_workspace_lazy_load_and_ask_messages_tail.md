# Workspace Lazy-Load + Ask Messages Tail

## Background

Some workspaces can accumulate a lot of history (runs) and especially Ask conversations (threads/messages). The previous UI behavior refreshed multiple datasets on every workspace switch, which could make switching slow or feel "stuck" on big workspaces.

## Changes

### 1) Workspace switch: load only what's needed for the current page

- Frontend now loads workspace data *by page* (Dashboard / History / Sessions / Ask / Files).
- This avoids expensive full refreshes when the user is currently on a lightweight page.

Implementation:
- `web/app.js`: `ensureWorkspaceDataForCurrentPage()` + `onWorkspaceChanged()` wrapper

### 2) Ask messages: default to "tail" (latest N) instead of loading a huge history

- Backend API supports `tail=1` for messages listing:
  - `GET /api/ask/threads/:id/messages?tail=1&limit=N`
  - Returns the latest `N` messages (still ordered ASC in the response for UI rendering).
- UI defaults to loading only the most recent 200 messages.
- UI provides controls to fetch more history:
  - "Load more": doubles the window size up to a max
  - "Load all": loads up to the configured max window

Implementation:
- `src/storage/store.js`: `listAskMessagesTail(threadId, limit)`
- `src/server.js`: `/api/ask/threads/:id/messages` supports `tail`
- `web/app.js`: Ask message loading uses `tail=1` with a default limit (`ASK_MESSAGES_DEFAULT_TAIL_LIMIT`)
- `web/index.html`: adds "Load more / Load all" controls above the messages panel

## Defaults

- `ASK_MESSAGES_DEFAULT_TAIL_LIMIT = 200`
- `ASK_MESSAGES_MAX_LIMIT = 5000`

## Tests

- `npm test`
- `npm run m2:api:e2e`
- `npm run m4:ask:e2e`
- `npm run m7:ask:sse:e2e`
- `npm run m8:workspace:mru:e2e`

