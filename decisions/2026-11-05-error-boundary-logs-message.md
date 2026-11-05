## 2026-11-05 · Error boundary logs the error's name and message

Safari (the iOS PWA) formats `error.stack` without the message, so a caught render error reached the log as a bare minified stack with no cause. The boundary now logs `name: message` before the stack and component stack.
