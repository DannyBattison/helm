import type { HelmEvents, ThemePref } from '../shared/types';

/**
 * Everything the app logic needs from wherever it runs. The desktop app implements it with Electron (`index.ts`); the hosted
 * server implements it with plain Node (`hosted-server/`). Nothing in `core.ts` or its siblings imports Electron.
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
  notify?(n: { kind: 'attention' | 'ready' | 'failed'; title: string; body: string; silent: boolean; sessionId: string }): void;
  /**
   * Who may sign in to GitHub in this app. Only a hosted server sets it, since a server is shared by whoever can reach it; the desktop app
   * is the one person's own and leaves it out. Asked after GitHub says who it is and before anything is stored.
   */
  allowLogin?(login: string): boolean;
  /** Things that happen on the user's own computer, which a hosted server has no access to. */
  chooseFolder(): Promise<string | null>;
  openExternal(url: string): Promise<void>;
  openPath(path: string): Promise<string>;
  copyText(text: string): Promise<void>;
}
