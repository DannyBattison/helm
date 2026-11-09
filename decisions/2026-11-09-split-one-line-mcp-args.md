## 2026-11-09 · Split MCP arguments typed on one line

The Arguments field is one per line, but a user entered `-y -p @scope/pkg bin` on a single line; `npx` got it as one argument and the server closed at once, so agents never saw its tools. A lone argument that starts with `-` and contains whitespace is now split on whitespace, both on save and when sessions are given the servers (so already-saved ones work). Several lines, or a lone argument not starting with `-`, are left untouched.
