/* STORY CARDS — one renderer, every size.
   ==========================================================================

   What this draws is the picture someone posts to Instagram, Messages or
   anywhere else that takes an image: a Tria post, on Tria's paper, with the
   handle and the address written on it. It is a CANVAS renderer and not a
   server, because Tria has no server — see docs/social-links.md. Everything
   here runs on the phone that taps Share, which also means the card can be
   drawn from the post already in the cache with no round trip at all.

   THREE SIZES, ONE LAYOUT. 1080x1920 is the story, 1080x1080 the square, and
   1200x630 the link preview. They are not three designs; they are one column
   (who / what / where) measured three ways, and the metrics below are the only
   place they differ.

   EVERYTHING READABLE SITS INSIDE THE CARD. The card is a sticker the sender
   can drag, resize, rotate and partly cover, and on Instagram the background is
   a separate layer underneath it that they can replace outright. A handle
   painted on the background is a handle that can vanish, so the background
   carries nothing but colour. The profile card is the one exception, and it is
   an exception on purpose: see "BARE DOES NOT APPLY TO THIS ONE" in render.

   THE SAFE BAND is the whole reason the card floats rather than fills. Roughly
   the top 250px and bottom 340px of a story are under Instagram's own chrome —
   the close button and the camera roll up top, the reply bar and the sticker
   tray at the bottom. The card is laid out to fit BETWEEN those and is centred
   in what is left, so a caption that runs long shrinks the type rather than
   pushing the address under the reply bar.

   A POST URL IS NOT RETYPEABLE, which is why only the profile card prints a
   full path. `triaonline.com/p/8f3a2b91` cannot be read off someone's screen
   and typed into a browser, so a post card carries the bare domain plus the
   handle and lets the link sticker do the linking. `triaonline.com/u/zoe` can
   be typed, so the profile card prints it in full, under the code.

   THE PALETTE IS FROZEN HERE rather than read from tokens.css, and that is
   deliberate. A card is Tria's paper, not the reader's device: someone with
   their phone in dark mode still sends a light card unless they pick Dark, and
   a card whose colours moved with the sender's system setting would be a card
   nobody could predict. The values below are tokens.css's, copied on purpose.
   If the type colours or --band-deepen change there, change them here too;
   BAND_STOPS carries the arithmetic that ties the two together.

   THE PROFILE CARD IS THE ONE EXCEPTION TO ALL OF THAT, and it is at the foot
   of this file under "THE CARD IS THE CODE": no slab, no blocks, no wordmark,
   just the person and their code on the paper. The share sheet draws the same
   composition at the size a camera reads it.

   WIRED IN SINCE 2026-09-22. The ••• on your own post and on your own profile
   both reach this through openStoryCardSheet in app.js, and the profile's sheet
   asks for the code on its own as well. tools/storycards.html draws every card
   at every size against every background, and that page is a bench, not a
   route. */

(function () {
  'use strict';

  /* Where our own assets live, worked out from this script's own URL rather
     than from the page's. The bench sits in a subdirectory and the app sits at
     the root; both load this file from `js/`, so `js/`'s parent is the one
     thing that is true in both places. */
  const ROOT = (function () {
    const s = document.currentScript && document.currentScript.src;
    return s ? new URL('../', s).href : new URL('./', document.baseURI).href;
  })();
  const WORDMARK = ROOT + 'icons/wordmark.svg';

  /* ---- The palette ------------------------------------------------------ */

  /* tokens.css, light scheme. `plate` is the empty-photo grey, --surface-2. */
  const LIGHT = { page: '#edeef0', card: '#ffffff', ink: '#14171a', muted: '#5c636b', plate: '#e6e8ea' };
  const DARK  = { page: '#0e1012', card: '#171a1d', ink: '#e9ebed', muted: '#969ca3', plate: '#22262b' };
  /* Tria's own paper, which is what the card becomes when the BACKGROUND is
     doing the colouring — a white slab on a gradient reads as a screenshot. */
  const TRIA  = { card: '#edeef0', ink: '#14171a', muted: '#5c636b', plate: '#dcdfe3' };

  /* The four post-type colours and their inks (tokens.css). */
  const TYPE = {
    note:     ['#b7a6e8', '#6247b8'],
    photo:    ['#9fd6e8', '#1d7391'],
    activity: ['#b9df7d', '#4d7519'],
    find:     ['#f2a58c', '#b0472a'],
  };
  const BAND_DEEPEN = 0.20;   /* --band-deepen */

  /* The brand ramp, deepened exactly the way tokens.css deepens it: each stop
     mixed a fifth of the way toward its OWN ink, so it darkens along its hue
     instead of drifting grey. On dark paper tokens.css sets every --type-*-ink
     equal to its pastel, which makes the mix a no-op and the ramp bright — a
     decision recorded at length beside --band-deepen, not an accident, so the
     no-op is reproduced here rather than tidied away. */
  function bandStops(dark) {
    return Object.keys(TYPE).map(function (k) {
      const pair = TYPE[k];
      return dark ? pair[0] : mix(pair[0], pair[1], BAND_DEEPEN);
    });
  }

  /* ---- Colour arithmetic ------------------------------------------------ */

  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    const n = h.length === 3 ? h.split('').map(function (c) { return c + c; }).join('') : h;
    return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
  }
  /* Returns HEX, not `rgb(...)`. Canvas takes either and did not care, but
     backgroundPair() hands these straight to Instagram, whose pasteboard keys
     are documented as hex strings and which silently paints NO background for
     anything else. One representation everywhere is cheaper than remembering
     which consumer is fussy. */
  function mix(a, b, t) {
    const x = hexToRgb(a), y = hexToRgb(b);
    return '#' + x.map(function (v, i) {
      const c = Math.round(v * (1 - t) + y[i] * t);
      return (c < 16 ? '0' : '') + c.toString(16);
    }).join('');
  }
  /* Relative luminance, so a reader's own colour can be asked whether it wants
     black type on it. The palette is pastel today and the answer is always
     black, but an accent is a hex and nothing stops a future one being deep. */
  function luminance(hex) {
    const c = hexToRgb(hex).map(function (v) {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  const inkOn = function (hex) { return luminance(hex) > 0.45 ? '#14171a' : '#f5f6f8'; };

  /* ---- Canvas helpers --------------------------------------------------- */

  /* A CSS linear-gradient angle, in canvas terms. CSS measures clockwise from
     "to top" and sizes the gradient LINE so that its perpendiculars through the
     two corners bound the box — which is why a 160deg ramp on a tall card hits
     its last stop right at the corner and not before. Canvas only takes two
     points, so the line is computed here. */
  function linearGradient(ctx, deg, w, h, stops) {
    const rad = (deg - 90) * Math.PI / 180;
    const dx = Math.cos(rad), dy = Math.sin(rad);
    const len = Math.abs(w * dx) + Math.abs(h * dy);
    const cx = w / 2, cy = h / 2;
    const g = ctx.createLinearGradient(
      cx - dx * len / 2, cy - dy * len / 2, cx + dx * len / 2, cy + dy * len / 2);
    stops.forEach(function (s, i) { g.addColorStop(stops.length === 1 ? 0 : i / (stops.length - 1), s); });
    return g;
  }

  /* An ELLIPTICAL radial wash, which canvas has no primitive for. The card sits
     on a big flat field and the field needs a soft lift behind it or the whole
     thing reads as a screenshot of a screenshot; a circular gradient on a 9:16
     box pools in the middle instead. Scaling the space around the centre is the
     cheap way to get the ellipse CSS would have drawn. */
  function wash(ctx, w, h, cx, cy, rx, ry, rgb, alpha) {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rx);
    g.addColorStop(0, 'rgba(' + rgb + ', ' + alpha + ')');
    g.addColorStop(0.66, 'rgba(' + rgb + ', 0)');
    g.addColorStop(1, 'rgba(' + rgb + ', 0)');
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, ry / rx);
    ctx.translate(-cx, -cy);
    ctx.fillStyle = g;
    ctx.fillRect(-w, -h, w * 3, h * 3);
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* ---- Type ------------------------------------------------------------- */

  const serif = function (size, italic) {
    return (italic ? 'italic ' : '') + '400 ' + size + 'px "Instrument Serif", Georgia, serif';
  };
  const sans = function (size, bold) {
    return (bold ? '700 ' : '400 ') + size + 'px Oxygen, -apple-system, sans-serif';
  };

  function wrap(ctx, text, maxWidth) {
    const lines = [];
    String(text).split(/\n/).forEach(function (para) {
      const words = para.split(/\s+/).filter(Boolean);
      if (!words.length) { lines.push(''); return; }
      let line = words[0];
      for (let i = 1; i < words.length; i++) {
        const next = line + ' ' + words[i];
        if (ctx.measureText(next).width <= maxWidth) line = next;
        else { lines.push(line); line = words[i]; }
      }
      lines.push(line);
    });
    return lines;
  }

  /* Fit a paragraph into a box by SHRINKING first and truncating only when
     shrinking runs out. A long post is the normal case on Tria — the whole app
     is built so long posts read well — so the card has to degrade on purpose
     rather than clip whatever fell off the bottom. */
  function paragraph(ctx, text, opt) {
    let size = opt.size;
    for (;;) {
      const font = opt.italic ? serif(size, true) : (opt.sans ? sans(size, opt.bold) : serif(size));
      ctx.font = font;
      const lh = Math.round(size * opt.lineHeight);
      const lines = wrap(ctx, text, opt.maxWidth);
      if (lines.length * lh <= opt.maxHeight || size <= opt.minSize) {
        const max = Math.max(1, Math.floor(opt.maxHeight / lh));
        if (lines.length > max) {
          lines.length = max;
          let last = lines[max - 1];
          while (last.length > 1 && ctx.measureText(last + '…').width > opt.maxWidth) {
            last = last.slice(0, -1).replace(/[\s,.;:]+$/, '');
          }
          lines[max - 1] = last + '…';
        }
        return { lines: lines, size: size, lineHeight: lh, font: font, height: lines.length * lh };
      }
      size -= 2;
    }
  }

  /* The block carries the font it was MEASURED in, and this sets it again
     before drawing. Those were two different faces once — measuring happens in
     layout(), drawing happens after the author row has set ctx.font to Oxygen,
     and canvas has no notion of a style that belongs to a run of text — so
     every body on every card came out in the handle's sans at the serif's
     leading, which looks like a design decision until you hold it next to the
     app. Keep the font on the block; never rely on what ctx was last told. */
  function drawParagraph(ctx, block, x, y, colour) {
    ctx.font = block.font;
    ctx.fillStyle = colour;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    block.lines.forEach(function (line, i) {
      /* Baseline inside the line box, near enough to how a browser sets it:
         both fonts sit with roughly a quarter of the leading under the text. */
      ctx.fillText(line, x, y + i * block.lineHeight + block.lineHeight * 0.76);
    });
  }

  /* ---- Images ----------------------------------------------------------- */

  function loadImage(src, cors) {
    return new Promise(function (resolve) {
      if (!src) return resolve(null);
      const img = new Image();
      /* Supabase Storage is a different origin, and a tainted canvas cannot be
         read back at all — toBlob throws rather than returning a watermarked
         anything. Ask for CORS, and if the bucket refuses, resolve null and
         draw the plate: a card without the photo still carries the words. */
      if (cors) img.crossOrigin = 'anonymous';
      /* A LOADED IMAGE WITH NO SIZE IS NOT A LOADED IMAGE (2026-09-23). It
         happens — a refused cross-origin fetch that still fires `load`, a
         zero-length body — and it is worse than an error, because every caller
         here takes a non-null image as "draw this": drawCover then divides by
         zero, hands drawImage an infinite rectangle, and the canvas spec says
         to do nothing at all. Seen in the app as a profile card with an empty
         ring where the face goes, and no initial either, since the fallback
         had been skipped. Null is the honest answer and the fallbacks are
         already written for it. */
      img.onload = function () {
        if (!img.naturalWidth || !img.naturalHeight) return resolve(null);
        /* AND `load` IS NOT `READY TO DRAW`. decode() is, and it is the only
           promise that says the pixels exist: drawImage on an image that has
           loaded but not decoded draws nothing, throws nothing and leaves an
           empty ring where a face goes. Twice in the simulator, on the first
           run after an install, and not reproducible on demand — which is the
           other reason to ask rather than to hope. */
        if (!img.decode) return resolve(img);
        img.decode().then(function () { resolve(img); },
                          function () { resolve(null); });
      };
      img.onerror = function () { resolve(null); };
      img.src = src;
    });
  }

  function drawCover(ctx, img, x, y, w, h) {
    const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
    const dw = img.naturalWidth * scale, dh = img.naturalHeight * scale;
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }

  /* ---- Metrics ---------------------------------------------------------- */

  /* One column measured three ways. `safeTop` / `safeBottom` are Instagram's
     chrome and are zero everywhere the card is not a story. */
  const SIZES = {
    story:  { w: 1080, h: 1920, safeTop: 250, safeBottom: 340, margin: 100, radius: 56,
              pad: 84, padBottom: 64, gap: 76,
              avatar: 84, name: 36, handle: 31, body: 76, bodyMin: 40, caption: 58,
              prompt: 42, mark: 70, address: 29, rowGap: 48 },
    square: { w: 1080, h: 1080, safeTop: 0, safeBottom: 0, margin: 72, radius: 52,
              pad: 76, padBottom: 76, gap: 56,
              avatar: 82, name: 35, handle: 30, body: 68, bodyMin: 36, caption: 50,
              prompt: 38, mark: 66, address: 27, rowGap: 48 },
    /* The link card is the one nobody chooses — it is what Messages and Slack
       unfurl — so it is the same column laid on its side and nothing more. */
    link:   { w: 1200, h: 630, safeTop: 0, safeBottom: 0, margin: 56, radius: 40,
              pad: 56, padBottom: 48, gap: 36,
              avatar: 64, name: 28, handle: 24, body: 46, bodyMin: 26, caption: 36,
              prompt: 28, mark: 54, address: 23, rowGap: 32 },
  };

  /* ---- Backgrounds ------------------------------------------------------ */

  const BACKDROPS = ['gradient', 'accent', 'light', 'dark'];

  function backdrop(ctx, spec, m) {
    const w = m.w, h = m.h;
    const accent = spec.accent || TYPE.note[0];
    let paper;

    /* The wash's radii are CSS's `120% 78%`: WIDER than the card it sits behind,
       on purpose, so it reads as light falling across the whole backdrop rather
       than as a halo around the sticker. They were half this once, which put the
       entire gradient behind the card where nobody could see it and made every
       coloured background look flat. */
    const PAPER_RGB = '237, 238, 240', INK_RGB = '233, 235, 237';
    const cx = w * 0.5, cy = h * 0.34, rx = w * 1.2, ry = h * 0.78;

    /* BARE leaves the canvas transparent and draws only the card, which is what
       goes to Instagram. Their share API takes the card as a STICKER and the
       background as two colours it gradients between itself, on a layer the
       sender can move the sticker around on. Painting our own background into
       the sticker would cover theirs and turn a draggable card into a flat
       screenshot.

       Still 1080x1920, deliberately, rather than cropped to the card: a sticker
       at story dimensions is placed to fill, so the card lands exactly where the
       layout put it, safe zones and all. A tight crop would be centred by
       Instagram and lose that. */
    const bare = !!spec.bare;
    const fill = (style) => {
      if (bare) return;
      ctx.fillStyle = style;
      ctx.fillRect(0, 0, w, h);
    };
    const lift = (rgb, alpha) => { if (!bare) wash(ctx, w, h, cx, cy, rx, ry, rgb, alpha); };

    if (spec.bg === 'dark') {
      paper = Object.assign({}, DARK);
      fill(DARK.page);
      lift(INK_RGB, 0.07);
      paper.shadow = 'rgba(0, 0, 0, 0.55)';
    } else if (spec.bg === 'light') {
      /* The one background with no wash at all. Light IS the plain option, and
         a lift on it just makes the paper look dirty. */
      paper = Object.assign({}, LIGHT);
      fill(LIGHT.page);
      paper.shadow = 'rgba(20, 23, 26, 0.12)';
    } else if (spec.bg === 'accent') {
      paper = Object.assign({}, TRIA);
      fill(accent);
      lift(PAPER_RGB, 0.42);
      paper.shadow = 'rgba(20, 23, 26, 0.2)';
    } else {
      paper = Object.assign({}, TRIA);
      fill(linearGradient(ctx, 160, w, h, bandStops(false)));
      lift(PAPER_RGB, 0.38);
      paper.shadow = 'rgba(20, 23, 26, 0.2)';
    }
    return paper;
  }

  /* THE TWO COLOURS INSTAGRAM WILL GRADIENT BETWEEN, behind the sticker. Two,
     not four, which is their API and not a simplification made here — so Tria's
     own ramp cannot cross over as itself and something has to choose. It takes
     the ENDS of the ramp (lavender to peach, the order it already runs in)
     rather than a middle pair, so the sweep behind the card reads as the whole
     brand rather than a slice of it.

     A reader's own accent is a flat field in both stops. It is one colour by
     definition; faking a gradient out of it would invent a second colour they
     never picked. */
  function backgroundPair(spec) {
    const accent = spec.accent || (TYPE[spec.type] || TYPE.note)[0];
    if (spec.bg === 'dark') return [DARK.page, DARK.page];
    if (spec.bg === 'light') return [LIGHT.page, LIGHT.page];
    if (spec.bg === 'accent') return [accent, accent];
    const stops = bandStops(false);
    return [stops[0], stops[stops.length - 1]];
  }

  /* ---- The card --------------------------------------------------------- */

  /* Everything above measures; this is the only function that decides. A card
     is a stack of blocks with ONE flexible member (the photo plate), so the
     rest are measured first and the plate takes what is left. That ordering is
     what keeps the card inside the safe band no matter how long the caption
     runs — the alternative, a fixed plate with the text shrinking under it, put
     the address under Instagram's reply bar on the third test caption. */
  function layout(ctx, spec, m) {
    const kind = spec.kind || 'note';
    const cardW = m.w - m.margin * 2;
    /* On the photo card the plate runs to the card's own padding while the text
       is inset further, so the words line up with the story's other cards and
       the picture still reads as the biggest thing on it. */
    const plated = kind === 'photo';
    const sidePad = plated ? Math.round(m.pad / 3) : m.pad;
    const inner = cardW - sidePad * 2;
    const textPad = plated ? m.pad - sidePad : 0;
    const textW = inner - textPad * 2;

    /* Every block carries the gap that follows it, so the height measured here
       and the height actually drawn are the same sum in the same order. They
       used to be two hand-kept tallies and they drifted by one gap on the
       profile card, which is the sort of bug that only shows up as "the mark
       sits a bit low". */
    const blocks = [];
    const markH = Math.round(m.mark * 0.623);
    const authorH = m.avatar;
    const band = m.h - m.safeTop - m.safeBottom;
    const fixed = m.pad + authorH + m.rowGap + m.gap + markH + m.padBottom;
    const budget = band - fixed;
    const spent = function () {
      return blocks.reduce(function (n, b) { return n + b.height + b.after; }, 0);
    };

    if (kind === 'daily') {
      /* The prompt sits ABOVE the answer, quiet and italic, because a daily
         answer read without its question is a non sequitur. */
      const prompt = paragraph(ctx, spec.prompt || '', {
        size: m.prompt, minSize: Math.round(m.prompt * 0.8), lineHeight: 1.3,
        maxWidth: textW, maxHeight: m.prompt * 1.3 * 3, italic: true,
      });
      blocks.push({ type: 'prompt', block: prompt, height: prompt.height,
                    after: Math.round(m.rowGap * 0.66) });
    }

    if (kind === 'photo') {
      const caption = spec.text ? paragraph(ctx, spec.text, {
        size: m.caption, minSize: Math.round(m.caption * 0.7), lineHeight: 1.22,
        maxWidth: textW, maxHeight: m.caption * 1.22 * 3,
      }) : null;
      /* The plate is square and takes what nobody else claimed, capped by the
         width it has. It is measured LAST and pushed first. */
      const left = budget - (caption ? caption.height + m.gap : 0);
      const side = Math.max(320, Math.min(inner, Math.floor(left)));
      blocks.push({ type: 'plate', side: side, width: inner, height: side,
                    after: caption ? m.gap : 0 });
      if (caption) blocks.push({ type: 'caption', block: caption, height: caption.height, after: 0 });
    } else {
      const body = paragraph(ctx, spec.text || '', {
        size: m.body, minSize: m.bodyMin, lineHeight: 1.2,
        maxWidth: textW, maxHeight: budget - spent(),
      });
      blocks.push({ type: 'body', block: body, height: body.height, after: 0 });
    }

    const height = fixed + spent();
    /* Centred in what Instagram leaves, never above it. */
    const top = Math.max(m.safeTop, Math.round(m.safeTop + (band - height) / 2));
    return { blocks: blocks, cardW: cardW, sidePad: sidePad, textPad: textPad, textW: textW,
             inner: inner, height: height, top: top, left: m.margin,
             authorH: authorH, markH: markH };
  }

  async function render(spec) {
    spec = spec || {};
    const m = SIZES[spec.size] || SIZES.story;
    /* No accent set is the COMMON case, not the fallback one: most readers
       never pick a colour, so the type's own pastel is what the disc wears. */
    const accent = spec.accent || (TYPE[spec.type] || TYPE.note)[0];

    const canvas = document.createElement('canvas');
    canvas.width = m.w; canvas.height = m.h;
    const ctx = canvas.getContext('2d');

    const author = spec.author || {};
    await fonts(spec, m);

    /* THE PROFILE CARD HAS NO CARD ON IT, so it leaves before any of the
       furniture below is measured. See "THE CARD IS THE CODE". */
    if (spec.kind === 'profile') {
      /* BARE DOES NOT APPLY TO THIS ONE, and it is the only place the sticker
         rule bends. A bare card is transparent so that Instagram's own
         background layer shows through it and the card travels as something the
         sender can drag around. This card's LIGHT MODULES ARE THAT BACKGROUND:
         hand Instagram a transparent one and the quiet zone becomes whichever
         layer they put behind it, which the sender can then change to anything
         at all, including something a near-black code has nothing to read
         against. So the profile card paints its paper for Instagram too and
         goes over as a full 1080x1920 sticker that covers their layer rather
         than sitting on it.

         AND THE PAPER IS PAPER, whatever was asked for. The four backgrounds
         were a choice this card no longer offers (Zoe, 2026-09-23): the colour
         on it is the reader's own and it is in the CODE, and a coloured field
         behind a coloured code is two answers to one question. Tria's paper,
         always, so the picture is the same one every time anybody sends it. */
      const paper = backdrop(ctx, Object.assign({}, spec, { bg: CODE_PAPER, bare: false }), m);
      const band = m.h - m.safeTop - m.safeBottom;
      /* A SIZE WITH NO SAFE BAND has no vertical room reserved for it — the band
         IS the canvas there — so the page margin stands in for one at the top
         and the bottom too, and the square comes out square. On a story the
         safe band is already that margin, and the code takes all of it. */
      const room = band - (m.safeTop ? 0 : m.margin * 2);
      const grid = modules(spec);
      let side = codeSide(m.w - m.margin * 2, room, true);
      /* WHOLE PIXELS PER MODULE here as well, now that a module is a shape and
         not a rectangle: at a fractional unit every rounded corner lands on a
         different subpixel and the code loses dark area unevenly across itself.
         It costs at most a module's worth of side. */
      if (grid) side = Math.floor(side / (grid.length + QUIET * 2)) * (grid.length + QUIET * 2);
      const p = codeParts(side, true);
      p.grid = grid;
      const [face, mark] = await Promise.all([
        loadImage(author.avatar, true),
        loadImage(WORDMARK, false),
      ]);
      drawCode(ctx, spec, paper, p, Math.round((m.w - p.side) / 2),
               m.safeTop + Math.round((band - p.height) / 2), face, mark);
      return canvas;
    }

    const [mark, avatar, photo] = await Promise.all([
      loadImage(WORDMARK, false),
      loadImage(author.avatar, true),
      loadImage(spec.kind === 'photo' ? spec.photo : null, true),
    ]);

    const paper = backdrop(ctx, Object.assign({}, spec, { accent: accent }), m);
    const L = layout(ctx, spec, m);

    /* The card, with its drop shadow. Canvas puts a shadow on the NEXT fill, so
       it is turned off immediately after or every glyph on the card gets one. */
    ctx.save();
    ctx.shadowColor = paper.shadow;
    ctx.shadowBlur = Math.round(m.w * 0.089);
    ctx.shadowOffsetY = Math.round(m.w * 0.041);
    roundRect(ctx, L.left, L.top, L.cardW, L.height, m.radius);
    ctx.fillStyle = paper.card;
    ctx.fill();
    ctx.restore();

    ctx.save();
    roundRect(ctx, L.left, L.top, L.cardW, L.height, m.radius);
    ctx.clip();

    const x = L.left + L.sidePad;
    const tx = x + L.textPad;
    let y = L.top + m.pad;

    /* WHO. The attribution leads, on every card — a card that opens with the
       writing and names its writer underneath reads as a quote graphic, which
       is exactly the thing Tria is not. */
    drawAuthor(ctx, tx, y, m, author, avatar, accent, paper, L.authorH);
    y += L.authorH + m.rowGap;

    /* WHAT. Each block draws at y and then advances by its own measured height
       plus the gap the layout said follows it. */
    L.blocks.forEach(function (b) {
      if (b.type === 'prompt') {
        drawParagraph(ctx, b.block, tx, y, paper.muted);
      } else if (b.type === 'body' || b.type === 'caption') {
        drawParagraph(ctx, b.block, tx, y, paper.ink);
      } else if (b.type === 'plate') {
        const px = x + (b.width - b.side) / 2;
        ctx.save();
        roundRect(ctx, px, y, b.side, b.side, Math.round(m.radius * 0.64));
        ctx.clip();
        if (photo) drawCover(ctx, photo, px, y, b.side, b.side);
        else {
          ctx.fillStyle = paper.plate;
          ctx.fillRect(px, y, b.side, b.side);
          ctx.fillStyle = paper.muted;
          ctx.font = sans(Math.round(m.address));
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('[ the photo ]', px + b.side / 2, y + b.side / 2);
          ctx.textAlign = 'left';
          ctx.textBaseline = 'alphabetic';
        }
        ctx.restore();
      }
      y += b.height + b.after;
    });

    /* WHERE. The wordmark and the address, on their own row at the foot. The
       mark is the real file (icons/wordmark.svg, the same ink the app wears)
       and it is small on purpose: the reader's post is the content, and this is
       a signature, not a banner. */
    const markH = L.markH;   /* the file is 1650 x 1028 */
    const fy = L.top + L.height - m.padBottom - markH;
    if (mark) {
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.drawImage(mark, tx, fy, m.mark, markH);
      ctx.restore();
    }
    ctx.fillStyle = paper.muted;
    ctx.font = sans(m.address);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(spec.address || 'triaonline.com', tx + L.textW, fy + markH / 2);
    ctx.textAlign = 'left';

    ctx.restore();
    return canvas;
  }

  /* THE DISC, which is the one piece two compositions share: the card's
     attribution row and the code's column both open with it.

     `rim` is the code column's, and it is not decoration. A reader with no
     photo gets their own colour in the disc, and the profile card's background
     is that same colour on one of the four backgrounds and a ramp containing it
     on another — on both, an unrimmed disc vanishes into the paper and the
     initial floats. The rim is the paper the card used to be made of. */
  function disc(ctx, x, y, d, author, avatar, accent, rim) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x + d / 2, y + d / 2, d / 2, 0, Math.PI * 2);
    ctx.clip();
    if (avatar) drawCover(ctx, avatar, x, y, d, d);
    else {
      /* No photo, so the disc wears the reader's colour and their initial in
         the app's own lettering — the same fallback the tiles use. */
      ctx.fillStyle = accent;
      ctx.fillRect(x, y, d, d);
      ctx.fillStyle = inkOn(accent);
      ctx.font = serif(Math.round(d * 0.5));
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText((author.name || author.username || '?').trim().charAt(0).toUpperCase(),
                   x + d / 2, y + d / 2 + d * 0.02);
      ctx.textAlign = 'left';
    }
    ctx.restore();

    if (rim) {
      ctx.save();
      ctx.beginPath();
      ctx.lineWidth = Math.max(2, Math.round(d * 0.035));
      ctx.arc(x + d / 2, y + d / 2, (d - ctx.lineWidth) / 2, 0, Math.PI * 2);
      ctx.strokeStyle = rim;
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawAuthor(ctx, x, y, m, author, avatar, accent, paper, d) {
    disc(ctx, x, y, d, author, avatar, accent);

    const name = m.name, handle = m.handle;
    const nx = x + d + Math.round(m.rowGap / 2);
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = paper.ink;
    ctx.font = sans(name, true);
    ctx.fillText(author.name || '@' + (author.username || ''), nx, y + d / 2 - Math.round(handle * 0.2));
    ctx.fillStyle = paper.muted;
    ctx.font = sans(handle);
    ctx.fillText('@' + (author.username || ''), nx, y + d / 2 + handle);
  }

  /* THE QR, which is the one thing on a card that has to be CORRECT rather than
     merely handsome. The encoder is a vendored file (js/vendor/qr.js, byte mode,
     level M, versions 1 to 6), it is shared with invites, and every version in
     it was round-tripped through a real decoder rather than eyeballed. Where
     there is no encoder on the page — an older bundle, a host that loads this
     file on its own — the address is printed in the space the code would have
     taken, because a decorative QR that does not scan is worse than no QR at
     all: it is a promise the card cannot keep.

     THE QUIET ZONE is four modules, the spec's minimum, and it is part of the
     code rather than part of the design: it is what tells a camera where the
     code stops. It is measured INSIDE the side asked for, so anything that
     reserves room for a code has reserved its quiet zone with it.

     NO PLATE (Zoe, 2026-09-22). The code used to sit on a white slab of its
     own, and that slab was the fourth rounded rectangle in a stack of four:
     sheet, background, card, plate, code. Every one of those edges was drawn to
     separate things that were not different. So the plate came off with the
     card, and the modules are painted in THE PAPER'S OWN INK straight onto the
     background.

     WHICH MEANS THE QUIET ZONE AND THE LIGHT MODULES ARE THE BACKGROUND, and
     that is the part that had to be measured rather than trusted: a scanner
     reads contrast, and ours is now whatever the paper happens to be. It is
     `paper.ink` in every case, which is the same sentence as "white, or black
     where the paper is light", because three of the four backgrounds are light
     — Tria's ramp is deepened pastel under a paper wash, a reader's colour is a
     pastel under a heavier one, and Light is Light. Only Dark takes a white
     code, and a white-on-black code is one a decoder has to be willing to
     invert. All four, at both scales, went through Vision before this shipped;
     the numbers are in docs/social-links.md. */
  const QUIET = 4;
  let encoder = null;
  const encoderFor = () => encoder || (window.QR && window.QR.encode) || null;

  /* The modules for a spec, or null if there is nothing to encode or nothing to
     encode it with. A throw here is the long-payload case and it is HANDLED,
     not propagated: js/vendor/qr.js refuses past 106 bytes rather than emitting
     a code that cannot be read, and a card that loses its QR is still a card. */
  function modules(spec) {
    const url = (spec && (spec.qrUrl || spec.address)) || '';
    const encode = encoderFor();
    if (!url || !encode) return null;
    try { return encode(url); } catch (e) { return null; }
  }

  /* BLACK AND WHITE ONLY (Zoe, 2026-09-23). The code was drawn in the reader's
     own colour for a day, deepened until it cleared 4.5 against the paper, and
     all nine of the palette read perfectly well. It is out because a code in a
     pastel deepened to olive is not that reader's colour any more — it is a
     dark green that started as lime — so the card was spending its one colour
     on something nobody would recognise as theirs. The ink is the paper's:
     black on paper, white on Dark. */
  function drawQR(ctx, x, y, side, spec, paper, grid) {
    const cells = grid || modules(spec);

    ctx.save();
    if (!cells) {
      ctx.fillStyle = paper.muted;
      ctx.font = sans(Math.round(side * 0.06));
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(spec.qrUrl || spec.address || 'triaonline.com', x + side / 2, y + side / 2);
      ctx.restore();
      return y + side;
    }

    const n = cells.length, unit = side / (n + QUIET * 2);
    const on = function (r, c) {
      return r >= 0 && c >= 0 && r < n && c < n && !!cells[r][c];
    };
    /* ROUNDED, AND ROUNDED BY NEIGHBOUR (Zoe, 2026-09-22). A corner is only
       softened where the two modules that would have met it are empty, so a run
       of dark modules stays one solid shape with rounded ENDS and a lone module
       comes out a dot. The alternative — every module its own rounded dot, the
       look most "styled" codes go for — throws away the dark area at each shared
       edge, and dark area is the whole of what a scanner has to work with.

       This shape keeps the finder patterns square-cornered on the inside and
       soft on the outside, which leaves the 1:1:3:1:1 run a decoder scans for
       across the middle of them exactly as long as it was. */
    const R = unit * 0.5;
    ctx.fillStyle = paper.ink;
    /* ONE PATH, ONE FILL, rather than a fill per module: the rasteriser then
       works out coverage for the union, and two modules that share an edge have
       no seam between them at all. Filling them one at a time antialiases both
       sides of every shared edge and leaves a grid of pale hairlines through the
       code, which is what this used to do and what ceil() was papering over. */
    ctx.beginPath();
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (!cells[r][c]) continue;
        const up = on(r - 1, c), dn = on(r + 1, c), lf = on(r, c - 1), rt = on(r, c + 1);
        modulePath(ctx, x + (c + QUIET) * unit, y + (r + QUIET) * unit, unit,
                   (up || lf) ? 0 : R, (up || rt) ? 0 : R,
                   (dn || rt) ? 0 : R, (dn || lf) ? 0 : R);
      }
    }
    ctx.fill();
    ctx.restore();
    return y + side;
  }

  /* One module, as a subpath on the path already open. Four radii, any of them
     zero, and arcTo rather than roundRect's array form because this has to draw
     the same on an OS a year older than that. */
  function modulePath(ctx, x, y, u, tl, tr, br, bl) {
    ctx.moveTo(x + tl, y);
    ctx.arcTo(x + u, y, x + u, y + u, tr);
    ctx.arcTo(x + u, y + u, x, y + u, br);
    ctx.arcTo(x, y + u, x, y, bl);
    ctx.arcTo(x, y, x + u, y, tl);
    ctx.closePath();
  }

  /* ── THE CARD IS THE CODE ────────────────────────────────────────────────
     One composition, drawn twice: as the profile card that saves, and as the
     panel the share sheet holds up. A disc, a name, a handle, the code, and on
     the card the address under it. Nothing else, and nothing behind it.

     WHY IT IS NOT THE CARD LAYOUT ABOVE. Every other card is a slab of paper
     with a column of blocks on it, because a post is a thing someone wrote and
     the slab is what makes it a quote rather than a screenshot. A profile is
     not a thing someone wrote. What is being shared is a way in, and the card
     around it was one more edge between a camera and the only part of the
     picture that does anything.

     THE MEASURE IS THE CODE. Every size here is a fraction of the code's side,
     so the card and the panel are the same drawing at two scales and neither
     has a layout of its own. The code takes whichever is smaller, the width it
     is given or what the height leaves — on a story that is the height, 822 of
     the 880 pixels the page margin allows.

     WHOLE DEVICE PIXELS PER MODULE, on the panel, and it is not a refinement. A
     canvas scaled to a phone's width puts every module edge on a fractional
     pixel and the browser antialiases each one into its neighbours on all four
     sides; a camera reading contrast is the single audience that cannot forgive
     that. So the panel's unit is floored to whole device pixels FIRST and its
     side is whatever that comes to. The card cannot work that way — it is 1080
     pixels wide whatever it is shown at — and does not need to: nobody scans it
     off a screen. */

  /* Fractions of the code's side, and there are only three of them: the header
     over it, the air between, and the address under it on the card. */
  const CODE = { head: 0.30, lead: 0.09, foot: 0.065, address: 0.046, line: 1.2,
                 markGap: 0.05, mark: 0.125 };
  /* icons/wordmark.svg is 1650 x 1028. */
  const MARK_TALL = 1028 / 1650;
  /* The one paper this card is drawn on. It is Tria's own, not the device's:
     a picture whose colours moved with the sender's system setting is a picture
     nobody can predict, and that rule is older than this card (see the head of
     this file). */
  const CODE_PAPER = 'light';

  /* THE HEADER IS THE PROFILE PAGE'S OWN (Zoe, 2026-09-23), shrunk. Photo left
     in a circle with the app's hairline around it, the name beside it in
     Instrument Serif, the handle under that in muted sans, one left axis
     centred against the photo. The ratios are `.account-head`'s, measured off
     css/app.css at a 375pt page: a 128px photo, a 20.6px name, a 14.7px handle,
     a 1.2rem gap.

     THE FLOORS ARE THE PANEL'S and they are the one thing the page has no
     equivalent of. The header scales with the code, and on a phone's sheet the
     code is a quarter of the size it is on the card — proportion alone puts the
     handle at eight points, which is a caption on a picture rather than a line
     of the app. So the two type sizes have a floor in CSS pixels, and only the
     panel ever reaches it. The floors cannot change the header's HEIGHT, which
     is the photo's: the text column is shorter than the disc either way. */
  const HEAD = {
    name: 0.17, handle: 0.115, gap: 0.15, tuck: 0.015, line: 1.05,
    minName: 15, minHandle: 11,
  };

  /* Column height over code side, in two parts so a caller can SOLVE for a side
     that fits a height it has. The answer is a hair optimistic — the roundings
     do not add up to the sum of the fractions — so codeSide checks it. */
  const CODE_TALL = 1 + CODE.head + CODE.lead;
  const CODE_FOOT = CODE.foot + CODE.address * CODE.line
                  + CODE.markGap + CODE.mark * MARK_TALL;

  /* The column's parts at a given code side, in whole pixels, measured in one
     place so the height reserved and the height drawn are the same sum in the
     same order. They used to be two hand-kept tallies on the card and they
     drifted by one gap.

     `address` is the card's foot line, and the panel does not carry it: the
     handle in the header is where you are, a sheet is not a thing a stranger
     screenshots, and the line costs the panel ten per cent of the code.

     `px` is how many pixels of this canvas make one CSS pixel — the panel's
     device ratio, and 1 on a card, which is a picture and has no such thing. */
  function codeParts(side, address, px) {
    const r = function (f) { return Math.round(side * f); };
    const unit = px || 1;
    const p = {
      side: side, head: r(CODE.head), lead: r(CODE.lead),
      foot: address ? r(CODE.foot) : 0,
      address: address ? r(CODE.address) : 0,
      markGap: address ? r(CODE.markGap) : 0,
      markW: address ? r(CODE.mark) : 0,
    };
    p.markH = Math.round(p.markW * MARK_TALL);
    p.gap = Math.round(p.head * HEAD.gap);
    p.tuck = Math.round(p.head * HEAD.tuck);
    p.name = Math.max(Math.round(p.head * HEAD.name), Math.round(HEAD.minName * unit));
    p.handle = Math.max(Math.round(p.head * HEAD.handle), Math.round(HEAD.minHandle * unit));
    p.nameLine = Math.round(p.name * HEAD.line);
    p.handleLine = Math.round(p.handle * CODE.line);
    p.addressLine = Math.round(p.address * CODE.line);
    p.above = p.head + p.lead;
    p.below = p.foot + p.addressLine + p.markGap + p.markH;
    p.height = p.above + side + p.below;
    return p;
  }

  /* The biggest code that fits a box, walked down from the arithmetic rather
     than trusted to it. */
  function codeSide(width, height, address) {
    const tall = CODE_TALL + (address ? CODE_FOOT : 0);
    let side = Math.min(width, Math.floor(height / tall));
    while (side > 60 && codeParts(side, address).height > height) side -= 1;
    return side;
  }

  /* Paint what codeParts measured, with the column's top-left at (x, y). */
  function drawCode(ctx, spec, paper, p, x, y, avatar, mark) {
    const author = spec.author || {};
    const handle = '@' + (author.username || '');
    const name = author.name || handle;

    /* WHO, and it is the page's header rather than a card's attribution row: on
       a card the name leads and the face is a token beside it, on a profile the
       FACE leads. This picture is a profile. */
    ctx.save();
    const room = p.side - p.head - p.gap;
    ctx.font = serif(p.name);
    const nameW = ctx.measureText(name).width;
    ctx.font = sans(p.handle);
    const handleW = ctx.measureText(handle).width;
    /* The photo and the two lines are CENTRED AS ONE GROUP over the code, which
       is the one thing here the page does differently: on the page the header
       shares a left axis with a feed under it, and here it sits over a centred
       square with nothing else to line up with. */
    const wide = Math.min(Math.max(nameW, handleW), room);
    const hx = x + Math.round((p.side - (p.head + p.gap + wide)) / 2);
    headshot(ctx, hx, y, p.head, author, avatar, paper);

    const tx = hx + p.head + p.gap;
    const block = p.nameLine + p.tuck + p.handleLine;
    let ty = y + Math.round((p.head - block) / 2);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = paper.ink;
    ctx.font = serif(p.name);
    ctx.fillText(oneLine(ctx, name, room), tx, ty + p.nameLine / 2);
    ty += p.nameLine + p.tuck;
    ctx.fillStyle = paper.muted;
    ctx.font = sans(p.handle);
    ctx.fillText(oneLine(ctx, handle, room), tx, ty + p.handleLine / 2);
    ctx.restore();

    const qy = y + p.above;
    drawQR(ctx, x, qy, p.side, spec, paper, p.grid);

    if (p.addressLine) {
      /* WHERE, SPELLED OUT, on the card only. A card travels as a picture: the
         person looking at it in a story cannot tap it and may not scan it, so
         the one thing that can be typed goes on in full. */
      ctx.save();
      ctx.fillStyle = paper.muted;
      ctx.font = sans(p.address);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(spec.address || 'triaonline.com',
                   x + p.side / 2, qy + p.side + p.foot + p.addressLine / 2);
      ctx.restore();

      /* WHOSE APP, at the foot, and it is the real file — icons/wordmark.svg,
         the same lettering the app wears. The address says where to go and the
         mark says where you are going; a picture that travels off Tria needs
         both, and this card is the one that travels furthest. */
      if (mark) {
        ctx.save();
        ctx.globalAlpha = 0.9;
        ctx.drawImage(mark, x + Math.round((p.side - p.markW) / 2),
                      y + p.height - p.markH, p.markW, p.markH);
        ctx.restore();
      }
    }
  }

  /* `.account-photo`, copied: the circle, the hairline at 12% of the ink, and
     the empty state, which is --surface-2 with the initial in the serif at 32%.
     It takes no accent, unlike the post card's disc — on this card the reader's
     colour is in the code, and a coloured disc beside it would be the same
     claim made twice in two weights. */
  function headshot(ctx, x, y, d, author, avatar, paper) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x + d / 2, y + d / 2, d / 2, 0, Math.PI * 2);
    ctx.clip();
    if (avatar) drawCover(ctx, avatar, x, y, d, d);
    else {
      ctx.fillStyle = paper.plate;
      ctx.fillRect(x, y, d, d);
      ctx.globalAlpha = 0.32;
      ctx.fillStyle = paper.ink;
      ctx.font = serif(Math.round(d * 0.46));
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText((author.name || author.username || '?').trim().charAt(0).toUpperCase(),
                   x + d / 2, y + d / 2 + d * 0.02);
    }
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.strokeStyle = paper.ink;
    ctx.lineWidth = Math.max(1, Math.round(d * 0.008));
    ctx.beginPath();
    ctx.arc(x + d / 2, y + d / 2, (d - ctx.lineWidth) / 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /* One line, shrunk by the caller and truncated here if it is still too long. */
  function oneLine(ctx, text, maxWidth) {
    let s = String(text || '');
    if (ctx.measureText(s).width <= maxWidth) return s;
    while (s.length > 1 && ctx.measureText(s + '…').width > maxWidth) s = s.slice(0, -1);
    return s.replace(/[\s,.]+$/, '') + '…';
  }

  /* The panel's arithmetic with nothing drawn, so the sheet can reserve the
     space before the first paint rather than stand up under a finger. Null
     means there is no code to be had, and the caller falls back to the card.
     Sizes are DEVICE pixels; `css` is what the element wears. */
  function codeBox(spec, opt) {
    const grid = modules(spec || {});
    if (!grid) return null;
    const dpr = Math.max(1, Math.min(3, (opt && opt.dpr) || window.devicePixelRatio || 1));
    const n = grid.length + QUIET * 2;
    /* THE PANEL FILLS THE FRAME IT IS GIVEN (Zoe, 2026-09-23). It used to
       shrink-wrap the code, which left a card narrower than every row under it
       floating in the middle of the sheet: the paper stopped in a different
       place from Save image and Copy link for no reason anybody could see. So
       the width is the frame's, the code is centred in it, and the sheet is one
       column of things the same width.

       ITS PADDING IS MEASURED TO THE INK, not to the plate: the code's own
       quiet zone is four modules of white inside the side asked for, so padding
       the plate pads it twice and the code floats high with a white shelf under
       it. The foot gives the quiet zone back; the top cannot, because a
       photograph starts where it starts — which is why the top has a smaller
       number of its own (Zoe, 2026-09-23). Set to the same fraction as the
       others it is the biggest gap on the panel, since it is the only edge
       paying full price, and the sheet reads as a card with a dent in the top
       of it.

       Solved, floored to whole pixels per module, and then CHECKED, because the
       solve is in fractions and the drawing is in rounded pixels. The first
       guess is optimistic, since the loop only ever walks down. */
    const PAD = 0.11, PAD_TOP = 0.06;
    const wide = Math.round((opt.width || 0) * dpr), tall = (opt.maxHeight || 0) * dpr;
    const room = Math.min(wide, tall / (CODE_TALL + PAD_TOP));
    let unit = Math.max(2, Math.floor(room / n));
    let side, parts, pad, foot;
    for (;;) {
      side = unit * n;
      parts = codeParts(side, false, dpr);   /* dpr, so the type floors are CSS pixels */
      pad = Math.round(side * PAD_TOP);
      foot = Math.max(0, Math.round(side * PAD) - QUIET * unit);
      if (unit <= 2 || (side <= wide && parts.height + pad + foot <= tall)) break;
      unit -= 1;
    }
    const w = Math.max(wide, side), h = parts.height + pad + foot;
    return { grid: grid, unit: unit, side: side, x: Math.round((w - side) / 2), top: pad,
             parts: parts, dpr: dpr,
             w: w, h: h, css: { width: w / dpr, height: h / dpr } };
  }

  /* Draw the box codeBox measured. Async for the face and the avatar: the type
     is Oxygen and a font declared `font-display: swap` has not been fetched
     until something asks to paint with it, so an unasked panel draws its name
     in the system sans exactly once. */
  function code(spec, box) {
    if (!box) return Promise.resolve(null);
    spec = spec || {};
    const author = spec.author || {};
    const text = (author.name || '') + ' @' + (author.username || '');

    const canvas = document.createElement('canvas');
    canvas.width = box.w; canvas.height = box.h;
    canvas.style.width = box.css.width + 'px';
    canvas.style.height = box.css.height + 'px';
    const ctx = canvas.getContext('2d');

    return Promise.all([
      face(serif(box.parts.name), text),
      face(sans(box.parts.handle), text),
      loadImage(author.avatar, true),
    ]).then(function (got) {
      const paper = backdrop(ctx, Object.assign({}, spec, { bg: CODE_PAPER }),
                             { w: box.w, h: box.h });
      const p = Object.assign({}, box.parts, { grid: box.grid });
      drawCode(ctx, spec, paper, p, box.x, box.top, got[2]);
      return canvas;
    });
  }


  /* Both families are subsetted by unicode-range and declared `font-display:
     swap`, which means the browser has not fetched a single byte until
     something asks to paint with them. `document.fonts.ready` alone is not that
     ask — it resolves happily with nothing loaded — so each face is requested
     by name AND by the text it will draw, or an accented name silently falls
     back to Times on the one card that carries it. */
  function face(font, text) {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    return document.fonts.load(font, text).catch(function () {})
      .then(function () { return document.fonts.ready; });
  }

  function fonts(spec, m) {
    const text = [spec.text, spec.prompt, (spec.author || {}).name,
                  (spec.author || {}).username, spec.address].filter(Boolean).join(' ')
                 + ' triaonline.com@';
    const faces = [
      serif(m.body), serif(m.prompt, true), sans(m.name, true), sans(m.handle), sans(m.address),
    ];
    return Promise.all(faces.map(function (f) { return face(f, text); }));
  }

  function toBlob(spec, type) {
    return render(spec).then(function (canvas) {
      return new Promise(function (resolve, reject) {
        canvas.toBlob(function (b) {
          /* A null blob here is almost always a tainted canvas: a photo came
             from a bucket that sent no CORS header. Say which, because the
             browser's own message for it is a bare SecurityError. */
          b ? resolve(b) : reject(new Error('The card could not be read back. A photo on it came from somewhere that did not allow it.'));
        }, type || 'image/png');
      });
    });
  }

  window.StoryCard = {
    render: render,
    toBlob: toBlob,
    /* The share sheet's profile panel: measure first, then draw what was
       measured. See "THE CARD IS THE CODE". */
    codeBox: codeBox,
    code: code,
    SIZES: SIZES,
    BACKDROPS: BACKDROPS,
    bandStops: bandStops,
    backgroundPair: backgroundPair,
    /* The seam the QR encoder drops into. js/vendor/qr.js is picked up on its
       own if it is loaded; this is for a caller that wants to supply another. */
    useEncoder: function (fn) { encoder = fn; },
  };
})();
