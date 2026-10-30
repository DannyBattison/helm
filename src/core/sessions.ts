import { mcpConfig } from '../shared/mcp';
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, posix, relative, resolve, win32 } from 'node:path';
import { fmtMoney } from '../shared/money';
import { auditText } from '../shared/redact';
import { queueBlock, queueOrder } from '../shared/queue';
import { stuckReason } from '../shared/stuck';
import { REVIEW_SCHEMA, parseReview, reviewPrompt } from '../shared/selfreview';
import { commandSummary } from '../shared/commandSummary';
import { handleFor, memberOf, mentionsIn, panelDigest, panelInstructions, participants, replyLimit } from '../shared/panel';
import { FREE_ID, freeRepo, sessionTitle, MAX_UPLOAD_FILES, MAX_UPLOAD_TOTAL, type ActivityEvent, type Checkpoint, type Effort, type ExtraRepo, type Repo, type MessageImage, type ModelAlias, type NewSessionInput, type Panel, type PanelAgentInput, type PanelMember, type PendingAsk, type PermMode, type ReplyRef, type SendOptions, type Session, type Settings, type Status, type Subagent, type TranscriptEvent } from '../shared/types';
import { effectiveSettings } from '../shared/repoSettings';
import { composeMessage, messageBody } from '../shared/templates';
import { BackendRegistry, type AgentBackend, type AgentBlock, type AgentEvent, type AgentHandle, type AgentToolResult, type AgentUsage, type ToolDecision } from './backend';
import { ClaudeBackend } from './claudeBackend';
import { Advisor } from './advisor';
import { COMMAND_TOOLS, EDIT_TOOLS, convertMessages, rel, trunc } from './transcript';
import { artifactDir, dropArtifacts, ensureArtifactDir } from './artifacts';
import * as G from './git';
import { logLine } from './log';
import { listRepoFixtures, supplyRepoFixtures } from './repofixtures';
import { snapshotRef } from '../shared/sync';
import { checkpointParent, dropCheckpoints, listCheckpoints, restoreCheckpoint, seedFromCheckpoint, takeCheckpoint } from './review';
import type { Store } from './store';
import { commandPattern, expandHome, findBash, globMatch, hasShellControl, helmPids, killsPid, matchesAlwaysAsk, parseEnv, uid } from './util';

export interface Hooks {
  emitState(): void;
  emitTranscript(sessionId: string, index: number, event: TranscriptEvent): void;
  toast(t: { tone: 'ready' | 'attention' | 'error' | 'neutral'; title: string; description?: string; sessionId?: string; tab?: string }): void;
  notify(kind: 'attention' | 'ready' | 'failed', title: string, body: string, sessionId: string): void;
  claudePath(): string | undefined;
  /** Asks the agents for their current plan usage. */
  refreshPlan?(): Promise<void>;
}

/** Added to the system prompt: a subagent reports to the agent that started it, which keeps going. */
/** Starts the reason shown for a session that has gone quiet; a new event from the agent clears it. */
const STALLED = 'No output';
const HAND_BACK = 'A subagent hands its result back to you when it finishes: end its task with a clear final report, and when you receive a subagent\'s result, carry on from it (use it, start the next step or summarise it for the user) rather than stopping.';

interface AskWaiter {
  ask: PendingAsk;
  scope: 'session' | 'repo' | 'plan' | 'tool';
  planKey?: 'fiveHour' | 'weekly';
  resolve(r: any): void;
  input?: Record<string, unknown>;
  tool?: string;
}

interface Runtime {
  agent: AgentHandle;
  asks: Map<string, AskWaiter>;
  turnCost: number;
  baseCost: number;
  /** Session cost when this run started; the SDK's total_cost_usd counts only from there. */
  startCost: number;
  interrupted: boolean;
  budgetPaused: boolean;
  /** When the agent last produced any event, to notice one that has gone quiet. */
  lastEventAt: number;
  toolStart: Map<string, { t: number; idx: number; kind: string; input: any; tkey: string; name?: string }>;
  /** Consecutive failures of the same command, to notice an agent retrying something that cannot work. */
  fails: Map<string, number>;
  statsTimer?: NodeJS.Timeout;
  /** Index of the open tools group in each transcript, so consecutive reads share one box. */
  lastTools: Map<string, number>;
  /** Where each subagent's card sits in its parent transcript. */
  subEvent: Map<string, { tkey: string; idx: number }>;
  /** Subagents the limit hook let start, so a parallel batch is counted one by one. */
  admitted: Set<string>;
  /** In a session with several agents: the owner's text this turn, where its last piece sits in the transcript, and who is waiting for the turn to end. */
  turnText: string[];
  lastText: number;
  turnWaiters: ((r: { text: string; index: number }) => void)[];
  /** The message the owner's replies this turn answer. */
  reply?: ReplyRef;
}

/** A message of the user's, for the agents of a panel to answer. `at` is its place in the transcript. */
interface Round { at: number; text: string; images: MessageImage[]; to: string[] }
const snip = (t: string) => trunc(t.replace(/\s+/g, ' ').trim(), 120);


const SAFE_CMD = /^(ls|dir|pwd|cat|head|tail|wc|echo|which|where|type|tree|file|stat|date|whoami|git (status|diff|log|show|branch|rev-parse|ls-files|blame|remote -v|config --get)|rg|grep|find(?!.*(-delete|-exec)))(\s|$)/;
const inside = (wt: string, p: string) => {
  const r = relative(wt, resolve(wt, p));
  return !r.startsWith('..') && !isAbsolute(r);
};
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').split('-').slice(0, 4).join('-') || 'session';

/** Things a new session can start with beyond a task: a copied conversation, a worktree seeded from a checkpoint, where it came from. */
export interface CreateExtra {
  /** Runs once the worktree exists. Returns the backend's conversation to resume, or nothing to start a new conversation. */
  conversation?: (worktree: string) => Promise<string | undefined>;
  /** Start the worktree from this checkpoint commit instead of from the base. */
  seed?: string;
  parentId?: string;
  group?: string;
  source?: Session['source'];
  effort?: Effort;
}

export class SessionManager {
  private rt = new Map<string, Runtime>();
  /** Messages in a session with several agents whose replies are not all in yet. */
  private pendingRounds = new Map<string, number>();
  /** True while helm is quitting: ending the agents must not rewrite what the sessions were doing. */
  private quitting = false;
  /** Plan windows the user chose to continue past, keyed to the window's reset time so it lapses on reset. */
  private planOverride: Record<string, number> = {};
  /** How each backend other than Claude is paid for, as its sign-in reports it. Claude's is `settings.billing`. */
  private billings: Record<string, 'subscription' | 'api'> = {};
  private registry: BackendRegistry;
  /** Read-only participants of sessions with several agents, by session and handle. */
  private advisors = new Map<string, Map<string, Advisor>>();
  /** Bumped to call off the replies a session's agents are working through. */
  private epochs = new Map<string, number>();
  /** Each session's rounds run one after another. */
  private rounds = new Map<string, Promise<void>>();
  constructor(private store: Store, private hooks: Hooks, registry?: BackendRegistry) {
    this.registry = registry ?? new BackendRegistry([new ClaudeBackend({ sdk: () => this.store.data.settings.claudePath || this.hooks.claudePath(), cli: () => this.store.data.settings.claudePath || undefined })]);
  }

  /** Where the session's backend keeps its conversations. Only called for sessions that have one. */
  private conversationsOf(s: Pick<Session, 'backend'>) {
    const c = this.backendOf(s).conversations;
    if (!c) throw new Error('This agent keeps no conversations helm can read.');
    return c;
  }

  /** The backend a session runs on. */
  private backendOf(s: Pick<Session, 'backend'>): AgentBackend { return this.registry.get(s.backend); }

  get sessions() { return this.store.data.sessions; }
  private usd = (v: number, whole = false) => fmtMoney(v, this.store.data.settings.currency, this.store.data.fx.rates, { whole });
  /** Subscription limits or per-token cost: the user's setting for Claude, what the account reports for any other agent. */
  private billingOf(backend: string): 'subscription' | 'api' { return backend === 'claude' ? this.store.data.settings.billing : this.billings[backend] ?? 'subscription'; }
  setBilling(backend: string, b: 'subscription' | 'api') { this.billings[backend] = b; }
  get = (id: string) => this.sessions.find((s) => s.id === id);
  /** The session's repository. A free agent gets a stand-in whose folder is its own, so git commands there run in its folder. */
  repoOf = (s: Session) => (s.free ? freeRepo(s.worktree) : this.store.data.repos.find((r) => r.id === s.repoId)!);
  private touch() {
    this.store.save();
    this.hooks.emitState();
    if (this.sessions.some((s) => s.queued)) void this.pumpQueue();
  }

  /** Ids of sessions that were working when helm last closed, found by `recover`. */
  private interruptedByQuit: string[] = [];
  /** Called once at startup: nothing is running, so nothing should claim to be. */
  recover() {
    for (const s of this.sessions) {
      s.preparing = undefined;
      s.subagents ||= [];
      for (const a of s.subagents) if (a.status === 'working') { a.status = 'stopped'; a.endedAt = a.endedAt ?? Date.now(); }
      if (s.status === 'attention' && s.ask) {
        // Still waiting on the user. Its process is gone, but the question stands: answering it resumes the session.
        s.ask.orphaned = true;
      } else if (s.status === 'working' || s.status === 'attention') {
        if (s.status === 'working' && !s.queued) this.interruptedByQuit.push(s.id);
        s.status = 'idle';
        s.step = 'Stopped when helm closed';
        s.ask = undefined;
        s.timeline.push({ t: Date.now(), status: 'idle' });
      }
    }
  }

  // ---------------------------------------------------------------- transcript
  private async push(id: string, ev: TranscriptEvent): Promise<number> {
    const t = await this.store.transcript(id);
    ev.at ??= Date.now();
    t.push(ev);
    this.store.saveTranscript(id);
    this.hooks.emitTranscript(id, t.length - 1, ev);
    return t.length - 1;
  }
  private async patch(id: string, index: number, ev: TranscriptEvent) {
    const t = await this.store.transcript(id);
    t[index] = ev;
    this.store.saveTranscript(id);
    this.hooks.emitTranscript(id, index, ev);
  }

  private activity(s: Session, kind: ActivityEvent['kind'], what: string, extra: { who?: string; human?: boolean; detail?: string; ok?: boolean } = {}) {
    this.store.log({ kind, who: s.id, what, repo: this.repoOf(s)?.name || '', sessionId: s.id, ...extra });
  }

  /** The person who asked for something: their GitHub login, or `you`. */
  private me() { return this.store.data.user?.login || 'you'; }

  private setStatus(s: Session, status: Status, step?: string) {
    if (s.status !== status) {
      s.lastAccess = Date.now();
      s.status = status;
      s.timeline.push({ t: Date.now(), status });
      if (status === 'ready' || status === 'idle' || status === 'error') s.endedAt = Date.now();
      else s.endedAt = undefined;
    }
    if (step != null) s.step = step;
    this.touch();
  }

  // ---------------------------------------------------------------- create
  async create(input: NewSessionInput, extra: CreateExtra = {}): Promise<string> {
    this.held = false;
    const free = input.repoId === FREE_ID;
    const cfg = this.cfg(input.repoId);
    const backendId = this.registry.get(input.backend || cfg.defaultBackend).id;
    const on = this.store.data.settings.enabledAgents;
    if (on && !on.includes(backendId)) throw new Error(`${this.registry.get(backendId).label} is turned off. Turn it on under Settings → Agents, or pick another agent.`);
    const modelId = this.registry.model(backendId, input.model).id;
    for (const a of input.panel || []) this.panelSeat(a);
    const repo = free ? undefined : this.store.data.repos.find((r) => r.id === input.repoId);
    if (!free && !repo) throw new Error('Repository not found');
    const st = cfg;
    let id = slug(input.task);
    // Transcripts and uploads are saved by id alone, so a name must be unique among all sessions, not just those of one repository.
    const taken = (n: string) => this.sessions.some((s) => s.id === n);
    for (let n = 2; taken(id); n++) id = slug(input.task) + '-' + n;
    // First, so a file that is refused stops the session before any worktree is made.
    const uploads = await this.saveUploads(id, input.files);
    let branch = '', wt = '', remoteBase = '';
    let agentSessionId: string | undefined;
    const extras: ExtraRepo[] = [];
    if (free) {
      // A folder of its own: one helm makes (with local git, so changes and checkpoints work), or one of yours, left as it is.
      if (input.folder) {
        wt = expandHome(input.folder);
        if (!(await stat(wt).then((x) => x.isDirectory(), () => false))) throw new Error('That folder does not exist.');
      } else {
        wt = join(expandHome(st.freeRoot), id);
        await G.initScratch(wt);
        remoteBase = 'main';
      }
    } else {
      branch = st.branchPrefix + id;
      wt = join(expandHome(st.worktreeRoot), repo!.name, id);
      // A repository that arrived by sync has no clone on this machine yet.
      if (!(await G.fileExists(repo!.localPath))) await G.clone(`https://github.com/${repo!.id}.git`, repo!.localPath);
      if (st.fetchBeforeSession) await G.git(repo!.localPath, 'fetch', 'origin', '--prune').catch(() => undefined);
      // `main` means the local branch, `origin/main` the one on GitHub. A bare name that only exists on GitHub falls back to it.
      const isLocal = !input.base.startsWith('origin/') && (await G.gitOk(repo!.localPath, 'rev-parse', '--verify', '--quiet', 'refs/heads/' + input.base));
      remoteBase = input.base.startsWith('origin/') || isLocal ? input.base : (await G.gitOk(repo!.localPath, 'rev-parse', '--verify', 'origin/' + input.base)) ? 'origin/' + input.base : input.base;
      await G.addWorktree(repo!.localPath, wt, branch, extra.seed ? await checkpointParent(repo!.localPath, extra.seed) : remoteBase);
      if (extra.seed) await seedFromCheckpoint(wt, extra.seed);
      await this.copyUntracked(repo!.localPath, wt, st.copyFiles);
      try {
        for (const rid of new Set(input.extraRepos || [])) {
          if (rid === repo!.id) continue;
          const er = this.store.data.repos.find((r) => r.id === rid);
          if (!er) throw new Error('Repository not found: ' + rid);
          extras.push(await this.addExtra(er, id, branch));
        }
        agentSessionId = await extra.conversation?.(wt);
      } catch (e) {
        await G.removeWorktree(repo!.localPath, wt, branch);
        for (const x of extras) await G.removeWorktree(this.store.data.repos.find((r) => r.id === x.repoId)!.localPath, x.worktree, x.branch);
        throw e;
      }
    }

    const now = Date.now();
    const s: Session = {
      id, repoId: free ? FREE_ID : repo!.id, free: free ? { managed: !input.folder } : undefined, status: 'working', task: input.task, step: 'Starting', branch, base: remoteBase, worktree: wt,
      backend: backendId, model: modelId, permMode: input.permMode, startedAt: now, owner: { id: this.store.data.instanceId, at: now }, tokens: { input: 0, output: 0, cacheRead: 0 }, cost: 0, budget: input.budget,
      lastAccess: now, ctx: 0, add: 0, del: 0, files: 0, filesTouched: {}, timeline: [{ t: now, status: 'working' }], commits: [], removeAfterMerge: st.removeAfterMerge, deleteBranchAfterMerge: st.deleteBranchAfterMerge, subagents: [],
      extras: extras.length ? extras : undefined, uploads, agentSessionId, effort: extra.effort, parentId: extra.parentId, group: extra.group, source: extra.source
    };
    s.source ??= input.source;
    for (const a of input.panel || []) this.join(s, a, 0);
    s.automation = input.automation;
    s.effort ??= input.effort ?? (st.defaultEffort !== 'default' ? st.defaultEffort : undefined);
    // Wait when another session has to be merged first, or when too many sessions are already working.
    const wait = input.after ? { after: input.after, since: now } : { since: now };
    s.queued = wait;
    const blocked = queueBlock(s, [...this.sessions, s], this.runningCount(), st.maxRunning);
    s.queued = blocked ? wait : undefined;
    if (blocked) { s.status = 'idle'; s.step = 'Queued. ' + blocked; s.timeline = [{ t: now, status: 'idle' }]; }
    this.sessions.push(s);
    this.activity(s, 'start', blocked ? `queued: ${blocked.toLowerCase()}` : free ? `started in ${wt}` : `started on ${branch}`);
    const pics = input.images?.length ? input.images : undefined;
    await this.push(id, { k: 'user', t: now, text: input.task, images: pics, cp: await this.checkpoint(s, 'Start: ' + input.task) });
    if (blocked && pics) this.queuedImages.set(id, pics);
    // Big fixtures take a while to copy: that goes on in the background, so the session exists (and its transcript opens) at once.
    const prep = free ? undefined : await this.prepareFixtures(s, !!blocked);
    if (blocked) { this.touch(); return id; }
    this.touch();
    if (prep) void this.kickoff(s, input.task, pics, 0).catch((e) => this.setStatus(s, 'error', trunc(String(e?.message || e), 120)));
    else await this.kickoff(s, input.task, pics, 0);
    return id;
  }

  /** Sessions whose repository fixtures are still being copied in. The agent does not start until its entry settles. */
  private preparing = new Map<string, Promise<void>>();

  /**
   * Copies the repositories' uploaded files into a new session's worktrees, in the background, with progress on `s.preparing`.
   * Returns the work in progress (boxed, so awaiting this method does not wait for the copy), or nothing when there are no fixtures to copy.
   */
  private async prepareFixtures(s: Session, queued: boolean): Promise<{ run: Promise<void> } | undefined> {
    const targets = [{ repoId: s.repoId, wt: s.worktree }, ...(s.extras || []).map((x) => ({ repoId: x.repoId, wt: x.worktree }))];
    const sizes = await Promise.all(targets.map(async (t) => (await listRepoFixtures(t.repoId)).reduce((n, f) => n + (f.shared ? 0 : f.size), 0)));
    const total = sizes.reduce((n, x) => n + x, 0);
    if (!total) {
      // Nothing to copy; shared files are only linked, which is instant.
      for (const t of targets) await supplyRepoFixtures(t.repoId, t.wt, true);
      return undefined;
    }
    s.preparing = { done: 0, total };
    if (!queued) s.step = 'Preparing fixtures';
    let lastEmit = 0;
    const run = (async () => {
      try {
        for (const t of targets) {
          await supplyRepoFixtures(t.repoId, t.wt, true, (n) => {
            s.preparing!.done = Math.max(0, Math.min(total, s.preparing!.done + n));
            const now = Date.now();
            if (now - lastEmit > 250) { lastEmit = now; this.hooks.emitState(); }
          });
        }
      } finally {
        s.preparing = undefined;
        if (s.step === 'Preparing fixtures') s.step = 'Starting';
        this.preparing.delete(s.id);
        this.touch();
      }
    })();
    this.preparing.set(s.id, run);
    return { run };
  }

  /** A worktree in another repository for a multi-repo session, on a branch of its own off that repository's default branch. */
  private async addExtra(repo: Repo, id: string, branch: string): Promise<ExtraRepo> {
    const wt = join(expandHome(this.store.data.settings.worktreeRoot), repo.name, id);
    await G.git(repo.localPath, 'fetch', 'origin', '--prune').catch(() => undefined);
    const base = (await G.gitOk(repo.localPath, 'rev-parse', '--verify', '--quiet', 'origin/' + repo.defaultBranch)) ? 'origin/' + repo.defaultBranch : repo.defaultBranch;
    await G.addWorktree(repo.localPath, wt, branch, base);
    await this.copyUntracked(repo.localPath, wt, this.store.data.settings.copyFiles);
    return { repoId: repo.id, branch, base, worktree: wt };
  }

  // ---------------------------------------------------------------- queue
  /** Sessions with an agent at work. A session waiting on you does not use a slot. */
  private runningCount() { return this.sessions.filter((s) => s.status === 'working' && this.rt.has(s.id)).length; }
  private pumping = false;
  /** Images attached to a task that is still waiting in the queue. Kept in memory only. */
  private queuedImages = new Map<string, MessageImage[]>();

  /** Starts queued sessions whose wait is over, oldest first. Runs whenever anything changes. */
  async pumpQueue() {
    if (this.pumping || this.quitting || this.held) return;
    this.pumping = true;
    try {
      for (const s of queueOrder(this.sessions)) {
        if (queueBlock(s, this.sessions, this.runningCount(), this.store.data.settings.maxRunning)) continue;
        await this.release(s);
      }
    } finally { this.pumping = false; }
  }

  private async release(s: Session) {
    const after = s.queued?.after;
    s.queued = undefined;
    if (after && !s.worktreeGone) {
      // It waited for another session's merge: bring its (still untouched) branch up to the base as it is now.
      await G.git(this.repoOf(s).localPath, 'fetch', 'origin', '--prune').catch(() => undefined);
      await G.git(s.worktree, 'reset', '--hard', '-q', s.base).catch(() => undefined);
    }
    s.timeline.push({ t: Date.now(), status: 'working' });
    s.status = 'working';
    s.endedAt = undefined;
    s.step = 'Starting';
    this.activity(s, 'start', 'left the queue');
    this.store.save();
    this.hooks.emitState();
    const pics = this.queuedImages.get(s.id);
    this.queuedImages.delete(s.id);
    await this.kickoff(s, s.task, pics, 0);
  }

  /** Begins the session's first turn: its agent alone, or all the agents of a panel answering the task. */
  private async kickoff(s: Session, task: string, images: MessageImage[] | undefined, at: number) {
    if (s.panel) void this.queueRound(s, { at, text: task, images: images || [], to: [] });
    else await this.start(s, task, images);
  }

  /** Starts a queued session now, whatever it is waiting for. */
  async startNow(id: string) {
    const s = this.get(id);
    if (!s?.queued) return;
    await this.release(s);
  }

  /** Takes a session out of the queue without running it. */
  /** A queued merge could not go ahead: keep why on the session, so it shows in the inbox, and tell the user. */
  failQueuedMerge(id: string, error: string) {
    const s = this.get(id);
    if (!s?.queuedMerge || s.queuedMerge.error === error) return;
    s.queuedMerge.error = error;
    s.queuedMerge.errorAt = Date.now();
    this.activity(s, 'merge', 'queued merge failed', { who: 'helm', human: true, detail: error, ok: false });
    this.hooks.notify('failed', `${s.id}: queued merge failed`, trunc(error, 120), s.id);
    this.touch();
  }

  async dequeue(id: string) {
    const s = this.get(id);
    if (!s?.queued) return;
    s.queued = undefined;
    s.step = 'Not started';
    this.touch();
  }

  // ---------------------------------------------------------------- checkpoints, forks
  /** Saves the worktree as it is, before the agent acts on the next message. Failing to do so never blocks the message. */
  private async checkpoint(s: Session, label: string): Promise<number | undefined> {
    if (s.worktreeGone || (s.free && !s.free.managed)) return undefined;
    const n = (s.checkpoints || 0) + 1;
    try {
      await takeCheckpoint(s.worktree, s.id, n, trunc(label.replace(/\s+/g, ' ').trim(), 100));
      s.checkpoints = n;
      return n;
    } catch { return undefined; }
  }

  /** A checkpoint on demand, before something you are about to do by hand. */
  async snapshot(id: string, label: string) {
    const s = this.get(id);
    if (s) await this.checkpoint(s, label);
  }

  async checkpoints(id: string): Promise<Checkpoint[]> {
    const s = this.get(id);
    if (!s || s.worktreeGone) return [];
    return listCheckpoints(s.worktree, id);
  }

  async restoreTo(id: string, n: number) {
    const s = this.get(id);
    if (!s) throw new Error('Session not found');
    if (s.worktreeGone) throw new Error('This session\'s worktree is gone.');
    if (this.rt.has(id) && (s.status === 'working' || s.status === 'attention')) throw new Error('Stop the session first: restoring while the agent is working would pull files out from under it.');
    const cp = (await listCheckpoints(s.worktree, id)).find((c) => c.n === n);
    if (!cp) throw new Error('That checkpoint no longer exists.');
    const safety = await this.checkpoint(s, `Before restoring to checkpoint ${n}`);
    await restoreCheckpoint(s.worktree, cp.commit);
    s.agentNote = `Note from helm: the user restored your worktree to how it was at: "${cp.label.replace(/^Start: |^Before: /, '')}". Everything changed after that point has been undone, commits included, and uncommitted files were replaced. Do not assume later edits exist; re-read files before changing them.`;
    s.stuck = undefined;
    s.fileEdits = undefined;
    await this.push(id, { k: 'note', tone: 'neutral', text: `Restored the worktree to checkpoint ${n} (${cp.label.replace(/^Start: |^Before: /, '')}).${safety ? ` Checkpoint ${safety} holds what it was before, so this can be undone.` : ''}` });
    await this.refreshStats(s);
    this.touch();
  }

  async fork(id: string, index: number | null, task: string): Promise<string> {
    const s = this.get(id);
    if (!s) throw new Error('Session not found');
    if (s.free) throw new Error('Free agents cannot be forked yet: there is no repository to start the new session from.');
    if (!task.trim()) throw new Error('Say what the new session should do.');
    const t = await this.store.transcript(id);
    const ev = index != null ? t[index] : undefined;
    if (index != null && ev?.k !== 'user') throw new Error('Pick one of your messages to fork from.');
    let seed: string | undefined;
    if (ev?.k === 'user' && ev.cp && !s.worktreeGone) seed = (await listCheckpoints(s.worktree, id)).find((c) => c.n === ev.cp)?.commit;
    let upTo: string | null | undefined;
    if (ev?.k === 'user' && s.agentSessionId) {
      const occurrence = t.slice(0, index! + 1).filter((e) => e.k === 'user' && e.text.trim() === ev.text.trim()).length;
      upTo = await this.conversationsOf(s).messageBefore(s.agentSessionId, s.worktree, ev.text, occurrence);
      if (upTo === undefined) throw new Error('Could not find that message in the agent\'s conversation, so it cannot be forked from there.');
    }
    const conversation = s.agentSessionId && upTo !== null
      ? (wt: string) => this.conversationsOf(s).fork({ sourceId: s.agentSessionId!, sourceDir: s.worktree, destDir: wt, upToMessageId: upTo ?? undefined, title: `Fork of ${sessionTitle(s)}` })
      : undefined;
    return this.create({ repoId: s.repoId, base: seed || s.worktreeGone ? s.base : s.branch, task: task.trim(), backend: s.backend, model: s.model, budget: s.budget, permMode: s.permMode }, { seed, conversation, parentId: s.id, effort: s.effort });
  }

  async continueExternal(repoId: string, externalId: string, task: string): Promise<string> {
    const repo = this.store.data.repos.find((r) => r.id === repoId);
    if (!repo) throw new Error('Repository not found');
    if (!task.trim()) throw new Error('Say what the session should do next.');
    const st0 = this.cfg(repoId);
    const be = this.registry.get(st0.defaultBackend);
    const store = this.conversationsOf({ backend: be.id });
    const info = await store.info(externalId);
    if (!info) throw new Error('That session could not be found.');
    if (info.size > 300 * 1024 * 1024) throw new Error('That conversation file is over 300 MB, too big to copy. Start a new session and tell it what you were doing.');
    const dir = info.cwd || repo.localPath;
    const st = st0;
    // Carry on from the branch it was on when that still exists, otherwise from the default branch.
    const branch = info.branch;
    let base = repo.defaultBranch;
    if (branch && !branch.startsWith(st.branchPrefix)) {
      if (await G.gitOk(repo.localPath, 'rev-parse', '--verify', '--quiet', 'refs/heads/' + branch)) base = branch;
      else if (await G.gitOk(repo.localPath, 'rev-parse', '--verify', '--quiet', 'refs/remotes/origin/' + branch)) base = 'origin/' + branch;
    }
    return this.create({ repoId, base, task: task.trim(), backend: be.id, model: st.defaultModel, budget: st.sessionBudget, permMode: st.permMode },
      { conversation: (wt) => store.fork({ sourceId: externalId, sourceDir: dir, destDir: wt, title: `${info.title || info.summary || 'Session'} (in helm)` }) });
  }

  async createGroup(input: NewSessionInput, variants: { backend?: string; model: ModelAlias; effort?: Effort }[]): Promise<string[]> {
    if (variants.length < 2) throw new Error('Pick at least two variants to compare.');
    if (input.repoId === FREE_ID) throw new Error('Comparing runs needs a repository.');
    const group = uid();
    const ids: string[] = [];
    // One after another: each session's name is made unique against the ones that exist.
    for (const v of variants.slice(0, 6)) ids.push(await this.create({ ...input, backend: v.backend ?? input.backend, model: v.model }, { group, effort: v.effort }));
    return ids;
  }

  async keepFromGroup(group: string, keepId: string) {
    const mine = this.sessions.filter((s) => s.group === group);
    if (!mine.some((s) => s.id === keepId)) throw new Error('That session is not in the group.');
    for (const s of mine) {
      if (s.id === keepId) continue;
      await this.stop(s.id);
      s.archivedAt = Date.now();
      s.archivedAuto = undefined;
      this.dismissAllArtifacts(s);
    }
    this.touch();
  }

  // ---------------------------------------------------------------- self review
  async review(id: string) {
    const s = this.get(id);
    if (!s) throw new Error('Session not found');
    if (s.free) throw new Error('A free agent has no branch to review.');
    if (s.worktreeGone) throw new Error('This session\'s worktree is gone.');
    if (s.review?.state === 'running') return;
    const head = (await G.git(s.worktree, 'rev-parse', '--short', 'HEAD').catch(() => '')).trim();
    s.review = { at: Date.now(), state: 'running', head, summary: '', findings: [] };
    this.touch();
    void this.runReview(s, head);
  }

  /** The review model from settings when this session's agent offers it, otherwise the session's own. */
  private reviewModelOf(s: Session): string {
    const want = this.store.data.settings.reviewModel;
    return want && this.backendOf(s).models.some((m) => m.id === want) ? want : s.model;
  }

  private async runReview(s: Session, head: string) {
    const { structured, text, cost, failure } = await this.backendOf(s).review({ cwd: s.worktree, model: this.reviewModelOf(s), prompt: reviewPrompt(s.task, s.base, messageBody(this.cfg(s.repoId), 'selfReview')), schema: REVIEW_SCHEMA });
    if (cost) { this.store.addUsage(s.repoId, cost, 0); this.store.addDaily(s.repoId, s.model, { cost }); }
    const parsed = failure ? null : parseReview(structured, text);
    s.review = parsed
      ? { at: Date.now(), state: 'done', head, summary: parsed.summary, findings: parsed.findings, cost }
      : { at: Date.now(), state: 'failed', head, summary: failure || 'The reviewer did not return a usable answer.', findings: [], cost };
    this.activity(s, 'ready', parsed ? `reviewed: ${parsed.findings.filter((f) => f.severity === 'blocker').length} blockers, ${parsed.findings.length} findings` : 'review failed');
    this.touch();
  }

  setReviewed(id: string, ids: string[], reviewed: boolean) {
    const s = this.get(id);
    if (!s) return;
    const set = new Set(s.reviewed || []);
    for (const h of ids) reviewed ? set.add(h) : set.delete(h);
    s.reviewed = [...set].slice(-2000);
    this.touch();
  }

  // ---------------------------------------------------------------- run
  /** Writes the files uploaded for one session to a folder of its own, outside the worktree so they are never committed. */
  private async saveUploads(id: string, files: NewSessionInput['files']): Promise<Session['uploads']> {
    if (!files?.length) return undefined;
    if (files.length > MAX_UPLOAD_FILES) throw new Error(`At most ${MAX_UPLOAD_FILES} files can be uploaded.`);
    const dir = join(this.store.root, 'uploads', id);
    const saved: { name: string; size: number }[] = [];
    let total = 0;
    try {
      await mkdir(dir, { recursive: true });
      for (const f of files) {
        const buf = Buffer.from(f.data, 'base64');
        total += buf.length;
        if (total > MAX_UPLOAD_TOTAL) throw new Error(`The files add up to more than ${MAX_UPLOAD_TOTAL / 1048576} MB.`);
        // A bare file name, never a path, and never one that replaces an earlier file.
        const base = (f.name.split(/[\\/]/).pop() || '').replace(/[\u0000-\u001f]/g, '').trim().replace(/^\.+$/, '') || 'file';
        const dot = base.lastIndexOf('.') > 0 ? base.lastIndexOf('.') : base.length;
        let name = base;
        for (let n = 2; saved.some((x) => x.name === name); n++) name = `${base.slice(0, dot)}-${n}${base.slice(dot)}`;
        await writeFile(join(dir, name), buf);
        saved.push({ name, size: buf.length });
      }
    } catch (e) { await rm(dir, { recursive: true, force: true }).catch(() => undefined); throw e; }
    return { dir, files: saved };
  }

  private systemAppend(s: Session, artifacts: string): string {
    return [this.baseSystem(s, artifacts), s.panel ? panelInstructions(s.panel, s.panel.owner, this.store.data.settings.panelReplyCap) : ''].filter(Boolean).join('\n');
  }

  private baseSystem(s: Session, artifacts: string): string {
    const uploaded = s.uploads ? `The user uploaded ${s.uploads.files.length === 1 ? 'a file' : 'files'} for this task alone, in ${s.uploads.dir}: ${s.uploads.files.map((f) => f.name).join(', ')}. Read them from there; they are outside your working directory on purpose, so do not copy them into it unless the task needs that.` : '';
    return [this.baseAppend(s, artifacts), uploaded].filter(Boolean).join('\n');
  }

  private baseAppend(s: Session, artifacts: string): string {
    const st = this.cfg(s.repoId);
    const art = `To hand the user a file (a generated image, chart, report, export), write it to ${artifacts} (not into the worktree), then link it in your reply as [label](artifact:file.ext), using a plain file name without spaces. For an image use ![description](artifact:file.png) and helm shows it in the chat; any other file becomes a download button. These files are temporary and are deleted with the session.`;
    // Claude has a dedicated question tool and helm limits its subagents; another agent is simply told to ask, and manages its own helpers.
    const be = this.backendOf(s);
    const ask = be.id === 'claude' ? 'ask with the AskUserQuestion tool' : 'ask the user';
    const subs = be.capabilities.subagents;
    if (s.free) {
      return [
        `You are a free agent running inside helm: you are not tied to any repository. Your working directory is ${s.worktree}.`,
        s.free.managed
          ? 'It is a folder made for this task alone. git is set up in it so the user can see what you changed; you may commit, but you do not have to. There is no remote, so do not push or open pull requests.'
          : 'It is one of the user\'s own folders, and you are working in it directly with nothing to undo your changes, so be careful with anything destructive. Do not push or open pull requests unless asked.',
        `Stay in this directory unless the user asks you to work elsewhere. If you need a decision from the user, ${ask} instead of guessing.`,
        art,
        subs ? `Subagents: at most ${this.sessionLimit(s)} may run at once in this session. Start independent work in parallel only within that limit. ${HAND_BACK}` : ''
      ].filter(Boolean).join('\n');
    }
    const others = (s.extras || []).map((x) => `- ${x.repoId}: ${x.worktree} (branch ${x.branch}, based on ${x.base})`);
    return [
      `You are running inside helm, working in an isolated git worktree on branch ${s.branch} (based on ${s.base}). Stay inside this directory.`,
      others.length ? `This session spans more than one repository. Besides this one (${s.repoId}), you have a worktree in each of these, which you may read and edit and commit in (use git -C <path>):\n${others.join('\n')}\nCommit in each repository whose files you changed; each one gets its own pull request.` : '',
      'Commit as you go: make a commit each time a coherent piece of work is done and working, rather than one big commit at the end. Keep commits small with clear messages.',
      st.commitStyle === 'conventional' ? 'Write commit messages as conventional commits: "type(scope): summary" with a type such as feat, fix, docs, refactor, test or chore, a summary in the imperative under 72 characters, and the scope optional.' : '',
      st.signCommits === 'on' ? 'Commits are signed automatically. Never turn signing off with --no-gpg-sign; if a commit fails because it could not be signed, say so rather than working around it.' : '',
      !st.commitTrailer ? '' : st.commitAuthor === 'sole'
        ? `End every commit message with a blank line and this trailer: "Helm-Session: ${s.id}". Do not add any Co-authored-by trailer. The commits are authored by ${this.backendOf(s).shortName} alone.`
        : `End every commit message with a blank line and this trailer: "Co-authored-by: helm session ${s.id} <noreply@helm.app>".`,
      st.autoPush && !s.free
        ? `Do not push and do not open pull requests. helm pushes your branch to GitHub ${st.pushWhen === 'ready' ? 'when you finish' : 'after each commit'}, and the user opens the pull request from helm.`
        : 'Do not push and do not open pull requests; the user does that from helm after reviewing your changes.',
      `If you need a decision from the user, ${ask} instead of guessing.`,
      art,
      subs ? `Subagents: at most ${this.sessionLimit(s)} may run at once in this session and ${this.repoLimit(s)} across the repository. Start independent work in parallel only within those limits. ${HAND_BACK}` : '',
      st.runTests ? 'Before you finish, run the project\'s tests (from package.json, go.mod, Makefile or equivalent) when they exist, and state the result.' : '',
      st.defaultInstructions.trim() ? `The user's standing instructions for every session:\n${st.defaultInstructions.trim()}` : ''
    ].filter(Boolean).join('\n');
  }

  private async start(s: Session, first?: string, firstImages: MessageImage[] = [], turn?: { reply?: ReplyRef; done?: (r: { text: string; index: number }) => void }) {
    const settings = this.store.data.settings;
    await this.preparing.get(s.id);
    const artifacts = await ensureArtifactDir(s.id);
    // A worktree made before a file was uploaded gets it when the agent next starts. Files already there are left as the agent has them.
    if (!s.free) await supplyRepoFixtures(s.repoId, s.worktree, false);
    for (const x of s.extras || []) await supplyRepoFixtures(x.repoId, x.worktree, false);
    const rt: Runtime = { agent: null as any, asks: new Map(), turnCost: 0, baseCost: s.cost, startCost: s.cost, interrupted: false, budgetPaused: false, lastEventAt: Date.now(), toolStart: new Map(), fails: new Map(), lastTools: new Map(), subEvent: new Map(), admitted: new Set(), turnText: [], lastText: -1, turnWaiters: turn?.done ? [turn.done] : [], reply: turn?.reply };
    rt.agent = this.backendOf(s).start({
      cwd: s.worktree, model: s.model, effort: s.effort, permMode: s.permMode,
      systemAppend: this.systemAppend(s, artifacts),
      resume: s.agentSessionId,
      extraDirs: [...(s.uploads ? [s.uploads.dir] : []), ...(s.extras || []).map((x) => x.worktree)],
      env: { ...parseEnv(settings.agentEnv), ...(settings.signCommits === 'config' ? {} : { GIT_CONFIG_PARAMETERS: [process.env.GIT_CONFIG_PARAMETERS, ...G.signingConfig(settings.signCommits).map((c) => `'${c}'`)].filter(Boolean).join(' ') }), ...(settings.commitAuthor === 'sole' ? { GIT_AUTHOR_NAME: this.backendOf(s).identity.name, GIT_AUTHOR_EMAIL: this.backendOf(s).identity.email } : {}) },
      remoteControl: settings.remoteControl,
      subagentLimit: this.sessionLimit(s),
      mcpServers: mcpConfig(settings.mcpServers, this.store.data.repos.find((r) => r.id === s.repoId)?.mcpServers),
      canUseTool: (tool, input, o) => this.canUse(s, rt, tool, input, o),
      admitSubagent: (id) => this.checkSubagentLimit(s, rt, id)
    });
    this.rt.set(s.id, rt);
    if (first) rt.agent.send(first, firstImages);
    void this.consume(s, rt);
  }

  private async consume(s: Session, rt: Runtime) {
    try {
      for await (const ev of rt.agent.events) await this.onEvent(s, rt, ev);
    } catch (e: any) {
      if (!rt.agent.closed) {
        s.error = String(e?.message || e);
        logLine('error', `session ${s.id} failed: ${e?.stack || s.error}`);
        await this.push(s.id, { k: 'note', tone: 'error', text: s.error! });
        this.setStatus(s, 'error', trunc(s.error!, 120));
        this.activity(s, 'error', 'failed: ' + trunc(s.error!, 80));
        this.hooks.notify('failed', `${s.id} failed`, trunc(s.error!, 120), s.id);
      }
    } finally {
      if (this.rt.get(s.id) === rt) this.rt.delete(s.id);
      this.endTurn(rt);
      if (this.quitting) return;
      this.stopSubagents(s);
      for (const w of rt.asks.values()) w.resolve({ behavior: 'deny', message: 'Session ended' });
      if (s.status === 'working' || s.status === 'attention') this.setStatus(s, 'idle', 'Stopped');
      s.ask = undefined;
      await this.refreshStats(s);
    }
  }

  private async onEvent(s: Session, rt: Runtime, ev: AgentEvent) {
    rt.lastEventAt = Date.now();
    if (s.stuck?.startsWith(STALLED)) { s.stuck = undefined; this.touch(); }
    switch (ev.t) {
      case 'init':
        s.agentSessionId = ev.sessionId;
        s.modelName = ev.model;
        {
          const st = this.store.data.settings;
          // A Claude login reports no API key; an API key means tokens are paid for.
          if (this.backendOf(s).id !== 'claude') { if (ev.billing) this.billings[this.backendOf(s).id] = ev.billing; }
          else if (!st.billingDetected && ev.billing) { st.billing = ev.billing; st.billingDetected = true; }
        }
        this.touch();
        return;
      case 'subagent_started': {
        const a = s.subagents.find((x) => x.id === ev.id);
        if (a) { a.agentId = ev.agentId; this.touch(); }
        return;
      }
      case 'subagent_progress': return this.onTaskProgress(s, ev);
      case 'subagent_done': return this.onTaskDone(s, rt, ev);
      case 'plan_usage': return this.onPlanUsage(s, ev);
      case 'assistant': return this.onAssistant(s, rt, ev);
      case 'tool_results': return this.onToolResults(s, rt, ev.results);
      case 'result': { await this.onResult(s, rt, ev); this.endTurn(rt); return; }
    }
  }

  /** The owner's turn is over: hands whoever is waiting for it what it said. */
  private endTurn(rt: Runtime) {
    const r = { text: rt.turnText.join('\n\n').trim(), index: rt.lastText };
    rt.turnText = [];
    rt.reply = undefined;
    for (const w of rt.turnWaiters.splice(0)) w(r);
  }

  private async onAssistant(s: Session, rt: Runtime, m: Extract<AgentEvent, { t: 'assistant' }>) {
    const parent: string | null = m.parentId;
    const sub = parent ? s.subagents.find((x) => x.id === parent) : undefined;
    if (parent && !sub) return;
    if (!parent) this.resumeWorking(s);
    const tkey = sub ? `${s.id}~${sub.id}` : s.id;
    const u = m.usage;
    if (u) {
      const inp = u.input + u.cacheWrite;
      s.tokens.input += inp;
      s.tokens.output += u.output;
      s.tokens.cacheRead += u.cacheRead;
      this.store.addLifetimeTokens(s.repoId, inp, u.output, u.cacheRead);
      if (!sub) { s.ctx = inp + u.cacheRead; if (u.contextWindow) s.ctxMax = u.contextWindow; }
      else sub.tokens += inp + u.output;
      const [pi, po] = this.registry.model(s.backend, s.model).price;
      const est = (u.input * pi + u.cacheWrite * pi * 1.25 + u.cacheRead * pi * 0.1 + u.output * po) / 1e6;
      rt.turnCost += est;
      this.store.addUsage(s.repoId, est, inp + u.output);
      this.store.addDaily(s.repoId, s.model, { cost: est, input: inp, output: u.output, cacheRead: u.cacheRead });
      s.cost = rt.baseCost + rt.turnCost;
    }
    for (const b of m.blocks) {
      if (b.type === 'text') {
        const owned = s.panel && !sub;
        const at = await this.push(tkey, { k: 'agent', text: b.text, ...(owned ? { from: s.panel!.owner, ...(rt.reply ? { re: rt.reply } : {}) } : {}) });
        if (!sub) { rt.turnText.push(b.text); rt.lastText = at; }
        this.collectArtifacts(s, b.text);
      } else if (b.type === 'tool_use') {
        await this.onToolUse(s, rt, b, tkey, sub);
      }
    }
    this.touch();
    await this.checkBudget(s, rt);
  }

  private async startSubagent(s: Session, rt: Runtime, b: Extract<AgentBlock, { type: 'tool_use' }>, tkey: string, parentSub?: Subagent) {
    const input = b.input || {};
    const now = Date.now();
    const a: Subagent = {
      id: b.id, parentId: parentSub?.id ?? null, description: trunc(String(input.description || 'Subagent'), 80),
      agentType: String(input.subagent_type || 'general-purpose'), status: 'working', startedAt: now, tools: 0, tokens: 0, background: !!input.run_in_background
    };
    s.subagents.push(a);
    const idx = await this.push(tkey, { k: 'subagent', id: a.id, description: a.description, agentType: a.agentType, status: 'working' });
    rt.subEvent.set(a.id, { tkey, idx });
    rt.toolStart.set(b.id, { t: now, idx, kind: 'subagent', input, tkey, name: 'Agent' });
    await this.push(`${s.id}~${a.id}`, { k: 'user', t: now, text: String(input.prompt || ''), from: parentSub ? parentSub.description : s.id });
    s.step = 'Subagent: ' + a.description;
    this.activity(s, 'start', `started subagent “${trunc(a.description, 60)}”`);
    this.touch();
  }

  private async patchSubagent(rt: Runtime, a: Subagent) {
    const loc = rt.subEvent.get(a.id);
    if (loc) await this.patch(loc.tkey, loc.idx, { k: 'subagent', id: a.id, description: a.description, agentType: a.agentType, status: a.status, summary: a.summary });
  }

  private async finishSubagent(s: Session, rt: Runtime, a: Subagent, status: Subagent['status']) {
    a.status = status;
    a.endedAt = Date.now();
    // Handed back with nothing for the owner to review: the parent has what it needs, so tidy the subagent away.
    if (status === 'done' && !a.changed) a.archived = true;
    rt.admitted.delete(a.id);
    await this.syncSubagent(s, a);
    await this.patchSubagent(rt, a);
    this.scheduleStats(s, rt);
    this.touch();
  }

  /** A subagent (and the ones above it) changed files, so it is not archived when it hands back. */
  private markChanged(s: Session, sub?: Subagent) {
    for (let a = sub; a && !a.changed; a = a.parentId ? s.subagents.find((x) => x.id === a!.parentId) : undefined) a.changed = true;
  }

  private subSyncAt = new Map<string, number>();

  private async onTaskProgress(s: Session, m: Extract<AgentEvent, { t: 'subagent_progress' }>) {
    const a = s.subagents.find((x) => x.id === m.id);
    if (!a) return;
    a.tools = m.tools ?? a.tools;
    a.tokens = m.tokens ?? a.tokens;
    if (m.lastTool && a.status === 'working') s.step = `${a.description}: ${m.lastTool}`;
    this.touch();
    // Claude Code does not stream a subagent's own messages, so read them from its transcript now and then.
    const last = this.subSyncAt.get(a.id) ?? 0;
    if (Date.now() - last > 4000) {
      this.subSyncAt.set(a.id, Date.now());
      void this.syncSubagent(s, a);
    }
  }

  /** Claude Code writes a subagent's file lazily, often only once the whole turn is over. */
  async refreshSubagent(id: string, subId: string) {
    const s = this.get(id);
    const a = s?.subagents.find((x) => x.id === subId);
    if (s && a) await this.syncSubagent(s, a);
  }

  private subSync = new Map<string, Promise<void>>();

  /** Rebuilds a subagent's transcript from Claude Code's saved session file. Runs one at a time per subagent so a slow, older read can't overwrite a newer one. */
  private syncSubagent(s: Session, a: Subagent): Promise<void> {
    const prev = this.subSync.get(a.id) ?? Promise.resolve();
    const next = prev.then(() => this.doSyncSubagent(s, a), () => this.doSyncSubagent(s, a));
    this.subSync.set(a.id, next);
    return next;
  }

  private async doSyncSubagent(s: Session, a: Subagent) {
    if (!s.agentSessionId || !a.agentId) return;
    try {
      const events = await this.conversationsOf(s).subagentTranscript(s.agentSessionId, a.agentId, s.worktree);
      const key = `${s.id}~${a.id}`;
      const t = await this.store.transcript(key);
      const next: TranscriptEvent[] = [...(t[0]?.k === 'user' ? [t[0]] : []), ...events];
      for (let i = 0; i < next.length; i++) {
        if (JSON.stringify(t[i]) !== JSON.stringify(next[i])) { t[i] = next[i]; this.hooks.emitTranscript(key, i, next[i]); }
      }
      t.length = next.length;
      this.store.saveTranscript(key);
    } catch { /* the session file may not be flushed yet; the next sync will catch up */ }
  }

  /** Kept for callers that hold a session manager; the conversion itself lives in transcript.ts. */
  convertMessages(msgs: any[], wt: string, withUser = false): TranscriptEvent[] { return convertMessages(msgs, wt, withUser); }

  private async onTaskDone(s: Session, rt: Runtime, m: Extract<AgentEvent, { t: 'subagent_done' }>) {
    const a = s.subagents.find((x) => x.id === m.id);
    if (!a || a.status !== 'working') return;
    if (m.summary) a.summary = trunc(String(m.summary).trim(), 600);
    await this.finishSubagent(s, rt, a, m.status === 'completed' ? 'done' : m.status);
    // The result goes back to the parent, which continues in a new turn even if its last one had ended.
    if (m.status === 'completed' || m.status === 'failed') this.resumeWorking(s, `Continuing with the result of ${a.description}`);
  }

  /** The agent is producing output again after a result (a subagent handed back and woke it): show the session as working, not finished. */
  private resumeWorking(s: Session, step?: string) {
    if (s.ask || s.archivedAt || s.mergedAt || (s.status !== 'idle' && s.status !== 'ready')) return;
    this.setStatus(s, 'working', step ?? 'Continuing');
  }

  private async onToolUse(s: Session, rt: Runtime, b: Extract<AgentBlock, { type: 'tool_use' }>, tkey: string, sub?: Subagent) {
    const input = b.input || {};
    const wt = s.worktree;
    const name: string = b.name;
    if (name === 'AskUserQuestion' || name === 'ExitPlanMode' || name === 'TodoWrite') return;
    if (sub) sub.tools++;
    this.countTool(s, name);
    if (name === 'Agent' || name === 'Task') return this.startSubagent(s, rt, b, tkey, sub);
    if (COMMAND_TOOLS.has(name)) {
      const cmd = String(input.command || '');
      const gitKind = /(^|&&|;|\|\|)\s*git\s+(?:-C\s+\S+\s+)?push\b/.test(cmd) ? 'push' : /(^|&&|;|\|\|)\s*git\s+(?:-C\s+\S+\s+)?(fetch|pull|merge|rebase|checkout|switch|branch|reset|stash|tag|clone|worktree|cherry-pick|revert)\b/.test(cmd) ? 'git' : 'bash';
      this.activity(s, gitKind, (sub ? `${sub.description}: ` : '') + 'ran ' + trunc(cmd.replace(/\s+/g, ' '), 110), { detail: cmd });
      const idx = await this.push(tkey, { k: 'bash', id: b.id, cmd, summary: commandSummary(cmd, input.description), out: '', ok: true, meta: '', done: false });
      rt.toolStart.set(b.id, { t: Date.now(), idx, kind: 'bash', input, tkey, name });
      s.step = (sub ? `${sub.description}: ` : '') + 'Running ' + trunc(cmd, 80);
      return;
    }
    if (EDIT_TOOLS.has(name)) {
      const file = rel(wt, String(input.file_path || input.notebook_path || ''));
      this.markChanged(s, sub);
      this.activity(s, 'edit', (sub ? `${sub.description}: ` : '') + `${name === 'Write' ? 'wrote' : 'edited'} ${file}`, { detail: file });
      const lines: [string, string][] = [];
      let add = 0, del = 0;
      const edits = name === 'MultiEdit' ? input.edits || [] : name === 'Edit' ? [input] : [];
      if (name === 'Write') {
        const content = String(input.content || '');
        const all = content.split('\n');
        add = content ? all.length - (content.endsWith('\n') ? 1 : 0) : 0;
        for (const l of all.slice(0, 24)) lines.push(['+', l]);
        if (all.length > 24) lines.push([' ', `… ${all.length - 24} more lines`]);
      } else {
        for (const e of edits) {
          const o = String(e.old_string || '').split('\n');
          const n = String(e.new_string || '').split('\n');
          if (e.old_string) { del += o.length; for (const l of o.slice(0, 12)) lines.push(['-', l]); }
          if (e.new_string) { add += n.length; for (const l of n.slice(0, 12)) lines.push(['+', l]); }
        }
      }
      const idx = await this.push(tkey, { k: 'edit', file, add, del, lines: lines.slice(0, 40) });
      rt.toolStart.set(b.id, { t: Date.now(), idx, kind: 'edit', input, tkey, name });
      s.step = (sub ? `${sub.description}: ` : '') + 'Editing ' + file;
      s.editing = { file, line: 1 };
      return;
    }
    const t = await this.store.transcript(tkey);
    const target = trunc(String(input.file_path ?? input.pattern ?? input.path ?? input.url ?? input.query ?? input.description ?? input.prompt ?? ''), 140);
    const item: [string, string, string] = [name, rel(wt, target), ''];
    const last = t[t.length - 1];
    let idx: number;
    if (last && last.k === 'tools' && rt.lastTools.get(tkey) === t.length - 1) {
      last.items.push(item);
      idx = t.length - 1;
      await this.patch(tkey, idx, last);
    } else {
      idx = await this.push(tkey, { k: 'tools', items: [item] });
      rt.lastTools.set(tkey, idx);
    }
    rt.toolStart.set(b.id, { t: Date.now(), idx: idx * 1000 + ((t[idx] as any).items.length - 1), kind: 'tool', input, tkey, name });
    const verb = ({ Read: 'Reading ', Grep: 'Searching ', Glob: 'Listing ', WebFetch: 'Fetching ', WebSearch: 'Searching the web for ' } as any)[name];
    s.step = (sub ? `${sub.description}: ` : '') + (verb ? verb + item[1] : 'Using ' + name);
  }

  private async onToolResults(s: Session, rt: Runtime, results: AgentToolResult[]) {
    for (const r of results) {
      const start = rt.toolStart.get(r.id);
      if (!start) continue;
      rt.toolStart.delete(r.id);
      const text = r.text;
      const b = { tool_use_id: r.id, is_error: r.isError };
      const secs = (Date.now() - start.t) / 1000;
      if (b.is_error && start.name) this.countTool(s, start.name, true);
      const meta = secs < 1 ? Math.round(secs * 1000) + 'ms' : secs < 60 ? secs.toFixed(1) + 's' : Math.floor(secs / 60) + 'm ' + Math.round(secs % 60) + 's';
      if (start.kind === 'bash') {
        const t = await this.store.transcript(start.tkey);
        const at = findBash(t, b.tool_use_id, start.idx);
        const cur = at >= 0 ? (t[at] as Extract<TranscriptEvent, { k: 'bash' }>) : undefined;
        const command = cur?.cmd ?? String(start.input?.command || '');
        // Only the last line is shown, so only the end of a huge output is looked at.
        const lines = (text.length > 20000 ? text.slice(-20000) : text).split('\n').map((l: string) => l.trim()).filter(Boolean);
        const out = b.is_error ? trunc(lines[lines.length - 1] || 'failed', 70) : lines.length ? trunc(lines[lines.length - 1], 70) : '✓';
        if (cur) await this.patch(start.tkey, at, { ...cur, out, ok: !b.is_error, meta, done: true });
        this.store.addAudit({ t: Date.now(), sessionId: s.id, repoId: s.repoId, kind: 'command', text: auditText(command), ok: !b.is_error });
        this.trackCommand(s, rt, command, !b.is_error);
        if (/git\s+commit/.test(command)) await this.detectCommit(s, text, start.tkey);
      } else if (start.kind === 'edit') {
        if (!b.is_error) {
          const file = rel(s.worktree, String(start.input.file_path || start.input.notebook_path || ''));
          this.store.addAudit({ t: Date.now(), sessionId: s.id, repoId: s.repoId, kind: 'edit', text: auditText(`${start.name} ${file}`) });
          this.trackEdit(s, file);
          await this.locateEdit(s, start.input);
          this.scheduleStats(s, rt);
        }
      } else if (start.kind === 'subagent') {
        const a = s.subagents.find((x) => x.id === b.tool_use_id);
        if (a) {
          a.summary = trunc(text.trim(), 600);
          // A background subagent's result is only a placeholder; it finishes with its task notification.
          // Claude Code reports a launch the same way when the agent definition runs in the background by itself.
          if (!b.is_error && /^Async agent launched/i.test(text.trim())) a.background = true;
          if (a.background && !b.is_error) await this.patchSubagent(rt, a);
          else await this.finishSubagent(s, rt, a, b.is_error ? 'failed' : 'done');
        }
      } else if (start.kind === 'tool') {
        const ti = Math.floor(start.idx / 1000), ii = start.idx % 1000;
        const t = await this.store.transcript(start.tkey);
        const cur = t[ti] as Extract<TranscriptEvent, { k: 'tools' }>;
        // The saved transcript of a subagent is rebuilt while it runs, so the event at this position may no longer be this tool group.
        if (cur?.k === 'tools' && cur.items[ii]) {
          const n = text.split('\n').filter(Boolean).length;
          cur.items[ii][2] = b.is_error ? 'failed' : cur.items[ii][0] === 'Read' ? `${text.split('\n').length} lines` : cur.items[ii][0] === 'Grep' || cur.items[ii][0] === 'Glob' ? `${n} ${n === 1 ? 'match' : 'matches'}` : meta;
          await this.patch(start.tkey, ti, cur);
        }
      }
    }
  }

  private countTool(s: Session, name: string, error = false) {
    const t = ((s.tools ||= {})[name] ||= { n: 0, err: 0 });
    if (error) t.err++; else t.n++;
  }

  private trackEdit(s: Session, file: string) {
    const edits = (s.fileEdits ||= {});
    if (!(file in edits) && Object.keys(edits).length >= 200) return;
    edits[file] = (edits[file] || 0) + 1;
    this.setStuck(s, stuckReason({ file, edits: edits[file] }));
  }

  private trackCommand(s: Session, rt: Runtime, cmd: string, ok: boolean) {
    const key = cmd.trim().slice(0, 200);
    const n = ok ? 0 : (rt.fails.get(key) || 0) + 1;
    if (ok) rt.fails.delete(key); else rt.fails.set(key, n);
    if (!ok) this.setStuck(s, stuckReason({ command: key, fails: n }));
  }

  /** Flags working sessions whose agent has been silent for the configured time, as stuck so they appear under Needs you. */
  checkStalls() {
    const minutes = this.store.data.settings.stallMinutes;
    if (!minutes) return;
    for (const s of this.sessions) {
      const rt = this.rt.get(s.id);
      // A running command or subagent is working, not silent; only a session with nothing in flight counts.
      if (!rt || s.status !== 'working' || s.ask || s.stuck || rt.toolStart.size || s.subagents.some((a) => a.status === 'working')) continue;
      const quiet = Date.now() - rt.lastEventAt;
      if (quiet >= minutes * 60_000) {
        this.setStuck(s, `${STALLED} for ${Math.round(quiet / 60_000)} minutes`);
        this.hooks.notify('attention', `${s.id} looks stalled`, `No output for ${Math.round(quiet / 60_000)} minutes`, s.id);
      }
    }
  }

  private setStuck(s: Session, reason: string | undefined) {
    if (!reason || s.stuck === reason) return;
    // Say so once; later counts just update the reason shown.
    if (!s.stuck) this.activity(s, 'attention', 'looks stuck: ' + reason);
    s.stuck = reason;
    this.touch();
  }

  private async detectCommit(s: Session, out: string, tkey: string) {
    const m = out.match(/^\[[^\]\s]+(?: \(root-commit\))? ([0-9a-f]{7,40})\] (.+)$/m);
    if (!m) return;
    const now = Date.now();
    s.commits.push({ hash: m[1], at: now });
    this.markChanged(s, s.subagents.find((x) => tkey === `${s.id}~${x.id}`));
    s.stuck = undefined;
    s.fileEdits = undefined;
    this.pushEpoch++;
    await this.push(tkey, { k: 'commit', hash: m[1], msg: m[2], t: now });
    this.activity(s, 'commit', `committed ${m[1]} “${trunc(m[2], 70)}”`);
    const push = this.cfg(s.repoId);
    if (push.autoPush && push.pushWhen !== 'ready') void this.autoPush(s);
    this.touch();
  }

  /** Pushes the session's branch to GitHub, one push at a time per session so quick commits do not race. A failure is shown in the activity log and tried again at the next commit. */
  private pushing = new Map<string, Promise<unknown>>();
  /** Bumped whenever what is ahead of GitHub may have changed, so cached push status is not reused. */
  pushEpoch = 0;
  /** Runs a push for a session after any push already under way for it, so a manual push and an automatic one never race. */
  serialPush<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const run = (this.pushing.get(id) ?? Promise.resolve()).catch(() => undefined).then(fn).finally(() => {
      this.pushEpoch++;
      const s = this.get(id);
      if (s) s.pushedAt = Date.now();
      this.touch();
    });
    this.pushing.set(id, run);
    return run;
  }
  /** Commits on an extra repository's branch beyond where it started. */
  async extraAhead(x: ExtraRepo): Promise<number> {
    return +(await G.git(x.worktree, 'rev-list', '--count', `${x.base}..HEAD`).catch(() => '0')).trim() || 0;
  }
  autoPush(s: Session): Promise<void> {
    if (s.free || !s.branch || s.worktreeGone) return Promise.resolve();
    return this.serialPush(s.id, async () => {
      try {
        await G.git(s.worktree, 'push', '-u', 'origin', s.branch);
        this.activity(s, 'push', `pushed ${s.branch}`);
        for (const x of s.extras || []) {
          // A repository the agent has not committed in has nothing to push, and would get an empty branch on GitHub.
          if (!(await this.extraAhead(x))) continue;
          await G.git(x.worktree, 'push', '-u', 'origin', x.branch);
          this.activity(s, 'push', `pushed ${x.repoId} ${x.branch}`);
        }
      } catch (e: any) {
        this.activity(s, 'push', `push of ${s.branch} failed: ${trunc(String(e?.message || e).split('\n').find((l) => l.trim()) || 'unknown error', 120)}`, { ok: false });
      }
    });
  }

  private async locateEdit(s: Session, input: any) {
    try {
      const file = rel(s.worktree, String(input.file_path || ''));
      const text = await readFile(join(s.worktree, file), 'utf8');
      const needle = String(input.new_string || input.content || '').split('\n')[0];
      const at = needle ? text.indexOf(needle) : -1;
      s.editing = { file, line: at < 0 ? 1 : text.slice(0, at).split('\n').length };
      this.touch();
    } catch { /* file may be gone */ }
  }

  private scheduleStats(s: Session, rt: Runtime) {
    if (rt.statsTimer) return;
    rt.statsTimer = setTimeout(() => { rt.statsTimer = undefined; void this.refreshStats(s); }, 1500);
  }

  async refreshStats(s: Session) {
    if (s.worktreeGone || (s.free && !s.free.managed)) return;
    try {
      const c = await G.changes(s.worktree, s.base);
      s.add = c.files.reduce((a, f) => a + f.add, 0);
      s.del = c.files.reduce((a, f) => a + f.del, 0);
      s.files = c.files.length;
      s.filesTouched = Object.fromEntries(c.files.map((f) => [f.path, { add: f.add, del: f.del }]));
      this.touch();
    } catch { /* worktree removed */ }
  }

  private async onResult(s: Session, rt: Runtime, m: Extract<AgentEvent, { t: 'result' }>) {
    // The agent's total counts from the start of this run (a resumed session starts again at zero), and is 0 when it reports nothing, as on a subscription. Only a positive total corrects the estimate.
    if (m.costUsd != null && m.costUsd > 0) {
      const target = rt.startCost + m.costUsd;
      const delta = target - rt.baseCost - rt.turnCost;
      if (Math.abs(delta) > 1e-6) { this.store.addUsage(s.repoId, delta, 0); this.store.addDaily(s.repoId, s.model, { cost: delta }); }
      rt.baseCost = target;
      rt.turnCost = 0;
      s.cost = rt.baseCost;
    } else if (m.costUsd != null) {
      rt.baseCost += rt.turnCost;
      rt.turnCost = 0;
    }
    rt.toolStart.clear();
    rt.lastTools.clear();
    for (const a of s.subagents) if (a.agentId) await this.syncSubagent(s, a);
    await this.refreshStats(s);
    void this.refreshTitle(s);
    if (rt.budgetPaused) {
      rt.interrupted = false;
      this.touch();
      return;
    }
    if (rt.interrupted) {
      rt.interrupted = false;
      this.setStatus(s, 'idle', 'Paused. Reply to continue');
      return;
    }
    if (m.isError) {
      const msg = m.text;
      s.error = msg;
      await this.push(s.id, { k: 'note', tone: 'error', text: msg });
      this.setStatus(s, 'error', trunc(msg, 120));
      this.markLimitWait(s);
      this.activity(s, 'error', 'failed: ' + trunc(msg, 80));
      this.hooks.notify('failed', `${s.id} failed`, trunc(msg, 120), s.id);
      return;
    }
    s.error = undefined;
    s.editing = undefined;
    // Other agents may still have to answer this message: the session is finished when the last of them has.
    if (s.panel && this.pendingRounds.get(s.id)) return;
    this.settle(s);
  }

  /** The turn is over for everyone: shows the session as waiting for review, or finished. */
  private settle(s: Session) {
    // Background subagents are still running: their notifications wake the agent, which carries on, so the session is not finished.
    const waiting = s.subagents.filter((a) => a.status === 'working' && a.background);
    if (waiting.length) {
      this.setStatus(s, 'working', `Waiting for ${waiting.length === 1 ? 'subagent: ' + waiting[0].description : waiting.length + ' subagents'}`);
      return;
    }
    // A free agent has nothing to review or merge: it is simply done.
    if (!s.free && (s.files > 0 || s.commits.length > 0)) {
      this.setStatus(s, 'ready', `${s.files} ${s.files === 1 ? 'file' : 'files'} changed · ready for review`);
      const push = this.cfg(s.repoId);
      if (push.autoPush && push.pushWhen === 'ready' && s.commits.length) void this.autoPush(s);
      if (this.store.data.settings.autoReview) {
        // Not again for a commit already reviewed.
        void G.git(s.worktree, 'rev-parse', '--short', 'HEAD').then((h) => (s.review && s.review.head === h.trim() && s.review.state !== 'failed' ? undefined : this.review(s.id))).catch(() => undefined);
      }
      this.activity(s, 'ready', `finished · ${s.files} files ready for review`);
      this.hooks.notify('ready', `${s.id} is ready for review`, `${this.repoOf(s).id} · ${s.files} files`, s.id);
      this.hooks.toast({ tone: 'ready', title: `${s.id} is ready for review`, description: `${this.repoOf(s).id} · ${s.files} files`, sessionId: s.id, tab: 'changes' });
    } else {
      this.setStatus(s, 'idle', 'Finished');
      this.activity(s, 'done', 'finished');
    }
  }

  // ---------------------------------------------------------------- budget
  private onPlanUsage(s: Session, m: Extract<AgentEvent, { t: 'plan_usage' }>) {
    const plan = this.store.planOf(this.backendOf(s).id);
    if (m.fiveHour) plan.fiveHour = m.fiveHour;
    if (m.weekly) plan.weekly = m.weekly;
    plan.at = Date.now();
    this.touch();
    void this.enforcePlan();
  }

  /** Pauses running sessions when a subscription window passes the percentage the user set. Each agent has windows of its own. */
  async enforcePlan() {
    const st = this.store.data.settings;
    for (const be of this.registry.all()) {
      if (!be.capabilities.planUsage || this.billingOf(be.id) !== 'subscription') continue;
      // Claude's wording is the plain one; another agent is named, since its windows are its own.
      const who = be.id === 'claude' ? '' : be.label + ' ';
      const plan = this.store.planOf(be.id);
      const checks: ['fiveHour' | 'weekly', number, string][] = [['fiveHour', st.planPause5h, '5-hour'], ['weekly', st.planPauseWeek, 'weekly']];
      for (const [key, limit, name] of checks) {
        const w = plan[key];
        if (!limit || !w || w.resetsAt * 1000 < Date.now() || w.util * 100 < limit || (this.planOverride[be.id + ':' + key] ?? 0) >= w.resetsAt) continue;
        for (const [id, rt] of this.rt) {
          const s = this.get(id);
          if (!s || this.backendOf(s).id !== be.id || s.status !== 'working' || s.ask || rt.budgetPaused) continue;
          const mins = Math.max(1, Math.round((w.resetsAt * 1000 - Date.now()) / 60000));
          const resets = mins >= 90 ? `${Math.round(mins / 60)}h` : `${mins}m`;
          const ask: PendingAsk = { id: uid(), type: 'budget', scope: 'plan', planKey: key, resetsAt: w.resetsAt, at: Date.now(), head: `Paused at ${Math.round(w.util * 100)}% of your ${who}${name} plan usage`, note: `You set a limit of ${limit}%. The window resets in ${resets}. Continuing may use up the rest of your plan.` };
          rt.budgetPaused = true;
          rt.asks.set(ask.id, { ask, scope: 'plan', planKey: key, resolve: () => undefined });
          s.ask = ask;
          this.activity(s, 'budget', `paused at ${Math.round(w.util * 100)}% of the ${who}${name} plan usage`);
          this.setStatus(s, 'attention', ask.head);
          this.hooks.notify('attention', `${s.id} is paused`, ask.head, s.id);
          rt.interrupted = true;
          await rt.agent.interrupt();
        }
        break;
      }
    }
  }

  /** The window an agent at its limit waits for: the weekly one if that is full, otherwise the one the user chose. */
  private waitKeyFor(bid: string, hit: 'fiveHour' | 'weekly'): 'fiveHour' | 'weekly' {
    return hit === 'weekly' ? 'weekly' : this.store.data.settings.autoWakeWindow;
  }

  /** A session that failed while one of its agent's plan windows is full is stopped by the limit: remember what to wait for. */
  private markLimitWait(s: Session) {
    const bid = this.backendOf(s).id, plan = this.store.planOf(bid), now = Date.now();
    const full = (['weekly', 'fiveHour'] as const).find((k) => plan[k] && plan[k]!.util >= 0.99 && plan[k]!.resetsAt * 1000 > now);
    if (!full) return;
    const key = this.waitKeyFor(bid, full), w = plan[key];
    if (w && w.resetsAt * 1000 > now) s.limitWait = { key, resetsAt: w.resetsAt };
  }

  private waking = false;

  /**
   * With "wake agents after a reset" on: sessions paused at a plan limit, or stopped by reaching it, are told to continue
   * once the window they were waiting for has reset. Runs every minute and when the setting changes.
   */
  async wakeAfterReset() {
    if (!this.store.data.settings.autoWake || this.waking) return;
    this.waking = true;
    try {
      const now = Date.now();
      const due: { s: Session; bid: string; key: 'fiveHour' | 'weekly'; resetsAt: number; ask?: PendingAsk }[] = [];
      for (const s of this.store.data.sessions) {
        const bid = this.backendOf(s).id;
        if (s.ask?.type === 'budget' && s.ask.scope === 'plan' && s.ask.planKey && s.ask.resetsAt) {
          const key = this.waitKeyFor(bid, s.ask.planKey);
          // The ask knows its own window; a longer wait is looked up in the current numbers.
          const resetsAt = key === s.ask.planKey ? s.ask.resetsAt : this.store.planOf(bid)[key]?.resetsAt;
          if (resetsAt) due.push({ s, bid, key, resetsAt, ask: s.ask });
        } else if (s.limitWait && s.status === 'error') due.push({ s, bid, ...s.limitWait });
      }
      const late = due.filter((d) => d.resetsAt * 1000 + 1000 <= now);
      if (!late.length) return;
      // Make sure the numbers are current before acting on them.
      await this.hooks.refreshPlan?.();
      for (const d of late) {
        const w = this.store.planOf(d.bid)[d.key];
        // A report that still shows the old, full window means the reset has not been seen yet; give it two minutes of grace.
        if (w && w.resetsAt === d.resetsAt && w.util >= 0.99 && now < d.resetsAt * 1000 + 120_000) continue;
        const s = this.get(d.s.id);
        if (!s) continue;
        s.limitWait = undefined;
        this.activity(s, 'session', 'plan usage reset; telling the agent to continue');
        try {
          if (d.ask && s.ask?.id === d.ask.id) await this.resolveAsk(s.id, d.ask.id, {});
          else await this.send(s.id, composeMessage(this.cfg(s.repoId), 'planLimitReset'));
        } catch { /* the session cannot be continued; it stays as it is */ }
      }
    } finally { this.waking = false; }
  }

  /** Sessions already warned about passing their budget, so the warning comes once. */
  private budgetWarned = new Set<string>();

  private async checkBudget(s: Session, rt: Runtime) {
    if (this.billingOf(this.backendOf(s).id) !== 'api') {
      await this.enforcePlan();
      return;
    }
    if (rt.budgetPaused || s.ask) return;
    const repo = this.repoOf(s);
    const spent = this.store.weekSpend()[s.repoId] || 0;
    let scope: 'session' | 'repo' | null = null;
    if (s.budget > 0 && s.cost >= s.budget) scope = 'session';
    else if (repo && repo.cap > 0 && spent >= repo.cap) scope = 'repo';
    if (!scope) return;
    if (scope === 'session' && this.store.data.settings.budgetAction === 'warn') {
      // Say so once and let the agent carry on.
      if (this.budgetWarned.has(s.id)) return;
      this.budgetWarned.add(s.id);
      this.activity(s, 'budget', `passed its ${this.usd(s.budget)} session budget`);
      this.hooks.notify('failed', `${s.id} passed its budget`, `${this.usd(s.budget)} session budget reached; it is still working`, s.id);
      return;
    }
    rt.budgetPaused = true;
    const ask: PendingAsk = scope === 'session'
      ? { id: uid(), type: 'budget', scope, at: Date.now(), head: `Paused at its ${this.usd(s.budget)} session budget`, note: 'Raising the limit resumes where it stopped.' }
      : { id: uid(), type: 'budget', scope, at: Date.now(), head: `${repo.id} reached its ${this.usd(repo.cap, true)} weekly budget`, note: 'Raising the repository limit resumes this session where it stopped.' };
    rt.asks.set(ask.id, { ask, scope, resolve: () => undefined });
    s.ask = ask;
    this.activity(s, 'budget', ask.head.toLowerCase());
    this.setStatus(s, 'attention', ask.head);
    this.hooks.notify('attention', `${s.id} is paused`, ask.head, s.id);
    rt.interrupted = true;
    this.activity(s, 'session', 'paused the agent', { who: this.me(), human: true });
    await rt.agent.interrupt();
  }

  // ---------------------------------------------------------------- permissions
  private async canUse(s: Session, rt: Runtime, tool: string, input: Record<string, unknown>, o: { decisionReason?: string; description?: string }): Promise<ToolDecision> {
    const st = this.store.data.settings;
    // A request the user approved while helm was closed: the agent has re-issued it, so let it through once.
    const key = COMMAND_TOOLS.has(tool) ? String(input.command || '') : EDIT_TOOLS.has(tool) ? `${tool}:${String(input.file_path || input.notebook_path || '')}` : '';
    if (key && s.preApproved?.includes(key)) {
      s.preApproved = s.preApproved.filter((k) => k !== key);
      return { behavior: 'allow', updatedInput: input };
    }
    if (tool === 'AskUserQuestion') {
      const questions = (input.questions as any[]) || [];
      const ask: PendingAsk = { id: uid(), type: 'question', at: Date.now(), head: questions[0]?.question || 'The agent has a question', note: questions[0]?.options?.[0]?.description || '', questions };
      await this.push(s.id, { k: 'question', askId: ask.id, questions });
      const r = await this.waitAsk(s, rt, ask, 'tool', input, tool);
      return r;
    }
    if (COMMAND_TOOLS.has(tool)) {
      const cmd = String(input.command || '');
      const plain = !hasShellControl(cmd);
      const mustAsk = matchesAlwaysAsk(st.alwaysAsk || [], cmd) || (/\bkill\b/.test(cmd) && killsPid(cmd, helmPids()));
      if (!mustAsk && plain && SAFE_CMD.test(cmd.trim())) return { behavior: 'allow', updatedInput: input };
      if (!mustAsk && plain && st.alwaysAllow.some((p) => globMatch(p, cmd))) return { behavior: 'allow', updatedInput: input };
      const pattern = mustAsk ? undefined : commandPattern(cmd);
      const summary = commandSummary(cmd, input.description);
      const ask: PendingAsk = { id: uid(), type: 'approve', at: Date.now(), tool, command: cmd, summary, pattern, head: 'Wants to run a command', note: mustAsk ? 'Matches an always-ask command in Settings, so it needs your approval every time.' : o?.decisionReason || `Runs inside ${s.worktree}. Your checkout is untouched.` };
      await this.push(s.id, { k: 'permission', askId: ask.id, cmd, summary, tool, why: ask.note, pattern });
      return this.waitAsk(s, rt, ask, 'tool', input, tool);
    }
    if (EDIT_TOOLS.has(tool)) {
      const p = String(input.file_path || input.notebook_path || '');
      if (!p || inside(s.worktree, p) || (s.extras || []).some((x) => inside(x.worktree, p)) || inside(artifactDir(s.id), p)) return { behavior: 'allow', updatedInput: input };
      const ask: PendingAsk = { id: uid(), type: 'approve', at: Date.now(), tool, command: p, head: 'Wants to edit a file outside its worktree', note: 'This path is outside the session worktree.' };
      await this.push(s.id, { k: 'permission', askId: ask.id, cmd: p, tool, why: ask.note });
      return this.waitAsk(s, rt, ask, 'tool', input, tool);
    }
    if (tool === 'ExitPlanMode') {
      const plan = String(input.plan || '');
      const ask: PendingAsk = { id: uid(), type: 'approve', at: Date.now(), tool, command: undefined, head: 'Plan ready for approval', note: trunc(plan, 400) };
      await this.push(s.id, { k: 'agent', text: plan });
      await this.push(s.id, { k: 'permission', askId: ask.id, cmd: 'Approve the plan and start work', tool, why: 'Approving switches this session to "Allow edits".' });
      const r = await this.waitAsk(s, rt, ask, 'tool', input, tool);
      if (r.behavior === 'allow') {
        s.permMode = 'edits';
        await rt.agent.setPermMode('edits');
      }
      return r;
    }
    return { behavior: 'allow', updatedInput: input };
  }

  private waitAsk(s: Session, rt: Runtime, ask: PendingAsk, scope: 'tool', input: Record<string, unknown>, tool: string): Promise<any> {
    return new Promise((resolveP) => {
      rt.asks.set(ask.id, { ask, scope, input, tool, resolve: resolveP });
      s.ask = ask;
      this.setStatus(s, 'attention', ask.type === 'question' ? 'Asked: ' + trunc(ask.head, 90) : ask.command ? `Wants to run ${trunc(ask.command, 80)}` : ask.head);
      this.activity(s, 'attention', ask.type === 'question' ? 'asked a question' : `asked to run ${trunc(ask.command || '', 70)}`);
      this.hooks.notify('attention', `${s.id} needs you`, ask.head, s.id);
    });
  }

  private auditAsk(s: Session, ask: PendingAsk, decision: 'approved' | 'always' | 'denied') {
    this.store.addAudit({ t: Date.now(), sessionId: s.id, repoId: s.repoId, kind: ask.type === 'question' ? 'question' : 'approval', text: auditText(ask.command || ask.head), decision, waitMs: Math.max(0, Date.now() - ask.at) });
  }

  async resolveAsk(sessionId: string, askId: string, answer: any) {
    const s = this.get(sessionId);
    const rt = this.rt.get(sessionId);
    if (!s) return;
    const w = rt?.asks.get(askId);
    if (!w || !rt) return this.resolveOrphan(s, askId, answer);
    rt.asks.delete(askId);
    s.ask = undefined;
    if (w.ask.type === 'approve') {
      const d = answer?.decision as string;
      this.activity(s, 'approval', `${d === 'deny' ? 'denied' : d === 'always' ? 'always allowed' : 'approved'} ${trunc(w.ask.command || w.ask.head || '', 90)}`, { who: this.me(), human: true, detail: w.ask.command, ok: d !== 'deny' });
    } else if (w.ask.type === 'question') this.activity(s, 'approval', 'answered a question', { who: this.me(), human: true });
    const t = await this.store.transcript(sessionId);
    const markIdx = t.findIndex((e) => (e.k === 'permission' || e.k === 'question') && e.askId === askId);

    if (w.ask.type === 'budget') {
      if (w.scope === 'plan' && w.planKey) {
        const win = this.store.planOf(this.backendOf(s).id)[w.planKey];
        this.planOverride[this.backendOf(s).id + ':' + w.planKey] = win?.resetsAt ?? Math.floor(Date.now() / 1000) + 3600;
        rt.budgetPaused = false;
        this.setStatus(s, 'working', 'Resuming');
        rt.agent.send(composeMessage(this.cfg(s.repoId), 'planLimitContinued'));
        return;
      }
      const add = Number(answer.addBudget) || 5; // USD
      if (w.scope === 'repo') { const r = this.repoOf(s); r.cap += add; } else s.budget += add;
      rt.budgetPaused = false;
      this.setStatus(s, 'working', 'Resuming');
      rt.agent.send(composeMessage(this.cfg(s.repoId), 'budgetRaised'));
      return;
    }

    if (w.ask.type === 'question') {
      const answers: Record<string, string> = answer.answers || {};
      this.auditAsk(s, w.ask, 'approved');
      if (markIdx >= 0) await this.patch(sessionId, markIdx, { ...(t[markIdx] as any), answered: Object.values(answers).join(', ') });
      this.setStatus(s, 'working', 'Continuing');
      w.resolve({ behavior: 'allow', updatedInput: { ...(w.input || {}), answers } });
      return;
    }

    const decision = answer.decision as 'approve' | 'always' | 'deny';
    this.auditAsk(s, w.ask, decision === 'deny' ? 'denied' : decision === 'always' ? 'always' : 'approved');
    if (markIdx >= 0) await this.patch(sessionId, markIdx, { ...(t[markIdx] as any), resolved: decision === 'deny' ? 'denied' : decision === 'always' ? 'always' : 'approved' });
    if (decision === 'always' && w.ask.pattern) {
      const st = this.store.data.settings;
      if (!st.alwaysAllow.includes(w.ask.pattern)) st.alwaysAllow.push(w.ask.pattern);
    }
    this.setStatus(s, 'working', decision === 'deny' ? 'Continuing without it' : 'Running');
    if (decision === 'deny') w.resolve({ behavior: 'deny', message: answer.text ? `The user denied this: ${answer.text}` : 'The user denied this request. Ask what they would prefer.' });
    else w.resolve({ behavior: 'allow', updatedInput: w.input });
  }

  /**
   * Copies the untracked files that match the gitignore-style patterns from the checkout into a new worktree. git does the
   * matching (`--exclude-from`), so negation, folders, `**` and comments all behave as they do in a .gitignore.
   */
  private async copyUntracked(from: string, to: string, patterns: string) {
    if (!patterns.split(/\r?\n/).some((l) => l.trim() && !l.trim().startsWith('#'))) return;
    const file = join(tmpdir(), `helm-copy-${uid()}.txt`);
    try {
      await writeFile(file, patterns.replace(/\r\n/g, '\n') + '\n', 'utf8');
      const out = await G.git(from, 'ls-files', '-z', '--others', '--ignored', `--exclude-from=${file}`);
      for (const rel of out.split('\0').filter(Boolean).slice(0, 500)) {
        const src = join(from, rel);
        if ((await stat(src).catch(() => null))?.size! > 50 * 1024 * 1024) continue;
        await mkdir(dirname(join(to, rel)), { recursive: true });
        await copyFile(src, join(to, rel)).catch(() => undefined);
      }
    } catch { /* a bad pattern or an unreadable file must not stop the session starting */ }
    finally { await rm(file, { force: true }).catch(() => undefined); }
  }

  /**
   * An approval, question or limit that was pending when helm closed. The agent's process is gone, so answering starts
   * the session again from its saved conversation, with the answer as the next message.
   */
  private async resolveOrphan(s: Session, askId: string, answer: any) {
    const ask = s.ask;
    if (!ask || ask.id !== askId) { s.ask = undefined; this.touch(); return; }
    const t = await this.store.transcript(s.id);
    const markIdx = t.findIndex((e) => (e.k === 'permission' || e.k === 'question') && e.askId === askId);
    const mark = async (patch: any) => { if (markIdx >= 0) await this.patch(s.id, markIdx, { ...(t[markIdx] as any), ...patch }); };
    s.ask = undefined;
    let message: string;
    if (ask.type === 'budget') {
      if (ask.scope === 'plan') {
        const bid = this.backendOf(s).id, p = this.store.planOf(bid);
        if (p.fiveHour) this.planOverride[bid + ':fiveHour'] = p.fiveHour.resetsAt;
        if (p.weekly) this.planOverride[bid + ':weekly'] = p.weekly.resetsAt;
        message = composeMessage(this.cfg(s.repoId), 'planLimitContinued');
      } else {
        const add = Number(answer.addBudget) || 5; // USD
        if (ask.scope === 'repo') this.repoOf(s).cap += add; else s.budget += add;
        message = composeMessage(this.cfg(s.repoId), 'budgetRaised');
      }
    } else if (ask.type === 'question') {
      const answers: Record<string, string> = answer.answers || {};
      await mark({ answered: Object.values(answers).join(', ') });
      message = `helm was restarted while you waited. The user answered your question "${ask.questions?.[0]?.question || ''}": ${Object.values(answers).join(', ')}. Continue.`;
    } else {
      const decision = answer.decision as 'approve' | 'always' | 'deny';
      this.auditAsk(s, ask, decision === 'deny' ? 'denied' : decision === 'always' ? 'always' : 'approved');
      await mark({ resolved: decision === 'deny' ? 'denied' : decision === 'always' ? 'always' : 'approved' });
      const what = ask.command || ask.head;
      if (decision === 'deny') {
        message = `helm was restarted while you waited for approval to run "${what}". The user denied it${answer.text ? `: ${answer.text}` : ''}. Do not run it; ask what they would prefer.`;
      } else {
        if (decision === 'always' && ask.pattern && !this.store.data.settings.alwaysAllow.includes(ask.pattern)) this.store.data.settings.alwaysAllow.push(ask.pattern);
        if (ask.tool === 'ExitPlanMode') {
          s.permMode = 'edits';
          message = 'helm was restarted while you waited. The user approved your plan. Go ahead and start.';
        } else {
          (s.preApproved ||= []).push(ask.tool && EDIT_TOOLS.has(ask.tool) ? `${ask.tool}:${ask.command}` : String(ask.command));
          message = `helm was restarted while you waited for approval. The user approved this, so go ahead and run it now: ${what}`;
        }
      }
    }
    await this.push(s.id, { k: 'note', tone: 'neutral', text: 'helm was restarted while this waited. The session is resuming with your answer.' });
    this.setStatus(s, 'working', 'Resuming');
    await this.start(s, message);
  }

  // ---------------------------------------------------------------- several agents
  /** Sends to the owner alone, for helm's own nudges such as "continue", which the other agents have no part in. */
  ownerOnly(s?: Session): SendOptions { return s?.panel ? { to: [s.panel.owner] } : {}; }

  /** Checks an agent can be put in a session and says which backend and model it will use. */
  private panelSeat(a: PanelAgentInput) {
    const be = this.registry.get(a.backend || this.store.data.settings.defaultBackend);
    const on = this.store.data.settings.enabledAgents;
    if (on && !on.includes(be.id)) throw new Error(`${be.label} is turned off. Turn it on under Settings → Agents, or pick another agent.`);
    return { be, model: this.registry.model(be.id, a.model).id };
  }

  /** Puts another agent in the session, making it a panel if it was not one. `ownerSeen` is how much of the transcript the owner already knows. */
  private join(s: Session, a: PanelAgentInput, ownerSeen: number): PanelMember {
    const { be, model } = this.panelSeat(a);
    if ((s.panel?.members.length ?? 0) >= 5) throw new Error('A session holds up to six agents.');
    if (!s.panel) {
      const owner = handleFor(this.registry.model(s.backend, s.model).label, []);
      s.panel = { owner, members: [], seen: { [owner]: ownerSeen } };
    }
    const m: PanelMember = { name: handleFor(this.registry.model(be.id, model).label, participants(s.panel)), backend: be.id, model, ...(a.effort ? { effort: a.effort } : {}) };
    s.panel.members.push(m);
    s.panel.seen[m.name] = 0;
    return m;
  }

  /** Whoever speaks next should be started afresh, so its instructions list the agents there are now. Anyone in the middle of a reply is left alone. */
  private panelChanged(s: Session) {
    for (const [name, a] of this.advisors.get(s.id) ?? []) if (!a.busy) { a.close(); this.advisors.get(s.id)!.delete(name); }
    const rt = this.rt.get(s.id);
    if (rt && s.status !== 'working' && !rt.asks.size) { rt.agent.close(); this.rt.delete(s.id); }
    this.touch();
  }

  async addPanelAgent(id: string, a: PanelAgentInput) {
    const s = this.get(id);
    if (!s) throw new Error('Session not found');
    if (s.worktreeGone) throw new Error('This session\'s work was merged and its worktree removed.');
    const t = await this.store.transcript(id);
    const fresh = !s.panel;
    const m = this.join(s, a, t.length);
    // The conversation so far was the owner's: label it, so the new agent is shown who said what.
    if (fresh) { for (const ev of t) if (ev.k === 'agent' && !ev.from) ev.from = s.panel!.owner; this.store.saveTranscript(id); }
    await this.push(id, { k: 'note', tone: 'neutral', text: `@${m.name} joined (${this.registry.get(m.backend).shortName}, read-only). @${s.panel!.owner} edits and runs commands.` });
    this.activity(s, 'session', `added ${m.name} to the session`, { who: this.me(), human: true });
    this.panelChanged(s);
  }

  async removePanelAgent(id: string, name: string) {
    const s = this.get(id);
    const m = memberOf(s?.panel, name);
    if (!s?.panel || !m) throw new Error(name === s?.panel?.owner ? 'The owner cannot be removed. Make another agent the owner first.' : 'That agent is not in this session.');
    await this.callOffRounds(id);
    this.advisors.get(id)?.get(name)?.close();
    this.advisors.get(id)?.delete(name);
    s.panel.members = s.panel.members.filter((x) => x.name !== name);
    delete s.panel.seen[name];
    // Alone again, the session goes back to being an ordinary one.
    if (!s.panel.members.length) s.panel = undefined;
    await this.push(id, { k: 'note', tone: 'neutral', text: `@${name} left the session.` });
    this.panelChanged(s);
  }

  /** Hands the editing to another agent. The old owner stays as a reader; each keeps its own conversation. */
  async setPanelOwner(id: string, name: string) {
    const s = this.get(id);
    const panel = s?.panel;
    if (!s || !panel) throw new Error('This session has only one agent.');
    const m = memberOf(panel, name);
    if (!m) throw new Error(name === panel.owner ? `@${name} already owns the session.` : 'That agent is not in this session.');
    if (this.rt.has(id) && s.status === 'working') throw new Error(`@${panel.owner} is working. Interrupt it first, then pick the new owner.`);
    await this.callOffRounds(id);
    const rt = this.rt.get(id);
    if (rt) { for (const w of rt.asks.values()) w.resolve({ behavior: 'deny', message: 'The owner changed' }); rt.agent.close(); this.rt.delete(id); }
    this.advisors.get(id)?.get(name)?.close();
    this.advisors.get(id)?.delete(name);
    const old: PanelMember = { name: panel.owner, backend: s.backend, model: s.model, ...(s.effort ? { effort: s.effort } : {}), ...(s.agentSessionId ? { agentSessionId: s.agentSessionId } : {}) };
    s.backend = m.backend;
    s.model = m.model;
    s.effort = m.effort;
    s.agentSessionId = m.agentSessionId;
    s.modelName = undefined;
    s.ctx = 0;
    s.ctxMax = undefined;
    s.ask = undefined;
    panel.members = panel.members.map((x) => (x.name === name ? old : x));
    panel.owner = name;
    await this.push(id, { k: 'note', tone: 'neutral', text: `@${name} now edits and runs commands. @${old.name} is read-only.` });
    this.activity(s, 'session', `made ${name} the owner`, { who: this.me(), human: true });
    this.touch();
  }

  /** Calls off the replies still to come for earlier messages, and cuts short any that is being written. */
  private async callOffRounds(id: string) {
    this.epochs.set(id, (this.epochs.get(id) ?? 0) + 1);
    await Promise.all([...(this.advisors.get(id)?.values() ?? [])].filter((a) => a.busy).map((a) => a.interrupt()));
  }

  private closeAdvisors(id: string) {
    for (const a of this.advisors.get(id)?.values() ?? []) a.close();
    this.advisors.delete(id);
  }

  /** Resolves once every reply to the messages sent so far has been given. */
  async settled(id: string) { await this.rounds.get(id); }

  private queueRound(s: Session, job: Round): Promise<void> {
    const epoch = this.epochs.get(s.id) ?? 0;
    this.pendingRounds.set(s.id, (this.pendingRounds.get(s.id) ?? 0) + 1);
    const run = (this.rounds.get(s.id) ?? Promise.resolve())
      .then(() => this.runRound(s, job, epoch))
      .catch(async (e: any) => { await this.push(s.id, { k: 'note', tone: 'error', text: trunc(String(e?.message || e), 300) }).catch(() => undefined); })
      .then(() => {
        const left = (this.pendingRounds.get(s.id) ?? 1) - 1;
        if (left > 0) { this.pendingRounds.set(s.id, left); return; }
        this.pendingRounds.delete(s.id);
        // The owner's turn ended while others were still replying, so the session was kept as working. Finish it now.
        if ((this.epochs.get(s.id) ?? 0) === epoch && this.get(s.id) === s && s.status === 'working' && !s.ask && !this.rt.get(s.id)?.budgetPaused && !this.rt.get(s.id)?.turnWaiters.length) this.settle(s);
      });
    this.rounds.set(s.id, run);
    return run;
  }

  /**
   * The replies to one message of the user's. Those it is for answer in turn, the owner first (everyone, when it names no one); an
   * agent that @mentions another in its reply gets that one to answer next. Stops when no one is left to answer or the limit is reached.
   */
  private async runRound(s: Session, job: Round, epoch: number) {
    const live = () => (this.epochs.get(s.id) ?? 0) === epoch && !!s.panel && this.get(s.id) === s;
    if (!live()) return;
    const limit = replyLimit(this.store.data.settings.panelReplyCap);
    const first: ReplyRef = { index: job.at, who: 'you', snippet: snip(job.text) };
    const queue: { name: string; re: ReplyRef }[] = (job.to.length ? job.to : participants(s.panel!)).map((name) => ({ name, re: first }));
    let replies = 0;
    while (queue.length && live()) {
      if (limit != null && replies >= limit) {
        const left = queue.map((q) => '@' + q.name).join(', ');
        await this.push(s.id, { k: 'note', tone: 'neutral', text: `Reply limit reached (${limit} for one message). ${left} did not get to answer. Mention them to carry on, or change the limit in Settings.` });
        break;
      }
      const next = queue.shift()!;
      if (!participants(s.panel!).includes(next.name)) continue;
      let reply: { text: string; index: number } | undefined;
      try { reply = await this.speak(s, next.name, next.re, job); }
      catch (e: any) { if (live()) await this.push(s.id, { k: 'note', tone: 'error', text: `@${next.name} could not reply: ${trunc(String(e?.message || e), 240)}` }); continue; }
      if (!reply) continue;
      replies++;
      if (!live()) break;
      const re: ReplyRef = { index: reply.index, who: next.name, snippet: snip(reply.text) };
      for (const m of mentionsIn(reply.text, participants(s.panel!), next.name)) if (!queue.some((q) => q.name === m)) queue.push({ name: m, re });
    }
  }

  /** One participant answers: it is shown what it has missed, and what it says is added to the transcript. Resolves to nothing when it had nothing to answer. */
  private async speak(s: Session, name: string, re: ReplyRef, job: Round): Promise<{ text: string; index: number } | undefined> {
    const panel = s.panel!;
    const t = await this.store.transcript(s.id);
    const from = panel.seen[name] ?? 0;
    const digest = panelDigest(t, from, name, panel);
    panel.seen[name] = t.length;
    if (!digest) return undefined;
    const images = job.images.length && from <= job.at ? job.images : [];
    if (name === panel.owner) {
      const r = await this.askOwner(s, digest, images, re);
      return r.text ? r : undefined;
    }
    const member = memberOf(panel, name)!;
    const advisor = this.advisorFor(s, member);
    const before = { status: s.status, step: s.step };
    const step = `@${name} is replying`;
    this.setStatus(s, 'working', step);
    let text = '';
    try { text = await advisor.ask(digest, images); }
    finally { if (s.status === 'working' && s.step === step) this.setStatus(s, before.status, before.step); }
    if (!text) return undefined;
    const index = await this.push(s.id, { k: 'agent', text, from: name, re });
    this.collectArtifacts(s, text);
    return { text, index };
  }

  /** Puts a message to the owner and resolves to what it said once its turn is over. */
  private async askOwner(s: Session, text: string, images: MessageImage[], re: ReplyRef): Promise<{ text: string; index: number }> {
    s.queued = undefined;
    s.endedAt = undefined;
    s.stuck = undefined;
    s.lastAccess = Date.now();
    const outgoing = s.agentNote ? `${s.agentNote}\n\n${text}` : text;
    s.agentNote = undefined;
    let done!: (r: { text: string; index: number }) => void;
    const finished = new Promise<{ text: string; index: number }>((r) => (done = r));
    const rt = this.rt.get(s.id);
    if (!rt) {
      this.setStatus(s, 'working', 'Starting');
      await this.start(s, outgoing, images, { reply: re, done });
    } else {
      this.setStatus(s, 'working', 'Reading your message');
      rt.reply = re;
      rt.turnText = [];
      rt.turnWaiters.push(done);
      rt.agent.send(outgoing, images);
    }
    return finished;
  }

  private advisorFor(s: Session, member: PanelMember): Advisor {
    let seats = this.advisors.get(s.id);
    if (!seats) this.advisors.set(s.id, (seats = new Map()));
    const live = seats.get(member.name);
    if (live && !live.dead) return live;
    const name = member.name;
    const be = this.registry.get(member.backend);
    const advisor = new Advisor(be, {
      cwd: s.worktree, model: this.registry.model(member.backend, member.model).id, effort: member.effort,
      systemAppend: this.advisorAppend(s, name),
      resume: member.agentSessionId,
      env: {},
      extraDirs: [...(s.uploads ? [s.uploads.dir] : []), ...(s.extras || []).map((x) => x.worktree)],
      subagentLimit: 0
    }, {
      onSession: (sid) => { const m = memberOf(s.panel, name); if (m && m.agentSessionId !== sid) { m.agentSessionId = sid; this.store.save(); } },
      onUsage: (u) => { const m = memberOf(s.panel, name); if (m) this.addAdvisorUsage(s, m, u); }
    });
    seats.set(name, advisor);
    return advisor;
  }

  private advisorAppend(s: Session, name: string): string {
    return [
      `You are a read-only participant in a helm session, looking at the code in ${s.worktree}${s.free ? '' : ` (branch ${s.branch})`}. The task the user gave: ${trunc(s.task, 600)}`,
      'Nothing you do may change the files. Stay inside this directory unless asked to look elsewhere.',
      panelInstructions(s.panel!, name, this.store.data.settings.panelReplyCap)
    ].join('\n');
  }

  /** What a read-only agent's tokens cost counts toward the session, as the owner's do. */
  private addAdvisorUsage(s: Session, m: PanelMember, u: AgentUsage) {
    const inp = u.input + u.cacheWrite;
    s.tokens.input += inp;
    s.tokens.output += u.output;
    s.tokens.cacheRead += u.cacheRead;
    this.store.addLifetimeTokens(s.repoId, inp, u.output, u.cacheRead);
    const [pi, po] = this.registry.model(m.backend, m.model).price;
    const est = (u.input * pi + u.cacheWrite * pi * 1.25 + u.cacheRead * pi * 0.1 + u.output * po) / 1e6;
    this.store.addUsage(s.repoId, est, inp + u.output);
    this.store.addDaily(s.repoId, m.model, { cost: est, input: inp, output: u.output, cacheRead: u.cacheRead });
    s.cost += est;
    // The owner's running total is kept apart from this; move both so its next report does not take the cost back.
    const rt = this.rt.get(s.id);
    if (rt) { rt.baseCost += est; rt.startCost += est; }
    this.touch();
  }

  // ---------------------------------------------------------------- controls
  /**
   * Makes this instance the one that controls a session synced from another. Its work is brought here (the snapshot the other pushed,
   * else its branch on GitHub) into a worktree of its own, and the other copy turns read-only at its next sync, stopping the session
   * there if it was running.
   */
  async takeControl(id: string) {
    const s = this.get(id);
    if (!s) throw new Error('Session not found');
    if (!s.remoteOwner) throw new Error('This session is already controlled from here.');
    const from = s.remoteOwner;
    if (!s.mergedAt) {
      if (s.free) {
        if (!s.free.managed) throw new Error('This agent works in a folder on ' + from + ', which cannot be moved.');
        s.worktree = join(expandHome(this.cfg(FREE_ID).freeRoot), id);
        await G.initScratch(s.worktree);
      } else {
        const repo = this.repoOf(s);
        const st = this.cfg(repo.id);
        if (!(await G.fileExists(repo.localPath))) await G.clone(`https://github.com/${repo.id}.git`, repo.localPath);
        await G.git(repo.localPath, 'fetch', 'origin', '--prune').catch(() => undefined);
        const ref = snapshotRef(id);
        await G.git(repo.localPath, 'fetch', 'origin', `+${ref}:${ref}`).catch(() => undefined);
        const snap = (await G.git(repo.localPath, 'rev-parse', '--verify', '--quiet', ref).catch(() => '')).trim();
        const remote = 'origin/' + s.branch;
        const hasRemote = await G.gitOk(repo.localPath, 'rev-parse', '--verify', '--quiet', 'refs/remotes/' + remote);
        // A snapshot older than the branch on GitHub is not the latest work.
        const useSnap = !!snap && (!hasRemote || (await G.gitOk(repo.localPath, 'merge-base', '--is-ancestor', remote, snap)));
        if (!useSnap && !hasRemote) throw new Error(`The work of this session is on ${from} and has not been pushed. Turn on Branches (and Worktrees) under Settings → Sync there, let it sync, then try again.`);
        const wt = join(expandHome(st.worktreeRoot), repo.name, id);
        if (!(await G.fileExists(wt))) {
          await G.addWorktree(repo.localPath, wt, s.branch, useSnap ? await checkpointParent(repo.localPath, snap) : remote).catch(async () => {
            // The branch name is taken by an earlier copy here.
            await mkdir(dirname(wt), { recursive: true });
            await G.git(repo.localPath, 'worktree', 'add', '-B', s.branch, wt, useSnap ? await checkpointParent(repo.localPath, snap) : remote);
          });
          if (useSnap) await seedFromCheckpoint(wt, snap);
          await this.copyUntracked(repo.localPath, wt, st.copyFiles);
        }
        s.worktree = wt;
      }
      s.worktreeGone = false;
    }
    s.owner = { id: this.store.data.instanceId, at: Date.now() };
    s.remoteOwner = undefined;
    s.status = 'idle';
    s.step = `Taken over from ${from}`;
    s.lastAccess = Date.now();
    this.activity(s, 'session', `took control from ${from}`, { who: this.me(), human: true });
    this.touch();
  }

  async send(id: string, text: string, images: MessageImage[] = [], opts: SendOptions = {}) {
    this.held = false;
    const s = this.get(id);
    if (!s) throw new Error('Session not found');
    if (s.worktreeGone) throw new Error('This session\'s work was merged and its worktree removed, so it cannot be continued. Start a new session.');
    if (s.remoteOwner) throw new Error(`This session belongs to ${s.remoteOwner}. Take control of it to continue it here.`);
    let rt = this.rt.get(id);
    // Talking to a queued session starts it now.
    s.queued = undefined;
    // Talking to a session brings it back from the archive.
    s.lastAccess = Date.now();
    s.archivedAt = undefined;
    s.archivedAuto = undefined;
    const cp = await this.checkpoint(s, 'Before: ' + text);
    // In a panel, who the message is for: those picked as the recipient, and anyone @mentioned in it. No one picked means everyone.
    const names = s.panel ? participants(s.panel) : [];
    const to = s.panel ? [...new Set([...(opts.to || []).filter((n) => names.includes(n)), ...mentionsIn(text, names)])] : [];
    const at = await this.push(id, { k: 'user', t: Date.now(), text, images: images.length ? images : undefined, cp, ...(to.length ? { to } : {}), ...(s.panel && opts.re ? { re: opts.re } : {}) });
    if (s.ask && rt) {
      // Replying while it waits counts as answering a question, or as a denial with an explanation.
      const w = [...rt.asks.values()][0];
      if (w?.ask.type === 'question') return this.resolveAsk(id, w.ask.id, { answers: { [w.ask.questions?.[0]?.question || 'answer']: text } });
      if (w?.ask.type === 'approve') return this.resolveAsk(id, w.ask.id, { decision: 'deny', text });
    }
    if (s.panel) { void this.queueRound(s, { at, text, images, to }); return; }
    s.endedAt = undefined;
    s.stuck = undefined;
    const outgoing = s.agentNote ? `${s.agentNote}\n\n${text}` : text;
    s.agentNote = undefined;
    if (!rt) {
      this.setStatus(s, 'working', 'Starting');
      await this.start(s, outgoing, images);
      return;
    }
    this.setStatus(s, 'working', 'Reading your message');
    rt.agent.send(outgoing, images);
  }

  async interrupt(id: string) {
    const rt = this.rt.get(id);
    const s = this.get(id);
    if (s?.panel) await this.callOffRounds(id);
    if (!rt || !s) return;
    rt.interrupted = true;
    await rt.agent.interrupt();
  }

  async stop(id: string) {
    const rt = this.rt.get(id);
    const s = this.get(id);
    if (!s) return;
    this.epochs.set(id, (this.epochs.get(id) ?? 0) + 1);
    this.closeAdvisors(id);
    if (rt) {
      this.activity(s, 'session', 'stopped the session', { who: this.me(), human: true });
      for (const w of rt.asks.values()) w.resolve({ behavior: 'deny', message: 'Session stopped', interrupt: true });
      rt.asks.clear();
      rt.agent.close();
      this.rt.delete(id);
    }
    s.ask = undefined;
    // A session that was only waiting (ready for review, errored) keeps that status; stopping just closes what was still open.
    if (rt || s.status === 'working' || s.status === 'attention') this.setStatus(s, 'idle', 'Stopped');
  }

  async setModel(id: string, model: ModelAlias) {
    const s = this.get(id);
    if (!s) return;
    s.model = model;
    await this.rt.get(id)?.agent.setModel(model);
    this.touch();
  }

  async setEffort(id: string, effort: Effort | null) {
    const s = this.get(id);
    if (!s) return;
    s.effort = effort ?? undefined;
    // Applies to the running conversation when Claude Code accepts it, and to every later start either way.
    await this.rt.get(id)?.agent.setEffort(effort);
    this.touch();
  }

  async setPermMode(id: string, mode: PermMode) {
    const s = this.get(id);
    if (!s) return;
    s.permMode = mode;
    await this.rt.get(id)?.agent.setPermMode(mode);
    this.touch();
  }

  /** Claude Code names a conversation after its first turns. Pick that up once it exists, unless it is just the first prompt echoed back. */
  private async refreshTitle(s: Session) {
    if (!s.agentSessionId) return;
    try {
      const i = await this.conversationsOf(s).info(s.agentSessionId, s.worktree);
      const t = i?.summary?.trim();
      if (!t || t === i?.firstPrompt?.trim() || t === s.title) return;
      s.title = t;
      await this.nameBranch(s, t);
      this.touch();
    } catch { /* no title yet */ }
  }

  /** Once Claude Code has named the conversation, name the branch after it instead of the prompt. Only while nothing depends on the old name. */
  private async nameBranch(s: Session, title: string) {
    const st = this.cfg(s.repoId);
    if (s.free || s.branchNamed || !s.branch || !s.branch.startsWith(st.branchPrefix)) return;
    s.branchNamed = true;
    // A pushed branch may already have a pull request; the check below leaves one that is on GitHub alone.
    if (s.prUrl) return;
    const repo = this.repoOf(s);
    if (await G.gitOk(repo.localPath, 'rev-parse', '--verify', '--quiet', 'refs/remotes/origin/' + s.branch)) return;
    const base = st.branchPrefix + slug(title);
    let branch = base;
    for (let n = 2; branch !== s.branch && (await this.branchExists(repo.localPath, branch)); n++) branch = base + '-' + n;
    if (branch === s.branch) return;
    if (!(await G.gitOk(s.worktree, 'branch', '-m', s.branch, branch))) return;
    s.branch = branch;
    this.activity(s, 'git', `branch renamed to ${branch}`, { who: 'helm' });
  }

  private async branchExists(repoPath: string, branch: string) {
    return (await G.gitOk(repoPath, 'rev-parse', '--verify', '--quiet', 'refs/heads/' + branch))
      || (await G.gitOk(repoPath, 'rev-parse', '--verify', '--quiet', 'refs/remotes/origin/' + branch));
  }

  async rename(id: string, title: string) {
    const s = this.get(id);
    if (!s) return;
    title = title.trim().slice(0, 120);
    s.customTitle = title || undefined;
    this.activity(s, 'session', title ? `renamed to “${title}”` : `went back to ${this.backendOf(s).shortName}'s name`, { who: this.me(), human: true });
    this.touch();
    // Keep Claude Code's own name in step, so the same session reads the same in VS Code.
    if (title && s.agentSessionId) await this.conversationsOf(s).rename(s.agentSessionId, s.worktree, title).catch(() => undefined);
  }

  archive(id: string, archived: boolean) {
    const s = this.get(id);
    if (!s) return;
    if (!archived && !s.free && !this.repoOf(s)) throw new Error('Its repository was removed from helm. Add the repository again to restore this session.');
    if (archived && (this.rt.has(id) || s.status === 'working' || s.status === 'attention')) throw new Error('Stop the session before archiving it.');
    s.archivedAt = archived ? Date.now() : undefined;
    s.archivedAuto = undefined;
    if (archived) this.dismissAllArtifacts(s);
    if (!archived) s.lastAccess = Date.now();
    this.activity(s, 'session', archived ? 'archived the session' : 'restored the session from the archive', { who: this.me(), human: true });
    this.touch();
  }

  touchAccess(id: string) {
    const s = this.get(id);
    if (!s) return;
    s.lastAccess = Date.now();
    this.store.save();
  }

  /**
   * Archives sessions nobody has opened for the configured number of days. Anything running, waiting on the user,
   * or finished but not yet reviewed (no pull request) is left alone, because hiding it would hide work that needs attention.
   */
  autoArchive() {
    const days = this.store.data.settings.archiveAfterDays;
    if (!days) return;
    const cutoff = Date.now() - days * 86_400_000;
    let any = false;
    for (const s of this.sessions) {
      if (s.archivedAt || this.rt.has(s.id) || s.status === 'working' || s.status === 'attention' || s.ask) continue;
      if (s.status === 'ready' && !s.prUrl && !s.mergedAt) continue;
      if ((s.lastAccess || s.startedAt) > cutoff) continue;
      s.archivedAt = Date.now();
      s.archivedAuto = true;
      this.dismissAllArtifacts(s);
      this.activity(s, 'session', `archived automatically after ${days} idle days`, { who: 'helm', human: true });
      any = true;
    }
    if (any) this.touch();
  }

  /** What deleting would lose: uncommitted work in the worktree, and commits that exist nowhere else. */
  async deleteInfo(id: string) {
    const s = this.get(id);
    if (!s) throw new Error('Session not found');
    if (s.free) {
      // A scratch folder is helm's to remove; a folder you chose is never touched.
      const exists = await G.fileExists(s.worktree);
      const dirty = exists && s.free.managed ? (await G.git(s.worktree, 'status', '--porcelain').catch(() => '')).split('\n').filter(Boolean).length : 0;
      return { free: s.free.managed ? 'scratch' as const : 'folder' as const, branch: '', worktree: s.worktree, worktreeExists: exists, dirty, unpushed: 0, pushed: false, running: this.rt.has(id) };
    }
    const repo = this.repoOf(s);
    const worktreeExists = await G.fileExists(s.worktree);
    const dirty = worktreeExists ? (await G.git(s.worktree, 'status', '--porcelain').catch(() => '')).split('\n').filter(Boolean).length : 0;
    const pushed = await G.gitOk(repo.localPath, 'rev-parse', '--verify', '--quiet', 'refs/remotes/origin/' + s.branch);
    const range = pushed ? `origin/${s.branch}..${s.branch}` : `${s.base}..${s.branch}`;
    const unpushed = +(await G.git(repo.localPath, 'rev-list', '--count', range).catch(() => '0')).trim() || 0;
    return { branch: s.branch, worktree: s.worktree, worktreeExists, dirty, unpushed, pushed, running: this.rt.has(id) };
  }

  /** Deletes the session. A branch can only be deleted together with its worktree, since git refuses to delete a checked-out branch. */
  /**
   * The work was merged. Clean up the worktree and branch as asked, then deal with the session as the setting says: archived
   * (kept with its conversation, usage and change counts, found in the Archive), deleted, or left as it is.
   */
  async finishMerged(id: string, merged: { into: string; at?: number }, opts: { worktree: boolean; branch: boolean }) {
    const s = this.get(id);
    if (!s) return;
    const record = this.cfg(s.repoId).afterMerge;
    if (record === 'delete') return this.remove(id, opts);
    await this.refreshStats(s);
    await this.stop(id);
    if (opts.worktree || opts.branch) {
      await G.removeWorktree(this.repoOf(s).localPath, s.worktree, opts.branch ? s.branch : undefined).catch(() => undefined);
      await this.removeExtras(s, opts.branch);
      s.worktreeGone = true;
    }
    s.queuedMerge = undefined;
    s.mergedInto = merged.into;
    s.mergedAt = merged.at ?? Date.now();
    this.activity(s, 'worktree', `cleaned up after the merge${opts.branch ? ': worktree and branch removed' : opts.worktree ? ': worktree removed' : ''}`, { who: 'helm', human: true });
    if (record === 'archive') { s.archivedAt = Date.now(); s.archivedAuto = undefined; this.dismissAllArtifacts(s); }
    this.touch();
  }

  private async removeExtras(s: Session, branch: boolean) {
    for (const x of s.extras || []) {
      const r = this.store.data.repos.find((r) => r.id === x.repoId);
      if (r) await G.removeWorktree(r.localPath, x.worktree, branch ? x.branch : undefined).catch(() => undefined);
    }
  }

  async remove(id: string, opts: { worktree: boolean; branch: boolean }) {
    const s = this.get(id);
    if (!s) return;
    await this.stop(id);
    this.activity(s, 'session', `deleted${opts.branch ? ' with its branch' : opts.worktree ? ' with its worktree' : ''}`, { who: this.me(), human: true });
    if (s.free) {
      // Only a scratch folder helm made is deleted, and only if asked.
      if (opts.worktree && s.free.managed) await rm(s.worktree, { recursive: true, force: true }).catch(() => undefined);
    } else {
      if (opts.worktree || opts.branch) {
        await G.removeWorktree(this.repoOf(s).localPath, s.worktree, opts.branch ? s.branch : undefined);
        await this.removeExtras(s, opts.branch);
      }
      await dropCheckpoints(this.repoOf(s).localPath, id).catch(() => undefined);
    }
    this.store.data.sessions = this.store.data.sessions.filter((x) => x.id !== id);
    await this.store.deleteTranscripts(id);
    this.store.tombstone('session', id);
    if (s.uploads) await rm(s.uploads.dir, { recursive: true, force: true }).catch(() => undefined);
    await dropArtifacts(id);
    this.touch();
  }

  /** The settings that apply to a repository's sessions: its own over the defaults. */
  private cfg(repoId: string): Settings { return effectiveSettings(this.store.data.settings, this.store.data.repos.find((r) => r.id === repoId)); }
  sessionLimit(s: Session) { return s.maxSubagents ?? this.store.data.settings.maxSubagentsSession; }
  repoLimit(s: Session) { return this.repoOf(s)?.maxSubagents ?? this.store.data.settings.maxSubagentsRepo; }

  /** Subagents of a session that were let through and are still running. */
  private runningSubagents(s: Session): number {
    const rt = this.rt.get(s.id);
    return s.subagents.filter((a) => a.status === 'working' && (!rt || rt.admitted.has(a.id))).length;
  }

  /** PreToolUse hook for the Agent tool: enforces the per-session and per-repository limits on subagents running at once. */
  private async checkSubagentLimit(s: Session, rt: Runtime, id: string): Promise<string | undefined> {
    const sl = this.sessionLimit(s), rl = this.repoLimit(s);
    const mine = this.runningSubagents(s);
    const inRepo = this.sessions.filter((x) => x.repoId === s.repoId).reduce((n, x) => n + this.runningSubagents(x), 0);
    let reason = '';
    if (mine >= sl) reason = sl === 0 ? 'Subagents are turned off for this session.' : `This session already has ${mine} ${mine === 1 ? 'subagent' : 'subagents'} running, which is its limit.`;
    else if (inRepo >= rl) reason = `${this.repoOf(s)?.id} already has ${inRepo} subagents running across its sessions, which is the repository limit.`;
    if (!reason) {
      rt.admitted.add(id);
      return undefined;
    }
    await this.push(s.id, { k: 'note', tone: 'neutral', text: 'Subagent blocked. ' + reason });
    return reason;
  }

  private stopSubagents(s: Session) {
    let any = false;
    for (const a of s.subagents) if (a.status === 'working') { a.status = 'stopped'; a.endedAt = Date.now(); any = true; }
    if (any) this.touch();
  }

  /** The message that resumes a session, worded by its repository's settings. */
  resumeText(id: string) { return composeMessage(this.cfg(this.get(id)?.repoId ?? ''), 'resume'); }

  /** Tell a running agent that the user changed a file under it. */
  async userEdited(id: string, file: string) {
    const s = this.get(id);
    const rt = this.rt.get(id);
    if (!s || !rt || s.status !== 'working') return;
    await this.push(id, { k: 'note', tone: 'neutral', text: `You edited ${file}. The agent was told.` });
    rt.agent.send(composeMessage(this.cfg(s.repoId), 'userEdited', { file }));
  }

  /** helm is quitting: end the agent processes but leave each session as it was, so a pending approval survives to the next launch. */
  shutdown() {
    this.quitting = true;
    for (const id of [...this.advisors.keys()]) this.closeAdvisors(id);
    for (const rt of this.rt.values()) rt.agent.close();
    this.rt.clear();
  }

  /**
   * Picks up the agents that were working when helm closed. A session that was waiting on a question or approval is left to
   * the user, and one whose worktree is gone, or that was archived or merged meanwhile, cannot continue. One at a time, so
   * starting many agents does not hit the machine and the API together.
   */
  async resumeInterrupted() {
    const ids = this.interruptedByQuit;
    this.interruptedByQuit = [];
    for (const id of ids) {
      const s = this.get(id);
      if (!s || s.worktreeGone || s.archivedAt || s.mergedAt || s.status !== 'idle' || this.rt.has(id)) continue;
      try {
        this.activity(s, 'session', 'resumed automatically after helm was closed');
        await this.send(id, composeMessage(this.cfg(s.repoId), 'resumeReopened'), [], this.ownerOnly(s));
      } catch (e: any) {
        this.activity(s, 'error', 'could not resume: ' + trunc(String(e?.message || e), 100), { ok: false });
      }
    }
  }

  /** Notes the `artifact:` links in an agent's reply, so each file waits in the Inbox. A file already seen, dismissed or not, is not added again. */
  private collectArtifacts(s: Session, text: string) {
    let added = false;
    for (const m of text.matchAll(/\[([^\]]*)\]\(artifact:([^)\s]+)\)/g)) {
      let name = m[2];
      try { name = decodeURIComponent(name); } catch { /* keep it as written */ }
      if (s.artifacts?.some((a) => a.name === name)) continue;
      (s.artifacts ||= []).push({ name, label: m[1] || name, at: Date.now() });
      added = true;
    }
    if (added) this.touch();
  }

  private dismissAllArtifacts(s: Session) {
    for (const a of s.artifacts || []) a.dismissed = true;
  }

  async dismissArtifact(id: string, name: string) {
    const s = this.get(id);
    const a = s?.artifacts?.find((x) => x.name === name);
    if (!a || a.dismissed) return;
    a.dismissed = true;
    this.touch();
  }

  /** While true, queued sessions do not start. Set by `haltAll`; cleared when the user starts or talks to a session. */
  private held = false;

  /** The emergency stop: interrupts every agent that is working, right now, and keeps the queue from starting others in their place. */
  async haltAll(): Promise<number> {
    this.held = true;
    const working = this.sessions.filter((s) => s.status === 'working' && this.rt.has(s.id));
    await Promise.all(working.map(async (s) => {
      this.activity(s, 'session', 'halted with stop all', { who: this.me(), human: true });
      await this.interrupt(s.id);
    }));
    this.touch();
    return working.length;
  }

  /** Continues every agent that was paused or stopped when helm closed, and lets the queue run again. */
  async resumeAll(): Promise<number> {
    this.held = false;
    const ids = this.sessions
      .filter((s) => s.status === 'idle' && !s.queued && !s.archivedAt && !s.mergedAt && !s.worktreeGone && !this.rt.has(s.id) && /^(Paused|Stopped when helm closed)/.test(s.step))
      .map((s) => s.id);
    for (const id of ids) {
      try { await this.send(id, this.resumeText(id), [], this.ownerOnly(this.get(id))); }
      catch (e: any) { const s = this.get(id); if (s) this.activity(s, 'error', 'could not resume: ' + trunc(String(e?.message || e), 100), { ok: false }); }
    }
    this.touch();
    return ids.length;
  }

  /** Sends one message to many sessions at once. Archived sessions (and ones that cannot be continued) are skipped even if listed. Resolves to how many received it. */
  async broadcast(text: string, ids?: string[], images: MessageImage[] = []): Promise<number> {
    const want = ids ? new Set(ids) : null;
    const to = this.sessions.filter((s) => (!want || want.has(s.id)) && !s.archivedAt && !s.mergedAt && !s.worktreeGone && !s.remoteOwner).map((s) => s.id);
    let sent = 0;
    for (const id of to) {
      try { await this.send(id, text, images, this.ownerOnly(this.get(id))); sent++; }
      catch (e: any) { const s = this.get(id); if (s) this.activity(s, 'error', 'could not receive the broadcast: ' + trunc(String(e?.message || e), 100), { ok: false }); }
    }
    this.touch();
    return sent;
  }

  async stopAll() {
    for (const id of [...this.rt.keys()]) await this.stop(id);
  }

  isRunning = (id: string) => this.rt.has(id);
}
