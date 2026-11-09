/**
 * Search text for each settings page, read from the setting rows in the source:
 * the title and description of every row, so a search finds the page a setting is on.
 */

/** Components that hold the rows of a page of their own. Anything else belongs to the page it sits in. */
const PAGE_OF: Record<string, string> = {
  TransferSection: 'transfer', SyncSection: 'sync', CompanionSection: 'companion', PhoneSection: 'phone',
  ShortcutButton: 'shortcuts', ShortcutsSection: 'shortcuts',
  LabeledField: 'custom-shortcuts', PresetEditor: 'custom-shortcuts', GotoEditor: 'custom-shortcuts', CustomShortcutsSection: 'custom-shortcuts',
  EmailSection: 'notifications', TerminalShellRow: 'appearance', ColourRows: 'appearance', FontRow: 'appearance',
};

const STRING = /\b(?:title|desc|sub|label|placeholder)=(?:"([^"]*)"|\{'([^']*)'\}|\{`([^`$]*)`\})/g;

const strings = (src: string) => [...src.matchAll(STRING)].map((m) => m[1] ?? m[2] ?? m[3]).filter(Boolean).join(' ');

/** Splits a source file into its top level declarations, each with the text up to the next. */
function chunks(src: string): { name: string; text: string }[] {
  const at = [...src.matchAll(/^(?:export )?(?:function|const) (\w+)/gm)];
  return at.map((m, i) => ({ name: m[1], text: src.slice(m.index!, i + 1 < at.length ? at[i + 1].index : src.length) }));
}

/** Page key to the words of its settings. `main` is Settings.tsx, `repo` is RepoSettings.tsx. */
export function settingsIndex(main: string, repo: string): Record<string, string> {
  const out: Record<string, string> = {};
  const add = (k: string, text: string) => { out[k] = ((out[k] || '') + ' ' + strings(text)).trim(); };
  for (const c of chunks(main)) {
    if (c.name === 'Settings') {
      // The page bodies are `sec === 'key' ? ...` blocks, each running to the next.
      const marks = [...c.text.matchAll(/sec === '([\w-]+)' \?/g)];
      marks.forEach((m, i) => add(m[1], c.text.slice(m.index, i + 1 < marks.length ? marks[i + 1].index : c.text.length)));
    } else if (PAGE_OF[c.name]) add(PAGE_OF[c.name], c.text);
  }
  // The same text covers Repositories and every repository's own page.
  out.defaults = (out.defaults || '') + ' ' + strings(repo);
  out.repo = strings(repo);
  return out;
}
