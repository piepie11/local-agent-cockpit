# Contributing

Thanks for contributing to `local-agent-cockpit`!

## Before you start

- This project is security-sensitive. Please do not submit changes that weaken auth/allowlist/guards.
- Never commit secrets: `.env*`, tokens, private keys, or runtime artifacts under `data/` / `runs/`.

## Development setup

1) Install Node.js `>= 22`
2) `npm install`
3) Run server: `npm run dev`

More details: `docs/DEVELOPMENT.md`

## Testing

- Run core regression suite: `npm test`
- CI should pass on a clean checkout without requiring Codex/Claude CLI.

## Pull request checklist

- [ ] No secrets in diff
- [ ] `npm test` passes
- [ ] Documentation updated if behavior changes
- [ ] Security considerations documented if relevant
