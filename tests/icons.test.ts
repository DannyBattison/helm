import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

const pixel = async (file: string, x: number, y: number) => {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * 4;
  return { r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3], width: info.width, height: info.height, channels: (await sharp(file).metadata()).channels };
};
const meta = (f: string) => sharp(f).metadata();

describe('app icons', () => {
  it('desktop, web and PWA icons are rounded squares: the corner is transparent, the middle is not', async () => {
    for (const f of ['desktop/build/icon.png', 'hosted/web/public/icon-192.png', 'hosted/web/public/icon-512.png']) {
      const m = await meta(f);
      expect(m.width, f).toBe(m.height);
      expect((await pixel(f, 0, 0)).a, f).toBe(0);
      expect((await pixel(f, 2, 2)).a, f).toBe(0);
      expect((await pixel(f, m.width! >> 1, m.height! >> 1)).a, f).toBe(255);
      // The side is full-height at its middle: a rounded square, not a circle.
      expect((await pixel(f, 0, m.height! >> 1)).a, f).toBe(255);
    }
  });

  it('iOS and the apple-touch icon are full-bleed squares with no transparency, for iOS to round', async () => {
    for (const [f, size] of [['mobile-app/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png', 1024], ['hosted/web/public/apple-touch-icon.png', 180]] as const) {
      const p = await pixel(f, 0, 0);
      expect([p.width, p.height], f).toEqual([size, size]);
      expect(p.channels, f).toBe(3);
      expect(p, f).toMatchObject({ r: 14, g: 14, b: 18 });
    }
  });

  it('the maskable PWA icon fills its square, with the wheel inside the safe zone', async () => {
    const f = 'hosted/web/public/icon-maskable-512.png';
    expect(await pixel(f, 0, 0)).toMatchObject({ a: 255, r: 14 });
    // The safe zone is the middle 80%: the corner ring is all background.
    for (const [x, y] of [[40, 40], [470, 40], [40, 470], [470, 470]]) expect(await pixel(f, x, y)).toMatchObject({ r: 14, g: 14, b: 18 });
  });

  it('Android launcher icons are round at every density, and the adaptive foreground has room around the wheel', async () => {
    const res = 'mobile-app/android/app/src/main/res';
    for (const [d, px, fg] of [['mdpi', 48, 108], ['hdpi', 72, 162], ['xhdpi', 96, 216], ['xxhdpi', 144, 324], ['xxxhdpi', 192, 432]] as const) {
      for (const name of ['ic_launcher.png', 'ic_launcher_round.png']) {
        const f = join(res, `mipmap-${d}`, name);
        expect((await pixel(f, 0, 0)).a, f).toBe(0);
        expect((await pixel(f, px >> 1, px >> 1)).a, f).toBe(255);
        expect((await meta(f)).width, f).toBe(px);
      }
      const f = join(res, `mipmap-${d}`, 'ic_launcher_foreground.png');
      expect((await meta(f)).width, f).toBe(fg);
      expect((await pixel(f, 0, 0)).a, f).toBe(0);
      // Nothing is drawn in the outer sixth, which launchers may crop.
      expect((await pixel(f, Math.floor(fg / 12), fg >> 1)).a, f).toBe(0);
    }
    expect(readFileSync(join(res, 'values', 'ic_launcher_background.xml'), 'utf8')).toContain('#0e0e12');
  });

  it('splash screens are the dark colour with the wheel in the middle, at the sizes the projects use', async () => {
    const found: string[] = [];
    const res = 'mobile-app/android/app/src/main/res';
    for (const d of readdirSync(res).filter((n) => n.startsWith('drawable') && existsSync(join(res, n, 'splash.png')))) found.push(join(res, d, 'splash.png'));
    const set = 'mobile-app/ios/App/App/Assets.xcassets/Splash.imageset';
    for (const n of readdirSync(set).filter((x) => x.endsWith('.png'))) found.push(join(set, n));
    expect(found.length).toBeGreaterThanOrEqual(13);
    for (const f of found) {
      const m = await meta(f);
      expect(await pixel(f, 2, 2), f).toMatchObject({ r: 14, g: 14, b: 18 });
      // The middle has purple in it somewhere along the centre row.
      const { data } = await sharp(f).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      let purple = 0;
      const y = m.height! >> 1;
      for (let x = 0; x < m.width!; x++) { const i = (y * m.width! + x) * 3; if (data[i] > 120 && data[i + 2] > 200) purple++; }
      expect(purple, f).toBeGreaterThan(0);
    }
  });

  it('the PWA manifest only names icons that exist', () => {
    const manifest = JSON.parse(readFileSync('hosted/pwa/manifest.webmanifest', 'utf8'));
    for (const i of manifest.icons) expect(existsSync(join('hosted/web/public', i.src)), i.src).toBe(true);
    expect(manifest.icons.some((i: any) => i.purpose === 'maskable')).toBe(true);
  });
});
