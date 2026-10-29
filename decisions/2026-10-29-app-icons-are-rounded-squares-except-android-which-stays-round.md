## 2026-10-29 · App icons are rounded squares everywhere except Android, which stays round; splash screens are the wheel on the dark colour

`npm run icons` (`desktop/scripts/make-icons.mjs`) draws every icon and splash from one definition of the wheel, with `sharp` instead of a local Chrome, so it runs anywhere and the same files come out. Shapes:

- **Rounded square, corner radius 22.37% of the side (what iPhone icons have):** the desktop `icon.png` (Windows and Linux) and `icon.ico`, the web `favicon.svg`, and the PWA's `icon-192.png` and `icon-512.png`. macOS's `icon.icns` is the same shape at 824 of 1024 px, centred, as Apple's template has it.
- **Full-bleed square, no corners, no transparency:** the iOS app icon and `apple-touch-icon.png`. iOS rounds these itself, and fills transparent corners with black, so pre-rounding them would show black corners. (The user asked for the standard radius on iOS; this is how iOS gets it.)
- **Maskable:** `icon-maskable-512.png` for the PWA manifest, full-bleed with the wheel inside the middle 80% (Android masks it to the shape of the device).
- **Round on Android, as asked:** `ic_launcher.png` and `ic_launcher_round.png` at every density are circles; the adaptive icon (API 26+) is the wheel inside the safe zone over `#0e0e12`, which the launcher masks (most launchers draw a circle, some a squircle).
- **Splash screens:** the wheel, about a quarter of the shorter side across, on `#0e0e12`, at every size the iOS and Android projects already have; the iOS launch storyboard's background and Android 12's own splash (`windowSplashScreenBackground`, `windowSplashScreenAnimatedIcon`) use the same colour so nothing flashes white.

`tests/icons.test.ts` checks the shapes by pixel (corners transparent or not, no transparency on the iOS icon, safe zone, round launcher icons at all densities, splash colour and wheel, the manifest naming only icons that exist). The PWA manifest now lists the 192, 512 and maskable PNGs (it only had the SVG and the 180 px one). Not seen on devices: how a launcher masks the adaptive icon, and how the splash looks at different aspect ratios.

Why: user request.
