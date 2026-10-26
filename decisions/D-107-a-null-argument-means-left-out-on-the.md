## D-107 · 2026-10-25 · A null argument means "left out" on the hosted server
JSON cannot carry `undefined`, so an omitted argument (such as the images of a message) reached the core as `null` and skipped its default, breaking sending a message. `hosted-server/src/dispatch.ts` now turns `null` arguments into `undefined`. No API call uses `null` as a real value.
Why: bug found by the user in the hosted version.
