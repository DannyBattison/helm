## 2026-10-27 · tsc on the PATH in the hosted image

The hosted Docker image symlinks `tsc` from the TypeScript already installed in `/app/node_modules` (the version helm is built with) into `/usr/local/bin`, so agents and the terminal tab can typecheck. No extra install, no version drift.
