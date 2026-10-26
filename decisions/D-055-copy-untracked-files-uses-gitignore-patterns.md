## D-55 · 2026-10-23 · Copy untracked files uses gitignore patterns
The "copy untracked files" setting is now a multi-line box of .gitignore-format patterns (`.env`, `config/*.local.json`, `**/secrets.*`, `!keep.env`, `# comment`). git does the matching (`ls-files --others --ignored --exclude-from`), so negation, folders, `**` and comments behave as in a .gitignore; tracked files are never copied. Capped at 500 files and 50 MB each; a bad pattern never stops a session starting. The old comma-separated value is converted to one pattern per line on first load.
Why: user request.
