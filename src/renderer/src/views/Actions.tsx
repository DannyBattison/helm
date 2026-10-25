import React from 'react';
import type { Workflow, WorkflowRun } from '@shared/types';
import { prepareInputs, runState } from '@shared/workflows';
import { api } from '../api';
import { relTime } from '../lib';
import { toast, useApp } from '../store';
import { Badge, Button, Checkbox, Dialog, Input, Select } from '../ui';

const errText = (e: any) => String(e?.message || e).replace(/^Error invoking remote method '\w+': Error: /, '');

function RunDialog({ repoId, wf, branch, branches, onClose, onStarted }: { repoId: string; wf: Workflow; branch: string; branches: string[]; onClose(): void; onStarted(): void }) {
  const [ref, setRef] = React.useState(branch);
  const [values, setValues] = React.useState<Record<string, string>>(() => Object.fromEntries(wf.inputs.map((i) => [i.name, i.default])));
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState('');
  const { errors } = prepareInputs(wf.inputs, values);
  const set = (k: string, v: string) => setValues((x) => ({ ...x, [k]: v }));
  const run = async () => {
    setBusy(true); setErr('');
    try { await api.runWorkflow(repoId, wf.id, ref, values); toast({ tone: 'ready', title: `Started ${wf.name}`, description: `on ${ref}` }); onStarted(); onClose(); }
    catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  const risky = /deploy|release|publish|prod/i.test(wf.name + ' ' + Object.values(values).join(' '));
  return (
    <Dialog width={540} title={`Run ${wf.name}`} description="This starts the workflow on GitHub now, as you. It runs there, not on this computer." onClose={onClose}
      footer={<>
        <span style={{ flex: 1, font: '400 12px/1.3 var(--font-sans)', color: err ? 'var(--status-error-text)' : 'var(--text-3)' }}>{err || (risky ? 'This looks like a deploy or release. Check the branch and inputs.' : '')}</span>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" icon="play" loading={busy} disabled={Object.keys(errors).length > 0} onClick={run}>Run workflow</Button>
      </>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5, font: '500 12px/1 var(--font-sans)' }}>Branch or tag
          <Select value={ref} onChange={(e: any) => setRef(e.target.value)} options={[...new Set([ref, ...branches])]} mono icon="git-branch" />
        </label>
        {wf.inputs.map((i) => (
          <div key={i.name} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {i.type === 'boolean'
              ? <Checkbox checked={values[i.name] === 'true'} onChange={(on: boolean) => set(i.name, String(on))} label={i.name} description={i.description} />
              : <>
                <span style={{ font: '500 12px/1 var(--font-sans)' }}>{i.name}{i.required ? <span style={{ color: 'var(--status-error-text)' }}> *</span> : null}</span>
                {i.type === 'choice' ? <Select value={values[i.name]} onChange={(e: any) => set(i.name, e.target.value)} options={i.options} />
                  : <Input mono={i.type === 'number'} value={values[i.name]} onChange={(e: any) => set(i.name, e.target.value)} placeholder={i.type === 'number' ? 'A number' : undefined} />}
                {i.description ? <span style={{ font: '400 11.5px/1.4 var(--font-sans)', color: 'var(--text-3)' }}>{i.description}</span> : null}
              </>}
            {errors[i.name] ? <span style={{ font: '400 11.5px/1 var(--font-sans)', color: 'var(--status-error-text)' }}>{errors[i.name]}</span> : null}
          </div>
        ))}
        {wf.inputs.length === 0 ? <span style={{ font: '400 12.5px/1.4 var(--font-sans)', color: 'var(--text-3)' }}>This workflow takes no inputs.</span> : null}
      </div>
    </Dialog>
  );
}

/** Workflows of a repository that can be started by hand, with their latest runs. */
export function Actions({ repoId }: { repoId: string }) {
  const app = useApp();
  const repo = app.repos.find((r) => r.id === repoId)!;
  const [branches, setBranches] = React.useState<string[]>([repo.defaultBranch]);
  const [ref, setRef] = React.useState(repo.defaultBranch);
  const [list, setList] = React.useState<Workflow[] | null>(null);
  const [runs, setRuns] = React.useState<Record<number, WorkflowRun[]>>({});
  const [err, setErr] = React.useState('');
  const [running, setRunning] = React.useState<Workflow | null>(null);
  const [showOther, setShowOther] = React.useState(false);

  React.useEffect(() => { api.repoBranches(repoId).then((b) => setBranches(b.length ? b : [repo.defaultBranch])).catch(() => undefined); }, [repoId]);
  const loadRuns = React.useCallback((wfs: Workflow[]) => {
    for (const w of wfs.filter((x) => x.dispatchable)) api.workflowRuns(repoId, w.id).then((r) => setRuns((cur) => ({ ...cur, [w.id]: r }))).catch(() => undefined);
  }, [repoId]);
  const load = React.useCallback(() => {
    setList(null); setErr('');
    api.repoWorkflows(repoId, ref).then((w) => { setList(w); loadRuns(w); }).catch((e) => { setErr(errText(e)); setList([]); });
  }, [repoId, ref, loadRuns]);
  React.useEffect(load, [load]);

  // While anything is running, look again every few seconds; a fresh dispatch takes a moment to show up.
  const anyRunning = Object.values(runs).some((r) => r.some((x) => x.status !== 'completed'));
  const [bump, setBump] = React.useState(0);
  React.useEffect(() => {
    if (!list || (!anyRunning && !bump)) return;
    const t = setInterval(() => { loadRuns(list); setBump((b) => (b > 0 ? b - 1 : 0)); }, 5000);
    return () => clearInterval(t);
  }, [list, anyRunning, bump, loadRuns]);

  const manual = (list || []).filter((w) => w.dispatchable);
  const other = (list || []).filter((w) => !w.dispatchable);
  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '12px 20px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <span style={{ font: '400 12px/1.4 var(--font-sans)', color: 'var(--text-3)', flex: 1 }}>Workflows that have a <code style={{ font: 'var(--type-data)' }}>workflow_dispatch</code> trigger can be started here, for example to deploy. They run on GitHub.</span>
        <Select size="sm" icon="git-branch" mono value={ref} onChange={(e: any) => setRef(e.target.value)} options={[...new Set([ref, ...branches])]} />
        <Button size="sm" variant="ghost" icon="arrows-clockwise" onClick={load}>Refresh</Button>
      </div>
      {list == null ? <span style={{ font: '400 12.5px/1 var(--font-sans)', color: 'var(--text-3)' }}>Reading workflows…</span> : null}
      {err ? <div style={{ font: '400 12px/1.45 var(--font-sans)', color: 'var(--status-error-text)' }}>{err}</div> : null}
      {list && !err && manual.length === 0 ? <div style={{ font: '400 13px/1.5 var(--font-sans)', color: 'var(--text-3)' }}>{list.length ? `None of this repository's ${list.length} workflows can be started by hand on ${ref}. Add ` : 'This repository has no workflows on GitHub. Add '}<code style={{ font: 'var(--type-data)' }}>workflow_dispatch:</code> under <code style={{ font: 'var(--type-data)' }}>on:</code> in a workflow file to allow it.</div> : null}
      {manual.map((w) => (
        <div key={w.id} style={{ borderTop: '1px solid var(--border-subtle)', padding: '10px 4px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <i className="ph ph-lightning" style={{ fontSize: 15, color: 'var(--accent-text)' }} />
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ font: '600 13px/1.2 var(--font-sans)' }}>{w.name}</span>
              <span style={{ font: '400 11px/1.2 var(--font-mono)', color: 'var(--text-3)' }}>{w.path}{w.inputs.length ? ` · ${w.inputs.length} ${w.inputs.length === 1 ? 'input' : 'inputs'}` : ''}</span>
            </div>
            <Button size="sm" variant="ghost" iconRight="arrow-square-out" onClick={() => void api.openExternal(w.url)}>On GitHub</Button>
            <Button size="sm" variant="primary" icon="play" onClick={() => setRunning(w)}>Run…</Button>
          </div>
          {(runs[w.id] || []).slice(0, 4).map((r) => {
            const st = runState(r);
            return (
              <div key={r.id} className="helm-row-hover" onClick={() => void api.openExternal(r.url)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '3px 6px 3px 25px', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}>
                <Badge tone={st.tone as any} dot>{st.label}</Badge>
                <span style={{ flex: 1, minWidth: 0, font: '400 12px/1.2 var(--font-sans)', color: 'var(--text-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>#{r.number} · {r.title}</span>
                <span style={{ font: '400 11px/1 var(--font-mono)', color: 'var(--text-3)' }}>{r.branch} · {r.actor} · {relTime(Date.parse(r.at))}</span>
              </div>
            );
          })}
        </div>
      ))}
      {other.length ? (
        <div style={{ marginTop: 10 }}>
          <a href="#" onClick={(e) => { e.preventDefault(); setShowOther(!showOther); }} style={{ font: '400 12px/1 var(--font-sans)' }}>{showOther ? 'Hide' : 'Show'} {other.length} {other.length === 1 ? 'workflow' : 'workflows'} that cannot be started by hand</a>
          {showOther ? other.map((w) => <div key={w.id} style={{ font: '400 12px/1.6 var(--font-sans)', color: 'var(--text-3)', padding: '2px 4px' }}>{w.name} <span style={{ font: '400 11px/1 var(--font-mono)' }}>{w.path}</span></div>) : null}
        </div>
      ) : null}
      {running ? <RunDialog repoId={repoId} wf={running} branch={ref} branches={branches} onClose={() => setRunning(null)} onStarted={() => { setBump(6); setTimeout(() => list && loadRuns(list), 2500); }} /> : null}
    </div>
  );
}
