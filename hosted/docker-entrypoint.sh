#!/bin/sh
# Starts the helm hosted server. Sets up what git needs on a fresh volume, then hands over to the server.
set -e

mkdir -p "$HELM_DATA_DIR" "$HOME/.helm/worktrees" "$HOME/code"

# Agents commit in worktrees, and git refuses to commit without an identity.
if [ -n "$HELM_GIT_NAME" ]; then git config --global user.name "$HELM_GIT_NAME"; fi
if [ -n "$HELM_GIT_EMAIL" ]; then git config --global user.email "$HELM_GIT_EMAIL"; fi
git config --global --get user.name >/dev/null 2>&1 || echo "note: no git identity set. Set HELM_GIT_NAME and HELM_GIT_EMAIL, or agents cannot commit." >&2

# git asks gh for the GitHub token each time it fetches or pushes; gh reads it from the sign-in helm keeps in its config. The empty entry first
# clears any helper set elsewhere, and replacing rather than adding keeps this the same on every start.
git config --global --replace-all credential.https://github.com.helper ''
git config --global --add credential.https://github.com.helper '!gh auth git-credential'

exec "$@"
