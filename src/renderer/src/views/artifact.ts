import type { Artifact } from '@shared/types';

/** Images the window can show itself, and so can preview in the lightbox. */
export const EMBEDDABLE = /^image\/(png|jpeg|gif|webp|svg\+xml|avif)$/;
export const fmtSize = (n: number) => (n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB');
export const isPreviewable = (art: Artifact) => art.data != null && EMBEDDABLE.test(art.mediaType);
export const dataUrl = (art: Artifact) => `data:${art.mediaType};base64,${art.data}`;

/** Saves the file through the browser's download. Does nothing for a file too large to have been sent. */
export function downloadArtifact(art: Artifact) {
  if (art.data == null) return;
  const bytes = Uint8Array.from(atob(art.data), (c) => c.charCodeAt(0));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type: art.mediaType }));
  a.download = art.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
