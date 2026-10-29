# helm hosted server, in a container. Build from the repository root:
#   docker build -f hosted/Dockerfile -t helm-hosted .
# Run it with hosted/docker-compose.yml (see hosted/README.md).
#
# The image carries everything it needs and nothing from the machine it runs on: Node, git, its own Claude Code binary (the one the
# Agent SDK ships for Linux, at the version helm is built against), the built web client and the usual agent tools (Python, ripgrep, jq ...).
# Which tools go in is chosen with the INCLUDE build argument (below): a slim set by default, everything with INCLUDE=ALL.

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
# What to put in the image besides what helm itself needs, as categories separated by | (any case): ALL, or any of
#   CORE       python3, pip, venv and /opt/venv with requests httpx pandas numpy beautifulsoup4 lxml pyyaml pydantic matplotlib; zip, unzip, less, tree, file
#   SEARCH     ripgrep, fd, jq, yq
#   NETWORK    wget, dnsutils (dig), iputils-ping
#   EDITING    vim, nano, patch, diffutils, build-essential (gcc, make), sqlite3
#   DOCUMENTS  poppler-utils (pdftotext, pdftoppm), LibreOffice headless, pandoc
#   MEDIA      ffmpeg, imagemagick, tesseract-ocr
#   BROWSING   Playwright and Chromium (the heaviest; needs CORE, which it turns on)
# Always there, whatever you pick: node and npm, bash and coreutils, git, openssh-client, ca-certificates, curl, procps, tini, gh, and ripgrep
# (Claude Code's search tools use it). The default is the slim set; the published `-full` image is INCLUDE=ALL. For example:
#   docker build -f hosted/Dockerfile --build-arg 'INCLUDE=CORE|SEARCH|DOCUMENTS' -t helm-hosted .
ARG INCLUDE="CORE|SEARCH|NETWORK|EDITING|BROWSING"
ARG YQ_VERSION=v4.44.3
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright
RUN set -eu; \
    inc="|$(printf '%s' "$INCLUDE" | tr -d ' ' | tr a-z A-Z)|"; \
    case "$inc" in *"|ALL|"*) inc="|CORE|SEARCH|NETWORK|EDITING|DOCUMENTS|MEDIA|BROWSING|" ;; esac; \
    case "$inc" in *"|BROWSING|"*) inc="$inc|CORE|" ;; esac; \
    has() { case "$inc" in *"|$1|"*) return 0 ;; *) return 1 ;; esac; }; \
    for c in $(printf '%s' "$inc" | tr '|' ' '); do \
        case "$c" in CORE|SEARCH|NETWORK|EDITING|DOCUMENTS|MEDIA|BROWSING) ;; *) echo "unknown INCLUDE category: $c" >&2; exit 1 ;; esac; \
    done; \
    pkgs="git openssh-client ca-certificates curl procps ripgrep tini"; \
    if has CORE; then pkgs="$pkgs python3 python3-pip python3-venv zip unzip less tree file"; fi; \
    if has SEARCH; then pkgs="$pkgs fd-find jq"; fi; \
    if has NETWORK; then pkgs="$pkgs wget dnsutils iputils-ping"; fi; \
    if has EDITING; then pkgs="$pkgs vim nano patch diffutils build-essential sqlite3"; fi; \
    if has DOCUMENTS; then pkgs="$pkgs poppler-utils pandoc libreoffice-writer libreoffice-calc libreoffice-impress fonts-liberation fonts-dejavu-core"; fi; \
    if has MEDIA; then pkgs="$pkgs ffmpeg imagemagick tesseract-ocr"; fi; \
    apt-get update; apt-get install -y --no-install-recommends $pkgs; \
    if has SEARCH; then \
        ln -s "$(command -v fdfind)" /usr/local/bin/fd; \
        curl -fsSL "https://github.com/mikefarah/yq/releases/download/${YQ_VERSION}/yq_linux_$(dpkg --print-architecture)" -o /usr/local/bin/yq; \
        chmod 755 /usr/local/bin/yq; yq --version; \
    fi; \
    useradd --create-home --uid 1001 --shell /bin/bash helm; \
    if has CORE; then \
        python3 -m venv /opt/venv; \
        /opt/venv/bin/pip install --no-cache-dir requests httpx pandas numpy beautifulsoup4 lxml pyyaml pydantic matplotlib; \
    fi; \
    if has BROWSING; then \
        /opt/venv/bin/pip install --no-cache-dir playwright; \
        /opt/venv/bin/playwright install --with-deps chromium; \
        chmod -R a+rX /opt/ms-playwright; \
    fi; \
    if has CORE; then chown -R helm:helm /opt/venv; fi; \
    rm -rf /var/lib/apt/lists/*
# gh: the GitHub CLI, for agents and the terminal (`gh pr create`, `gh api`). helm writes its sign-in to gh's config, and the entrypoint makes
# `gh auth git-credential` git's credential helper for github.com, so `git fetch` on a private repository works too.
RUN mkdir -p -m 755 /etc/apt/keyrings \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update && apt-get install -y --no-install-recommends gh \
    && rm -rf /var/lib/apt/lists/* && gh --version
# /opt/venv (CORE) is first on the PATH, so `python` and `pip` are its; the helm user owns it, so an agent can `pip install` more.
ENV VIRTUAL_ENV=/opt/venv \
    PATH=/opt/venv/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    MPLBACKEND=Agg
WORKDIR /app
COPY --from=build /app /app

# The Claude Code binary that ships inside the Agent SDK, for this machine's architecture and C library (the musl builds, for Alpine, are
# installed beside it and are no use here). The server uses it for agents on its own; it is also put on the PATH so the terminal tab can run
# `claude` (to try things, or to log in) with exactly the version helm uses.
RUN case "$(dpkg --print-architecture)" in amd64) A=x64 ;; arm64) A=arm64 ;; *) echo "unsupported architecture" >&2; exit 1 ;; esac     && rm -rf /app/node_modules/@anthropic-ai/claude-agent-sdk-linux-*-musl     && CLAUDE="/app/node_modules/@anthropic-ai/claude-agent-sdk-linux-$A/claude"     && test -x "$CLAUDE" && ln -s "$CLAUDE" /usr/local/bin/claude && claude --version

# OpenAI Codex, the second agent. helm runs `codex app-server` and signs it in from the app, like Claude Code. Pinned, because helm talks to
# its protocol; change CODEX_VERSION to move it, and the app-server types it was written against are in `codex app-server generate-ts`.
ARG CODEX_VERSION=0.164.0
RUN npm install -g "@openai/codex@${CODEX_VERSION}" && npm cache clean --force && codex --version

# tsc, from the TypeScript helm is built with (a root devDependency, so it is in /app/node_modules), on the PATH for agents and the terminal tab.
RUN test -f /app/node_modules/typescript/bin/tsc && ln -s /app/node_modules/typescript/bin/tsc /usr/local/bin/tsc && tsc --version

# A normal user (created above), not root: the agent runs commands as whoever the server is. Everything it keeps (state, GitHub token,
# clones, worktrees, Claude Code's and Codex's logins) lives under /home/helm, which is the one volume.
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
