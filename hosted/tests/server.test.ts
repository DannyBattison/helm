import { describe, expect, it } from 'vitest';
import { originAllowed } from '../src/auth';
import { dispatch } from '../src/dispatch';

describe('origin', () => {
  it('lets the page we serve in, and nobody else (a request with no Origin is not a browser and has no cookie to ride on)', () => {
    expect(originAllowed('https://helm.example.com', 'helm.example.com')).toBe(true);
    expect(originAllowed(undefined, 'helm.example.com')).toBe(false);
    expect(originAllowed('https://evil.example', 'helm.example.com')).toBe(false);
    expect(originAllowed('https://helm.example.com.evil.example', 'helm.example.com')).toBe(false);
    expect(originAllowed('null', 'helm.example.com')).toBe(false);
    expect(originAllowed('https://other.example', 'helm.example.com', ['https://other.example'])).toBe(true);
  });
});

describe('dispatch', () => {
  const api = { getState: async () => 'state', add: async (a: number, b: number) => a + b, chooseFolder: async () => '/x', notAFunction: 3 };
  it('runs an API function with its arguments', async () => {
    expect(await dispatch(api, 'add', [1, 2])).toBe(3);
  });
  it('refuses names that are not API functions', async () => {
    for (const n of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'notAFunction', 'nope', 5, undefined]) await expect(dispatch(api, n, [])).rejects.toThrow(/Unknown call/);
  });
  it('refuses calls that belong to the browser', async () => {
    await expect(dispatch(api, 'chooseFolder', [])).rejects.toThrow(/browser/);
  });
  it('refuses arguments that are not a list', async () => {
    await expect(dispatch(api, 'add', { length: 1 })).rejects.toThrow(/list/);
  });
});
