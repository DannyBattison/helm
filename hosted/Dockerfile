# helm hosted server, in a container. Build from the repository root:
#   docker build -f hosted/Dockerfile -t helm-hosted .
# Run it with hosted/docker-compose.yml (see hosted/README.md).
#
# The image carries everything it needs and nothing from the machine it runs on: Node, git, its own Claude Code binary (the one the
# Agent SDK ships for Linux, at the version helm is built against) and the built web client.

# ---- build: dependencies and the web client
FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm_config_audit=false npm_config_fund=false
# Only used if a native module has no prebuilt binary for this platform.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY hosted/package.json hosted/package-lock.json hosted/
RUN cd hosted && npm ci
COPY tsconfig.json tsconfig.node.json tsconfig.web.json ./
# The root tsconfig points at this one; nothing else of desktop/ is needed here.
COPY desktop/tsconfig.json desktop/
COPY src src
COPY hosted hosted
RUN cd hosted && npm run build

# ---- run
FROM node:22-bookworm-slim
# git: agents work in worktrees. ripgrep: Claude Code's search tools. tini: reaps the shells and agents the server starts.
RUN apt-get update && apt-get install -y --no-install-recommends git openssh-client ca-certificates curl procps ripgrep tini \
    && rm -rf /var/lib/apt/lists/*
# gh: the GitHub CLI, for agents and the terminal (`gh pr create`, `gh api`). helm writes its sign-in to gh's config, and the entrypoint makes
# `gh auth git-credential` git's credential helper for github.com, so `git fetch` on a private repository works too.
RUN mkdir -p -m 755 /etc/apt/keyrings \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update && apt-get install -y --no-install-recommends gh \
    && rm -rf /var/lib/apt/lists/* && gh --version
WORKDIR /app
COPY --from=build /app /app

# The Claude Code binary that ships inside the Agent SDK, for this machine's architecture and C library (the musl builds, for Alpine, are
# installed beside it and are no use here). The server uses it for agents on its own; it is also put on the PATH so the terminal tab can run
# `claude` (to try things, or to log in) with exactly the version helm uses.
RUN case "$(dpkg --print-architecture)" in amd64) A=x64 ;; arm64) A=arm64 ;; *) echo "unsupported architecture" >&2; exit 1 ;; esac     && rm -rf /app/node_modules/@anthropic-ai/claude-agent-sdk-linux-*-musl     && CLAUDE="/app/node_modules/@anthropic-ai/claude-agent-sdk-linux-$A/claude"     && test -x "$CLAUDE" && ln -s "$CLAUDE" /usr/local/bin/claude && claude --version

# A normal user, not root: the agent runs commands as whoever the server is. Everything it keeps (state, GitHub token, clones,
# worktrees, Claude Code's login) lives under /home/helm, which is the one volume.
RUN useradd --create-home --uid 1001 --shell /bin/bash helm
# Built on Windows the script can arrive with CRLF line endings and no exec bit; fix both.
COPY hosted/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN sed -i 's/\x0d$//' /usr/local/bin/docker-entrypoint.sh && chmod 755 /usr/local/bin/docker-entrypoint.sh
USER helm
ENV HOME=/home/helm \
    HELM_DATA_DIR=/home/helm/.helm-hosted \
    HOST=0.0.0.0 \
    PORT=8787 \
    NODE_ENV=production
VOLUME /home/helm
WORKDIR /app/hosted
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s CMD curl -fs http://127.0.0.1:8787/ >/dev/null || exit 1
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["npx", "tsx", "src/server.ts"]
