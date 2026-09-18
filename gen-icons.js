#!/usr/bin/env node
// Re-render every BAKED Tria mark from icons/wordmark.svg.
//
//   node gen-icons.js
//
// The tab's favicon, the home-screen tiles, the appiconset's fallback and the
// iOS launch screen are all one picture: the wordmark used as a MASK with the
// brand band painted through it, on Tria's own paper — the boot splash, held
// still (see .wordmark and .splash-t in css/app.css). They are PNGs because
// every slot that takes them wants a bitmap, which is the only reason the logo
// exists twice; run this whenever the wordmark or the band changes, and run it
// for ALL of them, so a tile cannot drift from the curtain the app opens on.
//
// It renders in Chromium — the same engine the app runs in, so the mask, the
// gradient and the geometry are the app's own rather than a second opinion —
// and leans on Playwright, which is installed locally for the headless boot
// pass (see docs/shipping.md). The small tiles are supersampled 4x and brought
// down by sips; that is what keeps 32px a word rather than a smudge.
//
// The band stops are written out rather than read from tokens.css because these
// are baked pixels: they are --band-* resolved (light mixes 20% ink into each
// pastel, dark takes the pastel undeepened), and the ramp is the splash's own —
// 115deg, no interpolation space, stops in order. Keep them in step with
// css/tokens.css by hand; a drift shows up as a tile that doesn't match the
// curtain.
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = __dirname;
const SS = 4;

// The mask travels as a data URI: a file:// subresource is not reachable from a
// setContent document, and this keeps the render self-contained.
const MASK = 'data:image/svg+xml;base64,' +
  fs.readFileSync(path.join(ROOT, 'icons/wordmark.svg')).toString('base64');

const LIGHT = { paper: '#edeef0', band: ['#a693de', '#85c2d7', '#a3ca69', '#e59278'] };
const DARK  = { paper: '#0e1012', band: ['#b7a6e8', '#9fd6e8', '#b9df7d', '#f2a58c'] };

// `width` is the mark's share of the tile.
//   80 — the plain tiles, the inset every icon here has worn since v=289.
//   84 — the favicon, a shade wider because 32px has no room to waste.
//   66 — the Android maskable. A wordmark's DIAGONAL is what has to clear the
//        80% safe circle, and 66 x 1.178 (its aspect) is 78.
//   13 — the iOS launch screen, which is not an icon at all: the square is
//        aspect-filled to the SCREEN, so 13% of 2732 lands at the HTML splash's
//        own 28vw once iOS takes the crop (~111pt on a 393pt phone, against the
//        splash's clamped 112).
const tiles = [
  { out: 'icons/icon-32.png',                                                size: 32,   width: 84, theme: LIGHT },
  { out: 'icons/icon-180.png',                                               size: 180,  width: 80, theme: LIGHT },
  { out: 'icons/icon-192.png',                                               size: 192,  width: 80, theme: LIGHT },
  { out: 'icons/icon-512.png',                                               size: 512,  width: 80, theme: LIGHT },
  { out: 'icons/icon-maskable-512.png',                                      size: 512,  width: 66, theme: LIGHT },
  { out: 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png', size: 1024, width: 80, theme: LIGHT },
  { out: 'ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732.png',  size: 2732, width: 13, theme: LIGHT },
  { out: 'ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-dark.png',
                                                                             size: 2732, width: 13, theme: DARK },
];

const doc = (px, width, theme) => `<!doctype html><meta charset="utf-8">
<style>
  html, body { margin: 0; }
  .tile { width: ${px}px; height: ${px}px; background: ${theme.paper};
          display: grid; place-items: center; }
  .mark { width: ${width}%; aspect-ratio: 1650 / 1028;
          -webkit-mask: url('${MASK}') center / contain no-repeat;
                  mask: url('${MASK}') center / contain no-repeat;
          background: linear-gradient(115deg, ${theme.band.join(', ')}); }
</style>
<div class="tile"><div class="mark"></div></div>`;

(async () => {
  const browser = await chromium.launch();
  for (const t of tiles) {
    // Supersampling is for the small tiles, where half a pixel of stroke is the
    // difference between a word and a smudge. The launch screen is enormous and
    // almost entirely flat field: downsampling one only dithers the paper into
    // a PNG four times the size, so it renders at its own size.
    const ss = t.size > 1024 ? 1 : SS;
    const px = t.size * ss;
    const page = await browser.newPage({ viewport: { width: px, height: px }, deviceScaleFactor: 1 });
    await page.setContent(doc(px, t.width, t.theme));
    const file = path.join(ROOT, t.out);
    await page.locator('.tile').screenshot({ path: file });
    await page.close();
    if (ss > 1) execFileSync('/usr/bin/sips', ['-Z', String(t.size), file], { stdio: 'ignore' });
    console.log(`${t.out} — ${t.size}px, mark at ${t.width}%`);
  }
  await browser.close();
})();
