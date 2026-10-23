// Renders the app icons from tools/icon.svg (run once, with Playwright available): node tools/make-icons.cjs
const fs = require('fs'), path = require('path');
const { chromium } = require(process.env.PW || 'playwright');
const ROOT = path.resolve(__dirname, '..');
const svg = fs.readFileSync(path.join(__dirname, 'icon.svg'), 'utf8');
// the foreground alone (transparent), for Android's adaptive icon and splash screen
const fg = svg.replace(/<rect[^>]*\/>/, '');
async function shot(page, markup, size, file, scale = 1) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent"><div style="width:${size}px;height:${size}px;display:grid;place-items:center">${markup.replace('width="512" height="512"', `width="${Math.round(size * scale)}" height="${Math.round(size * scale)}"`)}</div></body></html>`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  await shot(p, svg, 512, path.join(ROOT, 'icon-512.png'));
  await shot(p, svg, 192, path.join(ROOT, 'icon-192.png'));
  await shot(p, svg, 180, path.join(ROOT, 'apple-touch-icon.png'));
  await shot(p, svg, 48, path.join(ROOT, 'favicon.png'));
  // maskable: the artwork inside the 80% safe zone
  await shot(p, svg.replace('<g transform="rotate(-14 256 256)"', '<g transform="translate(256 256) scale(0.82) translate(-256 -256) rotate(-14 256 256)"').replace('<g fill="none" stroke="#FFFFFF"', '<g transform="translate(256 256) scale(0.82) translate(-256 -256)" fill="none" stroke="#FFFFFF"').replace('<circle cx="300" cy="236" r="15"', '<circle transform="translate(256 256) scale(0.82) translate(-256 -256)" cx="300" cy="236" r="15"'), 512, path.join(ROOT, 'icon-maskable-512.png'));
  const res = path.join(ROOT, 'native/android/app/src/main/res');
  const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
  for (const [d, k] of Object.entries(dens)) {
    await shot(p, svg, Math.round(48 * k), path.join(res, `mipmap-${d}/ic_launcher.png`));
    await shot(p, `<div style="width:100%;height:100%;border-radius:50%;overflow:hidden">${svg.replace('width="512" height="512"', 'width="100%" height="100%"')}</div>`, Math.round(48 * k), path.join(res, `mipmap-${d}/ic_launcher_round.png`));
    // adaptive foreground: 108dp canvas, artwork in the middle 72dp
    await shot(p, fg, Math.round(108 * k), path.join(res, `mipmap-${d}/ic_launcher_foreground.png`), 0.74);
    // splash: the icon in the middle of 288dp ... Android 12 shows a 240dp icon
    await shot(p, fg, Math.round(288 * k / 2), path.join(res, `drawable-${d}/splash_icon.png`), 0.8);
  }
  await b.close();
  console.log('icons done');
})();
