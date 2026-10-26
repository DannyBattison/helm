## D-154 · 2026-10-26 · BROWSING is in the default image
The default `INCLUDE` (and so `:latest`) is now `CORE|SEARCH|NETWORK|EDITING|BROWSING`, so agents can run headless tests of web apps with Playwright and Chromium without a custom build. This makes the default image much larger (Chromium and its libraries); `INCLUDE=CORE|SEARCH|NETWORK|EDITING` gives the old one. Supersedes the default named in D-136. Not built (no Docker here).
Why: user request.
