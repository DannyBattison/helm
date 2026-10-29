// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ results: [] as (string | null)[] }));
vi.mock('jsqr', () => ({ default: () => { const d = h.results.shift(); return d == null ? null : { data: d }; } }));

import { scanShareCode } from '../src/scan';

const stop = vi.fn();
let video: HTMLVideoElement;
let ctx: any;

beforeEach(() => {
  vi.useFakeTimers();
  h.results = [];
  stop.mockReset();
  const stream = { getTracks: () => [{ stop }, { stop }] };
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => stream) } });
  ctx = { drawImage: vi.fn(), getImageData: vi.fn((_x, _y, w, h2) => ({ data: new Uint8ClampedArray(4), width: w, height: h2 })) };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx);
  video = document.createElement('video');
  video.play = vi.fn(async () => undefined);
  Object.defineProperty(video, 'readyState', { configurable: true, value: 4 });
  Object.defineProperty(video, 'videoWidth', { configurable: true, value: 1280 });
  Object.defineProperty(video, 'videoHeight', { configurable: true, value: 720 });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('scanShareCode', () => {
  it('asks for the rear camera and resolves with a helm code found in a later frame', async () => {
    h.results = [null, 'https://example.com/', 'HELM1-abc\n'];
    const p = scanShareCode(video);
    await vi.advanceTimersByTimeAsync(0);
    expect((navigator.mediaDevices.getUserMedia as any).mock.calls[0][0]).toEqual({ video: { facingMode: 'environment' }, audio: false });
    expect(video.getAttribute('playsinline')).toBe('true');
    await vi.advanceTimersByTimeAsync(120 * 3);
    await expect(p).resolves.toBe('HELM1-abc');
    expect(ctx.drawImage).toHaveBeenCalledTimes(3);
    expect(stop).toHaveBeenCalledTimes(2);
    expect(video.srcObject).toBeNull();
  });
  it('scales the frame down to 640 wide', async () => {
    h.results = ['HELM1-x'];
    await scanShareCode(video);
    const [, , w, hh] = ctx.getImageData.mock.calls[0];
    expect([w, hh]).toEqual([640, 360]);
  });
  it('does not scale up a small frame', async () => {
    Object.defineProperty(video, 'videoWidth', { configurable: true, value: 320 });
    Object.defineProperty(video, 'videoHeight', { configurable: true, value: 240 });
    h.results = ['HELM1-x'];
    await scanShareCode(video);
    expect(ctx.getImageData.mock.calls[0].slice(2)).toEqual([320, 240]);
  });
  it('waits while the video has no picture yet', async () => {
    Object.defineProperty(video, 'readyState', { configurable: true, writable: true, value: 0 });
    h.results = ['HELM1-x'];
    const p = scanShareCode(video);
    await vi.advanceTimersByTimeAsync(500);
    expect(ctx.drawImage).not.toHaveBeenCalled();
    (video as any).readyState = 4;
    await vi.advanceTimersByTimeAsync(130);
    await expect(p).resolves.toBe('HELM1-x');
  });
  it('rejects when aborted, and still stops the camera', async () => {
    const ac = new AbortController();
    const p = scanShareCode(video, ac.signal);
    const assertion = expect(p).rejects.toThrow('Cancelled');
    await vi.advanceTimersByTimeAsync(0);
    ac.abort();
    await vi.advanceTimersByTimeAsync(130);
    await assertion;
    expect(stop).toHaveBeenCalledTimes(2);
    expect(video.srcObject).toBeNull();
  });
  it('rejects without opening a frame when already aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(scanShareCode(video, ac.signal)).rejects.toThrow('Cancelled');
    expect(stop).toHaveBeenCalledTimes(2);
  });
});
