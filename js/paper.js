/* ── Tria's paper in a colour (2026-11-08) ────────────────────────────────────
   The page's four neutrals (--bg, --surface, --surface-2, --rule in
   tokens.css), each turned toward a colour's hue: the app's light and dark
   background in someone's colour, and the alternate app icons' backgrounds
   (gen-alt-icons.js requires this same file, so the two can never drift).

   WHY IT IS ALWAYS AA. Each paper is solved to its neutral's own WCAG
   luminance: a bisection on OKLCH lightness at a fixed chroma. Contrast is a
   ratio of luminances, so every pair the app has measured against paper is
   the same number on a tinted one, and no ink has to move.

   WHY NO COLOUR SHOUTS. Chroma is fixed per surface in OKLCH, which is
   perceptual, so ten hues sit at one weight (HSL would hand a yellow twice
   a blue's colourfulness at the same number); it gives way only where sRGB
   runs out at that lightness. A source with little colour of its own (a grey
   photo) lends it in proportion, and none at all below a tenth. A card on
   paper carries 0.010, the most every hue can reach that near white (ruby,
   ocean and indigo clip there), so every card lifts toward white alike; on
   ink the raised panels carry a touch more, where chroma reads quieter. */
(function (root) {
  'use strict';

  // [the neutral, its chroma], per scheme and surface. The neutrals are
  // tokens.css's; change them there and here together.
  const SURFACES = {
    lt: { bg: ['#edeef0', 0.024], surface: ['#f6f7f8', 0.010], 'surface-2': ['#e6e8ea', 0.028], rule: ['#dadde1', 0.032] },
    dk: { bg: ['#0e1012', 0.016], surface: ['#171a1d', 0.020], 'surface-2': ['#1f2327', 0.024], rule: ['#272c30', 0.028] },
  };
  // Tria's own colour, the oklab middle of #00c9ce to #00cc9e (--brand-mid).
  const TRIA = '#00cbb6';
  // The chroma a source needs before it lends its whole tint.
  const FULL = 0.08;
  /* Reds and pinks read louder than their chroma (the Helmholtz-Kohlrausch
     effect): at one number, Ruby, Blush and Coral stood out of the audit
     sheet beside Cyan and Ocean. So hues near OKLCH 10 degrees give up to
     12% back, falling off with the cosine; amber gives 5%, blues nothing. */
  const EVEN_AT = 10 * Math.PI / 180, EVEN_BY = 0.12;
  const evenOut = (h) => 1 - EVEN_BY * Math.max(0, Math.cos(h - EVEN_AT));

  const rgbOf = (hex) => {
    const n = parseInt(String(hex).replace('#', ''), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  };
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const gam = (v) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
  const lumOf = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

  function oklab(c) {
    const r = lin(c.r), g = lin(c.g), b = lin(c.b);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return {
      a: 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
      b: 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
    };
  }
  // OKLCH to LINEAR sRGB, unclamped, so the caller can see out of gamut.
  function linear(L, C, h) {
    const a = C * Math.cos(h), b = C * Math.sin(h);
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
    return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
  }
  const inGamut = (x) => x.every(v => v >= -1e-4 && v <= 1 + 1e-4);
  const hexOf = (x) => '#' + x.map(v => Math.round(Math.min(255, Math.max(0, gam(Math.max(0, v)))))
    .toString(16).padStart(2, '0')).join('');

  // `base` turned to hue h at chroma C (less where sRGB runs out), at base's
  // own luminance.
  function turn(base, h, C) {
    const c0 = rgbOf(base);
    const Y = lumOf([lin(c0.r), lin(c0.g), lin(c0.b)]);
    for (let c = C; ; c = Math.max(0, c - 0.002)) {
      let lo = 0, hi = 1;
      for (let i = 0; i < 28; i++) {
        const mid = (lo + hi) / 2;
        if (lumOf(linear(mid, c, h)) < Y) lo = mid; else hi = mid;
      }
      const x = linear((lo + hi) / 2, c, h);
      if (c === 0 || inGamut(x)) return hexOf(x);
    }
  }

  /* A colour ({r, g, b} or a hex) to its papers,
     { lt: { bg, surface, 'surface-2', rule }, dk: { ... } }, or null where it
     has no hue to lend (null in, or a grey). */
  function papers(colour) {
    if (!colour) return null;
    const o = oklab(typeof colour === 'string' ? rgbOf(colour) : colour);
    let k = Math.min(1, Math.hypot(o.a, o.b) / FULL);
    if (k < 0.1) return null;
    const h = Math.atan2(o.b, o.a);
    k *= evenOut(h);
    const out = {};
    for (const s of ['lt', 'dk']) {
      out[s] = {};
      for (const [name, [base, C]] of Object.entries(SURFACES[s])) out[s][name] = turn(base, h, C * k);
    }
    return out;
  }

  /* A colour deepened in OKLCH, its hue kept, until white on it reaches
     `ratio` (WCAG's 3:1 for a large mark): the light icons' backgrounds,
     where the wordmark is white (gen-alt-icons.js). One already there is
     returned as it is. */
  function forWhite(hex, ratio = 3) {
    const c = rgbOf(hex);
    const white = (x) => 1.05 / (lumOf(x) + 0.05);
    if (white([lin(c.r), lin(c.g), lin(c.b)]) >= ratio) return hex;
    const o = oklab(c), h = Math.atan2(o.b, o.a);
    let C = Math.hypot(o.a, o.b);
    for (;;) {
      let lo = 0, hi = 1;
      for (let i = 0; i < 28; i++) {
        const mid = (lo + hi) / 2;
        if (white(linear(mid, C, h)) > ratio) lo = mid; else hi = mid;
      }
      const x = linear(lo, C, h);
      if (inGamut(x)) return hexOf(x);
      C *= 0.97;
    }
  }

  const api = { papers, forWhite, SURFACES, TRIA };
  root.TriaPaper = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
