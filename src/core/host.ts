import type { HelmEvents, Settings, ThemePref, UpdateStatus } from '../shared/types';

/**
 * Everything the app logic needs from wherever it runs. The desktop app implements it with Electron (`desktop/main/index.ts`); the hosted
 * server implements it with plain Node (`hosted/`). Nothing in `core.ts` or its siblings imports Electron.
 */
export interface Host {
  /** Where state, transcripts and the sign-in token are kept. */
  dataDir: string;
  /** BCP 47 tag, used to pick a display currency. */
  locale: string;
  /** Delivers an event to every connected UI. */
  send<K extends keyof HelmEvents>(channel: K, payload: HelmEvents[K]): void;
  /** Encrypts a secret for storage on disk; the default is to store it as is. */
  encrypt?(text: string): Buffer;
  decrypt?(data: Buffer): string;
  /** The Claude Code binary the Agent SDK should run, when it can't find its own (inside an asar archive). */
  sdkClaudePath(): string | undefined;
  /** A Claude Code binary for running `claude agents --json`; falls back to `claude` on PATH. */
  cliClaudePath(): string | undefined;
  setBadge?(count: number): void;
  setTheme?(theme: ThemePref): void;
  /** A desktop notification. The host decides whether the user is already looking. */
  notify?(n: {
    kind: 'attention' | 'ready' | 'failed';
    title: string;
    body: string;
    silent: boolean;
    sessionId: string;
    /** Present when the question is a plain approval: a host that can show buttons on a notification answers with this. */
    answer?: (decision: 'approve' | 'deny') => void;
  }): void;
  /** Called after each state update has been sent, for things that mirror it (the desktop's tray). */
  changed?(): void;
  /** Called after settings change, for the ones a host acts on itself. */
  settingsChanged?(patch: Partial<Settings>): void;
  /** Automatic updates. Only the installed desktop app has them. */
  updates?: { status(): UpdateStatus; check(): Promise<UpdateStatus>; install(): void };
  /** Which build this is, for the diagnostics bundle. */
  appInfo?(): { version: string; electron?: string; chrome?: string; packaged: boolean };
  /** Hands the user a generated file (a report, diagnostics): a save dialog on the desktop, a download in the browser. Resolves to where it went, or null if cancelled. */
  saveFile?(name: string, text: string): Promise<string | null>;
  /** Shows a file in the computer's file manager. */
  showInFolder?(path: string): void;
  /** The text on the clipboard, for pasting into the terminal. */
  readClipboard?(): Promise<string>;
  /**
   * Who may sign in to GitHub in this app. Only a hosted server sets it, since a server is shared by whoever can reach it; the desktop app
   * is the one person's own and leaves it out. Asked after GitHub says who it is and before anything is stored.
   */
  allowLogin?(login: string): boolean;
  /**
   * The app has to sign Claude Code in itself, because there is no one at the machine to run `claude` (a hosted server). The UI then makes
   * signing in the first thing you do, before anything else works. The desktop app leaves this out: it uses the Claude Code you already have.
   */
  requireAgentLogin?: boolean;
  /**
   * Where the GitHub CLI keeps its config. A host that sets it gets the sign-in written there (as `hosts.yml`) and removed again on sign-out,
   * so `gh` and git's `gh auth git-credential` helper in agents and the terminal use whatever token helm holds now, renewals included.
   * The desktop app leaves this out: its user has their own credentials.
   */
  ghConfigDir?: string;
  /** Set to false where linking a companion server is not offered (the hosted server: D-101). The desktop app leaves it out. */
  companion?: false;
  /** Things that happen on the user's own computer, which a hosted server has no access to. */
  chooseFolder(): Promise<string | null>;
  openExternal(url: string): Promise<void>;
  openPath(path: string): Promise<string>;
  copyText(text: string): Promise<void>;
}
