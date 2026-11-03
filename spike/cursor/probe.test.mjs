import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probe } from './probe.mjs';

const fake = (body, timeout = 2_000) => probe(process.execPath, ['-e', body], timeout);

test('initializes over NDJSON without authenticating or prompting', async () => {
  const result = await fake(`
    require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
      const request = JSON.parse(line);
      if (request.method !== 'initialize' || request.params.protocolVersion !== 1) process.exit(9);
      const reply = JSON.stringify({ jsonrpc: '2.0', id: request.id, result: {
        protocolVersion: 1, agentCapabilities: { loadSession: true },
        authMethods: [{ id: 'cursor_login', name: 'Cursor', secret: 'excluded' }],
        account: 'excluded'
      }});
      process.stdout.write(reply.slice(0, 20));
      setTimeout(() => process.stdout.write(reply.slice(20) + '\\n'), 10);
    });
  `);
  assert.deepEqual(result, { protocolVersion: 1, agentInfo: undefined,
    agentCapabilities: { loadSession: true }, authMethods: [{ id: 'cursor_login', name: 'Cursor' }] });
});

test('rejects malformed output', async () => {
  await assert.rejects(fake(`console.log('not JSON'); setInterval(() => {}, 1000)`), /invalid JSON/);
});

test('rejects RPC errors without echoing potentially sensitive error data', async () => {
  await assert.rejects(fake(`console.log(JSON.stringify({ id: 1, error: { code: -32000, message: 'secret' } })); setInterval(() => {}, 1000)`),
    { message: 'Cursor initialize failed (RPC -32000)' });
});

test('rejects early exit and times out a silent process', async () => {
  await assert.rejects(fake('process.exit(2)'), /exited before initialize/);
  await assert.rejects(fake('setInterval(() => {}, 1000)', 100), /timed out/);
});

test('reports missing CLI', async () => {
  await assert.rejects(probe('/nonexistent/helm-cursor-probe'), /ENOENT/);
});
