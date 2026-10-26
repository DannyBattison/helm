## D-42 · 2026-10-23 · Highlighting inside shell commands
Commands shown for approval are highlighted piece by piece. The shell is highlighted as shell, and a heredoc body in the language of the file it writes (from the extension) or the interpreter it feeds (`python3 - <<EOF`), else only if the language can be detected confidently, else left plain. Lines are preserved one for one and all text is escaped.
Why: a long heredoc that wrote a JavaScript file showed as plain text.
