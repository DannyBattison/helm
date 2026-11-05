## 2026-11-05 · Desktop release retry step runs under bash

The electron-builder retry loop in `desktop.yml` is a bash script, but the Windows runner defaults to PowerShell, which failed to parse `for attempt in 1 2 3; do` and broke the 0.14.0 release. The step now sets `shell: bash` so it behaves the same on every OS.
