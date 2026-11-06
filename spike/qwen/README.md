# Qwen on locally run models

Assessed 2026-11-06, and since built as `src/core/qwenBackend.ts` (see `decisions/2026-11-06-qwen-code-runs-local-models-as-a-third-backend.md`). Verdict: feasible, with no new transport. The backend passes tests against a stand-in; the gate below is still open. Not run: neither `qwen` nor `ollama` is installed here, so this is documentation-backed, not a live connection.

## Route

Use Qwen Code (the `qwen` CLI) as the agent and point it at a local OpenAI-compatible server (Ollama at `http://localhost:11434/v1`, llama.cpp `llama-server`, LM Studio, vLLM). Qwen Code reads `OPENAI_BASE_URL`, `OPENAI_API_KEY` (any value for a local server) and `OPENAI_MODEL`. Qwen OAuth was discontinued on 2026-04-15, so the endpoint route is the one to use. Variable names vary by version; confirm with `qwen --help`.

Helm would run `qwen` in its ACP mode, as proposed for Cursor in `spike/cursor/` and in `2026-10-26-acp-is-viable-for-a-second-backend`. Whether Qwen Code's ACP flag honours the same endpoint and model settings is unverified.

## Fit with helm

A generic `AcpBackend` (not yet written) would serve both Qwen and Cursor. Settings would need: path to `qwen`, base URL, model name (discovered from `/v1/models`). No sign-in (`canSignIn: false`), cost reported as unknown rather than free, and capabilities `subagents`, `planMode`, `effort`, `fork`, `cost`, `planUsage` off.

## Risks

- Local models of useful size need a lot of memory; small ones handle tool calling poorly. Model choice matters more than the integration.
- Context windows default small in Ollama (`num_ctx`); agent prompts overflow them silently.
- Approvals, tool-name mapping and resume are unverified until a live run.

## Gate before building

With Ollama and a tool-capable Qwen model (e.g. a Qwen3-Coder build) pulled: run `qwen` interactively against it, then `qwen` in ACP mode; record the `initialize` response and one text turn, one tool call with approval, and cancel. Capture sanitised fixtures for adapter tests.

Sources: [Qwen Code OpenAI auth](https://qwenlm.github.io/qwen-code-docs/de/cli/openai-auth), [Qwen as an OpenAI endpoint](https://inventivehq.com/knowledge-base/openai/how-to-serve-qwen-coder-as-openai-endpoint).

## Goal: use helm without a subscription (revised 2026-11-06)

The aim is an unlimited, free agent that is installed locally and sits beside Claude and Codex. Hosted free tiers are out: their request caps (about 50 a day) are too small for agent work. So the route is the one above: Qwen Code over ACP against a local OpenAI-compatible server.

What "drop in" needs from helm:
- Detect the runtime (`ollama`, falling back to a base URL setting) and the `qwen` CLI, the way `findCodex` finds `codex`.
- List installed models from `/v1/models` (Ollama also has `/api/tags`), and offer a recommended tool-capable Qwen coder model with a one-click `ollama pull` and a size warning.
- Start the server if it is not running, and set a usable context size (`num_ctx`); the default silently truncates agent prompts.
- Show the agent as ready only when both the CLI and a model are present, as sign-in readiness does for the others.
- Label it plainly: free and unlimited, but quality depends on the model and the hardware, and it is weaker than Claude or Codex at long tasks.

Open question to settle in the live run: which Qwen model sizes are good enough at tool calling on ordinary laptops. That decides whether this is a real alternative or a demo.

Gate: install Ollama and a Qwen coder model, run `qwen` against it normally and in ACP mode, and confirm a tool-calling turn with approval and a cancel.
