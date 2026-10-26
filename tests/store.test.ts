import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultSettings, Store } from '../src/core/store';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'helm-store-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const loaded = async () => { const s = new Store(); await s.load(dir); return s; };

describe('store load and save', () => {
  it('starts with defaults on a first run', async () => {
    const s = await loaded();
    expect(s.root).toBe(dir);
    expect(s.data.settings.branchPrefix).toBe('agent/');
    expect(s.data.sessions).toEqual([]);
  });

  it('round-trips through flush and fills in settings added later', async () => {
    const s = await loaded();
    s.data.settings.branchPrefix = 'x/';
    await s.flush();
    const raw = JSON.parse(readFileSync(join(dir, 'helm.json'), 'utf8'));
    delete raw.settings.weeklyLimit;
    writeFileSync(join(dir, 'helm.json'), JSON.stringify(raw));
    const t = await loaded();
    expect(t.data.settings.branchPrefix).toBe('x/');
    expect(t.data.settings.weeklyLimit).toBe(defaultSettings().weeklyLimit);
  });

  it('migrates older saves: subagents, comma separated copy list, lifetime totals, activity log', async () => {
    const session = { id: 's1', repoId: 'r1', startedAt: 5, tokens: { input: 1, output: 2, cacheRead: 3 }, cost: 4 };
    writeFileSync(join(dir, 'helm.json'), JSON.stringify({
      sessions: [session, { ...session, id: 's2', endedAt: 9, tokens: { input: 1, output: 1, cacheRead: 1 }, cost: 1 }],
      settings: { copyFiles: '.env, .env.local', githubClientId: '' },
      activity: [{ id: 'a', t: 2, kind: 'x' }, { id: 'b', t: 1, kind: 'y' }]
    }));
    const s = await loaded();
    expect(s.data.sessions[0].subagents).toEqual([]);
    expect(s.data.sessions[0].lastAccess).toBe(5);
    expect(s.data.sessions[1].lastAccess).toBe(9);
    expect(s.data.settings.copyFiles).toBe('.env\n.env.local');
    expect(s.data.settings.githubClientId).toBeTruthy();
    expect(s.data.totals.r1).toEqual({ input: 2, output: 3, cacheRead: 4, cost: 5 });
    expect(existsSync(join(dir, 'activity.jsonl'))).toBe(true);
    expect((await s.readLog()).map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('ignores a corrupt state file', async () => {
    writeFileSync(join(dir, 'helm.json'), '{nope');
    const s = await loaded();
    expect(s.data.repos).toEqual([]);
  });

  it('saves after a delay, once', async () => {
    const s = await loaded();
    s.save(); s.save();
    await new Promise((r) => setTimeout(r, 600));
    expect(existsSync(join(dir, 'helm.json'))).toBe(true);
  });
});

describe('activity log', () => {
  it('keeps the latest 60 in memory and everything on disk, newest first when read', async () => {
    const s = await loaded();
    for (let i = 0; i < 70; i++) s.log({ kind: 'k', t: 1000 + i } as any);
    expect(s.data.activity).toHaveLength(60);
    expect(s.logSeq).toBe(70);
    const all = await s.readLog();
    expect(all).toHaveLength(70);
    expect(all[0].t).toBe(1069);
    expect((await s.readLog(1010)).length).toBe(10);
    expect(await s.readLog(Infinity, 5)).toHaveLength(5);
  });

  it('skips a torn last line', async () => {
    const s = await loaded();
    s.log({ kind: 'k', t: 1 } as any);
    await s.readLog();
    writeFileSync(join(dir, 'activity.jsonl'), readFileSync(join(dir, 'activity.jsonl'), 'utf8') + '{"id":');
    expect(await s.readLog()).toHaveLength(1);
  });
});

describe('transcripts', () => {
  it('reads, filters bad entries, caches, saves and deletes with subagents', async () => {
    const s = await loaded();
    writeFileSync(join(dir, 'transcripts', 'a.json'), JSON.stringify([{ k: 'text' }, { nope: 1 }, null]));
    expect(await s.transcript('a')).toEqual([{ k: 'text' }]);
    expect(await s.peekTranscript('a')).toBe(await s.transcript('a'));
    expect(await s.transcript('missing')).toEqual([]);
    writeFileSync(join(dir, 'transcripts', 'b.json'), '{"not":"an array"}');
    expect(await s.transcript('b')).toEqual([]);
    expect(await s.peekTranscript('zzz')).toEqual([]);

    writeFileSync(join(dir, 'transcripts', 'c.json'), JSON.stringify([{ k: 'x' }]));
    expect(await s.peekTranscript('c')).toEqual([{ k: 'x' }]);

    (await s.transcript('a')).push({ k: 'more' } as any);
    s.saveTranscript('a'); s.saveTranscript('a');
    await s.flushAll();
    expect(JSON.parse(readFileSync(join(dir, 'transcripts', 'a.json'), 'utf8'))).toHaveLength(2);

    writeFileSync(join(dir, 'transcripts', 'a~sub.json'), '[]');
    s.saveTranscript('a');
    await s.deleteTranscripts('a');
    expect(existsSync(join(dir, 'transcripts', 'a.json'))).toBe(false);
    expect(existsSync(join(dir, 'transcripts', 'a~sub.json'))).toBe(false);
    expect(existsSync(join(dir, 'transcripts', 'c.json'))).toBe(true);
  });

  it('writes a timed save', async () => {
    const s = await loaded();
    (await s.transcript('t')).push({ k: 'x' } as any);
    s.saveTranscript('t');
    await new Promise((r) => setTimeout(r, 900));
    expect(existsSync(join(dir, 'transcripts', 't.json'))).toBe(true);
  });
});

describe('usage', () => {
  it('accumulates lifetime tokens, cost and per-day rows', async () => {
    const s = await loaded();
    s.addLifetimeTokens('r', 1, 2, 3);
    s.addUsage('r', 1.5, 10);
    s.addUsage('r', 0.5, 5);
    expect(s.data.totals.r).toEqual({ input: 1, output: 2, cacheRead: 3, cost: 2 });
    expect(s.tokensToday()).toBe(15);
    expect(s.weekSpend()).toEqual({ r: 2 });
    s.addDaily('r', 'sonnet', { cost: 1, input: 2 });
    s.addDaily('r', 'sonnet', { cost: 1, output: 3, cacheRead: 4 });
    s.addDaily('r', 'opus', { cost: 1 });
    expect(s.data.daily).toHaveLength(2);
    expect(s.data.daily[0]).toMatchObject({ cost: 2, input: 2, output: 3, cacheRead: 4 });
  });

  it('drops old usage past the cap and trims the audit trail', async () => {
    const s = await loaded();
    const old = Date.now() - 20 * 86400_000;
    s.data.usage = Array.from({ length: 5001 }, () => ({ t: old, repoId: 'r', cost: 0, tokens: 0 }));
    s.addUsage('r', 1, 1);
    expect(s.data.usage).toHaveLength(1);
    for (let i = 0; i < 6001; i++) s.data.audit.push({} as any);
    s.addAudit({} as any);
    expect(s.data.audit.length).toBeLessThanOrEqual(5001);
  });
});
