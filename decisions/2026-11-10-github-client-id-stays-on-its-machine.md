## 2026-11-10 · The GitHub app ID is not synced

`githubClientId` was not in `LOCAL_SETTINGS`, so settings sync copied one instance's GitHub app (client ID) over the other's. A desktop and a hosted server on different apps then swapped IDs on every sync, and sign-ins made with the other app's ID were renewed or checked against the wrong one, showing up as having to sign in with GitHub again each time you switched. It now stays per machine, like the sign-in itself.
