import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { adopt, applyImport, buildExport, parseExport, readEntry, target, walk, writeEntry } from '../src/core/migrate';
import { Store } from '../src/core/store';

const mk = async () => { const s = new Store(); await s.load(await mkdtemp(join(tmpdir(), 'helm-cov-mig-'))); return s; };
const bundle = (o: any = {}) => JSON.stringify({ format: 'helm-export', version: 1, exportedAt: 0, state: {}, files: {}, ...o });

describe('files', () => {
  it('walks nested folders, ignoring temporary files and missing folders', async () => {
    const s = await mk();
    await mkdir(join(s.root, 'repo-artifacts', 'a', 'b'), { recursive: true });
    await writeFile(join(s.root, 'repo-artifacts', 'a', 'b', 'x.md'), 'x');
    await writeFile(join(s.root, 'repo-artifacts', 'y.png.tmp'), 'x');
    const out: string[] = [];
    await walk(s.root, 'repo-artifacts', out);
    await walk(s.root, 'nothing-here', out);
    expect(out).toEqual(['repo-artifacts/a/b/x.md']);
  });
  it('reads text as utf8, other files as base64, and nothing for a missing file', async () => {
    const s = await mk();
    await writeFile(join(s.root, 'a.txt'), 'hi');
    await writeFile(join(s.root, 'b.png'), Buffer.from([1, 2, 3]));
    expect(await readEntry(s.root, 'a.txt')).toEqual({ enc: 'utf8', data: 'hi' });
    expect(await readEntry(s.root, 'b.png')).toEqual({ enc: 'base64', data: 'AQID' });
    expect(await readEntry(s.root, 'none.txt')).toBeNull();
  });
  it('writes both encodings, creating folders', async () => {
    const s = await mk();
    await writeEntry(join(s.root, 'repo-artifacts', 'n', 'a.txt'), { enc: 'utf8', data: 'hi' });
    await writeEntry(join(s.root, 'repo-artifacts', 'n', 'b.bin'), { enc: 'base64', data: 'AQID' });
    expect(await readFile(join(s.root, 'repo-artifacts', 'n', 'a.txt'), 'utf8')).toBe('hi');
    expect([...(await readFile(join(s.root, 'repo-artifacts', 'n', 'b.bin')))]).toEqual([1, 2, 3]);
  });
});

describe('target', () => {
  it('accepts paths under the exported folders and files only', () => {
    expect(target('/d', 'transcripts/a.json')).toBe('/d/transcripts/a.json');
    expect(target('/d', 'activity.jsonl')).toBe('/d/activity.jsonl');
  });
  it.each([['a\0b'], ['transcripts\\a'], ['secret.bin'], ['transcripts/./a'], ['transcripts//a'], ['transcripts/../x'], ['transcripts/']])('rejects %j', (n) => {
    expect(target('/d', n)).toBeNull();
  });
  it('rejects a name that is not a string', () => expect(target('/d', 5 as any)).toBeNull());
  it('rejects a path that resolves to the data directory itself', () => expect(target('/d', 'activity.jsonl/..')).toBeNull());
});

describe('adopt', () => {
  it('stops subagents that were working and keeps the end time they have', () => {
    const s = adopt({ status: 'idle', subagents: [{ status: 'working' }, { status: 'working', endedAt: 5 }, { status: 'done' }] });
    expect(s.subagents.map((a: any) => a.status)).toEqual(['stopped', 'stopped', 'done']);
    expect(s.subagents[1].endedAt).toBe(5);
    expect(typeof s.subagents[0].endedAt).toBe('number');
  });
  it('creates the subagent list when missing and leaves an idle session alone', () => {
    expect(adopt({ status: 'idle' })).toEqual({ status: 'idle', subagents: [] });
  });
  it('marks a running session as imported, or as owned elsewhere', () => {
    const a = adopt({ status: 'attention', ask: { q: 1 }, queued: ['x'] });
    expect(a).toMatchObject({ status: 'idle', step: 'Imported', ask: undefined, queued: undefined });
    expect(a.remoteOwner).toBeUndefined();
    expect(adopt({ status: 'working' }, 'box')).toMatchObject({ step: 'Running on box', remoteOwner: 'box' });
  });
  it('flags a worktree that is not here, unless already flagged, absent, or a free folder that is not managed', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'helm-cov-adopt-'));
    expect(adopt({ status: 'idle', worktree: dir }).worktreeGone).toBeUndefined();
    expect(adopt({ status: 'idle', worktree: join(dir, 'x') }).worktreeGone).toBe(true);
    expect(adopt({ status: 'idle', worktree: join(dir, 'x'), worktreeGone: false }).worktreeGone).toBe(true);
    expect(adopt({ status: 'idle' }).worktreeGone).toBeUndefined();
    expect(adopt({ status: 'idle', worktree: join(dir, 'x'), free: { managed: false } }).worktreeGone).toBeUndefined();
    expect(adopt({ status: 'idle', worktree: join(dir, 'x'), free: { managed: true } }).worktreeGone).toBe(true);
  });
});

describe('parseExport', () => {
  it('rejects text that is not JSON, or lacks the format, state or files', () => {
    for (const t of ['nope', 'null', bundle({ format: 'x' }), bundle({ state: null }), bundle({ files: null }), bundle({ state: 'x' })]) expect(() => parseExport(t)).toThrow(/not a helm export/);
  });
  it('rejects a missing version or one from the future', () => {
    expect(() => parseExport(bundle({ version: '1' }))).toThrow(/newer version/);
    expect(() => parseExport(bundle({ version: 2 }))).toThrow(/newer version/);
    expect(parseExport(bundle({ version: 0 })).version).toBe(0);
  });
});

describe('export of activity logs and import details', () => {
  it('includes the activity log when present and skips an unreadable entry', async () => {
    const a = await mk();
    await writeFile(join(a.root, 'activity.jsonl'), '{}\n');
    const b = parseExport(await buildExport(a));
    expect(Object.keys(b.files)).toContain('activity.jsonl');
  });
  it('merges lists, totals and automations without replacing what is here', async () => {
    const a = await mk();
    a.data.repos.push({ id: 'keep', owner: 'me' } as any);
    a.data.sessions.push({ id: 'keep', step: 'mine' } as any);
    a.data.automations.push({ id: 'ag1', name: 'mine' } as any);
    a.data.usage.push({ t: 5 } as any);
    a.data.daily.push({ day: '2026-01-02' } as any);
    (a.data as any).totals = { x: 1 };
    const text = bundle({
      state: {
        repos: [{ id: 'keep', owner: 'them' }, { id: 'new' }, null, {}],
        sessions: [{ id: 'keep' }, { id: 'new-s', status: 'idle' }, null],
        automations: [{ id: 'ag1', name: 'theirs' }, { id: 'ag2' }, null],
        usage: [{ t: 9 }, { t: 5 }, { t: 1 }], daily: [{ day: '2026-01-03' }, { day: '2026-01-01' }, { day: '2026-01-02' }],
        totals: { x: 9, y: 2 },
        settings: { defaultModel: 'opus', claudePath: '/theirs/claude' }
      },
      files: { 'transcripts/new-s.json': { enc: 'utf8', data: '[]' }, 'transcripts/bad.json': { enc: 'utf8' }, 'transcripts/nul.json': null, 'x.bin': { enc: 'utf8', data: 'z' } }
    });
    const claudePath = a.data.settings.claudePath;
    const r = await applyImport(a, text);
    expect(r).toEqual({ repos: 1, sessions: 1, files: 1 });
    expect(a.data.repos.find((x) => x.id === 'keep')!.owner).toBe('me');
    expect(a.data.sessions.find((x) => x.id === 'keep')).toMatchObject({ step: 'mine' });
    expect(a.data.automations.map((x) => x.id)).toEqual(['ag1', 'ag2']);
    expect(a.data.automations[0]).toMatchObject({ name: 'mine' });
    expect(a.data.usage.map((u) => u.t)).toEqual([1, 5, 9]);
    expect(a.data.daily.map((u) => u.day)).toEqual(['2026-01-01', '2026-01-02', '2026-01-03']);
    expect(a.data.totals).toEqual({ x: 1, y: 2 });
    expect(a.data.settings.defaultModel).toBe('opus');
    expect(a.data.settings.claudePath).toBe(claudePath);
    expect(existsSync(join(a.root, 'transcripts', 'bad.json'))).toBe(false);
    expect(existsSync(join(a.root, 'x.bin'))).toBe(false);
  });
  it('copes with state that has no lists and non-object settings', async () => {
    const a = await mk();
    const before = a.data.settings.defaultModel;
    expect(await applyImport(a, bundle({ state: { repos: 'x', sessions: {}, automations: 1, usage: 'u', settings: 'str' } }))).toEqual({ repos: 0, sessions: 0, files: 0 });
    expect(a.data.settings.defaultModel).toBe(before);
  });
});
