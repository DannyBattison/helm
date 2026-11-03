# Cursor subscription feasibility

Assessed 2026-11-03. Verdict: feasible through the official Cursor agent CLI's ACP interface. This spike adds a handshake probe, not a registered helm backend. A paid, signed-in end-to-end run remains unverified: neither `agent` nor `cursor-agent` is installed in this environment.

## Subscription route

Use the user's locally installed Cursor CLI and its browser login (`agent login`). Keep credentials owned by that CLI. Cursor documents ACP explicitly for custom clients, so helm can supervise Cursor's agent through this interface. This does not make the subscription a general Anthropic/OpenAI API credential.

Billing depends on the actual plan and model. Current pricing documentation says CLI shares the subscription usage pool; third-party models can require separately paid usage, and legacy plans retain different pools. Do not advertise unlimited usage or assume that every model is covered. Confirm the account dashboard before a paid experiment.

Sources: [CLI authentication](https://cursor.com/docs/cli/reference/authentication), [ACP integration](https://cursor.com/docs/cli/acp), [models and pricing](https://cursor.com/docs/models-and-pricing).

## Reproduce the probe

Requires Node 22+ and an installed Cursor CLI. No npm dependencies needed:

```sh
node --test spike/cursor/probe.check.mjs
node spike/cursor/probe.mjs
# If installed under a different name or path:
CURSOR_AGENT_BIN=/absolute/path/to/cursor-agent node spike/cursor/probe.mjs
```

The probe starts the executable with `acp`, sends only `initialize`, reports capabilities and advertised authentication methods, and terminates the child. It has a ten-second timeout. It does not sign in, open a session, send a prompt, or validate subscription entitlement. Missing binaries, malformed responses, RPC errors and early exit fail with a nonzero status. Its tests use fake subprocesses; they do not demonstrate Cursor compatibility.

## Fit with helm

Implementation would sit behind `src/core/backend.ts`, alongside `ClaudeBackend` and `CodexBackend`; no renderer-specific transport is needed. The earlier decision `2026-10-26-acp-is-viable-for-a-second-backend` is architectural precedent, but its referenced spike is absent from this checkout.

| helm surface | Proposed implementation / remaining check |
| --- | --- |
| Agent process | Spawn `agent acp` with the session worktree as cwd; use NDJSON JSON-RPC. |
| Sign-in | Existing CLI login first; design `BackendAuth` only after observing login URL/status behavior. |
| Session lifecycle | Create/load/prompt/cancel ACP sessions; verify cross-process resume. |
| Text, tools, edits | Translate ACP updates into `AgentEvent` and helm's tool vocabulary; capture real fixtures before mapping diffs. |
| Approvals | Bridge permission requests to `canUseTool`, using the actual offered option IDs. |
| Questions/plans | Handle Cursor's blocking `cursor/ask_question` and `cursor/create_plan` requests or explicitly cancel them. |
| Permission modes | Advertised agent/plan/ask modes are candidates; verify semantics against helm's ask/edits/plan/all modes before enabling. |
| Models/effort | Discover support at runtime; avoid fixed model lists and disable unsupported effort controls. |
| MCP | Verify delivery of helm's stored configuration; Cursor documents project/user config but no team MCP in ACP. |
| Cost/plan meters | Leave disabled until reliable telemetry is demonstrated; missing cost must not be presented as free usage. |
| Fork/history/subagents | Leave unsupported capabilities disabled until verified; task notifications alone cannot enforce admission limits. |
| Structured review | Validate schema support separately before using for automatic reviews. |

These mappings are implementation proposals inferred from helm's interfaces and Cursor's [ACP reference](https://cursor.com/docs/cli/acp), not observed runtime results. In particular, the present `AgentCapabilities` flags do not cover every unsupported operation, so registration also needs a UI/call-site audit for history and review actions.

## Gate before production integration

On a machine signed in with the intended subscription, record the CLI version and initialize capabilities. Then use a disposable worktree to verify a text turn, a denied command, an approved edit, cancellation, questions, plan rejection, and load/resume after process restart. Compare the account usage dashboard before and after to establish which pool was charged. Capture sanitized protocol fixtures for adapter tests. Check model selection, MCP, error recovery and concurrent-session behavior separately.

Only register a Cursor backend after these checks pass, with unsupported capabilities hidden. Desktop needs CLI discovery and a path setting; hosted installations need a persistent CLI login and an explicit installation story. No production integration or subscription billing was exercised by this spike.
