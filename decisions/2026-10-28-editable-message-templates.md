## 2026-10-28 · Messages helm sends to agents are editable, and prompts can be templates

Every message helm composes for an agent (resolve a conflict, review comments, resume, self-review, issue and pull request feedback tasks) lives in `shared/templates.ts` as a default text with `{{variable}}` placeholders. `Settings.messageTemplates` holds replacements by id; an empty replacement means the default. Repositories may override per message (merged per id, not replaced wholesale). Unknown `{{names}}` are left visible rather than blanked, and a line holding only an empty variable is dropped with one blank line, so optional parts (labels, discussion) leave no gaps.

User-written prompts (`Settings.promptTemplates`, global, plus a repository's own) are inserted into a session's message box from the composer. helm fills `repo`, `branch`, `base`, `task`; any other variable is asked for. A repository's prompt of the same name replaces the global one in that repository.

Why: the wording was hard-coded, and people want their own house style and reusable prompts without forking. The default texts are byte-identical to the old strings, so nothing changes until someone edits.
