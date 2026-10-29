import React from 'react';
import type { RepoFixture } from '@shared/types';
import { api } from '../api';
import { relTime } from '../lib';
import { getUI, toast, uploadDone, uploadProgress, uploadStart, useUI } from '../store';
import { Button } from '../ui';
import { percent } from '../uploads';

const errText = (e: any) => String(e?.message || e).replace(/^Error invoking remote method '\w+': Error: /, '');
const size = (n: number) => (n < 1024 ? n + ' B' : n < 1048576 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(1) + ' MB');

/** Sends files to a repository's fixtures, one at a time, in pieces. Progress is kept in the store, so it survives leaving the view. Returns how many were stored. */
export async function uploadRepoFixtures(repoId: string, list: File[]): Promise<number> {
  let stored = 0;
  // All files are listed up front, so a second batch started meanwhile sees them, and the same file is never sent twice at once.
  const fresh = list.filter((f) => !getUI().uploads.some((x) => x.repoId === repoId && x.name === f.name));
  if (fresh.length < list.length) toast({ tone: 'neutral', title: 'Already uploading', description: list.filter((f) => !fresh.includes(f)).map((f) => f.name).join(', ') });
  const keys = fresh.map((f) => uploadStart(repoId, f.name, f.size));
  for (const [n, f] of fresh.entries()) {
    try {
      // Pieces of 16 MB, so a file of any size is never held whole in the browser or in one message. An interrupted upload of the same file carries on where it stopped.
      const PIECE = 16 * 1024 * 1024;
      const fp = `${f.size}:${f.lastModified}`;
      const kept = await api.repoFixtureProgress(repoId, f.name, fp).catch(() => 0);
      const from = kept < f.size ? kept : 0;
      for (let at = from % PIECE === 0 ? from : 0; at === 0 || at < f.size; at += PIECE) {
        const bytes = new Uint8Array(await f.slice(at, at + PIECE).arrayBuffer());
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        await api.addRepoFixtureChunk(repoId, f.name, at, btoa(bin), at + PIECE >= f.size, fp);
        uploadProgress(keys[n], Math.min(f.size, at + PIECE));
      }
      stored++;
    } catch (e) { toast({ tone: 'error', title: 'Could not upload fixture ' + f.name, description: errText(e) }); }
    finally { uploadDone(keys[n]); }
  }
  return stored;
}

/** One fixture; a folder opens to show what is in it (loaded when first opened), and its folders open the same way. */
function FixtureRow({ f, path, depth, actions, list }: { f: RepoFixture; path: string; depth: number; actions?: React.ReactNode; list: (path: string) => Promise<RepoFixture[]> }) {
  const [open, setOpen] = React.useState(false);
  const [kids, setKids] = React.useState<RepoFixture[] | null>(null);
  const toggle = () => {
    if (!open && kids == null) list(path).then(setKids, () => setKids([]));
    setOpen(!open);
  };
  return (
    <>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', minHeight: 38, paddingLeft: depth * 18, borderTop: '1px solid var(--border-subtle)', font: '400 12.5px/1.5 var(--font-mono)' }}>
        {f.dir
          ? <i className={'ph ph-caret-' + (open ? 'down' : 'right')} role="button" aria-label={open ? 'Collapse' : 'Expand'} onClick={toggle} style={{ cursor: 'pointer', fontSize: 12, color: 'var(--text-3)', width: 14 }} />
          : <span style={{ width: 14 }} />}
        <i className={'ph ' + (f.dir ? (open ? 'ph-folder-open' : 'ph-folder') : 'ph-file')} style={{ color: 'var(--text-3)' }} />
        <span onClick={f.dir ? toggle : undefined} style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: f.dir ? 'pointer' : undefined }} title={f.name}>{f.name}{f.dir ? '/' : ''}</span>
        <span style={{ color: 'var(--text-3)' }}>{size(f.size)} · {relTime(f.modified)}</span>
        {actions}
      </div>
      {open ? (kids == null ? <div style={{ paddingLeft: (depth + 1) * 18 + 22, minHeight: 28, color: 'var(--text-3)', font: '400 12px/28px var(--font-sans)' }}>Loading…</div>
        : kids.length === 0 ? <div style={{ paddingLeft: (depth + 1) * 18 + 22, minHeight: 28, color: 'var(--text-3)', font: '400 12px/28px var(--font-sans)' }}>Empty</div>
        : kids.map((k) => <FixtureRow key={k.name} f={k} path={path + '/' + k.name} depth={depth + 1} list={list} />)) : null}
    </>
  );
}

/** Files uploaded to a repository: copied into every session's worktree and kept out of git (secrets, data, notes that are not committed). Files can be dropped anywhere on the tab. */
export function RepoFixtures({ repoId }: { repoId: string }) {
  const [files, setFiles] = React.useState<RepoFixture[] | null>(null);
  const uploads = useUI((u) => u.uploads);
  const active = React.useMemo(() => uploads.filter((x) => x.repoId === repoId), [uploads, repoId]);
  const sending = active.length ? active.map((x) => `${x.name} ${percent(x)}%`).join(', ') : '';
  const [over, setOver] = React.useState(false);
  const [busy, setBusy] = React.useState('');
  const unzip = async (name: string) => {
    setBusy('unzip:' + name);
    try { await api.unzipRepoFixture(repoId, name); } catch (e) { toast({ tone: 'error', title: 'Could not unzip ' + name, description: errText(e) }); }
    setBusy('');
    load();
  };
  /** Runs a slow change on one fixture, showing what is going on while it does, then refreshes the list. */
  const work = async (key: string, job: Promise<unknown>, failure: string) => {
    setBusy(key);
    try { await job; } catch (e) { toast({ tone: 'error', title: failure, description: errText(e) }); }
    setBusy('');
    load();
  };
  const pick = React.useRef<HTMLInputElement>(null);
  const load = React.useCallback(() => { api.listRepoFixtures(repoId).then(setFiles).catch(() => setFiles([])); }, [repoId]);
  React.useEffect(load, [load]);
  // Uploads started before navigating here finish while this is open: refresh the list when the last one is done.
  const uploading = active.length > 0;
  const was = React.useRef(uploading);
  React.useEffect(() => { if (was.current && !uploading) load(); was.current = uploading; }, [uploading, load]);
  const upload = async (list: File[]) => {
    if (pick.current) pick.current.value = '';
    await uploadRepoFixtures(repoId, list);
    load();
  };
  return (
    <div
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false); }}
      onDrop={(e) => { setOver(false); if (e.dataTransfer.files.length) { e.preventDefault(); if (!sending) void upload([...e.dataTransfer.files]); } }}
      style={{ flex: 1, overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start', boxShadow: over ? 'inset 0 0 0 2px var(--accent)' : undefined }}>
      <div style={{ font: '400 12.5px/1.5 var(--font-sans)', color: 'var(--text-2)', maxWidth: 640 }}>
        Files copied into every session of this repository, at the top of its worktree, and kept out of commits. Sessions already open get them when the agent next starts. Any size; large files are sent in pieces and cloned (not duplicated) into each worktree where the filesystem allows it.
      </div>
      <input ref={pick} type="file" multiple style={{ display: 'none' }} onChange={(e) => void upload([...(e.target.files || [])])} />
      <Button size="sm" icon="upload-simple" disabled={!!sending} onClick={() => pick.current?.click()}>{sending ? 'Uploading ' + sending : 'Upload fixtures…'}</Button>
      {over ? <div style={{ font: '500 12.5px/1.5 var(--font-sans)', color: 'var(--accent-text)' }}>Drop to upload</div> : null}
      <div style={{ alignSelf: 'stretch', maxWidth: 760 }}>
        {files == null ? null : files.length === 0 ? <div style={{ font: '400 12.5px/1.5 var(--font-sans)', color: 'var(--text-3)' }}>No fixtures yet.</div> : files.map((f) => (
          <FixtureRow key={f.name} f={f} path={f.name} depth={0}
            actions={<>
              {!f.dir && /\.zip$/i.test(f.name) ? <Button size="sm" disabled={busy.slice(busy.indexOf(':') + 1) === f.name && !!busy} onClick={() => void unzip(f.name)}>{busy === 'unzip:' + f.name ? 'Unzipping…' : 'Unzip'}</Button> : null}
              <Button size="sm" variant={f.shared ? 'secondary' : undefined} icon={busy === 'share:' + f.name ? 'circle-notch' : f.shared ? 'link' : undefined} disabled={busy.slice(busy.indexOf(':') + 1) === f.name && !!busy}
                title={f.shared ? 'Linked into worktrees, read-only. Click to copy instead.' : 'Link into worktrees read-only instead of copying: instant and uses no extra disk.'}
                onClick={() => void work('share:' + f.name, api.setRepoFixtureShared(repoId, f.name, !f.shared), 'Could not change ' + f.name)}>
                {busy === 'share:' + f.name ? (f.shared ? 'Unlocking…' : 'Sharing…') : f.shared ? 'Shared · read-only' : 'Share read-only'}</Button>
              <Button size="sm" disabled={busy.slice(busy.indexOf(':') + 1) === f.name && !!busy} onClick={() => void work('remove:' + f.name, api.removeRepoFixture(repoId, f.name), 'Could not remove ' + f.name)}>{busy === 'remove:' + f.name ? 'Removing…' : 'Remove'}</Button>
            </>}
            list={(path) => api.listRepoFixtureFolder(repoId, path)} />
        ))}
      </div>
    </div>
  );
}
