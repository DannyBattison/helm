import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Claude's backend with its collaborators stood in for: the sign-in helper, the command runner and the Agent SDK.
const h = vi.hoisted(() => {
  const auth = {
    status: vi.fn(), startLogin: vi.fn(), submitCode: vi.fn(), cancel: vi.fn(), logout: vi.fn()
  };
  const run = vi.fn();
  const sdk = { queries: [] as any[], usage: vi.fn(), messages: [] as any[], throwAt: null as Error | null, closeThrows: false };
  return { auth, run, sdk };
});

vi.mock('../src/core/claudeAuth', () => ({ ClaudeAuth: class { constructor(public exe: () => string) { h.auth.exe = exe as any; } status = h.auth.status; startLogin = h.auth.startLogin; submitCode = h.auth.submitCode; cancel = h.auth.cancel; logout = h.auth.logout; } }));
vi.mock('../src/core/util', async (orig) => ({ ...(await orig<any>()), run: (...a: any[]) => h.run(...a) }));
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: ({ prompt, options }: any) => {
    const q: any = {
      prompt, options, interrupt: vi.fn(async () => undefined), setModel: vi.fn(async () => undefined), setPermissionMode: vi.fn(async () => undefined), applyFlagSettings: vi.fn(async () => undefined),
      usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: (a: any) => h.sdk.usage(a),
      close: () => { if (h.sdk.closeThrows) throw new Error('closed'); },
      async *[Symbol.asyncIterator]() { if (h.sdk.throwAt) throw h.sdk.throwAt; for (const m of h.sdk.messages) yield m; }
    };
    h.sdk.queries.push(q);
    return q;
  },
  getSessionInfo: async () => null, getSessionMessages: async () => [], getSubagentMessages: async () => [], listSessions: async () => [], forkSession: async () => ({ sessionId: 'x' }), renameSession: async () => undefined
}));

import { ClaudeBackend } from '../src/core/claudeBackend';

let b: ClaudeBackend;
beforeEach(() => {
  b = new ClaudeBackend({ sdk: () => '/sdk/claude', cli: () => '/cli/claude' });
  h.sdk.queries.length = 0; h.sdk.messages = []; h.sdk.throwAt = null; h.sdk.closeThrows = false;
  h.run.mockReset(); h.sdk.usage.mockReset();
  for (const f of Object.values(h.auth)) if (typeof f === 'function' && 'mockReset' in f) (f as any).mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe('Claude sign-in', () => {
  it('says how each kind of login is paid for, and nothing for no login', async () => {
    h.auth.status.mockResolvedValueOnce({ loggedIn: true, method: 'claude.ai' }).mockResolvedValueOnce({ loggedIn: true, method: 'api key' }).mockResolvedValueOnce({ loggedIn: false, method: 'none' });
    expect(await b.auth.status()).toEqual({ loggedIn: true, method: 'claude.ai', billing: 'subscription' });
    expect(await b.auth.status()).toEqual({ loggedIn: true, method: 'api key', billing: 'api' });
    expect(await b.auth.status()).toEqual({ loggedIn: false, method: 'none' });
  });
  it('asks for a code to be pasted back, takes it, cancels and signs out', async () => {
    h.auth.startLogin.mockResolvedValue({ url: 'https://claude.example' });
    h.auth.submitCode.mockResolvedValue({ loggedIn: true, method: 'claude.ai' });
    h.auth.logout.mockResolvedValue({ loggedIn: false, method: 'none' });
    expect(await b.auth.startLogin()).toEqual({ url: 'https://claude.example', needsCode: true });
    expect(await b.auth.submitCode!('abc')).toMatchObject({ loggedIn: true, billing: 'subscription' });
    b.auth.cancel();
    expect(h.auth.cancel).toHaveBeenCalled();
    expect((await b.auth.logout()).loggedIn).toBe(false);
  });
  it('runs the command-line tool from the configured path, else `claude`', () => {
    expect(h.auth.exe()).toBe('/cli/claude');
    expect(new ClaudeBackend({ sdk: () => undefined, cli: () => undefined }) && h.auth.exe()).toBe('claude');
  });
});

describe('Claude version and live sessions', () => {
  it('reads the version from the command-line tool, or a path it is given', async () => {
    h.run.mockResolvedValueOnce('2.1.309 (Claude Code)\n').mockResolvedValueOnce('3.0.0 (Claude Code)');
    expect(await b.version()).toBe('2.1.309');
    expect(h.run.mock.calls[0][0]).toBe('/cli/claude');
    expect(await b.version('/other/claude')).toBe('3.0.0');
    expect(h.run.mock.calls[1][0]).toBe('/other/claude');
  });
  it('has no version when it cannot be run or prints nothing', async () => {
    h.run.mockRejectedValueOnce(new Error('ENOENT')).mockResolvedValueOnce('  ');
    expect(await b.version()).toBeNull();
    expect(await b.version()).toBeNull();
  });
  it('lists the sessions with a process running, or says it cannot tell', async () => {
    h.run.mockResolvedValueOnce('[{"sessionId":"a"},{"sessionId":"b"}]').mockResolvedValueOnce('not json').mockRejectedValueOnce(new Error('x'));
    expect(await b.conversations.live()).toEqual(new Set(['a', 'b']));
    expect(await b.conversations.live()).toBeNull();
    expect(await b.conversations.live()).toBeNull();
  });
});

describe('Claude plan usage', () => {
  const future = '2026-12-01T00:00:00Z';
  it('reads the five-hour and weekly windows of a subscription', async () => {
    h.sdk.usage.mockResolvedValue({ subscription_type: 'max', rate_limits_available: true, rate_limits: { five_hour: { utilization: 40, resets_at: future }, seven_day: { utilization: 10, resets_at: future } } });
    const u = await b.planUsage('/home');
    expect(u).toEqual({ billing: 'subscription', fiveHour: { util: 0.4, resetsAt: Date.parse(future) / 1000 }, weekly: { util: 0.1, resetsAt: Date.parse(future) / 1000 } });
    expect(h.sdk.queries[0].options).toMatchObject({ cwd: '/home', settingSources: [], pathToClaudeCodeExecutable: '/cli/claude' });
  });
  it('says per token when there is no subscription, and gives no windows that are not offered', async () => {
    h.sdk.usage.mockResolvedValue({ rate_limits_available: false });
    expect(await b.planUsage('/home')).toEqual({ billing: 'api' });
    h.sdk.usage.mockResolvedValue({ subscription_type: 'pro', rate_limits_available: true, rate_limits: { five_hour: { utilization: null }, seven_day: null } });
    expect(await b.planUsage('/home')).toEqual({ billing: 'subscription', fiveHour: undefined, weekly: undefined });
  });
  it('gives up quietly when it cannot be asked, even if closing fails', async () => {
    h.sdk.usage.mockRejectedValue(new Error('not signed in'));
    h.sdk.closeThrows = true;
    expect(await b.planUsage('/home')).toBeNull();
  });
  it('lets the SDK find its own executable when none is configured', async () => {
    h.sdk.usage.mockResolvedValue({});
    await new ClaudeBackend({ sdk: () => undefined, cli: () => undefined }).planUsage('/home');
    expect('pathToClaudeCodeExecutable' in h.sdk.queries[0].options).toBe(false);
  });
});

describe('a Claude session', () => {
  const opts = (over: any = {}) => ({ cwd: '/w', model: 'opus', permMode: 'edits' as const, systemAppend: 'extra', canUseTool: async (_t: string, i: any) => ({ behavior: 'allow' as const, updatedInput: i }), admitSubagent: async () => undefined, ...over });

  it('starts the SDK with the instructions, directories, MCP servers, remote control and the conversation to resume', () => {
    b.start(opts({ effort: 'high', resume: 'conv-1', extraDirs: ['/up'], mcpServers: { gh: { type: 'http', url: 'u' } }, remoteControl: true, env: { GIT_AUTHOR_NAME: 'Claude' } }));
    expect(h.sdk.queries[0].options).toMatchObject({
      cwd: '/w', model: 'opus', effort: 'high', permissionMode: 'acceptEdits', resume: 'conv-1', additionalDirectories: ['/up'],
      mcpServers: { gh: { type: 'http', url: 'u' } }, settings: { remoteControlAtStartup: true }, pathToClaudeCodeExecutable: '/sdk/claude',
      systemPrompt: { type: 'preset', preset: 'claude_code', append: 'extra' }
    });
    expect(h.sdk.queries[0].options.env).toMatchObject({ CLAUDE_AGENT_SDK_CLIENT_APP: 'helm', GIT_AUTHOR_NAME: 'Claude' });
  });
  it('leaves out what is not asked for', () => {
    new ClaudeBackend({ sdk: () => undefined, cli: () => undefined }).start(opts({ permMode: 'all' }));
    const o = h.sdk.queries[0].options;
    expect(o.permissionMode).toBe('bypassPermissions');
    for (const k of ['effort', 'resume', 'additionalDirectories', 'mcpServers', 'settings', 'pathToClaudeCodeExecutable']) expect(k in o).toBe(false);
  });
  it('maps each permission mode', () => {
    for (const [mode, want] of [['ask', 'default'], ['plan', 'plan'], ['edits', 'acceptEdits'], ['all', 'bypassPermissions']] as const) {
      b.start(opts({ permMode: mode }));
      expect(h.sdk.queries[h.sdk.queries.length - 1].options.permissionMode).toBe(want);
    }
  });
  it('passes approvals to the caller and answers the subagent gate in the SDK\'s words', async () => {
    const asked: any[] = [];
    b.start(opts({ canUseTool: async (t: string, i: any, d: any) => { asked.push([t, i, d]); return { behavior: 'allow' }; }, admitSubagent: async (id: string) => (id === 'no' ? 'Too many.' : undefined) }));
    const o = h.sdk.queries[0].options;
    await o.canUseTool('Bash', { command: 'ls' }, { decisionReason: 'why' });
    expect(asked).toEqual([['Bash', { command: 'ls' }, { decisionReason: 'why' }]]);
    const hook = o.hooks.PreToolUse[0];
    expect(hook.matcher).toBe('Agent|Task');
    expect(await hook.hooks[0]({ tool_use_id: 'ok' })).toEqual({});
    expect(await hook.hooks[0]({})).toEqual({});
    expect(await hook.hooks[0]({ tool_use_id: 'no' })).toEqual({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'Too many. This is helm’s limit, not something the user declined. Wait for one to finish, or do this work yourself.' } });
  });
  it('turns messages into events, passes controls to the SDK, and swallows a control that fails', async () => {
    h.sdk.messages = [{ type: 'result', is_error: false, result: 'done', total_cost_usd: 1 }];
    const handle = b.start(opts());
    const q = h.sdk.queries[0];
    const events: any[] = [];
    for await (const e of handle.events) events.push(e);
    expect(events).toEqual([{ t: 'result', isError: false, text: 'done', costUsd: 1 }]);
    await handle.interrupt();
    await handle.setModel('haiku');
    await handle.setEffort('low');
    await handle.setEffort(null);
    await handle.setPermMode('plan');
    expect(q.interrupt).toHaveBeenCalled();
    expect(q.setModel).toHaveBeenCalledWith('haiku');
    expect(q.applyFlagSettings.mock.calls.map((c: any) => c[0])).toEqual([{ effortLevel: 'low' }, { effortLevel: undefined }]);
    expect(q.setPermissionMode).toHaveBeenCalledWith('plan');
    q.setModel.mockRejectedValueOnce(new Error('late'));
    await expect(handle.setModel('opus')).resolves.toBeUndefined();
  });
  it('queues what is sent, in order, with images, and ends the input on close', async () => {
    const handle = b.start(opts());
    const input = h.sdk.queries[0].prompt[Symbol.asyncIterator]();
    handle.send('first');
    handle.send('', [{ mediaType: 'image/png', data: 'AAA' }]);
    expect((await input.next()).value.message.content).toBe('first');
    const second = (await input.next()).value.message.content;
    expect(second[0]).toMatchObject({ type: 'image', source: { media_type: 'image/png', data: 'AAA' } });
    expect(second[1]).toEqual({ type: 'text', text: 'See the attached image.' });
    const waiting = input.next();
    expect(handle.closed).toBe(false);
    handle.close();
    expect(handle.closed).toBe(true);
    expect((await waiting).done).toBe(true);
    expect((await input.next()).done).toBe(true);
  });
  it('hands a message to a reader that is already waiting', async () => {
    const handle = b.start(opts());
    const input = h.sdk.queries[0].prompt[Symbol.asyncIterator]();
    const waiting = input.next();
    handle.send('now');
    expect((await waiting).value.message.content).toBe('now');
  });
});

describe('a Claude review', () => {
  const req = { cwd: '/w', model: 'sonnet', prompt: 'review it', schema: { type: 'object' } };
  it('reads the answer, the cost and the structured output', async () => {
    h.sdk.messages = [{ type: 'system' }, { type: 'result', is_error: false, result: 'text', structured_output: { summary: 's' }, total_cost_usd: 0.5 }];
    expect(await b.review(req)).toEqual({ structured: { summary: 's' }, text: 'text', cost: 0.5, failure: '' });
    expect(h.sdk.queries[0].options).toMatchObject({ cwd: '/w', model: 'sonnet', permissionMode: 'dontAsk', maxTurns: 30, outputFormat: { type: 'json_schema', schema: { type: 'object' } }, pathToClaudeCodeExecutable: '/sdk/claude' });
  });
  it('reports a reviewer that stopped early, with or without its own words', async () => {
    h.sdk.messages = [{ type: 'result', is_error: true, result: '', subtype: 'error_max_turns' }];
    expect((await b.review(req)).failure).toBe('error_max_turns');
    h.sdk.messages = [{ type: 'result', is_error: true, result: 'It broke', subtype: 'x' }];
    expect((await b.review(req)).failure).toBe('It broke');
    h.sdk.messages = [{ type: 'result', is_error: true, subtype: undefined }];
    expect((await b.review(req)).failure).toBe('The reviewer stopped early');
  });
  it('reports an error from the SDK, and survives a failure to close', async () => {
    h.sdk.throwAt = new Error('the SDK broke');
    h.sdk.closeThrows = true;
    expect((await new ClaudeBackend({ sdk: () => undefined, cli: () => undefined }).review(req)).failure).toBe('the SDK broke');
  });
});
