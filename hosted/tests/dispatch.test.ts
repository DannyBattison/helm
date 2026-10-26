import { describe, expect, it } from 'vitest';
import { dispatch } from '../src/dispatch';

describe('dispatching a call', () => {
  it('treats a null argument as left out, since JSON cannot carry undefined', async () => {
    const api = { send: (id: string, text: string, images: string[] = []) => `${id}:${text}:${images.length}` };
    expect(await dispatch(api, 'send', ['a', 'hi', null])).toBe('a:hi:0');
  });
});
