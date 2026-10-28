#!/usr/bin/env node
// Make the app icon in every accent, from ios/App/TriaAppIcon.icon.
//
//   node gen-alt-icons.js
//
// iOS can only switch to an icon that is in the binary, so the App icon color row in
// Edit profile needs one Icon Composer file per colour. They are copies of
// Tria's own with the two fills swapped: the wordmark's gradient becomes a
// narrow ramp around the accent, 15 degrees across like the brand's own
// cyan to green and running the same way, from the higher hue down; the rings
// behind it take the accent itself (at the same 0.2 the brand's rings wear).
// Everything else, the glass, the shadow, the layout, is the original's, so
// redraw TriaAppIcon.icon and run this again.
//
// The keys and hexes are ACCENTS in js/app.js, written out by hand; so is the
// name each icon is built under (TriaAppIcon-<key>), which app.js sends to
// TriaSettings.setAppIcon and the project lists under
// ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'ios/App');
const SRC = path.join(DIR, 'TriaAppIcon.icon');

const ACCENTS = [
  ['ruby',     '#df2a48'],
  ['rose',     '#ef6bbf'],
  ['coral',    '#fb7c46'],
  ['amber',    '#fdb435'],
  ['lime',     '#abe64c'],
  ['jade',     '#54e89c'],
  ['cyan',     '#52def4'],
  ['ocean',    '#367df8'],
  ['lavender', '#8564e8'],
];
// The light four are deepened ON THE ICON only (Zoe, 2026-10-27: "yellow is
// pretty tough to read"): on the icon's white the palette's pastel amber and
// lime washed out, and jade and cyan nearly did. Amber leans gold. The
// profile colours themselves are untouched.
const DEEPER = {
  amber: '#e5a000',
  lime:  '#7fbf1f',
  jade:  '#2bc77a',
  cyan:  '#14c3d4',
};
const ARC = 7.5;   // each side of the accent: the brand's ramp is 15 degrees end to end

const hexRgb = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);

function rgbHsl([r, g, b]) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  const l = (mx + mn) / 2;
  let h = 0, s = 0;
  if (d) {
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}

function hslRgb([h, s, l]) {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => {
    t = (t + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
}

const turn = (rgb, deg) => {
  const [h, s, l] = rgbHsl(rgb);
  return hslRgb([(h + deg / 360 + 1) % 1, s, l]);
};
const color = (rgb) => 'srgb:' + rgb.map(v => v.toFixed(5)).join(',') + ',1.00000';

const icon = JSON.parse(fs.readFileSync(path.join(SRC, 'icon.json'), 'utf8'));

for (const [key, hex] of ACCENTS) {
  const rgb = hexRgb(DEEPER[key] || hex);
  const out = JSON.parse(JSON.stringify(icon));
  for (const group of out.groups) {
    for (const layer of group.layers) {
      if (layer.fill && layer.fill['linear-gradient']) {
        layer.fill['linear-gradient'] = [color(turn(rgb, ARC)), color(turn(rgb, -ARC))];
      } else if (layer.fill && layer.fill.solid) {
        layer.fill.solid = color(rgb);
      }
    }
  }
  const dest = path.join(DIR, `TriaAppIcon-${key}.icon`);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(SRC, dest, { recursive: true });
  fs.writeFileSync(path.join(dest, 'icon.json'), JSON.stringify(out, null, 2) + '\n');
  console.log('wrote', path.relative(__dirname, dest));
}
