import type { Conn } from '../../hosted/web/bridge';
import { join } from '../../src/shared/p2p/link';
import type { UdpSocket } from '../../src/shared/p2p/link';
import type { KeyPair } from '../../src/shared/p2p/noise';

export interface DesktopLink {
  /** The share code, or the saved one for a desktop already paired. */
  code: string;
  identity: KeyPair;
  /** This phone's name, shown on the computer. */
  name: string;
  /** For pairing a new device only: a GitHub token for the person using this phone. */
  githubToken?: string;
}

/** Opens an encrypted link to a desktop and presents it as the connection the web bridge wants: JSON messages. */
export function connectDesktop(socket: () => UdpSocket, d: DesktopLink, hooks: { candidates?(port: number, addresses: string[]): void } = {}): () => Promise<Conn> {
  return async () => {
    const s = socket();
    let link;
    try { link = await join({ socket: s, code: d.code, identity: d.identity, name: d.name, githubToken: d.githubToken }); } catch (e) { s.close(); throw e; }
    let cb: (m: any) => void = () => undefined;
    link.onMessage((raw) => {
      let m: any;
      try { m = JSON.parse(new TextDecoder().decode(raw)); } catch { return; }
      if (m?.t === 'candidates') hooks.candidates?.(m.p, m.c);
      else if (m?.t !== 'hello') cb(m);
    });
    return {
      send: (m) => link.send(new TextEncoder().encode(JSON.stringify(m))),
      onMessage: (f) => { cb = f; },
      onClose: (f) => link.onClose(() => { s.close(); f(); }),
      close: () => link.close()
    } satisfies Conn;
  };
}
