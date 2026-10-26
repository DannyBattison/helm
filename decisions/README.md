# Decisions

Append-only log of decisions made for helm, one file per decision so branches never edit the same file. Never edit or delete earlier entries. If a decision changes, add a new entry that supersedes the old one and reference it.

New entry: `decisions/YYYY-MM-DD-short-slug.md` (lowercase, hyphens), whose first line is `## YYYY-MM-DD · Title` (the same date as the filename), then the decision and the reason. Refer to an entry by its file name without `.md`.

The first 160 entries were written as `D-NNN` and keep their numbers (`D-NNN-slug.md`, heading `## D-NNN · date · title`). Don't add new numbered entries.

Read them in order with `cat decisions/*.md` (numbered ones sort before dated ones).
