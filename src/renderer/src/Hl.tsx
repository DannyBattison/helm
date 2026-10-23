import React from 'react';
import { highlightLine } from './highlight';

/** One line of code, highlighted when its language is known and plain otherwise. */
export function Hl({ text, lang, pad = '' }: { text: string; lang: string | null | undefined; pad?: string }) {
  const html = highlightLine(text, lang);
  return html ? <span dangerouslySetInnerHTML={{ __html: pad + html }} /> : <span>{pad + text}</span>;
}
