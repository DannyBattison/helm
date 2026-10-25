/** Masks the usual shapes of secret in text that is about to be stored in the audit log or an exported report. */
const RULES: [RegExp, string][] = [
  [/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '[token]'],
  [/\bsk-[A-Za-z0-9_-]{16,}\b/g, '[key]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[aws-key]'],
  [/\b(xox[abprs]-[A-Za-z0-9-]{10,})\b/g, '[token]'],
  [/(Authorization:\s*(?:Bearer|Basic|token)\s+)[^\s'"]+/gi, '$1[secret]'],
  [/(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}/g, '$1[secret]'],
  // NAME=value and NAME: value where the name says it is a secret.
  [/\b([A-Za-z0-9_.-]*(?:secret|token|passw(?:or)?d|api[_-]?key|private[_-]?key|credential)[A-Za-z0-9_.-]*)(\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s'"]+)/gi, '$1$2[secret]'],
  [/(-----BEGIN [A-Z ]*PRIVATE KEY-----)[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----)/g, '$1 [secret] $2'],
  [/(https?:\/\/[^\s:/@]+:)[^\s@/]+(@)/g, '$1[secret]$2']
];

export function redact(text: string): string {
  let out = text;
  for (const [re, to] of RULES) out = out.replace(re, to);
  return out;
}

/** Redacted, flattened to one line and cut to `max` characters. */
export function auditText(text: string, max = 300): string {
  const t = redact(text).replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}
