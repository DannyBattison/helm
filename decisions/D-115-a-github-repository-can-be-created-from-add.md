## D-115 · 2026-10-25 · A GitHub repository can be created from Add repository
Add repository has a "Create new" tab: name, description, private or public, and an owner (the user or one of their organisations). `createRepo` in `github.ts` creates it with `auto_init` so it has a README and a default branch (sessions branch from origin and need one), then the repository is cloned into the clone root and added like any other. The token's existing `repo` scope is enough for personal repositories; organisation ones need the organisation to allow it.
Why: user request.
