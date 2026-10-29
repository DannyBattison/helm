import { describe, expect, it } from 'vitest';
import { b64, decodeShareCode, encodeShareCode, parseEndpoint } from '../src/shared/p2p/sharecode';

const key = b64.encode(new Uint8Array(32).fill(7));
const base = { v: 1 as const, n: 'Desk', p: 4000, c: ['203.0.113.5', '192.168.1.20:4001', '[2001:db8::1]', '[2001:db8::2]:5000', 'home.example.com'], k: key };

describe('share code', () => {
  it('round-trips, with a prefix and text that pastes', () => {
    const text = encodeShareCode({ ...base, s: b64.encode(new Uint8Array(16).fill(1)) });
    expect(text).toMatch(/^HELM1-[A-Za-z0-9_-]+$/);
    const d = decodeShareCode(text);
    expect(d.endpoints).toEqual([{ host: '203.0.113.5', port: 4000 }, { host: '192.168.1.20', port: 4001 }, { host: '2001:db8::1', port: 4000 }, { host: '2001:db8::2', port: 5000 }, { host: 'home.example.com', port: 4000 }]);
    expect(d.hostKey).toEqual(new Uint8Array(32).fill(7));
    expect(d.secret).toEqual(new Uint8Array(16).fill(1));
    expect(decodeShareCode(encodeShareCode(base)).secret).toBeUndefined();
  });

  it('says what is wrong in words, and skips an address it cannot read', () => {
    expect(() => decodeShareCode('nope')).toThrow(/not a helm share code/);
    expect(() => decodeShareCode('HELM1-!!!')).toThrow(/damaged/);
    expect(() => decodeShareCode(encodeShareCode({ ...base, v: 2 as any }))).toThrow(/different version/);
    expect(() => decodeShareCode(encodeShareCode({ ...base, k: b64.encode(new Uint8Array(5)) }))).toThrow(/damaged/);
    expect(() => decodeShareCode(encodeShareCode({ ...base, c: ['bad address with spaces', '1.2.3.4:99999'] }))).toThrow(/no address/);
    expect(decodeShareCode(encodeShareCode({ ...base, c: ['???', '198.51.100.1'] })).endpoints).toEqual([{ host: '198.51.100.1', port: 4000 }]);
  });

  it('reads the direct forms', () => {
    expect(parseEndpoint('host', 9)).toEqual({ host: 'host', port: 9 });
    expect(parseEndpoint('host:10', 9)).toEqual({ host: 'host', port: 10 });
    expect(parseEndpoint('::1', 9)).toBeNull();
    expect(parseEndpoint('h:0', 9)).toBeNull();
    expect(parseEndpoint('', 9)).toBeNull();
  });
});
