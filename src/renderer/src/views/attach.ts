import type { MessageImage } from '@shared/types';
import { toast } from '../store';

export const MAX_IMAGES = 6;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
export type Draft = MessageImage & { id: number; url: string; bytes: number };
let imageSeq = 0;

export const readImage = (f: File): Promise<Draft> => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onerror = () => reject(new Error('Could not read ' + (f.name || 'the image')));
  r.onload = () => {
    const url = String(r.result);
    resolve({ id: ++imageSeq, mediaType: f.type as any, data: url.slice(url.indexOf(',') + 1), name: f.name && f.name !== 'image.png' ? f.name : `image-${imageSeq}.${f.type.split('/')[1]}`, url, bytes: f.size });
  };
  r.readAsDataURL(f);
});

/** Checks files against the image types and limits, tells the user what was left out, and reads the rest. `have` is how many are attached already. */
export async function readAttachments(list: File[], have: number): Promise<Draft[]> {
  const ok = list.filter((f) => IMAGE_TYPES.includes(f.type));
  if (list.length && !ok.length) { toast({ tone: 'neutral', title: 'Only PNG, JPEG, GIF and WebP images can be attached' }); return []; }
  const room = MAX_IMAGES - have;
  if (ok.length > room) toast({ tone: 'neutral', title: `At most ${MAX_IMAGES} images per message` });
  const big = ok.filter((f) => f.size > MAX_IMAGE_BYTES);
  if (big.length) toast({ tone: 'neutral', title: 'Image too large', description: `${big[0].name || 'It'} is over 5 MB.` });
  const take = ok.filter((f) => f.size <= MAX_IMAGE_BYTES).slice(0, Math.max(0, room));
  try { return await Promise.all(take.map(readImage)); } catch (e: any) { toast({ tone: 'error', title: 'Could not attach', description: String(e?.message || e) }); return []; }
}

/** The chips for attached images, with a remove button. */
export function AttachmentChips({ images, onRemove }: { images: Draft[]; onRemove(id: number): void }) {
  if (!images.length) return null;
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '8px 8px 0' }}>
      {images.map((im) => (
        <div key={im.id} title={im.name} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 6, height: 28, padding: '0 22px 0 4px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-raised)', boxShadow: 'inset 0 0 0 1px var(--border)' }}>
          <img src={im.url} alt="" style={{ width: 20, height: 20, objectFit: 'cover', borderRadius: 3 }} />
          <span style={{ font: '500 11.5px/1 var(--font-sans)', color: 'var(--text-1)', maxWidth: 150, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{im.name}</span>
          <span style={{ font: '400 11px/1 var(--font-mono)', color: 'var(--text-3)' }}>{im.bytes > 1e6 ? (im.bytes / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(im.bytes / 1e3)) + ' kB'}</span>
          <span role="button" aria-label="Remove image" onClick={() => onRemove(im.id)} style={{ position: 'absolute', right: 5, top: 0, bottom: 0, display: 'flex', alignItems: 'center', cursor: 'pointer', color: 'var(--text-3)' }}><i className="ph ph-x" style={{ fontSize: 11 }} /></span>
        </div>
      ))}
    </div>
  );
}
