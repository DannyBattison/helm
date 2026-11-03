import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

// Handshake only: no login, session, prompt, or billable model request.
export function probe(command = process.env.CURSOR_AGENT_BIN || 'agent', args = ['acp'], timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'ignore'], shell: false });
    const lines = createInterface({ input: child.stdout });
    const timer = setTimeout(() => finish(new Error('Cursor ACP initialize timed out')), timeoutMs);
    let done = false;
    function finish(error, result) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      lines.close();
      child.stdin.destroy();
      child.kill();
      const killTimer = setTimeout(() => child.kill('SIGKILL'), 1_000);
      killTimer.unref();
      child.once('close', () => clearTimeout(killTimer));
      error ? reject(error) : resolve(result);
    }
    child.on('error', error => finish(error));
    child.stdin.on('error', error => finish(error));
    child.on('exit', code => finish(new Error(`Cursor exited before initialize completed (code ${code})`)));
    lines.on('line', line => {
      let message;
      try { message = JSON.parse(line); }
      catch { finish(new Error('Cursor emitted invalid JSON on ACP stdout')); return; }
      if (message.id !== 1 || message.method) return;
      if (message.error) { finish(new Error(`Cursor initialize failed (RPC ${message.error.code})`)); return; }
      if (message.result?.protocolVersion !== 1) {
        finish(new Error('Cursor returned an unsupported ACP protocol version'));
        return;
      }
      // Allowlist output: do not dump credentials, account data, or raw messages.
      const { protocolVersion, agentInfo, agentCapabilities, authMethods } = message.result;
      finish(null, { protocolVersion, agentInfo, agentCapabilities,
        authMethods: authMethods?.map(({ id, name }) => ({ id, name })) });
    });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      protocolVersion: 1,
      clientInfo: { name: 'helm-cursor-feasibility', version: '0.1.0' },
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    } }) + '\n');
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await probe(), null, 2)); }
  catch (error) { console.error(`Cursor probe: ${error.message}`); process.exitCode = 1; }
}
