## D-12 · 2026-10-23 · Session status rules
A finished turn with changes or commits becomes `ready`; with none it becomes `idle` ("Done"). Interrupt and Pause are the same action and leave the session `idle` so a reply resumes it. On app start any session that was working or waiting is set to `idle` and resumed from its saved Claude session id when the user replies.
Why: sessions can't keep running when helm is closed, and the status should never claim otherwise.
