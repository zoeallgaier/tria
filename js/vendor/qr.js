/* QR, byte mode, error correction level M, versions 1 to 6.
   ==========================================================================

   Written here rather than pulled from npm because this repo has NO BUILD STEP
   and one file in js/vendor/ is the whole dependency story. It implements
   ISO/IEC 18004 far enough for what Tria puts on a card and no further.

   WHAT IT DELIBERATELY DOES NOT DO. One error-correction level (M, ~15%
   recovery, the usual choice for a code that will be photographed off a
   screen). Byte mode only, so no numeric or alphanumeric compaction — a URL
   would barely benefit and each extra mode is another table to get wrong.
   Versions 1 to 6, which tops out at 106 bytes; version 7 is where the format
   grows a version-information block and the tables stop being checkable by
   eye. Everything Tria encodes is a triaonline.com URL of under 40 characters,
   so the ceiling is about triple what it needs to be. Past it, encode() throws
   and the caller draws its placeholder instead of a code that will not scan.

   THE TABLES ARE THE RISK, not the algorithm. A wrong block count produces a
   QR that looks perfect, scans on nothing, and gives no hint why. Every
   version here is round-tripped through a real decoder at every payload length
   it can hold — see the check in the scratchpad pass — and the arithmetic is
   written out beside each row so a reader can confirm it without a spec:
   blocks x ecPerBlock + sum(data) must equal total. */

(function () {
  'use strict';

  /* version: total codewords, EC codewords per block, and the data blocks.
     [count, dataCodewordsEach]. The sum check is in the comment. */
  const VERSIONS = {
    1: { total: 26,  ec: 10, groups: [[1, 16]] },   // 1*10 + 16        = 26
    2: { total: 44,  ec: 16, groups: [[1, 28]] },   // 1*16 + 28        = 44
    3: { total: 70,  ec: 26, groups: [[1, 44]] },   // 1*26 + 44        = 70
    4: { total: 100, ec: 18, groups: [[2, 32]] },   // 2*18 + 2*32      = 100
    5: { total: 134, ec: 24, groups: [[2, 43]] },   // 2*24 + 2*43      = 134
    6: { total: 172, ec: 16, groups: [[4, 27]] },   // 4*16 + 4*27      = 172
  };

  /* Centres of the alignment patterns. Version 1 has none; 2 to 6 have exactly
     one, at the far corner. (The general rule only starts to matter at 7.) */
  const ALIGN = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34] };

  /* ---- GF(256) ---------------------------------------------------------- */
  /* Reed-Solomon over the field QR specifies: primitive polynomial 0x11D. */
  const EXP = new Uint8Array(512);
  const LOG = new Uint8Array(256);
  (function () {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();

  const mul = (a, b) => (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]];

  /* The generator polynomial for n check symbols: (x - a^0)(x - a^1)... */
  function generator(n) {
    let poly = [1];
    for (let i = 0; i < n; i++) {
      const next = new Array(poly.length + 1).fill(0);
      for (let j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];
        next[j + 1] ^= mul(poly[j], EXP[i]);
      }
      poly = next;
    }
    return poly;
  }

  function ecCodewords(data, n) {
    const gen = generator(n);
    const res = new Array(data.length + n).fill(0);
    for (let i = 0; i < data.length; i++) res[i] = data[i];
    for (let i = 0; i < data.length; i++) {
      const factor = res[i];
      if (factor === 0) continue;
      for (let j = 0; j < gen.length; j++) res[i + j] ^= mul(gen[j], factor);
    }
    return res.slice(data.length);
  }

  /* ---- Bits ------------------------------------------------------------- */
  function BitBuffer() { this.bits = []; }
  BitBuffer.prototype.put = function (value, length) {
    for (let i = length - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  };

  /* ---- The codeword stream ---------------------------------------------- */
  function codewords(bytes, version) {
    const spec = VERSIONS[version];
    const dataTotal = spec.groups.reduce((n, g) => n + g[0] * g[1], 0);

    const buf = new BitBuffer();
    buf.put(0b0100, 4);          // byte mode
    buf.put(bytes.length, 8);    // char count: 8 bits for versions 1 to 9
    for (const b of bytes) buf.put(b, 8);

    // Terminator, then pad to a byte boundary, then the two alternating pad
    // codewords the spec names. Both are fixed values, not filler of choice.
    const capacity = dataTotal * 8;
    for (let i = 0; i < 4 && buf.bits.length < capacity; i++) buf.bits.push(0);
    while (buf.bits.length % 8 !== 0) buf.bits.push(0);

    const data = [];
    for (let i = 0; i < buf.bits.length; i += 8) {
      let b = 0;
      for (let j = 0; j < 8; j++) b = (b << 1) | buf.bits[i + j];
      data.push(b);
    }
    const PAD = [0xec, 0x11];
    while (data.length < dataTotal) data.push(PAD[(data.length - buf.bits.length / 8) % 2]);

    // Split into blocks, make each block's check symbols, then INTERLEAVE:
    // one codeword from each block in turn, data first and then EC. That
    // interleave is what makes a scuff across the code lose a little of every
    // block rather than all of one.
    const blocks = [];
    let at = 0;
    for (const [count, size] of spec.groups) {
      for (let i = 0; i < count; i++) {
        const chunk = data.slice(at, at + size);
        at += size;
        blocks.push({ data: chunk, ec: ecCodewords(chunk, spec.ec) });
      }
    }

    const out = [];
    const maxData = Math.max(...blocks.map(b => b.data.length));
    for (let i = 0; i < maxData; i++)
      for (const b of blocks) if (i < b.data.length) out.push(b.data[i]);
    for (let i = 0; i < spec.ec; i++)
      for (const b of blocks) out.push(b.ec[i]);
    return out;
  }

  /* ---- The matrix ------------------------------------------------------- */
  function blank(size) {
    const m = [], reserved = [];
    for (let i = 0; i < size; i++) {
      m.push(new Array(size).fill(0));
      reserved.push(new Array(size).fill(false));
    }
    return { m, reserved };
  }

  function placeFinder(g, row, col) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const rr = row + r, cc = col + c;
        if (rr < 0 || cc < 0 || rr >= g.m.length || cc >= g.m.length) continue;
        const on = (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
                   (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
                   (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        g.m[rr][cc] = on ? 1 : 0;
        g.reserved[rr][cc] = true;   // the separator ring is reserved too
      }
    }
  }

  function skeleton(version) {
    const size = 17 + version * 4;
    const g = blank(size);

    placeFinder(g, 0, 0);
    placeFinder(g, 0, size - 7);
    placeFinder(g, size - 7, 0);

    // Timing: the alternating run that tells a scanner the module pitch.
    for (let i = 8; i < size - 8; i++) {
      const on = i % 2 === 0 ? 1 : 0;
      g.m[6][i] = on; g.reserved[6][i] = true;
      g.m[i][6] = on; g.reserved[i][6] = true;
    }

    // Alignment, skipping any that would land on a finder.
    const centres = ALIGN[version];
    for (const r of centres) {
      for (const c of centres) {
        if ((r === 6 && c === 6) || (r === 6 && c === size - 7) || (r === size - 7 && c === 6)) continue;
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            g.m[r + dr][c + dc] =
              (Math.abs(dr) === 2 || Math.abs(dc) === 2 || (dr === 0 && dc === 0)) ? 1 : 0;
            g.reserved[r + dr][c + dc] = true;
          }
        }
      }
    }

    // The one module that is always dark, and the format strip around it.
    g.m[size - 8][8] = 1; g.reserved[size - 8][8] = true;
    for (let i = 0; i < 9; i++) {
      if (!g.reserved[8][i]) { g.reserved[8][i] = true; g.m[8][i] = 0; }
      if (!g.reserved[i][8]) { g.reserved[i][8] = true; g.m[i][8] = 0; }
    }
    for (let i = 0; i < 8; i++) {
      if (!g.reserved[8][size - 1 - i]) { g.reserved[8][size - 1 - i] = true; g.m[8][size - 1 - i] = 0; }
      if (!g.reserved[size - 1 - i][8]) { g.reserved[size - 1 - i][8] = true; g.m[size - 1 - i][8] = 0; }
    }
    return g;
  }

  /* The zigzag. Two columns at a time from the right, alternating direction,
     and column 6 is skipped entirely because the vertical timing line owns it. */
  function placeData(g, stream) {
    const size = g.m.length;
    let bit = 0, upward = true;
    const bitAt = (i) => {
      const byte = stream[i >> 3];
      return byte === undefined ? 0 : (byte >>> (7 - (i & 7))) & 1;
    };
    for (let right = size - 1; right > 0; right -= 2) {
      if (right === 6) right = 5;
      for (let step = 0; step < size; step++) {
        const row = upward ? size - 1 - step : step;
        for (let c = 0; c < 2; c++) {
          const col = right - c;
          if (g.reserved[row][col]) continue;
          g.m[row][col] = bitAt(bit++);
        }
      }
      upward = !upward;
    }
  }

  const MASKS = [
    (i, j) => (i + j) % 2 === 0,
    (i) => i % 2 === 0,
    (i, j) => j % 3 === 0,
    (i, j) => (i + j) % 3 === 0,
    (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0,
    (i, j) => ((i * j) % 2) + ((i * j) % 3) === 0,
    (i, j) => ((((i * j) % 2) + ((i * j) % 3)) % 2) === 0,
    (i, j) => ((((i + j) % 2) + ((i * j) % 3)) % 2) === 0,
  ];

  /* Format information: 2 bits of EC level (M = 00) and 3 of mask, protected
     by BCH(15,5) and then XORed with 0x5412 so an all-zero format is not an
     all-light strip. Written twice, in two places, because losing the format
     loses the whole code. */
  function placeFormat(g, mask) {
    const size = g.m.length;
    let bits = (0b00 << 3) | mask;
    let rem = bits;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const value = ((bits << 10) | rem) ^ 0x5412;
    const at = (i) => (value >>> i) & 1;

    /* [row][col], and that is worth saying out loud: every published version of
       this placement is written (x, y) with x the COLUMN, so transcribing it
       straight into a row-major grid silently swaps the two copies. The code
       still looks immaculate — finders, timing, alignment, data all correct —
       and scans on nothing, because the one strip that says how to read the
       rest is the strip that is wrong. */

    // Copy one: down the left of column 8, then out along row 8.
    for (let i = 0; i <= 5; i++) g.m[i][8] = at(i);
    g.m[7][8] = at(6);
    g.m[8][8] = at(7);
    g.m[8][7] = at(8);
    for (let i = 9; i < 15; i++) g.m[8][14 - i] = at(i);

    // Copy two: in from the right along row 8, then up column 8 from the bottom.
    for (let i = 0; i < 8; i++) g.m[8][size - 1 - i] = at(i);
    for (let i = 8; i < 15; i++) g.m[size - 15 + i][8] = at(i);
    g.m[size - 8][8] = 1;
  }

  /* The four penalty rules, summed. Lower is better. This is the part that
     makes a code scannable rather than merely correct: it is what stops a
     payload from producing large blank fields or accidental finder lookalikes. */
  function penalty(m) {
    const n = m.length;
    let score = 0;

    const run = (get) => {
      for (let a = 0; a < n; a++) {
        let last = -1, len = 0;
        for (let b = 0; b < n; b++) {
          const v = get(a, b);
          if (v === last) { len++; } else { last = v; len = 1; }
          if (len === 5) score += 3;
          else if (len > 5) score += 1;
        }
      }
    };
    run((a, b) => m[a][b]);
    run((a, b) => m[b][a]);

    for (let i = 0; i < n - 1; i++)
      for (let j = 0; j < n - 1; j++)
        if (m[i][j] === m[i][j + 1] && m[i][j] === m[i + 1][j] && m[i][j] === m[i + 1][j + 1])
          score += 3;

    const PAT = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
    const RPAT = PAT.slice().reverse();
    const look = (get) => {
      for (let a = 0; a < n; a++) {
        for (let b = 0; b + 11 <= n; b++) {
          let fwd = true, back = true;
          for (let k = 0; k < 11; k++) {
            const v = get(a, b + k);
            if (v !== PAT[k]) fwd = false;
            if (v !== RPAT[k]) back = false;
          }
          if (fwd) score += 40;
          if (back) score += 40;
        }
      }
    };
    look((a, b) => m[a][b]);
    look((a, b) => m[b][a]);

    let dark = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) dark += m[i][j];
    const pct = (dark * 100) / (n * n);
    score += Math.floor(Math.abs(pct - 50) / 5) * 10;
    return score;
  }

  function encode(text) {
    const bytes = Array.from(new TextEncoder().encode(String(text)));

    let version = 0;
    for (let v = 1; v <= 6; v++) {
      const data = VERSIONS[v].groups.reduce((n, g) => n + g[0] * g[1], 0);
      // 4 bits of mode + 8 of length + the payload, rounded up to codewords.
      if (Math.ceil((4 + 8 + bytes.length * 8) / 8) <= data) { version = v; break; }
    }
    if (!version) throw new Error('Too long for a version 6 QR: ' + bytes.length + ' bytes.');

    const stream = codewords(bytes, version);

    let best = null;
    for (let mask = 0; mask < 8; mask++) {
      const g = skeleton(version);
      placeData(g, stream);
      for (let i = 0; i < g.m.length; i++)
        for (let j = 0; j < g.m.length; j++)
          if (!g.reserved[i][j] && MASKS[mask](i, j)) g.m[i][j] ^= 1;
      placeFormat(g, mask);
      const score = penalty(g.m);
      if (!best || score < best.score) best = { score, m: g.m };
    }
    return best.m.map(row => row.map(Boolean));
  }

  window.QR = { encode: encode, MAX_BYTES: 106 };
})();
