# Qwen on locally run models

Assessed 2026-11-06. Verdict: feasible, with no new transport. Not run: neither `qwen` nor `ollama` is installed here, so this is documentation-backed, not a live connection.

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
