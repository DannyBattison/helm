## 2026-11-18 · Progress bars for worktree setup and unzipping fixtures

The transcript footer shows a progress bar (not a spinner) while a session prepares: `git worktree add --progress` is parsed for its percentage and put in `s.preparing`, which the fixture copy already used. Unzipping a fixture reports compressed bytes done out of the zip's size through a new `fixtureProgress` event, shown as a bar and a percentage on the Unzip button. The spinner stays for steps with no known length.
