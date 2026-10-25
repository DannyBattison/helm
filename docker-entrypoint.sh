#!/bin/sh
# Starts the helm hosted server. Sets up what git needs on a fresh volume, then hands over to the server.
set -e

mkdir -p "$HELM_DATA_DIR" "$HOME/.helm/worktrees" "$HOME/code"

# Agents commit in worktrees, and git refuses to commit without an identity.
if [ -n "$HELM_GIT_NAME" ]; then git config --global user.name "$HELM_GIT_NAME"; fi
if [ -n "$HELM_GIT_EMAIL" ]; then git config --global user.email "$HELM_GIT_EMAIL"; fi
git config --global --get user.name >/dev/null 2>&1 || echo "note: no git identity set. Set HELM_GIT_NAME and HELM_GIT_EMAIL, or agents cannot commit." >&2

if [ -z "$ANTHROPIC_API_KEY" ] && [ -z "$CLAUDE_CODE_OAUTH_TOKEN" ] && [ ! -e "$HOME/.claude/.credentials.json" ]; then
  echo "note: no ANTHROPIC_API_KEY (or CLAUDE_CODE_OAUTH_TOKEN) and no Claude Code login in this container, so agents cannot start. Put the key in .env." >&2
fi

exec "$@"
