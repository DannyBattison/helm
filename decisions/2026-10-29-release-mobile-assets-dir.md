## 2026-10-29 · Download mobile artifacts outside the checked-out mobile/ source

The publish job downloaded the phone app builds into `mobile/`, which is also the source directory in the checkout, so `mobile/*` matched `mobile/android` (a directory) and every other source file and the upload failed. They now go to `mobile-assets/`, and only that directory is uploaded.
