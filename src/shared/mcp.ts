import type { McpServer } from './types';

/** Names are used as tool prefixes (`mcp__<name>__tool`), so they stay to letters, digits, dashes and underscores. */
export const MCP_NAME = /^[A-Za-z0-9_-]{1,64}$/;

/** What is wrong with a server, or '' when it is fine. `others` are the names already taken in the same list. */
export function mcpProblem(s: McpServer, others: string[] = []): string {
  if (!MCP_NAME.test(s.name)) return 'The name needs letters, digits, dashes or underscores only.';
  if (others.includes(s.name)) return `There is already a server called ${s.name}.`;
  if (s.type === 'stdio') return s.command.trim() ? '' : 'Enter the command that starts the server.';
  if (!s.url.trim()) return 'Enter the server address.';
  try { const u = new URL(s.url.trim()); return /^https?:$/.test(u.protocol) ? '' : 'The address must start with http:// or https://.'; } catch { return 'That is not a valid address.'; }
}

/** Cleans what the renderer sent: trims, drops empty arguments and variables, and keeps only the fields of the server's type. */
export function cleanMcp(s: McpServer): McpServer {
  const pairs = (m: Record<string, string> | undefined) => Object.fromEntries(Object.entries(m || {}).map(([k, v]) => [k.trim(), String(v)] as const).filter(([k]) => k));
  const base = { name: s.name.trim(), type: s.type, ...(s.disabled ? { disabled: true } : {}) };
  return s.type === 'stdio'
    ? { ...base, command: s.command.trim(), args: (s.args || []).map((a) => a.trim()).filter(Boolean), env: pairs(s.env), url: '', headers: {} }
    : { ...base, command: '', args: [], env: {}, url: s.url.trim(), headers: pairs(s.headers) };
}

/** The servers a session gets: the global ones, with a project's own replacing a global one of the same name. Disabled ones are left out. */
export function mcpConfig(global: McpServer[] = [], repo: McpServer[] = []): Record<string, any> {
  const byName = new Map<string, McpServer>();
  for (const s of [...global, ...repo]) byName.set(s.name, s);
  const out: Record<string, any> = {};
  for (const s of byName.values()) {
    if (s.disabled) continue;
    out[s.name] = s.type === 'stdio'
      ? { type: 'stdio', command: s.command, args: s.args, ...(Object.keys(s.env).length ? { env: s.env } : {}) }
      : { type: s.type, url: s.url, ...(Object.keys(s.headers).length ? { headers: s.headers } : {}) };
  }
  return out;
}
