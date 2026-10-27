import React from 'react';
import type { McpServer } from '@shared/types';
import { mcpProblem } from '@shared/mcp';
import { api } from '../api';
import { toast } from '../store';
import { Badge, Button, Dialog, Input, SegmentedControl, Switch } from '../ui';

const errText = (e: any) => String(e?.message || e).replace(/^Error invoking remote method '\w+': Error: /, '');
const label: React.CSSProperties = { font: '500 12px/1.5 var(--font-sans)', color: 'var(--text-2)' };
const hint: React.CSSProperties = { font: '400 11.5px/1.45 var(--font-sans)', color: 'var(--text-3)' };

const blank = (): McpServer => ({ name: '', type: 'stdio', command: '', args: [], env: {}, url: '', headers: {} });
const toLines = (m: Record<string, string>) => Object.entries(m).map(([k, v]) => `${k}=${v}`).join('\n');
const fromLines = (t: string) => Object.fromEntries(t.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const i = l.indexOf('='); return i < 0 ? [l, ''] : [l.slice(0, i), l.slice(i + 1)]; }));
const summary = (s: McpServer) => s.type === 'stdio' ? [s.command, ...s.args].join(' ') : s.url;

function Area({ value, onChange, placeholder }: { value: string; onChange(v: string): void; placeholder: string }) {
  return <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={3} spellCheck={false}
    style={{ resize: 'vertical', padding: '6px 8px', border: 'none', borderRadius: 'var(--radius-md)', background: 'var(--bg-input)', boxShadow: 'inset 0 0 0 1px var(--border)', color: 'var(--text-1)', font: '400 12px/1.5 var(--font-mono)', outline: 'none' }} />;
}

function Editor({ repoId, server, names, onClose }: { repoId: string | null; server: McpServer | null; names: string[]; onClose(): void }) {
  const [s, setS] = React.useState<McpServer>(server || blank());
  const [args, setArgs] = React.useState((server?.args || []).join('\n'));
  const [env, setEnv] = React.useState(toLines(server ? (server.type === 'stdio' ? server.env : server.headers) : {}));
  const [busy, setBusy] = React.useState(false);
  const stdio = s.type === 'stdio';
  const built = (): McpServer => stdio ? { ...s, args: args.split('\n'), env: fromLines(env) } : { ...s, headers: fromLines(env) };
  const problem = mcpProblem(built(), names.filter((n) => n !== server?.name));
  const save = async () => {
    setBusy(true);
    try { await api.saveMcpServer(repoId, built(), server?.name); onClose(); }
    catch (e) { toast({ tone: 'error', title: errText(e) }); setBusy(false); }
  };
  return (
    <Dialog title={server ? `Edit ${server.name}` : 'Add MCP server'} width={520} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!!problem} onClick={save}>{server ? 'Save' : 'Add server'}</Button></>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><span style={label}>Name</span>
          <Input mono autoFocus value={s.name} placeholder="github" onChange={(e: any) => setS({ ...s, name: e.target.value })} /></label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><span style={label}>Type</span>
          <SegmentedControl size="sm" value={s.type} onChange={(v: string) => setS({ ...s, type: v as McpServer['type'] })} options={[{ value: 'stdio', label: 'Command' }, { value: 'http', label: 'HTTP' }, { value: 'sse', label: 'SSE' }]} /></div>
        {stdio ? <>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><span style={label}>Command</span>
            <Input mono value={s.command} placeholder="npx" onChange={(e: any) => setS({ ...s, command: e.target.value })} /></label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><span style={label}>Arguments</span>
            <Area value={args} onChange={setArgs} placeholder={'-y\n@modelcontextprotocol/server-github'} /><span style={hint}>One per line.</span></label>
        </> : (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><span style={label}>Address</span>
            <Input mono value={s.url} placeholder="https://example.com/mcp" onChange={(e: any) => setS({ ...s, url: e.target.value })} /></label>
        )}
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><span style={label}>{stdio ? 'Environment variables' : 'Headers'}</span>
          <Area value={env} onChange={setEnv} placeholder={stdio ? 'GITHUB_TOKEN=…' : 'Authorization=Bearer …'} /><span style={hint}>One NAME=value per line.</span></label>
        <Switch checked={!s.disabled} onChange={(v: boolean) => setS({ ...s, disabled: v ? undefined : true })} label="Enabled" />
        {problem && (s.name || s.command || s.url) ? <span style={{ ...hint, color: 'var(--status-error)' }}>{problem}</span> : null}
      </div>
    </Dialog>
  );
}

/** The MCP servers of every session (`repoId` null) or of one repository, with add, edit, enable and remove. */
export function McpServers({ repoId, servers, inherited = [] }: { repoId: string | null; servers: McpServer[]; inherited?: McpServer[] }) {
  const [edit, setEdit] = React.useState<McpServer | 'new' | null>(null);
  const names = servers.map((x) => x.name);
  const run = (p: Promise<void>) => p.catch((e) => toast({ tone: 'error', title: errText(e) }));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ ...hint, flex: 1 }}>{repoId ? 'Added to the global servers for sessions in this repository. A server with the same name as a global one replaces it.' : 'Every session gets these. They apply to sessions started from now on.'}</span>
        <Button variant="secondary" icon="plus" onClick={() => setEdit('new')}>Add server</Button>
      </div>
      {servers.length === 0 ? <span style={{ ...hint, padding: '12px 0' }}>No MCP servers{repoId ? ' for this repository' : ''} yet.</span> : servers.map((x) => (
        <div key={x.name} style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 44, padding: '6px 0', borderTop: '1px solid var(--border-subtle)', opacity: x.disabled ? 0.55 : 1 }}>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, font: '500 13px/1.5 var(--font-mono)' }}>{x.name}<Badge tone="neutral">{x.type === 'stdio' ? 'command' : x.type}</Badge></span>
            <span title={summary(x)} style={{ font: '400 11.5px/1.5 var(--font-mono)', color: 'var(--text-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{summary(x)}</span>
          </div>
          <Switch checked={!x.disabled} onChange={(v: boolean) => void run(api.saveMcpServer(repoId, { ...x, disabled: v ? undefined : true }, x.name))} />
          <Button variant="ghost" size="sm" icon="pencil-simple" onClick={() => setEdit(x)}>Edit</Button>
          <Button variant="ghost" size="sm" icon="trash" onClick={() => void run(api.removeMcpServer(repoId, x.name))}>Remove</Button>
        </div>
      ))}
      {inherited.length ? <span style={hint}>Also from global: {inherited.map((x) => x.name + (names.includes(x.name) ? ' (replaced)' : '')).join(', ')}.</span> : null}
      {edit ? <Editor repoId={repoId} server={edit === 'new' ? null : edit} names={names} onClose={() => setEdit(null)} /> : null}
    </div>
  );
}
