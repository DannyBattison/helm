# Local models

Run an agent on your own computer with a free, unlimited model. No subscription, no account, and nothing leaves your machine.

> **In short**
> - It uses Qwen Code and Ollama, both installed on your computer.
> - Turn it on and download a model under **Settings, then Accounts, then Qwen Code (local)**.
> - It is weaker than Claude or Codex, and how well it works depends on the model and your hardware.

## Set it up

1. Open **Settings, then Accounts, then Qwen Code (local)**.
2. Click **Install** next to the command-line tool, and **Install Ollama** next to the model server. Helm installs Qwen Code into a folder of its own with the npm that comes with it, so you do not need Node. Ollama uses its own installer, and helm shows the command before it runs it. Start Ollama there if it is not running.
3. Download a recommended model. The page shows each one's size and the memory it wants, and how much this computer has.
4. Turn Qwen on under **Settings, then Agents**. It then appears in the model list when you start a session, as `qwen/<model>`.

Qwen is off until you turn it on, and is only counted as ready once Qwen Code is installed, Ollama is running and a model is downloaded. The Agents page says which of these is missing.

On Linux, Ollama's installer needs administrator rights that helm cannot ask for. Helm then shows the command to run in a terminal instead. On a Mac it may ask for a password to add the `ollama` command; helm uses the app's own copy if that does not happen.

The same **Install** button (and **Update** once installed) is on the Claude Code and Codex pages for Codex. Claude Code comes with helm. Installing is only in the desktop app.

## What to expect

- Models under about 7B are poor at the tool use an agent needs. The 30B Qwen3 Coder is the best choice if you have the memory (about 32 GB).
- Helm runs models with a larger context size than Ollama's default, which silently cuts off long prompts. Change it on the same page.
- There is no cost, plan meter or budget for it.
- Not available: subagents, effort levels, forking a session, and reading its older conversations back from the agent itself.
- Any server with an OpenAI-compatible API works if you put its address in **Server address**.
