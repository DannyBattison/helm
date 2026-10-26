// Renders the wheel to every image the app ships: from desktop/build/icon.svg the installers' and window's icon.png, icon.ico (Windows) and
// icon.icns (macOS) and the web client's apple-touch-icon.png; from tray.svg and trayTemplate.svg the tray images in desktop/resources.
// It draws the SVG with a headless Chrome or Edge, so set CHROME to its path if it is not found. Run: node desktop/scripts/make-icons.mjs (npm run icons)
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const read = (name) => readFileSync(join(root, 'build', name), 'utf8');
const candidates = [
  process.env.CHROME,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/microsoft-edge'
].filter(Boolean);
const exe = candidates.find((p) => existsSync(p));
if (!exe) throw new Error('No Chrome or Edge found. Set CHROME to its path.');

const port = 9500 + Math.floor(Math.random() * 300);
const profile = join(tmpdir(), 'helm-icons-' + Date.now());
mkdirSync(profile, { recursive: true });
const browser = spawn(exe, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 50 && !targets; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { await sleep(200); } }
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let n = 0;
const waiting = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); } };
const send = (method, params = {}) => new Promise((res) => { const id = ++n; waiting.set(id, res); ws.send(JSON.stringify({ id, method, params })); });

await send('Page.enable');
await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
const png = async (svg, size) => {
  const html = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent}svg{display:block;width:100vw;height:100vh}</style>${svg}`;
  await send('Emulation.setDeviceMetricsOverride', { width: size, height: size, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'data:text/html;base64,' + Buffer.from(html).toString('base64') });
  await sleep(500);
  const r = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  return Buffer.from(r.result.data, 'base64');
};

const sizes = [16, 24, 32, 48, 64, 128, 180, 256, 512, 1024];
const images = {};
const icon = read('icon.svg');
for (const s of sizes) images[s] = await png(icon, s);
const tray = { 'tray.png': ['tray.svg', 32], 'tray@2x.png': ['tray.svg', 64], 'trayTemplate.png': ['trayTemplate.svg', 22], 'trayTemplate@2x.png': ['trayTemplate.svg', 44] };
const trayImages = {};
for (const [name, [file, size]] of Object.entries(tray)) trayImages[name] = await png(read(file), size);
ws.close();
browser.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch { /* still in use */ }

const out = (name) => join(root, 'build', name);
writeFileSync(out('icon.png'), images[512]);

// .ico: a directory of PNG images (Windows reads PNG entries from Vista on).
const ico = [16, 24, 32, 48, 64, 128, 256];
const head = Buffer.alloc(6);
head.writeUInt16LE(1, 2);
head.writeUInt16LE(ico.length, 4);
let offset = 6 + 16 * ico.length;
const dir = Buffer.alloc(16 * ico.length);
ico.forEach((s, i) => {
  const b = images[s];
  dir.writeUInt8(s === 256 ? 0 : s, i * 16);
  dir.writeUInt8(s === 256 ? 0 : s, i * 16 + 1);
  dir.writeUInt16LE(1, i * 16 + 4);
  dir.writeUInt16LE(32, i * 16 + 6);
  dir.writeUInt32LE(b.length, i * 16 + 8);
  dir.writeUInt32LE(offset, i * 16 + 12);
  offset += b.length;
});
writeFileSync(out('icon.ico'), Buffer.concat([head, dir, ...ico.map((s) => images[s])]));

writeFileSync(join(root, '..', 'hosted', 'web', 'public', 'apple-touch-icon.png'), images[180]);
for (const [name, data] of Object.entries(trayImages)) writeFileSync(join(root, 'resources', name), data);

// .icns: macOS's own iconutil when there is one, since it writes every size the system asks for, the 2x ones included.
if (process.platform === 'darwin') {
  const set = join(tmpdir(), 'helm-icons-' + Date.now() + '.iconset');
  mkdirSync(set, { recursive: true });
  for (const [name, size] of [['16x16', 16], ['16x16@2x', 32], ['32x32', 32], ['32x32@2x', 64], ['128x128', 128], ['128x128@2x', 256], ['256x256', 256], ['256x256@2x', 512], ['512x512', 512], ['512x512@2x', 1024]]) writeFileSync(join(set, `icon_${name}.png`), images[size]);
  const r = spawnSync('iconutil', ['-c', 'icns', set, '-o', out('icon.icns')]);
  rmSync(set, { recursive: true, force: true });
  if (r.status === 0) { console.log('wrote the icons and tray images'); process.exit(0); }
  console.warn('iconutil failed, writing the .icns by hand');
}
// Elsewhere: a header and PNG chunks (ic07 128, ic08 256, ic09 512, ic10 1024).
const chunk = (type, data) => { const h = Buffer.alloc(8); h.write(type, 0, 'ascii'); h.writeUInt32BE(data.length + 8, 4); return Buffer.concat([h, data]); };
const body = Buffer.concat([chunk('ic07', images[128]), chunk('ic08', images[256]), chunk('ic09', images[512]), chunk('ic10', images[1024])]);
const icnsHead = Buffer.alloc(8);
icnsHead.write('icns', 0, 'ascii');
icnsHead.writeUInt32BE(body.length + 8, 4);
writeFileSync(out('icon.icns'), Buffer.concat([icnsHead, body]));
console.log('wrote the icons and tray images');
