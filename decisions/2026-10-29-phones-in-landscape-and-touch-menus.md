## 2026-10-29 · Phones on their side get the phone layout; long press stands in for right-click

A phone turned sideways is wider than 768px but only about 400px tall, so it got the desktop layout (a fixed sidebar and almost no room for content). The phone layout (drawer, one column) now applies to a short touch screen too: `(pointer: coarse) and (max-height: 500px)` joins `max-width: 767px`, in both the CSS and `useNarrow`.

Right-click menus (the sidebar's repositories, sessions and outside sessions, and a panel agent's messages) open on a long press through `menuProps` in `ui/longPress.ts`. iOS never sends `contextmenu`, and the touch that ends a long press must not also click, so the click is swallowed and the menu ignores clicks in its first 400ms.

Tree rows with children have their own caret target (`onToggle`): tapping the row opens the page, tapping the caret folds it. Before, a repository only folded when you tapped it while already on its page.

Other changes found by going through each view at 390x844 and 844x390: the session header wraps under its title and the composer's pickers no longer run off the edge; play/pause-all move into the drawer on narrow portrait so the title has room; the tutorial bubble docks at the bottom on phones instead of covering the drawer; Settings uses a dropdown for its twenty-odd sections; a tab strip scrolls the chosen tab into view.

Why: the hosted version is meant to be usable from a phone, and none of this worked there.
