## 2026-10-29 · Removing a fixture also removes it from session worktrees, and fixture folders can be opened

Remove only deleted the stored copy, so every worktree that had been given the fixture kept a copy (or a dangling link). It now deletes the fixture from the worktrees of the repository's sessions too, leaving any path the repository tracks alone. The Fixtures tab shows folders as expandable rows (loaded a level at a time through `listRepoFixtureFolder`), and sharing, unsharing and removing show progress on the button, since locking a large folder takes a while.
