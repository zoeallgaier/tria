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
// LIGHT IS THE COLOUR, DARK IS ITS PAPER (Zoe, 2026-11-08: "the background
// on light mode the full color punch and the logo white on top"), each an
// appearance specialization:
// - LIGHT: the background is the colour itself, as the same 15 degree ramp,
//   and the wordmark and rings are white. A light colour is deepened in
//   OKLCH, hue kept, until white on it reaches 3:1, WCAG's floor for a large
//   mark (`forWhite` in js/paper.js): amber goes gold, lime grass, jade and
//   cyan a shade deeper; ruby, ocean and indigo are already there and keep
//   their punch.
// - DARK: the colour's dark paper, from js/paper.js, the file the app tints
//   its pages with, under the coloured wordmark and rings.
// None is the neutral ramp under white on light, and its paper on dark.
//
// The keys and hexes are ACCENTS in js/app.js, written out by hand; so is the
// name each icon is built under (TriaAppIcon-<key>), which app.js sends to
// TriaSettings.setAppIcon and the project lists under
// ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES.
const fs = require('fs');
const path = require('path');
const { papers, forWhite, SURFACES, TRIA } = require('./js/paper.js');

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
// The light four are deepened for the DARK icon's wordmark (Zoe, 2026-10-27:
// "yellow is pretty tough to read", on what was then a white icon). The
// light icon's background deepens by contrast instead (forWhite).
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

const WHITE = color([1, 1, 1]);
const solid = (hex) => ({ solid: color(hexRgb(hex)) });
const rampAround = (rgb) => ({ 'linear-gradient': [color(turn(rgb, ARC)), color(turn(rgb, -ARC))] });
// Light and dark, as one appearance-specialized fill.
const byLook = (light, dark) => [{ value: light }, { appearance: 'dark', value: dark }];
const darkPaper = (hex) => solid(hex ? papers(hex).dk.bg : SURFACES.dk.bg[0]);
// The light ground's ramp runs down the icon, the higher hue at the top.
const GROUND_ORIENT = { start: { x: 0.5, y: 0 }, stop: { x: 0.5, y: 1 } };

const icon = JSON.parse(fs.readFileSync(path.join(SRC, 'icon.json'), 'utf8'));
// TriaAppIcon.icon is itself written below (Tria's own wears the same scheme,
// Zoe, 2026-11-11: "match the other colors, Tria teal bg"), so its layers
// carry their brand fills as the DARK specialization. Read them back as the
// plain `fill` every recipe below starts from, so this runs again and again.
for (const group of icon.groups) {
  for (const layer of group.layers) {
    const spec = layer['fill-specializations'];
    if (!layer.fill && spec) {
      layer.fill = (spec.find(s => s.appearance === 'dark') || spec[0]).value;
      delete layer['fill-specializations'];
    }
  }
}

// NONE is no colour: the neutral, --mono-band's ends: the deep one under
// white on the light icon, and the light one as the wordmark on the dark,
// the way the theme None wears the paper's opposite.
const MONO = { light: ['#3b4147', '#1b1f24'], dark: ['#f5f6f8', '#d5d8dd'] };
const rampOf = (pair) => ({ 'linear-gradient': pair.map(h => color(hexRgb(h))) });
const write = (key, out) => {
  const dest = path.join(DIR, `TriaAppIcon-${key}.icon`);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(SRC, dest, { recursive: true });
  fs.writeFileSync(path.join(dest, 'icon.json'), JSON.stringify(out, null, 2) + '\n');
  console.log('wrote', path.relative(__dirname, dest));
};

for (const [key, hex] of ACCENTS) {
  const mark = hexRgb(DEEPER[key] || hex);           // the dark icon's wordmark
  const ground = hexRgb(forWhite(hex));              // the light icon's background
  const out = JSON.parse(JSON.stringify(icon));
  for (const group of out.groups) {
    for (const layer of group.layers) {
      if (!layer.fill) continue;
      const dark = layer.fill['linear-gradient'] ? { ...layer.fill, ...rampAround(mark) } : { solid: color(mark) };
      delete layer.fill;
      layer['fill-specializations'] = byLook({ solid: WHITE }, dark);
    }
  }
  delete out.fill;
  out['fill-specializations'] = byLook({ ...rampAround(ground), orientation: GROUND_ORIENT }, darkPaper(hex));
  write(key, out);
}

{
  const out = JSON.parse(JSON.stringify(icon));
  for (const group of out.groups) {
    for (const layer of group.layers) {
      if (!layer.fill) continue;
      const grad = !!layer.fill['linear-gradient'];
      const dark = grad ? { ...layer.fill, ...rampOf(MONO.dark) } : { solid: color(hexRgb(MONO.dark[1])) };
      delete layer.fill;
      layer['fill-specializations'] = byLook({ solid: WHITE }, dark);
    }
  }
  delete out.fill;
  out['fill-specializations'] = byLook({ ...rampOf(MONO.light), orientation: GROUND_ORIENT }, darkPaper(null));
  write('none', out);
}

// TRIA'S OWN, the primary icon, on the same rule: light is the brand ramp
// (#00c9ce to #00cc9e, each end deepened by forWhite as cyan is) under the
// white wordmark and rings; dark is Tria's dark paper under the brand's own
// fills, untouched. Written in place, last, since every copy above is made
// from it.
{
  const out = JSON.parse(JSON.stringify(icon));
  for (const group of out.groups) {
    for (const layer of group.layers) {
      if (!layer.fill) continue;
      const dark = layer.fill;
      delete layer.fill;
      layer['fill-specializations'] = byLook({ solid: WHITE }, dark);
    }
  }
  delete out.fill;
  const ground = ['#00c9ce', '#00cc9e'].map(h => forWhite(h));
  out['fill-specializations'] = byLook({ ...rampOf(ground), orientation: GROUND_ORIENT }, darkPaper(TRIA));
  fs.writeFileSync(path.join(SRC, 'icon.json'), JSON.stringify(out, null, 2) + '\n');
  console.log('wrote', path.relative(__dirname, SRC));
}
