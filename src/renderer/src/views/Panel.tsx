import React from 'react';
import { participants } from '@shared/panel';
import type { ReplyRef, Session as S } from '@shared/types';
import { api } from '../api';
import { defaultChoice, modelChoices, panelBackendId, splitChoice } from '../lib';
import { go, setUI, toast, useApp, useUI } from '../store';
import { Avatar, Badge, Button, ContextMenu, Dialog, IconButton, Select } from '../ui';

const fail = (title: string) => (e: unknown) => toast({ tone: 'error', title, description: String((e as any)?.message || e).replace(/^Error invoking remote method '[^']*': (Error: )?/, '') });

/** Who is in a session with several agents. Click one for what can be done with them: mention, make the owner, remove. */
export function PanelBar({ s, onMention }: { s: S; onMention(name: string): void }) {
  const app = useApp();
  const [menu, setMenu] = React.useState<{ x: number; y: number; name: string } | null>(null);
  if (!s.panel) return null;
  const owner = s.panel.owner;
  return (
    <div style={{ maxWidth: 820, margin: '0 auto 8px', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      {participants(s.panel).map((n) => (
        <button key={n} type="button" className="helm-tap-row" onClick={(e) => setMenu({ x: e.clientX, y: e.clientY - 4, name: n })}
          title={n === owner ? 'Edits files and runs commands' : 'Reads and comments only'}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 26, padding: '0 8px 0 4px', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer', background: 'var(--bg-raised)', boxShadow: 'inset 0 0 0 1px ' + (n === owner ? 'var(--accent)' : 'var(--border)'), color: 'var(--text-1)', font: '500 12px/1.5 var(--font-mono)' }}>
          <Avatar agent backend={panelBackendId(app, s, n)} name={n} size={18} />@{n}
          <Badge tone={n === owner ? 'accent' : 'neutral'}>{n === owner ? 'owner' : 'read-only'}</Badge>
        </button>
      ))}
      <IconButton icon="user-plus" label="Add another agent" size="sm" onClick={() => setUI({ addingAgent: s.id })} />
      {menu ? (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={[
          { label: `Mention @${menu.name}`, icon: 'at', onClick: () => onMention(menu.name) },
          { label: 'Make the owner', icon: 'crown-simple', disabled: menu.name === owner, separator: true, onClick: () => void api.setPanelOwner(s.id, menu.name).catch(fail('Could not change the owner')) },
          { label: 'Remove from the session', icon: 'user-minus', danger: true, disabled: menu.name === owner, onClick: () => void api.removePanelAgent(s.id, menu.name).catch(fail('Could not remove the agent')) }
        ]} />
      ) : null}
    </div>
  );
}

/** Pick an agent and model to bring into a running session. */
export function AddAgentDialog({ id, onClose }: { id: string; onClose(): void }) {
  const app = useApp();
  const [choice, setChoice] = React.useState(() => defaultChoice(app));
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState('');
  const add = async () => {
    setBusy(true); setErr('');
    try { await api.addPanelAgent(id, splitChoice(choice)); onClose(); }
    catch (e) { setErr(String((e as any)?.message || e).replace(/^Error invoking remote method '[^']*': (Error: )?/, '')); }
    finally { setBusy(false); }
  };
  return (
    <Dialog width={460} title="Add an agent" onClose={onClose}
      description="It reads the code and the conversation and joins the discussion, but cannot edit files or run commands that change anything. Only the owner can."
      footer={<>
        <span style={{ flex: 1, font: '400 12px/1.5 var(--font-sans)', color: 'var(--status-error-text)' }}>{err}</span>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" icon="user-plus" loading={busy} disabled={!choice} onClick={add}>Add</Button>
      </>}>
      <Select value={choice} onChange={(e: any) => setChoice(e.target.value)} options={modelChoices(app)} />
    </Dialog>
  );
}

export function AddAgentHost() {
  const id = useUI((u) => u.addingAgent);
  return id ? <AddAgentDialog key={id} id={id} onClose={() => setUI({ addingAgent: null })} /> : null;
}

/** The message a reply answers, in a line above it. Clicking jumps to the original. */
export function ReplyQuote({ re, sessionId }: { re: ReplyRef; sessionId?: string }) {
  return (
    <div role={sessionId ? 'button' : undefined} onClick={sessionId ? () => go({ screen: 'session', id: sessionId, tab: 'conversation', msg: re.index }) : undefined}
      style={{ display: 'flex', gap: 6, alignItems: 'baseline', minWidth: 0, cursor: sessionId ? 'pointer' : 'default', borderLeft: '2px solid var(--border-strong)', paddingLeft: 8, font: '400 12px/1.5 var(--font-sans)', color: 'var(--text-3)' }}>
      <i className="ph ph-arrow-bend-up-left" style={{ fontSize: 12 }} />
      <span style={{ font: '500 12px/1.5 var(--font-mono)', color: 'var(--text-2)', whiteSpace: 'nowrap' }}>{re.who === 'you' ? 'you' : '@' + re.who}</span>
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{re.snippet}</span>
    </div>
  );
}
