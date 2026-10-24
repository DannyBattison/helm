import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/index.css';
import './fonts';

// Anything the window throws ends up in helm's log, which the diagnostics bundle includes.
const report = (m: string) => { try { void window.helmBridge.invoke('logRenderer', m); } catch { /* the bridge is gone */ } };
window.addEventListener('error', (e) => report(`${e.message} at ${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => report('unhandled rejection: ' + String((e.reason && (e.reason.stack || e.reason.message)) || e.reason)));

createRoot(document.getElementById('root')!).render(<App />);
