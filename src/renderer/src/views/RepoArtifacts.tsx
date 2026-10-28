import React from 'react';
import type { RepoArtifact } from '@shared/types';
import { api } from '../api';
import { relTime } from '../lib';
import { toast } from '../store';
import { Button } from '../ui';

const errText = (e: any) => String(e?.message || e).replace(/^Error invoking remote method '\w+': Error: /, '');
const size = (n: number) => (n < 1024 ? n + ' B' : n < 1048576 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(1) + ' MB');

/** Sends files to a repository's artifacts, one at a time, in pieces. `progress` is told how far the current file is ('' when done). Returns how many were stored. */
export async function uploadRepoArtifacts(repoId: string, list: File[], progress: (s: string) => void = () => {}): Promise<number> {
  let stored = 0;
  for (const f of list) {
    try {
      // Pieces of 16 MB, so a file of any size is never held whole in the browser or in one message. An interrupted upload of the same file carries on where it stopped.
      const PIECE = 16 * 1024 * 1024;
      const fp = `${f.size}:${f.lastModified}`;
      const kept = await api.repoArtifactProgress(repoId, f.name, fp).catch(() => 0);
      const from = kept < f.size ? kept : 0;
      for (let at = from % PIECE === 0 ? from : 0; at === 0 || at < f.size; at += PIECE) {
        const bytes = new Uint8Array(await f.slice(at, at + PIECE).arrayBuffer());
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        await api.addRepoArtifactChunk(repoId, f.name, at, btoa(bin), at + PIECE >= f.size, fp);
        progress(f.size ? `${f.name} ${Math.min(100, Math.round(((at + PIECE) / f.size) * 100))}%` : '');
      }
      stored++;
    } catch (e) { toast({ tone: 'error', title: 'Could not upload artifact ' + f.name, description: errText(e) }); }
  }
  progress('');
  return stored;
}

/** Files uploaded to a repository: copied into every session's worktree and kept out of git (secrets, data, notes that are not committed). Files can be dropped anywhere on the tab. */
export function RepoArtifacts({ repoId }: { repoId: string }) {
  const [files, setFiles] = React.useState<RepoArtifact[] | null>(null);
  const [sending, setSending] = React.useState('');
  const [over, setOver] = React.useState(false);
  const pick = React.useRef<HTMLInputElement>(null);
  const load = React.useCallback(() => { api.listRepoArtifacts(repoId).then(setFiles).catch(() => setFiles([])); }, [repoId]);
  React.useEffect(load, [load]);
  const upload = async (list: File[]) => {
    await uploadRepoArtifacts(repoId, list, setSending);
    if (pick.current) pick.current.value = '';
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
      <Button size="sm" icon="upload-simple" disabled={!!sending} onClick={() => pick.current?.click()}>{sending ? 'Uploading ' + sending : 'Upload artifacts…'}</Button>
      {over ? <div style={{ font: '500 12.5px/1.5 var(--font-sans)', color: 'var(--accent-text)' }}>Drop to upload</div> : null}
      <div style={{ alignSelf: 'stretch', maxWidth: 640 }}>
        {files == null ? null : files.length === 0 ? <div style={{ font: '400 12.5px/1.5 var(--font-sans)', color: 'var(--text-3)' }}>No artifacts yet.</div> : files.map((f) => (
          <div key={f.name} style={{ display: 'flex', gap: 12, alignItems: 'center', minHeight: 38, borderTop: '1px solid var(--border-subtle)', font: '400 12.5px/1.5 var(--font-mono)' }}>
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.name}>{f.name}</span>
            <span style={{ color: 'var(--text-3)' }}>{size(f.size)} · {relTime(f.modified)}</span>
            <Button size="sm" onClick={() => void api.removeRepoArtifact(repoId, f.name).then(load)}>Remove</Button>
          </div>
        ))}
      </div>
    </div>
  );
}
