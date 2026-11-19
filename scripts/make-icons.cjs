// Renders the Pebbles icon (a small cairn of pebbles) into every size the
// Windows app and the Android app need. Dev-only: `node scripts/make-icons.cjs`.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BG = '#F3EFE6';

function cairn({ bg, shape }) {
  // 512 x 512 artboard
  const back =
    shape === 'square'
      ? `<rect x="0" y="0" width="512" height="512" rx="112" fill="${BG}"/>`
      : shape === 'circle'
        ? `<circle cx="256" cy="256" r="256" fill="${BG}"/>`
        : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  ${back}
  <g transform="translate(256 270) scale(${bg === 'full' ? 0.92 : 0.62}) translate(-256 -270)">
    <ellipse cx="256" cy="420" rx="170" ry="22" fill="#2A2724" opacity="0.10"/>
    <path d="M110,372 C104,330 168,300 258,300 C350,300 410,328 404,370 C398,412 330,424 254,424 C176,424 116,412 110,372 Z" fill="#7E776C"/>
    <ellipse cx="200" cy="336" rx="56" ry="14" fill="#fff" opacity="0.22"/>
    <path d="M150,286 C148,250 196,226 256,226 C318,226 362,246 360,282 C358,318 312,330 252,330 C194,330 152,320 150,286 Z" fill="#B6A587"/>
    <ellipse cx="214" cy="256" rx="42" ry="11" fill="#fff" opacity="0.28"/>
    <path d="M190,196 C190,166 222,148 260,148 C300,148 328,164 326,194 C324,224 294,236 256,236 C218,236 190,224 190,196 Z" fill="#56704F"/>
    <ellipse cx="236" cy="172" rx="28" ry="8" fill="#fff" opacity="0.30"/>
  </g>
</svg>`;
}

const TRAY = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <path d="M6,46 C5,38 17,33 32,33 C47,33 59,37 58,45 C57,53 46,56 32,56 C18,56 7,53 6,46 Z" fill="#7E776C"/>
  <path d="M14,32 C13,25 22,21 32,21 C43,21 51,24 50,31 C50,37 42,40 32,40 C22,40 15,38 14,32 Z" fill="#B6A587"/>
  <path d="M20,15 C20,9 26,6 33,6 C40,6 45,9 45,15 C44,21 39,23 32,23 C25,23 20,21 20,15 Z" fill="#56704F"/>
</svg>`;

function pngSize(file) {
  const b = fs.readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  async function render(svg, w, h, out, background = 'transparent') {
    await page.setViewportSize({ width: w, height: h });
    await page.setContent(
      `<html><body style="margin:0;background:${background};display:flex;align-items:center;justify-content:center;width:${w}px;height:${h}px;overflow:hidden">${svg
        .replace('width="512" height="512"', `width="${Math.min(w, h)}" height="${Math.min(w, h)}"`)
        .replace('width="64" height="64"', `width="${w}" height="${h}"`)}</body></html>`,
    );
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await page.screenshot({ path: out, omitBackground: background === 'transparent' });
  }

  await render(cairn({ bg: 'full', shape: 'square' }), 512, 512, path.join(ROOT, 'build/icon.png'));
  await render(cairn({ bg: 'full', shape: 'square' }), 192, 192, path.join(ROOT, 'public/icon-192.png'));
  await render(TRAY, 32, 32, path.join(ROOT, 'build/tray.png'));

  const res = path.join(ROOT, 'android/app/src/main/res');
  if (fs.existsSync(res)) {
    const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
    for (const [d, k] of Object.entries(dens)) {
      await render(cairn({ bg: 'full', shape: 'square' }), 48 * k, 48 * k, `${res}/mipmap-${d}/ic_launcher.png`);
      await render(cairn({ bg: 'full', shape: 'circle' }), 48 * k, 48 * k, `${res}/mipmap-${d}/ic_launcher_round.png`);
      await render(cairn({ bg: 'safe', shape: 'none' }), 108 * k, 108 * k, `${res}/mipmap-${d}/ic_launcher_foreground.png`);
    }
    // splash screens: keep each file's size, limestone background with a small cairn
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
    for (const f of walk(res).filter((f) => path.basename(f) === 'splash.png')) {
      const { w, h } = pngSize(f);
      const s = Math.round(Math.min(w, h) * 0.32);
      const svg = cairn({ bg: 'safe', shape: 'none' }).replace('width="512" height="512"', `width="${s}" height="${s}"`);
      await page.setViewportSize({ width: w, height: h });
      await page.setContent(`<html><body style="margin:0;background:${BG};display:flex;align-items:center;justify-content:center;width:${w}px;height:${h}px">${svg}</body></html>`);
      await page.screenshot({ path: f });
    }
  }
  await browser.close();
  console.log('icons written');
})();
