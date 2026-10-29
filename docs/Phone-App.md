# Phone app

helm on your phone: the same interface, to keep an eye on agents and answer them away from your desk.

> **In short**
> - Connect to a **hosted** helm by URL, or to your **desktop** directly over an encrypted link.
> - Get notifications when an agent needs you.
> - Two tabs: **Servers** and **Settings**.

## Install

Phone builds are attached to each release on GitHub (an Android APK and an iOS build). The Android build installs directly. The iOS build is unsigned unless the maintainer signed it: install it with a tool such as Sideloadly or AltStore. With a free Apple account the app stops opening after seven days and must be reinstalled.

You can also use a hosted server in the phone's browser or install it as a web app. See [Hosted version](Hosted-Version.md).

## First launch

The app asks you to sign in to GitHub (a code you enter on github.com). The token is kept in the phone's secure storage.

## Connect to a hosted server

On the **Servers** tab, add a server and enter its URL, as you would in a browser.

## Connect to your desktop

1. On the desktop: **Settings, then Mobile app**, turn on **Allow the phone app**. It shows a **QR code** with a share code, valid for ten minutes.
2. On the phone: **Add computer**, then scan the QR code or paste the code.
3. The desktop accepts the phone only if its GitHub user is the one signed in on the computer.

Later connections need neither the code nor GitHub: the phone is recognised by its key. Remove a phone under **Paired phones** on the desktop to end it.

The link goes straight from phone to computer, with nothing of ours in between. It uses one UDP port. Options on the desktop: **UDP port**, **Open the port on my router**, **Fixed address** (such as a dynamic DNS name) and a **STUN server** to learn the public address.

> **Careful:** a paired phone can do everything the desktop window can, including running commands in the terminal and changing settings. Only your GitHub user can pair, and your GitHub token never leaves the desktop.

## Notifications

While the app is open they arrive at once. With the app closed, the phone checks each computer in the background, typically every 15 minutes or more (iOS may run it less often for an app you rarely open). Tapping a notification opens that session.

## Phone layout

Below a certain width the sidebar becomes a menu (swipe from the left edge or tap the menu button), buttons are larger, and multi-column pages stack.

## See also

- [Hosted version](Hosted-Version.md)
- [Settings](Settings.md#mobile-app-and-companion)
- [Safety and limits](Safety-and-Limits.md)
