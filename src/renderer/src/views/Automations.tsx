import React from 'react';
import type { AutomatedAgent } from '@shared/types';
import type { AutomationTrigger } from '@shared/automations';
import { DAYS, describeTrigger, TRIGGER_LABELS, validateAgent } from '@shared/automations';
import { api } from '../api';
import { toast, useApp } from '../store';
import { billingOf, defaultChoice, modelChoices, splitChoice } from '../lib';
import { Badge, Button, Dialog, Input, SegmentedControl, Select, Switch } from '../ui';

const errText = (e: any) => String(e?.message || e).replace(/^Error invoking remote method '\w+': Error: /, '');
const PERMS = [{ value: 'ask', label: 'Ask before commands' }, { value: 'edits', label: 'Allow edits, ask for commands' }, { value: 'plan', label: 'Plan only' }, { value: 'all', label: 'Allow everything' }];
const EVERY = [{ value: 'hour', label: 'Every hour' }, { value: 'day', label: 'Every day' }, { value: 'weekday', label: 'Every weekday' }, { value: 'week', label: 'Every week' }];

type Draft = Omit<AutomatedAgent, 'id' | 'createdAt' | 'lastRun'> & { id?: string };
const blank = (scope: string): Draft => ({ name: '', prompt: '', scope, trigger: { type: 'pull_request' }, enabled: true, model: 'sonnet', permMode: 'ask', budget: 5 });

const label = (text: string, child: React.ReactNode) => (
  <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
    <span style={{ font: '500 12px/1.3 var(--font-sans)', color: 'var(--text-2)' }}>{text}</span>
    {child}
  </label>
);

/** A branch choice: a list for one repository, free text when the agent covers every repository. */
function BranchField({ scope, value, onChange, anyLabel }: { scope: string; value: string; onChange(v: string): void; anyLabel: string }) {
  const [names, setNames] = React.useState<string[]>([]);
  React.useEffect(() => {
    setNames([]);
    if (scope !== 'global') api.repoBranches(scope).then(setNames).catch(() => undefined);
  }, [scope]);
  if (scope === 'global') return <Input mono value={value} onChange={(e: any) => onChange(e.target.value)} placeholder={anyLabel.toLowerCase() + ' (or type a branch name)'} />;
  const all = value && !names.includes(value) ? [value, ...names] : names;
  return <Select value={value} onChange={(e: any) => onChange(e.target.value)} options={[{ value: '', label: anyLabel }, ...all.map((n) => ({ value: n, label: n }))]} />;
}

function Editor({ draft, repos, onClose }: { draft: Draft; repos: { id: string }[]; onClose(): void }) {
  const app = useApp();
  const [d, setD] = React.useState(draft);
  const [busy, setBusy] = React.useState(false);
  const t = d.trigger;
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const setTrigger = (p: Partial<AutomationTrigger> & { type: AutomationTrigger['type'] }) => set({ trigger: (p.type === 'schedule' ? { type: 'schedule', every: 'day', time: '09:00', day: 1, ...(t.type === 'schedule' ? t : {}), ...p } : { type: p.type }) as AutomationTrigger });
  const problem = validateAgent(d);
  const save = async () => {
    setBusy(true);
    try { await api.saveAutomation(d); onClose(); }
    catch (e) { toast({ tone: 'error', title: 'Could not save the agent', description: errText(e) }); }
    setBusy(false);
  };
  return (
    <Dialog title={d.id ? 'Edit automated agent' : 'New automated agent'} width={560} onClose={onClose}
      description="Starts a session by itself, on a schedule or when something happens on GitHub."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!!problem || busy} onClick={() => void save()}>{d.id ? 'Save' : 'Create'}</Button></>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {label('Name', <Input value={d.name} onChange={(e: any) => set({ name: e.target.value })} placeholder="Review new pull requests" />)}
        {label('Runs in', <Select value={d.scope} onChange={(e: any) => set({ scope: e.target.value })} options={[{ value: 'global', label: 'Every repository (global)' }, ...repos.map((r) => ({ value: r.id, label: r.id }))]} />)}
        {label('When', <Select value={t.type} onChange={(e: any) => setTrigger({ type: e.target.value })} options={(Object.keys(TRIGGER_LABELS) as AutomationTrigger['type'][]).map((k) => ({ value: k, label: TRIGGER_LABELS[k] }))} />)}
        {t.type === 'schedule' ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Select value={t.every} onChange={(e: any) => setTrigger({ type: 'schedule', every: e.target.value })} options={EVERY} />
            {t.every === 'week' ? <Select value={String(t.day)} onChange={(e: any) => setTrigger({ type: 'schedule', day: +e.target.value })} options={DAYS.map((n, i) => ({ value: String(i), label: n }))} /> : null}
            {t.every !== 'hour' ? <Input mono value={t.time} onChange={(e: any) => setTrigger({ type: 'schedule', time: e.target.value })} placeholder="09:00" style={{ width: 80 }} /> : null}
            <span style={{ font: '400 12px/1.4 var(--font-sans)', color: 'var(--text-3)' }}>Local time. Runs when helm is open; a missed run starts once when helm next opens.</span>
          </div>
        ) : (
          <>
            {t.type !== 'issue' ? label(t.type === 'commit' ? 'Branch to watch' : 'Branch', <BranchField scope={d.scope} value={d.branch || ''} onChange={(v) => set({ branch: v })} anyLabel={t.type === 'commit' ? 'Default branch' : 'Any branch'} />) : null}
            {t.type === 'pull_request' || t.type === 'merge' ? <span style={{ font: '400 12px/1.45 var(--font-sans)', color: 'var(--text-3)', marginTop: -6 }}>For pull requests this is the branch they target.</span> : null}
          <span style={{ font: '400 12px/1.45 var(--font-sans)', color: 'var(--text-3)' }}>helm checks GitHub every minute while it is open. Anything that already exists when you create the agent is ignored.</span>
          </>
        )}
        {label('Prompt', <textarea rows={6} value={d.prompt} onChange={(e) => set({ prompt: e.target.value })} spellCheck={false}
          placeholder={t.type === 'schedule' ? 'Look for outdated dependencies and open a pull request that updates them.' : 'Review pull request #{{number}} and leave notes in a REVIEW.md file.'}
          style={{ resize: 'vertical', boxSizing: 'border-box', width: '100%', padding: 10, borderRadius: 'var(--radius-md)', border: 0, outline: 0, boxShadow: 'inset 0 0 0 1px var(--border)', background: 'var(--bg-editor)', color: 'var(--text-1)', font: 'var(--type-data)' }} />)}
        <span style={{ font: '400 12px/1.45 var(--font-sans)', color: 'var(--text-3)', marginTop: -6 }}>You can use {'{{repo}}, {{number}}, {{title}}, {{url}} and {{branch}}'}. For commits, {'{{title}}'} is the latest commit message. The trigger is added to the start of the task.</span>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {label('Model', <Select value={`${d.backend || app.settings.defaultBackend}/${d.model}`} onChange={(e: any) => set(splitChoice(e.target.value))} options={modelChoices(app)} />)}
          {label('Permissions', <Select value={d.permMode} onChange={(e: any) => set({ permMode: e.target.value })} options={PERMS} />)}
          {billingOf(app, d.backend || app.settings.defaultBackend) === 'subscription' ? null : label('Budget per session', <Input mono value={String(d.budget)} onChange={(e: any) => set({ budget: Number(e.target.value) || 0 })} style={{ width: 80 }} />)}
        </div>
        {d.scope === 'global' && t.type === 'schedule' ? <Badge tone="attention">A global schedule starts one session in every repository each time.</Badge> : null}
      </div>
    </Dialog>
  );
}

/** Settings → Automated agents: sessions that start by themselves on a schedule or a GitHub event. */
export function AutomationsSection() {
  const app = useApp();
  const [editing, setEditing] = React.useState<Draft | null>(null);
  const list = app.automations || [];
  const run = async (a: AutomatedAgent) => {
    try { const n = await api.runAutomation(a.id); toast({ tone: 'ready', title: `Started ${n} ${n === 1 ? 'session' : 'sessions'}` }); }
    catch (e) { toast({ tone: 'error', title: 'Could not run the agent', description: errText(e) }); }
  };
  return <>
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 6 }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h2 style={{ margin: 0, font: '600 16px/1.3 var(--font-sans)' }}>Automated agents</h2>
        <span style={{ font: '400 12px/1.45 var(--font-sans)', color: 'var(--text-3)' }}>Agents that start by themselves: on a schedule, when a pull request is opened or merged, or when an issue is opened. Each run is a normal session you can follow, answer and stop. They only run while helm is open.</span>
      </div>
      <Button size="sm" variant="primary" icon="plus" onClick={() => setEditing(blank('global'))}>New agent</Button>
    </div>
    {list.length === 0 ? <div style={{ padding: '18px 0', borderTop: '1px solid var(--border-subtle)', font: '400 12.5px/1.5 var(--font-sans)', color: 'var(--text-3)' }}>No automated agents yet.</div> : null}
    {list.map((a) => (
      <div key={a.id} className="helm-setting" style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 0', borderTop: '1px solid var(--border-subtle)' }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ font: '500 13px/1.3 var(--font-sans)' }}>{a.name}</span>
          <span style={{ font: '400 12px/1.45 var(--font-sans)', color: 'var(--text-3)' }}>{describeTrigger(a.trigger)}{a.branch ? ` on ${a.branch}` : ''} · {a.scope === 'global' ? 'every repository' : a.scope}{a.lastRun ? ' · last ran ' + new Date(a.lastRun).toLocaleString() : ''}</span>
        </div>
        <Button size="sm" variant="ghost" onClick={() => void run(a)}>Run now</Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing({ ...a })}>Edit</Button>
        <Button size="sm" variant="ghost" onClick={() => void api.deleteAutomation(a.id)}>Delete</Button>
        <Switch checked={a.enabled} onChange={(v: boolean) => void api.saveAutomation({ ...a, enabled: v })} />
      </div>
    ))}
    {editing ? <Editor draft={editing} repos={app.repos.filter((r) => !r.hidden || r.id === editing.scope)} onClose={() => setEditing(null)} /> : null}
  </>;
}
