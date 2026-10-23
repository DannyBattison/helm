/** Code fonts. The bundled ones ship with helm and work everywhere; the system ones only if installed. */
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import '@fontsource/jetbrains-mono/latin-700.css';
import '@fontsource/fira-code/latin-400.css';
import '@fontsource/fira-code/latin-500.css';
import '@fontsource/fira-code/latin-700.css';
import '@fontsource/cascadia-code/latin-400.css';
import '@fontsource/cascadia-code/latin-500.css';
import '@fontsource/cascadia-code/latin-700.css';
import '@fontsource/source-code-pro/latin-400.css';
import '@fontsource/source-code-pro/latin-500.css';
import '@fontsource/source-code-pro/latin-700.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/ibm-plex-mono/latin-700.css';
import '@fontsource/inconsolata/latin-400.css';
import '@fontsource/inconsolata/latin-500.css';
import '@fontsource/inconsolata/latin-700.css';
import '@fontsource/roboto-mono/latin-400.css';
import '@fontsource/roboto-mono/latin-500.css';
import '@fontsource/roboto-mono/latin-700.css';

import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/source-sans-3/latin-400.css';
import '@fontsource/source-sans-3/latin-500.css';
import '@fontsource/source-sans-3/latin-600.css';
import '@fontsource/roboto/latin-400.css';
import '@fontsource/roboto/latin-500.css';
import '@fontsource/roboto/latin-600.css';
import '@fontsource/open-sans/latin-400.css';
import '@fontsource/open-sans/latin-500.css';
import '@fontsource/open-sans/latin-600.css';

export const BUNDLED_FONTS = ['Monaspace Neon', 'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Source Code Pro', 'IBM Plex Mono', 'Inconsolata', 'Roboto Mono'];
const SYSTEM_FONTS = ['Consolas', 'Cascadia Mono', 'Menlo', 'SF Mono', 'Monaco', 'Ubuntu Mono', 'DejaVu Sans Mono', 'Liberation Mono', 'Courier New'];

export const fontStack = (name: string) => `"${name}", "Monaspace Neon", ui-monospace, monospace`;

/** A font is installed if text set in it measures differently from the fallbacks it would otherwise fall back to. */
function installed(name: string): boolean {
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return false;
  const sample = 'mmmmmmmmmmlliWWW@@##';
  return ['monospace', 'serif', 'sans-serif'].some((base) => {
    ctx.font = `32px ${base}`;
    const w = ctx.measureText(sample).width;
    ctx.font = `32px "${name}", ${base}`;
    return ctx.measureText(sample).width !== w;
  });
}

let cached: string[] | null = null;
export function systemFonts(): string[] {
  return (cached ||= SYSTEM_FONTS.filter(installed));
}

export const SYSTEM_DEFAULT = 'System default';
export const UI_BUNDLED_FONTS = ['Mona Sans', 'Inter', 'IBM Plex Sans', 'Source Sans 3', 'Roboto', 'Open Sans'];
const UI_SYSTEM_FONTS = ['Segoe UI', 'Calibri', 'SF Pro Text', 'Helvetica Neue', 'Arial', 'Ubuntu', 'Cantarell'];

export const uiStack = (name: string) => (name === SYSTEM_DEFAULT ? 'system-ui, -apple-system, "Segoe UI", sans-serif' : `"${name}", "Mona Sans", system-ui, sans-serif`);
/** The data font is the monospaced font used for paths, hashes, branches and numbers. */
export const dataStack = (name: string) => `"${name}", "Monaspace Neon", ui-monospace, monospace`;

let cachedUi: string[] | null = null;
export function systemUiFonts(): string[] {
  return (cachedUi ||= UI_SYSTEM_FONTS.filter(installed));
}
