# Hosted version

Run helm on a server and use it from any browser, including your phone.

> **In short**
> - One Docker command starts it. One GitHub user is allowed in.
> - You sign in to GitHub, then to Claude (and/or Codex).
> - Put TLS (https) in front of it before exposing it beyond your own machine.

## Before you start

You need Docker on the machine that will run helm, and your GitHub username.

## Start it

```
docker run -d --name helm -p 127.0.0.1:8787:8787 \
  -v helm-home:/home/helm \
  -e HELM_HOSTED_ALLOWED_USER=your-github-username \
  -e HELM_HOSTED_SECRET=$(openssl rand -hex 32) \
  ghcr.io/dannybattison/helm-hosted:latest
```

Open <http://127.0.0.1:8787>, sign in with GitHub, then sign in to Claude when asked.

## Settings (environment variables)

| Variable | Meaning |
| --- | --- |
| `HELM_HOSTED_ALLOWED_USER` | **Required.** The one GitHub user allowed in. That person can run commands in the container. |
| `HELM_HOSTED_SECRET` | Signs the login cookie. Keep it fixed or you are signed out on every restart. |
| `ANTHROPIC_API_KEY` | Optional. Use an API key instead of signing in to Claude (billed per token). |
| `OPENAI_API_KEY` | Optional. Same, for Codex. |
| `CLAUDE_CODE_OAUTH_TOKEN` | Optional. A subscription token from `claude setup-token`. |
| `HELM_GIT_NAME`, `HELM_GIT_EMAIL` | Who agent commits are made as. |

Keep them in an env file (`--env-file`) so the secret stays the same when you recreate the container.

All state (clones, logins, sessions) lives in the `helm-home` volume, so it survives restarts and updates.

## Reaching it from elsewhere

The port is bound to `127.0.0.1` on purpose. To use it from other devices, put a reverse proxy that does TLS (Caddy, nginx, Traefik) on the same machine and forward to `127.0.0.1:8787`. It must pass websockets and the original `Host` header. With Caddy:

```
helm.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

## Signing in to an agent

If you have not set a key or token, the first visit offers **Claude** or **ChatGPT (Codex)**. Follow the prompts. One is enough to start; manage them under **Settings, then Accounts**. Use your own account on a server only you use, because Anthropic's terms limit sharing a subscription login.

## Updating

Pull the newest image and recreate the container. The volume keeps your data. `latest` is the newest release; each release also has its own version tag.

## What is different from the desktop app

- Notifications come from the browser (allow them once; HTTPS needed). There are no approve/deny buttons or badge.
- Things that act on the computer, such as "open in editor" or "show in file manager", do nothing.
- The terminal is a shell on the server.
- The **Phone app** and **Companion** settings are desktop-only. A hosted server is something a phone connects to: see [Phone app](Phone-App.md).
- The server also offers an installable web app at `/mobile/` with push notifications.

## Not safe yet

This is early software. Read these before exposing it:
- The allowed user has a shell. Agents run commands as the server's user.
- The GitHub token is stored unencrypted in the data volume.
- There is no sandbox or resource limit beyond the container.
- A dropped connection can miss some live events; reloading catches up.

## See also

- [Phone app](Phone-App.md)
- [Syncing machines](Syncing-Machines.md)
- [Safety and limits](Safety-and-Limits.md)
