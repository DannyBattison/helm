## D-121 · 2026-10-26 · Main's "Show organisation in the sidebar" replaces the separate owner setting
While merging main, this branch's `showRepoOwner` (D-120, off by default) turned out to do what main's `showOwner` (on by default, Settings → Appearance → "Show organisation in the sidebar") already does for the left tree. Two switches for one thing would conflict, so `showRepoOwner`, its row in Settings and its default are removed and main's `showOwner` is kept, with its default of showing the owner.
Why: merging main into this branch.
