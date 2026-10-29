import jsQR from 'jsqr';
import { PREFIX } from '../../src/shared/p2p/sharecode';

/** The share code in one camera frame, or null. Anything else a QR code says is ignored. */
export function findShareCode(frame: { data: Uint8ClampedArray; width: number; height: number }): string | null {
  const r = jsQR(frame.data, frame.width, frame.height, { inversionAttempts: 'attemptBoth' });
  return r && r.data.startsWith(PREFIX) ? r.data.trim() : null;
}

/**
 * Looks through the camera, in the web view (`getUserMedia`, so it needs the camera permission in the app's manifest), until a helm share
 * code is in view. Resolves with it; rejects if `signal` is aborted. Stops the camera either way.
 */
export async function scanShareCode(video: HTMLVideoElement, signal?: AbortSignal): Promise<string> {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  video.srcObject = stream;
  video.setAttribute('playsinline', 'true');
  await video.play();
  try {
    return await new Promise<string>((resolve, reject) => {
      const tick = () => {
        if (signal?.aborted) return reject(new Error('Cancelled'));
        if (video.readyState >= 2 && video.videoWidth) {
          // A smaller copy is plenty to read a code and much cheaper.
          const scale = Math.min(1, 640 / video.videoWidth);
          canvas.width = Math.round(video.videoWidth * scale);
          canvas.height = Math.round(video.videoHeight * scale);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const code = findShareCode(ctx.getImageData(0, 0, canvas.width, canvas.height));
          if (code) return resolve(code);
        }
        setTimeout(tick, 120);
      };
      tick();
    });
  } finally {
    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  }
}
