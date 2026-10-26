/** Types shared by the main process, preload and renderer. */

import type { Conflict } from './forecast';
import type { Issue } from './issues';
import type { Workflow, WorkflowRun } from './workflows';
import type { SearchResults } from './search';
import type { HealthIssue, MemoryUsage } from './memoryhealth';
import type { Report } from './reports';
export type { Workflow, WorkflowRun, Report, Conflict, Issue, SearchResults, HealthIssue, MemoryUsage };

export type Status = 'working' | 'attention' | 'ready' | 'idle' | 'error';
/** ask: approve commands; edits: edits go through, commands ask; plan: plan only; all: nothing asks. */
export type PermMode = 'ask' | 'edits' | 'plan' | 'all';
export type ModelAlias = 'sonnet' | 'opus' | 'haiku';
export type ThemePref = 'dark' | 'light' | 'system';

/** The repository id every free agent carries. It is not a real repository: free agents are not bound to one. */
export const FREE_ID = '@free';
export const isFreeRepo = (id: string) => id === FREE_ID;
/** What to call a repository id in the interface. */
export const repoLabel = (id: string) => (id === FREE_ID ? 'Free agents' : id);

/** The stand-in "repository" of a free agent, so code that wants a repository gets one. `dir` is the agent's own folder. */
export const freeRepo = (dir = ''): Repo => ({ id: FREE_ID, owner: '', name: 'Free agents', private: true, lang: null, defaultBranch: '', localPath: dir, cap: 0, addedAt: 0 });

export interface Repo {
  /** owner/name */
  id: string;
  owner: string;
  name: string;
  private: boolean;
  lang: string | null;
  defaultBranch: string;
  localPath: string;
  /** Weekly spend cap for this repository, USD. */
  cap: number;
  addedAt: number;
  /** Overrides the default limit on subagents running at once across this repository. */
  maxSubagents?: number;
}

export interface AskQuestion {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: { label: string; description?: string }[];
}

export interface PendingAsk {
  id: string;
  type: 'approve' | 'question' | 'budget';
  at: number;
  head: string;
  note: string;
  tool?: string;
  /** Bash command, for approvals of commands. */
  command?: string;
  /** Pattern offered by "Always allow", e.g. `pnpm test *`. */
  pattern?: string;
  questions?: AskQuestion[];
  /** Which limit paused the session, for budget asks. */
  scope?: 'session' | 'repo' | 'plan';
  /** helm was closed while this waited, so the agent's process is gone. Answering it starts the session again. */
  orphaned?: boolean;
}

export interface Subagent {
  /** The Agent tool call that started it. */
  id: string;
  /** The subagent whose transcript made the call, or null when the session itself did. */
  parentId: string | null;
  description: string;
  agentType: string;
  status: 'working' | 'done' | 'failed' | 'stopped';
  startedAt: number;
  endedAt?: number;
  tools: number;
  tokens: number;
  summary?: string;
  background?: boolean;
  /** It edited a file or committed (or a subagent under it did), so there is something for the owner to review. */
  changed?: boolean;
  /** Handed back with nothing to review: left out of the subagent list unless asked for. */
  archived?: boolean;
  /** Claude Code's id for the subagent, used to read its transcript. */
  agentId?: string;
}

export interface Session {
  id: string;
  /**
   * A free agent: not bound to a repository. `worktree` is its working folder. When `managed`, helm made that folder for it and
   * set up local git there (so Changes and checkpoints work); otherwise it is a folder you chose and helm leaves git alone.
   * Free agents have no branch, no pull request and nothing to merge.
   */
  free?: { managed: boolean };
  /** The worktree (and maybe the branch) was removed after the work was merged. The conversation and numbers stay; it cannot be continued. */
  worktreeGone?: boolean;
  /** Merged straight into this branch without a pull request, and when. */
  mergedInto?: string;
  mergedAt?: number;
  /** How hard the model thinks. Unset leaves it to Claude Code's default for the model. */
  effort?: Effort;
  /** A short name Claude Code gave the conversation. Shown instead of the id until you rename it. */
  title?: string;
  /** Set once helm has tried to name the branch after `title`, so it happens only once. */
  branchNamed?: boolean;
  /** A name you gave it. Wins over `title`. */
  customTitle?: string;
  repoId: string;
  status: Status;
  task: string;
  step: string;
  branch: string;
  base: string;
  worktree: string;
  model: ModelAlias;
  modelName?: string;
  permMode: PermMode;
  startedAt: number;
  endedAt?: number;
  tokens: { input: number; output: number; cacheRead: number };
  cost: number;
  budget: number;
  /** Context window tokens in use. */
  ctx: number;
  add: number;
  del: number;
  files: number;
  filesTouched: Record<string, { add: number; del: number }>;
  timeline: { t: number; status: Status }[];
  commits: { hash: string; at: number }[];
  ask?: PendingAsk;
  claudeSessionId?: string;
  editing?: { file: string; line: number };
  error?: string;
  prUrl?: string;
  removeAfterMerge: boolean;
  /** Delete the branch, here and on GitHub, once merged. Sessions saved before this existed follow `removeAfterMerge`. */
  deleteBranchAfterMerge?: boolean;
  /** When it was archived. Archived sessions are hidden from the left tree and Overview, and kept. */
  archivedAt?: number;
  /** Archived by the idle timer rather than by hand. */
  archivedAuto?: boolean;
  /** Last time it was opened, messaged or changed state. The idle timer counts from here. */
  lastAccess: number;
  subagents: Subagent[];
  /** Overrides the default limit on subagents running at once in this session. */
  maxSubagents?: number;
  /** Requests the user approved while helm was closed. The agent re-issues them, and each is allowed once without asking again. */
  preApproved?: string[];
  /** Tool calls by tool name: how many were made and how many failed. Subagents' calls count too. */
  tools?: Record<string, { n: number; err: number }>;
  /** How many times each file was edited, to spot an agent going round in circles. Capped at 200 files. */
  fileEdits?: Record<string, number>;
  /** Why the session looks stuck (the same file edited again and again, the same command failing), until it makes progress. */
  stuck?: string;
  /** When its pull request was opened. */
  prAt?: number;
  /** The session this one was forked or fanned out from, and the group of sessions started from one prompt. */
  parentId?: string;
  group?: string;
  /** Where the work came from, such as a GitHub issue or pull request comment. */
  source?: { kind: 'issue' | 'pr'; number: number; url: string; title: string };
  /** Last checkpoint number taken. Checkpoints are git refs named refs/helm/<session>/<n>. */
  checkpoints?: number;
  /** The result of the last self-review. */
  review?: SelfReview;
  /** Waiting to start: for a free slot, or for another session to be merged. It has a worktree but the agent has not run. */
  queued?: { after?: string; since: number };
  /** Review comments on its pull request up to this time have already been sent to the agent. */
  feedbackAt?: number;
  /** Hunks the user has looked at and accepted, by hunk id (path and changed lines, not line numbers). */
  reviewed?: string[];
  /** Said to the agent along with the next message, then forgotten. Used after a checkpoint restore. */
  agentNote?: string;
}

/** A saved state of a session's worktree. Taken before each message you send. */
export interface Checkpoint {
  n: number;
  commit: string;
  at: number;
  /** What it was taken before, or why. */
  label: string;
}

export interface SelfReview {
  at: number;
  /** running while the reviewer works. */
  state: 'running' | 'done' | 'failed';
  /** The branch tip the review was of, so a later commit makes it stale. */
  head: string;
  summary: string;
  /** What the review cost, USD. */
  cost?: number;
  findings: { severity: 'blocker' | 'warning' | 'note'; file?: string; line?: number; text: string }[];
}

/** One thing that happened in a session, kept for the audit report. Text is cut short and secrets are masked. */
export interface AuditEntry {
  t: number;
  sessionId: string;
  repoId: string;
  kind: 'command' | 'edit' | 'approval' | 'question' | 'dispatch';
  text: string;
  /** Commands: whether it succeeded. */
  ok?: boolean;
  /** Approvals: what the user decided, and how long the agent waited. */
  decision?: 'approved' | 'always' | 'denied';
  waitMs?: number;
}

/** Usage for one local day, one repository and one model. Kept for good, so reports reach further back than the session list. */
export interface DailyUsage {
  /** YYYY-MM-DD, local time. */
  day: string;
  repoId: string;
  model: ModelAlias;
  cost: number;
  input: number;
  output: number;
  cacheRead: number;
}

/** A file an agent put in its session's artifact folder. `data` (base64) is null when the file is too large to send. */
export interface Artifact { name: string; mediaType: string; size: number; data: string | null }

export type TranscriptEvent =
  | { k: 'user'; t: number; text: string; from?: string; images?: MessageImage[]; cp?: number }
  | { k: 'subagent'; id: string; description: string; agentType: string; status: Subagent['status']; summary?: string }
  | { k: 'agent'; text: string; list?: string[] }
  | { k: 'tools'; items: [string, string, string][] }
  | { k: 'edit'; file: string; add: number; del: number; lines: [string, string][] }
  | { k: 'bash'; id: string; cmd: string; out: string; ok: boolean; meta: string; done: boolean }
  | { k: 'commit'; hash: string; msg: string; t: number }
  | { k: 'permission'; askId: string; cmd: string; tool: string; why: string; pattern?: string; resolved?: 'approved' | 'always' | 'denied' }
  | { k: 'question'; askId: string; questions: AskQuestion[]; answered?: string }
  | { k: 'note'; tone: 'attention' | 'error' | 'neutral'; text: string };

export interface ActivityEvent {
  id: string;
  t: number;
  kind: ActivityKind;
  /** A session id for what an agent did, the user's login for what they asked helm to do, `helm` for what helm did by itself. */
  who: string;
  human?: boolean;
  what: string;
  repo: string;
  sessionId?: string;
  /** The full command, path or error, when `what` is shortened. */
  detail?: string;
  /** False when the action failed. */
  ok?: boolean;
}

export type ActivityKind =
  | 'ready' | 'attention' | 'budget' | 'commit' | 'start' | 'merge' | 'done' | 'error'
  | 'push' | 'fetch' | 'git' | 'pr' | 'worktree' | 'session' | 'approval' | 'bash' | 'edit';

export interface Settings {
  theme: ThemePref;
  githubClientId: string;
  claudePath: string;
  defaultModel: ModelAlias;
  permMode: PermMode;
  alwaysAllow: string[];
  runTests: boolean;
  /** Tell the agent to push its branch after every commit. */
  pushOnCommit: boolean;
  /** Who the agent's commits are credited to: you, with Claude as a co-author, or Claude alone. */
  commitAuthor: 'coauthor' | 'sole';
  worktreeRoot: string;
  /** Where scratch folders for free agents are made. */
  freeRoot: string;
  cloneRoot: string;
  branchPrefix: string;
  removeAfterMerge: boolean;
  /** Delete the branch after a merge, locally and on GitHub. git will not delete a checked-out branch, so the worktree goes with it. */
  deleteBranchAfterMerge: boolean;
  /** Files from your checkout to copy into each new worktree, as gitignore patterns, one per line (`.env`, `config/*.local.json`, `!keep.env`, `# comment`). Only files git does not track are copied. */
  copyFiles: string;
  weeklyLimit: number;
  sessionBudget: number;
  warnAt: number;
  /** What happens to a session's record once its work is merged: archived (the default), deleted, or left where it is. */
  afterMerge: 'archive' | 'delete' | 'keep';
  /** How a pull request is merged from helm. */
  mergeMethod: MergeMethod;
  /** How finished work is delivered: as a pull request, or merged straight into the default branch. The Changes tab can override it per session. */
  deliver: 'pr' | 'merge';
  /** Start Remote Control (`/rc`) in every session, so it can be followed and driven from claude.ai/code or the Claude app. */
  remoteControl: boolean;
  /** Archive sessions that have not been opened for this many days. 0 never archives. */
  archiveAfterDays: number;
  /** Most subagents one session may run at once. 0 turns subagents off. */
  maxSubagentsSession: number;
  /** Most subagents that may run at once across all sessions of a repository. */
  maxSubagentsRepo: number;
  /** subscription: Claude Max/Pro login, limited by plan usage windows. api: pay per token, limited by dollar budgets. */
  billing: 'subscription' | 'api';
  /** True once billing has been chosen or detected from the first session. */
  billingDetected: boolean;
  /** Display currency. Amounts are stored in USD. */
  currency: string;
  /** True once the currency has been chosen or detected, so detection only runs on first launch. */
  currencyDetected: boolean;
  /** Pause agents at this percentage of the 5-hour subscription window. 0 is off. */
  planPause5h: number;
  /** Pause agents at this percentage of the weekly subscription limit. 0 is off. */
  planPauseWeek: number;
  /** Most sessions allowed to work at once across all repositories. More wait in a queue. 0 is no limit. */
  maxRunning: number;
  notifyAttention: { desktop: boolean; sound: boolean };
  notifyReady: { desktop: boolean; sound: boolean };
  notifyFailed: { desktop: boolean; sound: boolean };
  notifyChecks: { desktop: boolean; sound: boolean };
  dnd: boolean;
  /** No desktop notifications between these local times (HH:MM), unless the session is blocked on an approval and `quietAllowAttention` is on. */
  quiet: { enabled: boolean; from: string; to: string; allowAttention: boolean };
  /** Per repository: everything, only things that need you, or nothing. Repositories not listed notify for everything. */
  notifyRepo: Record<string, 'all' | 'attention' | 'off'>;
  /** Keep helm in the system tray / menu bar with a count of what needs you. */
  tray: boolean;
  /** Look for a new version of helm at launch and download it in the background. */
  autoUpdate: boolean;
  editorFontSize: number;
  /** Font for the interface: labels, titles and prose. */
  /** What interrupts a working agent from the keyboard: Esc, Esc pressed twice, or nothing (the Interrupt button still works). */
  interruptKey: 'esc' | 'double-esc' | 'off';
  /** Connect to a helm-companion server so the website can show this app's agents and answer them. Off until turned on. */
  companionEnabled: boolean;
  /** The companion server, for example `https://companion.example.com`. */
  companionUrl: string;
  /** Let the website approve commands, answer questions, message, pause and stop agents, and start sessions. Off leaves it read-only. */
  companionControl: boolean;
  /** The shell in the terminal: `auto` (zsh if installed, then Git Bash, WSL, PowerShell), an id from `listShells`, or `custom`. */
  terminalShell: string;
  /** The command to run for the `custom` shell, for example `wsl.exe -d Ubuntu -e zsh`. */
  terminalShellCustom: string;
  /** Which key sends a message from the composer. Enter sends and Shift+Enter starts a new line, or Ctrl/Cmd+Enter sends and Enter starts a new line. */
  sendKey: 'enter' | 'mod-enter';
  /** Show the organisation or user before each repository name in the left tree (`acme/` storefront). */
  showOwner: boolean;
  uiFont: string;
  /** Monospaced font for data in the interface: paths, branches, hashes and numbers. */
  dataFont: string;
  /** Font family for code: the editor, terminal and diffs. */
  editorFont: string;
  editorLigatures: boolean;
  density: 'Compact' | 'Comfortable';
  openIn: 'helm' | 'VS Code' | 'Cursor' | 'Zed';
}

export interface User {
  login: string;
  name: string | null;
  email: string | null;
  avatar: string | null;
  orgs: string[];
}

export interface PlanWindow {
  /** Fraction used, 0 to 1. */
  util: number;
  /** Epoch seconds. */
  resetsAt: number;
}

/** Claude subscription usage as reported by Claude Code's rate-limit events. */
export interface PlanUsage {
  fiveHour?: PlanWindow;
  weekly?: PlanWindow;
  /** When the numbers were last reported, epoch ms. */
  at: number;
}

/** Everything a repository has ever used, kept even after its sessions are deleted. Cost is the API-priced estimate. */
export interface Lifetime {
  input: number;
  output: number;
  cacheRead: number;
  cost: number;
}

/** Whether Claude Code is signed in on a machine where the app has to do that itself (the hosted server). */
export interface ClaudeLogin {
  loggedIn: boolean;
  /** `none`, the account's login (`claude.ai`), `api key` or `subscription token`. */
  method: string;
  email?: string;
  plan?: string;
  /** Why it could not be checked, when it could not. */
  error?: string;
}

export interface UpdateStatus {
  /** dev: a development build, which never updates. */
  state: 'dev' | 'idle' | 'checking' | 'downloading' | 'ready' | 'current' | 'error';
  version?: string;
  percent?: number;
  checkedAt?: number;
  error?: string;
}

/** A session's worktree and what it costs in disk space. */
export interface WorktreeUsage {
  sessionId: string;
  repoId: string;
  branch: string;
  path: string;
  /** Size of the whole worktree. */
  bytes: number;
  /** Of that, what could be deleted without losing anything: ignored build output and installed packages. */
  reclaimable: number;
  reclaimDirs: string[];
  partial: boolean;
  status: Status;
  running: boolean;
  archived: boolean;
  merged: boolean;
  lastAccess: number;
  dirty: number;
  unpushed: number;
}

export interface AppState {
  ready: boolean;
  /** Set only where the app signs Claude Code in itself (the hosted server); absent on the desktop. */
  claudeLogin?: ClaudeLogin;
  user: User | null;
  repos: Repo[];
  sessions: Session[];
  /** The latest few events. The Activity page reads the full log with `activityLog`. */
  activity: ActivityEvent[];
  /** Counts every event logged, so a page can tell when to read the log again. */
  activitySeq: number;
  settings: Settings;
  /** Spend per repo id since the start of the current week (Monday). */
  weekSpend: Record<string, number>;
  /** Lifetime usage per repository id. */
  lifetime: Record<string, Lifetime>;
  tokensToday: number;
  /** Live sessions that would conflict with each other or with their base. */
  forecast: Conflict[];
  update: UpdateStatus;
  claudeVersion: string | null;
  plan: PlanUsage;
  companion: CompanionState;
  /** USD to other currencies. */
  rates: Record<string, number>;
  platform: string;
  home: string;
}

export interface DeviceCode {
  userCode: string;
  verificationUri: string;
  expiresAt: number;
}

export interface GhRepo {
  id: string;
  description: string | null;
  lang: string | null;
  updated: string;
  private: boolean;
  added: boolean;
  defaultBranch: string;
}

export interface FileChange {
  path: string;
  add: number;
  del: number;
  status: 'M' | 'A' | 'D' | 'R';
  generated?: boolean;
  binary?: boolean;
}

export interface DiffHunk {
  header: string;
  /** [sign, oldLine, newLine, text] */
  lines: [string, number | null, number | null, string][];
}

export interface ChangesSummary {
  files: FileChange[];
  base: string;
  commits: { hash: string; msg: string }[];
  dirty: number;
}

/** A Claude Code session started outside helm, such as from the VS Code extension or the CLI. */
export interface ExternalSession {
  id: string;
  title: string;
  firstPrompt?: string;
  branch?: string;
  cwd?: string;
  lastModified: number;
  createdAt?: number;
  size?: number;
  /** Written to in the last minute or so, so probably still running. */
  active: boolean;
  /** Hidden from the left tree and Overview: archived by hand, or idle for longer than the archive setting. */
  archived: boolean;
  archiveReason?: 'manual' | 'age';
}

/** Somewhere a new session can start from: a local branch, or a branch on GitHub. */
export interface BaseOption {
  /** A ref git understands: `main` is the local branch, `origin/main` the one on GitHub. */
  ref: string;
  label: string;
  /** Commits a local branch has that its GitHub branch does not. */
  ahead: number;
  behind: number;
  local: boolean;
}

export interface SessionDeleteInfo {
  /** Set for a free agent: its folder is helm's own (`scratch`, which can be removed) or yours (`folder`, which never is). */
  free?: 'scratch' | 'folder';
  branch: string;
  worktree: string;
  worktreeExists: boolean;
  /** Uncommitted files in the worktree: lost if the worktree is removed. */
  dirty: number;
  /** Commits on the branch that are not on GitHub: lost if the branch is deleted. */
  unpushed: number;
  /** The branch also exists on GitHub. Only the local one is deleted. */
  pushed: boolean;
  running: boolean;
}

/** What to call a session: your name for it, else Claude's, else its id. */
export const sessionTitle = (s: { id: string; title?: string; customTitle?: string }) => s.customTitle || s.title || s.id;

export interface MemoryEntry {
  kind: 'memory' | 'instructions';
  path: string;
  /** File name, or for instructions where it lives. */
  file: string;
  name: string;
  description: string;
  /** user, feedback, project or reference. */
  type: string;
  modified: number;
  size: number;
  /** MEMORY.md, the list Claude reads at the start of every session. */
  index: boolean;
}

export interface ProjectMemory {
  /** The memory folder, when Claude Code has made one for this repository. */
  dir: string | null;
  memories: MemoryEntry[];
  instructions: MemoryEntry[];
}

/** A picture sent with a message, as base64 (no data: prefix). */
export interface MessageImage {
  mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
  data: string;
  name?: string;
}

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface ExternalTranscript {
  ready: boolean;
  /** Events in the whole conversation. */
  total: number;
  /** Index of the first event returned. */
  start: number;
  events: TranscriptEvent[];
  error?: string;
}

export interface WorkspaceInfo {
  root: string;
  branch: string;
  dirty: number;
  /** True for a session worktree, false for the repository's own checkout. */
  session: boolean;
}

export interface SearchHit {
  path: string;
  line: number;
  text: string;
}

export interface TreeEntry {
  name: string;
  path: string;
  dir: boolean;
  /** git status letter */
  git?: string;
}

export interface HistoryCommit {
  hash: string;
  parents: string[];
  lane: number;
  kind: 'main' | Status;
  msg: string;
  who: string;
  agent: boolean;
  sessionId?: string;
  refs: string[];
  at: number;
  add: number;
  del: number;
}

export interface WorktreeInfo {
  branch: string;
  path: string;
  sessionId: string | null;
  ahead: number;
  behind: number;
  dirty: number;
  main: boolean;
}

export interface PullRequest {
  number: number;
  title: string;
  branch: string;
  base: string;
  state: 'open' | 'closed' | 'merged';
  draft: boolean;
  url: string;
  checks: 'pending' | 'passing' | 'failing' | 'none';
}

export interface ReviewComment {
  file: string;
  line: number;
  text: string;
}

export interface NewSessionInput {
  repoId: string;
  base: string;
  task: string;
  model: ModelAlias;
  budget: number;
  permMode: PermMode;
  /** For a free agent: a folder of yours to work in, instead of a new scratch folder. */
  folder?: string;
  /** Wait until this session has been merged before starting, so the new one begins from the merged base. */
  after?: string;
  /** What the task came from, such as a GitHub issue. */
  source?: Session['source'];
  /** Start from this effort level instead of the default. */
  effort?: Effort;
}

export interface CreatePrInput {
  sessionId: string;
  base: string;
  title: string;
  body: string;
  draft: boolean;
  removeAfterMerge: boolean;
  deleteBranchAfterMerge: boolean;
  files: string[];
  message?: string;
}

export type MergeMethod = 'merge' | 'squash' | 'rebase';

export interface PushTarget {
  /** A session id, or `@checkout` for the branch checked out in the repository's own folder. */
  id: string;
  kind: 'session' | 'checkout';
  repoId: string;
  branch: string;
  /** Commits that are not on GitHub. */
  ahead: number;
  /** Uncommitted files, which a push does not include. */
  dirty: number;
  /** The branch exists on GitHub already. */
  onRemote: boolean;
}

export interface PushResult {
  pushed: string[];
  failed: { id: string; error: string }[];
  /** Targets with uncommitted changes that were left out. */
  uncommitted: number;
}

export interface ShellOption {
  id: string;
  label: string;
}

/** Where the companion connection stands. */
export interface CompanionState {
  state: 'off' | 'linking' | 'connecting' | 'connected' | 'error';
  error?: string;
  /** Shown while linking: the code to enter on GitHub. */
  linkCode?: { userCode: string; verificationUri: string };
  /** The GitHub username the companion knows this computer as. */
  login?: string;
  /** Browser tabs open on the website right now. */
  viewers: number;
}

/** The small picture of helm that goes to the companion website: no code, no file contents, only what a phone screen needs. */
export interface CompanionSnapshot {
  at: number;
  /** Counts every event logged, so the website knows when to read the activity log again. */
  activitySeq: number;
  user: { login: string; avatar: string };
  billing: 'subscription' | 'api';
  /** Display currency and the rate from USD, for amounts. */
  currency: { code: string; rate: number };
  /** Whether the website may answer and message agents, or only watch. */
  control: boolean;
  plan: { fiveHour?: PlanWindow; weekly?: PlanWindow };
  tokensToday: number;
  repos: { id: string; name: string; owner: string; lifetime: Lifetime; weekSpend: number; cap: number }[];
  sessions: {
    id: string; title: string; repoId: string; repoName: string; status: Status; step: string; branch: string; base: string; model: string; permMode: string;
    startedAt: number; endedAt?: number; lastAccess: number;
    tokens: number; tokenDetail: { input: number; output: number; cacheRead: number }; cost: number; budget: number; ctx: number;
    files: number; add: number; del: number; commits: number; prUrl?: string; mergedInto?: string; archived: boolean; worktreeGone?: boolean;
    subagents: { id: string; parentId: string | null; description: string; agentType: string; status: Subagent['status']; startedAt: number; endedAt?: number; tools: number; tokens: number; summary?: string; background?: boolean }[];
    maxSubagents?: number;
    ask?: { id: string; type: string; head: string; note: string; command?: string; tool?: string; pattern?: string; scope?: string; orphaned?: boolean; questions?: AskQuestion[] };
  }[];
  /** Sessions started outside helm (the VS Code extension, the CLI), read-only. */
  externals: { repoId: string; id: string; title: string; branch?: string; active: boolean; lastModified: number; archived: boolean }[];
  activity: { t: number; who: string; what: string; kind: string; repo: string; ok?: boolean }[];
}

export interface MergeInput {
  sessionId: string;
  /** Branch to merge into, without origin/. */
  base: string;
  /** Commit message for any uncommitted files that are included. */
  message: string;
  files: string[];
  removeAfterMerge: boolean;
  deleteBranchAfterMerge: boolean;
}

export interface MergeResult {
  /** The commit the branch now points at on origin. */
  sha: string;
  /** Whether the base branch in your own checkout was brought up to date too. */
  localUpdated: boolean;
  /** Why it was not, when it was not. */
  localNote?: string;
}

/** Request/response calls from renderer to main. */
export interface HelmApi {
  getState(): Promise<AppState>;
  /** Forgets this computer's link to the companion server. Turning the companion on again links it afresh. */
  companionUnlink(): Promise<void>;
  /** The window was unresponsive for `ms`. Written to diagnostics.log, with the page it was on. */
  reportStall(ms: number, where: string): Promise<void>;
  /** The log of everything helm and its agents did, newest first. `before` is a timestamp to page back from. */
  activityLog(opts?: { before?: number; limit?: number }): Promise<ActivityEvent[]>;
  updateSettings(patch: Partial<Settings>): Promise<void>;

  signInStart(): Promise<DeviceCode>;
  signInWait(): Promise<User>;
  signInToken(token: string): Promise<User>;
  signOut(): Promise<void>;

  listGithubRepos(): Promise<GhRepo[]>;
  cloneRepos(ids: string[]): Promise<void>;
  cloneUrl(url: string, dir: string): Promise<void>;
  listGithubOwners(): Promise<string[]>;
  createGithubRepo(input: { name: string; description: string; private: boolean; owner?: string }): Promise<void>;
  inspectClone(path: string): Promise<{ ok: boolean; checks: { ok: boolean; warn?: boolean; text: string }[]; id?: string }>;
  addLocalRepo(path: string): Promise<void>;
  removeRepo(id: string): Promise<void>;
  setRepoCap(id: string, cap: number): Promise<void>;
  chooseFolder(): Promise<string | null>;
  fetchRepo(id: string): Promise<void>;
  repoBranches(id: string): Promise<string[]>;
  /** Where a new session can start from. Local branches with unpushed commits are offered separately from GitHub's. */
  repoBases(id: string): Promise<BaseOption[]>;
  /** `limit` is how many commits to read. Repeats are served from a cache until a ref changes. */
  repoHistory(id: string, limit?: number): Promise<HistoryCommit[]>;
  /** The last history read for this repository, instantly and possibly stale, or null if there is none yet. */
  repoHistoryCached(id: string, limit?: number): Promise<HistoryCommit[] | null>;
  reorderRepos(ids: string[]): Promise<void>;
  /** Orders the sessions of one repository. Subagents always stay with their parent session. */
  reorderSessions(repoId: string, ids: string[]): Promise<void>;
  /** Asks Claude Code for plan usage now, without sending a message. */
  refreshPlanUsage(): Promise<void>;
  repoWorktrees(id: string): Promise<WorktreeInfo[]>;
  repoPulls(id: string): Promise<PullRequest[]>;
  commitFiles(id: string, hash: string): Promise<FileChange[]>;
  commitDiff(repoId: string, hash: string, path: string): Promise<DiffHunk[]>;
  /** Claude Code sessions for this repository that helm did not start. */
  listExternalSessions(repoId: string): Promise<ExternalSession[]>;
  /**
   * A window of a session's conversation. Without options it returns the last 200 events. `start` and `end` pick a range, so
   * earlier events can be loaded as you scroll up. Large session files are read once in the background and cached, so `ready`
   * is false until the first read finishes.
   */
  externalTranscript(repoId: string, sessionId: string, opts?: { start?: number; end?: number; tail?: number }): Promise<ExternalTranscript>;
  removeWorktree(repoId: string, path: string): Promise<void>;

  createSession(input: NewSessionInput): Promise<string>;
  sendMessage(sessionId: string, text: string, images?: MessageImage[]): Promise<void>;
  setSessionEffort(sessionId: string, effort: Effort | null): Promise<void>;
  interrupt(sessionId: string): Promise<void>;
  stopSession(sessionId: string): Promise<void>;
  resumeSession(sessionId: string): Promise<void>;
  /** What deleting a session would remove or lose, so the dialog can say so. */
  sessionDeleteInfo(sessionId: string): Promise<SessionDeleteInfo>;
  archiveSession(sessionId: string, archived: boolean): Promise<void>;
  /** Names a session. An empty title goes back to the one Claude gave it. */
  renameSession(sessionId: string, title: string): Promise<void>;
  /** Records that a session was opened, which restarts its idle timer. */
  touchSession(sessionId: string): Promise<void>;
  /** Archives or restores a session started outside helm. Restoring also overrides the age rule. */
  archiveExternal(sessionId: string, archived: boolean): Promise<void>;
  /** Deletes the session. The branch can only go with the worktree, because git won't delete a branch that is checked out. */
  deleteSession(sessionId: string, opts: { worktree: boolean; branch: boolean }): Promise<void>;
  setSessionModel(sessionId: string, model: ModelAlias): Promise<void>;
  setSessionPermMode(sessionId: string, mode: PermMode): Promise<void>;
  setSessionMaxSubagents(sessionId: string, max: number | null): Promise<void>;
  /** Re-reads a subagent's transcript from Claude Code's session file. */
  refreshSubagent(sessionId: string, subId: string): Promise<void>;
  setRepoMaxSubagents(repoId: string, max: number | null): Promise<void>;
  resolveAsk(sessionId: string, askId: string, answer: { decision: 'approve' | 'always' | 'deny'; text?: string } | { answers: Record<string, string> } | { addBudget: number }): Promise<void>;
  getTranscript(sessionId: string): Promise<TranscriptEvent[]>;
  /** A file the agent made for the user (`artifact:` links in its replies), or null if it no longer exists. */
  getArtifact(sessionId: string, name: string): Promise<Artifact | null>;

  /** A workspace id is a session id, or `repo:<owner/name>` for the repository's own checkout. */
  workspaceInfo(ws: string): Promise<WorkspaceInfo>;
  listFiles(ws: string): Promise<string[]>;
  /** The file as it was at the workspace's base, for diffing. Empty when the file is new. */
  readBase(ws: string, path: string): Promise<string>;
  searchFiles(ws: string, query: string, matchCase?: boolean): Promise<SearchHit[]>;
  listTree(sessionId: string, dir: string): Promise<TreeEntry[]>;
  readFile(sessionId: string, path: string): Promise<{ text: string; binary: boolean }>;
  writeFile(sessionId: string, path: string, text: string): Promise<void>;
  fileGitLines(sessionId: string, path: string): Promise<{ added: number[]; modified: number[] }>;
  fileBlame(sessionId: string, path: string): Promise<{ line: number; hash: string; who: string }[]>;
  changedFiles(sessionId: string): Promise<{ path: string; status: string }[]>;
  changes(sessionId: string): Promise<ChangesSummary>;
  fileDiff(sessionId: string, path: string): Promise<DiffHunk[]>;
  createPr(input: CreatePrInput): Promise<{ url: string | null }>;
  /** Merges an open pull request on GitHub, optionally deleting its branch there. The session (if helm started it) is settled straight away. */
  mergePr(repoId: string, number: number, opts: { method: MergeMethod; deleteBranch: boolean }): Promise<void>;
  /** Skips the pull request: brings the branch up to date with the base, then pushes it onto the base on GitHub. */
  mergeDirect(input: MergeInput): Promise<MergeResult>;
  commitOnly(sessionId: string, files: string[], message: string): Promise<void>;
  /** Pushes every session branch that has commits GitHub does not. Uncommitted changes are left alone. */
  /** What could be pushed: each session's branch, and the branch checked out in each repository's own folder, with how many commits GitHub lacks. */
  pushStatus(repoId?: string): Promise<PushTarget[]>;
  /** Pushes the branches with commits GitHub lacks: one target (a session id, or `@checkout`), or every target of a repository, or of all of them. */
  push(opts: { repoId?: string; target?: string }): Promise<PushResult>;
  requestChanges(sessionId: string, comments: ReviewComment[]): Promise<void>;
  /** Opens the session's worktree, or one file in it (at a line), in the editor chosen in Settings. */
  openInEditor(sessionId: string, path?: string, line?: number): Promise<void>;
  openExternal(url: string): Promise<void>;
  /** What Claude Code has remembered about this repository, plus the instruction files (CLAUDE.md) that apply to it. */
  projectMemory(repoId: string): Promise<ProjectMemory>;
  readMemory(repoId: string, path: string): Promise<string>;
  writeMemory(repoId: string, path: string, text: string): Promise<void>;
  /** Deletes a memory file and its line in the index. */
  deleteMemory(repoId: string, path: string): Promise<void>;
  /** Whether a commit is on GitHub (reachable from a remote branch). A commit that only exists locally is a 404 there. */
  commitPushed(repoId: string, hash: string): Promise<boolean>;
  /** Opens a folder in the system file manager. */
  openFolder(path: string): Promise<void>;
  /** Opens the repository in the editor chosen in Settings. With helm as the editor it opens the Code tab instead. */
  openRepoInEditor(repoId: string): Promise<void>;
  checkClaude(path: string): Promise<string | null>;
  /** Starts signing Claude Code in with a Claude subscription: returns the address to open. */
  claudeLoginStart(): Promise<{ url: string }>;
  /** Gives the code shown after approving, and returns where Claude Code stands. Rejects with the reason when it did not sign in. */
  claudeLoginCode(code: string): Promise<ClaudeLogin>;
  claudeLoginCancel(): Promise<void>;
  claudeLogout(): Promise<ClaudeLogin>;

  termOpen(sessionId: string | null, cols: number, rows: number): Promise<string>;
  termWrite(id: string, data: string): Promise<void>;
  termResize(id: string, cols: number, rows: number): Promise<void>;
  termClose(id: string): Promise<void>;

  copyText(text: string): Promise<void>;
  /** The text on the clipboard, for pasting into the terminal. */
  readClipboard(): Promise<string>;
  /** The shells this computer has, for the terminal setting. */
  listShells(): Promise<ShellOption[]>;

  checkpoints(sessionId: string): Promise<Checkpoint[]>;
  /** Puts the worktree back as it was at a checkpoint. A safety checkpoint is taken first, so the restore can be undone. Refused while the agent is working. */
  restoreCheckpoint(sessionId: string, n: number): Promise<void>;
  /** Starts a new session from this one at one of your messages (an index into its transcript, or null for now): the conversation up to it, and the worktree as it was then. */
  forkSession(sessionId: string, index: number | null, task: string): Promise<string>;
  /** Carries on a session started outside helm, in its own worktree, from a copy of its conversation. */
  continueExternal(repoId: string, externalId: string, task: string): Promise<string>;
  /** The same task started in several sessions, one per variant, to compare. */
  createGroup(input: NewSessionInput, variants: { model: ModelAlias; effort?: Effort }[]): Promise<string[]>;
  /** Keeps one session of a group and archives the rest. */
  keepFromGroup(group: string, keepId: string): Promise<void>;
  revertHunk(sessionId: string, path: string, hunk: DiffHunk): Promise<void>;
  setHunksReviewed(sessionId: string, ids: string[], reviewed: boolean): Promise<void>;
  /** Has a read-only reviewer go through the branch's diff. The result lands on the session. */
  startReview(sessionId: string): Promise<void>;
  /** Starts a queued session now, whatever it is waiting for. */
  /** Searches conversations, commit messages and (for a session or repository) code. A workspace id is a session id, or `repo:<owner/name>`. */
  searchAll(query: string, workspace?: string): Promise<SearchResults>;
  /** Which memories sessions have read, and what looks wrong with them: stale, mentioning files that are gone, or reading alike. */
  memoryInsights(repoId: string): Promise<{ usage: Record<string, MemoryUsage>; issues: HealthIssue[]; sessions: number }>;
  /** Adds a line to the "Learned in helm" list in the repository's CLAUDE.md, its CLAUDE.local.md, or your own ~/.claude/CLAUDE.md. Resolves to the file. */
  rememberInstruction(repoId: string, target: 'repo' | 'local' | 'user', text: string): Promise<string>;
  /** Every session worktree with its size, and how much of it is build output that can go. Slow the first time; remembered for a few minutes. */
  worktreeUsage(refresh?: boolean): Promise<WorktreeUsage[]>;
  /** Deletes node_modules, build output and the like from a worktree, only where git ignores them. Resolves to bytes freed. */
  cleanWorktree(sessionId: string): Promise<number>;
  /** Removes a finished session's worktree (the branch and the conversation stay). Refused with uncommitted or unpushed work. */
  dropWorktree(sessionId: string): Promise<void>;
  checkForUpdates(): Promise<UpdateStatus>;
  installUpdate(): Promise<void>;
  /** Saves a support bundle: versions, settings, session states and the recent log, with private text left out and secrets masked. */
  saveDiagnostics(): Promise<string | null>;
  openLogFolder(): Promise<void>;
  /** The window reports an error here so it ends up in the log. */
  logRenderer(message: string): Promise<void>;
  /** The repository's GitHub Actions workflows on a branch, and which of them can be started by hand with what inputs. */
  repoWorkflows(repoId: string, ref: string): Promise<Workflow[]>;
  /** Starts a workflow that has `workflow_dispatch` on a branch. Inputs are checked against the workflow's own declaration first. */
  runWorkflow(repoId: string, workflowId: number, ref: string, inputs: Record<string, string>): Promise<void>;
  workflowRuns(repoId: string, workflowId: number): Promise<WorkflowRun[]>;
  startQueued(sessionId: string): Promise<void>;
  /** Takes a session out of the queue without starting it. */
  cancelQueued(sessionId: string): Promise<void>;
  /** Open issues of a repository (pull requests excluded). */
  repoIssues(repoId: string): Promise<Issue[]>;
  /** The task text for a session that works on an issue, with its discussion. */
  issueTask(repoId: string, number: number): Promise<{ task: string; title: string; url: string }>;
  /** The review comments on a pull request as a task, and the branch to start from. */
  feedbackTask(repoId: string, number: number): Promise<{ task: string; base: string; count: number }>;
  /** Sends the pull request's review comments that arrived since the last time to the session's agent. Resolves to how many were sent. */
  sendPrFeedback(sessionId: string): Promise<number>;

  /** Every report for the last `days` days, computed from sessions, the usage ledger and the audit log. */
  getReport(days: number): Promise<Report>;
  /** The period's summary as Markdown. */
  reportDigest(days: number): Promise<string>;
  /** Saves a report as a file the user picks (CSV, or Markdown for the digest). Resolves to the path, or null if cancelled. */
  exportReport(kind: 'spend' | 'sessions' | 'audit' | 'digest', days: number): Promise<string | null>;
}

/** Push events from main to renderer. */
/**
 * What the UI needs from the thing it runs in. Electron's preload implements it over IPC, the hosted server's web client over a
 * WebSocket. The renderer imports nothing else from its environment.
 */
export interface HelmBridge {
  /** The user's operating system, for keyboard shortcuts. */
  platform: string;
  /** Where the window's own buttons sit, so the title bar can leave room: the left (macOS), the right (Windows, Linux), or nowhere (a browser tab). Defaults from `platform`. */
  windowControls?: 'left' | 'right' | 'none';
  /** True in the browser client of a hosted server. */
  hosted?: boolean;
  invoke(channel: string, ...args: unknown[]): Promise<any>;
  on<K extends keyof HelmEvents>(channel: K, cb: (payload: HelmEvents[K]) => void): () => void;
}

export interface HelmEvents {
  state: AppState;
  transcript: { sessionId: string; index: number; event: TranscriptEvent };
  toast: { tone: 'ready' | 'attention' | 'error' | 'neutral'; title: string; description?: string; sessionId?: string; tab?: string };
  termData: { id: string; data: string };
  termExit: { id: string };
  /** A file for the user to keep. The hosted server sends it to the browser, which downloads it. */
  download: { name: string; text: string };
  navigate: { screen: string; id?: string; tab?: string; file?: string; line?: number };
}
