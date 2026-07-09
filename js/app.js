/* ── Tria app ──────────────────────────────────────────────────────────────
   A tiny hash router. Home, Friends and Profile (own + any friend's, at
   #/u/username) are live; the Publish composer is the last placeholder,
   wired for step 4. */

(function () {
  'use strict';

  // `stage` is the fixed shell (#view); `view` is the current *page* inside it
  // that every render function fills. The router (see renderPage) swaps one page
  // for the next with a directional slide, so render code just targets `view`
  // and never has to know a transition is happening.
  const stage = document.getElementById('view');
  let view = null;
  let navIndex = -1;          // spatial index of the current route (for direction)
  let navToken = 0;           // guards against a stale transition cleaning up a new one
  let lastPath = null;        // the path we were on before the current one (for back links)
  let profileOrigin = '#/friends';  // where a friend profile's "← Back" returns to
  const TRANSITION_MS = 360;

  const esc = (s) => String(s ?? '').replace(/[&<>"]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const prefersReduced = () =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Scroll the page back to the top. Smooth when asked (and motion is allowed),
  // instant on a plain route change.
  const scrollTop = (smooth) =>
    window.scrollTo({ top: 0, behavior: smooth && !prefersReduced() ? 'smooth' : 'auto' });

  /* ── Nav ─────────────────────────────────────────────────────────────────
     One list drives the desktop top-right links and the mobile bottom tab bar.
     The publish "+" is the primary action (filled pill on desktop). */
  const ICONS = {
    // Three interlocking rings — your "circle" of friends, and a nod
    // to the name (Tria). Kept as an outline to sit with the other nav glyphs.
    circle:  '<circle cx="8.5" cy="10" r="3.8"/><circle cx="15.5" cy="10" r="3.8"/><circle cx="12" cy="15.5" r="3.8"/>',
    friends: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16 5.5a3.2 3.2 0 0 1 0 6"/><path d="M18 20a6 6 0 0 0-4-5.7"/>',
    share:   '<circle cx="18" cy="5" r="2.6"/><circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="19" r="2.6"/><path d="M8.3 10.8 15.7 6.3"/><path d="M8.3 13.2 15.7 17.7"/>',
    profile: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
    publish: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    trash:   '<path d="M4 7h16"/><path d="M9 7V4.5h6V7"/><path d="M6.5 7l.85 12.5h9.3L17.5 7"/><path d="M10 10.5v6"/><path d="M14 10.5v6"/>',
    pencil:  '<path d="M4 20l4-1L19 8a2 2 0 0 0-3-3L5 16l-1 4z"/><path d="M14 7l3 3"/>',
    camera:  '<path d="M3.5 8.5A1.5 1.5 0 0 1 5 7h2l1.4-2h7.2L17 7h2a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z"/><circle cx="12" cy="13" r="3.3"/>',
    comment: '<path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-7l-4 3v-3H6a2 2 0 0 1-2-2z"/>',
    heart:   '<path d="M12 20.3 4.7 12.9a4.6 4.6 0 0 1 6.5-6.5l.8.8.8-.8a4.6 4.6 0 0 1 6.5 6.5z"/>',
    // A person with a check — the headcount's "I'm in" on an activity.
    going:   '<circle cx="10" cy="8" r="3.4"/><path d="M4 20a6.5 6.5 0 0 1 12.2-2.8"/><path d="m14.5 16.5 2.2 2.2 4-4"/>',
    // Map pin for an activity's location line.
    pin:     '<path d="M12 21s-6.5-5.2-6.5-10a6.5 6.5 0 0 1 13 0c0 4.8-6.5 10-6.5 10z"/><circle cx="12" cy="11" r="2.4"/>',
    // Calendar page for an activity's when-line.
    cal:     '<rect x="4" y="6" width="16" height="14" rx="1.5"/><path d="M4 10.5h16"/><path d="M8.5 3.5V7"/><path d="M15.5 3.5V7"/>',
    // The little "opens elsewhere" mark on a find's title. An SVG (not the ↗
    // glyph) so it renders as this plain arrow everywhere — mobile fonts render
    // the character as a colour emoji, which we never want.
    extlink: '<path d="M7 17 17 7"/><path d="M8 7h9v9"/>',
    bell:    '<path d="M6 9.2a6 6 0 0 1 12 0c0 4.6 1.7 5.8 1.7 5.8H4.3S6 13.8 6 9.2z"/><path d="M10.4 19.3a1.9 1.9 0 0 0 3.2 0"/>',
  };
  const svgIcon = (key, cls) =>
    `<svg${cls ? ` class="${cls}"` : ''} viewBox="0 0 24 24" fill="none" ` +
      `stroke="currentColor" stroke-width="1.8" stroke-linecap="round" ` +
      `stroke-linejoin="round" aria-hidden="true">${ICONS[key]}</svg>`;
  const NAV = [
    { route: '#/',        key: 'circle',  label: 'My Circle' },
    { route: '#/friends', key: 'friends', label: 'Friends' },
    { route: '#/updates', key: 'bell',    label: 'Updates' },
    { route: '#/profile', key: 'profile', label: 'Profile' },
    { route: '#/publish', key: 'publish', label: 'Post', publish: true },
  ];

  function renderNav(active) {
    document.getElementById('nav').innerHTML = NAV.map(n =>
      `<a class="nav-link${n.publish ? ' nav-publish publish-fill' : ''}" href="${n.route}"` +
        (n.route === active ? ' aria-current="page"' : '') +
        ` aria-label="${n.label}">` +
        svgIcon(n.key, 'nav-ico') +
        `<span class="nav-label">${n.label}</span>` +
      `</a>`
    ).join('');
  }

  /* ── Cards ───────────────────────────────────────────────────────────────── */
  // Avatar — a real uploaded photo when the user has one, else the monochrome
  // initial tile. `cls` adds a size/context modifier; `forceInitial` is an escape
  // hatch to pin the initial tile even when a photo exists.
  function avatarEl(user, opts = {}) {
    const cls = `avatar${opts.cls ? ' ' + opts.cls : ''}`;
    if (user && user.avatar && !opts.forceInitial) {
      // crossorigin so the DISPLAYED avatar and the gradient sampler (applyAmbient)
      // share one CORS-mode fetch — otherwise iOS can hand the sampler a cached
      // non-CORS copy and taint its canvas, killing the profile wash. (Ignored
      // harmlessly for the optimistic data: URI right after an upload.)
      return `<span class="${cls} avatar--photo" aria-hidden="true">` +
          `<img src="${esc(user.avatar)}" crossorigin="anonymous" alt="" loading="lazy" decoding="async">` +
        `</span>`;
    }
    const name = user ? (user.name || user.username) : '';
    return `<span class="${cls}" aria-hidden="true">${esc(initialOf(name))}</span>`;
  }

  // A dated activity retires once its day has passed: greyed tag, and it sinks
  // below upcoming plans on the Activities filter. (Both YYYY-MM-DD strings, so
  // plain comparison is a date comparison.)
  const isPastActivity = (post) =>
    post.type === 'activity' && !!post.eventDate && post.eventDate < TODAY;

  // A small colored label marking an entry's type (Note / Find / Photo), sat at
  // the right of the byline. The colour is the type's own (via the CSS class) —
  // except a past activity, which greys out and reads as done.
  const TYPE_LABEL = { note: 'Note', find: 'Find', photo: 'Photo', activity: 'Activity' };
  function typeTagEl(post) {
    if (isPastActivity(post)) {
      return `<span class="type-tag type-tag--past">Happened</span>`;
    }
    return `<span class="type-tag type-tag--${post.type}">` +
      `${esc(TYPE_LABEL[post.type] || post.type)}</span>`;
  }

  // Byline (identity) — avatar + profile name, with the date (and a find's
  // domain) beneath, and the type-tag at the right. Leads every entry. No
  // @usernames; profile names only.
  function bylineEl(post) {
    const u = Store.user(post.author);
    const name = esc(u ? u.name : post.author);
    const domain = post.type === 'find' && post.url ? esc(domainOf(post.url)) : '';
    const meta = esc(niceDate(post.date)) +
      (domain ? ` <span class="dot">·</span> ${domain}` : '');
    return `<header class="byline">` +
        `<a class="byline-link" href="#/u/${esc(encodeURIComponent(post.author))}">` +
          avatarEl(u || { name: post.author }) +
          `<span class="byline-text">` +
            `<span class="byline-name">${name}</span>` +
            `<span class="byline-meta">${meta}</span>` +
          `</span>` +
        `</a>` +
        typeTagEl(post) +
      `</header>`;
  }

  // A slim single-author meta line that stands in for the byline on a profile,
  // where the header already establishes whose column this is. Just the date
  // (and a find's domain) — no repeated avatar + name down the page.
  function soloMetaEl(post) {
    const domain = post.type === 'find' && post.url ? esc(domainOf(post.url)) : '';
    const meta = esc(niceDate(post.date)) +
      (domain ? ` <span class="dot">·</span> ${domain}` : '');
    return `<p class="card-solometa"><span>${meta}</span>` +
      typeTagEl(post) + `</p>`;
  }

  // ── Long notes → "Read more" ───────────────────────────────────────────────
  // A lengthy note is shown whole but with its height clamped to a teaser; the
  // full text stays intact in one block (no splitting — so it reads identically
  // opened or closed) and eases into view on "Read more" by animating the clamp
  // out to the text's real height. Below the clamp the copy softly fades (a mask,
  // not a splice) to signal there's more.
  const READMORE_MIN = 320;   // notes shorter than this are shown whole

  // Split a note's plain text into paragraphs (blank-line separated).
  const noteParas = (text) =>
    String(text || '').split(/\n{2,}/).map(p => p.trim()).filter(Boolean);

  const notePara = (p) => `<p class="card-note">${esc(p)}</p>`;

  // The note block for a text entry. Paragraphs always render intact; a long note
  // additionally wraps them in a height-clamped clip + a "Read more" toggle. Open
  // state lives in `openReadMore` so it survives a card rebuild (like openComments).
  function cardNoteHtml(post) {
    if (!post.note) return '';
    const body = noteParas(post.note).map(notePara).join('');
    if (post.note.length <= READMORE_MIN) return body;

    const open = openReadMore.has(post.id);
    return `<div class="readmore${open ? ' open' : ''}">` +
        `<div class="readmore-clip">${body}</div>` +
        `<button class="readmore-toggle" type="button" aria-expanded="${open}">` +
          `${open ? 'Read less' : 'Read more'}</button>` +
      `</div>`;
  }

  // Wire the "Read more" toggle. Opening animates the clip's max-height out to the
  // content's real height, then releases it (so a later reflow can't re-clip);
  // closing pins the current height first so it eases back to the clamp. The set
  // records the state so a card rebuild reopens it.
  function wireReadMore(el, post) {
    const wrap = el.querySelector('.readmore');
    if (!wrap) return;
    const clip = wrap.querySelector('.readmore-clip');
    const toggle = wrap.querySelector('.readmore-toggle');

    clip.addEventListener('transitionend', (e) => {
      if (e.propertyName === 'max-height' && wrap.classList.contains('open'))
        clip.style.maxHeight = 'none';        // fully open → let it grow freely
    });

    toggle.addEventListener('click', () => {
      const open = !wrap.classList.contains('open');
      if (open) {
        clip.style.maxHeight = clip.scrollHeight + 'px';   // clamp → full
        wrap.classList.add('open');
      } else {
        clip.style.maxHeight = clip.scrollHeight + 'px';   // pin current height…
        void clip.offsetHeight;                            // …commit it, then
        wrap.classList.remove('open');
        clip.style.maxHeight = '';                         // …ease back to clamp
      }
      toggle.setAttribute('aria-expanded', String(open));
      toggle.textContent = open ? 'Read less' : 'Read more';
      if (open) openReadMore.add(post.id); else openReadMore.delete(post.id);
    });
  }

  // The tag chips, wrapped — reused in text and photo entries.
  function tagChips(post) {
    if (!post.tags || !post.tags.length) return '';
    return `<div class="tags">` +
      post.tags.map(t => `<button class="tag" type="button" data-tag="${esc(t)}">${esc(t)}</button>`).join('') +
      `</div>`;
  }

  // Comments are a friends-only feature: you can only comment on a friend's post
  // (or your own). On a non-friend's profile their posts show, but with no
  // comment thread. The store guards this too (see Store.addComment).
  const canComment = (post) =>
    post.author === Store.session() || Store.isFriend(post.author);

  // The card's action row, tucked below the post: the like heart + comment toggle
  // grouped on the LEFT (each opens/toggles below on the same left axis), and edit
  // + delete grouped on the right for your own posts.
  //
  // The like heart is deliberately two-faced. A friend sees a bare heart they can
  // fill — no count, because a like is a private nod to the author, not a public
  // tally. The author can't like their own post; for them the heart carries the
  // count and opens the list of who liked (see likersPanelHtml / wireLikes).
  function likeButtonHtml(post) {
    const owns = post.author === Store.session();
    if (!(owns || Store.isFriend(post.author))) return '';   // same gate as comments
    if (owns) {
      const n = Store.likeCountFor(post.id);
      const open = openLikers.has(post.id);
      return `<button class="card-like card-like--owner" type="button" aria-expanded="${open}" ` +
          `aria-label="${n ? n + ' like' + (n === 1 ? '' : 's') + ', see who' : 'Likes'}" title="Who liked this">` +
          svgIcon('heart') +
          (n ? `<span class="card-like-count">${n}</span>` : '') +
        `</button>`;
    }
    const liked = Store.likedByMe(post.id);
    return `<button class="card-like${liked ? ' liked' : ''}" type="button" aria-pressed="${liked}" ` +
        `aria-label="${liked ? 'Unlike' : 'Like'}" title="${liked ? 'Liked' : 'Like'}">` +
        svgIcon('heart') +
      `</button>`;
  }

  // Headcount — activities only, and public (unlike likes): the count is the
  // point. Icon-only, no "going" word: friends get a hand-up toggle with the
  // bare count snugged beside it (the count opens the who's-going panel); the
  // author hosts rather than RSVPs, so their single icon+count opens the panel
  // (mirrors the owner heart).
  function headcountHtml(post) {
    if (post.type !== 'activity') return '';
    const owns = post.author === Store.session();
    if (!(owns || Store.isFriend(post.author))) return '';   // same gate as comments
    const n = Store.headcountFor(post.id).length;
    const going = Store.goingByMe(post.id);
    const open = openGoing.has(post.id);
    if (owns) {
      return `<button class="card-goingcount card-goingcount--owner" type="button" ` +
          `aria-expanded="${open}" aria-label="${n} going, see who" title="Who’s going">` +
          svgIcon('going') +
          (n ? `<span class="card-going-count">${n}</span>` : '') +
        `</button>`;
    }
    return `<button class="card-going${going ? ' going' : ''}" type="button" aria-pressed="${going}" ` +
        `aria-label="${going ? 'You’re in. Tap to bow out' : 'Count me in'}" ` +
        `title="${going ? 'You’re in' : 'Count me in'}">` +
        svgIcon('going') +
      `</button>` +
      (n ? `<button class="card-goingcount" type="button" aria-expanded="${open}" ` +
        `aria-label="${n} going, see who" title="Who’s going">${n}</button>` : '');
  }

  // Add-to-calendar — activities with a date only, same friends gate as the
  // hand-up toggle, and gone once the plan has Happened. Sits left of the
  // hand-up toggle; tapping downloads a one-event .ics the phone hands to
  // whatever calendar the person actually uses.
  function calendarBtnHtml(post) {
    if (post.type !== 'activity' || !post.eventDate || isPastActivity(post)) return '';
    const owns = post.author === Store.session();
    if (!(owns || Store.isFriend(post.author))) return '';
    return `<button class="card-cal" type="button" aria-label="Add to calendar" ` +
        `title="Add to calendar">${svgIcon('cal')}</button>`;
  }

  function goingPanelHtml(post) {
    if (post.type !== 'activity') return '';
    const owns = post.author === Store.session();
    if (!(owns || Store.isFriend(post.author))) return '';
    const list = Store.headcountFor(post.id);
    const open = openGoing.has(post.id);
    return `<div class="going-panel${open ? ' open' : ''}">` +
        `<div class="comments-inner">` +
          `<div class="comments-content">` +
            (list.length
              ? `<ul class="likers-list">${list.map(likerItemHtml).join('')}</ul>`
              : `<p class="likers-empty">No hands up yet.</p>`) +
          `</div>` +
        `</div>` +
      `</div>`;
  }

  function cardActionsHtml(post, opts) {
    const cal = calendarBtnHtml(post);
    const going = headcountHtml(post);
    const like = likeButtonHtml(post);
    const n = Store.commentsFor(post.id).length;
    const expanded = openComments.has(post.id);
    const comment = canComment(post)
      ? `<button class="card-comment" type="button" aria-expanded="${expanded}" ` +
          `aria-label="${n ? n + ' comment' + (n === 1 ? '' : 's') : 'Comments'}" title="Comments">` +
          svgIcon('comment') +
          (n ? `<span class="card-comment-count">${n}</span>` : '') +
        `</button>`
      : '';
    // Reading order across the row: trash · edit … comments · likes — the
    // destructive tool tucked furthest away, the like at the thumb's edge.
    const owner = opts.owner
      ? `<div class="card-tools">` +
          `<button class="card-delete" type="button" data-del="${esc(post.id)}" ` +
            `aria-label="Delete this post" title="Delete post">${svgIcon('trash')}</button>` +
          `<button class="card-edit" type="button" data-edit="${esc(post.id)}" ` +
            `aria-label="Edit this post" title="Edit post">${svgIcon('pencil')}</button>` +
        `</div>`
      : '';
    // Nothing to show (a non-friend's post you don't own) → no empty row.
    if (!cal && !going && !like && !comment && !owner) return '';
    return `<div class="card-actions"><div class="card-social">${cal}${going}${comment}${like}</div>${owner}</div>`;
  }

  // opts.solo → this card sits on a profile (single author): show the slim
  // date line instead of the full avatar + name byline.
  // opts.owner → the viewer owns this post: show a delete control.
  function makeCard(post, opts = {}) {
    const head = opts.solo ? soloMetaEl(post) : bylineEl(post);
    const actions = cardActionsHtml(post, opts);
    const el = document.createElement('article');
    el.className = `card card--${post.type}${opts.owner ? ' card--owner' : ''}`;
    el.dataset.id = post.id;
    el.dataset.type = post.type;
    el.dataset.tags = (post.tags || []).join(',');

    if (post.type === 'photo') {
      // Identity first, then caption + tags, then the full-bleed photo last —
      // text settles before the image so the two don't compete for the read.
      // Real uploads (post.image) show the cropped photo; seed entries fall
      // back to the tonal placeholder.
      const img = post.image
        ? { src: post.image, alt: post.note || 'Photo' }
        : placeholderPhoto(post.id, post.note);
      const foot = (post.note ? `<p class="card-note">${esc(post.note)}</p>` : '') + tagChips(post);
      // .card-main holds the post itself (ending in the action row); the comment
      // thread expands as a sibling below, tucked under it on the same left axis.
      el.innerHTML =
        `<div class="card-main">` +
          head +
          (foot ? `<div class="card-foot">${foot}</div>` : '') +
          `<figure class="photo" tabindex="0" role="button" aria-label="Enlarge photo">` +
            `<img src="${img.src}" alt="${esc(img.alt)}" loading="lazy" decoding="async">` +
          `</figure>` +
          actions +
        `</div>` +
        likersPanelHtml(post) +
        commentsPanelHtml(post);
      wirePhoto(el, img);
      wireLikes(el, post, opts);
      wireComments(el, post, opts);
      return el;
    }

    // Text entry (post / find): identity first, then headline, caption, tags.
    // The type shows as the left rule + the domain; no badge (kept editorial).
    // Headline as an <h2> (page title is the h1) for a clean heading outline.
    const external = /^https?:\/\//.test(post.url || '');
    const titleHtml = post.title
      ? (post.url
          ? `<h2 class="card-title"><a href="${esc(post.url)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ''}>` +
              `${esc(post.title)}${external ? `<span class="card-title-ext" aria-hidden="true">${svgIcon('extlink')}</span>` : ''}</a></h2>`
          : `<h2 class="card-title">${esc(post.title)}</h2>`)
      : '';

    // A find with no title: the caption itself carries the link (underlined the
    // same way a titled find is), so the destination never gets lost. Rendered
    // whole — the Read-more clamp would nest a button inside the anchor.
    const linkedNote = post.type === 'find' && post.url && !post.title && post.note;
    const noteHtml = linkedNote
      ? `<a class="card-note-link" href="${esc(post.url)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ''}>` +
          noteParas(post.note).map((p, i, arr) =>
            `<p class="card-note">${esc(p)}${i === arr.length - 1 && external
              ? `<span class="card-title-ext" aria-hidden="true">${svgIcon('extlink')}</span>` : ''}</p>`).join('') +
        `</a>`
      : cardNoteHtml(post);

    // Activities carry a when-line and a where-line under the title — a quiet
    // calendar + day (and time), then pin + place. Same voice, stacked.
    const whenHtml = post.type === 'activity' && post.eventDate
      ? `<p class="card-location">${svgIcon('cal', 'card-location-ico')}` +
          `<span>${esc(eventWhenLabel(post.eventDate, post.eventTime))}</span></p>`
      : '';
    const locationHtml = post.type === 'activity' && post.location
      ? `<p class="card-location">${svgIcon('pin', 'card-location-ico')}<span>${esc(post.location)}</span></p>`
      : '';

    el.innerHTML =
      `<div class="card-main">` +
        head +
        titleHtml +
        whenHtml +
        locationHtml +
        noteHtml +
        tagChips(post) +
        actions +
      `</div>` +
      goingPanelHtml(post) +
      likersPanelHtml(post) +
      commentsPanelHtml(post);
    wireReadMore(el, post);
    wireCalendar(el, post);
    wireGoing(el, post, opts);
    wireLikes(el, post, opts);
    wireComments(el, post, opts);
    return el;
  }

  function wirePhoto(el, img) {
    const fig = el.querySelector('.photo');
    if (!fig) return;
    const open = () => openLightbox(img.src, img.alt);
    fig.addEventListener('click', open);
    fig.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
  }

  /* ── Comments ────────────────────────────────────────────────────────────
     A quiet thread that expands below the entry from the comment glyph on the
     LEFT of the action row (see cardActionsHtml), nested under the post on the
     same left axis with a small avatar + name + text. The panel animates
     open/shut with the site's easing (a grid-rows reveal, see .comments-panel).
     Commenting is friends-only (see canComment) — the thread is omitted on posts
     by people you're not friends with. */
  /* ── Likes: the author's private "who liked" panel ─────────────────────────
     Owner-only. The heart on the author's own card opens this list (same grid-
     rows reveal as the comment thread) — a friend's card has no heart-panel and
     no count at all, only a heart they can fill. */
  function likerItemHtml(l) {
    const u = Store.user(l.user);
    const name = esc(u ? u.name : l.user);
    return `<li class="comment liker">` +
        `<a class="comment-avatar-link" href="#/u/${esc(encodeURIComponent(l.user))}" aria-label="${name}">` +
          avatarEl(u || { name: l.user }, { cls: 'comment-avatar' }) +
        `</a>` +
        `<div class="comment-body">` +
          `<p class="comment-text"><a class="comment-name" href="#/u/${esc(encodeURIComponent(l.user))}">${name}</a></p>` +
        `</div>` +
      `</li>`;
  }

  function likersPanelHtml(post) {
    if (post.author !== Store.session()) return '';    // only the author sees who liked
    const list = Store.likesFor(post.id);
    const open = openLikers.has(post.id);
    return `<div class="likers-panel${open ? ' open' : ''}">` +
        `<div class="comments-inner">` +
          `<div class="comments-content">` +
            (list.length
              ? `<ul class="likers-list">${list.map(likerItemHtml).join('')}</ul>`
              : `<p class="likers-empty">No likes yet, and that’s just fine.</p>`) +
          `</div>` +
        `</div>` +
      `</div>`;
  }

  // A card's panels (who's going, who liked, and the comment thread) are
  // mutually exclusive — opening one collapses the others, so the card never
  // grows two threads at once. Each just clears the others' open-state +
  // reverts its toggle button.
  function collapseLikers(el, id) {
    openLikers.delete(id);
    el.querySelector('.card-like--owner')?.setAttribute('aria-expanded', 'false');
    el.querySelector('.likers-panel')?.classList.remove('open');
  }
  function collapseComments(el, id) {
    openComments.delete(id);
    el.querySelector('.card-comment')?.setAttribute('aria-expanded', 'false');
    el.querySelector('.comments-panel')?.classList.remove('open');
  }
  function collapseGoing(el, id) {
    openGoing.delete(id);
    el.querySelector('.card-goingcount')?.setAttribute('aria-expanded', 'false');
    el.querySelector('.going-panel')?.classList.remove('open');
  }

  // Build a one-event .ics and hand it to the browser as a download — the OS
  // routes it to the default calendar app, so this works the same on iOS,
  // Android, and desktop with no per-platform URL schemes. Times are written
  // "floating" (no zone): 6:30 PM means 6:30 PM wherever you are, which is the
  // only sane reading of a plan made between friends in the same place.
  function icsForPost(post) {
    const icsEsc = (s) => String(s).replace(/\\/g, '\\\\').replace(/[,;]/g, '\\$&').replace(/\n/g, '\\n');
    const day = post.eventDate.replaceAll('-', '');
    let when;
    if (post.eventTime) {
      const [h, m] = post.eventTime.split(':').map(Number);
      const start = new Date(+post.eventDate.slice(0, 4), +post.eventDate.slice(5, 7) - 1,
                             +post.eventDate.slice(8, 10), h, m);
      const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);   // default 2h, edit in-app
      const fmt = (d) => d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') +
        String(d.getDate()).padStart(2, '0') + 'T' + String(d.getHours()).padStart(2, '0') +
        String(d.getMinutes()).padStart(2, '0') + '00';
      when = `DTSTART:${fmt(start)}\r\nDTEND:${fmt(end)}`;
    } else {
      when = `DTSTART;VALUE=DATE:${day}`;                       // all-day
    }
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Tria//EN', 'BEGIN:VEVENT',
      `UID:${post.id}@tria`, `DTSTAMP:${stamp}`, when,
      `SUMMARY:${icsEsc(post.title || 'Tria activity')}`,
      post.location ? `LOCATION:${icsEsc(post.location)}` : '',
      'END:VEVENT', 'END:VCALENDAR'].filter(Boolean).join('\r\n');
  }

  function wireCalendar(el, post) {
    const btn = el.querySelector('.card-cal');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const blob = new Blob([icsForPost(post)], { type: 'text/calendar' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = (post.title || 'activity').toLowerCase()
        .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) + '.ics';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    });
  }

  function wireGoing(el, post, opts) {
    // The count ("3 going") opens the who's-going panel — pure CSS reveal, same
    // grid-rows ease as the comment thread, for author and friends alike.
    const countBtn = el.querySelector('.card-goingcount');
    const panel = el.querySelector('.going-panel');
    if (countBtn && panel) {
      countBtn.addEventListener('click', () => {
        const open = openGoing.has(post.id);
        if (open) openGoing.delete(post.id); else openGoing.add(post.id);
        if (!open) { collapseComments(el, post.id); collapseLikers(el, post.id); }
        countBtn.setAttribute('aria-expanded', String(!open));
        panel.classList.toggle('open', !open);
      });
    }

    // The hand-up toggle (friends only). Flipping it changes the public count
    // AND the who's-going list, so the card is rebuilt in place — no rise flash,
    // same pattern as adding a comment.
    const toggleBtn = el.querySelector('.card-going');
    if (!toggleBtn) return;
    toggleBtn.addEventListener('click', async () => {
      toggleBtn.disabled = true;
      const res = await Store.toggleGoing(post.id);
      toggleBtn.disabled = false;
      if (!res.ok) return;
      const fresh = makeCard(post, opts);
      fresh.style.animation = 'none';
      el.replaceWith(fresh);
    });
  }

  function wireLikes(el, post, opts) {
    const btn = el.querySelector('.card-like');
    if (!btn) return;

    // Author: the heart is a toggle for the "who liked" panel — pure CSS reveal,
    // no rebuild, so it eases like the comment thread. (opts is unused here but
    // kept for symmetry with wireComments.)
    if (post.author === Store.session()) {
      const panel = el.querySelector('.likers-panel');
      btn.addEventListener('click', () => {
        const open = openLikers.has(post.id);
        if (open) openLikers.delete(post.id); else openLikers.add(post.id);
        if (!open) { collapseComments(el, post.id); collapseGoing(el, post.id); }   // one panel at a time
        btn.setAttribute('aria-expanded', String(!open));
        panel?.classList.toggle('open', !open);
      });
      return;
    }

    // Friend: toggle my own like. The count belongs to the author, not to me, so
    // there's nothing on my card to recompute — just flip the heart in place (no
    // card rebuild, no rise-flash).
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const res = await Store.toggleLike(post.id);
      btn.disabled = false;
      if (!res.ok) return;
      btn.classList.toggle('liked', res.liked);
      btn.setAttribute('aria-pressed', String(res.liked));
      btn.setAttribute('aria-label', res.liked ? 'Unlike' : 'Like');
      btn.setAttribute('title', res.liked ? 'Liked' : 'Like');
    });
  }

  function commentItemHtml(c) {
    const u = Store.user(c.author);
    const name = esc(u ? u.name : c.author);
    const own = c.author === Store.session();
    return `<li class="comment">` +
        `<a class="comment-avatar-link" href="#/u/${esc(encodeURIComponent(c.author))}" aria-label="${name}">` +
          avatarEl(u || { name: c.author }, { cls: 'comment-avatar' }) +
        `</a>` +
        `<div class="comment-body">` +
          `<p class="comment-text">` +
            `<a class="comment-name" href="#/u/${esc(encodeURIComponent(c.author))}">${name}</a> ` +
            esc(c.text) +
          `</p>` +
          `<p class="comment-meta">${esc(niceDate(c.date))}</p>` +
        `</div>` +
        // Delete uses the same trash glyph as the post controls (right-aligned).
        (own
          ? `<button class="comment-delete" type="button" data-comment="${esc(c.id)}" ` +
              `aria-label="Delete this comment" title="Delete comment">${svgIcon('trash')}</button>`
          : '') +
      `</li>`;
  }

  // The collapsible thread itself. Open state lives in `openComments` so it
  // survives a card rebuild; the .open class (not [hidden]) drives the animation.
  function commentsPanelHtml(post) {
    if (!canComment(post)) return '';   // friends-only: no thread on a non-friend's post
    const list = Store.commentsFor(post.id);
    const open = openComments.has(post.id);
    // .comments-inner is the collapsing grid child — it holds NO padding/border
    // (that would keep it from reaching 0 height); all spacing + the left rule
    // live on .comments-content inside it.
    return `<div class="comments-panel${open ? ' open' : ''}">` +
        `<div class="comments-inner">` +
          `<div class="comments-content">` +
            (list.length ? `<ul class="comments-list">${list.map(commentItemHtml).join('')}</ul>` : '') +
            `<form class="comment-form">` +
              `<input type="text" name="text" maxlength="300" placeholder="Add a comment…" required>` +
              `<button type="submit">Post</button>` +
            `</form>` +
          `</div>` +
        `</div>` +
      `</div>`;
  }

  function wireComments(el, post, opts) {
    const toggle = el.querySelector('.card-comment');
    const panel = el.querySelector('.comments-panel');
    if (!toggle || !panel) return;

    // Expand/collapse is pure CSS (grid-rows + opacity) — no rebuild, so it
    // eases like the rest of the site.
    toggle.addEventListener('click', () => {
      const open = openComments.has(post.id);
      if (open) openComments.delete(post.id); else openComments.add(post.id);
      if (!open) { collapseLikers(el, post.id); collapseGoing(el, post.id); }   // one panel at a time
      toggle.setAttribute('aria-expanded', String(!open));
      panel.classList.toggle('open', !open);
    });

    // Adding/removing a comment changes the list + the count, so the card is
    // rebuilt. We swap just this card in place so the surrounding feed/column
    // doesn't re-animate — except your OWN posts, whose edit/delete controls are
    // wired at the page level (see renderUser), so those go through `refresh`.
    const apply = () => {
      openComments.add(post.id);
      if (opts.owner && opts.refresh) { opts.refresh(); return; }
      const fresh = makeCard(post, opts);
      fresh.style.animation = 'none';               // no rise flash on an in-place swap
      el.replaceWith(fresh);
      fresh.querySelector('.comment-form input')?.focus();
    };

    panel.querySelector('.comment-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const res = await Store.addComment(post.id, e.target.elements.text.value);
      if (res.ok) apply();
    });

    panel.querySelectorAll('.comment-delete').forEach(btn =>
      btn.addEventListener('click', async () => {
        if (!window.confirm('Delete this comment?')) return;
        await Store.deleteComment(btn.dataset.comment);
        apply();
      }));
  }

  // ── Inline edit (text only) ───────────────────────────────────────────────
  // The post whose card is currently swapped for an edit form, or null. Only one
  // at a time; reset on any navigation (see route()).
  let editingId = null;

  // Which posts' comment panels are expanded. A card rebuilds on every add/
  // delete (same full-refresh pattern as edit/delete elsewhere), so this is
  // what keeps a panel open across that refresh.
  const openComments = new Set();

  // Which authors' "who liked" panels are expanded — the like-side twin of
  // openComments, surviving the same in-place card rebuilds.
  const openLikers = new Set();

  // Which posts have their long-note "Read more" tail expanded — same role as
  // openComments, keeping a panel open across an in-place card rebuild.
  const openReadMore = new Set();

  // Which activities' "who's going" panels are expanded — the headcount's twin
  // of openLikers, surviving the same in-place card rebuilds.
  const openGoing = new Set();

  // Set when an Updates row is tapped: the profile render scrolls this post
  // into view and gives it a brief wash, so the update visibly lands somewhere.
  let spotlightPost = null;

  // The editable fields for a post, prefilled from its current values. Mirrors
  // the composer's fields (minus the photo upload — captions/tags only there).
  function editFieldsFor(post) {
    const tagsInput =
      `<div class="field">` +
        `<label for="e-tags">Tags</label>` +
        `<input id="e-tags" type="text" autocapitalize="none" ` +
          `value="${esc((post.tags || []).join(', '))}" placeholder="garden, clay">` +
        `<p class="field-hint">Optional · separate with commas.</p>` +
      `</div>`;

    if (post.type === 'find') {
      return `<div class="field">` +
          `<label for="e-url">Link</label>` +
          `<input id="e-url" type="url" inputmode="url" autocapitalize="none" ` +
            `spellcheck="false" value="${esc(post.url || '')}" placeholder="https://…">` +
        `</div>` +
        `<div class="field">` +
          `<label for="e-title">Title</label>` +
          `<input id="e-title" type="text" maxlength="120" ` +
            `value="${esc(post.title || '')}" placeholder="What is it?">` +
        `</div>` +
        `<div class="field">` +
          `<label for="e-note">Why share it?</label>` +
          `<textarea id="e-note" rows="2" maxlength="400" ` +
            `placeholder="A line on why it’s worth a look.">${esc(post.note || '')}</textarea>` +
        `</div>` + tagsInput;
    }

    if (post.type === 'activity') {
      return `<div class="field">` +
          `<label for="e-title">What’s the plan?</label>` +
          `<input id="e-title" type="text" maxlength="120" ` +
            `value="${esc(post.title || '')}" placeholder="Picnic at the park">` +
        `</div>` +
        `<div class="field">` +
          `<label for="e-date">When</label>` +
          `<div class="when-row">` +
            `<input id="e-date" type="date" placeholder="mm/dd/yyyy" value="${esc(post.eventDate || '')}">` +
            `<input id="e-time" type="time" aria-label="Time" placeholder="--:-- --" value="${esc(post.eventTime || '')}">` +
          `</div>` +
          `<p class="field-hint">Optional.</p>` +
        `</div>` +
        `<div class="field">` +
          `<label for="e-location">Where</label>` +
          `<input id="e-location" type="text" maxlength="120" ` +
            `value="${esc(post.location || '')}" placeholder="Liberty Park, by the pond">` +
        `</div>` +
        `<div class="field">` +
          `<label for="e-note">Details</label>` +
          `<textarea id="e-note" rows="2" maxlength="400" ` +
            `placeholder="When to show up, what to bring.">${esc(post.note || '')}</textarea>` +
        `</div>` + tagsInput;
    }

    if (post.type === 'photo') {
      return `<div class="field">` +
          `<label for="e-note">Caption</label>` +
          `<textarea id="e-note" rows="2" maxlength="400" ` +
            `placeholder="Say something about it (optional).">${esc(post.note || '')}</textarea>` +
        `</div>` + tagsInput;
    }

    // post
    return `<div class="field">` +
        `<label for="e-title">Headline</label>` +
        `<input id="e-title" type="text" maxlength="120" ` +
          `value="${esc(post.title || '')}" placeholder="Optional, a title for longer thoughts.">` +
      `</div>` +
      `<div class="field">` +
        `<label for="e-note">What’s on your mind?</label>` +
        `<textarea id="e-note" rows="4" maxlength="600" ` +
          `placeholder="Say it plainly.">${esc(post.note || '')}</textarea>` +
      `</div>` + tagsInput;
  }

  function makeEditCard(post) {
    const el = document.createElement('article');
    el.className = `card card--${post.type} card--editing`;
    el.innerHTML =
      `<form class="edit-form" novalidate>` +
        editFieldsFor(post) +
        `<p class="composer-error" id="e-error" role="alert"></p>` +
        `<div class="edit-actions">` +
          `<button type="button" class="edit-cancel">Cancel</button>` +
          `<button type="submit" class="composer-submit edit-save">Save changes</button>` +
        `</div>` +
      `</form>`;
    wireWhenHints(el);
    return el;
  }

  // iOS Safari leaves an empty date/time input entirely blank (no mm/dd/yyyy
  // hint), so the CSS paints the placeholder attr via ::before until a value
  // lands; this keeps the has-value flag in sync (see .when-row rules).
  function wireWhenHints(root) {
    root.querySelectorAll('input[type="date"], input[type="time"]').forEach(inp => {
      const sync = () => inp.classList.toggle('has-value', !!inp.value);
      inp.addEventListener('input', sync);
      inp.addEventListener('change', sync);
      sync();
    });
  }

  /* ── Masthead ──────────────────────────────────────────────────────────────
     The editorial nameplate that crowns each page: a small uppercase kicker
     (the issue date, or a section eyebrow) over a big Instrument Serif title,
     above a full-width hairline. Callers pass already-safe strings. */
  function mastheadEl(kicker, title) {
    return `<header class="masthead">` +
        (kicker ? `<p class="masthead-kicker">${kicker}</p>` : '') +
        `<h1 class="masthead-title">${title}</h1>` +
      `</header>`;
  }

  /* ── Home view ───────────────────────────────────────────────────────────── */
  const FILTERS = [
    { key: 'all',      label: 'All' },
    { key: 'note',     label: 'Notes' },
    { key: 'find',     label: 'Finds' },
    { key: 'photo',    label: 'Photos' },
    { key: 'activity', label: 'Activities' },
  ];
  let activeFilter = 'all';
  let activeTag = null;

  function renderHome() {
    view.innerHTML =
      `<section class="view">` +
        mastheadEl('', 'My Circle') +
        `<div class="filters" role="group" aria-label="Filter by type">` +
          FILTERS.map(f =>
            `<button class="filter" type="button" data-filter="${f.key}" ` +
              `aria-pressed="${f.key === activeFilter}">${f.label}</button>`).join('') +
        `</div>` +
        `<div class="feed" id="feed"></div>` +
      `</section>`;

    view.querySelectorAll('.filter').forEach(btn =>
      btn.addEventListener('click', () => {
        activeFilter = btn.dataset.filter;
        activeTag = null;
        renderFeed();
        view.querySelectorAll('.filter').forEach(b =>
          b.setAttribute('aria-pressed', String(b.dataset.filter === activeFilter)));
      }));

    renderFeed();
  }

  function renderFeed() {
    const feedEl = view.querySelector('#feed');
    if (!feedEl) return;
    const list = Store.feed().filter(p => {
      const typeOk = activeFilter === 'all' || p.type === activeFilter;
      const tagOk = !activeTag || (p.tags || []).includes(activeTag);
      return typeOk && tagOk;
    });

    // The Activities tab answers "what's coming up", so it sorts by EVENT date,
    // not post date: upcoming plans first (soonest on top), then undated ones
    // (newest posted), then the past (most recent happening first). Everywhere
    // else — All, profiles — activities keep their place in the timeline.
    if (activeFilter === 'activity') {
      const rank = (p) => !p.eventDate ? 1 : p.eventDate >= TODAY ? 0 : 2;
      list.sort((a, b) => {
        const ra = rank(a), rb = rank(b);
        if (ra !== rb) return ra - rb;
        if (ra !== 1 && a.eventDate !== b.eventDate) {
          const soonestFirst = a.eventDate < b.eventDate ? -1 : 1;
          return ra === 0 ? soonestFirst : -soonestFirst;
        }
        return a._ts < b._ts ? 1 : a._ts > b._ts ? -1 : 0;
      });
    }

    feedEl.innerHTML = '';
    if (!list.length) {
      // A brand-new account has no friends yet, so its Circle is genuinely empty —
      // point them at Discover rather than leaving a blank "nothing here".
      const noFilter = activeFilter === 'all' && !activeTag;
      if (noFilter && Store.friends().length === 0) {
        feedEl.innerHTML = `<div class="feed-empty feed-empty--welcome">` +
          `<p>Your circle is quiet for now.</p>` +
          `<a class="feed-empty-cta" href="#/friends">Find people to add →</a>` +
        `</div>`;
      } else {
        feedEl.innerHTML = `<p class="feed-empty">Nothing here yet.` +
          (activeTag ? ` <button class="tag" type="button" data-clear="1">clear ${esc(activeTag)}</button>` : '') +
          `</p>`;
      }
    } else {
      const frag = document.createDocumentFragment();
      list.forEach((p, i) => {
        const card = makeCard(p);
        card.style.animationDelay = Math.min(i * 0.05, 0.4).toFixed(2) + 's';
        frag.appendChild(card);
      });
      feedEl.appendChild(frag);
    }

    // Tag chips filter the feed; the active one highlights.
    feedEl.querySelectorAll('.tag[data-tag]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tag === activeTag);
      btn.addEventListener('click', () => {
        activeTag = activeTag === btn.dataset.tag ? null : btn.dataset.tag;
        renderFeed();
      });
    });
    feedEl.querySelectorAll('[data-clear]').forEach(btn =>
      btn.addEventListener('click', () => { activeTag = null; renderFeed(); }));
  }

  /* ── Auth gate (setup / login) ──────────────────────────────────────────────
     Shown whenever no one is signed in. Two modes over one form: create an
     account (display name + username + password) or log back in. On success
     we drop the gate and route home. */
  let authMode = 'signup';

  function renderAuth(mode) {
    authMode = mode;
    const isSignup = mode === 'signup';

    const nameField = isSignup
      ? `<div class="field">` +
          `<label for="f-name">Display name</label>` +
          `<input id="f-name" type="text" autocomplete="name" maxlength="40" ` +
            `placeholder="Donna Haraway" autofocus>` +
        `</div>`
      : '';
    const emailField =
      `<div class="field">` +
        `<label for="f-email">Email</label>` +
        `<input id="f-email" type="email" ` +
          `autocomplete="${isSignup ? 'email' : 'username'}" ` +
          `autocapitalize="none" spellcheck="false" ` +
          `placeholder="you@example.com"${isSignup ? '' : ' autofocus'}>` +
      `</div>`;

    view.innerHTML =
      `<section class="auth"><div class="auth-card">` +
        `<div class="auth-brand">tria</div>` +
        `<p class="auth-tag">Social Media is so back.</p>` +
        `<h1 class="auth-head">${isSignup ? 'Create your account' : 'Welcome back'}</h1>` +
        `<form id="auth-form" novalidate>` +
          nameField +
          emailField +
          (isSignup
            ? `<div class="field">` +
                `<label for="f-user">Username</label>` +
                `<div class="field-user">` +
                  `<span class="at" aria-hidden="true">@</span>` +
                  `<input id="f-user" type="text" autocomplete="username" ` +
                    `autocapitalize="none" spellcheck="false" maxlength="20" ` +
                    `placeholder="donnaharaway">` +
                `</div>` +
                `<p class="field-hint">Lowercase letters, numbers or _.</p>` +
              `</div>`
            : '') +
          `<div class="field">` +
            `<label for="f-pass">Password</label>` +
            `<input id="f-pass" type="password" ` +
              `autocomplete="${isSignup ? 'new-password' : 'current-password'}" ` +
              `placeholder="••••••">` +
          `</div>` +
          `<p class="auth-error" id="auth-error" role="alert"></p>` +
          `<button class="auth-submit" type="submit">` +
            `${isSignup ? 'Create account' : 'Log in'}</button>` +
        `</form>` +
        `<p class="auth-alt">` +
          `${isSignup ? 'Already have an account?' : 'New to Tria?'} ` +
          `<button type="button" id="auth-toggle">` +
            `${isSignup ? 'Log in' : 'Create one'}</button>` +
        `</p>` +
        `<p class="auth-about"><a href="#/about">What is Tria?</a></p>` +
      `</div></section>`;

    const nameInput = document.getElementById('f-name');
    const errEl = document.getElementById('auth-error');
    const submitBtn = document.querySelector('.auth-submit');
    document.getElementById('auth-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('f-email').value;
      const password = document.getElementById('f-pass').value;
      errEl.textContent = '';
      submitBtn.disabled = true;
      submitBtn.textContent = isSignup ? 'Creating…' : 'Logging in…';
      const res = isSignup
        ? await Store.signup({ name: nameInput.value, username: document.getElementById('f-user').value, email, password })
        : await Store.login(email, password);
      if (!res.ok) {
        errEl.textContent = res.error;
        submitBtn.disabled = false;
        submitBtn.textContent = isSignup ? 'Create account' : 'Log in';
        return;
      }
      go('#/');
    });

    // Toggle signup ⇄ login through the same soft blur-dissolve the pages use, so
    // the switch feels like part of the app rather than an instant redraw.
    document.getElementById('auth-toggle').addEventListener('click',
      () => renderPage(-1, () => renderAuth(isSignup ? 'login' : 'signup')));
  }

  /* ── Profile (own account or any friend, at #/u/username) ─────────────────────
     One view renders both: the signed-in identity + their posts as a single-
     author column. Your own profile carries a Log out; a friend's carries a
     an Add-friend toggle and a way back to the directory. */
  function renderUser(username) {
    const u = Store.user(username);
    if (!u) { location.hash = '#/'; return; }          // stale link → home
    const isSelf = u.username === Store.session();
    const isFriend = Store.isFriend(u.username);
    // A non-friend can browse a profile's posts/finds/photos, but activities are
    // circle business — hidden until you've added each other.
    const list = Store.postsBy(u.username)
      .filter(p => p.type !== 'activity' || isSelf || isFriend);
    // Own profile carries a "copy my link to share" action; a friend's carries the
    // Add-friend toggle. (Log out moves to the foot of your own column, below.)
    const action = isSelf
      ? `<div class="account-actions">` +
          `<button class="account-edit" type="button" id="edit-profile">` +
            svgIcon('pencil', 'account-edit-ico') +
            `<span>Edit profile</span>` +
          `</button>` +
          `<button class="account-share" type="button" id="share">` +
            svgIcon('share', 'account-share-ico') +
            `<span class="account-share-label">Share</span>` +
          `</button>` +
        `</div>`
      : `<button class="friend-btn" type="button" id="friend" ` +
          `aria-pressed="${isFriend}">${isFriend ? 'Friends' : 'Add friend'}</button>`;

    const count = `${list.length} ${list.length === 1 ? 'post' : 'posts'}`;
    const friendCount = Store.friends().length;
    const stats = isSelf
      ? `${count} <span class="dot">·</span> ${friendCount} ${friendCount === 1 ? 'friend' : 'friends'}`
      : count;

    view.innerHTML =
      `<section class="view">` +
        (isSelf ? '' : (() => { const b = backTarget();
          return `<a class="profile-back" href="${b.href}">← ${esc(b.label)}</a>`; })()) +
        `<div class="account${u.avatar ? ' account--photo' : ''}">` +
          // The photo is the statement; its colour spills into the ambient page
          // wash behind everything (see applyAmbient), so the header stays clean.
          `<div class="account-id">` +
            `<div class="account-figure">` +
              avatarEl(u, { cls: 'account-avatar' }) +
              (isSelf
                ? `<button class="account-photo-edit" type="button" id="edit-photo" ` +
                    `aria-label="Change your photo" title="Change your photo">` +
                    svgIcon('camera', 'account-photo-ico') + `</button>`
                : '') +
            `</div>` +
            `<h1 class="view-title">${esc(u.name)}</h1>` +
            `<p class="view-sub">@${esc(u.username)}</p>` +
            (u.bio ? `<p class="account-bio">${esc(u.bio)}</p>` : '') +
            `<p class="profile-stats">${stats}</p>` +
            action +
          `</div>` +
        `</div>` +
        `<div class="feed" id="feed"></div>` +
        // Log out lives at the very bottom, under your posts — a quiet exit once
        // you've scrolled your column, not a header action competing with Share.
        (isSelf
          ? `<div class="account-foot">` +
              `<button class="account-logout" type="button" id="logout">Log out</button>` +
            `</div>`
          : '') +
      `</section>`;

    // Their posts as a single-author column (slim date line, not a repeated
    // byline). Photos keep the lightbox; tags jump to the home feed filtered.
    const feedEl = view.querySelector('#feed');
    if (!list.length) {
      feedEl.innerHTML = `<p class="feed-empty">` +
        `${isSelf ? 'Nothing posted yet. Whenever you’re ready.' : 'Nothing here yet.'}</p>`;
    } else {
      const frag = document.createDocumentFragment();
      list.forEach((p, i) => {
        const card = (isSelf && p.id === editingId)
          ? makeEditCard(p)
          : makeCard(p, { solo: true, owner: isSelf, refresh: () => renderUser(username) });
        card.style.animationDelay = Math.min(i * 0.05, 0.4).toFixed(2) + 's';
        frag.appendChild(card);
      });
      feedEl.appendChild(frag);
    }

    // An Updates row targeted this post: bring it into view with a brief wash,
    // so the tap visibly lands on the thing that changed. (Delayed a beat: the
    // router resets scroll to the top right after this render.)
    if (spotlightPost) {
      const target = feedEl.querySelector(`[data-id="${spotlightPost}"]`);
      spotlightPost = null;
      if (target) setTimeout(() => {
        target.scrollIntoView({ block: 'center', behavior: prefersReduced() ? 'auto' : 'smooth' });
        target.style.transition = 'background-color 0.5s var(--ease-soft)';
        target.style.borderRadius = 'var(--radius)';
        target.style.backgroundColor = 'color-mix(in srgb, var(--accent) 8%, transparent)';
        setTimeout(() => { target.style.backgroundColor = 'transparent'; }, 1400);
        setTimeout(() => {
          target.style.transition = target.style.backgroundColor = target.style.borderRadius = '';
        }, 2100);
      }, 120);
    }

    // Owner controls (own profile only) — edit swaps the card for a form; delete
    // confirms then removes. Both re-render the column in place.
    feedEl.querySelectorAll('.card-edit').forEach(btn =>
      btn.addEventListener('click', () => {
        editingId = btn.dataset.edit;
        renderUser(username);
      }));

    feedEl.querySelectorAll('.card-delete').forEach(btn =>
      btn.addEventListener('click', async () => {
        if (!window.confirm('Delete this post? This can’t be undone.')) return;
        await Store.deletePost(btn.dataset.del);
        renderUser(username);
      }));

    const editForm = feedEl.querySelector('.edit-form');
    if (editForm) {
      editForm.querySelector('.edit-cancel').addEventListener('click', () => {
        editingId = null;
        renderUser(username);
      });
      editForm.addEventListener('submit', (e) => {
        e.preventDefault();
        submitEdit(editingId, username);
      });
      editForm.querySelector('#e-note')?.focus();
    }
    feedEl.querySelectorAll('.tag[data-tag]').forEach(btn =>
      btn.addEventListener('click', () => {
        activeFilter = 'all';
        activeTag = btn.dataset.tag;
        location.hash = '#/';
      }));

    const friendBtn = document.getElementById('friend');
    if (friendBtn) friendBtn.addEventListener('click', async () => {
      if (Store.isFriend(u.username)) await Store.removeFriend(u.username);
      else await Store.addFriend(u.username);
      renderUser(username);      // reflect the new state in place
    });

    const shareBtn = document.getElementById('share');
    if (shareBtn) shareBtn.addEventListener('click', () => {
      const label = shareBtn.querySelector('.account-share-label');
      copyText(profileLink(u.username)).then(ok => {
        shareBtn.classList.add('copied');
        label.textContent = ok ? 'Link copied' : `@${u.username}`;
        clearTimeout(shareBtn._t);
        shareBtn._t = setTimeout(() => {
          shareBtn.classList.remove('copied');
          label.textContent = 'Share';
        }, 1800);
      });
    });

    const logoutBtn = document.getElementById('logout');
    if (logoutBtn) logoutBtn.addEventListener('click', async () => {
      await Store.logout();
      authMode = 'login';        // returning user — offer login first
      go('#/');
    });

    const editPhotoBtn = document.getElementById('edit-photo');
    if (editPhotoBtn) editPhotoBtn.addEventListener('click',
      () => openAvatarEditor(() => renderUser(username)));

    const editProfileBtn = document.getElementById('edit-profile');
    if (editProfileBtn) editProfileBtn.addEventListener('click',
      () => openProfileEditor(() => renderUser(username)));
  }

  /* ── Avatar editor ───────────────────────────────────────────────────────
     A small frosted modal for setting your profile photo: pick → square crop
     (reusing initCropper) → save. On save it exports a 512² JPEG data-URI and
     hands it to Store.updateAvatar, then calls `done` to re-render in place. */
  function openAvatarEditor(done) {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Change your photo');
    modal.innerHTML =
      `<div class="modal-card">` +
        `<h2 class="modal-title">Your photo</h2>` +
        `<input id="av-file" type="file" accept="image/*" hidden>` +
        `<div class="dropzone" id="av-drop">` +
          `<button type="button" class="dropzone-btn" id="av-pick">Choose a photo</button>` +
          `<p class="field-hint">JPG or PNG · cropped to a square.</p>` +
        `</div>` +
        `<div class="crop crop--avatar" id="av-crop" hidden>` +
          `<img id="av-cropimg" alt="" draggable="false">` +
          `<span class="crop-hint">Drag to reposition</span>` +
        `</div>` +
        `<button type="button" class="crop-replace" id="av-replace" hidden>Replace photo</button>` +
        `<p class="composer-error" id="av-error" role="alert"></p>` +
        `<div class="modal-actions">` +
          `<button type="button" class="edit-cancel" id="av-cancel">Cancel</button>` +
          `<button type="button" class="composer-submit" id="av-save" disabled>Save photo</button>` +
        `</div>` +
      `</div>`;
    document.body.appendChild(modal);
    document.body.style.overflow = 'hidden';

    const fileEl = modal.querySelector('#av-file');
    const dropEl = modal.querySelector('#av-drop');
    const cropEl = modal.querySelector('#av-crop');
    const imgEl = modal.querySelector('#av-cropimg');
    const replaceEl = modal.querySelector('#av-replace');
    const saveEl = modal.querySelector('#av-save');
    const errEl = modal.querySelector('#av-error');
    let avCropper = null;

    const close = () => {
      document.body.style.overflow = '';
      document.removeEventListener('keydown', onEsc);
      modal.remove();
    };
    const onEsc = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onEsc);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    modal.querySelector('#av-cancel').addEventListener('click', close);

    const pick = () => fileEl.click();
    modal.querySelector('#av-pick').addEventListener('click', pick);
    replaceEl.addEventListener('click', pick);
    dropEl.addEventListener('click', (e) => { if (e.target === dropEl) pick(); });

    fileEl.addEventListener('change', () => {
      const f = fileEl.files && fileEl.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        dropEl.hidden = true;
        cropEl.hidden = false;
        replaceEl.hidden = false;
        saveEl.disabled = false;
        avCropper = initCropper(cropEl, imgEl, reader.result);
      };
      reader.readAsDataURL(f);
    });

    saveEl.addEventListener('click', () => {
      if (!avCropper) return;
      // Optimistic: updateAvatar sets the cache to the local crop synchronously, so
      // closing + re-rendering now shows the new photo instantly. The upload runs in
      // the background; if it fails, the store reverts and we re-render + toast.
      const pending = Store.updateAvatar(avCropper.export(512));
      close();
      done();
      pending.then(res => { if (!res.ok) { done(); toast(res.error); } });
    });
  }

  /* ── Profile editor ──────────────────────────────────────────────────────
     A sibling of the avatar editor for the words: display name + bio. Saves via
     Store.updateProfile, then calls `done` to re-render the profile in place.
     (The photo has its own editor, reached from the avatar's camera button.) */
  function openProfileEditor(done) {
    const u = Store.currentUser();
    if (!u) return;
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Edit profile');
    modal.innerHTML =
      `<div class="modal-card">` +
        `<h2 class="modal-title">Edit profile</h2>` +
        `<form id="pf-form" novalidate>` +
          `<div class="field">` +
            `<label for="pf-name">Display name</label>` +
            `<input id="pf-name" type="text" maxlength="40" ` +
              `value="${esc(u.name)}" placeholder="Your name" autocomplete="name">` +
          `</div>` +
          `<div class="field">` +
            `<label for="pf-bio">Bio</label>` +
            `<textarea id="pf-bio" rows="3" maxlength="160" ` +
              `placeholder="A line about you (optional).">${esc(u.bio || '')}</textarea>` +
            `<p class="field-hint" id="pf-count"></p>` +
          `</div>` +
          `<p class="composer-error" id="pf-error" role="alert"></p>` +
          `<div class="modal-actions">` +
            `<button type="button" class="edit-cancel" id="pf-cancel">Cancel</button>` +
            `<button type="submit" class="composer-submit" id="pf-save">Save</button>` +
          `</div>` +
        `</form>` +
      `</div>`;
    document.body.appendChild(modal);
    document.body.style.overflow = 'hidden';

    const nameEl = modal.querySelector('#pf-name');
    const bioEl = modal.querySelector('#pf-bio');
    const countEl = modal.querySelector('#pf-count');
    const errEl = modal.querySelector('#pf-error');

    const close = () => {
      document.body.style.overflow = '';
      document.removeEventListener('keydown', onEsc);
      modal.remove();
    };
    const onEsc = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onEsc);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    modal.querySelector('#pf-cancel').addEventListener('click', close);

    // A quiet live count so the 160-char bio ceiling never feels like a surprise.
    const updateCount = () => {
      countEl.textContent = `${bioEl.value.length} / 160`;
    };
    bioEl.addEventListener('input', updateCount);
    updateCount();

    modal.querySelector('#pf-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const res = await Store.updateProfile({ name: nameEl.value, bio: bioEl.value });
      if (!res.ok) { errEl.textContent = res.error; return; }
      close();
      done();
    });

    nameEl.focus();
    nameEl.select();
  }

  // The "← Back" link atop a friend's profile points wherever you came from
  // (home, Friends, your own profile…), not always Friends. `profileOrigin` is
  // set by the router when you enter a profile from a non-profile page.
  function backTarget() {
    const labels = {
      '#/': 'My Circle',
      '#/friends': 'Friends',
      '#/profile': 'Profile',
    };
    const href = labels[profileOrigin] ? profileOrigin : '#/friends';
    return { href, label: labels[href] || 'Back' };
  }

  // A shareable link straight to someone's profile. Uses the current origin +
  // path so it works wherever the prototype is served, with the #/u/ route the
  // recipient lands on. Falls back to a bare @handle if there's no http origin.
  function profileLink(username) {
    const base = /^https?:/.test(location.origin)
      ? location.origin + location.pathname
      : '';
    return base ? `${base}#/u/${encodeURIComponent(username)}` : `@${username}`;
  }

  // Copy text to the clipboard, resolving true/false. Prefers the async
  // Clipboard API, with an execCommand fallback for non-secure contexts.
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(() => true, () => false);
    }
    return new Promise((resolve) => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      ta.remove();
      resolve(ok);
    });
  }

  // A brief, quiet notice at the bottom of the screen — used for background
  // failures (e.g. an optimistic action that didn't reach the server).
  let toastTimer = null;
  function toast(msg) {
    let el = document.querySelector('.toast');
    if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
    el.textContent = msg;
    el.classList.remove('show');
    void el.offsetWidth;                 // restart the transition if one's mid-flight
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3400);
  }

  /* ── Friends (your mutual circle) + Discover (people you haven't added) ─────── */
  function renderFriends() {
    const me = Store.session();
    const friendSet = new Set(Store.friends());
    const byName = (a, b) => a.name.localeCompare(b.name);

    const friends = Store.friends().map(Store.user).filter(Boolean).sort(byName);
    // Everyone signed up who isn't you and isn't already a friend.
    const discover = Store.users()
      .filter(u => u.username !== me && !friendSet.has(u.username))
      .sort(byName);

    // A directory row. `discover` rows swap the go-arrow for an Add button so
    // you can add someone without leaving the page.
    const row = (u, add) =>
      `<a class="friend" href="#/u/${encodeURIComponent(u.username)}">` +
        avatarEl(u, { cls: 'friend-avatar' }) +
        `<span class="friend-text">` +
          `<span class="friend-name">${esc(u.name)}</span>` +
          `<span class="friend-user">@${esc(u.username)}</span>` +
          (u.bio ? `<span class="friend-bio">${esc(u.bio)}</span>` : '') +
        `</span>` +
        (add
          ? `<button class="friend-add" type="button" data-add="${esc(u.username)}" ` +
              `aria-label="Add ${esc(u.name)} as a friend">Add</button>`
          : `<span class="friend-go" aria-hidden="true">→</span>`) +
      `</a>`;

    const circleCount = `${friends.length} ${friends.length === 1 ? 'friend' : 'friends'} in your circle`;
    view.innerHTML =
      `<section class="view">` +
        mastheadEl(circleCount, 'Friends') +
        (friends.length
          ? `<div class="friends-list">` + friends.map(u => row(u, false)).join('') + `</div>`
          : `<p class="feed-empty">Your circle’s empty, for now.</p>`) +
        (discover.length
          ? `<div class="discover">` +
              `<h2 class="discover-head">Find people</h2>` +
              `<div class="friends-list">` + discover.map(u => row(u, true)).join('') + `</div>` +
            `</div>`
          : '') +
      `</section>`;

    // Add from a Discover row: link up, then re-render so they move into your
    // circle. The button sits inside the row link, so stop it navigating.
    view.querySelectorAll('.friend-add').forEach(btn =>
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        btn.disabled = true;
        await Store.addFriend(btn.dataset.add);
        renderFriends();
      }));
  }

  /* ── Updates — a quiet ledger, visited on your own time ────────────────────
     A reverse-chronological list of what friends did on YOUR posts: comments,
     likes, hands-up on activities. Deliberately pull-based: no badge, no count
     on the nav, no push — the tab tells you nothing until you choose to look.
     "Read" state is just a soft dot on anything newer than your last visit,
     remembered per-account in localStorage (this device only, and that's fine
     for a signal this gentle). */
  const notifSeenKey = () => `tria:updates-seen:${Store.session()}`;

  // "…liked ‘Metalheart’" — name the post by its title or a note snippet, so a
  // row is recognisable without leaving the list.
  function notifPostLabel(post) {
    if (!post) return 'a post';
    const t = post.title || post.note || '';
    const snip = t.length > 44 ? t.slice(0, 44).trimEnd() + '…' : t;
    if (snip) return `“${snip}”`;
    return post.type === 'photo' ? 'your photo' : 'your post';
  }

  function notifItemHtml(n, lastSeen) {
    const u = Store.user(n.user);
    const name = esc(u ? u.name : n.user);
    const post = Store.posts().find(p => p.id === n.postId);
    const label = esc(notifPostLabel(post));
    const quote = n.kind === 'comment'
      ? esc(n.text.length > 90 ? n.text.slice(0, 90).trimEnd() + '…' : n.text)
      : '';
    const what =
      n.kind === 'comment' ? `commented on ${label}` :
      n.kind === 'like'    ? `liked ${label}` :
                             `is in for ${label}`;
    const fresh = n._ts && n._ts > lastSeen;
    return `<li>` +
        `<a class="notif${fresh ? ' notif--new' : ''}" href="#/profile" ` +
          `data-post="${esc(n.postId)}" data-kind="${n.kind}">` +
          avatarEl(u || { name: n.user }, { cls: 'comment-avatar' }) +
          `<span class="notif-body">` +
            `<span class="notif-text"><strong>${name}</strong> ${what}</span>` +
            (quote ? `<span class="notif-quote">${quote}</span>` : '') +
            (n._ts ? `<span class="notif-date">${esc(niceDate(dayMT(n._ts)))}</span>` : '') +
          `</span>` +
          `<span class="notif-dot" aria-hidden="true"></span>` +
        `</a>` +
      `</li>`;
  }

  function renderUpdates() {
    const list = Store.notifications();
    const lastSeen = localStorage.getItem(notifSeenKey()) || '';
    view.innerHTML =
      `<section class="view">` +
        mastheadEl('', 'Updates') +
        (list.length
          ? `<ul class="notif-list">${list.map(n => notifItemHtml(n, lastSeen)).join('')}</ul>`
          : `<p class="feed-empty">All quiet. When a friend likes, comments, or raises a hand, it lands here.</p>`) +
      `</section>`;

    // A row walks you to the post itself (your profile column) with the right
    // panel already open — the comment thread, who liked, or who's going —
    // and the profile render scrolls that card into view (see spotlightPost).
    view.querySelectorAll('.notif').forEach(row =>
      row.addEventListener('click', () => {
        const id = row.dataset.post;
        openComments.delete(id); openLikers.delete(id); openGoing.delete(id);
        if (row.dataset.kind === 'comment') openComments.add(id);
        else if (row.dataset.kind === 'like') openLikers.add(id);
        else openGoing.add(id);
        spotlightPost = id;
      }));

    // Everything on screen has now been seen — next visit, the dots move on.
    if (list.length && list[0]._ts) localStorage.setItem(notifSeenKey(), list[0]._ts);
  }

  /* ── Publish (composer) ───────────────────────────────────────────────────
     One form, three types. The type picker reuses the home filter chips (same
     colored language); the fields below swap per type. Photos get a real upload,
     shown and posted at their native aspect ratio (no crop). On publish we route
     home so the new entry animates in at the top of the feed. */
  const PUB_TYPES = [
    { key: 'note',     label: 'Note'     },
    { key: 'find',     label: 'Find'     },
    { key: 'photo',    label: 'Photo'    },
    { key: 'activity', label: 'Activity' },
  ];
  let pubType = 'note';
  let cropper = null;   // set once a photo is chosen; .export() → data-URI

  // A rotating cast of example tags for the composer's Tags placeholder — two
  // picked at random each time the field mounts, so it never goes stale.
  const TAG_PLACEHOLDERS = [
    'garden', 'clay', 'vinyl', 'sourdough', 'thrifted',
    'cold plunge', 'group chat', 'road trip', 'gremlin era', 'reading nook',
    'review', 'hobbies', 'gaming', 'painting',
  ];
  const randomTagPlaceholder = () =>
    [...TAG_PLACEHOLDERS].sort(() => Math.random() - 0.5).slice(0, 2).join(', ');

  // Same trick for the post composer's note field — one of a few voices picked
  // at random each time it mounts, so the empty field never feels flat.
  const NOTE_PLACEHOLDERS = [
    'speak your truth.',
    'what’s on your mind?',
    'say it like it’s going in the group chat',
    'hot take?',
    'what’s the vibe?',
    'what’s happening?',
  ];
  const randomNotePlaceholder = () =>
    NOTE_PLACEHOLDERS[Math.floor(Math.random() * NOTE_PLACEHOLDERS.length)];

  function fieldsFor(type) {
    const tags =
      `<div class="field">` +
        `<label for="c-tags">Tags</label>` +
        `<input id="c-tags" type="text" autocapitalize="none" ` +
          `placeholder="${randomTagPlaceholder()}">` +
        `<p class="field-hint">Optional · separate with commas.</p>` +
      `</div>`;

    if (type === 'find') {
      return `<div class="field">` +
          `<label for="c-url">Link</label>` +
          `<input id="c-url" type="url" inputmode="url" autocapitalize="none" ` +
            `spellcheck="false" placeholder="https://…" autofocus>` +
        `</div>` +
        `<div class="field">` +
          `<label for="c-title">Title</label>` +
          `<input id="c-title" type="text" maxlength="120" ` +
            `placeholder="What is it?">` +
        `</div>` +
        `<div class="field">` +
          `<label for="c-note">Why share it?</label>` +
          `<textarea id="c-note" rows="2" maxlength="400" ` +
            `placeholder="Why’s it worth their two minutes?"></textarea>` +
        `</div>` + tags;
    }

    if (type === 'activity') {
      return `<div class="field">` +
          `<label for="c-title">What’s the plan?</label>` +
          `<input id="c-title" type="text" maxlength="120" ` +
            `placeholder="Picnic at the park" autofocus>` +
        `</div>` +
        `<div class="field">` +
          `<label for="c-date">When</label>` +
          `<div class="when-row">` +
            `<input id="c-date" type="date" placeholder="mm/dd/yyyy">` +
            `<input id="c-time" type="time" aria-label="Time" placeholder="--:-- --">` +
          `</div>` +
          `<p class="field-hint">Optional · dated plans sort by their day.</p>` +
        `</div>` +
        `<div class="field">` +
          `<label for="c-location">Where</label>` +
          `<input id="c-location" type="text" maxlength="120" ` +
            `placeholder="Liberty Park, by the pond">` +
          `<p class="field-hint">Optional.</p>` +
        `</div>` +
        `<div class="field">` +
          `<label for="c-note">Details</label>` +
          `<textarea id="c-note" rows="2" maxlength="400" ` +
            `placeholder="When to show up, what to bring."></textarea>` +
        `</div>` + tags;
    }

    if (type === 'photo') {
      return `<div class="field">` +
          `<label>Photo</label>` +
          `<input id="c-file" type="file" accept="image/*" hidden>` +
          `<div class="dropzone" id="c-drop">` +
            `<button type="button" class="dropzone-btn" id="c-pick">Choose a photo</button>` +
            `<p class="field-hint">JPG or PNG · shown as you shot it.</p>` +
          `</div>` +
          `<div class="crop crop--free" id="c-crop" hidden>` +
            `<img id="c-cropimg" alt="" draggable="false">` +
          `</div>` +
          `<button type="button" class="crop-replace" id="c-replace" hidden>Replace photo</button>` +
        `</div>` +
        `<div class="field">` +
          `<label for="c-note">Caption</label>` +
          `<textarea id="c-note" rows="2" maxlength="400" ` +
            `placeholder="Say something, or let the photo do the talking."></textarea>` +
        `</div>` + tags;
    }

    // post
    return `<div class="field">` +
        `<label for="c-title">Headline</label>` +
        `<input id="c-title" type="text" maxlength="120" ` +
          `placeholder="Optional, a title for longer thoughts.">` +
      `</div>` +
      `<div class="field">` +
        `<label for="c-note">What’s on your mind?</label>` +
        `<textarea id="c-note" rows="4" maxlength="600" ` +
          `placeholder="${esc(randomNotePlaceholder())}" autofocus></textarea>` +
      `</div>` + tags;
  }

  function renderPublish() {
    view.innerHTML =
      `<section class="view">` +
        mastheadEl('Share to your circle', 'New Post') +
        `<form class="composer" id="composer" novalidate>` +
          `<div class="type-pick" role="group" aria-label="Post type">` +
            PUB_TYPES.map(t =>
              `<button class="filter type-opt" type="button" data-type="${t.key}" ` +
                `data-filter="${t.key}" aria-pressed="${t.key === pubType}">` +
                `${t.label}</button>`).join('') +
          `</div>` +
          `<div class="fields" id="c-fields"></div>` +
          `<p class="composer-error" id="c-error" role="alert"></p>` +
          `<button class="composer-submit publish-fill" type="submit">Post</button>` +
        `</form>` +
      `</section>`;

    const fieldsEl = view.querySelector('#c-fields');

    function mountFields() {
      cropper = null;
      fieldsEl.innerHTML = fieldsFor(pubType);
      if (pubType === 'photo') wirePhotoPicker(fieldsEl);
      if (pubType === 'activity') wireWhenHints(fieldsEl);
      view.querySelectorAll('.type-opt').forEach(b =>
        b.setAttribute('aria-pressed', String(b.dataset.type === pubType)));
    }

    view.querySelectorAll('.type-opt').forEach(btn =>
      btn.addEventListener('click', () => {
        if (btn.dataset.type === pubType) return;
        pubType = btn.dataset.type;
        document.getElementById('c-error').textContent = '';
        mountFields();
      }));

    document.getElementById('composer').addEventListener('submit', (e) => {
      e.preventDefault();
      submitComposer();
    });

    mountFields();
  }

  // File picker + full-image preview. Post photos aren't cropped — the picked
  // image is shown (and later exported) at its own aspect ratio, so there's no
  // square frame or panning here (that's only the avatar editor's job).
  function wirePhotoPicker(root) {
    const file    = root.querySelector('#c-file');
    const drop    = root.querySelector('#c-drop');
    const cropEl  = root.querySelector('#c-crop');
    const imgEl   = root.querySelector('#c-cropimg');
    const replace = root.querySelector('#c-replace');

    const pick = () => file.click();
    root.querySelector('#c-pick').addEventListener('click', pick);
    replace.addEventListener('click', pick);
    drop.addEventListener('click', (e) => { if (e.target === drop) pick(); });

    file.addEventListener('change', () => {
      const f = file.files && file.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        drop.hidden = true;
        cropEl.hidden = false;
        replace.hidden = false;
        cropper = initPhotoPreview(imgEl, reader.result);
      };
      reader.readAsDataURL(f);
    });
  }

  // A whole-image preview that keeps the photo's native aspect ratio. export()
  // downscales the longest edge to `maxEdge` (to keep upload size sane) but never
  // crops — the shape you upload is the shape that posts.
  function initPhotoPreview(imgEl, src) {
    imgEl.style.transform = '';
    imgEl.src = src;
    return {
      export(maxEdge = 1400) {
        const iw = imgEl.naturalWidth  || 1;
        const ih = imgEl.naturalHeight || 1;
        const scale = Math.min(1, maxEdge / Math.max(iw, ih));
        const w = Math.max(1, Math.round(iw * scale));
        const h = Math.max(1, Math.round(ih * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(imgEl, 0, 0, w, h);
        return canvas.toDataURL('image/jpeg', 0.82);
      },
    };
  }

  // Square cropper over an already-loaded <img> (the avatar editor only — post
  // photos use initPhotoPreview and keep their aspect). Cover-fits the image and
  // lets the user pan it within the frame; export() draws the framed region to a
  // canvas. Pan is clamped so the square stays fully covered. State lives on the
  // element (cropEl._crop) so "Replace photo" can re-init without re-wiring the
  // drag handlers (those are attached once, guarded by data-wired).
  function applyPan(cropEl) {
    const s = cropEl._crop;
    s.tx = Math.min(0, Math.max(s.square - s.dispW, s.tx));
    s.ty = Math.min(0, Math.max(s.square - s.dispH, s.ty));
    s.img.style.transform = `translate(${s.tx}px, ${s.ty}px)`;
  }

  function initCropper(cropEl, imgEl, src) {
    const s = { tx: 0, ty: 0, square: 0, scale: 1, dispW: 0, dispH: 0, img: imgEl };
    cropEl._crop = s;

    imgEl.onload = () => {
      s.square = cropEl.clientWidth || 1;
      s.scale = s.square / Math.min(imgEl.naturalWidth, imgEl.naturalHeight);
      s.dispW = imgEl.naturalWidth * s.scale;
      s.dispH = imgEl.naturalHeight * s.scale;
      imgEl.style.width = s.dispW + 'px';
      imgEl.style.height = s.dispH + 'px';
      s.tx = (s.square - s.dispW) / 2;   // center to start
      s.ty = (s.square - s.dispH) / 2;
      applyPan(cropEl);
    };
    imgEl.src = src;

    if (!cropEl.dataset.wired) {
      cropEl.dataset.wired = '1';
      let drag = null;
      cropEl.addEventListener('pointerdown', (e) => {
        const c = cropEl._crop;
        drag = { x: e.clientX, y: e.clientY, tx: c.tx, ty: c.ty };
        cropEl.setPointerCapture(e.pointerId);
        cropEl.classList.add('dragging');
      });
      cropEl.addEventListener('pointermove', (e) => {
        if (!drag) return;
        const c = cropEl._crop;
        c.tx = drag.tx + (e.clientX - drag.x);
        c.ty = drag.ty + (e.clientY - drag.y);
        applyPan(cropEl);
      });
      const end = () => { drag = null; cropEl.classList.remove('dragging'); };
      cropEl.addEventListener('pointerup', end);
      cropEl.addEventListener('pointercancel', end);
    }

    return {
      export(out = 1000) {
        const c = cropEl._crop;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = out;
        const ctx = canvas.getContext('2d');
        const srcSize = c.square / c.scale;        // source px framed by the square
        ctx.drawImage(c.img, -c.tx / c.scale, -c.ty / c.scale, srcSize, srcSize,
          0, 0, out, out);
        return canvas.toDataURL('image/jpeg', 0.82);
      },
    };
  }

  const parseTags = (str) => [...new Set(String(str || '').split(',')
    .map(t => t.trim().replace(/^#/, '').toLowerCase()).filter(Boolean))].slice(0, 6);

  async function submitComposer() {
    const errEl = document.getElementById('c-error');
    const val = (id) => (document.getElementById(id)?.value || '').trim();
    const data = { type: pubType, tags: parseTags(val('c-tags')), note: val('c-note') };

    if (pubType === 'find') {
      data.url = val('c-url');
      data.title = val('c-title');
      if (!/^https?:\/\/.+/i.test(data.url)) {
        errEl.textContent = 'Add a link starting with http:// or https://.'; return;
      }
    } else if (pubType === 'activity') {
      data.title = val('c-title');
      data.location = val('c-location');
      data.eventDate = val('c-date');
      data.eventTime = val('c-time');
      if (!data.title) {
        errEl.textContent = 'Give the activity a title first.'; return;
      }
      if (data.eventTime && !data.eventDate) {
        errEl.textContent = 'Add a date to go with that time.'; return;
      }
    } else if (pubType === 'photo') {
      if (!cropper) { errEl.textContent = 'Choose a photo first.'; return; }
      data.image = cropper.export();
    } else {
      data.title = val('c-title');
      if (!data.title && !data.note) {
        errEl.textContent = 'Write a headline or a note first.'; return;
      }
    }

    // Writes now hit the network (and, for photos, an upload), so reflect the
    // wait rather than freezing on click.
    const btn = document.querySelector('.composer-submit');
    if (btn) { btn.disabled = true; btn.textContent = 'Posting…'; }
    errEl.textContent = '';

    const res = await Store.createPost(data);
    if (!res.ok) {
      errEl.textContent = res.error;
      if (btn) { btn.disabled = false; btn.textContent = 'Post'; }
      return;
    }
    cropper = null;
    pubType = 'note';           // reset for next time
    go('#/');
  }

  // Save an inline text edit. Reads the form by type, applies the same rules as
  // the composer (a find needs a valid link; a post needs a headline or note),
  // then persists and re-renders the profile in place.
  async function submitEdit(id, username) {
    const errEl = document.getElementById('e-error');
    const val = (elId) => (document.getElementById(elId)?.value || '').trim();
    const post = Store.posts().find(p => p.id === id);
    if (!post) { editingId = null; renderUser(username); return; }

    const data = { note: val('e-note'), tags: parseTags(val('e-tags')) };

    if (post.type === 'find') {
      data.url = val('e-url');
      data.title = val('e-title');
      if (!/^https?:\/\/.+/i.test(data.url)) {
        errEl.textContent = 'Add a link starting with http:// or https://.'; return;
      }
    } else if (post.type === 'activity') {
      data.title = val('e-title');
      data.location = val('e-location');
      data.eventDate = val('e-date');
      data.eventTime = val('e-time');
      if (!data.title) {
        errEl.textContent = 'Give the activity a title first.'; return;
      }
      if (data.eventTime && !data.eventDate) {
        errEl.textContent = 'Add a date to go with that time.'; return;
      }
    } else if (post.type === 'note') {
      data.title = val('e-title');
      if (!data.title && !data.note) {
        errEl.textContent = 'Write a headline or a note first.'; return;
      }
    }
    // photo: caption + tags only, both optional (the image carries the post).

    const res = await Store.updatePost(id, data);
    if (!res.ok) { errEl.textContent = res.error; return; }
    editingId = null;
    renderUser(username);
  }

  /* ── Lightbox ────────────────────────────────────────────────────────────── */
  let lightbox = null;
  let lightboxReturn = null;   // element to restore focus to on close
  function openLightbox(src, alt) {
    if (!lightbox) {
      lightbox = document.createElement('div');
      lightbox.className = 'lightbox';
      lightbox.tabIndex = -1;
      lightbox.setAttribute('role', 'dialog');
      lightbox.setAttribute('aria-modal', 'true');
      lightbox.setAttribute('aria-label', 'Photo viewer');
      lightbox.innerHTML = '<img alt="">';
      lightbox.addEventListener('click', closeLightbox);
      document.body.appendChild(lightbox);
    }
    const im = lightbox.querySelector('img');
    im.src = src; im.alt = alt || '';
    lightboxReturn = document.activeElement;
    document.body.style.overflow = 'hidden';   // lock the page behind it
    lightbox.classList.add('open');
    lightbox.focus();
    document.addEventListener('keydown', onKey);
  }
  function closeLightbox() {
    if (!lightbox) return;
    lightbox.classList.remove('open');
    document.body.style.overflow = '';
    document.removeEventListener('keydown', onKey);
    if (lightboxReturn && lightboxReturn.focus) lightboxReturn.focus();
    lightboxReturn = null;
  }
  const onKey = (e) => { if (e.key === 'Escape') closeLightbox(); };

  /* ── Ambient wash ───────────────────────────────────────────────────────────
     The soft background glow (see .ambient) is on-brand by default. On a profile
     with a photo we sample a representative colour from that photo and feed it to
     the --glow-* CSS vars, so the page's own background picks up the person's hue
     — a gradient underneath the content, not a blurred photo layered on top. */
  const sampleCache = new Map();
  let ambientSeq = 0;

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
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
    return { h, s, l };
  }

  function hslToRgb(h, s, l) {
    if (!s) { const v = Math.round(l * 255); return { r: v, g: v, b: v }; }
    const hue = (p, q, t) => {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return {
      r: Math.round(hue(p, q, h + 1 / 3) * 255),
      g: Math.round(hue(p, q, h) * 255),
      b: Math.round(hue(p, q, h - 1 / 3) * 255),
    };
  }

  // Sample a single representative colour from an image (data-URI). Draws it tiny
  // and takes a saturation-weighted average — so a photo's signature colour leads
  // over flat greys — then normalises it to an even, gentle glow (steady hue,
  // lifted saturation, mid lightness) so dark or washed-out photos tint alike.
  function sampleColor(src) {
    if (sampleCache.has(src)) return Promise.resolve(sampleCache.get(src));
    return new Promise(resolve => {
      const img = new Image();
      // Photos now live on Supabase Storage (cross-origin). Request them with CORS
      // (the bucket serves Access-Control-Allow-Origin: *) so drawing to the canvas
      // doesn't taint it — otherwise getImageData throws and the wash never lights.
      img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      img.onload = () => {
        let out = null;
        try {
          const n = 14;
          const cv = document.createElement('canvas');
          cv.width = cv.height = n;
          const ctx = cv.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(img, 0, 0, n, n);
          const d = ctx.getImageData(0, 0, n, n).data;
          let R = 0, G = 0, B = 0, W = 0;
          for (let i = 0; i < d.length; i += 4) {
            const r = d[i], g = d[i + 1], b = d[i + 2];
            const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
            const sat = mx ? (mx - mn) / mx : 0;
            const w = sat * sat + 0.05;      // saturated pixels lead the average
            R += r * w; G += g * w; B += b * w; W += w;
          }
          const hsl = rgbToHsl(R / W, G / W, B / W);
          out = hslToRgb(hsl.h, Math.max(0.5, Math.min(0.85, hsl.s * 1.5)), 0.55);
        } catch { out = null; }
        sampleCache.set(src, out);
        resolve(out);
      };
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  // The ambient wash is a profile special: light it with a colour sampled from
  // the profile's photo, and leave every other page clean (data-ambient "none").
  // Sampling is async; a seq guard drops a stale result if you've navigated on,
  // and we hold "none" until the colour lands so nothing flashes.
  function applyAmbient(path) {
    const body = document.body;
    const seq = ++ambientSeq;

    let user = null;
    if (path.startsWith('#/u/')) user = Store.user(decodeURIComponent(path.slice(4)));
    else if (path === '#/profile') user = Store.currentUser();

    body.dataset.ambient = 'none';                 // default: no wash
    if (!user || !user.avatar) return;             // non-profile, or no photo → clean
    sampleColor(user.avatar).then(rgb => {
      if (seq !== ambientSeq) return;
      if (!rgb) return;                            // sampling failed → stay clean
      const { r, g, b } = rgb;
      body.style.setProperty('--glow-photo', `rgba(${r}, ${g}, ${b}, 0.26)`);
      body.dataset.ambient = 'photo';
    });
  }

  /* ── About (#/about) ────────────────────────────────────────────────────────
     The public front door: what Tria is, how to install it, the community
     guidelines, an FAQ, and a feedback form. Reachable from the wordmark when
     signed in AND from a link on the auth gate (route() special-cases it), so
     it renders with or without a session — `gated` adds a way back to sign-in.
     Feedback goes through FormSubmit's AJAX endpoint straight to Zoe's inbox
     (first-ever submission triggers a one-time activation email to her). */
  const FEEDBACK_ENDPOINT = 'https://formsubmit.co/ajax/zoeallgaier@gmail.com';

  const ICON_ATTRS = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
  const INSTALL_ICONS = {
    share: `<svg ${ICON_ATTRS}><path d="M12 15V3" /><path d="M8 6.5 12 3l4 3.5" />` +
      `<path d="M5 10v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-9" /></svg>`,
    more: `<svg ${ICON_ATTRS}><circle cx="12" cy="5" r="0.9" fill="currentColor" />` +
      `<circle cx="12" cy="12" r="0.9" fill="currentColor" />` +
      `<circle cx="12" cy="19" r="0.9" fill="currentColor" /></svg>`,
    add: `<svg ${ICON_ATTRS}><rect x="4" y="4" width="16" height="16" rx="3.5" />` +
      `<path d="M12 9.2v5.6" /><path d="M9.2 12h5.6" /></svg>`,
  };

  function installStep(icon, text) {
    return `<li><span class="install-icon">${icon}</span><span>${text}</span></li>`;
  }

  function renderAbout(gated) {
    const me = !gated && Store.isAuthed() ? Store.currentUser() : null;

    const installHtml =
      `<h2 class="about-head" id="install">Add Tria to your homescreen</h2>` +
      `<p>Tria lives on the web, so there is nothing to download and no store in ` +
        `between. Add it to your homescreen and it opens full screen, just like ` +
        `any other app on your phone.</p>` +
      `<div class="install-cols">` +
        `<div class="install-col"><h3>iPhone &amp; iPad <span class="install-browser">Safari</span></h3>` +
          `<ol class="install-steps">` +
          installStep(INSTALL_ICONS.share, `Tap the <strong>Share</strong> button in the toolbar.`) +
          installStep(INSTALL_ICONS.add, `Scroll down and tap <strong>Add to Home Screen</strong>.`) +
          installStep(`<span class="install-t">t</span>`, `Tap <strong>Add</strong>. That's it, Tria is on your homescreen.`) +
          `</ol></div>` +
        `<div class="install-col"><h3>Android <span class="install-browser">Chrome</span></h3>` +
          `<ol class="install-steps">` +
          installStep(INSTALL_ICONS.more, `Tap the <strong>three dots</strong> next to the address bar.`) +
          installStep(INSTALL_ICONS.add, `Tap <strong>Add to Home screen</strong>, then <strong>Install</strong>.`) +
          installStep(`<span class="install-t">t</span>`, `Confirm. That's it, Tria is on your homescreen.`) +
          `</ol></div>` +
      `</div>`;

    // Guidelines and FAQ collapse behind their heads (same 0fr→1fr grid tween
    // as the comment threads) so the feedback form isn't a mile of scroll away.
    const aboutFold = (id, title, body) =>
      `<section class="about-fold" id="${id}">` +
        `<h2 class="about-head about-fold-head">` +
          `<button class="about-fold-toggle" type="button" aria-expanded="false">` +
            `${title}<span class="about-fold-chev" aria-hidden="true"></span>` +
          `</button></h2>` +
        `<div class="about-fold-panel"><div class="about-fold-inner">${body}</div></div>` +
      `</section>`;

    const guidelinesHtml = aboutFold('guidelines', 'Community guidelines',
      `<p>Tria works best when it feels like a group chat that accidentally became ` +
        `a neighborhood. These guidelines help keep Tria welcoming, safe, and ` +
        `enjoyable for everyone. They apply across the platform, including posts, ` +
        `comments, profiles, usernames, photos, activities, and anything else you ` +
        `choose to share.</p>` +
      `<h3>Respect people.</h3>` +
      `<p>Treat people like people. Disagreement is fine. Harassment, bullying, ` +
        `threats, hate speech, and deliberately making someone else's day worse are not.</p>` +
      `<h3>Share honestly.</h3>` +
      `<p>Be yourself. Don't impersonate other people, spread scams, or ` +
        `intentionally mislead others.</p>` +
      `<h3>Respect privacy.</h3>` +
      `<p>Only share content that you have the right to share. Don't post someone ` +
        `else's private information, conversations, or photos without their ` +
        `permission. The same goes for plans: an activity's location is visible to ` +
        `everyone in your circle, so think before pinning a home address or a spot ` +
        `someone else considers private.</p>` +
      `<h3>Keep it appropriate.</h3>` +
      `<p>Illegal content, graphic violence, sexual exploitation, and content ` +
        `intended to harm or exploit others have no place on Tria. No explicit or ` +
        `adult material.</p>` +
      `<h3>No spam.</h3>` +
      `<p>People are here for conversations, recommendations, photos, ideas, and ` +
        `plans. Accounts created primarily for spam, manipulation, or deceptive ` +
        `promotion may be removed.</p>` +
      `<h3>Help us improve.</h3>` +
      `<p>If something doesn't feel right, let us know. Reports help us ` +
        `investigate problems and keep the community healthy.</p>` +
      `<p><strong>We may remove content or suspend accounts that repeatedly or ` +
        `seriously violate these guidelines.</strong></p>`);

    const faqHtml = aboutFold('faq', 'Frequently asked questions',
      `<h3 class="faq-q">Why is Tria different?</h3>` +
      `<p>Your feed follows time, not recommendations. You decide who's in your ` +
        `circle. Features are added because they make staying connected easier, ` +
        `not because they increase screen time.</p>` +
      `<h3 class="faq-q">Does Tria have an algorithm?</h3>` +
      `<p><strong>No.</strong> Posts appear in chronological order from the people ` +
        `you've chosen to follow. We don't reorder your feed, recommend posts ` +
        `based on engagement, or decide what's "worth seeing."</p>` +
      `<h3 class="faq-q">Are there ads?</h3>` +
      `<p><strong>No.</strong> There are no advertisements, sponsored posts, or ` +
        `third-party advertising systems built into Tria.</p>` +
      `<h3 class="faq-q">Why can't I see everyone's like counts?</h3>` +
      `<p><strong>Because conversations age better than scoreboards.</strong> A ` +
        `reaction is simply a way to let someone know you saw their post. It ` +
        `doesn't need to become a competition.</p>` +
      `<h3 class="faq-q">Is it safe to post activities and locations?</h3>` +
      `<p><strong>Your posts only reach your circle, but choose that circle with ` +
        `care.</strong> Activities can carry a time and place, which is the whole ` +
        `point, and it also means everyone you've added can see where you'll be. ` +
        `Only add people you actually trust, and keep precise locations (like a ` +
        `home address) for the circles that have earned them.</p>` +
      `<h3 class="faq-q">Who is Tria for?</h3>` +
      `<p><strong>Anyone looking for a more thoughtful place online.</strong> Some ` +
        `people use Tria with close friends. Others join to meet people with ` +
        `shared interests, keep up with family, organize clubs, or simply have a ` +
        `social media account that feels a little more human. There's no right ` +
        `way to build your circle. Everyone starts somewhere.</p>` +
      `<h3 class="faq-q">Will Tria always stay this way?</h3>` +
      `<p><strong>That's the goal.</strong> The internet changes quickly, and Tria ` +
        `will keep growing alongside it. Every new feature has to answer a simple ` +
        `question before it gets built: does this help people connect with each ` +
        `other? If the answer is no, it probably doesn't belong here.</p>`);

    const feedbackHtml =
      `<h2 class="about-head" id="feedback">Feedback</h2>` +
      `<p><strong>Questions? Concerns? Feature ideas? Mildly dramatic monologues?</strong></p>` +
      `<p>Whether you've found a bug, have an idea, or ` +
        `just want to tell us what you think, we'd love to hear from you.</p>` +
      `<form id="fb-form" class="fb-form" novalidate>` +
        `<div class="field"><label for="fb-name">Name</label>` +
          `<input id="fb-name" type="text" maxlength="60" autocomplete="name" ` +
            `value="${me ? esc(me.name) : ''}" placeholder="Optional"></div>` +
        `<div class="field"><label for="fb-email">Email</label>` +
          `<input id="fb-email" type="email" autocomplete="email" autocapitalize="none" ` +
            `spellcheck="false" placeholder="Optional, if you'd like a reply"></div>` +
        `<div class="field"><label for="fb-msg">Message</label>` +
          `<textarea id="fb-msg" rows="5" maxlength="4000" ` +
            `placeholder="Say whatever you need to say."></textarea></div>` +
        `<p class="auth-error" id="fb-error" role="alert"></p>` +
        `<button class="auth-submit fb-submit" type="submit">Send feedback</button>` +
      `</form>`;

    view.innerHTML =
      `<section class="view about">` +
        (gated ? `<p class="about-back"><a href="#/">&larr; Back to sign in</a></p>` : '') +
        mastheadEl('Social media is so back.', 'About Tria') +
        `<div class="about-body">` +
          `<p class="about-lede">Tria is a social media app built around <em>real ` +
            `relationships</em>. Whether you're keeping up with lifelong friends, ` +
            `meeting new people, or finding your people for the first time, Tria ` +
            `is the place to do it. <strong>Your feed is chronological. There are ` +
            `no ads, no algorithm deciding for you, and no popularity ` +
            `contests.</strong> Just a place to share your life, discover things ` +
            `worth caring about, and stay connected.</p>` +
          installHtml + guidelinesHtml + faqHtml + feedbackHtml +
        `</div>` +
      `</section>`;

    view.querySelectorAll('.about-fold-toggle').forEach((btn) => {
      btn.addEventListener('click', () => {
        const open = btn.closest('.about-fold').classList.toggle('open');
        btn.setAttribute('aria-expanded', String(open));
      });
    });

    const form = document.getElementById('fb-form');
    const errEl = document.getElementById('fb-error');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errEl.textContent = '';
      const message = document.getElementById('fb-msg').value.trim();
      if (!message) { errEl.textContent = 'Write a little something first.'; return; }
      const btn = form.querySelector('.fb-submit');
      btn.disabled = true;
      btn.textContent = 'Sending…';
      try {
        const res = await fetch(FEEDBACK_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            _subject: 'Tria feedback',
            name: document.getElementById('fb-name').value.trim() || 'Anonymous',
            email: document.getElementById('fb-email').value.trim() || undefined,
            username: me ? '@' + me.username : '(not signed in)',
            message,
          }),
        });
        if (!res.ok) throw new Error('send failed');
        form.outerHTML = `<p class="fb-thanks">Your feedback has been sent. Thank you!</p>`;
      } catch {
        errEl.textContent = "That didn't send. Please try again in a moment.";
        btn.disabled = false;
        btn.textContent = 'Send feedback';
      }
    });
  }

  /* ── Router + page transitions ─────────────────────────────────────────────
     The nav order is a line: Home(0) · Friends(1) · Notifications(2) ·
     Profile(3) · Publish(4). A move to a higher index slides the new page in
     from the RIGHT; a lower index slides it in from the LEFT; a same-level swap
     (or the auth gate, index −1) cross-fades. Each page rides in on
     blur+opacity+movement so it resolves into focus rather than merely sliding.
     This is the only place direction is decided — every view renders the same
     way and inherits the transition. */
  function pageOrder(path) {
    if (path === '#/friends') return 1;
    if (path === '#/updates') return 2;
    if (path === '#/profile' || path.startsWith('#/u/')) return 3;
    if (path === '#/publish') return 4;
    return 0;                  // home (and any unknown route, which redirects home)
  }

  // Build the next page, drop it into the stage, and animate the swap. `renderFn`
  // fills the fresh `view`; direction comes from newIndex vs. the current route.
  function renderPage(newIndex, renderFn) {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const prev = view;
    const token = ++navToken;

    // Snap away anything a previous (possibly interrupted) transition left behind.
    Array.from(stage.children).forEach(el => { if (el !== prev) el.remove(); });

    // Gate (−1) always fades; otherwise compare positions on the nav line.
    let dir = 0;
    if (prev && !reduce && newIndex >= 0 && navIndex >= 0) {
      dir = Math.sign(newIndex - navIndex);
    }
    navIndex = newIndex;

    const page = document.createElement('div');
    page.className = 'page';

    // First paint / reduced motion: no slide. Mount, THEN render — render code
    // resolves its own nodes via document.getElementById, so the page has to be
    // in the document before renderFn runs.
    if (!prev || reduce) {
      view = page;
      stage.replaceChildren(page);
      renderFn();
      return;
    }

    // Mount the entering page in its offset start state, ahead of the outgoing
    // one, so during the brief overlap its ids (e.g. #feed) win getElementById.
    // The leaving page is position:absolute, so it still paints on top regardless.
    const enterFrom = dir > 0 ? 'from-right' : dir < 0 ? 'from-left' : 'fade';
    const leaveTo   = dir > 0 ? 'to-left'    : dir < 0 ? 'to-right'  : 'fade';
    page.classList.add('enter', enterFrom);
    stage.insertBefore(page, prev);
    view = page;
    renderFn();                // render into the mounted new page

    prev.className = 'page';    // clear any stale transition classes before reuse
    prev.classList.add('leave', leaveTo);

    void stage.offsetWidth;    // commit the start states before flipping to rest
    requestAnimationFrame(() => {
      page.classList.add('active');
      prev.classList.add('active');
    });

    window.setTimeout(() => {
      if (token !== navToken) return;   // a newer navigation now owns the stage
      prev.remove();
      page.className = 'page';
    }, TRANSITION_MS + 60);
  }

  // Programmatic navigation. Setting location.hash to a NEW value fires a
  // `hashchange`, which already calls route() — so calling route() ourselves too
  // would render (and animate) twice, interrupting the transition. Only drive
  // route() directly when the hash won't actually change (same target).
  function go(hash) {
    if (location.hash === hash || (hash === '#/' && location.hash === '')) route();
    else location.hash = hash;   // hashchange → route()
  }

  function route() {
    // Gate: no session → the setup / login screen, whatever the hash says.
    // The one exception is About, the public front door — reachable from a
    // link on the gate itself (it renders chromeless, with a way back).
    if (!Store.isAuthed()) {
      document.body.classList.add('gate');
      const gatePath = (location.hash || '#/').split('?')[0];
      renderPage(-1, () => gatePath === '#/about' ? renderAbout(true) : renderAuth(authMode));
      window.scrollTo(0, 0);
      return;
    }
    document.body.classList.remove('gate');
    editingId = null;           // navigating away cancels any in-progress edit

    const hash = location.hash || '#/';
    const path = hash.split('?')[0];
    renderNav(path);   // a friend view (#/u/…) matches nothing → nothing highlighted

    // Remember where a friend profile's "← Back" should return to: the page you
    // came from. Chained profile→profile hops keep the original origin, so Back
    // always lands you back on the feed/directory you started browsing from.
    if (path.startsWith('#/u/')) {
      if (lastPath && !lastPath.startsWith('#/u/')) profileOrigin = lastPath;
    }
    lastPath = path;

    applyAmbient(path);   // warm (Circle) / cool (Friends) / photo tint (a profile)

    // A friend's profile lives at #/u/username. Own profile stays at #/profile so
    // the nav can mark it current (a friend view highlights nothing).
    renderPage(pageOrder(path), () => {
      if (path.startsWith('#/u/')) {
        renderUser(decodeURIComponent(path.slice(4)));
        return;
      }
      switch (path) {
        case '#/':        renderHome(); break;
        case '#/friends': renderFriends(); break;
        case '#/updates': renderUpdates(); break;
        case '#/profile': renderUser(Store.session()); break;
        case '#/publish': renderPublish(); break;
        case '#/about':   renderAbout(false); break;
        default:          location.hash = '#/';
      }
    });

    scrollTop(false);
    refreshWorld(path);   // Circle/Updates: quietly re-pull behind the render
  }

  /* ── Nav-tap refresh ────────────────────────────────────────────────────────
     Landing on (or re-tapping) Circle or Updates quietly re-pulls the world in
     the background — the page renders from cache instantly, and only if
     something actually changed does the view re-render, so the new cards rise
     in with the usual entrance and an unchanged page never flickers. This is
     the pull-to-refresh stand-in: the tab tap IS the refresh gesture. */
  let refreshSeq = 0;
  let lastRefresh = Date.now();   // boot just loaded the world — don't re-pull it
  async function refreshWorld(path) {
    if (path !== '#/' && path !== '#/updates') return;
    if (Date.now() - lastRefresh < 4000) return;   // tap-spam / boot guard
    lastRefresh = Date.now();
    const seq = ++refreshSeq;
    const changed = await Store.refresh();
    if (!changed || seq !== refreshSeq) return;    // stale response — a newer pull won
    if ((location.hash || '#/').split('?')[0] !== path) return;   // navigated away
    // Never yank the page out from under a half-typed comment.
    if (document.activeElement?.matches?.('input, textarea')) return;
    if (path === '#/') renderFeed(); else renderUpdates();
  }

  // Tapping the tab (or the brand) for the page you're already on scrolls back
  // to the top — and on Home also clears any active filter/tag. No `hashchange`
  // fires when the target matches the current route, so we catch it here. This
  // is the familiar bottom-tab-bar gesture on mobile.
  function reclick(route) {
    const path = (location.hash || '#/').split('?')[0];
    if (route === '#/' && path === '#/' && (activeFilter !== 'all' || activeTag)) {
      activeFilter = 'all';
      activeTag = null;
      renderHome();
    }
    scrollTop(true);
    refreshWorld(route);
  }

  document.getElementById('nav').addEventListener('click', (e) => {
    const link = e.target.closest('.nav-link');
    if (!link) return;
    const target = link.getAttribute('href');
    if (target === (location.hash || '#/').split('?')[0]) {
      e.preventDefault();
      reclick(target);
    }
  });

  // The wordmark is the front door to About (My Circle in the nav is home);
  // tapping it while already there just scrolls back to the top.
  document.querySelector('.brand').addEventListener('click', (e) => {
    if ((location.hash || '#/').split('?')[0] === '#/about') {
      e.preventDefault();
      reclick('#/about');
    }
  });

  window.addEventListener('hashchange', route);

  // Mobile: the top bar steps out of the way while you read down the feed and
  // returns the moment you scroll back up. Pure class-toggling here — the
  // transform + transition live in CSS and only apply at phone widths, so
  // desktop (where the bar is the sidebar's sibling brand rail) never moves.
  (() => {
    const topbar = document.querySelector('.topbar');
    let lastY = window.scrollY, ticking = false;
    window.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        if (y < 48) topbar.classList.remove('topbar--hidden');       // near the top: always shown
        else if (y > lastY + 4) topbar.classList.add('topbar--hidden');
        else if (y < lastY - 4) topbar.classList.remove('topbar--hidden');
        lastY = y;
        ticking = false;
      });
    }, { passive: true });
  })();

  // ── Self-update ────────────────────────────────────────────────────────────
  // Installed home-screen apps can resume from memory for days and never pick
  // up a deploy. On launch, and whenever the app returns to the foreground,
  // quietly refetch index.html (cache-bypassing) and compare its ?v= asset
  // stamp to the one this session booted with; if a new build shipped, reload.
  // Never reloads mid-thought: composing or an open modal defers the update to
  // the next foreground. Throttled so foreground flips don't spam the network.
  (() => {
    const booted = (document.querySelector('script[src*="js/app.js"]')?.src
      .match(/[?&]v=([^&]+)/) || [])[1];
    if (!booted) return;   // unstamped build (local harness) → nothing to compare
    let lastCheck = 0;
    async function check() {
      if (Date.now() - lastCheck < 60000) return;
      lastCheck = Date.now();
      try {
        const html = await (await fetch('index.html', { cache: 'no-store' })).text();
        const latest = (html.match(/js\/app\.js\?v=([^"&]+)/) || [])[1];
        if (!latest || latest === booted) return;
        const busy = location.hash.split('?')[0] === '#/publish' ||
          document.querySelector('.modal-card');
        if (!busy) location.reload();
      } catch { /* offline — try again next foreground */ }
    }
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check();
    });
    check();
  })();

  // Returning to a foregrounded app re-pulls the world too (same quiet rules:
  // only on Circle/Updates, re-render only if something changed).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !Store.isAuthed()) return;
    refreshWorld((location.hash || '#/').split('?')[0]);
  });

  // The boot splash (static HTML in index.html, so it paints before any JS or
  // network). Dismissed once the first view is in — held on screen a beat so a
  // warm-cache boot doesn't strobe the mark — and ALWAYS dismissed, even when
  // boot fails, or it would wall off the gate. The node is removed after the
  // fade so the blur/backdrop layers beneath don't keep compositing it.
  const splashShown = performance.now();
  function dismissSplash() {
    const splash = document.getElementById('splash');
    if (!splash) return;
    const hold = Math.max(0, 900 - (performance.now() - splashShown));
    setTimeout(() => {
      splash.classList.add('splash--out');
      setTimeout(() => splash.remove(), 600);   // past --dur-move; also covers reduced motion
    }, hold);
  }

  // Load the world from Supabase before the first render (this resolves any
  // persisted session too). On failure we still route — straight to the gate.
  Store.init().then(route).catch((err) => {
    console.error('Boot failed:', err);
    route();
  }).finally(dismissSplash);
})();
