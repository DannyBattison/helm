import { experiencePolicy } from '@shared/experience';
import { useApp } from './store';
export const useExperience = () => experiencePolicy(useApp().settings);
