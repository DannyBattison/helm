## 2026-10-26 · Tutorial mode: one bubble at a time, on by default, resettable in Appearance

Settings gains `tutorial` (default on) and `tutorialSeen` (ids dismissed). The `Hint` component wraps an element and shows a bubble pointing at it only when it is the first undismissed entry of `TUTORIAL_HINTS` (`src/shared/tutorial.ts`: add repository, search, new session, inbox), so only one shows at a time. "Got it" dismisses that bubble; "Turn off tips" switches tutorial mode off. Appearance has a Tutorial mode switch and "Show tips again", which turns it on and clears the dismissed list. Existing users see the tips once too, since the default is on.

Why: user request.
