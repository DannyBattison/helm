/** Plain DOM for the screens that come before helm's own UI: the list of instances and adding one. */
export const STYLE = `
.h{position:fixed;inset:0;overflow:auto;background:#0e0e12;color:#e8e8ee;font:15px/1.5 system-ui,sans-serif;padding:max(20px,env(safe-area-inset-top)) 20px max(20px,env(safe-area-inset-bottom))}
.h main{max-width:420px;margin:0 auto;display:flex;flex-direction:column;gap:12px}
.h h1{font-size:22px;margin:8px 0 0}.h p{margin:0;color:#a0a0b0}.h .err{color:#f87171}
.h button,.h input,.h textarea{font:inherit;border-radius:12px;border:1px solid #2a2a36;padding:13px 14px;background:#1a1a22;color:inherit;text-align:left}
.h button.primary{background:#a78bfa;color:#14101f;border:0;font-weight:600;text-align:center}.h button:disabled{opacity:.5}
.h textarea{min-height:90px;font:12px/1.4 ui-monospace,monospace;word-break:break-all}
.h .row{display:flex;gap:8px;align-items:center}.h .row>:first-child{flex:1}.h .row button{padding:13px}
.h .code{font:700 28px ui-monospace,monospace;letter-spacing:.1em;text-align:center;user-select:all}
.h video{width:100%;border-radius:12px;background:#000;aspect-ratio:1;object-fit:cover}
.chip{position:fixed;right:0;top:50%;z-index:2147483647;width:26px;height:56px;border-radius:14px 0 0 14px;border:0;background:#a78bfa;color:#14101f;opacity:.35;font:600 16px system-ui;padding:0}
`;

export type Node = HTMLElement | string;

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', cls = '', on?: () => void): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.textContent = text;
  if (cls) e.className = cls;
  if (on) e.onclick = on;
  return e;
}

/** A full-screen page with `nodes` in it, replacing whatever was shown. */
export function show(...nodes: Node[]) {
  document.getElementById('helm-screen')?.remove();
  if (!document.getElementById('helm-style')) { const s = el('style'); s.id = 'helm-style'; s.textContent = STYLE; document.head.append(s); }
  const page = el('div', '', 'h');
  page.id = 'helm-screen';
  const main = document.createElement('main');
  main.append(...nodes.map((n) => (typeof n === 'string' ? el('p', n) : n)));
  page.append(main);
  document.body.append(page);
  return page;
}

export const hide = () => document.getElementById('helm-screen')?.remove();
