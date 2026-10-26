# helm

- Log every decision as its own file, `decisions/YYYY-MM-DD-short-slug.md`, first line `## YYYY-MM-DD · Title` (see `decisions/README.md`). Append-only; never edit old entries. Don't add numbered `D-NNN` entries or recreate `DECISIONS.md`.
- Decision files never conflict, so no renumbering after merges. `tests/decisions.test.ts` checks the file names and headings.
- Commit as you go.
