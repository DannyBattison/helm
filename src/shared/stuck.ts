/** Edits to one file, or failures of one command, past which an agent is probably going round in circles. */
export const STUCK_EDITS = 10;
export const STUCK_FAILS = 3;

export function stuckReason(x: { file: string; edits: number } | { command: string; fails: number }): string | undefined {
  if ('file' in x) return x.edits >= STUCK_EDITS ? `${x.file} edited ${x.edits} times without a commit` : undefined;
  return x.fails >= STUCK_FAILS ? `“${x.command.length > 60 ? x.command.slice(0, 59) + '…' : x.command}” failed ${x.fails} times in a row` : undefined;
}
