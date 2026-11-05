import type { Settings } from './types';

export type Experience = 'simple' | 'standard' | 'advanced';
export const experienceOf = (value: unknown): Experience => value === 'simple' || value === 'standard' ? value : 'advanced';
/** Layout preferences never change operational settings or permissions. */
export function experiencePolicy(settings: Pick<Settings, 'experience'>) {
  const level = experienceOf(settings.experience);
  return { level, simple: level === 'simple', advanced: level === 'advanced', activity: level !== 'simple', reports: level === 'advanced', board: level === 'advanced', detailedUsage: level === 'advanced' };
}
