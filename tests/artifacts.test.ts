import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { artifactDir, dropArtifacts, ensureArtifactDir, mediaTypeOf, readArtifact } from '../src/core/artifacts';

const id = 'test-artifacts-' + process.pid;
afterAll(() => dropArtifacts(id));

describe('artifacts', () => {
  it('reads a file from the session folder and types it by extension', async () => {
    const dir = await ensureArtifactDir(id);
    await writeFile(join(dir, 'a.png'), Buffer.from([1, 2, 3]));
    const a = await readArtifact(id, 'a.png');
    expect(a).toEqual({ name: 'a.png', mediaType: 'image/png', size: 3, data: 'AQID' });
    expect(mediaTypeOf('x.bin')).toBe('application/octet-stream');
  });
  it('refuses paths that leave the folder and files that are missing', async () => {
    await mkdir(artifactDir(id), { recursive: true });
    expect(await readArtifact(id, '../x')).toBeNull();
    expect(await readArtifact(id, 'sub/a.png')).toBeNull();
    expect(await readArtifact(id, 'nope.png')).toBeNull();
  });
  it('is gone once dropped', async () => {
    await dropArtifacts(id);
    expect(await readArtifact(id, 'a.png')).toBeNull();
  });
});
