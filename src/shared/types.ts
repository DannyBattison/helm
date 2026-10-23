/** Types shared by the main process, preload and renderer. */

export type Status = 'working' | 'attention' | 'ready' | 'idle' | 'error';
export type PermMode = 'ask' | 'edits' | 'plan';
export type ModelAlias = 'sonnet' | 'opus' | 'haiku';
export type ThemePref = 'dark' | 'light' | 'system';

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
}

export interface Session {
  id: string;
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
  subagents: Subagent[];
  /** Overrides the default limit on subagents running at once in this session. */
  maxSubagents?: number;
}

export type TranscriptEvent =
  | { k: 'user'; t: number; text: string; from?: string }
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
  kind: 'ready' | 'attention' | 'budget' | 'commit' | 'start' | 'merge' | 'done' | 'error';
  who: string;
  human?: boolean;
  what: string;
  repo: string;
  sessionId?: string;
}

export interface Settings {
  theme: ThemePref;
  githubClientId: string;
  claudePath: string;
  defaultModel: ModelAlias;
  permMode: PermMode;
  alwaysAllow: string[];
  runTests: boolean;
  worktreeRoot: string;
  cloneRoot: string;
  branchPrefix: string;
  removeAfterMerge: boolean;
  copyFiles: string;
  weeklyLimit: number;
  sessionBudget: number;
  warnAt: number;
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
  notifyAttention: { desktop: boolean; sound: boolean };
  notifyReady: { desktop: boolean; sound: boolean };
  notifyFailed: { desktop: boolean; sound: boolean };
  notifyChecks: { desktop: boolean; sound: boolean };
  dnd: boolean;
  editorFontSize: number;
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

export interface AppState {
  ready: boolean;
  user: User | null;
  repos: Repo[];
  sessions: Session[];
  activity: ActivityEvent[];
  settings: Settings;
  /** Spend per repo id since the start of the current week (Monday). */
  weekSpend: Record<string, number>;
  tokensToday: number;
  claudeVersion: string | null;
  plan: PlanUsage;
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
}

export interface CreatePrInput {
  sessionId: string;
  base: string;
  title: string;
  body: string;
  draft: boolean;
  removeAfterMerge: boolean;
  files: string[];
  message?: string;
}

/** Request/response calls from renderer to main. */
export interface HelmApi {
  getState(): Promise<AppState>;
  updateSettings(patch: Partial<Settings>): Promise<void>;

  signInStart(): Promise<DeviceCode>;
  signInWait(): Promise<User>;
  signInToken(token: string): Promise<User>;
  signOut(): Promise<void>;

  listGithubRepos(): Promise<GhRepo[]>;
  cloneRepos(ids: string[]): Promise<void>;
  cloneUrl(url: string, dir: string): Promise<void>;
  inspectClone(path: string): Promise<{ ok: boolean; checks: { ok: boolean; warn?: boolean; text: string }[]; id?: string }>;
  addLocalRepo(path: string): Promise<void>;
  removeRepo(id: string): Promise<void>;
  setRepoCap(id: string, cap: number): Promise<void>;
  chooseFolder(): Promise<string | null>;
  fetchRepo(id: string): Promise<void>;
  repoBranches(id: string): Promise<string[]>;
  repoHistory(id: string): Promise<HistoryCommit[]>;
  repoWorktrees(id: string): Promise<WorktreeInfo[]>;
  repoPulls(id: string): Promise<PullRequest[]>;
  commitFiles(id: string, hash: string): Promise<FileChange[]>;
  removeWorktree(repoId: string, path: string): Promise<void>;

  createSession(input: NewSessionInput): Promise<string>;
  sendMessage(sessionId: string, text: string): Promise<void>;
  interrupt(sessionId: string): Promise<void>;
  stopSession(sessionId: string): Promise<void>;
  resumeSession(sessionId: string): Promise<void>;
  deleteSession(sessionId: string, removeWorktree: boolean): Promise<void>;
  setSessionModel(sessionId: string, model: ModelAlias): Promise<void>;
  setSessionPermMode(sessionId: string, mode: PermMode): Promise<void>;
  setSessionMaxSubagents(sessionId: string, max: number | null): Promise<void>;
  setRepoMaxSubagents(repoId: string, max: number | null): Promise<void>;
  resolveAsk(sessionId: string, askId: string, answer: { decision: 'approve' | 'always' | 'deny'; text?: string } | { answers: Record<string, string> } | { addBudget: number }): Promise<void>;
  getTranscript(sessionId: string): Promise<TranscriptEvent[]>;

  listTree(sessionId: string, dir: string): Promise<TreeEntry[]>;
  readFile(sessionId: string, path: string): Promise<{ text: string; binary: boolean }>;
  writeFile(sessionId: string, path: string, text: string): Promise<void>;
  fileGitLines(sessionId: string, path: string): Promise<{ added: number[]; modified: number[] }>;
  fileBlame(sessionId: string, path: string): Promise<{ line: number; hash: string; who: string }[]>;
  changedFiles(sessionId: string): Promise<{ path: string; status: string }[]>;
  changes(sessionId: string): Promise<ChangesSummary>;
  fileDiff(sessionId: string, path: string): Promise<DiffHunk[]>;
  createPr(input: CreatePrInput): Promise<{ url: string | null }>;
  commitOnly(sessionId: string, files: string[], message: string): Promise<void>;
  requestChanges(sessionId: string, comments: ReviewComment[]): Promise<void>;
  openInEditor(sessionId: string, path?: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  checkClaude(path: string): Promise<string | null>;

  termOpen(sessionId: string | null, cols: number, rows: number): Promise<string>;
  termWrite(id: string, data: string): Promise<void>;
  termResize(id: string, cols: number, rows: number): Promise<void>;
  termClose(id: string): Promise<void>;

  copyText(text: string): Promise<void>;
}

/** Push events from main to renderer. */
export interface HelmEvents {
  state: AppState;
  transcript: { sessionId: string; index: number; event: TranscriptEvent };
  toast: { tone: 'ready' | 'attention' | 'error' | 'neutral'; title: string; description?: string; sessionId?: string; tab?: string };
  termData: { id: string; data: string };
  termExit: { id: string };
  navigate: { screen: string; id?: string; tab?: string };
}
