# helm hosted server (proof of concept)

helm in a browser. One deployment, one user, one Anthropic login. The server runs the desktop app's main process (`src/main/core.ts`) as a plain Node process; the browser runs the desktop app's renderer (`src/renderer`) unchanged. Nothing here is copied from the app: both ends are imported from `../src`.

```
browser ── renderer (src/renderer) ── HelmBridge ──WebSocket──▶ server.ts ── api (src/main/core.ts) ── Agent SDK, git, GitHub
```

## Run in Docker (as if hosted)

The image carries its own Node, git and Claude Code binary (the one the Agent SDK ships for Linux, at the version helm is built against), runs as a normal user, and keeps everything under one volume.

```
cp .env.example .env        # at the repository root; fill it in (below)
docker compose up --build
```

Open `http://127.0.0.1:8787` and sign in with GitHub. The port is published on this computer only.

### The `.env` file

| Variable | Meaning |
| --- | --- |
| `HELM_HOSTED_ALLOWED_USER` | **Required.** The one GitHub username allowed in (not case sensitive). Anyone else is turned away, and the server will not start without it or with more than one name. That person can run commands inside the container. |
| `HELM_HOSTED_SECRET` | Signs the sign-in cookie. 32+ random characters (`openssl rand -hex 32`). If it is left out, everyone is signed out whenever the container restarts. |
| `ANTHROPIC_API_KEY` | How agents authenticate. See below. |
| `CLAUDE_CODE_OAUTH_TOKEN` | Optional alternative to the API key. See below. |
| `HELM_GIT_NAME`, `HELM_GIT_EMAIL` | Who agent commits are made as. |

Without `docker`: `HELM_HOSTED_ALLOWED_USER=you HELM_HOSTED_SECRET=... npm start` after `npm run build`, with Node 22 and git installed, and the same variables.

### Getting an Anthropic API key

1. Go to <https://console.anthropic.com/settings/keys> and sign in (the Anthropic Console, not claude.ai).
2. **Create Key**, name it (for example `helm-hosted`), and copy it straight away: it starts `sk-ant-` and is shown only once. An old key cannot be looked up, only replaced.
3. Paste it as `ANTHROPIC_API_KEY=` in `.env`, and make sure the Console account has credit (Settings, Billing). API use is billed per token there, separately from a Claude Pro or Max subscription.

### Using a Claude subscription instead

`claude setup-token` (run on a computer where you are logged in to Claude Code) prints a long-lived token that the binary accepts as `CLAUDE_CODE_OAUTH_TOKEN`. It draws on your subscription instead of API credit. Anthropic's terms do not allow third-party apps to broker subscription logins on other people's behalf (see D-069); for a server only you use, running Claude Code itself under your own login is a judgement for you to make, so API keys are the documented route here.

## Signing in

There is one login: helm's own GitHub sign-in screen, the same one the desktop app shows. On the hosted server it also checks who signed in. A page that has not signed in is shown that screen and nothing else (the server answers only the four calls the screen needs, and sends it a state with nobody signed in and none of the server's paths or settings). When the sign-in completes, helm asks whether that username is `HELM_HOSTED_ALLOWED_USER` before it keeps anything: if not, the person is told so, no token is stored, and whoever is already signed in is untouched. If so, the page is let in and given a signed, HttpOnly, same-site cookie, so reloading does not mean signing in again; a new visitor without the cookie has to sign in. The WebSocket is also refused for a page on another origin, so another site cannot use the cookie.

Signing in asks GitHub for repository access (helm needs it), and the token is kept on the server, in the data volume, unencrypted. There is no second login.

## What is shared, and where the seams are

- `HelmBridge` (`src/shared/types.ts`) is everything the renderer needs from its environment. Electron's preload and `web/bridge.ts` both implement it.
- `Host` (`src/main/host.ts`) is everything `core.ts` needs from where it runs. `src/main/index.ts` implements it with Electron, `src/host.ts` here with Node.
- The renderer's title bar asks the bridge where window buttons are (`windowControls`), so a browser tab leaves no room for them.
- Anything that acts on the user's own computer (choose a folder, open a link, copy) is done by the browser in `web/bridge.ts`; the server refuses those names.

## Not safe yet

- The allowed user has a shell. The agent can run any command as the server's user, and the terminal tab is a shell on the server.
- The GitHub token is stored unencrypted in `HELM_DATA_DIR` (mode 0700); there is no keychain on a server.
- No sandbox, no egress control, no resource limits. The VM or container this runs in is the boundary.
- A dropped connection can miss transcript events; the UI refetches `state` on reconnect but not open transcripts.
- Desktop notifications, badges and "open in VS Code" do nothing.
