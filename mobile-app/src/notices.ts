import type { Notice } from '../../src/core/p2p/service';
import { connectDesktop } from './p2pConn';
import type { DesktopLink } from './p2pConn';
import type { UdpSocket } from '../../src/shared/p2p/link';
import type { Storage } from './instances';

export type { Notice };

/** Puts a notification on the phone's screen: a Capacitor local notification in the app. */
export type Show = (n: Notice & { instanceName: string }) => Promise<void>;

const SEEN = 'helm.seenNotices';

/**
 * Notifications with the app closed, without a push service. A desktop keeps what a paired phone has not collected; the phone's background
 * task (iOS background app refresh, Android WorkManager: the OS decides when, usually every 15 minutes or more, and not at all if the app
 * is never opened) calls this, which connects to each computer for a moment, shows what is waiting as local notifications, tells the
 * computer so, and leaves. While the app is open a computer sends them as they happen.
 */
export async function collect(
  computers: { name: string; link: DesktopLink }[],
  socket: () => UdpSocket,
  show: Show,
  storage: Storage,
  settleMs = 2000
): Promise<number> {
  const seen = new Set<string>(JSON.parse((await storage.get(SEEN)) || '[]'));
  let shown = 0;
  await Promise.all(computers.map(async (c) => {
    try {
      const conn = await connectDesktop(socket, c.link, {
        notices: async (items, ack) => {
          // A notice can arrive twice (the ack was lost): show it once.
          for (const n of items) if (!seen.has(n.id)) { seen.add(n.id); await show({ ...n, instanceName: c.name }).catch(() => undefined); shown++; }
          ack(items.map((n) => n.id));
        }
      })();
      await new Promise((r) => setTimeout(r, settleMs));
      conn.close();
    } catch { /* the computer is not reachable from here right now: try again next time */ }
  }));
  await storage.set(SEEN, JSON.stringify([...seen].slice(-500)));
  return shown;
}
