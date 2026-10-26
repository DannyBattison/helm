## D-2 · 2026-10-23 · Port the prototype components rather than rewrite them
The `components/**` primitives and `ui_kits/helm/*.jsx` screens are copied into TypeScript files and rewired to real data. Visuals and copy stay as designed. TypeScript is non-strict (`strict: false`) so the inline-style prototype code compiles without large rewrites.
Why: the design is high fidelity and the primitives are already plain React with token-based inline styles.
