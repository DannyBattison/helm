import React from 'react';
import { highlightCommand, highlightLine } from './highlight';

/** A shell command, possibly several lines and with a heredoc, highlighted piece by piece. */
export function Cmd({ text }: { text: string }) {
  const html = highlightCommand(text);
  return html ? <span dangerouslySetInnerHTML={{ __html: html }} /> : <>{text}</>;
}

/** One line of code, highlighted when its language is known and plain otherwise. */
export function Hl({ text, lang, pad = '' }: { text: string; lang: string | null | undefined; pad?: string }) {
  const html = highlightLine(text, lang);
  return html ? <span dangerouslySetInnerHTML={{ __html: pad + html }} /> : <span>{pad + text}</span>;
}
