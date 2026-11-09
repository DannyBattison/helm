/** What GitHub accepts as a repository name, short of the names it reserves. */
export function validRepoName(name: string): string | null {
  if (!name) return 'Give the repository a name.';
  if (name.length > 100) return 'A repository name is at most 100 characters.';
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return 'Use only letters, numbers, dots, dashes and underscores.';
  if (name === '.' || name === '..' || name.toLowerCase().endsWith('.git')) return 'GitHub does not allow that name.';
  return null;
}
