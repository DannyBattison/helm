import { randomBytes, randomInt } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { HelmEvents, TunnelState } from '../shared/types';
import type { Host } from './host';
import type { Store } from './store';

/** No 0/O, 1/I/L: a code is read off one screen and typed into another. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_TTL_MS = 10 * 60_000;

/** `XXXX-XXXX`: about 40 bits, single use, and good for ten minutes. */
export function makeCode(): string {
  const c = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  return c.slice(0, 4) + '-' + c.slice(4);
}

/**
 * Lets a browser on another device use this app, through a relay (`web-companion/relay`) that both sides connect out to, so nothing here
 * needs to be reachable from outside. The browser signs in to GitHub at the relay, then types the code shown here. The relay only lets a
 * browser signed in as the GitHub user this app is signed in as meet this app, and a code works once.
 *
 * What a paired browser may do is what the window of this app may do, minus the things that act on this computer (`CLIENT_SIDE`): it runs
 * the same API calls, and receives the same events. Nothing is sent unless the setting is on.
 */
export class Tunnel {
  state: TunnelState = { state: 'off', clients: 0 };
  private ws: WebSocket | null = null;
  private id = '';
  private timer: ReturnType<typeof setTimeout> | null = null;
  private codeTimer: ReturnType<typeof setTimeout> | null = null;
  private retry = 0;
  private generation = 0;

  /** `call` runs an API call by name (and refuses the ones that belong to this computer). `vault` is where this app keeps its files. */
  constructor(private store: Store, private call: (name: string, args: unknown[]) => Promise<unknown>, private onChange: () => void, private vault: () => Pick<Host, 'dataDir'>) {}

  private get s() { return this.store.data.settings; }
  private set(p: Partial<TunnelState>) { this.state = { ...this.state, ...p }; this.onChange(); }
  private idFile() { return join(this.vault().dataDir, 'tunnel-id'); }
  private base() { return this.s.tunnelUrl.trim().replace(/\/+$/, ''); }

  /** This app's identity at the relay: a secret that a paired browser's cookie names. Replacing it signs every browser out. */
  private async loadId(fresh = false) {
    if (fresh) this.id = '';
    else { try { this.id = (await readFile(this.idFile(), 'utf8')).trim(); } catch { /* none yet */ } }
    if (!/^[a-f0-9]{32}$/.test(this.id)) { this.id = randomBytes(16).toString('hex'); await writeFile(this.idFile(), this.id, { mode: 0o600 }); }
  }

  /** Brings the connection in line with the settings. Called at start-up and whenever they change. */
  apply() {
    this.generation++;
    this.close();
    if (!this.s.tunnelEnabled) { this.set({ state: 'off', error: undefined, code: undefined, clients: 0 }); return; }
    if (!/^https?:\/\//i.test(this.base())) { this.set({ state: 'error', error: 'Enter the address of your relay, for example https://companion.example.com', code: undefined, clients: 0 }); return; }
    if (!this.store.data.user?.login) { this.set({ state: 'error', error: 'Sign in to GitHub first: the relay pairs browsers with the same account.', code: undefined, clients: 0 }); return; }
    void this.loadId().then(() => this.connect(this.generation));
  }

  private close() {
    if (this.timer) clearTimeout(this.timer);
    if (this.codeTimer) clearTimeout(this.codeTimer);
    this.timer = this.codeTimer = null;
    const ws = this.ws;
    this.ws = null;
    try { ws?.close(); } catch { /* already closed */ }
  }

  /** Disconnects every paired browser: a new identity at the relay, and a new code. */
  async revoke() {
    if (!this.s.tunnelEnabled) return;
    this.generation++;
    this.close();
    await this.loadId(true);
    this.connect(this.generation);
  }

  private connect(gen: number) {
    if (gen !== this.generation) return;
    this.set({ state: 'connecting', error: undefined, clients: 0 });
    let ws: WebSocket;
    try { ws = new WebSocket(this.base().replace(/^http/i, 'ws') + '/tunnel'); } catch (e: any) { this.set({ state: 'error', error: String(e?.message || e) }); return this.again(gen); }
    this.ws = ws;
    const code = makeCode();
    ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', login: this.store.data.user?.login, id: this.id, code }));
    ws.onmessage = (ev) => { if (gen === this.generation) this.onMessage(String(ev.data), code); };
    ws.onerror = () => { /* onclose follows */ };
    ws.onclose = () => {
      if (gen !== this.generation) return;
      this.ws = null;
      if (this.codeTimer) clearTimeout(this.codeTimer);
      if (this.state.state !== 'error') this.set({ state: 'connecting', clients: 0, code: undefined });
      this.again(gen);
    };
  }

  private again(gen: number) {
    if (this.timer) clearTimeout(this.timer);
    const wait = Math.min(30_000, 1000 * 2 ** Math.min(this.retry++, 5));
    this.timer = setTimeout(() => this.connect(gen), wait);
  }

  private send(o: unknown) { try { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(o)); } catch { /* closing */ } }

  private newCode(code = makeCode()) {
    this.send({ t: 'code', code });
    this.set({ code });
    if (this.codeTimer) clearTimeout(this.codeTimer);
    this.codeTimer = setTimeout(() => this.newCode(), CODE_TTL_MS);
  }

  private onMessage(raw: string, firstCode: string) {
    let m: any;
    try { m = JSON.parse(raw); } catch { return; }
    switch (m.t) {
      case 'ready':
        this.retry = 0;
        this.set({ state: 'ready', code: firstCode, clients: m.clients ?? 0, error: undefined });
        this.codeTimer = setTimeout(() => this.newCode(), CODE_TTL_MS);
        break;
      case 'clients': this.set({ clients: m.n ?? 0 }); break;
      // Someone used the code: make another for the next device.
      case 'used': this.newCode(); break;
      case 'refused': this.set({ state: 'error', error: String(m.error || 'The relay refused this computer.') }); break;
      case 'call': void this.run(m); break;
    }
  }

  private async run(m: { client: string; id: number; name: string; args: unknown }) {
    const base = { t: 'result', client: m.client, id: m.id };
    try { this.send({ ...base, ok: true, value: (await this.call(m.name, m.args as unknown[])) ?? null }); } catch (e: any) { this.send({ ...base, ok: false, error: String(e?.message || e).replace(/^Error invoking remote method '\w+': Error: /, '').slice(0, 500) }); }
  }

  /** Every event the window gets, to the paired browsers. Nothing is sent when there are none. */
  forward<K extends keyof HelmEvents>(channel: K, payload: HelmEvents[K]) {
    if (this.state.state === 'ready' && this.state.clients > 0) this.send({ t: 'event', channel, payload });
  }

  /** A notification, sent to the relay even with no browser open, so it can reach a phone with the app closed. */
  notify(payload: HelmEvents['notify']) {
    if (this.state.state === 'ready') this.send({ t: 'event', channel: 'notify', payload });
  }

  shutdown() { this.generation++; this.close(); }
}
