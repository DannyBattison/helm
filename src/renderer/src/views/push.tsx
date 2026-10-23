import React from 'react';
import type { PushTarget } from '@shared/types';
import { api } from '../api';
import { toast, useApp } from '../store';

const errText = (e: any) => String(e?.message || e).replace(/^Error invoking remote method '\w+': Error: /, '');

/**
 * What could be pushed for a repository (or all of them), kept fresh: when sessions commit, after a push, and every half minute,
 * since the checkout can change under helm.
 */
export function usePush(repoId?: string, only?: string) {
  const app = useApp();
  const [targets, setTargets] = React.useState<PushTarget[]>([]);
  const [busy, setBusy] = React.useState(false);
  const sig = app.sessions.map((s) => `${s.id}:${s.commits.length}:${s.status}`).join(',');
  const reload = React.useCallback(() => { api.pushStatus(repoId).then((l) => setTargets(only ? l.filter((t) => t.id === only) : l)).catch(() => undefined); }, [repoId, only]);
  React.useEffect(() => { reload(); const t = setInterval(reload, 30_000); return () => clearInterval(t); }, [reload, sig]);
  const ahead = targets.filter((t) => t.ahead > 0);
  const push = async () => {
    setBusy(true);
    try {
      const r = await api.push({ repoId, target: only });
      const dirty = r.uncommitted ? ` ${r.uncommitted} had uncommitted changes, which a push does not include.` : '';
      if (r.failed.length) toast({ tone: 'error', title: `Pushed ${r.pushed.length}, ${r.failed.length} failed`, description: r.failed.map((f) => `${f.id}: ${f.error}`).join('\n') + dirty });
      else toast({ tone: 'ready', title: r.pushed.length ? `Pushed ${r.pushed.join(', ')}` : 'Nothing to push', description: dirty.trim() || undefined });
    } catch (e) { toast({ tone: 'error', title: 'Push failed', description: errText(e) }); }
    setBusy(false);
    reload();
  };
  const commits = ahead.reduce((n, t) => n + t.ahead, 0);
  const tip = ahead.length
    ? ahead.map((t) => `${t.kind === 'checkout' ? 'Your checkout' : t.id} (${t.branch}): ${t.ahead} ${t.ahead === 1 ? 'commit' : 'commits'}${t.onRemote ? '' : ', branch not on GitHub yet'}`).join('\n')
    : 'Everything is on GitHub.';
  return { targets, ahead, commits, busy, push, tip, reload };
}
