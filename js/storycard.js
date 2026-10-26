/* STORY CARDS — one renderer, every size.
   ==========================================================================

   What this draws is the picture someone saves and posts to a story, Messages
   or anywhere else that takes an image: a Tria post, on Tria's paper, with the
   handle and the address written on it. It is a CANVAS renderer and not a
   server, because Tria has no server — see docs/social-links.md. Everything
   here runs on the phone that taps Share, which also means the card can be
   drawn from the post already in the cache with no round trip at all.

   THREE SIZES, ONE LAYOUT. 1080x1920 is the story, 1080x1080 the square, and
   1200x630 the link preview. They are not three designs; they are one column
   (who / what / where) measured three ways, and the metrics below are the only
   place they differ.

   THE SAFE BAND is the whole reason the card floats rather than fills. Roughly
   the top 250px and bottom 340px of a story are under a story app's own
   chrome (Instagram's measured) —
   the close button and the camera roll up top, the reply bar and the sticker
   tray at the bottom. The card is laid out to fit BETWEEN those and is centred
   in what is left, so a caption that runs long shrinks the type rather than
   pushing the address under the reply bar.

   A POST URL IS NOT RETYPEABLE. `triaonline.com/p/8f3a2b91` cannot be read
   off someone's screen and typed into a browser, so a card carries the bare
   domain plus the handle and leaves the linking to a link sticker.

   LIGHT OR DARK, AND THE DEVICE DECIDES (Zoe, 2026-10-24: "get rid of the
   color options entirely. just light or dark, and dependent on the device
   settings"). The sheet used to offer four backgrounds (your colour, Light,
   Dark, Tria's ramp), which was a decision put in front of somebody who had
   only asked to share. A card is now the app as the sender sees it: the
   post set straight on the page's paper, light or dark, with no card shape
   under it at all. No drop shadow, no hairline, no second fill (Zoe, the same
   day: "no hairline around the post, just the light or dark bg"); a hairline
   was tried first and taken out before it shipped. The photo keeps the soft
   corner. The values below are tokens.css's, copied on purpose, because a
   canvas cannot read the cascade. If --bg, --text, --muted or --surface-2
   change there, change them here too; --brand-start / --brand-end live in the
   wordmark file itself.

   "THE CARD" below still means the column the post is laid out in: the same
   box, the same margins and safe band, just not painted.

   POSTS ONLY. The profile card and its QR came out in 2.0 (Zoe: "remove all
   the qr code bullshit ... in favor of the native share sheet"); a profile
   shares through its own QR sheet now (shareProfile) and draws nothing here.

   WIRED IN SINCE 2026-09-22. The ••• on your own post reaches this through
   openStoryCardSheet in app.js. tools/storycards.html draws every card
   at every size in both schemes, and that page is a bench, not a route. */

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

  /* tokens.css, both schemes. `page` is --bg, `plate` the empty-photo grey
     (--surface-2). */
  const LIGHT = { page: '#edeef0', ink: '#14171a', muted: '#5c636b', plate: '#e6e8ea' };
  const DARK  = { page: '#0e1012', ink: '#e9ebed', muted: '#969ca3', plate: '#1f2327' };

  /* The device's scheme, asked at the moment of sharing. A spec can still name
     one outright (the bench does), and anything else is light. */
  function deviceScheme() {
    try {
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch (e) { return 'light'; }
  }
  const paperOf = function (spec) {
    const scheme = spec.scheme || deviceScheme();
    return scheme === 'dark' ? DARK : LIGHT;
  };

  /* ---- Canvas helpers --------------------------------------------------- */

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
  /* Oxygen at the app's three weights: 700 a name, 400 a handle, 300 a note
     (.card-note). */
  const sans = function (size, weight) {
    return (weight || 400) + ' ' + size + 'px Oxygen, -apple-system, sans-serif';
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
      const font = opt.face(size);
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

  /* ---- The note: an essay's blocks ------------------------------------- */

  /* A NOTE IS BLOCKS, NOT A STRING. Tria is built for long posts, and a rich
     note is headings and paragraphs (h1, h2, p: the composer's whole subset).
     It used to reach the card squashed into one run of words, every break
     gone, so an essay came out as a wall. Each block is set the way the app
     sets it (.card-h1 upright serif, .card-h2 italic serif, .card-note Oxygen
     Light), every measure a multiple of the paragraph size `s`, so the whole
     note shrinks as one thing. */
  const FLOW = {
    h1: function (s) { return { font: serif(Math.round(s * 1.5)), lh: Math.round(s * 1.5 * 1.16), before: 1.6 }; },
    h2: function (s) { return { font: serif(Math.round(s * 1.22), true), lh: Math.round(s * 1.22 * 1.2), before: 1.35 }; },
    p:  function (s) { return { font: sans(s, 300), lh: Math.round(s * 1.45), before: 1 }; },
  };

  /* A spec may carry `blocks` ([{ kind, text }]) or plain `text`, whose lines
     are its paragraphs (the bench, a caption). */
  function noteBlocks(spec) {
    if (spec.blocks && spec.blocks.length) {
      return spec.blocks.filter(function (b) { return b && String(b.text || '').trim(); });
    }
    return String(spec.text || '').split(/\n+/).map(function (t) { return t.trim(); })
      .filter(Boolean).map(function (t) { return { kind: 'p', text: t }; });
  }

  function measureFlow(ctx, blocks, s, maxWidth) {
    const items = [];
    let y = 0, prev = null;
    blocks.forEach(function (b) {
      const st = (FLOW[b.kind] || FLOW.p)(s);
      if (prev) {
        /* A paragraph tucks in under its heading, a subheading under its
           heading; anything else keeps its own air above it ("A note's
           rhythm" in app.css). A paragraph's lines, a poem's stanza, arrive
           joined by "\n" and wrap breaks on them. */
        const tuck = prev !== 'p' && (b.kind === 'p' || (prev === 'h1' && b.kind === 'h2'));
        y += Math.round(s * (tuck ? 0.4 : st.before));
      }
      ctx.font = st.font;
      const lines = wrap(ctx, b.text, maxWidth);
      items.push({ kind: b.kind, font: st.font, lh: st.lh, lines: lines, y: y });
      y += lines.length * st.lh;
      prev = b.kind;
    });
    return { items: items, full: y };
  }

  /* FIT, THEN FADE. The note shrinks toward a floor that is still easy to read
     on a phone held at arm's length, and no further. What does not fit at the
     floor is not cut with an ellipsis or shrunk to a grey texture: it runs on
     under the app's own Read more fade (.readmore-clip, ink to 58% and out to
     nothing), so the card says "there is more" the way a long post says it in
     a feed, and the link is where the rest is. */
  function flowFit(ctx, blocks, opt) {
    let s = opt.size;
    for (;;) {
      const f = measureFlow(ctx, blocks, s, opt.maxWidth);
      if (f.full <= opt.maxHeight) return { items: f.items, size: s, clipped: false, height: f.full };
      if (s <= opt.minSize) {
        /* THE CUT LANDS ON A WHOLE LINE, and never on a heading. Cut anywhere
           else and the tops of the next line's letters peek out under the
           fade's last few percent; end on a heading and the fade promises a
           section that never starts. */
        let cut = 0, at = null;
        f.items.forEach(function (it) {
          if (it.kind !== 'p') return;
          it.lines.forEach(function (line, i) {
            const bottom = it.y + (i + 1) * it.lh;
            if (bottom <= opt.maxHeight && bottom > cut) { cut = bottom; at = { it: it, i: i }; }
          });
        });
        /* AND IT ENDS IN AN ELLIPSIS (Zoe, 2026-10-24: "include a ... at the
           end of the text for clarity"). The fade alone can read as a picture
           that faded; the ellipsis says the words go on. The line gives up
           whole words until it fits with the mark, and a full stop it ended
           on goes, so a paragraph's last line never reads "worse.…". */
        if (at) {
          ctx.font = at.it.font;
          const words = at.it.lines[at.i].split(' ');
          let last = words.join(' ').replace(/[\s,.;:!?]+$/, '');
          while (words.length > 1 && ctx.measureText(last + '…').width > opt.maxWidth) {
            words.pop();
            last = words.join(' ').replace(/[\s,.;:!?]+$/, '');
          }
          at.it.lines[at.i] = last + '…';
        }
        return { items: f.items, size: s, clipped: true,
                 height: cut || Math.max(0, Math.floor(opt.maxHeight)) };
      }
      s -= 2;
    }
  }

  function drawFlow(ctx, f, x, y, width, colour) {
    const paint = function (c, ox, oy) {
      c.fillStyle = colour;
      c.textAlign = 'left';
      c.textBaseline = 'alphabetic';
      f.items.forEach(function (it) {
        c.font = it.font;
        it.lines.forEach(function (line, i) {
          c.fillText(line, ox, oy + it.y + i * it.lh + it.lh * 0.76);
        });
      });
    };
    if (!f.clipped) { paint(ctx, x, y); return; }
    /* Drawn on its own layer so the fade takes the words and nothing under
       them. The layer is a little wider than the column, so an italic heading
       leaning past its edge keeps its overhang. */
    const bleed = Math.round(f.size * 0.4);
    const layer = document.createElement('canvas');
    layer.width = width + bleed * 2;
    layer.height = Math.max(1, f.height);
    const c = layer.getContext('2d');
    paint(c, bleed, 0);
    /* The app's curve is 58% solid over a six-line teaser, so the fade is
       about two and a half lines long; over a whole story's worth of essay it
       is held to that, not stretched to 42% of the column. Its clear end sits
       just past the cut rather than on it, so the last line, the one carrying
       the ellipsis, is faint and still legible. */
    const line = f.size * 1.45;
    const run = Math.min(f.height * 0.42, line * 2.6);
    const g = c.createLinearGradient(0, f.height - run, 0, f.height + line * 0.6);
    g.addColorStop(0, 'rgba(0, 0, 0, 1)');
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    c.globalCompositeOperation = 'destination-in';
    c.fillStyle = g;
    c.fillRect(0, 0, layer.width, layer.height);
    ctx.drawImage(layer, x - bleed, y);
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
         to do nothing at all. Seen in the app as an empty ring where the face
         goes, and no initial either, since the fallback had been skipped. Null is the honest answer and the fallbacks are
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
     chrome and are zero everywhere the card is not a story; the card never
     comes nearer an edge than `margin` either way.

     The margins are the post's only frame now there is no card, so they are
     a reading column's and no wider (they were a card's margin plus its
     padding). A story's column is the feed's drawn about 2.75 times over, so
     the photo's corner (`plate`) is the app's soft corner at that scale. The type is the
     app's too: a title in the serif, a note in Oxygen Light (.card-title,
     .card-note), each shrinking on its own as a post runs long. */
  const SIZES = {
    story:  { w: 1080, h: 1920, safeTop: 250, safeBottom: 340, margin: 40, plate: 40,
              pad: 84, padBottom: 72, gap: 64,
              avatar: 84, name: 36, handle: 31, title: 76, titleMin: 48, body: 50, bodyMin: 42,
              prompt: 42, mark: 84, address: 29, rowGap: 48 },
    square: { w: 1080, h: 1080, safeTop: 0, safeBottom: 0, margin: 36, plate: 38,
              pad: 76, padBottom: 68, gap: 52,
              avatar: 82, name: 35, handle: 30, title: 68, titleMin: 42, body: 46, bodyMin: 38,
              prompt: 38, mark: 80, address: 27, rowGap: 44 },
    /* The link card is the one nobody chooses — it is what Messages and Slack
       unfurl — so it is the same column laid on its side and nothing more. */
    link:   { w: 1200, h: 630, safeTop: 0, safeBottom: 0, margin: 32, plate: 28,
              pad: 52, padBottom: 44, gap: 32,
              avatar: 64, name: 28, handle: 24, title: 46, titleMin: 28, body: 32, bodyMin: 26,
              prompt: 28, mark: 64, address: 23, rowGap: 30 },
  };

  /* ---- The page ------------------------------------------------------- */

  function backdrop(ctx, m, paper) {
    ctx.fillStyle = paper.page;
    ctx.fillRect(0, 0, m.w, m.h);
  }

  /* ---- The card --------------------------------------------------------- */

  /* Everything above measures; this is the only function that decides. A card
     is a stack of blocks with ONE flexible member (the photo plate, or else the
     note), so the rest are measured first and that one takes what is left. That
     ordering is what keeps the card inside the safe band no matter how long the
     caption runs — the alternative, a fixed plate with the text shrinking under
     it, put the address under Instagram's reply bar on the third test caption. */
  function layout(ctx, spec, m, kind) {
    const cardW = m.w - m.margin * 2;
    /* The photo shares the words' column. It used to run wider, to the card's
       edge, which read as a picture on a card; with no card it would only read
       as a picture sticking out past the words. */
    const plated = kind === 'photo';
    const textW = cardW - m.pad * 2;

    /* Every block carries the gap that follows it, so the height measured here
       and the height actually drawn are the same sum in the same order. They
       used to be two hand-kept tallies and they drifted by one gap, which is the sort of bug that only shows up as "the mark
       sits a bit low". */
    const blocks = [];
    const markH = Math.round(m.mark * 1028 / 1650);   /* the file's viewBox */
    const authorH = m.avatar;
    const bandTop = Math.max(m.safeTop, m.margin);
    const band = m.h - bandTop - Math.max(m.safeBottom, m.margin);
    const fixed = m.pad + authorH + m.rowGap + m.gap + markH + m.padBottom;
    const budget = band - fixed;
    const spent = function () {
      return blocks.reduce(function (n, b) { return n + b.height + b.after; }, 0);
    };
    const titled = !!(spec.title && spec.title.trim());
    const note = noteBlocks(spec);
    const noted = note.length > 0;
    const between = Math.round(m.rowGap * 0.4);
    const titleFace = function (size) { return serif(size); };

    if (kind === 'daily') {
      /* The prompt sits ABOVE the answer, quiet and italic, because a daily
         answer read without its question is a non sequitur. */
      const prompt = paragraph(ctx, spec.prompt || '', {
        size: m.prompt, minSize: Math.round(m.prompt * 0.8), lineHeight: 1.3,
        maxWidth: textW, maxHeight: m.prompt * 1.3 * 3,
        face: function (size) { return serif(size, true); },
      });
      blocks.push({ type: 'prompt', block: prompt, height: prompt.height,
                    after: Math.round(m.rowGap * 0.66) });
    }

    if (plated) {
      /* A caption is the post's own two parts at a smaller size: a headline of
         two lines at most, and the note held to four lines' room, fading past
         it, so the picture keeps the space. */
      const title = titled ? paragraph(ctx, spec.title, {
        size: Math.round(m.title * 0.8), minSize: m.titleMin, lineHeight: 1.14,
        maxWidth: textW, maxHeight: Math.round(m.title * 0.8 * 1.14 * 2), face: titleFace,
      }) : null;
      const words = noted ? flowFit(ctx, note, {
        size: m.body, minSize: m.bodyMin, maxWidth: textW,
        maxHeight: Math.round(m.body * 1.45 * 4),
      }) : null;
      const said = (title ? title.height : 0) + (words ? words.height : 0) +
                   (title && words ? between : 0);
      /* The plate runs the column's full width, square when there is
         room and cropped shorter (never past 3:2) when a caption needs the
         space. It used to stay square and SHRINK, which left a smaller picture
         floating in the middle of the column. It is measured LAST and pushed
         first. */
      const left = budget - spent() - (said ? said + Math.round(m.gap * 0.75) : 0);
      const tall = Math.max(Math.round(textW * 2 / 3), Math.min(textW, Math.floor(left)));
      blocks.push({ type: 'plate', width: textW, height: tall,
                    after: said ? Math.round(m.gap * 0.75) : 0 });
      if (title) blocks.push({ type: 'title', block: title, height: title.height, after: words ? between : 0 });
      if (words) blocks.push({ type: 'flow', flow: words, height: words.height, after: 0 });
    } else {
      /* A headline is capped at three lines when a note follows it, and takes
         the whole card when it is all there is. A note with no headline starts
         a size up, so a one-line thought does not sit small in a big card;
         a long one comes down to the floor and fades from there. */
      if (titled) {
        const title = paragraph(ctx, spec.title, {
          size: m.title, minSize: m.titleMin, lineHeight: 1.14, maxWidth: textW,
          maxHeight: noted ? Math.round(m.title * 1.14 * 3) : budget - spent(), face: titleFace,
        });
        blocks.push({ type: 'title', block: title, height: title.height, after: noted ? between : 0 });
      }
      if (noted) {
        const words = flowFit(ctx, note, {
          size: titled ? m.body : Math.round(m.body * 1.25), minSize: m.bodyMin,
          maxWidth: textW, maxHeight: budget - spent(),
        });
        blocks.push({ type: 'flow', flow: words, height: words.height, after: 0 });
      }
    }

    const height = fixed + spent();
    /* Centred in what Instagram leaves, never above it. */
    const top = Math.max(bandTop, Math.round(bandTop + (band - height) / 2));
    return { blocks: blocks, cardW: cardW, textW: textW,
             height: height, top: top, left: m.margin,
             authorH: authorH, markH: markH };
  }

  async function render(spec) {
    spec = spec || {};
    const m = SIZES[spec.size] || SIZES.story;
    const paper = paperOf(spec);

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

    /* A PHOTO THAT DID NOT ARRIVE IS NOT DRAWN AS A HOLE. A bucket that refused
       CORS, or a picture since deleted, used to leave a grey square with
       "[ the photo ]" in it, which is the bench's placeholder reaching a real
       story. With words to carry, the card becomes a note; with none, the plate
       stays, empty, so the card still has a body. */
    let kind = spec.kind || 'note';
    if (kind === 'photo' && !photo && ((spec.title || '').trim() || noteBlocks(spec).length)) kind = 'note';

    backdrop(ctx, m, paper);
    const L = layout(ctx, spec, m, kind);

    ctx.save();
    const tx = L.left + m.pad;
    let y = L.top + m.pad;

    /* WHO. The attribution leads, on every card — a card that opens with the
       writing and names its writer underneath reads as a quote graphic, which
       is exactly the thing Tria is not. */
    drawAuthor(ctx, tx, y, m, author, avatar, paper, L.authorH);
    y += L.authorH + m.rowGap;

    /* WHAT. Each block draws at y and then advances by its own measured height
       plus the gap the layout said follows it. */
    L.blocks.forEach(function (b) {
      if (b.type === 'prompt') {
        drawParagraph(ctx, b.block, tx, y, paper.muted);
      } else if (b.type === 'title') {
        drawParagraph(ctx, b.block, tx, y, paper.ink);
      } else if (b.type === 'flow') {
        drawFlow(ctx, b.flow, tx, y, L.textW, paper.ink);
      } else if (b.type === 'plate') {
        ctx.save();
        roundRect(ctx, tx, y, b.width, b.height, m.plate);
        ctx.clip();
        if (photo) drawCover(ctx, photo, tx, y, b.width, b.height);
        else { ctx.fillStyle = paper.plate; ctx.fillRect(tx, y, b.width, b.height); }
        ctx.restore();
      }
      y += b.height + b.after;
    });

    /* WHERE. The wordmark and the address, on their own row at the foot. The
       mark is the real file (icons/wordmark.svg, the brand's cyan to green
       baked into it) and it is small on purpose: the reader's post is the
       content, and this is a signature, not a banner. */
    const markH = L.markH;
    const fy = L.top + L.height - m.padBottom - markH;
    if (mark) ctx.drawImage(mark, tx, fy, m.mark, markH);
    ctx.fillStyle = paper.muted;
    ctx.font = sans(m.address);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(spec.address || 'triaonline.com', tx + L.textW, fy + markH / 2);
    ctx.textAlign = 'left';

    ctx.restore();
    return canvas;
  }

  /* THE DISC: the author's photo, or their initial the way the app sets it
     (.avatar): the page's ink, the paper's colour, the serif. */
  function disc(ctx, x, y, d, author, avatar, paper) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x + d / 2, y + d / 2, d / 2, 0, Math.PI * 2);
    ctx.clip();
    if (avatar) drawCover(ctx, avatar, x, y, d, d);
    else {
      ctx.fillStyle = paper.ink;
      ctx.fillRect(x, y, d, d);
      ctx.fillStyle = paper.page;
      ctx.font = serif(Math.round(d * 0.5));
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText((author.name || author.username || '?').trim().charAt(0).toUpperCase(),
                   x + d / 2, y + d / 2 + d * 0.02);
      ctx.textAlign = 'left';
    }
    ctx.restore();
  }

  /* Name over @handle. Somebody with no name gets the handle alone, on the
     disc's midline, rather than their handle printed twice. */
  function drawAuthor(ctx, x, y, m, author, avatar, paper, d) {
    disc(ctx, x, y, d, author, avatar, paper);

    const handle = '@' + (author.username || '');
    const nx = x + d + Math.round(m.rowGap / 2);
    ctx.textBaseline = 'alphabetic';
    if (!author.name) {
      ctx.fillStyle = paper.ink;
      ctx.font = sans(m.name, 700);
      ctx.textBaseline = 'middle';
      ctx.fillText(handle, nx, y + d / 2);
      ctx.textBaseline = 'alphabetic';
      return;
    }
    ctx.fillStyle = paper.ink;
    ctx.font = sans(m.name, 700);
    ctx.fillText(author.name, nx, y + d / 2 - Math.round(m.handle * 0.2));
    ctx.fillStyle = paper.muted;
    ctx.font = sans(m.handle);
    ctx.fillText(handle, nx, y + d / 2 + m.handle);
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
    const text = [spec.title, spec.text, spec.prompt,
                  (spec.blocks || []).map(function (b) { return b.text; }).join(' '), (spec.author || {}).name,
                  (spec.author || {}).username, spec.address].filter(Boolean).join(' ')
                 + ' triaonline.com@…';
    const faces = [
      serif(m.title), serif(m.prompt, true), sans(m.body, 300), sans(m.name, 700),
      sans(m.handle), sans(m.address),
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
    SIZES: SIZES,
    deviceScheme: deviceScheme,
  };
})();
