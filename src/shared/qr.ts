import qrcode from 'qrcode-generator';

/** `text` as a QR code: the modules as rows of booleans, for drawing or for tests. Throws if it is too long for any QR code. */
export function qrModules(text: string): boolean[][] {
  const qr = qrcode(0, 'L');
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, y) => Array.from({ length: n }, (_, x) => qr.isDark(y, x)));
}

/** A QR code as an SVG that scales to its box: dark modules on a white square with the quiet zone a scanner needs. */
export function qrSvg(text: string, quiet = 4): string {
  const m = qrModules(text);
  const size = m.length + quiet * 2;
  let path = '';
  m.forEach((row, y) => { let x = 0; while (x < row.length) { if (!row[x]) { x++; continue; } let w = 1; while (row[x + w]) w++; path += `M${x + quiet} ${y + quiet}h${w}v1h-${w}z`; x += w; } });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}
