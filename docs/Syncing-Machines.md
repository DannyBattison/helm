# Syncing machines

Move or share your sessions and history between helm instances, such as a laptop and a server.

> **In short**
> - **Sync** keeps sessions, transcripts, repositories, automated agents, settings and usage in step between instances.
> - A synced session is **read-only** on every instance but one. **Take control** moves it.
> - **Export** and **Import** do the same with a file.
> - Keys, sign-ins, environment variables and anything about one machine (paths, shell, window choices) are never copied.

## Sync

Under **Settings, then Sync**.

**On a hosted server (the one being synced into):**
1. Turn on **Let other instances sync with this one** (off by default). Use HTTPS in front of the server.
2. Copy the **Sync key** and the server's address. Anyone with the key can read your conversations.

**On the other instance (a desktop or another server):**
1. Under **Servers to sync with**, **Add a server**: a name, its URL and the key.
2. Press the sync button, or switch on **Keep in sync** for that server so changes are passed along as they happen (and checked every few minutes as a safety net).

Only a hosted server can receive a sync, since only it has an address. A desktop can sync with any number of servers, but desktop to desktop does not work.

### What is copied

Each kind of data has its own switch under **Settings, then Sync**, and each instance applies its own switches to what it sends and what it takes in:

- **Sessions**, with their transcripts.
- **Repositories**, with their settings and fixtures. Each machine keeps its own clone: a repository that arrives is cloned under your clone folder the first time you need it.
- **Automated agents**.
- **Settings**: preferences, budgets, shortcuts, MCP servers. Not paths, the agent environment, email setup, or machine choices such as tray, shell, start at login and the companion. MCP servers arrive without their environment variables and headers, and keep the ones you already have under the same name.
- **Usage and audit history**, and **repository artifacts**.
- **Branches** (off by default): pushes the branch of each session you control to GitHub.
- **Worktrees** (off by default): also pushes a snapshot of uncommitted work, to a hidden ref (`refs/helm/sync/<session>`).

When a record differs on both sides, the more recent copy wins, and deletions are passed on too (for 30 days), so a session you remove on one side does not come back.

### Taking control

A session is controlled by one instance, the one that made it. Every other instance holds a read-only copy: you can read it, but not message, resume or stop it. Press **Take control** on the copy to move it here. helm fetches the branch (and snapshot, if Worktrees was on) into a worktree of its own, and the other instance's copy turns read-only at its next sync. If the session was running there, it is stopped. The latest takeover always wins, even over later edits on the other side.

Turn on **Branches** (and **Worktrees**) on the instance that has the work, let it sync, and then take control on the other. A scratch folder you chose yourself for a free agent cannot be moved.

### What is not

Sign-ins, passwords, sync keys, the activity log, caches and the worktrees themselves. Code moves through git on GitHub.

## Export and import

Under **Settings, then Import and export**.

- **Export** saves repositories, sessions, transcripts, usage, automated agents, settings and fixtures to one file. Sign-ins and passwords are not included. The file holds your conversations, so keep it safe.
- **Import** adds the contents of an export file. Anything already there is kept: sessions and repositories with the same name are not overwritten. Paths, shells and update settings stay as on this machine. Imported sessions come in stopped.

## See also

- [Hosted version](Hosted-Version.md)
- [Settings](Settings.md)
