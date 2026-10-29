# helm web companion

helm in a browser window of its own on a desktop, served by your hosted helm at `/companion/`. It is the same app as `mobile-app/` with the layout chosen by the window's size instead of forced to the phone layout, so it is the desktop UI that collapses to the phone UI when narrow.

Install it from the browser (Chrome/Edge: the install icon in the address bar; Safari: File → Add to Dock), allow notifications when asked, and it notifies you with the window closed, through Web Push from the server. Needs HTTPS.

Only `main.ts` (`push: true`, no forced layout), `index.html`, `manifest.webmanifest` and `vite.config.ts` live here. The rest is shared from `hosted/`; see `mobile-app/README.md` for the list. To add another build, copy this folder, change the options and name, and add it to `hosted`'s `build` script.
