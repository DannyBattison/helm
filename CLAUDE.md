# helm

- Log every decision in `DECISIONS.md`, append-only, as `## D-NNN · date · title`, with the next number after the last entry.
- After any merge or pull that touches `DECISIONS.md`, keep both sides' entries and renumber so the numbers run 1, 2, 3 … in order with no duplicates. `tests/decisions.test.ts` fails otherwise.
- Commit as you go.
