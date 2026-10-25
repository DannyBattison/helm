import { parse } from 'yaml';

export interface WorkflowInput {
  name: string;
  description: string;
  required: boolean;
  type: 'string' | 'boolean' | 'choice' | 'number' | 'environment';
  default: string;
  options: string[];
}

export interface Workflow {
  id: number;
  name: string;
  path: string;
  state: string;
  url: string;
  /** Has `workflow_dispatch`, so it can be started by hand. */
  dispatchable: boolean;
  inputs: WorkflowInput[];
}

export interface WorkflowRun {
  id: number;
  number: number;
  title: string;
  status: 'queued' | 'in_progress' | 'completed' | 'waiting' | string;
  conclusion: string | null;
  branch: string;
  event: string;
  actor: string;
  url: string;
  at: string;
}

/** Whether a workflow file can be run by hand, and the inputs it asks for. A file that does not parse is not dispatchable. */
export function parseDispatch(text: string): { dispatchable: boolean; inputs: WorkflowInput[] } {
  let doc: any;
  try { doc = parse(text); } catch { return { dispatchable: false, inputs: [] }; }
  // YAML 1.1 readers turn the key `on` into `true`; the yaml package does not, but accept both.
  const on = doc?.on ?? doc?.[true as any];
  const has = typeof on === 'string' ? on === 'workflow_dispatch' : Array.isArray(on) ? on.includes('workflow_dispatch') : !!on && typeof on === 'object' && 'workflow_dispatch' in on;
  if (!has) return { dispatchable: false, inputs: [] };
  const raw = on && typeof on === 'object' && !Array.isArray(on) ? on.workflow_dispatch?.inputs : undefined;
  const inputs: WorkflowInput[] = [];
  if (raw && typeof raw === 'object') {
    for (const [name, v] of Object.entries<any>(raw)) {
      const type = ['string', 'boolean', 'choice', 'number', 'environment'].includes(v?.type) ? v.type : 'string';
      inputs.push({ name, description: String(v?.description ?? ''), required: !!v?.required, type, default: v?.default == null ? '' : String(v.default), options: Array.isArray(v?.options) ? v.options.map(String) : [] });
    }
  }
  return { dispatchable: true, inputs };
}

/** Checks the values against the inputs and returns what to send: GitHub wants every value as a string. Inputs left empty are left out. */
export function prepareInputs(inputs: WorkflowInput[], values: Record<string, string>): { inputs: Record<string, string>; errors: Record<string, string> } {
  const out: Record<string, string> = {};
  const errors: Record<string, string> = {};
  for (const i of inputs) {
    const v = ((values[i.name] || i.default) ?? '').trim();
    if (!v) { if (i.required && i.type !== 'boolean') errors[i.name] = 'Required'; else if (i.type === 'boolean') out[i.name] = 'false'; continue; }
    if (i.type === 'boolean' && !/^(true|false)$/.test(v)) errors[i.name] = 'Must be true or false';
    else if (i.type === 'number' && !Number.isFinite(Number(v))) errors[i.name] = 'Must be a number';
    else if (i.type === 'choice' && i.options.length && !i.options.includes(v)) errors[i.name] = 'Pick one of the options';
    else out[i.name] = v;
  }
  return { inputs: out, errors };
}

/** Short words for a run's state. */
export function runState(r: Pick<WorkflowRun, 'status' | 'conclusion'>): { label: string; tone: 'working' | 'ready' | 'error' | 'idle' | 'attention' } {
  if (r.status !== 'completed') return { label: r.status === 'queued' ? 'Queued' : r.status === 'waiting' ? 'Waiting for approval' : 'Running', tone: r.status === 'waiting' ? 'attention' : 'working' };
  switch (r.conclusion) {
    case 'success': return { label: 'Succeeded', tone: 'ready' };
    case 'failure': case 'timed_out': case 'startup_failure': return { label: r.conclusion === 'timed_out' ? 'Timed out' : 'Failed', tone: 'error' };
    case 'cancelled': return { label: 'Cancelled', tone: 'idle' };
    default: return { label: r.conclusion || 'Done', tone: 'idle' };
  }
}
