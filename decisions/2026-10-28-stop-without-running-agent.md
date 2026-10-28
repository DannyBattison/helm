## 2026-10-28 · Stop is available whether or not an agent is running

The Stop button and the "Stop session" menu item were disabled unless the session was working or waiting on an approval, so a session whose agent had died or whose status was stale couldn't be stopped. Stop is now enabled for every non-archived session. Stopping a session with no running agent closes whatever is still open (advisors, pending asks) and only changes the status to idle if it was working or waiting; a session that was ready for review or errored keeps that status.
