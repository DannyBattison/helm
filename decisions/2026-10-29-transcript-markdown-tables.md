## 2026-10-29 · Render markdown tables in the transcript

The transcript's `Rich` renderer joined `|` rows into one paragraph. It now parses a header row, a `---` separator and body rows into a real table, honouring `:--`/`--:` alignment, scrolling sideways when wide. Pipe lines without a separator row fall back to plain text.
