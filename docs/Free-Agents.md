# Free agents

An agent that is not tied to a repository. Use it to think out loud, research, write, run scripts, or turn an idea into a plan before it becomes a project.

> **In short**
> - Start one with **New session**, then **No repository (free agent)**.
> - It works in a scratch folder of its own, with git set up so you can see what changed.
> - You do not need to know git.

If you do not see the option, turn on **Free agents** under **Settings, then Worktrees**.

## Starting from an idea

A good way to start if you are not a developer:

1. Start a free agent and tell it your idea in plain words.
2. Chat until it makes sense. Ask it questions.
3. Ask it to write up a **brief**: a short description of what to build. It can save it as a file you can open from the conversation.
4. When you are happy, make a project: use **Add repository**, then **New** to create a repository on GitHub, and start a normal [session](Starting-a-Session.md) with the brief as the task.

It is all in the same window, from the first question to the finished code.

## Where it works

- By default, a new scratch folder under **Free agents' folders** (Settings, Worktrees), with git started so the **Changes** tab, [checkpoints](Checkpoints-and-Compare.md), the **Code** tab and disk clean-up all work.
- Or choose **Use my own folder**. The agent then works directly in that folder with no safety net: no worktree to throw away, no checkpoints, and helm never runs git there, never cleans it and never deletes it.

## What a free agent cannot do

Things that need a repository: branches, pull requests, merging, pushing, forking, review by an agent, comparing runs and **Remember**. When its turn ends it is simply **Done**, not "ready for review". It is told not to push.

Editing outside its folder still asks for approval, and the usual [permission modes](Safety-and-Limits.md#permission-modes) apply.

## In the sidebar

Free agents are listed under a **Free agents** group, with a **+** to start one.

## See also

- [Starting a session](Starting-a-Session.md)
- [Getting started](Getting-Started.md)
- [Core concepts](Core-Concepts.md)
