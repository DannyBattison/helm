## 2026-10-28 · Artifact uploads are tracked globally and guarded when hosted

Upload progress used to live in the Artifacts tab's own state, so leaving the tab hid a still-running upload and a second attempt collided with it ("out of step"). Progress now lives in the UI store (`uploads`), the tab reads it, and a file already uploading to the same repository is not started again. In hosted helm a `beforeunload` guard asks the browser to confirm leaving while uploads run (browsers allow no custom text there); if the user stays, a dialog lists each upload with its progress.
