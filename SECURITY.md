# Security policy

`local-agent-cockpit` is a local Web control plane that can read/write files and run commands on the host machine.
That makes it powerful — and security-sensitive.

## Threat model (high-level)

- Anyone who can access the web UI + knows `ADMIN_TOKEN` can trigger write operations (create/edit files, start runs, etc.).
- If the server is exposed to the public Internet, an attacker can brute-force or steal the token and gain control of your machine.
- Workspaces are restricted by `ALLOWED_WORKSPACE_ROOTS`, but a misconfigured allowlist can still expose sensitive directories.

## Recommended deployment

- Run on a trusted network only: localhost, LAN, VPN (Tailscale/WireGuard), or a reverse proxy with strong ACL.
- Always set `ADMIN_TOKEN` (do not rely on the auto-generated token).
- Set `ALLOWED_WORKSPACE_ROOTS` to a minimal allowlist (do not use wide roots like `C:\`).
- If you need remote access, prefer VPN + device ACL, then optionally add HTTPS.

## What not to do

- Do not expose `0.0.0.0:18787` directly to the public Internet.
- Do not commit `.env` / `.env.local` / `data/` / `runs/` to git.

## Reporting vulnerabilities

If you find a security issue, please report it without leaking secrets.
If you don’t have a private channel, open a minimal public issue describing the impact without exploit details.
