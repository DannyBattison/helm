import { inbox, type InboxKind } from './inbox';
import { sessionTitle, type Session } from './types';

export type TrayAction =
  | { do: 'approve' | 'always' | 'deny' | 'continue' | 'open' | 'resume' | 'start' }
  | { do: 'answer'; option: number };

export interface TrayEntry {
  sessionId: string;
  askId?: string;
  label: string;
  kind: InboxKind;
  actions: { label: string; action: TrayAction }[];
}

const WORD: Record<InboxKind, string> = { approve: 'approval', question: 'question', budget: 'limit reached', error: 'failed', stuck: 'looks stuck', ready: 'ready for review', queued: 'queued' };
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/** What the tray menu lists: things waiting on you, each with the actions that can be taken from the menu. Queued and stuck sessions are left to the Inbox. */
export function trayEntries(sessions: Session[], max = 8): { entries: TrayEntry[]; total: number } {
  const items = inbox(sessions).filter((i) => i.kind !== 'queued' && i.kind !== 'stuck');
  const entries = items.slice(0, max).map(({ session: s, kind }): TrayEntry => {
    const open = { label: 'Open session', action: { do: 'open' } as TrayAction };
    const a = s.ask;
    const actions: TrayEntry['actions'] = [];
    if (kind === 'approve') {
      actions.push({ label: 'Approve once', action: { do: 'approve' } });
      if (a?.pattern) actions.push({ label: `Always allow ${a.pattern}`, action: { do: 'always' } });
      actions.push({ label: 'Deny', action: { do: 'deny' } });
    } else if (kind === 'question' && a?.questions?.length === 1) {
      a.questions[0].options.slice(0, 6).forEach((o, i) => actions.push({ label: clip(o.label, 48), action: { do: 'answer', option: i } }));
    } else if (kind === 'budget') actions.push({ label: a?.scope === 'plan' ? 'Continue anyway' : 'Add to the budget and resume', action: { do: 'continue' } });
    else if (kind === 'error') actions.push({ label: 'Resume', action: { do: 'resume' } });
    actions.push(open);
    return { sessionId: s.id, askId: a?.id, kind, label: `${clip(sessionTitle(s), 40)} · ${WORD[kind]}`, actions };
  });
  return { entries, total: items.length };
}
