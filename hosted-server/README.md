# helm hosted server (proof of concept)

helm in a browser. One deployment, one user, one Anthropic login. The server runs the desktop app's main process (`src/main/core.ts`) as a plain Node process; the browser runs the desktop app's renderer (`src/renderer`) unchanged. Nothing here is copied from the app: both ends are imported from `../src`.

```
browser ── renderer (src/renderer) ── HelmBridge ──WebSocket──▶ server.ts ── api (src/main/core.ts) ── Agent SDK, git, GitHub
```

## Run

```
npm install                 # in the repo root, then here
cd hosted-server && npm install
npm run build               # the web client into dist/web
HELM_HOSTED_TOKEN=$(openssl rand -hex 24) npm start
```

Open `http://127.0.0.1:8787` and enter the token. Anthropic access is whatever the server's user has: `ANTHROPIC_API_KEY` in the environment, or a Claude Code login (`claude login`) on that machine. Requires Node 22+ and git.

| Variable | Meaning |
| --- | --- |
| `HELM_HOSTED_TOKEN` | Required, 16+ characters. Anyone with it can run commands as the server's user. |
| `PORT`, `HOST` | Default `8787` on `127.0.0.1`. Put a TLS reverse proxy in front before exposing it. |
| `HELM_DATA_DIR` | State, transcripts and the GitHub token. Default `~/.helm-hosted`. |
| `HELM_HOSTED_ORIGINS` | Extra page origins allowed to open the WebSocket, comma separated, for when a proxy changes the `Host`. |

## What is shared, and where the seams are

- `HelmBridge` (`src/shared/types.ts`) is everything the renderer needs from its environment. Electron's preload and `web/bridge.ts` both implement it.
- `Host` (`src/main/host.ts`) is everything `core.ts` needs from where it runs. `src/main/index.ts` implements it with Electron, `src/host.ts` here with Node.
- The renderer's title bar asks the bridge where window buttons are (`windowControls`), so a browser tab leaves no room for them.
- Anything that acts on the user's own computer (choose a folder, open a link, copy) is done by the browser in `web/bridge.ts`; the server refuses those names.

## Not safe yet

- One shared token, no accounts. The agent can run any command as the server's user, and the terminal tab is a shell on the server. Treat the token like an SSH key.
- The GitHub token is stored unencrypted in `HELM_DATA_DIR` (mode 0700); there is no keychain on a server.
- No sandbox, no egress control, no resource limits. The VM or container this runs in is the boundary.
- A dropped connection can miss transcript events; the UI refetches `state` on reconnect but not open transcripts.
- Desktop notifications, badges and "open in VS Code" do nothing.
