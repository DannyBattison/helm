import type { DiffHunk } from './types';

/** A short stable id for a hunk, from the file and the changed text but not the line numbers, so it survives other hunks shifting it. */
export function hunkId(path: string, h: DiffHunk): string {
  let x = 0x811c9dc5;
  const feed = (s: string) => { for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; } };
  feed(path);
  for (const [sign, , , text] of h.lines) if (sign !== ' ') { feed(sign); feed(text); feed('\n'); }
  return x.toString(36) + h.lines.filter((l) => l[0] !== ' ').length.toString(36);
}

/** A patch that applies this one hunk to `a/<path>`, to be applied in reverse to throw the hunk away. */
export function hunkPatch(path: string, h: DiffHunk): string {
  const isNew = /^@@ -0,0 /.test(h.header);
  const isGone = / \+0,0 @@/.test(h.header);
  const head = [`diff --git a/${path} b/${path}`];
  if (isNew) head.push('new file mode 100644');
  if (isGone) head.push('deleted file mode 100644');
  head.push(`--- ${isNew ? '/dev/null' : 'a/' + path}`, `+++ ${isGone ? '/dev/null' : 'b/' + path}`, h.header.replace(/ new file$/, ''));
  return head.concat(h.lines.map(([sign, , , text]) => sign + text)).join('\n') + '\n';
}
