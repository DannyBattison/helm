import React from 'react';
import type { SearchHit, Session, TreeEntry } from '@shared/types';
import { api, platform } from '../api';
import { fontStack } from '../fonts';
import { langOf } from '../lib';
import { toast, useApp } from '../store';
import { Badge, Breadcrumbs, Button, Grip, Input, Kbd, SegmentedControl, Skeleton, Switch, Tabs, TreeItem, usePaneWidth } from '../ui';
import { TerminalDrawer } from './Shell';

type MonacoNS = typeof import('../monaco');
let monacoP: Promise<MonacoNS> | null = null;
const loadMonaco = () => (monacoP ||= Promise.all([import('../monaco'), document.fonts.load('400 12.5px "Monaspace Neon"').catch(() => null)]).then(([m]) => m));

const gColor: Record<string, string> = { M: 'var(--status-attention-text)', A: 'var(--diff-add-fg)', D: 'var(--diff-del-fg)' };
const mod = (e: { metaKey: boolean; ctrlKey: boolean }) => (platform() === 'darwin' ? e.metaKey : e.ctrlKey);
const MODK = () => (platform() === 'darwin' ? '⌘' : 'Ctrl');
const errText = (e: any) => String(e?.message || e).replace(/^Error invoking remote method '\w+': Error: /, '');

/** Subsequence match that prefers hits in the file name. */
function fuzzy(q: string, path: string): number {
  const query = q.toLowerCase();
  const p = path.toLowerCase();
  let last = -1, score = 0;
  for (const ch of query) {
    const j = p.indexOf(ch, last + 1);
    if (j < 0) return -1;
    score += j === last + 1 ? 3 : 1;
    last = j;
  }
  const base = p.slice(p.lastIndexOf('/') + 1);
  if (base.includes(query)) score += 20;
  if (base.startsWith(query)) score += 10;
  return score - path.length * 0.01;
}

function QuickOpen({ ws, onPick, onClose }: { ws: string; onPick(p: string): void; onClose(): void }) {
  const [files, setFiles] = React.useState<string[] | null>(null);
  const [q, setQ] = React.useState('');
  const [i, setI] = React.useState(0);
  React.useEffect(() => { api.listFiles(ws).then(setFiles).catch(() => setFiles([])); }, [ws]);
  const shown = React.useMemo(() => {
    if (!files) return [];
    if (!q.trim()) return files.slice(0, 50);
    return files.map((p) => [p, fuzzy(q, p)] as const).filter((x) => x[1] >= 0).sort((a, b) => b[1] - a[1]).slice(0, 50).map((x) => x[0]);
  }, [files, q]);
  const open = (p?: string) => { if (p) { onClose(); onPick(p); } };
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 120, background: 'var(--scrim)', display: 'flex', justifyContent: 'center', paddingTop: 90 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 560, alignSelf: 'flex-start', borderRadius: 'var(--radius-xl)', background: 'var(--bg-overlay)', boxShadow: 'var(--shadow-dialog)', overflow: 'hidden', animation: 'helm-in var(--dur-slow) var(--ease-out)' }}>
        <div style={{ padding: 10, borderBottom: '1px solid var(--border-subtle)' }}>
          <Input autoFocus mono icon="file-code" size="lg" placeholder="Go to file" value={q} onChange={(e: any) => { setQ(e.target.value); setI(0); }}
            onKeyDown={(e: any) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setI(Math.min(i + 1, shown.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setI(Math.max(i - 1, 0)); }
              else if (e.key === 'Enter') open(shown[i]);
              else if (e.key === 'Escape') onClose();
            }} />
        </div>
        <div style={{ maxHeight: 380, overflow: 'auto', padding: 6 }}>
          {files == null ? <div style={{ padding: 14, font: '400 12px/1 var(--font-sans)', color: 'var(--text-3)' }}>Listing files…</div> : null}
          {files && shown.length === 0 ? <div style={{ padding: 14, font: '400 13px/1 var(--font-sans)', color: 'var(--text-3)' }}>No file matches.</div> : null}
          {shown.map((p, n) => {
            const k = p.lastIndexOf('/');
            return (
              <div key={p} onMouseEnter={() => setI(n)} onClick={() => open(p)} style={{ display: 'flex', alignItems: 'baseline', gap: 8, height: 30, padding: '0 10px', borderRadius: 'var(--radius-md)', cursor: 'pointer', background: n === i ? 'var(--bg-selected)' : 'transparent' }}>
                <span style={{ font: '500 12.5px/30px var(--font-mono)' }}>{p.slice(k + 1)}</span>
                <span style={{ flex: 1, minWidth: 0, font: '400 11px/30px var(--font-mono)', color: 'var(--text-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{k > 0 ? p.slice(0, k) : ''}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SearchPanel({ ws, open }: { ws: string; open(path: string, line: number): void }) {
  const [q, setQ] = React.useState('');
  const [matchCase, setMatchCase] = React.useState(false);
  const [hits, setHits] = React.useState<SearchHit[] | null>(null);
  React.useEffect(() => {
    if (!q.trim()) { setHits(null); return; }
    let dead = false;
    const t = setTimeout(() => api.searchFiles(ws, q, matchCase).then((h) => !dead && setHits(h)).catch(() => !dead && setHits([])), 250);
    return () => { dead = true; clearTimeout(t); };
  }, [q, matchCase, ws]);
  const groups = new Map<string, SearchHit[]>();
  for (const h of hits || []) groups.set(h.path, [...(groups.get(h.path) || []), h]);
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '0 8px 8px', display: 'flex', gap: 6, alignItems: 'center' }}>
        <Input autoFocus mono icon="magnifying-glass" size="sm" placeholder="Search in files" value={q} onChange={(e: any) => setQ(e.target.value)} style={{ flex: 1 }} />
        <button type="button" title="Match case" onClick={() => setMatchCase(!matchCase)} style={{ width: 24, height: 24, border: 'none', borderRadius: 'var(--radius-md)', background: matchCase ? 'var(--bg-selected)' : 'transparent', color: matchCase ? 'var(--accent-text)' : 'var(--text-3)', cursor: 'pointer', font: '600 11px/1 var(--font-mono)' }}>Aa</button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '0 4px 8px' }}>
        {hits && hits.length === 0 ? <div style={{ padding: '8px 10px', font: '400 12px/1.4 var(--font-sans)', color: 'var(--text-3)' }}>No results.</div> : null}
        {hits && hits.length >= 400 ? <div style={{ padding: '4px 10px', font: '400 11px/1.4 var(--font-sans)', color: 'var(--text-3)' }}>Showing the first 400 results.</div> : null}
        {[...groups].map(([path, list]) => (
          <div key={path} style={{ marginBottom: 6 }}>
            <div style={{ padding: '4px 8px', font: '500 11.5px/1.2 var(--font-mono)', color: 'var(--text-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={path}>{path} <span style={{ color: 'var(--text-3)' }}>{list.length}</span></div>
            {list.map((h) => (
              <div key={h.line} onClick={() => open(h.path, h.line)} className="helm-row-hover" style={{ display: 'flex', gap: 8, minHeight: 22, padding: '2px 8px 2px 14px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', font: '400 11.5px/1.5 var(--font-mono)' }}>
                <span style={{ color: 'var(--text-3)', minWidth: 28, textAlign: 'right' }}>{h.line}</span>
                <span style={{ color: 'var(--text-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.text.trim()}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function Explorer({ ws, s, sig, active, open, branch }: { ws: string; s?: Session; sig: string; active: string | null; open(p: string, line?: number): void; branch: string }) {
  const [mode, setMode] = React.useState<'files' | 'search'>('files');
  const [only, setOnly] = React.useState('all');
  const [kids, setKids] = React.useState<Record<string, TreeEntry[]>>({});
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({ '': true });
  const [changed, setChanged] = React.useState<{ path: string; status: string }[]>([]);
  const [msg, setMsg] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [width, grip, resetWidth] = usePaneWidth('explorer', 260, 180, 560);

  const load = React.useCallback(async (dir: string) => {
    try { const t = await api.listTree(ws, dir); setKids((k) => ({ ...k, [dir]: t })); } catch { /* removed */ }
  }, [ws]);
  const reload = React.useCallback(() => {
    void Promise.all(Object.keys(expanded).filter((d) => expanded[d]).map(load));
    (s ? api.changes(ws).then((c) => c.files.map((f) => ({ path: f.path, status: f.status }))) : api.changedFiles(ws)).then(setChanged).catch(() => undefined);
  }, [ws, s?.id, load, expanded]);
  React.useEffect(() => { reload(); }, [sig, ws]);
  React.useEffect(() => { const f = () => reload(); window.addEventListener('focus', f); return () => window.removeEventListener('focus', f); }, [reload]);

  const toggle = (e: TreeEntry) => {
    const on = !expanded[e.path];
    setExpanded((x) => ({ ...x, [e.path]: on }));
    if (on && !kids[e.path]) void load(e.path);
  };
  const rows: { e: TreeEntry; d: number }[] = [];
  const walk = (dir: string, d: number) => { for (const e of kids[dir] || []) { rows.push({ e, d }); if (e.dir && expanded[e.path]) walk(e.path, d + 1); } };
  walk('', 0);
  const editing = s?.status === 'working' ? s.editing?.file : undefined;

  const commit = async () => {
    setBusy(true);
    try {
      await api.commitOnly(ws, changed.map((c) => c.path), msg.trim());
      setMsg('');
      toast({ tone: 'ready', title: 'Committed', description: `${changed.length} ${changed.length === 1 ? 'file' : 'files'} on ${branch}` });
      reload();
    } catch (e) { toast({ tone: 'error', title: 'Commit failed', description: errText(e) }); } finally { setBusy(false); }
  };

  return (
    <div style={{ position: 'relative', width, flex: 'none', display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border)', background: 'var(--bg-sidebar)' }}>
      <Grip onMouseDown={grip} onDoubleClick={resetWidth} />
      <div style={{ minHeight: 34, flex: 'none', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px 6px', padding: '5px 8px 5px 12px' }}>
        <SegmentedControl size="sm" value={mode} onChange={(v: string) => setMode(v as any)} options={[{ value: 'files', label: 'Files', icon: 'folder-simple' }, { value: 'search', label: 'Search', icon: 'magnifying-glass' }]} />
        <span style={{ flex: 1 }} />
        {mode === 'files' ? <SegmentedControl size="sm" value={only} onChange={setOnly} options={[{ value: 'all', label: 'All' }, { value: 'changed', label: 'Changed', count: changed.length }]} /> : null}
      </div>
      {mode === 'search' ? <SearchPanel ws={ws} open={open} /> : (
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '0 4px 8px' }}>
          {only === 'changed' ? changed.map((c) => (
            <TreeItem key={c.path} mono icon="file-code" selected={active === c.path} label={c.path} onClick={() => open(c.path)}
              trailing={<span style={{ font: '500 11px/1 var(--font-mono)', color: gColor[c.status], width: 10, textAlign: 'center' }}>{c.status}</span>} />
          )) : !kids[''] ? [60, 40, 70, 50, 65, 45, 55].map((w, i) => <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, height: 26, padding: '0 8px 0 ' + (20 + (i % 3 === 1 ? 14 : 0)) + 'px' }}><Skeleton w={13} h={13} r={3} /><Skeleton w={w + '%'} h={9} /></div>) : rows.map(({ e, d }) => (
            <TreeItem key={e.path} depth={d} mono selected={active === e.path} icon={e.dir ? (expanded[e.path] ? 'folder-open' : 'folder-simple') : 'file-code'}
              expandable={e.dir} expanded={!!expanded[e.path]} label={e.name} onClick={() => (e.dir ? toggle(e) : open(e.path))}
              trailing={<span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {editing === e.path ? <i className="ph ph-robot" title={`${s?.id} is editing`} style={{ fontSize: 12, color: 'var(--status-working-text)' }} /> : null}
                {e.git ? <span style={{ font: '500 11px/1 var(--font-mono)', color: gColor[e.git], width: 10, textAlign: 'center' }}>{e.dir ? '•' : e.git}</span> : null}
              </span>} />
          ))}
          {only === 'changed' && changed.length === 0 ? <div style={{ padding: '8px 10px', font: '400 12px/1.4 var(--font-sans)', color: 'var(--text-3)' }}>No changes here.</div> : null}
        </div>
      )}
      {!s && changed.length > 0 ? (
        <div style={{ flex: 'none', borderTop: '1px solid var(--border-subtle)', padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Input mono size="sm" placeholder="Commit message" value={msg} onChange={(e: any) => setMsg(e.target.value)} onKeyDown={(e: any) => { if (e.key === 'Enter' && msg.trim() && !busy) void commit(); }} />
          <Button size="sm" variant="primary" icon="git-commit" loading={busy} disabled={!msg.trim()} onClick={commit}>Commit {changed.length} {changed.length === 1 ? 'file' : 'files'}</Button>
        </div>
      ) : null}
      <div style={{ flex: 'none', borderTop: '1px solid var(--border-subtle)', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 6, font: '400 11px/1.3 var(--font-mono)', color: 'var(--text-3)' }}>
        <i className={'ph ph-' + (s ? 'tree-structure' : 'git-branch')} style={{ fontSize: 12 }} /><span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s ? 'worktree · ' : ''}{branch}</span>
      </div>
    </div>
  );
}

/**
 * Browse and edit a workspace: a session's worktree or the repository's own checkout.
 * Cmd/Ctrl+S saves, Cmd/Ctrl+P opens a file, the Search tab searches every file, Diff shows your edits against the base.
 */
export function CodeView({ wsId, session: s, themeKey, branch }: { wsId: string; session?: Session; themeKey: 'dark' | 'light'; branch: string }) {
  const app = useApp();
  const host = React.useRef<HTMLDivElement>(null);
  const diffHost = React.useRef<HTMLDivElement>(null);
  const editor = React.useRef<any>(null);
  const diffEd = React.useRef<any>(null);
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
  const [follow, setFollow] = React.useState(!!s);
  const [blame, setBlame] = React.useState(false);
  const [diff, setDiff] = React.useState(false);
  const [term, setTerm] = React.useState(true);
  const [quick, setQuick] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const [binary, setBinary] = React.useState(false);
  const [ready, setReady] = React.useState(false);
  const [tick, setTick] = React.useState(0);
  const activeRef = React.useRef<string | null>(null);
  activeRef.current = active;
  const saveRef = React.useRef<() => void>(() => undefined);
  const quickRef = React.useRef<() => void>(() => undefined);
  quickRef.current = () => setQuick(true);

  const refreshGutter = React.useCallback(async (path: string) => {
    const m = M.current?.monaco;
    if (!m || !editor.current) return;
    try {
      const g = await api.fileGitLines(wsId, path);
      if (activeRef.current !== path) return;
      const mk = (lines: number[], cls: string) => lines.map((l) => ({ range: new m.Range(l, 1, l, 1), options: { isWholeLine: true, linesDecorationsClassName: cls } }));
      decos.current?.clear();
      decos.current = editor.current.createDecorationsCollection([...mk(g.added, 'helm-gutter-add'), ...mk(g.modified, 'helm-gutter-mod')]);
    } catch { /* untracked or removed */ }
  }, [wsId]);

  const markAgentLine = React.useCallback((path: string) => {
    const m = M.current?.monaco;
    if (!m || !editor.current) return;
    agentDeco.current?.clear();
    agentDeco.current = null;
    if (s?.status === 'working' && s.editing?.file === path) {
      const line = Math.min(s.editing.line, editor.current.getModel()?.getLineCount() || 1);
      agentDeco.current = editor.current.createDecorationsCollection([{ range: new m.Range(line, 1, line, 1), options: { isWholeLine: true, className: 'helm-agent-line' } }]);
    }
  }, [s?.status, s?.editing?.file, s?.editing?.line]);

  const openFile = React.useCallback(async (path: string, line?: number) => {
    setTabs((t) => (t.includes(path) ? t : [...t, path]));
    activeRef.current = path;
    setActive(path);
    const m = M.current?.monaco;
    if (!m || !editor.current) return;
    let model = models.current.get(path);
    if (!model) {
      const f = await api.readFile(wsId, path);
      if (f.binary) { setBinary(true); return; }
      model = m.editor.createModel(f.text, langOf(path), m.Uri.parse(`helm://${encodeURIComponent(wsId)}/${path}`));
      models.current.set(path, model);
      saved.current.set(path, f.text);
      model.onDidChangeContent(() => setDirty((d) => ({ ...d, [path]: model.getValue() !== saved.current.get(path) })));
    }
    setBinary(false);
    editor.current.setModel(model);
    if (line) { editor.current.revealLineInCenter(line); editor.current.setPosition({ lineNumber: line, column: 1 }); editor.current.focus(); }
    void refreshGutter(path);
    markAgentLine(path);
  }, [wsId, refreshGutter, markAgentLine]);

  const save = React.useCallback(async () => {
    const path = activeRef.current;
    const model = path && models.current.get(path);
    if (!path || !model) return;
    try {
      const text = model.getValue();
      await api.writeFile(wsId, path, text);
      saved.current.set(path, text);
      setDirty((d) => ({ ...d, [path]: false }));
      setTick((n) => n + 1);
      void refreshGutter(path);
    } catch (e) { toast({ tone: 'error', title: 'Could not save ' + path, description: errText(e) }); }
  }, [wsId, refreshGutter]);
  saveRef.current = () => void save();

  // editor lifecycle
  React.useEffect(() => {
    let dead = false;
    loadMonaco().then(async (mod) => {
      await document.fonts.load(`12.5px "${app.settings.editorFont}"`).catch(() => null);
      if (dead || !host.current) return;
      M.current = mod;
      const m = mod.monaco;
      editor.current = m.editor.create(host.current, {
        model: null, theme: mod.themeName(themeKey), fontFamily: fontStack(app.settings.editorFont), fontSize: app.settings.editorFontSize, lineHeight: 20, fontLigatures: app.settings.editorLigatures,
        minimap: { enabled: true, renderCharacters: false, scale: 1 }, scrollBeyondLastLine: false, automaticLayout: true, padding: { top: 8 }, renderLineHighlight: 'line',
        overviewRulerBorder: false, hideCursorInOverviewRuler: true, guides: { indentation: true }, stickyScroll: { enabled: true }, smoothScrolling: true, lineNumbersMinChars: 4
      });
      editor.current.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.KeyS, () => saveRef.current());
      editor.current.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.KeyP, () => quickRef.current());
      editor.current.onDidChangeCursorPosition((e: any) => {
        const bd = blameData.current;
        blameDeco.current?.clear();
        if (!bd) return;
        const b = bd.get(e.position.lineNumber);
        if (b) blameDeco.current = editor.current.createDecorationsCollection([{ range: new m.Range(e.position.lineNumber, 1, e.position.lineNumber, 1), options: { after: { content: `   ${b.who} · ${b.hash}`, inlineClassName: 'helm-blame' } } }]);
      });
      setReady(true);
    }).catch(() => setFailed(true));
    return () => { dead = true; diffEd.current?.dispose(); editor.current?.dispose(); editor.current = null; models.current.forEach((x) => x.dispose()); models.current.clear(); };
  }, [wsId]);

  React.useEffect(() => { if (M.current) M.current.monaco.editor.setTheme(M.current.themeName(themeKey)); }, [themeKey, ready]);
  React.useEffect(() => {
    const o = { fontSize: app.settings.editorFontSize, fontFamily: fontStack(app.settings.editorFont), fontLigatures: app.settings.editorLigatures };
    document.fonts.load(`12.5px "${app.settings.editorFont}"`).catch(() => null).then(() => {
      editor.current?.updateOptions(o);
      diffEd.current?.updateOptions(o);
      M.current?.monaco.editor.remeasureFonts();
    });
  }, [app.settings.editorFontSize, app.settings.editorFont, app.settings.editorLigatures, ready]);

  // coming back to the window picks up changes made elsewhere, such as in another editor
  React.useEffect(() => { const f = () => setTick((n) => n + 1); window.addEventListener('focus', f); return () => window.removeEventListener('focus', f); }, []);

  // follow the agent, and pick up edits made to files that are open and clean
  const editSig = `${s?.editing?.file}:${s?.editing?.line}:${s ? Object.entries(s.filesTouched).map(([k, v]) => k + v.add + v.del).join(',') : tick}`;
  React.useEffect(() => {
    if (!ready) return;
    void (async () => {
      for (const [path, model] of models.current) {
        if (dirty[path]) continue;
        try {
          const f = await api.readFile(wsId, path);
          if (!f.binary && f.text !== model.getValue()) { model.setValue(f.text); saved.current.set(path, f.text); setDirty((d) => ({ ...d, [path]: false })); }
        } catch { /* deleted */ }
      }
      if (follow && s?.status === 'working' && s.editing) await openFile(s.editing.file, s.editing.line);
      else if (activeRef.current) { markAgentLine(activeRef.current); void refreshGutter(activeRef.current); }
    })();
  }, [editSig, ready, follow]);

  React.useEffect(() => {
    if (!blame || !active) { blameData.current = null; blameDeco.current?.clear(); return; }
    api.fileBlame(wsId, active).then((b) => { blameData.current = new Map(b.map((x) => [x.line, x])); editor.current?.setPosition(editor.current.getPosition()); });
  }, [blame, active]);

  // inline diff: your working copy on the right is still editable
  React.useEffect(() => {
    const m = M.current?.monaco;
    if (!diff || !active || !m || !diffHost.current) return;
    const model = models.current.get(active);
    if (!model) return;
    let dead = false;
    let orig: any = null;
    api.readBase(wsId, active).then((base) => {
      if (dead || !diffHost.current) return;
      orig = m.editor.createModel(base, langOf(active));
      diffEd.current = m.editor.createDiffEditor(diffHost.current, {
        theme: M.current!.themeName(themeKey), fontFamily: fontStack(app.settings.editorFont), fontLigatures: app.settings.editorLigatures, fontSize: app.settings.editorFontSize, lineHeight: 20, automaticLayout: true, renderSideBySide: true,
        originalEditable: false, scrollBeyondLastLine: false, padding: { top: 8 }, overviewRulerBorder: false, lineNumbersMinChars: 4
      });
      diffEd.current.setModel({ original: orig, modified: model });
      diffEd.current.getModifiedEditor().addCommand(m.KeyMod.CtrlCmd | m.KeyCode.KeyS, () => saveRef.current());
    });
    return () => { dead = true; diffEd.current?.dispose(); diffEd.current = null; orig?.dispose(); };
  }, [diff, active, themeKey]);

  const closeTab = (path: string) => {
    const left = tabs.filter((t) => t !== path);
    setTabs(left);
    models.current.get(path)?.dispose();
    models.current.delete(path);
    if (active === path) { const next = left[left.length - 1] || null; setActive(next); if (next) void openFile(next); else editor.current?.setModel(null); }
  };

  const sig = s ? Object.keys(s.filesTouched).join('|') + s.files : String(tick);
  const crumbs = active ? active.split('/') : [];
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex' }}
      onKeyDown={(e) => {
        if (mod(e) && e.key.toLowerCase() === 'p') { e.preventDefault(); setQuick(true); }
        else if (mod(e) && e.key.toLowerCase() === 's') { e.preventDefault(); saveRef.current(); }
      }}>
      <Explorer ws={wsId} s={s} sig={sig} active={active} open={(p, l) => void openFile(p, l)} branch={branch} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg-editor)' }}>
        <style>{`.helm-blame{color:var(--text-disabled);font-style:italic}`}</style>
        {tabs.length ? (
          <Tabs variant="editor" closable onClose={closeTab} value={active || undefined} onChange={(p: string) => void openFile(p)} style={{ background: 'var(--bg-panel)', flex: 'none' }}
            tabs={tabs.map((p) => ({ value: p, label: p.split('/').pop(), icon: 'file-code', dirty: dirty[p] }))} />
        ) : <div style={{ height: 34, flex: 'none', background: 'var(--bg-panel)', borderBottom: '1px solid var(--border)' }} />}
        <div style={{ height: 30, flex: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '0 10px 0 16px', borderBottom: '1px solid var(--border-subtle)' }}>
          <Breadcrumbs mono items={crumbs} style={{ flex: 1 }} />
          {s?.status === 'working' && s.editing ? <Badge tone="working" dot>{s.id} is editing line {s.editing.line}</Badge> : null}
          {active && dirty[active] ? <Button size="sm" variant="secondary" icon="floppy-disk" kbd={MODK() + (platform() === 'darwin' ? '' : '+') + 'S'} onClick={save}>Save</Button> : null}
          <Button size="sm" variant="ghost" icon="file-magnifying-glass" kbd={MODK() + (platform() === 'darwin' ? '' : '+') + 'P'} onClick={() => setQuick(true)}>Open</Button>
          {s ? <Switch checked={follow} onChange={setFollow} label={<span style={{ fontSize: 12, color: 'var(--text-2)' }}>Follow agent</span>} /> : null}
          <Button size="sm" variant={diff ? 'secondary' : 'ghost'} icon="git-diff" disabled={!active} onClick={() => setDiff(!diff)}>Diff</Button>
          <Button size="sm" variant={blame ? 'secondary' : 'ghost'} icon="user-list" onClick={() => setBlame(!blame)}>Blame</Button>
        </div>
        <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
          {failed ? <div style={{ padding: 20, font: '400 13px/1.5 var(--font-sans)', color: 'var(--status-error-text)' }}>The editor failed to load.</div> : <div ref={host} style={{ position: 'absolute', inset: 0 }} />}
          {diff && active ? <div ref={diffHost} style={{ position: 'absolute', inset: 0, background: 'var(--bg-editor)' }} /> : null}
          {!active ? (
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'var(--bg-editor)' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center', font: '400 13px/1.5 var(--font-sans)', color: 'var(--text-3)' }}>
                <span>{s ? "Pick a file in the explorer. Saving writes to this session's worktree." : 'Pick a file in the explorer. Saving writes to your checkout.'}</span>
                <span style={{ display: 'flex', gap: 14, fontSize: 12 }}>
                  <span><Kbd keys={[MODK(), 'P']} /> open a file</span>
                  <span><Kbd keys={[MODK(), 'S']} /> save</span>
                </span>
              </div>
            </div>
          ) : null}
          {binary ? <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'var(--bg-editor)', font: '400 13px/1.5 var(--font-sans)', color: 'var(--text-3)' }}>Binary or very large file. Open it in your editor instead.</div> : null}
        </div>
        {term ? <TerminalDrawer height={210} sessionId={wsId} themeKey={themeKey} onClose={() => setTerm(false)} /> : (
          <div style={{ height: 26, flex: 'none', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', padding: '0 12px' }}>
            <Button size="sm" variant="ghost" icon="terminal-window" onClick={() => setTerm(true)}>Terminal</Button>
          </div>
        )}
      </div>
      {quick ? <QuickOpen ws={wsId} onPick={(p) => void openFile(p)} onClose={() => setQuick(false)} /> : null}
    </div>
  );
}
