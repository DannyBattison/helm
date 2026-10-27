import { describe, expect, it } from 'vitest';
import { parseDispatch, prepareInputs, runState, type WorkflowInput } from '../src/shared/workflows';

const inp = (o: Partial<WorkflowInput> & { name: string }): WorkflowInput => ({ description: '', required: false, type: 'string', default: '', options: [], ...o });

describe('workflow dispatch parsing', () => {
  it('accepts the string, list and map forms of `on`', () => {
    expect(parseDispatch('on: workflow_dispatch')).toEqual({ dispatchable: true, inputs: [] });
    expect(parseDispatch('on: push')).toEqual({ dispatchable: false, inputs: [] });
    expect(parseDispatch('on: [push, workflow_dispatch]')).toEqual({ dispatchable: true, inputs: [] });
    expect(parseDispatch('on: [push]').dispatchable).toBe(false);
    expect(parseDispatch('on:\n  workflow_dispatch:\n  push:')).toEqual({ dispatchable: true, inputs: [] });
    expect(parseDispatch('on:\n  push:').dispatchable).toBe(false);
  });

  it('treats unparseable, empty or trigger-less files as not dispatchable', () => {
    expect(parseDispatch('a: [unclosed')).toEqual({ dispatchable: false, inputs: [] });
    expect(parseDispatch('')).toEqual({ dispatchable: false, inputs: [] });
    expect(parseDispatch('name: x')).toEqual({ dispatchable: false, inputs: [] });
  });

  it('reads inputs and defaults unknown types and missing fields', () => {
    const r = parseDispatch([
      'on:',
      '  workflow_dispatch:',
      '    inputs:',
      '      env:',
      '        description: Where',
      '        required: true',
      '        type: choice',
      '        options: [dev, 2]',
      '        default: dev',
      '      verbose:',
      '        type: boolean',
      '        default: false',
      '      weird:',
      '        type: made-up',
      '      bare:'
    ].join('\n'));
    expect(r.inputs).toEqual([
      { name: 'env', description: 'Where', required: true, type: 'choice', default: 'dev', options: ['dev', '2'] },
      { name: 'verbose', description: '', required: false, type: 'boolean', default: 'false', options: [] },
      { name: 'weird', description: '', required: false, type: 'string', default: '', options: [] },
      { name: 'bare', description: '', required: false, type: 'string', default: '', options: [] }
    ]);
  });

  it('has no inputs when the inputs key is not a map', () => {
    expect(parseDispatch('on:\n  workflow_dispatch:\n    inputs: nope').inputs).toEqual([]);
    expect(parseDispatch('on:\n  workflow_dispatch: {}').inputs).toEqual([]);
  });
});

describe('workflow input preparation', () => {
  it('sends trimmed values, falls back to defaults, and leaves empty optionals out', () => {
    const r = prepareInputs([inp({ name: 'a' }), inp({ name: 'b', default: ' dflt ' }), inp({ name: 'c' }), inp({ name: 'flag', type: 'boolean' })], { a: ' hi ', c: '   ' });
    expect(r).toEqual({ inputs: { a: 'hi', b: 'dflt', flag: 'false' }, errors: {} });
  });

  it('reports each kind of problem', () => {
    const r = prepareInputs([
      inp({ name: 'req', required: true }),
      inp({ name: 'reqBool', required: true, type: 'boolean' }),
      inp({ name: 'b', type: 'boolean' }),
      inp({ name: 'n', type: 'number' }),
      inp({ name: 'ch', type: 'choice', options: ['x', 'y'] }),
      inp({ name: 'okb', type: 'boolean' }),
      inp({ name: 'okn', type: 'number' }),
      inp({ name: 'okc', type: 'choice', options: ['x'] }),
      inp({ name: 'freec', type: 'choice' })
    ], { b: 'yes', n: 'abc', ch: 'z', okb: 'true', okn: '3.5', okc: 'x', freec: 'anything' });
    expect(r.errors).toEqual({ req: 'Required', b: 'Must be true or false', n: 'Must be a number', ch: 'Pick one of the options' });
    expect(r.inputs).toEqual({ reqBool: 'false', okb: 'true', okn: '3.5', okc: 'x', freec: 'anything' });
  });
});

describe('run state', () => {
  it('names unfinished runs', () => {
    expect(runState({ status: 'queued', conclusion: null })).toEqual({ label: 'Queued', tone: 'working' });
    expect(runState({ status: 'waiting', conclusion: null })).toEqual({ label: 'Waiting for approval', tone: 'attention' });
    expect(runState({ status: 'in_progress', conclusion: null })).toEqual({ label: 'Running', tone: 'working' });
  });
  it('names finished runs', () => {
    const c = (conclusion: string | null) => runState({ status: 'completed', conclusion });
    expect(c('success')).toEqual({ label: 'Succeeded', tone: 'ready' });
    expect(c('failure')).toEqual({ label: 'Failed', tone: 'error' });
    expect(c('startup_failure')).toEqual({ label: 'Failed', tone: 'error' });
    expect(c('timed_out')).toEqual({ label: 'Timed out', tone: 'error' });
    expect(c('cancelled')).toEqual({ label: 'Cancelled', tone: 'idle' });
    expect(c('skipped')).toEqual({ label: 'skipped', tone: 'idle' });
    expect(c(null)).toEqual({ label: 'Done', tone: 'idle' });
  });
});
