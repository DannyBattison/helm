# Issues and GitHub

helm works with GitHub as you: your sign-in is used for repositories, pull requests, issues and checks.

> **In short**
> - Turn an issue into a session in one click.
> - Turn a pull request's review comments into a session.
> - Your sign-in is a device code, with no password and no broad scope.

## Signing in

helm uses GitHub's device flow: it shows a short code to enter on github.com. The token is stored on your computer and renewed automatically. Sign out in [Settings, GitHub](Settings.md#github), where you can also see your organisations.

## Issues become sessions

On a repository's **Issues** tab, click **Start session** on an issue. The New session dialog opens with the task filled in from the issue's text, labels and recent comments. The session remembers the issue, so its pull request will say "Closes #n". See [Starting a session](Starting-a-Session.md).

## Review comments become sessions

On the **Pull requests** tab, **Fix comments** starts a session from the pull request's branch with its review comments as the task. If a session already has a pull request, **Send new review comments to the agent** in its Changes tab sends only comments that arrived since last time. See [Changes and review](Changes-and-Review.md#comments-for-the-agent).

## Automations from GitHub events

An [automated agent](Automations.md) can start when a pull request or issue is opened, a pull request is merged, commits land on a branch, or a Actions run succeeds or fails.

## Run workflows

The **Actions** tab on a repository starts GitHub Actions workflows by hand. See [Repository page](Repository-Page.md#actions).

## Something rejected?

When GitHub rejects a request, helm logs it with the reason in [Activity](Activity.md) so you can see why.

## See also

- [Pull requests and merging](Pull-Requests-and-Merging.md)
- [Repository page](Repository-Page.md)
- [Getting started](Getting-Started.md)
