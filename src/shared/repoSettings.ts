import type { Repo, Settings } from './types';

/** The settings a repository may set for itself. Anything it leaves alone is inherited from the defaults in Settings. */
export const REPO_SETTING_KEYS = [
  'defaultBackend', 'defaultModel', 'defaultEffort', 'permMode', 'sessionBudget', 'defaultInstructions', 'runTests',
  'branchPrefix', 'fetchBeforeSession', 'copyFiles',
  'autoPush', 'pushWhen', 'commitStyle', 'commitTrailer', 'commitAuthor',
  'deliver', 'prDraft', 'openPrAfterCreate', 'mergeMethod', 'autoMerge', 'afterMerge', 'removeAfterMerge', 'deleteBranchAfterMerge'
] as const;

export type RepoSettingKey = (typeof REPO_SETTING_KEYS)[number];
export type RepoSettings = { [K in RepoSettingKey]?: Settings[K] };

/** Keeps only the known keys, so a stale or hand-edited record cannot override anything else. */
export function cleanRepoSettings(input: unknown): RepoSettings | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const out: Record<string, unknown> = {};
  for (const k of REPO_SETTING_KEYS) if (k in (input as object) && (input as any)[k] !== undefined) out[k] = (input as any)[k];
  return Object.keys(out).length ? (out as RepoSettings) : undefined;
}

/** The settings that apply in a repository: its own overrides over the defaults. Without a repository, the defaults. */
export function effectiveSettings(defaults: Settings, repo?: Pick<Repo, 'settings'> | null): Settings {
  const own = cleanRepoSettings(repo?.settings);
  return own ? { ...defaults, ...own } : defaults;
}
