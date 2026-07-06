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
    comment: '<path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-7l-4 3v-3H6a2 2 0 0 1-2-2z"/>',
  };
  const svgIcon = (key, cls) =>
    `<svg${cls ? ` class="${cls}"` : ''} viewBox="0 0 24 24" fill="none" ` +
      `stroke="currentColor" stroke-width="1.8" stroke-linecap="round" ` +
      `stroke-linejoin="round" aria-hidden="true">${ICONS[key]}</svg>`;
  const NAV = [
    { route: '#/',        key: 'circle',  label: 'My Circle' },
    { route: '#/friends', key: 'friends', label: 'Friends' },
    { route: '#/profile', key: 'profile', label: 'Profile' },
    { route: '#/publish', key: 'publish', label: 'Publish', publish: true },
  ];

  function renderNav(active) {
    document.getElementById('nav').innerHTML = NAV.map(n =>
      `<a class="nav-link${n.publish ? ' nav-publish' : ''}" href="${n.route}"` +
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
      return `<span class="${cls} avatar--photo" aria-hidden="true">` +
          `<img src="${esc(user.avatar)}" alt="" loading="lazy" decoding="async">` +
        `</span>`;
    }
    const name = user ? (user.name || user.username) : '';
    return `<span class="${cls}" aria-hidden="true">${esc(initialOf(name))}</span>`;
  }

  // A small colored label marking an entry's type (Post / Find / Photo), sat at
  // the right of the byline. The colour is the type's own (via the CSS class).
  const TYPE_LABEL = { post: 'Post', find: 'Find', photo: 'Photo' };
  function typeTagEl(type) {
    return `<span class="type-tag type-tag--${type}">` +
      `${esc(TYPE_LABEL[type] || type)}</span>`;
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
        typeTagEl(post.type) +
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
      typeTagEl(post.type) + `</p>`;
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

  // The card's action row, tucked below the post: the comment toggle on the LEFT
  // (it opens the thread that nests below it, on the same left axis), and edit +
  // delete grouped on the right for your own posts. The toggle carries the count
  // and drives the panel (see wireComments).
  function cardActionsHtml(post, opts) {
    const n = Store.commentsFor(post.id).length;
    const expanded = openComments.has(post.id);
    const comment = canComment(post)
      ? `<button class="card-comment" type="button" aria-expanded="${expanded}" ` +
          `aria-label="${n ? n + ' comment' + (n === 1 ? '' : 's') : 'Comments'}" title="Comments">` +
          svgIcon('comment') +
          (n ? `<span class="card-comment-count">${n}</span>` : '') +
        `</button>`
      : '';
    const owner = opts.owner
      ? `<div class="card-tools">` +
          `<button class="card-edit" type="button" data-edit="${esc(post.id)}" ` +
            `aria-label="Edit this post" title="Edit post">${svgIcon('pencil')}</button>` +
          `<button class="card-delete" type="button" data-del="${esc(post.id)}" ` +
            `aria-label="Delete this post" title="Delete post">${svgIcon('trash')}</button>` +
        `</div>`
      : '';
    // Nothing to show (a non-friend's post you don't own) → no empty row.
    if (!comment && !owner) return '';
    return `<div class="card-actions">${comment}${owner}</div>`;
  }

  // opts.solo → this card sits on a profile (single author): show the slim
  // date line instead of the full avatar + name byline.
  // opts.owner → the viewer owns this post: show a delete control.
  function makeCard(post, opts = {}) {
    const head = opts.solo ? soloMetaEl(post) : bylineEl(post);
    const actions = cardActionsHtml(post, opts);
    const el = document.createElement('article');
    el.className = `card card--${post.type}${opts.owner ? ' card--owner' : ''}`;
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
        commentsPanelHtml(post);
      wirePhoto(el, img);
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
              `${esc(post.title)}${external ? '<span class="card-title-ext" aria-hidden="true">↗</span>' : ''}</a></h2>`
          : `<h2 class="card-title">${esc(post.title)}</h2>`)
      : '';

    el.innerHTML =
      `<div class="card-main">` +
        head +
        titleHtml +
        cardNoteHtml(post) +
        tagChips(post) +
        actions +
      `</div>` +
      commentsPanelHtml(post);
    wireReadMore(el, post);
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

    panel.querySelector('.comment-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const res = Store.addComment(post.id, e.target.elements.text.value);
      if (res.ok) apply();
    });

    panel.querySelectorAll('.comment-delete').forEach(btn =>
      btn.addEventListener('click', () => {
        if (!window.confirm('Delete this comment?')) return;
        Store.deleteComment(btn.dataset.comment);
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

  // Which posts have their long-note "Read more" tail expanded — same role as
  // openComments, keeping a panel open across an in-place card rebuild.
  const openReadMore = new Set();

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
          `value="${esc(post.title || '')}" placeholder="Optional — a title for longer thoughts.">` +
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
    return el;
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

  // The feed's "issue date" — e.g. "Saturday · July 5". Shares store.js's TODAY
  // so it always agrees with the posts' own date stamps.
  function longDate() {
    const d = new Date(TODAY + 'T12:00:00');
    const wd = d.toLocaleDateString('en-US', { weekday: 'long' });
    const md = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
    return `${wd} <span class="dot">·</span> ${md}`;
  }

  /* ── Home view ───────────────────────────────────────────────────────────── */
  const FILTERS = [
    { key: 'all',   label: 'All' },
    { key: 'post',  label: 'Posts' },
    { key: 'find',  label: 'Finds' },
    { key: 'photo', label: 'Photos' },
  ];
  let activeFilter = 'all';
  let activeTag = null;

  function renderHome() {
    view.innerHTML =
      `<section class="view">` +
        mastheadEl(longDate(), 'My Circle') +
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

    feedEl.innerHTML = '';
    if (!list.length) {
      feedEl.innerHTML = `<p class="feed-empty">Nothing here yet.` +
        (activeTag ? ` <button class="tag" type="button" data-clear="1">clear ${esc(activeTag)}</button>` : '') +
        `</p>`;
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
     account (display name + username + password, with a live avatar preview) or
     log back in. On success we drop the gate and route home. */
  let authMode = 'signup';

  function renderAuth(mode) {
    authMode = mode;
    const isSignup = mode === 'signup';

    const preview = isSignup
      ? `<div class="auth-preview">` +
          `<span class="avatar" id="auth-avatar" aria-hidden="true">?</span>` +
          `<span class="auth-preview-label">This is your avatar</span>` +
        `</div>`
      : '';
    const nameField = isSignup
      ? `<div class="field">` +
          `<label for="f-name">Display name</label>` +
          `<input id="f-name" type="text" autocomplete="name" maxlength="40" ` +
            `placeholder="Juniper Vale" autofocus>` +
        `</div>`
      : '';

    view.innerHTML =
      `<section class="auth"><div class="auth-card">` +
        `<div class="auth-brand">tria</div>` +
        `<p class="auth-tag">Social Media is so back.</p>` +
        `<h1 class="auth-head">${isSignup ? 'Create your account' : 'Welcome back'}</h1>` +
        `<form id="auth-form" novalidate>` +
          preview +
          nameField +
          `<div class="field">` +
            `<label for="f-user">Username</label>` +
            `<div class="field-user">` +
              `<span class="at" aria-hidden="true">@</span>` +
              `<input id="f-user" type="text" autocomplete="username" ` +
                `autocapitalize="none" spellcheck="false" maxlength="20" ` +
                `placeholder="juniper"${isSignup ? '' : ' autofocus'}>` +
            `</div>` +
            (isSignup ? `<p class="field-hint">Lowercase letters, numbers or _.</p>` : '') +
          `</div>` +
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
      `</div></section>`;

    // Live avatar preview reflects the display name's first letter.
    const nameInput = document.getElementById('f-name');
    const avatarEl = document.getElementById('auth-avatar');
    if (nameInput && avatarEl) {
      nameInput.addEventListener('input', () => {
        avatarEl.textContent = nameInput.value.trim() ? initialOf(nameInput.value) : '?';
      });
    }

    const errEl = document.getElementById('auth-error');
    document.getElementById('auth-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const username = document.getElementById('f-user').value;
      const password = document.getElementById('f-pass').value;
      const res = isSignup
        ? Store.signup({ name: nameInput.value, username, password })
        : Store.login(username, password);
      if (!res.ok) { errEl.textContent = res.error; return; }
      go('#/');
    });

    document.getElementById('auth-toggle').addEventListener('click',
      () => renderAuth(isSignup ? 'login' : 'signup'));
  }

  /* ── Profile (own account or any friend, at #/u/username) ─────────────────────
     One view renders both: the signed-in identity + their posts as a single-
     author column. Your own profile carries a Log out; a friend's carries a
     an Add-friend toggle and a way back to the directory. */
  function renderUser(username) {
    const u = Store.user(username);
    if (!u) { location.hash = '#/'; return; }          // stale link → home
    const isSelf = u.username === Store.session();
    const list = Store.postsBy(u.username);

    const isFriend = Store.isFriend(u.username);
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
            `<span class="account-share-label">Copy profile link</span>` +
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
        `${isSelf ? 'You haven’t posted yet.' : 'Nothing here yet.'}</p>`;
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

    // Owner controls (own profile only) — edit swaps the card for a form; delete
    // confirms then removes. Both re-render the column in place.
    feedEl.querySelectorAll('.card-edit').forEach(btn =>
      btn.addEventListener('click', () => {
        editingId = btn.dataset.edit;
        renderUser(username);
      }));

    feedEl.querySelectorAll('.card-delete').forEach(btn =>
      btn.addEventListener('click', () => {
        if (!window.confirm('Delete this post? This can’t be undone.')) return;
        Store.deletePost(btn.dataset.del);
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
    if (friendBtn) friendBtn.addEventListener('click', () => {
      if (Store.isFriend(u.username)) Store.removeFriend(u.username);
      else Store.addFriend(u.username);
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
          label.textContent = 'Copy profile link';
        }, 1800);
      });
    });

    const logoutBtn = document.getElementById('logout');
    if (logoutBtn) logoutBtn.addEventListener('click', () => {
      Store.logout();
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
      const res = Store.updateAvatar(avCropper.export(512));
      if (!res.ok) { errEl.textContent = res.error; return; }
      close();
      done();
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

    modal.querySelector('#pf-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const res = Store.updateProfile({ name: nameEl.value, bio: bioEl.value });
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
          : `<p class="feed-empty">You haven’t added any friends yet.</p>`) +
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
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        Store.addFriend(btn.dataset.add);
        renderFriends();
      }));
  }

  /* ── Publish (composer) ───────────────────────────────────────────────────
     One form, three types. The type picker reuses the home filter chips (same
     colored language); the fields below swap per type. Photos get a real upload
     with a drag-to-reposition 1:1 crop. On publish we route home so the new
     entry animates in at the top of the feed. */
  const PUB_TYPES = [
    { key: 'post',  label: 'Post'  },
    { key: 'find',  label: 'Find'  },
    { key: 'photo', label: 'Photo' },
  ];
  let pubType = 'post';
  let cropper = null;   // set once a photo is chosen; .export() → data-URI

  function fieldsFor(type) {
    const tags =
      `<div class="field">` +
        `<label for="c-tags">Tags</label>` +
        `<input id="c-tags" type="text" autocapitalize="none" ` +
          `placeholder="garden, clay">` +
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
            `placeholder="A line on why it’s worth a look."></textarea>` +
        `</div>` + tags;
    }

    if (type === 'photo') {
      return `<div class="field">` +
          `<label>Photo</label>` +
          `<input id="c-file" type="file" accept="image/*" hidden>` +
          `<div class="dropzone" id="c-drop">` +
            `<button type="button" class="dropzone-btn" id="c-pick">Choose a photo</button>` +
            `<p class="field-hint">JPG or PNG · cropped to a square.</p>` +
          `</div>` +
          `<div class="crop" id="c-crop" hidden>` +
            `<img id="c-cropimg" alt="" draggable="false">` +
            `<span class="crop-hint">Drag to reposition</span>` +
          `</div>` +
          `<button type="button" class="crop-replace" id="c-replace" hidden>Replace photo</button>` +
        `</div>` +
        `<div class="field">` +
          `<label for="c-note">Caption</label>` +
          `<textarea id="c-note" rows="2" maxlength="400" ` +
            `placeholder="Say something about it (optional)."></textarea>` +
        `</div>` + tags;
    }

    // post
    return `<div class="field">` +
        `<label for="c-title">Headline</label>` +
        `<input id="c-title" type="text" maxlength="120" ` +
          `placeholder="Optional — a title for longer thoughts.">` +
      `</div>` +
      `<div class="field">` +
        `<label for="c-note">What’s on your mind?</label>` +
        `<textarea id="c-note" rows="4" maxlength="600" ` +
          `placeholder="Say it plainly." autofocus></textarea>` +
      `</div>` + tags;
  }

  function renderPublish() {
    view.innerHTML =
      `<section class="view">` +
        mastheadEl('Share to your circle', 'Publish') +
        `<form class="composer" id="composer" novalidate>` +
          `<div class="type-pick" role="group" aria-label="Post type">` +
            PUB_TYPES.map(t =>
              `<button class="filter type-opt" type="button" data-type="${t.key}" ` +
                `data-filter="${t.key}" aria-pressed="${t.key === pubType}">` +
                `${t.label}</button>`).join('') +
          `</div>` +
          `<div class="fields" id="c-fields"></div>` +
          `<p class="composer-error" id="c-error" role="alert"></p>` +
          `<button class="composer-submit" type="submit">Publish</button>` +
        `</form>` +
      `</section>`;

    const fieldsEl = view.querySelector('#c-fields');

    function mountFields() {
      cropper = null;
      fieldsEl.innerHTML = fieldsFor(pubType);
      if (pubType === 'photo') wirePhotoPicker(fieldsEl);
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

  // File picker + drag-to-reposition square crop. Keeps a `cropper` with an
  // export() that renders the visible square to a canvas at publish time.
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
        cropper = initCropper(cropEl, imgEl, reader.result);
      };
      reader.readAsDataURL(f);
    });
  }

  // Square cropper over an already-loaded <img>. Cover-fits the image and lets
  // the user pan it within the frame; export() draws the framed region to a
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

  function submitComposer() {
    const errEl = document.getElementById('c-error');
    const val = (id) => (document.getElementById(id)?.value || '').trim();
    const data = { type: pubType, tags: parseTags(val('c-tags')), note: val('c-note') };

    if (pubType === 'find') {
      data.url = val('c-url');
      data.title = val('c-title');
      if (!/^https?:\/\/.+/i.test(data.url)) {
        errEl.textContent = 'Add a link starting with http:// or https://.'; return;
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

    const res = Store.createPost(data);
    if (!res.ok) { errEl.textContent = res.error; return; }
    cropper = null;
    pubType = 'post';           // reset for next time
    go('#/');
  }

  // Save an inline text edit. Reads the form by type, applies the same rules as
  // the composer (a find needs a valid link; a post needs a headline or note),
  // then persists and re-renders the profile in place.
  function submitEdit(id, username) {
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
    } else if (post.type === 'post') {
      data.title = val('e-title');
      if (!data.title && !data.note) {
        errEl.textContent = 'Write a headline or a note first.'; return;
      }
    }
    // photo: caption + tags only, both optional (the image carries the post).

    const res = Store.updatePost(id, data);
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

  /* ── Router + page transitions ─────────────────────────────────────────────
     The nav order is a line: Home(0) · Friends(1) · Profile(2) · Publish(3). A
     move to a higher index slides the new page in from the RIGHT; a lower index
     slides it in from the LEFT; a same-level swap (or the auth gate, index −1)
     cross-fades. Each page rides in on blur+opacity+movement so it resolves into
     focus rather than merely sliding. This is the only place direction is
     decided — every view renders the same way and inherits the transition. */
  function pageOrder(path) {
    if (path === '#/friends') return 1;
    if (path === '#/profile' || path.startsWith('#/u/')) return 2;
    if (path === '#/publish') return 3;
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
    if (!Store.isAuthed()) {
      document.body.classList.add('gate');
      renderPage(-1, () => renderAuth(authMode));
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
        case '#/profile': renderUser(Store.session()); break;
        case '#/publish': renderPublish(); break;
        default:          location.hash = '#/';
      }
    });

    scrollTop(false);
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

  document.querySelector('.brand').addEventListener('click', (e) => {
    if ((location.hash || '#/').split('?')[0] === '#/') {
      e.preventDefault();
      reclick('#/');
    }
  });

  window.addEventListener('hashchange', route);
  route();
})();
