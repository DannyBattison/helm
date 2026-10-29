# Getting started

This page takes you from nothing to a finished change in about ten minutes.

> **In short**
> - Install helm, sign in to GitHub, and sign in to an agent (Claude Code or Codex).
> - Add a repository, describe a task, and an agent does it on its own branch.
> - You review the result and open a pull request when you are happy. Your own files are never touched along the way.

## 1. Install helm

Download the desktop app from [takethehelm.dev](https://takethehelm.dev), or from the latest release on GitHub. There are installers for Mac, Windows and Linux.

Prefer a browser? See [Hosted version](Hosted-Version.md). On a phone? See [Phone app](Phone-App.md).

You also need at least one agent signed in:
- **Claude Code** with a Claude subscription or an Anthropic API key, or
- **Codex** (needs the `codex` command-line tool installed) with a ChatGPT plan or an OpenAI API key.

## 2. Sign in

1. Open helm. It asks you to sign in with GitHub. You get a short code to enter on github.com; no password is typed into helm.
2. Sign in to an agent when asked (or later under **Settings, then Accounts**). See [Settings](Settings.md#accounts).

> **New to git?** GitHub is where your project's files live online. A "repository" is one project. If you do not have one, you can make a new one from inside helm in step 3.

## 3. Add a repository

1. Click the **+** next to **Repositories** in the left sidebar (the first tutorial bubble points at it).
2. Choose a tab:
   - **GitHub**: pick from your repositories (and those of your organisations).
   - **URL**: paste a `https://github.com/...` or `git@github.com:...` address.
   - **New**: create a brand-new repository on GitHub, with a README, and add it.
   - **Local**: pick a folder on your computer that is already a clone of a GitHub repository. Folders without a GitHub remote cannot be added; push them to GitHub first.
3. Click add. helm clones it for you if needed.

Just want to chat or build something from scratch? Skip this and use a [free agent](Free-Agents.md).

## 4. Start a session

1. Click the **+** at the top (or press **Cmd/Ctrl+N**, or **Alt+N** in a browser).
2. Pick the repository, then describe what you want. Be specific about the result you want. You can paste screenshots or drop files in.
3. Click **Start session**.

The agent gets its own copy of the project on a new branch. See [Starting a session](Starting-a-Session.md) for every option.

## 5. Watch, answer, review

- The session appears in the sidebar with a coloured dot. **Working** means the agent is busy. **Needs you** means it is asking for permission or has a question. See [Core concepts](Core-Concepts.md#session-status).
- Open it to read the [conversation](Session-Conversation.md). Approve or deny commands, and answer questions. The [Inbox](Inbox.md) collects all of these across every session.
- When the dot turns **Ready for review**, open the **Changes** tab to read what changed. See [Changes and review](Changes-and-Review.md).

## 6. Ship it

On the **Changes** tab, click to open a pull request. Once it is merged, helm tidies up the session. See [Pull requests and merging](Pull-Requests-and-Merging.md).

## What next?

- Learn the layout: [The window](The-Window.md).
- Run several agents at once: [Overview and Needs you](Overview-and-Needs-You.md).
- Stuck? See the [FAQ](FAQ.md).
