## 2026-10-28 · Commit signing is a three-way setting that defaults to the user's own git configuration

`signCommits` is `config` (do nothing, as before), `on` or `off`. It sets `commit.gpgsign` for the commits helm makes (through `git.ts`) and for the agent's (through `GIT_CONFIG_PARAMETERS` in its environment). The key itself stays in the user's git configuration; helm does not store keys or passphrases. Agents cannot answer a passphrase prompt, so the setting says to use a key held by gpg-agent or ssh-agent, and with Always the agent is told not to bypass signing with `--no-gpg-sign`.
