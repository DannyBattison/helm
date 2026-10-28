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

/** Files uploaded to a repository: copied into every session's worktree and kept out of git (secrets, data, notes that are not committed). Files can be dropped anywhere on the tab. */
export function RepoFixtures({ repoId }: { repoId: string }) {
  const [files, setFiles] = React.useState<RepoFixture[] | null>(null);
  const active = useUI((u) => u.uploads.filter((x) => x.repoId === repoId));
  const sending = active.length ? active.map((x) => `${x.name} ${percent(x)}%`).join(', ') : '';
  const [over, setOver] = React.useState(false);
  const [busy, setBusy] = React.useState('');
  const unzip = async (name: string) => {
    setBusy(name);
    try { await api.unzipRepoFixture(repoId, name); } catch (e) { toast({ tone: 'error', title: 'Could not unzip ' + name, description: errText(e) }); }
    setBusy('');
    load();
  };
  const pick = React.useRef<HTMLInputElement>(null);
  const load = React.useCallback(() => { api.listRepoFixtures(repoId).then(setFiles).catch(() => setFiles([])); }, [repoId]);
  React.useEffect(load, [load]);
  // Uploads started before navigating here finish while this is open: refresh the list when the last one is done.
  const busy = active.length > 0;
  const was = React.useRef(busy);
  React.useEffect(() => { if (was.current && !busy) load(); was.current = busy; }, [busy, load]);
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
          <div key={f.name} style={{ display: 'flex', gap: 8, alignItems: 'center', minHeight: 38, borderTop: '1px solid var(--border-subtle)', font: '400 12.5px/1.5 var(--font-mono)' }}>
            {f.dir ? <i className="ph ph-folder" style={{ color: 'var(--text-3)' }} /> : null}
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.name}>{f.name}{f.dir ? '/' : ''}</span>
            <span style={{ color: 'var(--text-3)' }}>{size(f.size)} · {relTime(f.modified)}</span>
            {!f.dir && /\.zip$/i.test(f.name) ? <Button size="sm" disabled={busy === f.name} onClick={() => void unzip(f.name)}>{busy === f.name ? 'Unzipping…' : 'Unzip'}</Button> : null}
            <Button size="sm" variant={f.shared ? 'secondary' : undefined} icon={f.shared ? 'link' : undefined} title={f.shared ? 'Linked into worktrees, read-only. Click to copy instead.' : 'Link into worktrees read-only instead of copying: instant and uses no extra disk.'}
              onClick={() => void api.setRepoFixtureShared(repoId, f.name, !f.shared).then(load, (e) => toast({ tone: 'error', title: 'Could not change ' + f.name, description: errText(e) }))}>{f.shared ? 'Shared · read-only' : 'Share read-only'}</Button>
            <Button size="sm" onClick={() => void api.removeRepoFixture(repoId, f.name).then(load)}>Remove</Button>
          </div>
        ))}
      </div>
    </div>
  );
}
