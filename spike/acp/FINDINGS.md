# ACP spike

Throwaway scripts that drive an Agent Client Protocol adapter over stdio with a hand-rolled JSON-RPC client (`acp.mjs`, ~60 lines, no SDK), to learn what an `AcpBackend` could and could not map onto `AgentBackend`.

Run (in a scratch folder, `npm i @agentclientprotocol/claude-agent-acp @agentclientprotocol/codex-acp`):

    node run.mjs  node node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js   # edit, shell, subagent, cancel
    node run2.mjs node node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js   # list, load, fork, modes, reject
    node codex-init.mjs node node_modules/@agentclientprotocol/codex-acp/dist/index.js    # capabilities only

Tested for real against `claude-agent-acp` 0.97.0 (signed in). `codex-acp` 2.3.0 was only started: `initialize` works, `session/new` answers "Authentication required" (no OpenAI credentials here), so its behaviour below comes from its advertised capabilities and its source (`dist/index.js`), not from a run.

## Answers to the open questions

| Need | ACP result |
|---|---|
| Streamed text, tool calls, results | Stable. `agent_message_chunk`, `tool_call`, `tool_call_update` (`kind`, `status`, `title`, `rawInput`, `rawOutput`, `content`). Works. |
| Edits as diffs | Stable. `content: [{type:'diff', path, oldText, newText}]` (oldText null for a new file). Gives helm's diff cards without parsing tool input. |
| Shell commands | `kind: 'execute'`. The command text is **not** on the first `tool_call` (`rawInput: {}`); it arrives in later `tool_call_update`s. A translator must accumulate per `toolCallId`. |
| Approvals | Stable and good. `session/request_permission` carries the tool call (with `rawInput`) and options `allow_once`/`allow_always`/`reject_once`. Rejecting makes the tool fail with "User refused permission" and the turn continues. Maps straight onto `canUseTool`. |
| Interrupt | `session/cancel` notification; the prompt resolves with `stopReason: 'cancelled'`. |
| Cost and context | `usage_update` (stable): `used`/`size` of the context window, and `cost: {amount, currency}` as a **running session total** on Claude (matches how `result.costUsd` works today). Per-turn tokens (`input`, `output`, `cachedRead`, `cachedWrite`) are on the prompt response (`usage`), marked unstable. Codex: schema supports it; codex-acp builds `usage_update` from token usage, but no dollar figure was seen (ChatGPT plans are not per-token). Budgets would need our own price table for it. |
| Plan windows (5h / weekly) | **Not in ACP.** No rate-limit notification in the stable or unstable schema. codex-acp reads rate limits internally and prints them as text (status output), not structured. Claude's adapter sends none either. Keeps `capabilities.planUsage = false` for ACP backends. |
| Subagents | **Not standard.** Claude's adapter shows `Agent` as a `kind: 'think'` tool call and nests the child's tool calls with `_meta.claudeCode.parentToolUseId` (vendor extension, but gives us a tree). The unstable schema has `SubagentUpdate`/`subagents` capability; codex-acp 2.3.0 advertises `subagents` and emits `subagent_spawned`/`subagent_state_update` (unstable, and it keeps its own `_subagent_update` form). The per-session subagent limit hook has no ACP equivalent: there is no pre-start gate, only the permission request. |
| Resume / history | `session/load` replays the conversation as `user_message_chunk`, `agent_message_chunk`, `tool_call`, `tool_call_update` (diffs included), so a transcript can be rebuilt. `session/resume`, `session/list` (id, cwd, title, updatedAt) and `session/close`/`delete` also work. |
| Fork | `session/fork` works on claude-agent-acp (returns a new session id) and is advertised by codex-acp, but it is **unstable** and takes no "up to message" argument, so fork-from-message needs a different route. |
| Title | `session_info_update` carries the agent's own title. Maps to `refreshTitle`. |
| Permission modes | `modes`/`config_option` `mode`: Claude gives default, acceptEdits, plan, auto, bypassPermissions. `session/set_mode` and `session/set_config_option` work. Mode ids are agent-specific, so helm's four modes need a per-backend map. |
| Models | **Not standardised.** claude-agent-acp returned no `models` and has no `session/set_model` (Method not found); its only config option was `mode`. Model choice has to come from the agent's own config or an env var. |
| Effort | No standard field. |
| Sign-in | `authMethods` in `initialize` (codex: `chat-gpt`, `api-key`; claude: none, uses its own login). `session/new` fails with "Authentication required" until `authenticate` is called. Maps onto `BackendAuth`, but the interactive flows are agent-specific. |
| Images | `promptCapabilities.image` is true for both; prompt content blocks take `image`. |

## What an `AcpBackend` would be

About 300 lines: spawn the adapter, JSON-RPC over stdio, translate `session/update` to `AgentEvent`, answer `request_permission` through `canUseTool`, `session/cancel` for interrupt, `session/load` for the conversation store. The tool-name mapping stays: ACP gives `kind` (read/edit/execute/search/…) and `title`, not Claude's tool names, so the translator derives `Bash` from `kind: 'execute'` plus `rawInput.command`, `Edit`/`Write` from `diff` content, and so on.

Gaps to accept or fill per backend: plan usage, a start-gate for subagents, fork-from-message, model and effort choice, dollar cost on subscription plans.
