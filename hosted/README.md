# helm hosted

helm in a browser. One server, one user, one Anthropic login. The server runs the desktop app's core (`src/core/core.ts`) as a plain Node process, and the browser runs the desktop app's renderer (`src/renderer`) unchanged.

```
browser ── renderer ── HelmBridge ──WebSocket──▶ server.ts ── core.ts ── Agent SDK, git, GitHub
```

This is a proof of concept. Read [Not safe yet](#not-safe-yet) before putting it anywhere public.

## Quick start

```
docker run -d --name helm --restart unless-stopped \
  -p 127.0.0.1:8787:8787 \
  -v helm-home:/home/helm \
  -e HELM_HOSTED_ALLOWED_USER=your-github-username \
  -e HELM_HOSTED_SECRET=$(openssl rand -hex 32) \
  ghcr.io/dannybattison/helm-hosted:latest
```

Open <http://127.0.0.1:8787>, sign in with GitHub, then sign in to Claude when asked. Everything (state, clones, worktrees, the GitHub token, Claude's login) lives in the `helm-home` volume, so it survives restarts and upgrades.

If the image is private, make the package public in its GitHub settings, or `docker login ghcr.io` with a token that has `read:packages`.

To build it yourself instead: `cd hosted && cp .env.example .env && docker compose up --build`.

### What is in the image

Always: Node and npm, bash and coreutils, git, gh, ssh, curl, ripgrep, tini as PID 1, a non-root user, `LANG=C.UTF-8` and `PYTHONUNBUFFERED=1`. The rest is picked by categories, with the `INCLUDE` build argument (separated by `|`, any case, or `ALL`):

| Category | Adds |
| --- | --- |
| `CORE` | Python 3, pip, venv and `/opt/venv` with requests, httpx, pandas, numpy, beautifulsoup4, lxml, pyyaml, pydantic, matplotlib; zip, unzip, less, tree, file |
| `SEARCH` | fd, jq, yq |
| `NETWORK` | wget, dig, ping |
| `EDITING` | vim, nano, patch, diffutils, build-essential, sqlite3 |
| `DOCUMENTS` | poppler-utils, LibreOffice (headless), pandoc |
| `MEDIA` | ffmpeg, ImageMagick, Tesseract |
| `BROWSING` | Playwright and Chromium (turns on `CORE`) |

The default is `CORE|SEARCH|NETWORK|EDITING|BROWSING` (`:latest`), which is already large because of Chromium. `:latest-full` is `ALL`, which adds LibreOffice, pandoc, ffmpeg, ImageMagick and Tesseract. To leave the browser out, use `INCLUDE=CORE|SEARCH|NETWORK|EDITING`. To choose your own: `docker build -f hosted/Dockerfile --build-arg 'INCLUDE=CORE|SEARCH|DOCUMENTS|BROWSING' -t helm-hosted .`

## Configuring

Put settings in an env file (`docker run --env-file helm.env …`, or `.env` for compose) rather than `-e` flags. That keeps the secret stable when you recreate the container.

| Variable | Meaning |
| --- | --- |
| `HELM_HOSTED_ALLOWED_USER` | **Required.** The one GitHub username let in. Anyone else is turned away. That person can run commands in the container. |
| `HELM_HOSTED_SECRET` | Signs the sign-in cookie. 32+ random characters. If unset, everyone is signed out on every restart. |
| `ANTHROPIC_API_KEY` | Optional. Agents use this API key instead of a Claude login (billed per token). |
| `CLAUDE_CODE_OAUTH_TOKEN` | Optional. A long-lived subscription token from `claude setup-token`, instead of the in-app login. |
| `HELM_GIT_NAME`, `HELM_GIT_EMAIL` | Who agent commits are made as. |

Without Docker: build, then `HELM_HOSTED_ALLOWED_USER=you HELM_HOSTED_SECRET=… npm start`, with Node 22 and git installed.

### Putting it on a server

The port is bound to `127.0.0.1` on purpose. To reach it from elsewhere, keep that binding and put a TLS-terminating reverse proxy on the same machine (Caddy, nginx, Traefik), forwarding to `127.0.0.1:8787`. Websockets must be passed through, and the proxy must send the original `Host` header, since the server refuses cross-origin sockets. Caddy does all of this in two lines:

```
helm.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

### Signing in to Claude

If no key or token is set, the first visit shows **Sign in to Claude to start**: press the button, approve in the tab that opens, paste the code Claude shows, and press **Continue**. The server runs `claude auth login` for you; helm only passes the one-time code along. The login is kept in the volume. Settings → Claude Code shows who is signed in and has a sign out.

This uses your subscription. Anthropic's terms limit sharing a subscription login, so use your own account on a server only you use.

### Signing in with GitHub

This is the only login to helm itself. After GitHub says who you are, the server checks it is `HELM_HOSTED_ALLOWED_USER` before storing anything, then sets a signed, HttpOnly cookie so reloads don't ask again. Until then a page sees the sign-in screen and nothing else. Sockets from other origins are refused.

## Updating

The image is published to `ghcr.io/dannybattison/helm-hosted`: `latest` follows main, and each `v*` tag gets its own version. To update by hand, pull and recreate the container; the volume keeps your data.

To do it automatically, save this as `~/helm-update.sh` and `chmod +x` it. It pulls, compares the running container's image with the newest one, and recreates the container only if they differ:

```bash
#!/usr/bin/env bash
set -euo pipefail

IMAGE=ghcr.io/dannybattison/helm-hosted:latest
NAME=helm
ENV_FILE=$HOME/helm.env

running=$(docker inspect -f '{{.Image}}' "$NAME" 2>/dev/null || true)
docker pull -q "$IMAGE" >/dev/null
latest=$(docker image inspect -f '{{.Id}}' "$IMAGE")

[ "$running" = "$latest" ] && exit 0

echo "$(date -Is) updating $NAME to $latest"
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" --restart unless-stopped \
  -p 127.0.0.1:8787:8787 \
  -v helm-home:/home/helm \
  --env-file "$ENV_FILE" \
  "$IMAGE" >/dev/null
docker image prune -f >/dev/null
```

Then run it nightly from cron (`crontab -e`):

```
30 3 * * * $HOME/helm-update.sh >> $HOME/helm-update.log 2>&1
```

Things to know:

- Recreating restarts the container, which ends any running agents and terminals. Pick an hour you aren't working; the nightly run does nothing when there is no new image.
- With `HELM_HOSTED_SECRET` in the env file, you stay signed in across updates.
- To pin a version instead of following main, set `IMAGE` to a tag such as `…/helm-hosted:v1.2.3` and change it when you want to upgrade.
- Using compose instead? Replace the body with `docker compose pull && docker compose up -d` (it only recreates when the image changed).

## How it fits together

- `HelmBridge` (`src/shared/types.ts`) is everything the renderer needs from its environment. Electron's preload and `web/bridge.ts` both implement it.
- `Host` (`src/core/host.ts`) is everything `core.ts` needs from where it runs: Electron in `desktop/main/index.ts`, Node in `hosted/src/host.ts`.
- Things that act on your own computer (choose a folder, open a link, copy) are done by the browser in `web/bridge.ts`; the server refuses them.

## Notifications

The server sends each notification to connected browsers, which show it when the tab is not focused. No server config is needed, but the browser must allow it: click anywhere in helm once and accept the permission prompt. Browsers only offer notifications on HTTPS (or `localhost`), so serve helm over TLS. There are no Approve/Deny buttons and no badge in the browser.

## Not safe yet

- The allowed user has a shell. Agents run any command as the server's user, and the terminal tab is a shell on the server.
- The GitHub token is stored unencrypted in the data volume (mode 0700). There is no keychain.
- No sandbox, egress control or resource limits. The VM or container is the boundary.
- A dropped connection can miss transcript events; the UI refetches state on reconnect, but not open transcripts.
- Badges and "open in VS Code" do nothing.
