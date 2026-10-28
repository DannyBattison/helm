## 2026-10-28 · Disable the Codecov bot's pull request comments
Added `codecov.yml` with `comment: false`. Coverage is still uploaded from ci.yml, so the README badge keeps working; only the PR comment is gone.
Why: user request.
