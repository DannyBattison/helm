## 2026-11-05 · Push failures are logged and the default contact is a real URL

Phones with the PWA installed got no notifications although permission was granted: the page stays quiet once a device is subscribed, and the server swallowed every push-service error except 404/410. The default VAPID subject was `mailto:helm@localhost`, which Apple's push service can reject. The default is now an https URL (still overridable with `HELM_HOSTED_PUSH_CONTACT`) and other send failures are logged.
