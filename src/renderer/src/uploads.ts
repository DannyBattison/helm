/** A file being sent to a repository's fixtures. Kept in the store, not a view, so it keeps showing wherever you navigate. */
export interface UploadItem {
  key: string;
  repoId: string;
  name: string;
  size: number;
  /** Bytes sent so far. */
  sent: number;
}

export const withProgress = (list: UploadItem[], key: string, sent: number): UploadItem[] => list.map((x) => (x.key === key ? { ...x, sent } : x));
export const without = (list: UploadItem[], key: string): UploadItem[] => list.filter((x) => x.key !== key);
export const percent = (x: UploadItem): number => (x.size ? Math.min(100, Math.round((x.sent / x.size) * 100)) : 100);
