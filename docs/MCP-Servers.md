# MCP servers

MCP servers give agents extra tools and data sources, such as a GitHub tool, a database or a browser.

> **In short**
> - Add servers globally (every repository) under **Settings, then MCP servers**, or for one repository on its **MCP servers** tab.
> - A repository's server replaces a global one of the same name, and a disabled one switches a global server off there.
> - Changes apply to sessions started from then on.

## Add a server

1. Open **Settings, then MCP servers** (global) or a repository's **MCP servers** tab.
2. Add a server, giving it a name. Choose how it runs:
   - a **command** with arguments (one per line), for example `-y` and `@modelcontextprotocol/server-github`, or
   - a **URL**, such as `https://example.com/mcp`.
3. Turn it on. Edit, disable or remove it any time.

helm keeps its own list rather than editing Claude Code's `.mcp.json` or `~/.claude.json`, so servers can sync between your machines and be managed in one place. Servers are given to Claude Code agents when a session starts.

> **Careful:** a server can run programs on your computer, and its credentials are stored in helm's settings. Only add servers you trust.

## See also

- [Settings](Settings.md)
- [Repository page](Repository-Page.md#mcp-servers)
- [Safety and limits](Safety-and-Limits.md)
