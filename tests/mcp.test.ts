import { describe, expect, it } from 'vitest';
import { cleanMcp, mcpConfig, mcpProblem } from '../src/shared/mcp';
import type { McpServer } from '../src/shared/types';

const stdio = (name: string, o: Partial<McpServer> = {}): McpServer => ({ name, type: 'stdio', command: 'npx', args: ['-y', 'x'], env: {}, url: '', headers: {}, ...o });
const http = (name: string, o: Partial<McpServer> = {}): McpServer => ({ name, type: 'http', command: '', args: [], env: {}, url: 'https://a.test/mcp', headers: {}, ...o });

describe('mcp servers', () => {
  it('validates names, commands and addresses', () => {
    expect(mcpProblem(stdio('ok'))).toBe('');
    expect(mcpProblem(stdio('bad name'))).toMatch(/name/);
    expect(mcpProblem(stdio('dup'), ['dup'])).toMatch(/already/);
    expect(mcpProblem(stdio('a', { command: ' ' }))).toMatch(/command/);
    expect(mcpProblem(http('a', { url: 'nope' }))).toMatch(/valid/);
    expect(mcpProblem(http('a', { url: 'ftp://x' }))).toMatch(/http/);
    expect(mcpProblem(http('a'))).toBe('');
  });
  it('cleans fields to the type', () => {
    const c = cleanMcp(stdio(' a ', { args: [' x ', ''], env: { ' K ': 'v', '': 'z' }, url: 'junk' }));
    expect(c).toMatchObject({ name: 'a', args: ['x'], env: { K: 'v' }, url: '', headers: {} });
  });
  it('merges global and repository servers, the repository winning, and skips disabled', () => {
    const cfg = mcpConfig([stdio('a'), http('b'), stdio('off', { disabled: true })], [http('a'), stdio('c', { env: { T: '1' } })]);
    expect(Object.keys(cfg).sort()).toEqual(['a', 'b', 'c']);
    expect(cfg.a).toEqual({ type: 'http', url: 'https://a.test/mcp' });
    expect(cfg.c).toEqual({ type: 'stdio', command: 'npx', args: ['-y', 'x'], env: { T: '1' } });
  });
  it('a disabled repository server hides a global one of the same name', () => {
    expect(mcpConfig([stdio('a')], [stdio('a', { disabled: true })])).toEqual({});
  });
});
