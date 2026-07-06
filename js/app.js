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
    // Three interlocking rings — the "circle" of people you follow, and a nod
    // to the name (Tria). Kept as an outline to sit with the other nav glyphs.
    circle:  '<circle cx="8.5" cy="10" r="3.8"/><circle cx="15.5" cy="10" r="3.8"/><circle cx="12" cy="15.5" r="3.8"/>',
    friends: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16 5.5a3.2 3.2 0 0 1 0 6"/><path d="M18 20a6 6 0 0 0-4-5.7"/>',
    share:   '<circle cx="18" cy="5" r="2.6"/><circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="19" r="2.6"/><path d="M8.3 10.8 15.7 6.3"/><path d="M8.3 13.2 15.7 17.7"/>',
    profile: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
    publish: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    trash:   '<path d="M4 7h16"/><path d="M9 7V4.5h6V7"/><path d="M6.5 7l.85 12.5h9.3L17.5 7"/><path d="M10 10.5v6"/><path d="M14 10.5v6"/>',
    pencil:  '<path d="M4 20l4-1L19 8a2 2 0 0 0-3-3L5 16l-1 4z"/><path d="M14 7l3 3"/>',
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
  // Byline (identity) — avatar + profile name, with the date (and a find's
  // domain) beneath. Leads text posts; sits below the image on photos. No
  // @usernames; profile names only.
  function bylineEl(post) {
    const u = Store.user(post.author);
    const name = esc(u ? u.name : post.author);
    const domain = post.type === 'find' && post.url ? esc(domainOf(post.url)) : '';
    const meta = esc(niceDate(post.date)) +
      (domain ? ` <span class="dot">·</span> ${domain}` : '');
    return `<header class="byline">` +
        `<span class="avatar" aria-hidden="true">${esc(initialOf(name))}</span>` +
        `<span class="byline-text">` +
          `<span class="byline-name">${name}</span>` +
          `<span class="byline-meta">${meta}</span>` +
        `</span>` +
      `</header>`;
  }

  // A slim single-author meta line that stands in for the byline on a profile,
  // where the header already establishes whose column this is. Just the date
  // (and a find's domain) — no repeated avatar + name down the page.
  function soloMetaEl(post) {
    const domain = post.type === 'find' && post.url ? esc(domainOf(post.url)) : '';
    return `<p class="card-solometa">${esc(niceDate(post.date))}` +
      (domain ? ` <span class="dot">·</span> ${domain}` : '') + `</p>`;
  }

  // The tag chips, wrapped — reused in text and photo entries.
  function tagChips(post) {
    if (!post.tags || !post.tags.length) return '';
    return `<div class="tags">` +
      post.tags.map(t => `<button class="tag" type="button" data-tag="${esc(t)}">${esc(t)}</button>`).join('') +
      `</div>`;
  }

  // opts.owner → this is the signed-in user's own post: hang edit + delete
  // controls in the card's top-right corner (the card is position:relative).
  // Wired in the profile view, which is the only place owner cards render.
  function ownerControls(el, post, opts) {
    if (!opts.owner) return el;
    el.insertAdjacentHTML('beforeend',
      `<div class="card-tools">` +
        `<button class="card-edit" type="button" data-edit="${esc(post.id)}" ` +
          `aria-label="Edit this post" title="Edit post">${svgIcon('pencil')}</button>` +
        `<button class="card-delete" type="button" data-del="${esc(post.id)}" ` +
          `aria-label="Delete this post" title="Delete post">${svgIcon('trash')}</button>` +
      `</div>`);
    return el;
  }

  // opts.solo → this card sits on a profile (single author): show the slim
  // date line instead of the full avatar + name byline.
  // opts.owner → the viewer owns this post: show a delete control.
  function makeCard(post, opts = {}) {
    const head = opts.solo ? soloMetaEl(post) : bylineEl(post);
    const el = document.createElement('article');
    el.className = `card card--${post.type}`;
    el.dataset.type = post.type;
    el.dataset.tags = (post.tags || []).join(',');

    if (post.type === 'photo') {
      // Identity first (avatar + name above the image), then the full-bleed
      // photo, then caption + tags below it. Real uploads (post.image) show the
      // cropped photo; seed entries fall back to the tonal placeholder.
      const img = post.image
        ? { src: post.image, alt: post.note || 'Photo' }
        : placeholderPhoto(post.id, post.note);
      const foot = (post.note ? `<p class="card-note">${esc(post.note)}</p>` : '') + tagChips(post);
      el.innerHTML =
        head +
        `<figure class="photo" tabindex="0" role="button" aria-label="Enlarge photo">` +
          `<img src="${img.src}" alt="${esc(img.alt)}" loading="lazy" decoding="async">` +
        `</figure>` +
        (foot ? `<div class="card-foot">${foot}</div>` : '');
      wirePhoto(el, img);
      return ownerControls(el, post, opts);
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
    if (!post.title) el.classList.add('card--note-only');

    el.innerHTML =
      head +
      titleHtml +
      (post.note ? `<p class="card-note">${esc(post.note)}</p>` : '') +
      tagChips(post);
    return ownerControls(el, post, opts);
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

  // ── Inline edit (text only) ───────────────────────────────────────────────
  // The post whose card is currently swapped for an edit form, or null. Only one
  // at a time; reset on any navigation (see route()).
  let editingId = null;

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
        // The nav already says "My Circle" and the feed speaks for itself, so the
        // page header is dropped — kept only for screen readers / the a11y outline.
        `<h1 class="visually-hidden">My Circle</h1>` +
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
     Follow / Unfollow toggle and a way back to the directory. */
  function renderUser(username) {
    const u = Store.user(username);
    if (!u) { location.hash = '#/'; return; }          // stale link → home
    const isSelf = u.username === Store.session();
    const list = Store.postsBy(u.username);

    const following = Store.isFollowing(u.username);
    // Own profile carries a "copy my link to share" action; a friend's carries the
    // Follow toggle. (Log out moves to the foot of your own column, below.)
    const action = isSelf
      ? `<button class="account-share" type="button" id="share">` +
          svgIcon('share', 'account-share-ico') +
          `<span class="account-share-label">Copy profile link</span>` +
        `</button>`
      : `<button class="follow-btn" type="button" id="follow" ` +
          `aria-pressed="${following}">${following ? 'Following' : 'Follow'}</button>`;

    const count = `${list.length} ${list.length === 1 ? 'post' : 'posts'}`;
    const stats = isSelf
      ? `${count} <span class="dot">·</span> ${Store.following().length} following`
      : count;

    view.innerHTML =
      `<section class="view">` +
        (isSelf ? '' : `<a class="profile-back" href="#/friends">← Friends</a>`) +
        `<div class="account">` +
          `<span class="avatar account-avatar" aria-hidden="true">${esc(initialOf(u.name))}</span>` +
          `<h1 class="view-title">${esc(u.name)}</h1>` +
          `<p class="view-sub">@${esc(u.username)}</p>` +
          (u.bio ? `<p class="account-bio">${esc(u.bio)}</p>` : '') +
          `<p class="profile-stats">${stats}</p>` +
          action +
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
          : makeCard(p, { solo: true, owner: isSelf });
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

    const followBtn = document.getElementById('follow');
    if (followBtn) followBtn.addEventListener('click', () => {
      if (Store.isFollowing(u.username)) Store.unfollow(u.username);
      else Store.follow(u.username);
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

  /* ── Friends (the circle you follow) + Discover (people you don't yet) ─────── */
  function renderFriends() {
    const me = Store.session();
    const followingSet = new Set(Store.following());
    const byName = (a, b) => a.name.localeCompare(b.name);

    const friends = Store.following().map(Store.user).filter(Boolean).sort(byName);
    // Everyone signed up who isn't you and isn't already in your circle.
    const discover = Store.users()
      .filter(u => u.username !== me && !followingSet.has(u.username))
      .sort(byName);

    // A directory row. `discover` rows swap the go-arrow for a Follow button so
    // you can add someone without leaving the page.
    const row = (u, add) =>
      `<a class="friend" href="#/u/${encodeURIComponent(u.username)}">` +
        `<span class="avatar" aria-hidden="true">${esc(initialOf(u.name))}</span>` +
        `<span class="friend-text">` +
          `<span class="friend-name">${esc(u.name)}</span>` +
          `<span class="friend-user">@${esc(u.username)}</span>` +
          (u.bio ? `<span class="friend-bio">${esc(u.bio)}</span>` : '') +
        `</span>` +
        (add
          ? `<button class="friend-add" type="button" data-follow="${esc(u.username)}" ` +
              `aria-label="Follow ${esc(u.name)}">Follow</button>`
          : `<span class="friend-go" aria-hidden="true">→</span>`) +
      `</a>`;

    view.innerHTML =
      `<section class="view">` +
        `<div class="view-head">` +
          `<h1 class="view-title">Friends</h1>` +
          `<p class="view-sub">${friends.length} ` +
            `${friends.length === 1 ? 'person' : 'people'} in your circle</p>` +
        `</div>` +
        (friends.length
          ? `<div class="friends-list">` + friends.map(u => row(u, false)).join('') + `</div>`
          : `<p class="feed-empty">You’re not following anyone yet.</p>`) +
        (discover.length
          ? `<div class="discover">` +
              `<h2 class="discover-head">Find people</h2>` +
              `<div class="friends-list">` + discover.map(u => row(u, true)).join('') + `</div>` +
            `</div>`
          : '') +
      `</section>`;

    // Follow from a Discover row: add, then re-render so they move up into your
    // circle. The button sits inside the row link, so stop it navigating.
    view.querySelectorAll('.friend-add').forEach(btn =>
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        Store.follow(btn.dataset.follow);
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
        `<div class="view-head">` +
          `<h1 class="view-title">Publish</h1>` +
          `<p class="view-sub">Share to your circle</p>` +
        `</div>` +
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
