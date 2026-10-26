## D-143 · 2026-10-26 · Sidebar rows set their own 1.5 line height
The tree rows that make up the sidebar (`TreeItem`) now put 1.5 in the label and count fonts themselves instead of relying on the global ellipsis rule from D-142, since a row's label is clipped by its `overflow: hidden`. Not looked at in the app.
Why: user request.
