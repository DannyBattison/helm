## D-111 · 2026-10-25 · Below 900px wide the sidebar is a drawer
The app no longer has a fixed minimum width of 1180px (now 320px). In a window narrower than 900px (`useNarrow`) the sidebar leaves the layout and opens as a drawer over the content from a menu button in the title bar; the search box becomes an icon, and the drawer closes on navigation, on Escape and on a tap outside it. Wider windows are unchanged.
Why: user request, to make the UI responsive.
