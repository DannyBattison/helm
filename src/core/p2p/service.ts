import { randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { readFile, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { host as listen } from '../../shared/p2p/link';
import type { Link } from '../../shared/p2p/link';
import { generateKeyPair, publicKeyOf } from '../../shared/p2p/noise';
import type { KeyPair } from '../../shared/p2p/noise';
import { b64, encodeShareCode } from '../../shared/p2p/sharecode';
import type { HelmEvents, P2PState } from '../../shared/types';
import type { Host } from '../host';
import type { Store } from '../store';
import { forCode, rankCandidates } from './addresses';
import { StunClient } from './stun';
import { NodeUdp } from './udp';

const CODE_TTL_MS = 10 * 60_000;
const STUN_EVERY_MS = 25_000;
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

/** The GitHub user a token belongs to, or null. The token needs no scopes: the public profile is all this reads. */
async function githubLogin(token: string): Promise<string | null> {
  const r = await fetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'helm' }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) return null;
  const j: any = await r.json();
  return typeof j?.login === 'string' ? j.login : null;
}

interface Device { id: string; name: string; addedAt: number; lastSeen: number; /** The GitHub user who was signed in here, and on the phone, when it was paired. */ login?: string }
/** A notification waiting for a phone to collect it. */
export interface Notice { id: string; at: number; kind: 'attention' | 'ready' | 'failed'; title: string; body: string; silent: boolean; sessionId: string }
interface Saved { secretKey: string; devices: Device[]; port: number; /** Notices not yet acknowledged, by device id. */ queue?: Record<string, Notice[]> }
const KEEP_NOTICES = 50;
const NOTICE_TTL_MS = 3 * 24 * 3600_000;

/**
 * Lets the phone app reach this app directly. helm opens one UDP port, works out the addresses it can be reached at (its own interfaces, and
 * what a STUN server sees the port as, asked again every 25 s to keep the router's mapping open and to notice when it changes) and puts them
 * in a share code with its key and a one-time secret. A phone that has the code finds the port, proves itself and is remembered by its key.
 * Nothing answers anyone else (see `shared/p2p/link.ts`). A paired phone can do what this app's window can, except what acts on this
 * computer (`CLIENT_SIDE`): it makes the same API calls and receives the same events.
 */
export class P2P {
  state: P2PState = { state: 'off', addresses: [], devices: [] };
  private saved: Saved | null = null;
  private identity: KeyPair | null = null;
  private udp: NodeUdp | null = null;
  private listener: ReturnType<typeof listen> | null = null;
  private stun: StunClient | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private generation = 0;
  private secret: { value: string; expires: number } | null = null;
  private links = new Map<string, Link>();
  private mapped: { host: string; port: number } | null = null;
  private lastCandidates = '';

  /**
   * `call` runs an API call by name and refuses what belongs to this computer. `vault` is where this app keeps its files. `whoIs` says which
   * GitHub user a token belongs to (null if it is not valid); the default asks GitHub.
   */
  constructor(private store: Store, private call: (name: string, args: unknown[]) => Promise<unknown>, private onChange: () => void, private vault: () => Pick<Host, 'dataDir' | 'encrypt' | 'decrypt'>, private whoIs: (token: string) => Promise<string | null> = githubLogin) {}

  private get s() { return this.store.data.settings; }
  private file() { return join(this.vault().dataDir, 'p2p.bin'); }
  private set(p: Partial<P2PState>) { this.state = { ...this.state, ...p }; this.onChange(); }

  private async load(): Promise<Saved> {
    if (this.saved) return this.saved;
    const v = this.vault();
    try {
      const buf = await readFile(this.file());
      this.saved = JSON.parse(v.decrypt ? v.decrypt(buf) : buf.toString('utf8'));
    } catch { this.saved = null; }
    if (!this.saved?.secretKey) { this.saved = { secretKey: hex(generateKeyPair().secretKey), devices: [], port: 0 }; await this.save(); }
    return this.saved;
  }
  private async save() {
    const v = this.vault();
    const text = JSON.stringify(this.saved);
    await writeFile(this.file(), v.encrypt ? v.encrypt(text) : Buffer.from(text), { mode: 0o600 });
  }

  /** Brings the listener in line with the settings. Called at start-up and whenever they change. */
  apply() {
    const gen = ++this.generation;
    this.stop();
    if (this.s.p2pEnabled && !this.store.data.user?.login) { this.set({ state: 'error', error: 'Sign in to GitHub in helm first: a phone is paired with the same GitHub account.', code: undefined, addresses: [], port: undefined }); return; }
    if (!this.s.p2pEnabled) { this.set({ state: 'off', error: undefined, code: undefined, addresses: [], mapped: undefined, nat: undefined, port: undefined }); return; }
    this.set({ state: 'starting', error: undefined });
    void this.start(gen).catch((e) => { if (gen === this.generation) this.set({ state: 'error', error: String(e?.code === 'EADDRINUSE' ? `Port ${this.s.p2pPort} is already in use. Choose another in Settings.` : e?.message || e) }); });
  }

  private stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.listener?.close();
    this.udp?.close();
    this.listener = null;
    this.udp = null;
    this.stun = null;
    this.links.clear();
    this.mapped = null;
    this.lastCandidates = '';
  }

  private async start(gen: number) {
    const saved = await this.load();
    const secretKey = Buffer.from(saved.secretKey, 'hex');
    this.identity = { secretKey, publicKey: publicKeyOf(secretKey) };
    const udp = new NodeUdp((d) => this.stun?.handle(d));
    // The same port every time, so a code stays useful: the one chosen in settings, else the one picked the first time.
    const want = this.s.p2pPort || saved.port;
    // A port that was just let go (turning the setting off and on) may take a moment to come free.
    let port = 0;
    for (let attempt = 0; ; attempt++) {
      try { port = await udp.bind(want); break; } catch (e) {
        if (attempt < 8 && want) { await new Promise((r) => setTimeout(r, 100)); continue; }
        if (want && !this.s.p2pPort) { port = await udp.bind(0); break; }
        throw e;
      }
    }
    if (gen !== this.generation) { udp.close(); return; }
    if (!this.s.p2pPort && saved.port !== port) { saved.port = port; await this.save(); }
    this.udp = udp;
    this.stun = new StunClient((p, h, pt) => udp.send(p, h, pt));
    this.listener = listen({
      socket: udp,
      identity: this.identity,
      authorize: (key, said) => this.authorize(key, said),
      onLink: (link, device) => this.attach(link, device.key, device.name)
    });
    this.set({ state: 'ready', port, error: undefined });
    await this.refresh();
    if (gen === this.generation) { this.timer = setInterval(() => void this.refresh(), STUN_EVERY_MS); (this.timer as any).unref?.(); }
  }

  // ------------------------------------------------------------ who may connect
  /**
   * A device already paired is recognised by its key, as long as the GitHub user signed in here is still the one it was paired for. A new
   * device needs a current code's one-time secret and a GitHub token showing its user is the one signed in on this computer. The token is
   * checked with GitHub and thrown away; nothing about it is kept.
   */
  private async authorize(key: Uint8Array, said: { n?: string; s?: string; g?: string }): Promise<{ name: string } | false> {
    const saved = this.saved!;
    const me = this.store.data.user?.login?.toLowerCase();
    if (!me) return false;
    const id = hex(key);
    const known = saved.devices.find((d) => d.id === id);
    if (known) return (known.login ?? me) === me ? { name: known.name } : false;
    const sec = this.secret;
    if (!sec || !said.s || !said.g || Date.now() > sec.expires || said.s.length !== sec.value.length) return false;
    // Compared without stopping at the first difference. This runs before GitHub is asked, so a guess costs nothing but a refusal.
    let diff = 0;
    for (let i = 0; i < sec.value.length; i++) diff |= sec.value.charCodeAt(i) ^ said.s.charCodeAt(i);
    if (diff) return false;
    const who = await this.whoIs(said.g).catch(() => null);
    if (who?.toLowerCase() !== me || this.secret !== sec) return false;
    this.secret = null;
    const name = String(said.n || 'Phone').slice(0, 60);
    saved.devices.push({ id, name, addedAt: Date.now(), lastSeen: Date.now(), login: me });
    void this.save();
    this.refreshState();
    return { name };
  }

  private attach(link: Link, key: Uint8Array, name: string) {
    const id = hex(key);
    this.links.set(id, link);
    const dev = this.saved!.devices.find((d) => d.id === id);
    if (dev) { dev.lastSeen = Date.now(); void this.save(); }
    link.onClose(() => { if (this.links.get(id) === link) this.links.delete(id); this.refreshState(); });
    link.onMessage((raw) => void this.run(link, raw, id));
    this.refreshState();
    link.send(new TextEncoder().encode(JSON.stringify({ t: 'hello', name: hostname() })));
    // Whatever happened while this phone was away.
    const waiting = this.waiting(id);
    if (waiting.length) link.send(new TextEncoder().encode(JSON.stringify({ t: 'notices', items: waiting })));
  }

  private waiting(id: string): Notice[] {
    const q = this.saved?.queue?.[id];
    if (!q) return [];
    const fresh = q.filter((n) => Date.now() - n.at < NOTICE_TTL_MS);
    if (fresh.length !== q.length) { this.saved!.queue![id] = fresh; void this.save(); }
    return fresh;
  }

  /**
   * A notification for the phones. Each paired phone gets it now if it is connected, and in any case it is kept for that phone until it
   * says it has shown it: a phone that is closed collects what it missed in a short background connection (see mobile-app/src/notices.ts).
   */
  notify(n: Omit<Notice, 'id' | 'at'>) {
    const saved = this.saved;
    if (this.state.state !== 'ready' || !saved?.devices.length) return;
    const notice: Notice = { ...n, id: randomBytes(8).toString('hex'), at: Date.now() };
    saved.queue ??= {};
    for (const d of saved.devices) {
      saved.queue[d.id] = [...this.waiting(d.id), notice].slice(-KEEP_NOTICES);
      this.links.get(d.id)?.send(new TextEncoder().encode(JSON.stringify({ t: 'notices', items: [notice] })));
    }
    void this.save();
  }

  private async run(link: Link, raw: Uint8Array, deviceId: string) {
    let m: any;
    try { m = JSON.parse(new TextDecoder().decode(raw)); } catch { return; }
    if (m?.t === 'ack' && Array.isArray(m.ids)) {
      const q = this.saved?.queue?.[deviceId];
      if (q) { this.saved!.queue![deviceId] = q.filter((n) => !m.ids.includes(n.id)); void this.save(); }
      return;
    }
    if (m?.t !== 'call' || typeof m.name !== 'string') return;
    const reply = (o: unknown) => link.send(new TextEncoder().encode(JSON.stringify({ t: 'result', id: m.id, ...(o as object) })));
    try { reply({ ok: true, value: (await this.call(m.name, m.args)) ?? null }); } catch (e: any) { reply({ ok: false, error: String(e?.message || e).replace(/^Error invoking remote method '\w+': Error: /, '').slice(0, 500) }); }
  }

  /** Every event the window gets, to the connected phones. */
  forward<K extends keyof HelmEvents>(channel: K, payload: HelmEvents[K]) {
    if (!this.links.size) return;
    const msg = new TextEncoder().encode(JSON.stringify({ t: 'event', channel, payload }));
    for (const l of this.links.values()) l.send(msg);
  }

  // ------------------------------------------------------------ addresses and the code
  /** Asks STUN what the port looks like from outside, and rebuilds the code if that or the interfaces changed. */
  private async refresh() {
    const gen = this.generation;
    const server = this.s.p2pStun.trim();
    if (this.stun && server) {
      const [h, p] = server.includes(':') ? [server.slice(0, server.lastIndexOf(':')), +server.slice(server.lastIndexOf(':') + 1)] : [server, 3478];
      try {
        const ip = (await lookup(h, { family: 4 })).address;
        const a = await this.stun.query(ip, p || 3478);
        // The same port asked of a second server: a different answer means the router picks a new public port per destination, which no
        // phone can be told about in advance, so a direct connection will not work (unless there is another address to use).
        const b = a && gen === this.generation ? await this.stun.query((await lookup('stun.l.google.com', { family: 4 })).address, 19302).catch(() => null) : null;
        if (gen !== this.generation) return;
        this.mapped = a;
        this.set({ nat: !a ? 'unknown' : b && (b.host !== a.host || b.port !== a.port) ? 'symmetric' : 'cone', mapped: a ? `${a.host}:${a.port}` : undefined });
      } catch { if (gen === this.generation) { this.mapped = null; this.set({ nat: 'unknown', mapped: undefined }); } }
    }
    if (gen === this.generation) this.refreshState();
  }

  private candidates(): string[] {
    const port = this.state.port!;
    const out: string[] = [];
    const extra = this.s.p2pAddress.trim();
    if (extra) out.push(extra);
    // Where the router sends traffic for this port, when STUN found it and the NAT keeps one answer: ahead of the private addresses.
    if (this.mapped && this.state.nat !== 'symmetric') out.push(forCode(this.mapped.host, this.mapped.port !== port ? this.mapped.port : undefined));
    for (const c of rankCandidates()) out.push(forCode(c.address));
    return [...new Set(out)];
  }

  /** The pairing secret in use, made if there is none or it has run out. */
  private currentSecret() {
    if (!this.secret || Date.now() > this.secret.expires) this.secret = { value: b64.encode(randomBytes(16)), expires: Date.now() + CODE_TTL_MS };
    return this.secret.value;
  }

  newCode() { this.secret = null; this.refreshState(); }

  private refreshState() {
    if (this.state.state !== 'ready' || !this.identity) return;
    const addresses = this.candidates();
    const code = encodeShareCode({ v: 1, n: hostname(), p: this.state.port!, c: addresses, k: b64.encode(this.identity.publicKey), s: this.currentSecret() });
    const devices = this.saved!.devices.map((d) => ({ ...d, connected: this.links.has(d.id) }));
    const sig = JSON.stringify([addresses, this.state.port]);
    // Phones that are connected learn about a new address at once and keep it; one that is away has to be given a new code.
    if (sig !== this.lastCandidates && this.lastCandidates) {
      const msg = new TextEncoder().encode(JSON.stringify({ t: 'candidates', p: this.state.port, c: addresses }));
      for (const l of this.links.values()) l.send(msg);
    }
    this.lastCandidates = sig;
    this.set({ addresses, code, devices });
  }

  async revoke(id: string) {
    const saved = await this.load();
    saved.devices = saved.devices.filter((d) => d.id !== id);
    if (saved.queue) delete saved.queue[id];
    await this.save();
    this.links.get(id)?.close();
    this.links.delete(id);
    this.listener?.drop(Buffer.from(id, 'hex'));
    this.refreshState();
  }

  shutdown() { this.generation++; this.stop(); }
}
