import React from 'react';
import type { Session, TreeEntry } from '@shared/types';
import { api } from '../api';
import { langOf } from '../lib';
import { go, toast, useApp } from '../store';
import { Badge, Breadcrumbs, Button, SegmentedControl, Switch, Tabs, TreeItem } from '../ui';
import { TerminalDrawer } from './Shell';

type MonacoNS = typeof import('../monaco');
let monacoP: Promise<MonacoNS> | null = null;
const loadMonaco = () => (monacoP ||= Promise.all([import('../monaco'), document.fonts.load('400 12.5px "Monaspace Neon"').catch(() => null)]).then(([m]) => m));

const gColor: Record<string, string> = { M: 'var(--status-attention-text)', A: 'var(--diff-add-fg)', D: 'var(--diff-del-fg)' };

function Explorer({ s, active, open }: { s: Session; active: string | null; open(p: string): void }) {
  const [only, setOnly] = React.useState('all');
  const [kids, setKids] = React.useState<Record<string, TreeEntry[]>>({});
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({ '': true });
  const [changed, setChanged] = React.useState<{ path: string; status: string }[]>([]);
  const sig = Object.keys(s.filesTouched).join('|') + s.files;

  const load = React.useCallback(async (dir: string) => {
    try { const t = await api.listTree(s.id, dir); setKids((k) => ({ ...k, [dir]: t })); } catch { /* removed */ }
  }, [s.id]);
  React.useEffect(() => { void Promise.all(Object.keys(expanded).filter((d) => expanded[d]).map(load)); api.changedFiles(s.id).then(setChanged).catch(() => undefined); }, [sig, s.id]);

  const toggle = (e: TreeEntry) => {
    const on = !expanded[e.path];
    setExpanded((x) => ({ ...x, [e.path]: on }));
    if (on && !kids[e.path]) void load(e.path);
  };
  const rows: { e: TreeEntry; d: number }[] = [];
  const walk = (dir: string, d: number) => { for (const e of kids[dir] || []) { rows.push({ e, d }); if (e.dir && expanded[e.path]) walk(e.path, d + 1); } };
  walk('', 0);
  const editing = s.status === 'working' ? s.editing?.file : undefined;

  return (
    <div style={{ width: 248, flex: 'none', display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border)', background: 'var(--bg-sidebar)' }}>
      <div style={{ height: 34, flex: 'none', display: 'flex', alignItems: 'center', gap: 6, padding: '0 6px 0 12px' }}>
        <span style={{ flex: 1, font: '500 10.5px/1 var(--font-sans)', letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', color: 'var(--text-3)' }}>Explorer</span>
        <SegmentedControl size="sm" value={only} onChange={setOnly} options={[{ value: 'all', label: 'All' }, { value: 'changed', label: 'Changed', count: changed.length }]} />
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '0 4px 8px' }}>
        {only === 'changed' ? changed.map((c) => (
          <TreeItem key={c.path} mono icon="file-code" selected={active === c.path} label={c.path} onClick={() => open(c.path)}
            trailing={<span style={{ font: '500 11px/1 var(--font-mono)', color: gColor[c.status], width: 10, textAlign: 'center' }}>{c.status}</span>} />
        )) : rows.map(({ e, d }) => (
          <TreeItem key={e.path} depth={d} mono selected={active === e.path} icon={e.dir ? (expanded[e.path] ? 'folder-open' : 'folder-simple') : 'file-code'}
            expandable={e.dir} expanded={!!expanded[e.path]} label={e.name} onClick={() => (e.dir ? toggle(e) : open(e.path))}
            trailing={<span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {editing === e.path ? <i className="ph ph-robot" title={`${s.id} is editing`} style={{ fontSize: 12, color: 'var(--status-working-text)' }} /> : null}
              {e.git ? <span style={{ font: '500 11px/1 var(--font-mono)', color: gColor[e.git], width: 10, textAlign: 'center' }}>{e.dir ? '•' : e.git}</span> : null}
            </span>} />
        ))}
        {only === 'changed' && changed.length === 0 ? <div style={{ padding: '8px 10px', font: '400 12px/1.4 var(--font-sans)', color: 'var(--text-3)' }}>No changes in this worktree.</div> : null}
      </div>
      <div style={{ flex: 'none', borderTop: '1px solid var(--border-subtle)', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 6, font: '400 11px/1.3 var(--font-mono)', color: 'var(--text-3)' }}>
        <i className="ph ph-tree-structure" style={{ fontSize: 12 }} />worktree · {s.branch}
      </div>
    </div>
  );
}

export function CodeView({ s, themeKey }: { s: Session; themeKey: 'dark' | 'light' }) {
  const app = useApp();
  const host = React.useRef<HTMLDivElement>(null);
  const editor = React.useRef<any>(null);
  const M = React.useRef<MonacoNS | null>(null);
  const models = React.useRef(new Map<string, any>());
  const saved = React.useRef(new Map<string, string>());
  const decos = React.useRef<any>(null);
  const agentDeco = React.useRef<any>(null);
  const blameDeco = React.useRef<any>(null);
  const blameData = React.useRef<Map<number, { hash: string; who: string }> | null>(null);

  const [tabs, setTabs] = React.useState<string[]>([]);
  const [active, setActive] = React.useState<string | null>(null);
  const [dirty, setDirty] = React.useState<Record<string, boolean>>({});
  const [follow, setFollow] = React.useState(true);
  const [blame, setBlame] = React.useState(false);
  const [term, setTerm] = React.useState(true);
  const [failed, setFailed] = React.useState(false);
  const [binary, setBinary] = React.useState(false);
  const [ready, setReady] = React.useState(false);
  const activeRef = React.useRef<string | null>(null);
  activeRef.current = active;

  const refreshGutter = React.useCallback(async (path: string) => {
    const m = M.current?.monaco;
    if (!m || !editor.current) return;
    try {
      const g = await api.fileGitLines(s.id, path);
      if (activeRef.current !== path) return;
      const mk = (lines: number[], cls: string) => lines.map((l) => ({ range: new m.Range(l, 1, l, 1), options: { isWholeLine: true, linesDecorationsClassName: cls } }));
      decos.current?.clear();
      decos.current = editor.current.createDecorationsCollection([...mk(g.added, 'helm-gutter-add'), ...mk(g.modified, 'helm-gutter-mod')]);
    } catch { /* untracked or removed */ }
  }, [s.id]);

  const markAgentLine = React.useCallback((path: string) => {
    const m = M.current?.monaco;
    if (!m || !editor.current) return;
    agentDeco.current?.clear();
    agentDeco.current = null;
    if (s.status === 'working' && s.editing?.file === path) {
      const line = Math.min(s.editing.line, editor.current.getModel()?.getLineCount() || 1);
      agentDeco.current = editor.current.createDecorationsCollection([{ range: new m.Range(line, 1, line, 1), options: { isWholeLine: true, className: 'helm-agent-line' } }]);
    }
  }, [s.status, s.editing?.file, s.editing?.line]);

  const openFile = React.useCallback(async (path: string, line?: number) => {
    setTabs((t) => (t.includes(path) ? t : [...t, path]));
    setActive(path);
    const m = M.current?.monaco;
    if (!m || !editor.current) return;
    let model = models.current.get(path);
    if (!model) {
      const f = await api.readFile(s.id, path);
      if (f.binary) { setBinary(true); return; }
      model = m.editor.createModel(f.text, langOf(path), m.Uri.parse(`helm://${s.id}/${path}`));
      models.current.set(path, model);
      saved.current.set(path, f.text);
      model.onDidChangeContent(() => setDirty((d) => ({ ...d, [path]: model.getValue() !== saved.current.get(path) })));
    }
    setBinary(false);
    editor.current.setModel(model);
    if (line) { editor.current.revealLineInCenter(line); editor.current.setPosition({ lineNumber: line, column: 1 }); }
    void refreshGutter(path);
    markAgentLine(path);
  }, [s.id, refreshGutter, markAgentLine]);

  const save = React.useCallback(async () => {
    const path = activeRef.current;
    const model = path && models.current.get(path);
    if (!path || !model) return;
    try {
      const text = model.getValue();
      await api.writeFile(s.id, path, text);
      saved.current.set(path, text);
      setDirty((d) => ({ ...d, [path]: false }));
      void refreshGutter(path);
    } catch (e: any) { toast({ tone: 'error', title: 'Could not save ' + path, description: String(e?.message || e) }); }
  }, [s.id, refreshGutter]);

  // editor lifecycle
  React.useEffect(() => {
    let dead = false;
    loadMonaco().then((mod) => {
      if (dead || !host.current) return;
      M.current = mod;
      const m = mod.monaco;
      editor.current = m.editor.create(host.current, {
        model: null, theme: mod.themeName(themeKey), fontFamily: 'Monaspace Neon', fontSize: app.settings.editorFontSize, lineHeight: 20, fontLigatures: true,
        minimap: { enabled: true, renderCharacters: false, scale: 1 }, scrollBeyondLastLine: false, automaticLayout: true, padding: { top: 8 }, renderLineHighlight: 'line',
        overviewRulerBorder: false, hideCursorInOverviewRuler: true, guides: { indentation: true }, stickyScroll: { enabled: true }, smoothScrolling: true, lineNumbersMinChars: 4
      });
      editor.current.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.KeyS, () => void save());
      editor.current.onDidChangeCursorPosition((e: any) => {
        const bd = blameData.current;
        blameDeco.current?.clear();
        if (!bd) return;
        const b = bd.get(e.position.lineNumber);
        if (b) blameDeco.current = editor.current.createDecorationsCollection([{ range: new m.Range(e.position.lineNumber, 1, e.position.lineNumber, 1), options: { after: { content: `   ${b.who} · ${b.hash}`, inlineClassName: 'helm-blame' } } }]);
      });
      setReady(true);
    }).catch(() => setFailed(true));
    return () => { dead = true; editor.current?.dispose(); editor.current = null; models.current.forEach((x) => x.dispose()); models.current.clear(); };
  }, [s.id]);

  React.useEffect(() => { if (M.current) M.current.monaco.editor.setTheme(M.current.themeName(themeKey)); }, [themeKey, ready]);
  React.useEffect(() => { editor.current?.updateOptions({ fontSize: app.settings.editorFontSize }); }, [app.settings.editorFontSize, ready]);

  // follow the agent, and pick up edits it made to files that are open and clean
  const editSig = `${s.editing?.file}:${s.editing?.line}:${Object.entries(s.filesTouched).map(([k, v]) => k + v.add + v.del).join(',')}`;
  React.useEffect(() => {
    if (!ready) return;
    void (async () => {
      for (const [path, model] of models.current) {
        if (dirty[path]) continue;
        try {
          const f = await api.readFile(s.id, path);
          if (!f.binary && f.text !== model.getValue()) { model.setValue(f.text); saved.current.set(path, f.text); setDirty((d) => ({ ...d, [path]: false })); }
        } catch { /* deleted */ }
      }
      if (follow && s.status === 'working' && s.editing) await openFile(s.editing.file, s.editing.line);
      else if (activeRef.current) { markAgentLine(activeRef.current); void refreshGutter(activeRef.current); }
    })();
  }, [editSig, ready, follow]);

  React.useEffect(() => {
    if (!blame || !active) { blameData.current = null; blameDeco.current?.clear(); return; }
    api.fileBlame(s.id, active).then((b) => { blameData.current = new Map(b.map((x) => [x.line, x])); editor.current?.setPosition(editor.current.getPosition()); });
  }, [blame, active]);

  const closeTab = (path: string) => {
    const left = tabs.filter((t) => t !== path);
    setTabs(left);
    models.current.get(path)?.dispose();
    models.current.delete(path);
    if (active === path) { const next = left[left.length - 1] || null; setActive(next); if (next) void openFile(next); else editor.current?.setModel(null); }
  };

  const crumbs = active ? active.split('/') : [];
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
      <Explorer s={s} active={active} open={(p) => void openFile(p)} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg-editor)' }}>
        <style>{`.helm-blame{color:var(--text-disabled);font-style:italic}`}</style>
        {tabs.length ? (
          <div style={{ display: 'flex', background: 'var(--bg-panel)', flex: 'none', overflow: 'hidden' }}>
            <Tabs variant="editor" closable onClose={closeTab} value={active || undefined} onChange={(p) => void openFile(p)} style={{ background: 'var(--bg-panel)', flex: 1, minWidth: 0 }}
              tabs={tabs.map((p) => ({ value: p, label: p.split('/').pop(), icon: 'file-code', dirty: dirty[p] }))} />
          </div>
        ) : <div style={{ height: 34, flex: 'none', background: 'var(--bg-panel)', borderBottom: '1px solid var(--border)' }} />}
        <div style={{ height: 30, flex: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '0 10px 0 16px', borderBottom: '1px solid var(--border-subtle)' }}>
          <Breadcrumbs mono items={crumbs} style={{ flex: 1 }} />
          {s.status === 'working' && s.editing ? <Badge tone="working" dot>{s.id} is editing line {s.editing.line}</Badge> : null}
          <Switch checked={follow} onChange={setFollow} label={<span style={{ fontSize: 12, color: 'var(--text-2)' }}>Follow agent</span>} />
          <Button size="sm" variant="ghost" icon="git-diff" onClick={() => go({ screen: 'session', id: s.id, tab: 'changes' })}>Diff</Button>
          <Button size="sm" variant={blame ? 'secondary' : 'ghost'} icon="user-list" onClick={() => setBlame(!blame)}>Blame</Button>
        </div>
        <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
          {failed ? <div style={{ padding: 20, font: '400 13px/1.5 var(--font-sans)', color: 'var(--status-error-text)' }}>The editor failed to load.</div> : <div ref={host} style={{ position: 'absolute', inset: 0 }} />}
          {!active ? (
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none', background: 'var(--bg-editor)' }}>
              <span style={{ font: '400 13px/1.5 var(--font-sans)', color: 'var(--text-3)' }}>Pick a file in the explorer. Saving writes to this session's worktree.</span>
            </div>
          ) : null}
          {binary ? <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'var(--bg-editor)', font: '400 13px/1.5 var(--font-sans)', color: 'var(--text-3)' }}>Binary or very large file. Open it in your editor instead.</div> : null}
        </div>
        {term ? <TerminalDrawer height={210} sessionId={s.id} themeKey={themeKey} onClose={() => setTerm(false)} /> : (
          <div style={{ height: 26, flex: 'none', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', padding: '0 12px' }}>
            <Button size="sm" variant="ghost" icon="terminal-window" onClick={() => setTerm(true)}>Terminal</Button>
          </div>
        )}
      </div>
    </div>
  );
}
