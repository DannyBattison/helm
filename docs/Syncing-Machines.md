# Syncing machines

Move or share your sessions and history between helm instances, such as a laptop and a server.

> **In short**
> - **Sync** copies sessions, transcripts and usage between instances on request.
> - **Export** and **Import** do the same with a file.
> - Settings and sign-ins are never copied.

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

Repositories, automated agents, sessions and their transcripts, usage history, and repository fixtures. A session is copied when the other side lacks it or is further behind. A session that is running on the other side is never replaced. When a record differs on both sides, the more recent copy wins, and deletions are passed on too (for 30 days), so a session you remove on one side does not come back.

### What is not

Settings, sign-ins, passwords, the activity log, caches and the worktrees themselves. Code moves through git branches on GitHub.

## Export and import

Under **Settings, then Import and export**.

- **Export** saves repositories, sessions, transcripts, usage, automated agents, settings and fixtures to one file. Sign-ins and passwords are not included. The file holds your conversations, so keep it safe.
- **Import** adds the contents of an export file. Anything already there is kept: sessions and repositories with the same name are not overwritten. Paths, shells and update settings stay as on this machine. Imported sessions come in stopped.

## See also

- [Hosted version](Hosted-Version.md)
- [Settings](Settings.md)
