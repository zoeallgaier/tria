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
   carries nothing but colour.

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
   be typed, so the profile card prints it in full and puts a QR beside it.

   THE PALETTE IS FROZEN HERE rather than read from tokens.css, and that is
   deliberate. A card is Tria's paper, not the reader's device: someone with
   their phone in dark mode still sends a light card unless they pick Dark, and
   a card whose colours moved with the sender's system setting would be a card
   nobody could predict. The values below are tokens.css's, copied on purpose.
   If the type colours or --band-deepen change there, change them here too;
   BAND_STOPS carries the arithmetic that ties the two together.

   WIRED IN SINCE 2026-09-22. The ••• on your own post and on your own profile
   both reach this through openStoryCardSheet in app.js, and the profile's sheet
   also asks for the code on its own, at the size a camera reads it — see "THE
   CODE AT SCAN SIZE" at the foot of this file. tools/storycards.html draws
   every card at every size against every background, and that page is a bench,
   not a route. */

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
      img.onload = function () { resolve(img); };
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
       the picture still reads as the biggest thing on it. The profile card's
       code is a plate by the same argument and takes the same treatment: it is
       the picture on that card. */
    const plated = kind === 'photo' || kind === 'profile';
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
    const authorH = kind === 'profile' ? Math.round(m.avatar * 1.6) : m.avatar;
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
    } else if (kind === 'profile') {
      /* THE CODE IS THE CARD (Zoe, 2026-09-22). It used to be 78% of the text
         column, left-aligned under a bio, which is how a QR looks when it is an
         ornament on a profile card. It is not an ornament: it is the one thing
         on this card anybody does anything with. So it takes the plate's width
         the way a photo does, centred in it, and the bio comes off — at 78% of
         the column a four-line bio and a code were the same card, and the code
         lost. Nobody is reading a bio off a picture of a card anyway; it is on
         the profile the code opens, one scan away.

         A SIZE WITH NO SAFE BAND has no vertical margin reserved for it — the
         band IS the canvas there — so a block that takes everything left grows
         the card to the top and bottom edges and loses its own shadow. The side
         margin is the measure of what the card is meant to sit in, so the code
         leaves it at the other two edges too, and the square comes out square. */
      const room = budget - (m.safeTop ? 0 : m.margin * 2);
      const side = Math.max(280, Math.min(inner, Math.floor(room)));
      blocks.push({ type: 'qr', side: side, width: inner, height: side, after: 0 });
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
      } else if (b.type === 'qr') {
        /* CENTRED in the plate, like the photo's. It was left-aligned with the
           name and the address when it was a small mark under a bio, and at
           this size that reads as a card someone printed off-centre. */
        drawQR(ctx, x + (b.width - b.side) / 2, y, b.side, spec, paper);
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

  function drawAuthor(ctx, x, y, m, author, avatar, accent, paper, d) {
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

    /* The name grows with the disc, so the profile card's bigger avatar does not
       end up towering over 36px of type. */
    const up = d > m.avatar ? 1.3 : 1;
    const name = Math.round(m.name * up), handle = Math.round(m.handle * up);
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
     file on its own — the card draws the space the code would occupy and prints
     the address in it, because a decorative QR that does not scan is worse than
     no QR at all: it is a promise the card cannot keep.

     THE QUIET ZONE is four modules, the spec's minimum, and it is part of the
     code rather than part of the design: it is what tells a camera where the
     code stops. It is inset from the plate rather than left to the card's own
     padding, which is a design value and moves. */
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

  function drawQR(ctx, x, y, side, spec, paper, grid) {
    const url = spec.qrUrl || spec.address || 'triaonline.com';
    const cells = grid || modules(spec);

    ctx.save();
    roundRect(ctx, x, y, side, side, Math.round(side * 0.06));

    if (!cells) {
      ctx.fillStyle = paper.plate;
      ctx.fill();
      ctx.fillStyle = paper.muted;
      ctx.font = sans(Math.round(side * 0.05));
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(url, x + side / 2, y + side / 2);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.restore();
      return y + side;
    }

    /* WHITE, AND NOT THE CARD'S PAPER. Every other plate on these cards takes
       the theme; this one cannot. A scanner is reading contrast, and Tria's
       dark paper behind near-black modules is a code that photographs as a
       grey square. */
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    /* A hairline around the plate, because on the Light background the card is
       pure white and a white plate on it has NO EDGE AT ALL. That is a design
       problem (the code floats in nothing) and a reading problem: the quiet
       zone stops being a zone when there is no boundary for it to be quiet
       against, and a decoder pointed at the whole card finds no candidate. The
       code decodes perfectly once cropped either way, so this is about helping
       something find it, which is the job the quiet zone was already doing. */
    ctx.strokeStyle = paper.plate;
    ctx.lineWidth = Math.max(2, Math.round(side * 0.006));
    ctx.stroke();
    ctx.clip();
    const q = QUIET, n = cells.length, unit = side / (n + q * 2);
    ctx.fillStyle = '#14171a';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (cells[r][c]) {
          /* Ceil both, so neighbouring dark modules meet instead of leaving a
             hairline of paper between them at fractional unit sizes. */
          ctx.fillRect(x + (c + q) * unit, y + (r + q) * unit,
                       Math.ceil(unit), Math.ceil(unit));
        }
      }
    }
    ctx.restore();
    return y + side;
  }

  /* ── THE CODE AT SCAN SIZE ───────────────────────────────────────────────
     Everything above this makes a PICTURE of a code. This makes a code.

     The difference is the reader standing in front of you. A card previewed in
     the share sheet is a 1080 canvas scaled to a phone's width, which puts the
     profile card's plate at about 110 CSS pixels and its modules at four —
     technically a QR, and a thing nobody would hold up and ask a friend to
     scan. So the sheet draws the code at its own size instead, with the handle
     under it, and the card stays what Save image and Instagram hand over. One
     code, two drawings, and the sheet stops being a thumbnail of a picture
     nobody is looking at yet.

     WHOLE DEVICE PIXELS PER MODULE, which is the other half of the reason this
     is not just a bigger preview. Scaling a canvas puts module edges on
     fractional pixels and the browser antialiases each one into its neighbours
     on all four sides; a camera reading contrast is the single audience that
     cannot forgive that. So the unit is floored to whole device pixels FIRST
     and the plate is whatever that comes to — the panel's size is derived from
     the code, not the code fitted to a panel.

     IT IS STILL THE CARD, in paper, plate, ink and type, because the four
     background pills above it are choosing the paper of the picture that saves.
     A panel that ignored them would leave four buttons on screen that change
     nothing a reader can see. */

  /* Fractions of the code plate, which is the only measure on this panel that
     was not chosen: everything else is laid out around it. */
  const PANEL = { pad: 0.09, margin: 0.05, gap: 0.06, handle: 0.085, line: 1.25 };
  /* Panel height over plate, the sum of the fractions above, rounded up a hair
     so the height bound below never asks for one pixel more than it can have. */
  const PANEL_TALL = 1.46;
  /* What is left for the plate once the card's padding and the page margin
     around it have had theirs: 1 / (1 + 2*pad + 2*margin). */
  const PANEL_WIDE = 1 / (1 + PANEL.pad * 2 + PANEL.margin * 2);

  /* The panel's arithmetic with nothing drawn, so a caller can reserve the
     space before the first paint rather than have the sheet jump under a
     finger. Null means there is no code to be had, and the caller falls back to
     the card. Sizes are DEVICE pixels; `css` is what the element wears. */
  function codeBox(spec, opt) {
    const grid = modules(spec || {});
    if (!grid) return null;
    const dpr = Math.max(1, Math.min(3, (opt && opt.dpr) || window.devicePixelRatio || 1));
    const n = grid.length + QUIET * 2;
    const wide = Math.floor(((opt.width || 0) * PANEL_WIDE) * dpr / n);
    const tall = Math.floor(((opt.maxHeight || 0) / PANEL_TALL) * dpr / n);
    const unit = Math.max(2, Math.min(wide, tall));
    const plate = unit * n;
    const pad = Math.round(plate * PANEL.pad);
    const margin = Math.round(plate * PANEL.margin);
    const gap = Math.round(plate * PANEL.gap);
    const handle = Math.round(plate * PANEL.handle);
    const line = Math.round(handle * PANEL.line);
    const w = plate + (pad + margin) * 2;
    const h = margin * 2 + pad * 2 + plate + gap + line;
    return { grid: grid, unit: unit, plate: plate, pad: pad, margin: margin, gap: gap,
             handle: handle, line: line, dpr: dpr, w: w, h: h,
             css: { width: w / dpr, height: h / dpr } };
  }

  /* Draw the box codeBox measured. Async only because of the face: the handle
     is Oxygen and a font declared `font-display: swap` has not been fetched
     until something asks to paint with it, so an unasked panel draws its handle
     in the system sans exactly once. */
  function code(spec, box) {
    if (!box) return Promise.resolve(null);
    spec = spec || {};
    const author = spec.author || {};
    const handle = '@' + (author.username || '');
    const accent = spec.accent || (TYPE[spec.type] || TYPE.note)[0];

    const canvas = document.createElement('canvas');
    canvas.width = box.w; canvas.height = box.h;
    canvas.style.width = box.css.width + 'px';
    canvas.style.height = box.css.height + 'px';
    const ctx = canvas.getContext('2d');

    return face(sans(box.handle, true), handle).then(function () {
      const paper = backdrop(ctx, Object.assign({}, spec, { accent: accent }),
                             { w: box.w, h: box.h });

      ctx.save();
      ctx.shadowColor = paper.shadow;
      ctx.shadowBlur = Math.round(box.plate * 0.09);
      ctx.shadowOffsetY = Math.round(box.plate * 0.04);
      roundRect(ctx, box.margin, box.margin, box.w - box.margin * 2, box.h - box.margin * 2,
                Math.round(box.plate * 0.09));
      ctx.fillStyle = paper.card;
      ctx.fill();
      ctx.restore();

      drawQR(ctx, box.margin + box.pad, box.margin + box.pad, box.plate, spec, paper, box.grid);

      /* CENTRED, where the card's own code is left-aligned. On the card a
         centred code under a left-aligned name reads as two cards stacked; here
         the code IS the panel and there is nothing for it to line up with. */
      ctx.fillStyle = paper.ink;
      ctx.font = sans(box.handle, true);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(handle, box.w / 2,
                   box.margin + box.pad + box.plate + box.gap + box.line / 2);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
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
       measured. See "THE CODE AT SCAN SIZE". */
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
