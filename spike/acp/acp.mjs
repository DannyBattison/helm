// Raw ACP client: newline-delimited JSON-RPC over a child process's stdio. No SDK.
import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
export class Acp {
  constructor(cmd, args, { env = {}, log = './events.jsonl' } = {}) {
    this.log = log;
    this.p = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...env } });
    this.id = 0; this.pending = new Map(); this.updates = []; this.perms = []; this.buf = ''; this.stderr = '';
    this.onUpdate = () => {}; this.permit = (o) => o.options.find((x) => x.kind === 'allow_once') ?? o.options[0];
    this.p.stderr.on('data', (d) => { this.stderr += d; });
    this.p.stdout.on('data', (d) => {
      this.buf += d; let i;
      while ((i = this.buf.indexOf('\n')) >= 0) { const line = this.buf.slice(0, i); this.buf = this.buf.slice(i + 1); if (line.trim()) this.handle(JSON.parse(line)); }
    });
  }
  send(m) { this.p.stdin.write(JSON.stringify(m) + '\n'); }
  request(method, params, ms = 120000) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('timeout ' + method)), ms);
      this.pending.set(id, { res: (v) => { clearTimeout(t); res(v); }, rej: (e) => { clearTimeout(t); rej(e); } });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }
  notify(method, params) { this.send({ jsonrpc: '2.0', method, params }); }
  handle(m) {
    appendFileSync(this.log, JSON.stringify(m) + '\n');
    if (m.id != null && !m.method) { const p = this.pending.get(m.id); this.pending.delete(m.id); return m.error ? p?.rej(Object.assign(new Error(m.error.message), { data: m.error })) : p?.res(m.result); }
    if (m.method === 'session/update') { this.updates.push(m.params.update); return this.onUpdate(m.params.update); }
    if (m.method === 'session/request_permission') {
      this.perms.push(m.params);
      const pick = this.permit(m.params);
      return this.send({ jsonrpc: '2.0', id: m.id, result: { outcome: pick ? { outcome: 'selected', optionId: pick.optionId } : { outcome: 'cancelled' } } });
    }
    if (m.id != null) this.send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'unsupported: ' + m.method } });
  }
  close() { this.p.kill(); }
}
export const INIT = { protocolVersion: 1, clientInfo: { name: 'helm-spike', version: '0' }, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } };
export const summarize = (u) => {
  const t = u.sessionUpdate;
  if (t === 'agent_message_chunk' || t === 'agent_thought_chunk') return null;
  if (t === 'tool_call') return `tool_call ${u.toolCallId} kind=${u.kind} status=${u.status} title=${JSON.stringify(u.title)} rawInput=${JSON.stringify(u.rawInput)?.slice(0, 140)} content=${(u.content || []).map((c) => c.type).join(',')} _meta=${JSON.stringify(u._meta)?.slice(0, 160)}`;
  if (t === 'tool_call_update') return `tool_call_update ${u.toolCallId} status=${u.status} content=${(u.content || []).map((c) => c.type + (c.type === 'diff' ? `(${c.path})` : '')).join(',')} rawOutput=${JSON.stringify(u.rawOutput)?.slice(0, 100)}`;
  return `${t} ${JSON.stringify(u).slice(0, 240)}`;
};
