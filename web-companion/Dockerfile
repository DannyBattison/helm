# helm companion relay, in a container. Build from the repository root:
#   docker build -f web-companion/Dockerfile -t helm-companion-relay .
# Run it with web-companion/docker-compose.yml (see web-companion/README.md). The image holds the relay and the built companion page, and
# no agents, git or tools: it only passes messages between browsers and desktop apps. Put TLS in front of it.

# ---- build: the companion page (the desktop renderer, so it needs the root dependencies)
FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm_config_audit=false npm_config_fund=false
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY hosted/package.json hosted/package-lock.json hosted/
RUN cd hosted && npm ci
COPY tsconfig.json tsconfig.node.json tsconfig.web.json ./
COPY desktop/tsconfig.json desktop/
COPY src src
COPY hosted hosted
COPY web-companion web-companion
RUN cd web-companion && npm run build

# ---- the relay's own dependencies, without the dev ones
FROM node:22-bookworm-slim AS deps
WORKDIR /app
ENV npm_config_audit=false npm_config_fund=false
COPY hosted/package.json hosted/package-lock.json hosted/
RUN cd hosted && npm ci --omit=dev
COPY web-companion/package.json web-companion/package-lock.json web-companion/
RUN cd web-companion && npm ci --omit=dev

# ---- run
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends tini curl ca-certificates \
    && rm -rf /var/lib/apt/lists/* && useradd -m -s /bin/bash helm
WORKDIR /app
# Only the source the relay imports: the shared cookie, push and static-file code from hosted/, and two folders of plain TypeScript from
# src/ (one constant and what it imports). tsx runs them as they are.
COPY --from=deps /app/hosted/node_modules hosted/node_modules
COPY --from=deps /app/web-companion/node_modules web-companion/node_modules
COPY hosted/package.json hosted/
COPY hosted/src hosted/src
COPY src/core src/core
COPY src/shared src/shared
COPY web-companion/package.json web-companion/
COPY web-companion/relay web-companion/relay
COPY --from=build /app/web-companion/dist web-companion/dist
USER helm
ENV HOME=/home/helm \
    HELM_RELAY_DATA_DIR=/home/helm/.helm-relay \
    HOST=0.0.0.0 \
    PORT=8788 \
    NODE_ENV=production
VOLUME /home/helm
WORKDIR /app/web-companion
EXPOSE 8788
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD curl -fs http://127.0.0.1:8788/ >/dev/null || exit 1
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["npx", "tsx", "relay/server.ts"]
