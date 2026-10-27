## 2026-10-27 · Kanban board layout for the overview

The overview's Sessions section gets a List/Board toggle (remembered in localStorage as `helm-overview-layout`). The board has columns Needs you, Working, Ready for review and Idle (idle and errored), cards sorted by last access. External and Archived filters always use the list, since those rows are not helm sessions. Read-only drag is not offered: status is driven by the agent, so moving cards would have no meaning.
