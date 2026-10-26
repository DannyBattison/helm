## 2026-10-26 · One file per decision instead of a single DECISIONS.md
Decisions live in `decisions/`, one file each, named `YYYY-MM-DD-short-slug.md` and identified by that name rather than a sequential number. The 159 existing entries moved over unchanged as `D-NNN-slug.md`. `DECISIONS.md` is gone; `tests/decisions.test.ts` checks names and headings.
Why: every branch appended to the end of one file and picked the same next number, so merges conflicted constantly and needed renumbering. New files never collide.
