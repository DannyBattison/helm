## D-90 · 2026-10-23 · Diagnostics bundle, and a log
Errors and warnings from the main process, uncaught exceptions, crashed processes and errors in the window are written to `helm.log` in the user data folder (rolled at 1 MB) and kept in memory. Settings → About and support saves a Markdown support bundle: versions, a summary of settings, repositories, each session's state and the recent log. It leaves out task text, conversations, file contents and repository paths, masks tokens and keys, and replaces the home folder with ~.
Why: user request.
