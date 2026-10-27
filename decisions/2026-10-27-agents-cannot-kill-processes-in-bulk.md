## 2026-10-27 · Agents cannot kill processes by name or in bulk
`canUse` refuses any command that runs `pkill`, `killall`, `skill`, `xkill`, `taskkill`, `kill` with `-1`/`0` or a `$(…)`/backtick pid list, or pipes into `xargs kill`, before the allow lists, and tells the agent to kill only its own process by pid. A literal `kill 4242` is still allowed.
Why: an agent cleaning up with `pkill node` took down every other agent helm was running, since they share the machine. Always-allow patterns cannot override this.
