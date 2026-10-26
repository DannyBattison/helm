## D-59 · 2026-10-23 · GitHub link on a commit checks the commit is pushed
The GitHub button in the commit panel first checks that the commit is reachable from a remote branch (`git branch -r --contains`). A commit that only exists on this computer has no page on GitHub, which showed as a 404; helm now says it is not on GitHub yet and to push the branch. History lists every local branch, so unpushed commits are common.
Why: user report of a 404.
