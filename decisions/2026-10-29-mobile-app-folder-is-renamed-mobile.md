## 2026-10-29 · The `mobile-app/` folder is renamed `mobile/`

The native phone app lives in `mobile/` at the repository root (it was `mobile-app/`). Everything that named the folder was updated: the root `package.json` scripts (`mobile:*`) and typecheck, `ci.yml` and `mobile.yml` (the paths to the Android and iOS projects and the built files), `desktop/scripts/make-icons.mjs`, the comments in the Java and Swift sources, `tests/icons.test.ts`, and the package name (`helm-mobile`). Earlier decision entries are append-only and still say `mobile-app/`; they mean this folder. The decision file names that contain `mobile-app` are unchanged for the same reason.

Anyone with the old folder checked out: `node_modules` moved with it, but delete `mobile/ios/App/Pods` and run `npm run ios` again (CocoaPods keeps absolute paths).

Why: user request.
