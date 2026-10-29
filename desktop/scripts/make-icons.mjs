// Draws the wheel into every image the apps ship, from one definition of it, with `sharp` (no browser needed): npm run icons
//
//   rounded square (the corner radius iPhone icons have, 22.37%)   desktop icon.png and icon.ico, the web favicon.svg and the PWA's any-purpose icons
//   rounded square with the margin macOS icons have                desktop icon.icns
//   full-bleed square, no corners                                  the iOS app icon and apple-touch-icon.png, which iOS rounds itself (it fills transparent corners with black)
//   full-bleed square, wheel inside the safe zone                  the PWA's maskable icon, which Android masks to its own shape
//   circle                                                         Android's launcher icons (round, as asked), with the adaptive icon's wheel and colour
//   the wheel on the dark colour                                   the iOS and Android splash screens
//   the tray images                                                from tray.svg and trayTemplate.svg
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const repo = resolve(root, '..');
const BG = '#0e0e12';
const FG = '#a78bfa';
/** iPhone icons round their corners by 22.37% of the side. */
const RADIUS = 229;

const ARM = '<g id="arm"><rect x="-4.5" y="-95" width="9" height="66"/><ellipse cy="-50" rx="7.5" ry="5"/><ellipse cy="-72" rx="7" ry="4"/><rect x="-5" y="-118" width="10" height="28"/><ellipse cy="-125" rx="12" ry="21"/></g>';
const arms = [0, 45, 90, 135, 180, 225, 270, 315].map((a) => `<use href="#arm" transform="rotate(${a})"/>`).join('');
/** The wheel, centred in a 1024 square, `k` times the size it has in the full icon. */
const wheel = (k = 1) => `<defs>${ARM}</defs><g transform="translate(512 512) scale(${2.6 * k})" fill="${FG}"><circle r="93" fill="none" stroke="${FG}" stroke-width="14"/><circle r="23" fill="none" stroke="${FG}" stroke-width="14"/>${arms}</g>`;
const svg = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">${inner}</svg>`;

const shapes = {
  rounded: svg(`<rect width="1024" height="1024" rx="${RADIUS}" fill="${BG}"/>${wheel()}`),
  square: svg(`<rect width="1024" height="1024" fill="${BG}"/>${wheel()}`),
  circle: svg(`<circle cx="512" cy="512" r="512" fill="${BG}"/>${wheel()}`),
  /** macOS: the icon is 824 of the 1024 square, centred. */
  mac: svg(`<g transform="translate(100 100) scale(${824 / 1024})"><rect width="1024" height="1024" rx="${RADIUS}" fill="${BG}"/>${wheel()}</g>`),
  /** The wheel alone, for a launcher's adaptive icon: its safe zone is the middle two thirds. */
  adaptive: svg(wheel(0.78))
};

const png = (markup, size) => sharp(Buffer.from(markup), { density: Math.max(1, (72 * size) / 1024) }).resize(size, size).png().toBuffer();
/** A splash screen: the dark colour with the wheel in the middle, about a quarter of the shorter side across. */
async function splash(width, height) {
  const mark = Math.round(Math.min(width, height) * 0.36);
  const m = await sharp(Buffer.from(svg(wheel(0.9))), { density: Math.max(1, (72 * mark) / 1024) }).resize(mark, mark).png().toBuffer();
  return sharp({ create: { width, height, channels: 3, background: BG } }).composite([{ input: m, gravity: 'centre' }]).png().toBuffer();
}
const flat = (b) => sharp(b).flatten({ background: BG }).removeAlpha().png().toBuffer();

const sizes = [16, 24, 32, 48, 64, 128, 180, 192, 256, 512, 1024];
const rounded = {}, mac = {};
for (const s of sizes) { rounded[s] = await png(shapes.rounded, s); mac[s] = await png(shapes.mac, s); }

// ---------------------------------------------------------------------------------------------------- desktop
const build = (name) => join(root, 'build', name);
writeFileSync(build('icon.svg'), shapes.rounded);
writeFileSync(build('icon.png'), rounded[512]);

// .ico: a directory of PNG images (Windows reads PNG entries from Vista on).
const ico = [16, 24, 32, 48, 64, 128, 256];
const head = Buffer.alloc(6);
head.writeUInt16LE(1, 2);
head.writeUInt16LE(ico.length, 4);
let offset = 6 + 16 * ico.length;
const dir = Buffer.alloc(16 * ico.length);
ico.forEach((s, i) => {
  const b = rounded[s];
  dir.writeUInt8(s === 256 ? 0 : s, i * 16);
  dir.writeUInt8(s === 256 ? 0 : s, i * 16 + 1);
  dir.writeUInt16LE(1, i * 16 + 4);
  dir.writeUInt16LE(32, i * 16 + 6);
  dir.writeUInt32LE(b.length, i * 16 + 8);
  dir.writeUInt32LE(offset, i * 16 + 12);
  offset += b.length;
});
writeFileSync(build('icon.ico'), Buffer.concat([head, dir, ...ico.map((s) => rounded[s])]));

// .icns: macOS's own iconutil when there is one, since it writes every size the system asks for, the 2x ones included.
let wroteIcns = false;
if (process.platform === 'darwin') {
  const set = join(tmpdir(), 'helm-icons-' + Date.now() + '.iconset');
  mkdirSync(set, { recursive: true });
  for (const [name, size] of [['16x16', 16], ['16x16@2x', 32], ['32x32', 32], ['32x32@2x', 64], ['128x128', 128], ['128x128@2x', 256], ['256x256', 256], ['256x256@2x', 512], ['512x512', 512], ['512x512@2x', 1024]]) writeFileSync(join(set, `icon_${name}.png`), mac[size]);
  const r = spawnSync('iconutil', ['-c', 'icns', set, '-o', build('icon.icns')]);
  rmSync(set, { recursive: true, force: true });
  wroteIcns = r.status === 0;
  if (!wroteIcns) console.warn('iconutil failed, writing the .icns by hand');
}
if (!wroteIcns) {
  // Elsewhere: a header and PNG chunks (ic07 128, ic08 256, ic09 512, ic10 1024).
  const chunk = (type, data) => { const h = Buffer.alloc(8); h.write(type, 0, 'ascii'); h.writeUInt32BE(data.length + 8, 4); return Buffer.concat([h, data]); };
  const body = Buffer.concat([chunk('ic07', mac[128]), chunk('ic08', mac[256]), chunk('ic09', mac[512]), chunk('ic10', mac[1024])]);
  const icnsHead = Buffer.alloc(8);
  icnsHead.write('icns', 0, 'ascii');
  icnsHead.writeUInt32BE(body.length + 8, 4);
  writeFileSync(build('icon.icns'), Buffer.concat([icnsHead, body]));
}

// tray images
const tray = { 'tray.png': ['tray.svg', 32], 'tray@2x.png': ['tray.svg', 64], 'trayTemplate.png': ['trayTemplate.svg', 22], 'trayTemplate@2x.png': ['trayTemplate.svg', 44] };
for (const [name, [file, size]] of Object.entries(tray)) {
  writeFileSync(join(root, 'resources', name), await sharp(readFileSync(build(file)), { density: 72 * 8 }).resize(size, size).png().toBuffer());
}

// ---------------------------------------------------------------------------------------------------- web and PWA
const pub = join(repo, 'hosted', 'web', 'public');
writeFileSync(join(pub, 'favicon.svg'), shapes.rounded);
writeFileSync(join(pub, 'icon-192.png'), rounded[192]);
writeFileSync(join(pub, 'icon-512.png'), rounded[512]);
writeFileSync(join(pub, 'icon-maskable-512.png'), await png(shapes.square, 512));
// iOS rounds this one itself, and paints transparent corners black: no corners, no transparency.
writeFileSync(join(pub, 'apple-touch-icon.png'), await flat(await png(shapes.square, 180)));

// ---------------------------------------------------------------------------------------------------- iOS
const ios = join(repo, 'mobile', 'ios', 'App', 'App', 'Assets.xcassets');
if (existsSync(ios)) {
  writeFileSync(join(ios, 'AppIcon.appiconset', 'AppIcon-512@2x.png'), await flat(await png(shapes.square, 1024)));
  const set = join(ios, 'Splash.imageset');
  for (const f of readdirSync(set).filter((n) => n.endsWith('.png'))) {
    const { width, height } = await sharp(join(set, f)).metadata();
    writeFileSync(join(set, f), await splash(width, height));
  }
}

// ---------------------------------------------------------------------------------------------------- Android
const res = join(repo, 'mobile', 'android', 'app', 'src', 'main', 'res');
if (existsSync(res)) {
  // Launcher icons: round, as the app's icon is on Android. The adaptive icon (API 26+) is the wheel on the dark colour, which the launcher masks.
  for (const [d, px, fg] of [['mdpi', 48, 108], ['hdpi', 72, 162], ['xhdpi', 96, 216], ['xxhdpi', 144, 324], ['xxxhdpi', 192, 432]]) {
    const dir = join(res, `mipmap-${d}`);
    const round = await png(shapes.circle, px);
    writeFileSync(join(dir, 'ic_launcher.png'), round);
    writeFileSync(join(dir, 'ic_launcher_round.png'), round);
    writeFileSync(join(dir, 'ic_launcher_foreground.png'), await png(shapes.adaptive, fg));
  }
  writeFileSync(join(res, 'values', 'ic_launcher_background.xml'), `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${BG}</color>\n</resources>\n`);
  // Splash screens: every size the project already has.
  for (const d of readdirSync(res).filter((n) => /^drawable(-(land|port)-\w+)?$/.test(n) && existsSync(join(res, n, 'splash.png')))) {
    const f = join(res, d, 'splash.png');
    const { width, height } = await sharp(f).metadata();
    writeFileSync(f, await splash(width, height));
  }
}
console.log('wrote the icons, splash screens and tray images');
