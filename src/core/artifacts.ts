import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { Artifact } from '../shared/types';

/** Largest file sent to the UI: it travels as base64 (over a WebSocket on the hosted server). */
export const MAX_ARTIFACT = 25 * 1024 * 1024;

const TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif',
  pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json', html: 'text/html', zip: 'application/zip'
};

/** Where the files a session's agent hands to the user are kept. It lives in the temp folder and goes when the session is deleted. */
export const artifactDir = (sessionId: string) => join(tmpdir(), 'helm-artifacts', sessionId.replace(/[^\w.-]/g, '_'));

export const mediaTypeOf = (name: string) => TYPES[name.split('.').pop()?.toLowerCase() || ''] || 'application/octet-stream';

export async function ensureArtifactDir(sessionId: string): Promise<string> {
  const dir = artifactDir(sessionId);
  await mkdir(dir, { recursive: true });
  return dir;
}

/** The file, or null when it is not there (never made, or the temp folder was cleaned: the artifact has expired). Only names directly in the folder are served. */
export async function readArtifact(sessionId: string, name: string): Promise<Artifact | null> {
  const file = basename(name.replace(/\\/g, '/'));
  if (!file || file === '.' || file === '..' || file !== name) return null;
  const path = join(artifactDir(sessionId), file);
  try {
    const st = await stat(path);
    if (!st.isFile()) return null;
    if (st.size > MAX_ARTIFACT) return { name: file, mediaType: mediaTypeOf(file), size: st.size, data: null };
    return { name: file, mediaType: mediaTypeOf(file), size: st.size, data: (await readFile(path)).toString('base64') };
  } catch { return null; }
}

export const dropArtifacts = (sessionId: string) => rm(artifactDir(sessionId), { recursive: true, force: true }).catch(() => undefined);
