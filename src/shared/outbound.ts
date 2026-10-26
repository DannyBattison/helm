import type { NotifyKind } from './notify';
import { inQuietHours } from './notify';
import type { Settings } from './types';

/**
 * Outbound notifications: messages sent out of the app (email today; Slack, webhooks and the like later) rather than shown on the
 * desktop. Each destination is a *channel*. A channel has its own settings under `Settings.outbound[id]`, and the shared fields below
 * (`enabled`, `kinds`) so that deciding whether to send is the same for all of them. To add one: add its settings type here, a
 * `OutboundChannel` in `src/core/outbound.ts`, and register it there.
 */
export type ChannelId = 'email';

export interface OutboundMessage {
  kind: NotifyKind;
  title: string;
  body: string;
  sessionId: string;
  repoId: string;
}

/** What every channel's settings carry. */
export interface ChannelBase {
  enabled: boolean;
  /** Which events are sent. */
  kinds: Record<NotifyKind, boolean>;
}

export interface EmailSettings extends ChannelBase {
  /** Recipients, comma or newline separated. */
  to: string;
  /** The sender's address (the envelope sender and `From`). */
  from: string;
  /** The sender's display name. */
  fromName: string;
  host: string;
  port: number;
  /** `tls`: encrypted from the start (usually port 465). `starttls`: upgrade after connecting (587). `none`: plain, for a local relay only. */
  security: 'tls' | 'starttls' | 'none';
  /** Login for the SMTP server; empty for none. The password is kept apart, encrypted, never in settings. */
  user: string;
}

export interface OutboundSettings { email: EmailSettings }

export const defaultOutbound = (): OutboundSettings => ({
  email: {
    enabled: false,
    kinds: { attention: true, ready: false, failed: true },
    to: '', from: '', fromName: 'helm', host: '', port: 587, security: 'starttls', user: ''
  }
});

/** Settings of every channel, by id, for code that treats them alike. */
export const channelSettings = (st: Pick<Settings, 'outbound'>): Record<ChannelId, ChannelBase> => st.outbound;

/**
 * Whether to send `kind` for `repoId` through a channel. Follows the same per-repository rules and quiet hours as desktop
 * notifications; quiet hours hold back everything except a blocked agent when the user asked to hear about that.
 */
export function outboundDecision(st: Pick<Settings, 'quiet' | 'notifyRepo'>, ch: ChannelBase, kind: NotifyKind, repoId: string, at = new Date()): boolean {
  if (!ch.enabled || !ch.kinds[kind]) return false;
  const rule = st.notifyRepo[repoId] || 'all';
  if (rule === 'off' || (rule === 'attention' && kind !== 'attention')) return false;
  if (inQuietHours(st.quiet, at)) return kind === 'attention' && st.quiet.allowAttention;
  return true;
}

export const splitAddresses = (s: string): string[] => s.split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean);
const ADDRESS = /^[^\s@<>",]+@[^\s@<>",]+\.[^\s@<>",]+$/;
export const validAddress = (a: string) => ADDRESS.test(a);

/** Why an email setup cannot send, or null when it can. */
export function emailProblem(e: EmailSettings): string | null {
  if (!e.host.trim()) return 'Enter the SMTP server.';
  if (!Number.isInteger(e.port) || e.port < 1 || e.port > 65535) return 'The port must be between 1 and 65535.';
  if (!validAddress(e.from.trim())) return 'Enter a valid sender address.';
  const to = splitAddresses(e.to);
  if (!to.length) return 'Enter at least one recipient.';
  const bad = to.find((a) => !validAddress(a));
  if (bad) return `"${bad}" is not a valid address.`;
  return null;
}
