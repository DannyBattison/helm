/** Plain DOM for the screens that come before helm's own UI: the list of instances and adding one. */
export const STYLE = `
.h{position:fixed;inset:0 0 var(--tabs,0px) 0;overflow:auto;background:#0e0e12;color:#e8e8ee;font:15px/1.5 system-ui,sans-serif;padding:max(20px,env(safe-area-inset-top)) 20px max(20px,env(safe-area-inset-bottom))}
.h main{max-width:420px;margin:0 auto;display:flex;flex-direction:column;gap:12px}
.h h1{font-size:22px;margin:8px 0 0}.h p{margin:0;color:#a0a0b0}.h .err{color:#f87171}
.h button,.h input,.h textarea{font:inherit;border-radius:12px;border:1px solid #2a2a36;padding:13px 14px;background:#1a1a22;color:inherit;text-align:left}
.h button.primary{background:#a78bfa;color:#14101f;border:0;font-weight:600;text-align:center}.h button:disabled{opacity:.5}
.h textarea{min-height:90px;font:12px/1.4 ui-monospace,monospace;word-break:break-all}
.h .row{display:flex;gap:8px;align-items:center}.h .row>:first-child{flex:1}.h .row button{padding:13px}
.h .code{font:700 28px ui-monospace,monospace;letter-spacing:.1em;text-align:center;user-select:all}
.h video{width:100%;border-radius:12px;background:#000;aspect-ratio:1;object-fit:cover}
.h .sec{margin:6px 0 -4px;font:600 12px system-ui;letter-spacing:.06em;text-transform:uppercase;color:#a0a0b0}
.h .item{display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:12px;background:#1a1a22;border:1px solid #2a2a36}.h .item>div{flex:1;min-width:0}.h .item small{display:block;color:#a0a0b0;font-size:12px}
.h button.danger{color:#f87171}
body #root{height:calc(100dvh - var(--tabs,0px))}
#helm-tabs{box-sizing:border-box;position:fixed;left:0;right:0;bottom:0;height:var(--tabs);padding-bottom:env(safe-area-inset-bottom);display:flex;background:#14141a;border-top:1px solid #2a2a36;z-index:2147483000;font:11px system-ui}
#helm-tabs button{flex:1;border:0;background:none;color:#8a8a9a;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;padding:0}
#helm-tabs button.on{color:#a78bfa}#helm-tabs svg{width:24px;height:24px}
`;

export type Node = HTMLElement | string;

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', cls = '', on?: () => void): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.textContent = text;
  if (cls) e.className = cls;
  if (on) e.onclick = on;
  return e;
}

function ensureStyle() {
  if (document.getElementById('helm-style')) return;
  const s = el('style');
  s.id = 'helm-style';
  s.textContent = STYLE;
  document.head.append(s);
}

/** A full-screen page with `nodes` in it, replacing whatever was shown. */
export function show(...nodes: Node[]) {
  document.getElementById('helm-screen')?.remove();
  ensureStyle();
  const page = el('div', '', 'h');
  page.id = 'helm-screen';
  const main = document.createElement('main');
  main.append(...nodes.map((n) => (typeof n === 'string' ? el('p', n) : n)));
  page.append(main);
  document.body.append(page);
  return page;
}

export const hide = () => document.getElementById('helm-screen')?.remove();

// ---------------------------------------------------------------------------------------------- the tab bar
export type TabName = 'servers' | 'settings';
const ICONS: Record<TabName, string> = {
  servers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>'
};
const LABELS: Record<TabName, string> = { servers: 'Servers', settings: 'Settings' };

/** Shows the bar with `active` lit, and leaves room for it: pages sit above it, and helm's own UI is made shorter. */
export function showTabs(active: TabName, on: (t: TabName) => void) {
  ensureStyle();
  document.documentElement.style.setProperty('--tabs', 'calc(56px + env(safe-area-inset-bottom))');
  let bar = document.getElementById('helm-tabs');
  if (!bar) { bar = el('nav'); bar.id = 'helm-tabs'; document.body.append(bar); }
  bar.replaceChildren(...(['servers', 'settings'] as TabName[]).map((t) => {
    const b = el('button', '', t === active ? 'on' : '', () => on(t));
    b.innerHTML = ICONS[t] + `<span>${LABELS[t]}</span>`;
    b.setAttribute('aria-label', LABELS[t]);
    return b;
  }));
}

export function hideTabs() {
  document.getElementById('helm-tabs')?.remove();
  document.documentElement.style.removeProperty('--tabs');
}
