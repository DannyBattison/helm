import { app, safeStorage } from 'electron';
import { rm, readFile, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';
import type { CompanionSnapshot, CompanionState, Session, TranscriptEvent } from '../shared/types';
import type { Store } from './store';

/** What the companion may ask this app to do. The app checks each one again before doing it. */
export interface CompanionOps {
  resolveAsk(sessionId: string, askId: string, answer: any): Promise<void>;
  sendMessage(sessionId: string, text: string): Promise<void>;
  interrupt(sessionId: string): Promise<void>;
  stop(sessionId: string): Promise<void>;
  resume(sessionId: string): Promise<void>;
  archive(sessionId: string, archived: boolean): Promise<void>;
  createSession(repoId: string, task: string): Promise<void>;
  transcript(key: string): Promise<TranscriptEvent[]>;
  externals(repoId: string): Promise<{ id: string; title: string; branch?: string; active: boolean; lastModified: number; archived: boolean }[]>;
  externalTranscript(repoId: string, sessionId: string, limit: number): Promise<{ ready: boolean; total: number; start: number; events: TranscriptEvent[] }>;
  archiveExternal(sessionId: string, archived: boolean): Promise<void>;
  activity(before: number | undefined, limit: number): Promise<any[]>;
}

const keyFile = () => join(app.getPath('userData'), 'companion.bin');
const cap = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '…' : s);

/** A transcript event cut down for the trip: no images, no huge strings, no more diff lines than a phone can show. */
export function lite(e: TranscriptEvent): TranscriptEvent {
  switch (e.k) {
    case 'user': return { ...e, text: cap(e.text, 6000), images: e.images?.map(() => ({ mediaType: 'image/png', data: '' })) };
    case 'agent': return { ...e, text: cap(e.text, 8000) };
    case 'edit': return { ...e, lines: e.lines.slice(0, 14).map(([t, l]) => [t, cap(l, 240)] as [string, string]) };
    case 'bash': return { ...e, cmd: cap(e.cmd, 1500), out: cap(e.out, 300) };
    case 'permission': return { ...e, cmd: cap(e.cmd, 1500), why: cap(e.why, 400) };
    case 'subagent': return { ...e, summary: e.summary ? cap(e.summary, 400) : undefined };
    default: return e;
  }
}

/**
 * Keeps this app connected to a helm-companion server while "Enable companion" is on, sends it a small snapshot of what is going on,
 * and carries out the few things the website may ask for. Nothing is sent unless the setting is on and this computer has been linked.
 *
 * The GitHub token helm uses is never sent. Linking is a separate GitHub sign-in that asks for no permissions, and gives back a key
 * that only proves which username was signed in.
 */
export class Companion {
  state: CompanionState = { state: 'off', viewers: 0 };
  private ws: WebSocket | null = null;
  private key: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSent = '';
  private watched = new Set<string>();
  private retry = 0;
  private linking = 0;
  private generation = 0;
  private externals: CompanionSnapshot['externals'] = [];
  private externalsAt = 0;
  private externalsBusy = false;

  constructor(private store: Store, private ops: CompanionOps, private onChange: () => void) {}

  private get s() { return this.store.data.settings; }
  private set(p: Partial<CompanionState>) { this.state = { ...this.state, ...p }; this.onChange(); }

  /** The server's address as given, without a trailing slash. */
  private base() { return this.s.companionUrl.trim().replace(/\/+$/, ''); }
  private wsUrl() { return this.base().replace(/^http/i, 'ws') + '/ws/app'; }

  async loadKey() {
    try {
      const buf = await readFile(keyFile());
      this.key = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf8');
    } catch { this.key = null; }
  }
  private async saveKey(k: string) {
    this.key = k;
    await writeFile(keyFile(), safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(k) : Buffer.from(k));
  }
  async unlink() {
    this.key = null;
    await rm(keyFile(), { force: true });
    this.apply();
  }

  /** Brings the connection in line with the settings. Called at start-up and whenever they change. */
  apply() {
    this.generation++;
    this.stopConnection();
    if (!this.s.companionEnabled) { this.set({ state: 'off', error: undefined, linkCode: undefined, viewers: 0, login: undefined }); return; }
    if (!/^https?:\/\//i.test(this.base())) { this.set({ state: 'error', error: 'Enter the address of your companion server, for example https://companion.example.com', linkCode: undefined, viewers: 0 }); return; }
    if (!this.key) { void this.link(); return; }
    this.connect();
  }

  private stopConnection() {
    if (this.timer) clearTimeout(this.timer);
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.timer = this.pushTimer = null;
    const ws = this.ws;
    this.ws = null;
    this.lastSent = '';
    this.watched.clear();
    try { ws?.close(); } catch { /* already closed */ }
  }

  // ---------------------------------------------------------------- linking: a GitHub sign-in that reads only the username
  private async link() {
    const mine = ++this.linking;
    const gen = this.generation;
    const live = () => mine === this.linking && gen === this.generation && this.s.companionEnabled;
    try {
      this.set({ state: 'linking', error: undefined, linkCode: undefined, viewers: 0 });
      const r = await fetch(this.base() + '/auth/device/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ purpose: 'app' }) });
      const j: any = await r.json();
      if (!r.ok || !j.ticket) throw new Error(j.error || `The server answered ${r.status}`);
      if (!live()) return;
      this.set({ linkCode: { userCode: j.userCode, verificationUri: j.verificationUri } });
      const until = Date.now() + j.expiresIn * 1000;
      while (live() && Date.now() < until) {
        await new Promise((res) => setTimeout(res, Math.max(2, j.interval) * 1000));
        if (!live()) return;
        const p: any = await (await fetch(this.base() + '/auth/device/poll', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticket: j.ticket }) })).json();
        if (p.status === 'ok') {
          const me = this.store.data.user?.login;
          if (me && p.login.toLowerCase() !== me.toLowerCase()) throw new Error(`You authorised ${p.login}, but helm is signed in as ${me}. Use the same GitHub account.`);
          await this.saveKey(p.key);
          this.set({ linkCode: undefined, login: p.login });
          return this.connect();
        }
        if (['denied', 'expired', 'error'].includes(p.status)) throw new Error(p.status === 'denied' ? 'The sign-in was declined.' : 'The sign-in did not finish.');
      }
      if (live()) throw new Error('The code expired. Turn the companion off and on to get a new one.');
    } catch (e: any) {
      if (live()) this.set({ state: 'error', error: String(e?.message || e), linkCode: undefined });
    }
  }

  // ---------------------------------------------------------------- the connection
  private connect() {
    if (!this.key || !this.s.companionEnabled) return;
    const gen = this.generation;
    this.set({ state: 'connecting', error: undefined, linkCode: undefined });
    let ws: WebSocket;
    try { ws = new WebSocket(this.wsUrl()); } catch (e: any) { this.set({ state: 'error', error: String(e?.message || e) }); return this.again(gen); }
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', key: this.key, name: hostname() }));
    ws.onmessage = (ev) => { if (gen === this.generation) this.onMessage(String(ev.data)); };
    ws.onerror = () => { /* onclose follows */ };
    ws.onclose = () => {
      if (gen !== this.generation) return;
      this.ws = null;
      this.lastSent = '';
      if (this.state.state === 'error') return;
      this.set({ state: 'connecting', viewers: 0 });
      this.again(gen);
    };
  }

  private again(gen: number) {
    if (this.timer) clearTimeout(this.timer);
    const wait = Math.min(30_000, 1000 * 2 ** Math.min(this.retry++, 5));
    this.timer = setTimeout(() => { if (gen === this.generation) this.connect(); }, wait);
  }

  private send(o: unknown) { try { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(o)); } catch { /* closing */ } }

  private onMessage(raw: string) {
    let m: any;
    try { m = JSON.parse(raw); } catch { return; }
    switch (m.t) {
      case 'ready':
        this.retry = 0;
        this.set({ state: 'connected', login: m.login, viewers: m.viewers ?? 0, error: undefined });
        this.externalsAt = 0;
        this.push(true);
        if (m.viewers) void this.refreshExternals(true);
        break;
      case 'viewers': this.set({ viewers: m.n ?? 0 }); if (m.n) void this.refreshExternals(true); break;
      case 'watch': this.watched = new Set(Array.isArray(m.sessionIds) ? m.sessionIds : []); break;
      case 'replaced': this.set({ state: 'error', error: 'Another copy of helm connected with this account, so this one stepped aside.' }); break;
      case 'error': {
        // The key was refused: forget it, so the next attempt links again instead of retrying forever.
        void this.unlinkQuietly(String(m.error || 'The server refused this computer.'));
        break;
      }
      case 'cmd': void this.run(m.id, m.cmd); break;
    }
  }

  private async unlinkQuietly(why: string) {
    this.generation++;
    this.stopConnection();
    this.key = null;
    await rm(keyFile(), { force: true });
    this.set({ state: 'error', error: why, viewers: 0 });
  }

  // ---------------------------------------------------------------- what is sent
  /** Called whenever helm's state changes. Sends a fresh snapshot, at most once a second, and only if something differs. */
  changed() {
    if (this.state.state !== 'connected' || this.pushTimer) return;
    this.pushTimer = setTimeout(() => { this.pushTimer = null; this.push(false); void this.refreshExternals(); }, 1000);
  }

  private push(force: boolean) {
    if (this.state.state !== 'connected') return;
    const snap = this.snapshot();
    // `at` changes every time; compare without it.
    const sig = JSON.stringify({ ...snap, at: 0 });
    if (!force && sig === this.lastSent) return;
    this.lastSent = sig;
    this.send({ t: 'snapshot', data: snap });
  }

  /** The sessions started outside helm, per repository. Only read while someone has the website open, and at most every 30 seconds. */
  private async refreshExternals(force = false) {
    if (this.externalsBusy || this.state.state !== 'connected' || (!force && (this.state.viewers === 0 || Date.now() - this.externalsAt < 30_000))) return;
    this.externalsBusy = true;
    try {
      const out: CompanionSnapshot['externals'] = [];
      for (const r of this.store.data.repos) {
        const list = await this.ops.externals(r.id).catch(() => []);
        for (const x of list) out.push({ repoId: r.id, id: x.id, title: cap(x.title || '', 120), branch: x.branch, active: x.active, lastModified: x.lastModified, archived: x.archived });
      }
      this.externals = out;
      this.externalsAt = Date.now();
      this.push(true);
    } finally { this.externalsBusy = false; }
  }

  snapshot(): CompanionSnapshot {
    const d = this.store.data;
    const repoName = (id: string) => d.repos.find((r) => r.id === id)?.name || id;
    const sess = (s: Session) => ({
      id: s.id, title: s.customTitle || s.title || '', repoId: s.repoId, repoName: repoName(s.repoId), status: s.status, step: cap(s.step || '', 160), branch: s.branch, base: s.base,
      model: s.model, permMode: s.permMode, startedAt: s.startedAt, endedAt: s.endedAt, lastAccess: s.lastAccess,
      tokens: s.tokens.input + s.tokens.output + s.tokens.cacheRead, tokenDetail: { input: s.tokens.input, output: s.tokens.output, cacheRead: s.tokens.cacheRead },
      cost: s.cost, budget: s.budget, ctx: s.ctx, files: s.files, add: s.add, del: s.del, commits: s.commits.length, prUrl: s.prUrl, mergedInto: s.mergedInto,
      archived: !!s.archivedAt, worktreeGone: s.worktreeGone, maxSubagents: s.maxSubagents,
      subagents: s.subagents.map((a) => ({ id: a.id, parentId: a.parentId, description: cap(a.description, 160), agentType: a.agentType, status: a.status, startedAt: a.startedAt, endedAt: a.endedAt, tools: a.tools, tokens: a.tokens, summary: a.summary ? cap(a.summary, 300) : undefined, background: a.background })),
      ask: s.ask ? { id: s.ask.id, type: s.ask.type, head: cap(s.ask.head, 300), note: cap(s.ask.note || '', 500), command: s.ask.command ? cap(s.ask.command, 3000) : undefined, tool: s.ask.tool, pattern: s.ask.pattern, scope: s.ask.scope, orphaned: s.ask.orphaned, questions: s.ask.questions } : undefined
    });
    const week = this.store.weekSpend();
    const zero = { input: 0, output: 0, cacheRead: 0, cost: 0 };
    return {
      at: Date.now(),
      activitySeq: this.store.logSeq,
      user: { login: d.user?.login || '', avatar: d.user?.avatar || '' },
      billing: this.s.billing,
      currency: { code: this.s.currency || 'USD', rate: d.fx.rates[this.s.currency] || 1 },
      control: this.s.companionControl,
      plan: { fiveHour: d.plan.fiveHour, weekly: d.plan.weekly },
      tokensToday: this.store.tokensToday(),
      repos: d.repos.map((r) => ({ id: r.id, name: r.name, owner: r.owner, lifetime: d.totals[r.id] || zero, weekSpend: week[r.id] || 0, cap: r.cap })),
      sessions: d.sessions.map(sess),
      externals: this.externals,
      activity: d.activity.slice(0, 30).map((a) => ({ t: a.t, who: a.who, what: cap(a.what, 200), kind: a.kind, repo: a.repo, ok: a.ok }))
    };
  }

  /** A live transcript event, sent only if someone on the website is looking at that session. */
  onTranscript(sessionId: string, index: number, event: TranscriptEvent) {
    if (this.state.state !== 'connected' || !this.watched.has(sessionId)) return;
    this.send({ t: 'event', sessionId, index, event: lite(event) });
  }

  // ---------------------------------------------------------------- what the website may ask for
  private async run(id: string, cmd: any) {
    const reply = (ok: boolean, error?: string) => this.send({ t: 'result', id, ok, error });
    try {
      // Reading needs no permission to control.
      if (cmd?.c === 'transcript') {
        const key = cmd.subId ? `${cmd.sessionId}~${cmd.subId}` : String(cmd.sessionId);
        if (!this.store.data.sessions.some((x) => x.id === String(cmd.sessionId))) return reply(false, 'That session no longer exists');
        const all = await this.ops.transcript(key);
        const limit = Math.min(Math.max(1, Number(cmd.limit) || 120), 300);
        const start = Math.max(0, all.length - limit);
        return this.send({ t: 'transcript', id, sessionId: key, start, total: all.length, events: all.slice(start).map(lite) });
      }
      if (cmd?.c === 'externalTranscript') {
        const r = await this.ops.externalTranscript(String(cmd.repoId), String(cmd.sessionId), Math.min(Math.max(1, Number(cmd.limit) || 120), 300));
        if (!r.ready) return reply(false, 'helm is still reading that conversation. Try again in a moment.');
        return this.send({ t: 'transcript', id, sessionId: 'ext:' + cmd.sessionId, start: r.start, total: r.total, events: r.events.map(lite) });
      }
      if (cmd?.c === 'activity') {
        const events = await this.ops.activity(typeof cmd.before === 'number' ? cmd.before : undefined, Math.min(Math.max(1, Number(cmd.limit) || 150), 300));
        return this.send({ t: 'activity', id, events: events.map((a: any) => ({ t: a.t, who: a.who, what: cap(String(a.what), 200), kind: a.kind, repo: a.repo, ok: a.ok })) });
      }
      if (!this.s.companionControl) return reply(false, 'Remote control is turned off in helm\'s settings');
      const sid = String(cmd?.sessionId || '');
      if (cmd?.c !== 'createSession' && cmd?.c !== 'archiveExternal' && !this.store.data.sessions.some((x) => x.id === sid)) return reply(false, 'That session no longer exists');
      switch (cmd?.c) {
        case 'resolveAsk': await this.ops.resolveAsk(sid, String(cmd.askId), cmd.answer || {}); break;
        case 'sendMessage': await this.ops.sendMessage(sid, String(cmd.text)); break;
        case 'interrupt': await this.ops.interrupt(sid); break;
        case 'stopSession': await this.ops.stop(sid); break;
        case 'resumeSession': await this.ops.resume(sid); break;
        case 'archiveSession': await this.ops.archive(sid, !!cmd.archived); break;
        case 'createSession': await this.ops.createSession(String(cmd.repoId), String(cmd.task)); break;
        case 'archiveExternal': await this.ops.archiveExternal(sid, !!cmd.archived); break;
        default: return reply(false, 'Unknown request');
      }
      reply(true);
    } catch (e: any) { reply(false, String(e?.message || e).replace(/^Error invoking remote method '\w+': Error: /, '').slice(0, 300)); }
  }

  shutdown() { this.generation++; this.stopConnection(); }
}
