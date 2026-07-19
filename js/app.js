/* ── Tria app ──────────────────────────────────────────────────────────────
   A tiny hash router over a handful of views — My Circle (the feed), Friends,
   Updates, Profile (own + any friend's, at #/u/username), Publish, and the
   public About page. Every view renders into #view and inherits the router's
   directional page transition (see renderPage). */

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

  // Collapsing a long post (a folded note or a dropdown) can drop the timeline out
  // from under you — you were deep inside an essay, and now everything below it
  // jumps up. If the card's top has scrolled up off-screen, glide back to it so the
  // read lands on the post you tapped, not wherever the collapse left the scroll.
  function scrollCardIntoView(el) {
    const bar = document.querySelector('.topbar');
    const offset = (bar ? bar.getBoundingClientRect().height : 0) + 8;
    const top = el.getBoundingClientRect().top;
    if (top >= offset) return;   // its top is already in view — leave the scroll be
    window.scrollTo({ top: top + window.scrollY - offset,
      behavior: prefersReduced() ? 'auto' : 'smooth' });
  }

  // Like scrollCardIntoView, but resolves once the glide has settled (or at once
  // if the card is already up top / motion is reduced). Lets a caller rise to the
  // post first and THEN collapse it, so the fold doesn't race the scroll — a much
  // cleaner read than folding while the page is still gliding. scrollend isn't on
  // every engine yet, so a timeout backstops the resolve.
  function scrollCardToTop(el) {
    const bar = document.querySelector('.topbar');
    const offset = (bar ? bar.getBoundingClientRect().height : 0) + 8;
    const top = el.getBoundingClientRect().top;
    if (top >= offset) return Promise.resolve();          // already up top — nothing to glide
    const targetY = top + window.scrollY - offset;
    if (prefersReduced()) { window.scrollTo({ top: targetY, behavior: 'auto' }); return Promise.resolve(); }
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(t);
        window.removeEventListener('scrollend', finish);
        resolve();
      };
      const t = setTimeout(finish, 600);                  // backstop if scrollend never fires
      window.addEventListener('scrollend', finish);
      window.scrollTo({ top: targetY, behavior: 'smooth' });
    });
  }

  // The feed's entrance rhythm: each card/row rises a beat after the one above it,
  // capped so a long list doesn't trail on forever. Shared by every list view.
  const staggerDelay = (i) => Math.min(i * 0.05, 0.4).toFixed(2) + 's';

  // A cheap, stable fingerprint of a string. makeCard stamps each card with a
  // hash of its own rendered markup so the feed can tell, on a quiet refresh,
  // whether a card's content actually changed — and leave the unchanged ones
  // (and their already-loaded photos) untouched instead of rebuilding them.
  const hashStr = (s) => {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
    return h.toString(36);
  };

  /* ── Nav ─────────────────────────────────────────────────────────────────
     One list drives the desktop top-right links and the mobile bottom tab bar.
     The publish "+" is the primary action (filled pill on desktop). */
  const ICONS = {
    // Three interlocking rings — your "circle" of friends, and a nod
    // to the name (Tria). Kept as an outline to sit with the other nav glyphs.
    circle:  '<circle cx="8.5" cy="10" r="3.8"/><circle cx="15.5" cy="10" r="3.8"/><circle cx="12" cy="15.5" r="3.8"/>',
    // Two full figures shoulder to shoulder — a balanced, symmetric pair that
    // reads cleanly at the small nav scale.
    friends: '<circle cx="8.3" cy="9" r="2.7"/><circle cx="15.7" cy="9" r="2.7"/><path d="M3.5 19.5a4.8 4.8 0 0 1 9.6 0"/><path d="M10.9 19.5a4.8 4.8 0 0 1 9.6 0"/>',
    share:   '<circle cx="18" cy="5" r="2.6"/><circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="19" r="2.6"/><path d="M8.3 10.8 15.7 6.3"/><path d="M8.3 13.2 15.7 17.7"/>',
    profile: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
    publish: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    trash:   '<path d="M4 7h16"/><path d="M9 7V4.5h6V7"/><path d="M6.5 7l.85 12.5h9.3L17.5 7"/><path d="M10 10.5v6"/><path d="M14 10.5v6"/>',
    pencil:  '<path d="M4 20l4-1L19 8a2 2 0 0 0-3-3L5 16l-1 4z"/><path d="M14 7l3 3"/>',
    camera:  '<path d="M3.5 8.5A1.5 1.5 0 0 1 5 7h2l1.4-2h7.2L17 7h2a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z"/><circle cx="12" cy="13" r="3.3"/>',
    comment: '<path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-7l-4 3v-3H6a2 2 0 0 1-2-2z"/>',
    heart:   '<path d="M12 20.3 4.7 12.9a4.6 4.6 0 0 1 6.5-6.5l.8.8.8-.8a4.6 4.6 0 0 1 6.5 6.5z"/>',
    // A person with a check — the headcount's "I'm in" on an activity. The person
    // sits left and the check lifts clear into the upper-right; the old layout ran
    // the check straight through the shoulder line and read as a squiggle.
    going:   '<circle cx="8.5" cy="8.5" r="3.1"/><path d="M3 20a5.5 5.5 0 0 1 11 0"/><path d="m15.5 12.5 2.2 2.2 4.2-4.2"/>',
    // Bare check — rides the "going" RSVP toggle once you're in.
    check:   '<path d="M5 12.5 10 17.5 19 7"/>',
    // The going person with an x where the check was — the "can't make it"
    // sheet action, so backing out reads as the mirror of joining.
    notgoing: '<circle cx="8.5" cy="8.5" r="3.1"/><path d="M3 20a5.5 5.5 0 0 1 11 0"/><path d="m16.2 11.2 4.4 4.4"/><path d="m20.6 11.2-4.4 4.4"/>',
    // Map pin for an activity's location line.
    pin:     '<path d="M12 21s-6.5-5.2-6.5-10a6.5 6.5 0 0 1 13 0c0 4.8-6.5 10-6.5 10z"/><circle cx="12" cy="11" r="2.4"/>',
    // Calendar page for an activity's when-line.
    cal:     '<rect x="4" y="6" width="16" height="14" rx="1.5"/><path d="M4 10.5h16"/><path d="M8.5 3.5V7"/><path d="M15.5 3.5V7"/>',
    // The little "opens elsewhere" mark on a find's title. An SVG (not the ↗
    // glyph) so it renders as this plain arrow everywhere — mobile fonts render
    // the character as a colour emoji, which we never want.
    extlink: '<path d="M7 17 17 7"/><path d="M8 7h9v9"/>',
    bell:    '<path d="M6 9.2a6 6 0 0 1 12 0c0 4.6 1.7 5.8 1.7 5.8H4.3S6 13.8 6 9.2z"/><path d="M10.4 19.3a1.9 1.9 0 0 0 3.2 0"/>',
    // A little letter — the friendliest "send it to someone." A softened
    // envelope whose flap curves like a smile. Worn by the share buttons.
    send:    '<rect x="3" y="6" width="18" height="12" rx="3"/><path d="M4.5 8.7Q12 14.2 19.5 8.7"/>',
    // Magnifier for the Friends search field, and the X it morphs into when open.
    search:  '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 4.5 4.5"/>',
    close:   '<path d="M6 6 18 18"/><path d="M18 6 6 18"/>',
    // Two sliders — the feed's type filter, worn by the masthead button that
    // fans open the filter dial. Each row's knob sits at a different stop so it
    // reads as "tune what you see," not a plain list. Two rows, not three, keeps
    // it cleaner at the small masthead scale.
    sliders: '<path d="M4 9h9"/><path d="M17 9h3"/><circle cx="15" cy="9" r="2"/><path d="M4 15h4"/><path d="M12 15h8"/><circle cx="10" cy="15" r="2"/>',
    // Padlock — marks an activity shared with a hand-picked few, not the whole circle.
    lock:    '<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
    // Horizontal ellipsis — the quiet "more" overflow on a post header. Opens the
    // per-post action sheet (Copy link, Report). Filled dots so it reads at the
    // small header scale where a hairline outline would nearly vanish.
    dots:    '<circle cx="5.5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
    // A little chain link — Copy link.
    link:    '<path d="M10.3 13.7a4 4 0 0 0 6 .43l2.4-2.4a4 4 0 1 0-5.66-5.66l-1.38 1.37"/><path d="M13.7 10.3a4 4 0 0 0-6-.43l-2.4 2.4a4 4 0 1 0 5.66 5.66l1.37-1.37"/>',
    // A pennant on a staff — Report. Rides the report row inside the sheets.
    flag:    '<path d="M6 21V4"/><path d="M6 5h11l-2 3 2 3H6"/>',
    // No-entry circle — Block a user.
    block:   '<circle cx="12" cy="12" r="8"/><path d="M6.3 6.3l11.4 11.4"/>',
    // A doorway with an arrow stepping out — Log out.
    signout: '<path d="M13.5 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h7.5"/><path d="M10 12h9.5"/><path d="m16 8 4 4-4 4"/>',
    // Speaker + waves / speaker + X — the Frame video sound toggle.
    sound:   '<path d="M4 9.5v5h3.5L12 18V6L7.5 9.5z"/><path d="M16 9.2a4 4 0 0 1 0 5.6"/>',
    mute:    '<path d="M4 9.5v5h3.5L12 18V6L7.5 9.5z"/><path d="m15.5 9.5 4 5"/><path d="m19.5 9.5-4 5"/>',
    // Filled triangle — the play affordance on a Frame video that hasn't started.
    play:    '<path d="M8.5 5.8v12.4a1 1 0 0 0 1.5.85l10-6.2a1 1 0 0 0 0-1.7l-10-6.2a1 1 0 0 0-1.5.85z" fill="currentColor" stroke="none"/>',
    // A framed picture (sun + hills) — the composer's "add a photo or clip" tool.
    image:   '<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><circle cx="8.5" cy="10" r="1.5"/><path d="M4.5 17.5 9 13l3 2.5L15.5 12l4 5"/>',
    // Three horizontal bars of unequal length — the plain "poll" glyph on the
    // composer's attach toggle (reads clearer at button scale than the type burst).
    poll:    '<path d="M5 7.5h13"/><path d="M5 12h9"/><path d="M5 16.5h11"/>',
  };
  // Maps link for an activity's location. Apple devices route maps.apple.com
  // to the default maps app (Apple Maps, or Google if set); everything else
  // gets a Google Maps search. Free-text places just become a search query.
  const mapsUrl = (place) => {
    const q = encodeURIComponent(place);
    return /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent)
      ? `https://maps.apple.com/?q=${q}`
      : `https://www.google.com/maps/search/?api=1&query=${q}`;
  };
  // Shared attributes for every inline icon (24×24 line glyphs) — used by both
  // svgIcon (the nav/card glyph set) and the About page's INSTALL_ICONS.
  const ICON_ATTRS = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
  const svgIcon = (key, cls) =>
    `<svg${cls ? ` class="${cls}"` : ''} ${ICON_ATTRS}>${ICONS[key]}</svg>`;

  /* ── Blocking ────────────────────────────────────────────────────────────────
     A client-side block list, persisted per-device in localStorage. Blocking a
     person severs the friendship (Store.removeFriend, which drops the mutual edge
     at the data layer too) AND hides them locally: their posts leave your feed,
     their profile shows a blocked wall instead of content, and they vanish from
     Discover so you don't re-add them by reflex. Because Tria is private by
     default (only mutual friends see posts), severing the edge already stops them
     seeing YOUR posts at the RLS layer — the local list handles the other half,
     you not seeing THEM. A server-side blocks table with RLS is the eventual
     hardening (needs a migration Zoe runs); this ships real, sticky blocking today
     without one. Keyed by username, lower-cased. */
  const Blocks = (() => {
    const KEY = 'tria:blocks';
    let local = new Set();
    try { local = new Set(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch { local = new Set(); }
    const persist = () => { try { localStorage.setItem(KEY, JSON.stringify([...local])); } catch {} };
    const S = () => (typeof Store !== 'undefined' ? Store : null);
    return {
      // A block counts if EITHER the server cache (post-migration) or the local
      // mirror (pre-migration / offline) has it — so blocking never regresses.
      has: (u) => local.has(u) || !!(S() && S().isBlocked && S().isBlocked(u)),
      add: (u) => { local.add(u); persist(); if (S() && S().block) S().block(u); },
      remove: (u) => { local.delete(u); persist(); if (S() && S().unblock) S().unblock(u); },
    };
  })();

  /* ── Objectionable-content filter ────────────────────────────────────────────
     A good-faith gate at compose time (App Store 1.2: "filter objectionable
     material from being posted"), NOT a moderation engine — reporting is the real
     net. Deliberately short and high-precision: slurs + the hardest sexual-
     exploitation terms only. Matches on word boundaries over normalised text
     (lower-cased, zero-width stripped, common leet folded) so it can't misfire on
     innocent substrings (the Scunthorpe problem). Extend TERMS to tune; keep it
     tight — a bloated list flags real words and trains people to distrust it. */
  const BLOCKLIST = (() => {
    // Kept intentionally small. These are the unambiguous cases; the reporting
    // pipeline handles everything contextual. Add terms here as needed.
    const TERMS = [
      'nigger', 'faggot', 'chink', 'kike', 'spic', 'wetback', 'coon', 'tranny',
      'retard', 'childporn', 'cp', 'jailbait', 'lolicon',
    ];
    const LEET = { '4': 'a', '@': 'a', '3': 'e', '1': 'i', '!': 'i', '0': 'o', '5': 's', '$': 's', '7': 't' };
    const normalise = (s) => String(s || '')
      .toLowerCase()
      .replace(/[​-‍﻿]/g, '')          // strip zero-width chars
      .replace(/[4@31!05$7]/g, (c) => LEET[c] || c);  // fold basic leetspeak
    // Word-boundary matcher per term. `cp` and `cp`-like short terms need real
    // boundaries so they don't hit inside ordinary words.
    const patterns = TERMS.map(t => new RegExp(`\\b${t}\\b`, 'i'));
    return {
      // Returns true if any field trips the filter.
      hits: (...fields) => {
        const text = normalise(fields.join(' \n '));
        return patterns.some(re => re.test(text));
      },
    };
  })();
  const NAV = [
    { route: '#/',        key: 'circle',  label: 'My Circle' },
    { route: '#/friends', key: 'friends', label: 'Friends' },
    { route: '#/updates', key: 'bell',    label: 'Updates' },
    { route: '#/profile', key: 'profile', label: 'Profile' },
    { route: '#/publish', key: 'publish', label: 'Post', publish: true },
  ];

  function renderNav(active) {
    const nav = document.getElementById('nav');
    const link = (n) =>
      `<a class="nav-link${n.publish ? ' nav-publish publish-fill is-solid' : ''}" href="${n.route}"` +
        ` aria-label="${n.label}">` +
        svgIcon(n.key, 'nav-ico') +
        `<span class="nav-label">${n.label}</span>` +
      `</a>`;
    // Built ONCE and kept — the highlight (.nav-glide) slides between icons on
    // route changes, which only works if the links persist across renders.
    // The four destinations ride inside a glass pill; Post floats beside it as
    // its own round button on phones. On desktop .nav-pill is display:contents,
    // so the sidebar sees the same flat column of links it always has.
    if (!nav.querySelector('.nav-pill')) {
      // The four-way speed dial is retired: the composer now surfaces link + photo
      // inline and Activity is one seg-tab tap away, so the + routes straight to the
      // Post composer. dialEl/wireDial are kept dormant in case we ever want a
      // lighter Post/Activity fan here.
      nav.innerHTML =
        `<div class="nav-pill"><span class="nav-glide" aria-hidden="true"></span>` +
          NAV.filter(n => !n.publish).map(link).join('') +
        `</div>` +
        NAV.filter(n => n.publish).map(link).join('');
    }
    nav.querySelectorAll('.nav-link').forEach(a => {
      if (a.getAttribute('href') === active) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    // On the compose page the + would compete with the composer's own publish
    // button, so it drops away (fade + sink behind the nav) and the four-icon
    // pill glides to true center — same spirit as the docked seg-tabs switcher.
    // Pull the tucked + out of the tab order + a11y tree while it's hidden.
    const composing = active === '#/publish';
    nav.classList.toggle('nav--compose', composing);
    const pub = nav.querySelector('.nav-publish');
    if (pub) {
      if (composing) { pub.setAttribute('aria-hidden', 'true'); pub.tabIndex = -1; }
      else { pub.removeAttribute('aria-hidden'); pub.removeAttribute('tabindex'); }
    }
    glideNav();
  }

  // Slides the pill's soft highlight circle under the active destination.
  // Measured from the live link (not index math) so it survives any spacing
  // change; hides when nothing is current (a friend view, compose). Desktop is
  // a no-op: display:contents gives the pill zero offsetWidth. The first
  // placement after being hidden snaps without transition, so the highlight
  // never visibly flies in from the pill's corner.
  function glideNav() {
    const pill = document.querySelector('.nav-pill');
    const glide = pill && pill.querySelector('.nav-glide');
    if (!glide) return;
    const cur = pill.querySelector('.nav-link[aria-current="page"]');
    if (!cur || !pill.offsetWidth) { glide.style.opacity = '0'; return; }
    const fresh = glide.style.opacity !== '1';
    if (fresh) glide.style.transition = 'none';
    glide.style.width = cur.offsetWidth + 'px';
    glide.style.height = cur.offsetHeight + 'px';
    // Scaled up 1.5x around its own center (transform-origin stays 50% 50%) so the
    // heavier blur has room to pool into a full glow instead of shrinking the core.
    glide.style.transform = `translate(${cur.offsetLeft}px, ${cur.offsetTop}px) scale(1.5)`;
    glide.style.opacity = '1';
    if (fresh) { void glide.offsetWidth; glide.style.transition = ''; }
  }

  /* ── Publish speed dial (phones) ───────────────────────────────────────────
     On a phone the + doesn't jump straight to the composer — it fans open a
     little menu of the four post types, each labeled, so you pick what you're
     making before the form loads (one screen, one job). Desktop keeps the +
     as a plain link to the full composer with its type picker. Built once with
     the nav and wired here; the visuals live in the mobile block of app.css. */
  let dialOpen = false;

  function dialEl() {
    return `<div class="nav-dial" id="nav-dial" role="menu" ` +
        `aria-label="Choose a post type" hidden>` +
      PUB_TYPES.map((t, i) =>
        `<a class="nav-dial-item" role="menuitem" href="#/publish" ` +
          `data-type="${t.key}" style="--i:${i}">` +
          `<span class="nav-dial-label">${t.label}</span>` +
          `<span class="nav-dial-ico type-icon--${t.key}" ` +
            `style="--glow:var(--type-${t.key})">${TYPE_ICON[t.key]}</span>` +
        `</a>`).join('') +
    `</div>`;
  }

  function wireDial(nav) {
    const dial = nav.querySelector('#nav-dial');
    const veil = document.getElementById('dial-veil');
    const btn  = nav.querySelector('.nav-publish');
    if (!dial || !veil || !btn) return;

    const isPhone = () => matchMedia('(max-width: 680px)').matches;

    // The + sits at a spot that shifts with the pill's width, so measure it and
    // pin the dial's right edge so its icon chips stack straight up over the +.
    function place() {
      const nr = nav.getBoundingClientRect();
      const br = btn.getBoundingClientRect();
      const chipW = 46;   // keep in sync with .nav-dial-ico in app.css
      dial.style.right  = (nr.right - br.right + (br.width - chipW) / 2) + 'px';
      dial.style.bottom = (nr.bottom - br.top + 14) + 'px';
    }

    function openDial() {
      if (dialOpen || !isPhone()) return;
      dialOpen = true;
      place();
      dial.hidden = false;
      veil.hidden = false;
      requestAnimationFrame(() => {
        veil.classList.add('is-open');
        dial.classList.add('is-open');
        btn.classList.add('dial-open');
      });
      btn.setAttribute('aria-expanded', 'true');
      document.addEventListener('keydown', onKey);
    }

    function closeDial() {
      if (!dialOpen) return;
      dialOpen = false;
      veil.classList.remove('is-open');
      dial.classList.remove('is-open');
      btn.classList.remove('dial-open');
      btn.setAttribute('aria-expanded', 'false');
      document.removeEventListener('keydown', onKey);
      // Pull it out of the a11y tree once the collapse has settled.
      const settle = prefersReduced() ? 0 : 260;
      window.setTimeout(() => {
        if (!dialOpen) { dial.hidden = true; veil.hidden = true; }
      }, settle);
    }

    function onKey(e) {
      if (e.key === 'Escape') { closeDial(); btn.focus(); }
    }

    btn.addEventListener('click', (e) => {
      if (!isPhone()) return;   // desktop: a plain link to the composer
      e.preventDefault();
      dialOpen ? closeDial() : openDial();
    });

    dial.querySelectorAll('.nav-dial-item').forEach(item =>
      item.addEventListener('click', (e) => {
        e.preventDefault();
        // The four cute icons are smart shortcuts into the one composer: each just
        // preselects its type filter (Find opens the link field, Frame the picker,
        // Activity its form). renderPublish reads pubType on mount.
        pubType = item.dataset.type || 'note';
        closeDial();
        go(item.getAttribute('href'));
      }));

    veil.addEventListener('click', closeDial);
    // Any navigation dismisses the dial — including tapping a pill destination
    // while it's open, which routes without going through closeDial otherwise.
    window.addEventListener('hashchange', closeDial);
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
      // NO loading="lazy": avatars are tiny and always on screen, so lazy only made
      // them pop in a frame late on every navigation (reading as a reload). Eager +
      // the warm decode cache (see warmImages) means they ride in WITH the page.
      return `<span class="${cls} avatar--photo" aria-hidden="true">` +
          `<img src="${esc(user.avatar)}" crossorigin="anonymous" alt="" decoding="async">` +
        `</span>`;
    }
    const name = user ? (user.name || user.username) : '';
    return `<span class="${cls}" aria-hidden="true">${esc(initialOf(name))}</span>`;
  }

  // A dated activity retires a few hours after it starts: greyed tag, and it
  // sinks below upcoming plans on the Activities filter. A timed activity flips
  // 3 hours past its start (so a plan earlier today reads as done by evening, not
  // at midnight); a date-only activity (no start time) flips once the day has
  // fully passed. eventDate is YYYY-MM-DD, eventTime is HH:MM in floating local time.
  const PAST_GRACE_MS = 3 * 60 * 60 * 1000;
  function isPastActivity(post) {
    if (post.type !== 'activity' || !post.eventDate) return false;
    if (post.eventTime) {
      const [h, m] = post.eventTime.split(':').map(Number);
      const start = new Date(+post.eventDate.slice(0, 4), +post.eventDate.slice(5, 7) - 1,
                             +post.eventDate.slice(8, 10), h, m);
      return Date.now() > start.getTime() + PAST_GRACE_MS;
    }
    return post.eventDate < TODAY;
  }

  // A small colored label marking an entry's type (Note / Find / Photo), sat at
  // the right of the byline. The colour is the type's own (via the CSS class) —
  // except a past activity, which greys out and reads as done.
  const TYPE_LABEL = { note: 'Note', find: 'Find', photo: 'Frame', activity: 'Activity', poll: 'Poll' };
  // Zoe's poll mark — a hand-drawn pink burst/asterisk (icons/poll.svg). This is
  // the TYPE identity glyph (masthead + filter); the composer's attach toggle uses
  // the plainer line glyph in ICONS ('poll') for legibility at button scale, the
  // same way link/image do. fill: currentColor lets it inherit the type's pink.
  const POLL_ICON_PATH = 'M8.86.75c1.85,0,3.71,2.63.67,7.9,1.89-3.27,3.84-4.4,5.27-4.4,3.18,0,3.78,5.55-4.6,5.55,8.38,0,7.78,5.55,4.6,5.55-1.43,0-3.38-1.13-5.27-4.4,3.04,5.27,1.19,7.9-.67,7.9s-3.71-2.63-.67-7.9c-1.89,3.27-3.84,4.4-5.27,4.4-3.18,0-3.78-5.55,4.6-5.55C-.86,9.8-.26,4.25,2.92,4.25c1.43,0,3.38,1.13,5.27,4.4-3.04-5.27-1.19-7.9.67-7.9M8.86,0c-1.01,0-1.94.56-2.49,1.51-.34.59-.69,1.61-.48,3.15-1.23-.96-2.29-1.16-2.97-1.16-1.09,0-2.04.52-2.55,1.4-.51.88-.48,1.97.06,2.91.34.59,1.05,1.4,2.49,1.99-.38.15-.73.33-1.05.54-1.19.76-1.87,1.85-1.87,2.99,0,1.58,1.25,2.78,2.92,2.78.68,0,1.74-.2,2.97-1.16-.21,1.55.14,2.57.48,3.15.55.94,1.48,1.51,2.49,1.51s1.94-.56,2.49-1.51c.34-.59.69-1.61.48-3.15,1.23.96,2.29,1.16,2.97,1.16,1.66,0,2.92-1.19,2.92-2.78,0-1.14-.68-2.23-1.87-2.99-.32-.2-.67-.38-1.05-.54.38-.15.73-.33,1.05-.54,1.19-.76,1.87-1.85,1.87-2.99,0-1.58-1.25-2.78-2.92-2.78-.68,0-1.74.2-2.97,1.16.21-1.55-.14-2.57-.48-3.15-.55-.94-1.48-1.51-2.49-1.51h0Z';
  const pollGlyph = (cls) =>
    `<svg${cls ? ` class="${cls}"` : ''} viewBox="0 0 17.71 19.61" fill="currentColor" aria-hidden="true"><path d="${POLL_ICON_PATH}"/></svg>`;
  // Single-colour glyphs, one per type, inlined so they inherit the type's own
  // colour via `fill: currentColor` (set on the CSS class) — and grey out for
  // a past activity with no extra markup. viewBoxes are the artboard sizes.
  const TYPE_ICON = {
    note: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M11.99,3.91c.13.16.37.57.62,1.51l.4,1.46.92-1.2c.6-.78.98-1.07,1.16-1.17.06.2.12.66,0,1.63l-.19,1.5,1.31-.75c.81-.47,1.27-.59,1.51-.62-.03.21-.15.66-.62,1.49l-.75,1.31,1.5-.19c.37-.05.7-.07.98-.07.34,0,.55.04.66.07-.1.18-.39.56-1.18,1.17l-1.2.92,1.46.39c.95.26,1.36.5,1.53.63-.16.13-.57.36-1.5.62l-1.45.4,1.19.92c.77.59,1.05.97,1.15,1.15-.12.03-.32.07-.67.07-.28,0-.61-.02-.97-.07l-1.5-.19.75,1.31c.48.85.6,1.3.63,1.51-.2-.03-.66-.14-1.5-.62l-1.31-.75.19,1.49c.12.96.06,1.42,0,1.62-.18-.1-.57-.39-1.17-1.18l-.93-1.21-.39,1.47c-.26.98-.5,1.39-.64,1.56-.13-.17-.37-.57-.62-1.52l-.39-1.46-.92,1.19c-.6.77-.97,1.05-1.15,1.15-.06-.2-.12-.67,0-1.65l.19-1.5-1.31.75c-.82.47-1.27.59-1.51.62.03-.21.15-.67.63-1.51l.75-1.31-1.5.19c-.36.05-.69.07-.96.07-.34,0-.55-.04-.67-.07.1-.18.38-.55,1.14-1.14l1.19-.92-1.45-.4c-.93-.25-1.33-.49-1.5-.62.17-.13.58-.37,1.53-.63l1.46-.39-1.2-.92c-.78-.6-1.06-.98-1.17-1.16.12-.03.32-.07.67-.07.28,0,.61.02.97.07l1.5.19-.75-1.31c-.48-.85-.6-1.3-.63-1.51.2.03.67.14,1.52.64l1.31.75-.19-1.5c-.13-.98-.06-1.45,0-1.65.18.1.55.38,1.14,1.13l.92,1.18.4-1.44c.25-.91.48-1.3.61-1.46M11.99,3.08c-.51,0-.97.79-1.33,2.09-.73-.94-1.38-1.48-1.84-1.48-.07,0-.14.01-.2.04-.48.2-.6,1.13-.42,2.51-.83-.48-1.52-.74-1.99-.74-.21,0-.38.05-.49.17-.36.36-.12,1.27.57,2.47-.39-.05-.75-.08-1.07-.08-.78,0-1.29.16-1.43.5-.2.48.38,1.22,1.48,2.07-1.35.36-2.16.83-2.16,1.35s.8.98,2.13,1.34c-1.08.84-1.64,1.58-1.45,2.05.14.34.65.5,1.43.5.31,0,.67-.03,1.06-.08-.69,1.21-.94,2.12-.57,2.48.11.11.28.17.49.17.47,0,1.15-.26,1.98-.74-.18,1.38-.06,2.31.42,2.51.06.03.13.04.2.04.47,0,1.13-.55,1.86-1.5.36,1.34.83,2.15,1.35,2.15s1-.83,1.36-2.2c.74.97,1.41,1.53,1.89,1.53.07,0,.14-.01.2-.04.47-.2.6-1.12.42-2.49.82.47,1.5.73,1.96.73.21,0,.38-.05.49-.17.36-.36.12-1.27-.57-2.47.39.05.75.08,1.07.08.78,0,1.29-.16,1.43-.5.2-.47-.37-1.22-1.46-2.06,1.33-.36,2.13-.83,2.13-1.34s-.82-.99-2.17-1.35c1.11-.85,1.69-1.6,1.49-2.08-.14-.34-.65-.5-1.43-.5-.32,0-.68.03-1.07.08.68-1.2.92-2.1.56-2.46-.11-.11-.28-.17-.49-.17-.47,0-1.15.26-1.97.73.17-1.37.05-2.29-.42-2.49-.06-.03-.13-.04-.2-.04-.47,0-1.13.56-1.87,1.52-.36-1.33-.83-2.14-1.35-2.14h0Z"/></svg>`,
    find: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12,2.76c1.11,0,2.58.43,3.08,1.65.37.9.46,2.94-3.08,6.53-3.54-3.59-3.45-5.63-3.08-6.53.5-1.22,1.97-1.65,3.08-1.65M18.67,8.74c1.77,0,2.58,1.69,2.58,3.26,0,1.57-.81,3.26-2.58,3.26-1.06,0-2.88-.57-5.6-3.26,2.72-2.69,4.55-3.26,5.6-3.26M5.34,8.74c1.06,0,2.88.57,5.6,3.26-2.72,2.69-4.55,3.26-5.6,3.26-1.77,0-2.58-1.69-2.58-3.26s.81-3.26,2.58-3.26M12,13.06c3.54,3.59,3.45,5.63,3.08,6.53-.5,1.22-1.97,1.65-3.08,1.65s-2.58-.43-3.08-1.65c-.37-.9-.46-2.94,3.08-6.53M12,2.01c-3.4,0-6.8,3.2-.41,9.58-2.62-2.62-4.71-3.6-6.26-3.6-4.44,0-4.44,8.01,0,8.01,1.55,0,3.63-.97,6.26-3.6-6.39,6.39-2.99,9.58.41,9.58s6.8-3.2.41-9.58c2.62,2.62,4.71,3.6,6.26,3.6,4.44,0,4.44-8.01,0-8.01-1.55,0-3.63.97-6.26,3.6,6.39-6.39,2.99-9.58-.41-9.58h0Z"/></svg>`,
    photo: `<svg viewBox="2.5 2.5 19 19" fill="currentColor" aria-hidden="true"><path d="M12,4.92c3.91,0,7.08,3.18,7.08,7.08s-3.18,7.08-7.08,7.08-7.08-3.18-7.08-7.08,3.18-7.08,7.08-7.08M12,16.87c2.69,0,4.88-2.19,4.88-4.88s-2.19-4.88-4.88-4.88-4.88,2.19-4.88,4.88,2.19,4.88,4.88,4.88M12,4.17c-4.33,0-7.83,3.51-7.83,7.83s3.51,7.83,7.83,7.83,7.83-3.51,7.83-7.83-3.51-7.83-7.83-7.83h0ZM12,16.12c-2.28,0-4.13-1.85-4.13-4.13s1.85-4.13,4.13-4.13,4.13,1.85,4.13,4.13-1.85,4.13-4.13,4.13h0Z"/></svg>`,
    activity: `<svg viewBox="0 0 18.88 19.82" fill="currentColor" aria-hidden="true"><path d="M9.44,2.85l.33,1.66c.14.72.78,1.25,1.52,1.25.39,0,.76-.15,1.05-.41l1.24-1.15-.71,1.54c-.22.48-.19,1.04.1,1.48.29.45.77.72,1.3.72.06,0,.12,0,.19-.01l1.68-.2-1.48.83c-.49.27-.79.79-.79,1.35s.3,1.08.79,1.35l1.48.83-1.68-.2c-.06,0-.13-.01-.19-.01-.53,0-1.02.27-1.3.72-.29.45-.32,1-.1,1.48l.71,1.54-1.24-1.15c-.29-.27-.66-.41-1.05-.41-.74,0-1.38.53-1.52,1.25l-.33,1.66-.33-1.66c-.14-.72-.78-1.25-1.52-1.25-.39,0-.76.15-1.05.41l-1.24,1.15.71-1.54c.22-.48.19-1.04-.1-1.48-.29-.45-.77-.72-1.3-.72-.06,0-.12,0-.19.01l-1.68.2,1.48-.83c.49-.27.79-.79.79-1.35s-.3-1.08-.79-1.35l-1.48-.83,1.68.2c.06,0,.13.01.19.01.53,0,1.02-.27,1.3-.72.29-.45.32-1,.1-1.48l-.71-1.54,1.24,1.15c.29.27.66.41,1.05.41.74,0,1.38-.53,1.52-1.25l.33-1.66M9.44,0c-.11,0-.21.07-.24.2l-.83,4.18c-.08.4-.43.65-.79.65-.19,0-.38-.07-.54-.21L3.92,1.91c-.05-.05-.11-.07-.16-.07-.16,0-.3.17-.22.35l1.79,3.87c.25.54-.15,1.14-.72,1.14-.03,0-.07,0-.1,0L.27,6.68s-.02,0-.03,0c-.24,0-.34.33-.11.45l3.72,2.08c.55.31.55,1.09,0,1.4L.12,12.69c-.22.12-.13.45.11.45.01,0,.02,0,.03,0l4.23-.5s.07,0,.1,0c.57,0,.97.6.72,1.14l-1.79,3.87c-.08.18.06.35.22.35.06,0,.11-.02.16-.07l3.12-2.89c.16-.15.35-.21.54-.21.36,0,.71.24.79.65l.83,4.18c.03.13.13.2.24.2s.21-.07.24-.2l.83-4.18c.08-.4.43-.65.79-.65.19,0,.38.07.54.21l3.12,2.89c.05.05.11.07.16.07.16,0,.3-.17.22-.35l-1.79-3.87c-.25-.54.15-1.14.72-1.14.03,0,.07,0,.1,0l4.23.5s.02,0,.03,0c.24,0,.34-.33.11-.45l-3.72-2.08c-.55-.31-.55-1.09,0-1.4l3.72-2.08c.22-.12.13-.45-.11-.45-.01,0-.02,0-.03,0l-4.23.5s-.07,0-.1,0c-.57,0-.97-.6-.72-1.14l1.79-3.87c.08-.18-.06-.35-.22-.35-.06,0-.11.02-.16.07l-3.12,2.89c-.16.15-.35.21-.54.21-.36,0-.71-.24-.79-.65L9.68.2c-.03-.13-.13-.2-.24-.2h0Z"/></svg>`,
    poll: pollGlyph(),
  };
  // The "All" filter's own mark — a pentad, one dot per post type in its own
  // hue, gathered into a ring. Says "all five" literally instead of a generic
  // four-dot grid, and it's the one place the quintet earns colour outside the
  // chips themselves — ties the fold-out button to the rows it opens.
  const ICON_ALL = `<svg viewBox="0 0 24 24" aria-hidden="true">` +
    `<circle cx="12" cy="4.6" r="2.5" fill="var(--type-note)"/>` +
    `<circle cx="19.1" cy="9.8" r="2.5" fill="var(--type-find)"/>` +
    `<circle cx="16.4" cy="18.2" r="2.5" fill="var(--type-photo)"/>` +
    `<circle cx="7.6" cy="18.2" r="2.5" fill="var(--type-activity)"/>` +
    `<circle cx="4.9" cy="9.8" r="2.5" fill="var(--type-poll)"/>` +
  `</svg>`;
  // Literal hues (identical in light + dark, per tokens.css) so the composer's
  // bottom colour-wash can interpolate smoothly via @property --type — a var()
  // reference wouldn't tween. One per emergent post type.
  const TYPE_HEX = { note: '#b7a6e8', find: '#f2a58c', photo: '#9fd6e8', activity: '#b9df7d', poll: '#ea86ae' };
  // The composer's two top-level groups. Post is the unified expression form (its
  // real type — note / find / frame — is inferred from what you attach); Activity
  // is the structured plan form. Replaces the old four-way type picker.
  const PUB_GROUPS = [
    { key: 'post',     label: 'Post' },
    { key: 'activity', label: 'Activity' },
  ];
  function typeTagEl(post) {
    const past = isPastActivity(post);
    const label = past ? 'Happened' : (TYPE_LABEL[post.type] || post.type);
    const cls = past ? 'past' : post.type;
    return `<span class="type-icon type-icon--${cls}" role="img" aria-label="${esc(label)}">` +
      `${TYPE_ICON[post.type] || ''}</span>`;
  }

  // The quiet ••• overflow — it rides the bottom-left corner of the action row,
  // out of the way, a tool rather than an invitation. Opens the per-post sheet
  // (openPostMenu): Copy link for everyone, then Edit + Delete on your own posts
  // or Report on someone else's, plus Add to calendar on activities. It's the one
  // and only per-post menu now — the same glyph and the same contents wherever
  // the card renders (home feed or your own profile).
  function menuBtnHtml(post) {
    return `<button class="card-menu" type="button" data-menu="${esc(post.id)}" ` +
      `aria-label="More" title="More">${svgIcon('dots')}</button>`;
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

  const notePara = (p, author) => `<p class="card-note">${richText(p, author)}</p>`;

  // ── @mentions ──────────────────────────────────────────────────────────────
  // Tags live as plain "@username" inside note/comment text (no schema). At
  // render time a token becomes a bold italic profile link showing the DISPLAY
  // name (italic sets it apart from the author's own voice), but only when the
  // handle is a real user who was the author's friend — any other "@word" stays
  // literal text ("meet @ noon" is safe).
  const MENTION_RE = /(^|[^\w@])@([a-z0-9_]{2,20})\b/g;

  // opts.link:false renders the bold name without its profile link — for text
  // that already sits inside an anchor (a title-less find's linked caption),
  // where a nested <a> would be invalid.
  function richText(text, author, opts = {}) {
    // Tracks where the previous rendered mention ended, so a run of tagged users
    // reads as a list. Only two resolved mentions separated by a single space are
    // joined with a comma — never text after a name, so no stray commas appear.
    let prevEnd = -1;
    return esc(text).replace(MENTION_RE, (m, lead, handle, offset) => {
      const u = Store.user(handle);
      if (!u || !Store.areFriends(author, handle)) { prevEnd = -1; return m; }
      const name = esc(u.name);
      if (lead === ' ' && offset === prevEnd) lead = '<strong class="mention">,</strong> ';
      prevEnd = offset + m.length;
      return lead + (opts.link === false
        ? `<strong class="mention">${name}</strong>`
        : `<a class="mention" href="#/u/${esc(encodeURIComponent(handle))}">${name}</a>`);
    });
  }

  // ── Rich notes (blog-style headings + emphasis) ─────────────────────────────
  // A Note can carry H1/H2 headings and inline bold/italic. It's composed in a
  // contenteditable (see wireRichEditor) and stored as a SMALL, normalised HTML
  // subset — only <h1>/<h2>/<p>/<strong>/<em>, zero attributes, with @mentions
  // left as plain "@handle" tokens (resolved to links at render, exactly like a
  // legacy note). The serializer (compose → storage) and the renderer (storage →
  // feed) run the SAME allow-list walk, so nothing outside that subset survives in
  // either direction. The render pass is the real trust boundary: a hostile client
  // could POST any `note`, so we never inject stored HTML raw — we rebuild it,
  // escaping every text run and dropping every tag/attribute we don't allow.
  const RICH_LEAD = /^\s*<(h1|h2|p)>/i;         // our serializer always leads with one of these
  const isRichNote = (s) => RICH_LEAD.test(String(s || ''));

  // Walk a node's children, emitting only bold/italic inline tags; each text node
  // passes through `textFn` (esc for storage, richText for display — so mentions
  // link only when rendering). Unknown elements are flattened to their text: a
  // pasted <span style> or stray <font> keeps its words, loses its markup.
  function richInline(node, textFn) {
    let out = '';
    node.childNodes.forEach((n) => {
      if (n.nodeType === 3) { out += textFn(n.nodeValue || ''); return; }
      if (n.nodeType !== 1) return;
      const tag = n.tagName.toLowerCase();
      if (tag === 'strong' || tag === 'b') {
        const inner = richInline(n, textFn);
        if (inner.trim()) out += `<strong>${inner}</strong>`;
      } else if (tag === 'em' || tag === 'i') {
        const inner = richInline(n, textFn);
        if (inner.trim()) out += `<em>${inner}</em>`;
      } else if (tag === 'script' || tag === 'style' || tag === 'br') {
        // Drop entirely: never surface script/style text, even escaped; <br> is
        // handled at the block level (each visual line is its own paragraph).
      } else {
        out += richInline(n, textFn);           // flatten anything else to its plain text
      }
    });
    return out;
  }

  // Split a root (the live editor, or parsed stored HTML) into normalised blocks:
  // bare / <div> / <p> lines become paragraphs, <h1>/<h2> stay headings, and
  // text-empty blocks are dropped. `cls` maps a tag → its render class (null for
  // the storage + editor form, which carries no classes).
  function richBlocks(root, textFn, cls) {
    const out = [];
    const emit = (tag, node) => {
      const inner = richInline(node, textFn);
      if (!inner.replace(/<[^>]+>/g, '').trim()) return;    // no real text → skip
      const c = cls && cls[tag] ? ` class="${cls[tag]}"` : '';
      out.push(`<${tag}${c}>${inner}</${tag}>`);
    };
    const kids = Array.from(root.childNodes);
    const blockLevel = (n) => n.nodeType === 1 && /^(div|p|h1|h2)$/i.test(n.tagName);
    if (!kids.some(blockLevel)) { emit('p', root); return out; }   // one loose line, no wrappers
    let buf = document.createElement('p');
    const flush = () => { if (buf.childNodes.length) { emit('p', buf); buf = document.createElement('p'); } };
    kids.forEach((n) => {
      if (n.nodeType === 1 && /^h[12]$/i.test(n.tagName)) { flush(); emit(n.tagName.toLowerCase(), n); }
      else if (blockLevel(n)) { flush(); emit('p', n); }
      else buf.appendChild(n.cloneNode(true));
    });
    flush();
    return out;
  }

  // Parse stored note HTML in an inert document (DOMParser runs no scripts and
  // loads no resources on a detached doc), so re-walking hostile input is safe.
  const parseNoteHtml = (html) =>
    new DOMParser().parseFromString(String(html || ''), 'text/html').body;

  // compose → storage: clean HTML, every text run escaped, mentions kept as tokens.
  const serializeNote = (editor) => richBlocks(editor, esc, null).join('');

  // storage → feed: same walk, but text flows through richText (so @mentions link)
  // and blocks carry render classes. Safe to inject: fixed tags, all text escaped.
  // opts flows into richText ({ link: false } un-links @mentions, for when the
  // whole body is about to be nested inside another anchor); opts.trailingIcon
  // splices markup just inside the last block's closing tag (a titleless find's
  // external-link glyph, placed at the true end of the visible text).
  const RICH_CLASS = { h1: 'card-h1', h2: 'card-h2', p: 'card-note' };
  const renderRichNote = (html, author, opts = {}) => {
    const blocks = richBlocks(parseNoteHtml(html), (t) => richText(t, author, opts), RICH_CLASS);
    if (opts.trailingIcon && blocks.length) {
      const last = blocks.length - 1;
      blocks[last] = blocks[last].replace(/<\/(h1|h2|p)>$/, `${opts.trailingIcon}</$1>`);
    }
    return blocks.join('');
  };

  // storage/legacy → editor: clean editable HTML (no classes, no links). A legacy
  // plain-text note becomes paragraphs; a rich note re-walks to the same subset.
  const editorPrefill = (note) =>
    !note ? ''
      : isRichNote(note) ? richBlocks(parseNoteHtml(note), esc, null).join('')
      : noteParas(note).map((p) => `<p>${esc(p)}</p>`).join('');

  // Read a note field's value whether it's a plain textarea (find/photo/activity
  // captions) or the rich contenteditable (a Note, → its stored HTML subset, ''
  // when empty). Lets the two submit paths stay one-liners.
  function readNoteField(id) {
    const el = document.getElementById(id);
    if (!el) return '';
    return el.isContentEditable ? serializeNote(el) : (el.value || '').trim();
  }

  // The note block for a text entry. Paragraphs always render intact; a long note
  // additionally wraps them in a height-clamped clip + a "Read more" toggle. Open
  // state lives in `openReadMore` so it survives a card rebuild (like openComments).
  function cardNoteHtml(post) {
    if (!post.note) return '';
    const rich = isRichNote(post.note);
    const body = rich
      ? renderRichNote(post.note, post.author)
      : noteParas(post.note).map(p => notePara(p, post.author)).join('');
    // Gate Read-more on the visible text length, not the raw markup (headings and
    // emphasis tags would otherwise trip the teaser on a short, formatted note).
    const plainLen = rich ? post.note.replace(/<[^>]+>/g, '').length : post.note.length;
    if (plainLen <= READMORE_MIN) return body;

    const open = openReadMore.has(post.id);
    return `<div class="readmore${open ? ' open' : ''}">` +
        `<div class="readmore-clip">${body}</div>` +
        `<button class="readmore-toggle" type="button" aria-expanded="${open}">` +
          `${open ? 'Read less' : 'Read more'}</button>` +
      `</div>`;
  }

  // ── The rich Note field (compose + edit share it) ───────────────────────────
  // A title row (with a collapsible H1/H2/B/I toolbar behind an "Aa" toggle),
  // then a contenteditable body, all in one bordered combo box. `idp` prefixes
  // the ids: 'c' compose, 'e' edit.
  const NOTE_MAX = 15000;   // a Note runs long (a short essay); captions stay 180

  function richToolbarHtml(idp) {
    // Specimen buttons: each glyph is set in the exact style it applies, so the
    // control previews its own effect — H1 upright serif, H2 italic serif, then
    // B / I in Oxygen. Styled in .rich-toolbar (app.css).
    return `<div class="rich-toolbar" role="toolbar" aria-label="Text formatting">` +
        `<button type="button" class="rt-btn rt-h1" data-cmd="h1" aria-pressed="false" aria-label="Heading">H1</button>` +
        `<button type="button" class="rt-btn rt-h2" data-cmd="h2" aria-pressed="false" aria-label="Subheading">H2</button>` +
        `<span class="rt-sep" aria-hidden="true"></span>` +
        `<button type="button" class="rt-btn rt-b" data-cmd="bold" aria-pressed="false" aria-label="Bold">B</button>` +
        `<button type="button" class="rt-btn rt-i" data-cmd="italic" aria-pressed="false" aria-label="Italic">I</button>` +
      `</div>`;
  }

  // Title + the "Aa" toggle share one row; the toolbar itself rides in a
  // collapsible panel beneath (closed by default — most posts never touch it),
  // wired open/closed in wireRichEditor. The count lives on the title row, not
  // the toolbar, so it stays visible even while the panel is collapsed.
  function richNoteField(idp, titleVal, noteHtml, notePh) {
    return `<div class="field field--combo field--rich">` +
        `<div class="rich-title-row">` +
          `<input id="${idp}-title" class="combo-title" type="text" maxlength="120" ` +
            `value="${esc(titleVal || '')}" placeholder="Title (optional)" aria-label="Title">` +
          `<span class="rt-count" id="${idp}-note-count" aria-hidden="true"></span>` +
          `<button type="button" class="rt-btn rt-toggle" aria-expanded="false" ` +
            `aria-controls="${idp}-toolbar-panel" aria-label="Text styles">Aa</button>` +
        `</div>` +
        `<div class="rich-toolbar-panel" id="${idp}-toolbar-panel">` +
          `<div class="rich-toolbar-inner">${richToolbarHtml(idp)}</div>` +
        `</div>` +
        `<div class="combo-divider" aria-hidden="true"></div>` +
        `<div id="${idp}-note" class="combo-note rich-note" contenteditable="true" role="textbox" ` +
          `aria-multiline="true" aria-label="Your note" data-placeholder="${esc(notePh)}">${noteHtml || ''}</div>` +
        // Bottom-right attach bar: link + photo. Each is a live toggle that flips the
        // post's inferred type (link → Find, photo → Frame) and pops the masthead mark.
        // Wired in renderPublish (wireAttachBar); only the composer's Post form mounts it.
        `<div class="rich-attach" role="group" aria-label="Attach to your post">` +
          `<button type="button" class="rt-attach" id="${idp}-add-link" ` +
            `aria-label="Add a link" aria-pressed="false">${svgIcon('link', 'rt-attach-ico')}</button>` +
          `<button type="button" class="rt-attach" id="${idp}-add-photo" ` +
            `aria-label="Add a photo or clip" aria-pressed="false">${svgIcon('image', 'rt-attach-ico')}</button>` +
          `<button type="button" class="rt-attach rt-attach--poll" id="${idp}-add-poll" ` +
            `aria-label="Add a poll" aria-pressed="false">${svgIcon('poll', 'rt-attach-ico')}</button>` +
        `</div>` +
      `</div>`;
  }

  // Wire a rich Note editor: the H1/H2/B/I toolbar, plain-text-only paste, the
  // NOTE_MAX cap + its count, the empty-state placeholder, and toolbar active
  // state. Mentions are wired separately (wireMentions handles contenteditable).
  function wireRichEditor(editor, countEl) {
    if (!editor) return;
    const toolbar = editor.parentElement.querySelector('.rich-toolbar');
    const len = () => editor.textContent.length;

    // The "Aa" button reveals/hides the toolbar panel — closed by default, so a
    // short post never shows it at all.
    const togglePanel = editor.parentElement.querySelector('.rich-toolbar-panel');
    const toggleBtn = editor.parentElement.querySelector('.rt-toggle');
    if (toggleBtn && togglePanel) {
      toggleBtn.addEventListener('click', () => {
        const open = togglePanel.classList.toggle('is-open');
        toggleBtn.setAttribute('aria-expanded', String(open));
      });
    }

    const syncEmpty = () => {
      // Collapse a field left holding only a stray <br>/empty block back to truly
      // empty, so the placeholder shows and formatBlock/typing start clean.
      if (!editor.textContent.trim() && editor.innerHTML !== '') editor.innerHTML = '';
      editor.classList.toggle('is-empty', !editor.textContent.trim());
    };
    const syncCount = () => {
      if (!countEl) return;
      const left = NOTE_MAX - len();
      countEl.textContent = left <= 500 ? String(left) : '';
      countEl.classList.toggle('is-over', left < 0);
    };
    const curBlock = () => {
      let n = window.getSelection().anchorNode;
      while (n && n !== editor) {
        if (n.nodeType === 1 && /^h[12]$/i.test(n.tagName)) return n.tagName.toLowerCase();
        n = n.parentNode;
      }
      return '';
    };
    const syncActive = () => {
      const block = curBlock();
      let bold = false, italic = false;
      try { bold = document.queryCommandState('bold'); italic = document.queryCommandState('italic'); } catch (_) {}
      const set = (s, on) => { const b = toolbar.querySelector(s); if (b) b.setAttribute('aria-pressed', String(on)); };
      set('.rt-h1', block === 'h1'); set('.rt-h2', block === 'h2');
      set('.rt-b', bold); set('.rt-i', italic);
    };

    const exec = (cmd) => {
      editor.focus();
      if (cmd === 'bold' || cmd === 'italic') {
        document.execCommand('styleWithCSS', false, false);   // semantic <b>/<i>, not styled spans
        document.execCommand(cmd);
      } else {   // h1 / h2 — toggle the caret's block (a second tap drops back to a paragraph)
        document.execCommand('formatBlock', false, curBlock() === cmd ? 'P' : cmd.toUpperCase());
      }
      syncEmpty(); syncActive(); syncCount();
    };
    toolbar.querySelectorAll('.rt-btn').forEach((btn) =>
      // mousedown + preventDefault keeps the editor's selection/focus through the tap
      btn.addEventListener('mousedown', (e) => { e.preventDefault(); exec(btn.dataset.cmd); }));

    // Paste as plain text only — no foreign markup, and never past the cap.
    editor.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text/plain');
      const room = NOTE_MAX - len();
      if (room > 0 && text) document.execCommand('insertText', false, text.slice(0, room));
    });
    // Hold typed/inserted text at the cap (deletions and caret moves always pass).
    editor.addEventListener('beforeinput', (e) => {
      if (!/^insert/.test(e.inputType) || e.inputType === 'insertFromPaste') return;
      const sel = window.getSelection();
      const selLen = sel && !sel.isCollapsed ? sel.toString().length : 0;
      if (len() - selLen + (e.data ? e.data.length : 1) > NOTE_MAX) e.preventDefault();
    });
    editor.addEventListener('input', () => { syncEmpty(); syncCount(); });
    // Track the caret for the toolbar's active state; self-removes once the editor
    // leaves the DOM (composer type-switch, closing an edit) so nothing piles up.
    const onSel = () => {
      if (!editor.isConnected) { document.removeEventListener('selectionchange', onSel); return; }
      if (editor.contains(window.getSelection().anchorNode)) syncActive();
    };
    document.addEventListener('selectionchange', onSel);

    syncEmpty(); syncCount();
    // Desktop autofocuses like the old textarea; touch waits for the tap so the
    // keyboard doesn't lurch the viewport (mirrors the edit-form focus rule).
    if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) editor.focus();
  }

  // A reliable double-tap detector. The native `dblclick` event doesn't fire
  // dependably on phones (a double-tap there is the browser's zoom gesture), so
  // we count two quick taps ourselves off `click` (which every tap raises) —
  // two within DOUBLE_TAP_MS, landing near the same spot, count as a double-tap.
  const DOUBLE_TAP_MS = 400;
  function onDoubleTap(el, handler) {
    let last = 0, lx = 0, ly = 0;
    el.addEventListener('click', (e) => {
      const now = Date.now();
      if (now - last < DOUBLE_TAP_MS &&
          Math.abs(e.clientX - lx) < 32 && Math.abs(e.clientY - ly) < 32) {
        last = 0;
        handler(e);
      } else {
        last = now; lx = e.clientX; ly = e.clientY;
      }
    });
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

    function setOpen(open) {
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
    }

    toggle.addEventListener('click', () => setOpen(!wrap.classList.contains('open')));

    // Double-tap anywhere on the card (the same whole-card hitbox an Updates
    // spotlight lands on) collapses an opened note back to the teaser — a quick
    // way out without reaching for the toggle. Only when open, and never on a
    // link/button/field (mentions, actions, the comment box) so their taps fire.
    onDoubleTap(el, (e) => {
      if (!wrap.classList.contains('open') || e.target.closest('a, button, input, textarea')) return;
      // Rise to the top of the post first, then fold it away. Collapsing while the
      // page is still gliding looks busy and can land the post short of the top;
      // scrolling first lets the fold play out with the post already settled.
      scrollCardToTop(el).then(() => setOpen(false));
    });
  }

  // ── @mention composer: a small friend-picker under the field ─────────────
  // Typing "@" in a note/comment field opens a listbox of your mutual friends,
  // filtered as you type (against username AND display name). Arrow keys move,
  // Enter/Tab inserts "@username ", Escape dismisses; tap works too. ARIA
  // combobox wiring (aria-expanded / activedescendant + a polite live region)
  // so screen readers hear the suggestions.
  let mentionSeq = 0;
  function wireMentions(field) {
    if (!field) return;
    const isCE = field.isContentEditable;   // the rich Note editor vs a plain textarea
    const listId = `mentions-${++mentionSeq}`;
    const list = document.createElement('ul');
    list.className = 'mention-list';
    list.id = listId;
    list.setAttribute('role', 'listbox');
    list.hidden = true;
    const live = document.createElement('div');
    live.className = 'visually-hidden';
    live.setAttribute('aria-live', 'polite');
    // The comment form is a flex row, so the list sits after the form itself; the
    // textarea composer drops it under the field; the rich Note editor drops it
    // below the whole combo box, clear of the toolbar strip at the box's foot.
    const anchor = field.closest('.comment-form')
      || (isCE && field.closest('.field--combo'))
      || field;
    anchor.insertAdjacentElement('afterend', list);
    list.insertAdjacentElement('afterend', live);
    field.setAttribute('aria-autocomplete', 'list');
    field.setAttribute('aria-expanded', 'false');

    let items = [];        // matched user objects
    let active = -1;       // highlighted row
    let token = null;      // textarea: {start,end} in value; CE: {node,start,end} in a text node

    const close = () => {
      list.hidden = true;
      items = []; active = -1; token = null;
      field.setAttribute('aria-expanded', 'false');
      field.removeAttribute('aria-controls');
      field.removeAttribute('aria-activedescendant');
      live.textContent = '';
    };

    const highlight = (i) => {
      active = i;
      list.querySelectorAll('[role="option"]').forEach((li, j) => {
        li.setAttribute('aria-selected', String(j === i));
        li.classList.toggle('active', j === i);
      });
      const u = items[i];
      if (u) {
        field.setAttribute('aria-activedescendant', `${listId}-${i}`);
        live.textContent = `${items.length} friend${items.length === 1 ? '' : 's'} found. ${u.name} highlighted.`;
      }
    };

    const pick = (i) => {
      const u = items[i];
      if (!u || !token) return;
      const ins = `@${u.username} `;
      if (!isCE) {
        field.setRangeText(ins, token.start, token.end, 'end');
      } else {
        // Splice the "@query" out of its text node, drop the caret past the handle,
        // then fire input so the editor's count/placeholder refresh.
        const t = token.node, text = t.nodeValue || '';
        t.nodeValue = text.slice(0, token.start) + ins + text.slice(token.end);
        const sel = window.getSelection(), range = document.createRange();
        range.setStart(t, token.start + ins.length); range.collapse(true);
        sel.removeAllRanges(); sel.addRange(range);
        field.dispatchEvent(new Event('input', { bubbles: true }));
      }
      close();
      field.focus();
    };

    const update = () => {
      // The text before the caret, and the token anchor, differ by field kind:
      // a textarea reads value + selectionStart; the editor reads the caret's
      // text node (mentions are always typed within a single run).
      let before, mkToken;
      if (!isCE) {
        const caret = field.selectionStart;
        before = field.value.slice(0, caret);
        mkToken = (len) => ({ start: caret - len - 1, end: caret });
      } else {
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount || !sel.isCollapsed) { close(); return; }
        const node = sel.anchorNode, off = sel.anchorOffset;
        if (!node || node.nodeType !== 3 || !field.contains(node)) { close(); return; }
        before = (node.nodeValue || '').slice(0, off);
        mkToken = (len) => ({ node, start: off - len - 1, end: off });
      }
      // Only while the caret sits at the end of an "@word" that starts the
      // text or follows whitespace — never mid-email, never after letters.
      const m = /(?:^|\s)@([a-z0-9_]*)$/i.exec(before);
      if (!m) { close(); return; }
      const q = m[1].toLowerCase();
      items = Store.friends().map(Store.user).filter(u => u &&
        (u.username.includes(q) || u.name.toLowerCase().includes(q)));
      if (!items.length) { close(); return; }
      token = mkToken(m[1].length);
      list.innerHTML = items.map((u, i) =>
        `<li role="option" id="${listId}-${i}" aria-selected="false">` +
          avatarEl(u, { cls: 'comment-avatar' }) +
          `<span class="mention-opt-name">${esc(u.name)}</span>` +
          `<span class="mention-opt-handle">@${esc(u.username)}</span>` +
        `</li>`).join('');
      list.hidden = false;
      field.setAttribute('aria-expanded', 'true');
      field.setAttribute('aria-controls', listId);
      list.querySelectorAll('[role="option"]').forEach((li, i) => {
        // mousedown (not click) so the field never loses focus mid-pick
        li.addEventListener('mousedown', (e) => { e.preventDefault(); pick(i); });
      });
      highlight(0);
    };

    field.addEventListener('input', update);
    field.addEventListener('click', update);
    field.addEventListener('blur', () => setTimeout(close, 100));
    field.addEventListener('keydown', (e) => {
      if (list.hidden) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); highlight((active + 1) % items.length); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); highlight((active - 1 + items.length) % items.length); }
      else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(active); }
      else if (e.key === 'Escape') { e.stopPropagation(); close(); }
    });
  }

  // The tag chips, wrapped — reused in text and photo entries.
  function tagChips(post) {
    if (!post.tags || !post.tags.length) return '';
    return `<div class="tags">` +
      post.tags.map(t => `<button class="tag" type="button" data-tag="${esc(t)}">${esc(t)}</button>`).join('') +
      `</div>`;
  }

  // Likes, comments, headcount, and add-to-calendar are all friends-only gestures:
  // you can act on a friend's post (or your own), never a stranger's. On a
  // non-friend's profile their posts still show, but with no thread and no social
  // row. One gate for all of them (the store guards each write too — see
  // Store.addComment / toggleLike / toggleGoing).
  const canSocial = (post) =>
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
    if (!canSocial(post)) return '';
    const owns = post.author === Store.session();
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
    // data-type sets the post's own colour (--burst) for the tap's ink flood and
    // sparkle burst; the classed heart is the target of the scale-pop. The settled
    // liked look is a still fill on that same colour — the tap adds the one-shot
    // motion.
    return `<button class="card-like${liked ? ' liked' : ''}" type="button" aria-pressed="${liked}" ` +
        `data-type="${post.type}" ` +
        `aria-label="${liked ? 'Unlike' : 'Like'}" title="${liked ? 'Liked' : 'Like'}">` +
        svgIcon('heart', 'like-heart') +
      `</button>`;
  }

  // Attendees — activities only, and public (unlike likes): the count is the
  // point. The people-glyph + count anchor the LEFT of the action row for host
  // and guests alike (gradient-filled like a liked heart — see .card-attendees);
  // tapping opens the who's-going panel.
  function attendeesHtml(post) {
    if (post.type !== 'activity') return '';
    if (!canSocial(post)) return '';
    const n = Store.headcountFor(post.id).filter(h => !Blocks.has(h.user)).length;
    const open = openGoing.has(post.id);
    return `<button class="card-attendees" type="button" ` +
        `aria-expanded="${open}" aria-label="${n} going, see who" title="Who’s going">` +
        svgIcon('going') +
        `<span class="card-attendees-count">${n}</span>` +
      `</button>`;
  }

  // RSVP toggle — activities, friends only (the host doesn't RSVP to their own
  // plan). A word toggle on the RIGHT: "going?" at rest, "going ✓" once you're
  // in (gradient treatment). Flipping it rebuilds the card so the attendee count
  // on the left updates too.
  function goingToggleHtml(post) {
    if (post.type !== 'activity' || !canSocial(post)) return '';
    if (post.author === Store.session()) return '';
    if (isPastActivity(post)) return '';   // the plan's Happened — nothing left to RSVP to
    const going = Store.goingByMe(post.id);
    return `<button class="card-going${going ? ' going' : ''}" type="button" aria-pressed="${going}" ` +
        `aria-label="${going ? 'You’re going. Tap if you can’t make it' : 'Count me in'}" ` +
        `title="${going ? 'You’re in' : 'Count me in'}">` +
        (going ? `<span>going</span>${svgIcon('check')}` : `<span>going?</span>`) +
      `</button>`;
  }

  // Add-to-calendar — activities with a date only, same friends gate as the
  // hand-up toggle, and gone once the plan has Happened. It's a "take this plan
  // somewhere else" action, sibling to Copy link, so it lives in the ••• menu
  // rather than as its own glyph (see openPostMenu). This predicate gates it.
  function isCalendarable(post) {
    return post.type === 'activity' && post.eventDate && !isPastActivity(post) && canSocial(post);
  }

  function goingPanelHtml(post) {
    if (post.type !== 'activity') return '';
    if (!canSocial(post)) return '';
    const list = Store.headcountFor(post.id).filter(h => !Blocks.has(h.user));
    const open = openGoing.has(post.id);
    return `<div class="going-panel${open ? ' open' : ''}">` +
        `<div class="comments-inner">` +
          `<div class="comments-content">` +
            (list.length
              ? `<ul class="likers-list">${list.map(likerItemHtml).join('')}</ul>`
              : `<p class="likers-empty">No one’s going yet.</p>`) +
          `</div>` +
        `</div>` +
      `</div>`;
  }

  // A poll's live countdown, said plainly. Coarse on purpose (minutes, then
  // hours) — a poll isn't a stopwatch, and re-renders on interaction/navigation
  // keep it fresh enough without a ticking timer.
  function pollTimeLabel(post) {
    const ms = Store.pollClosesAt(post).getTime() - Date.now();
    if (ms <= 0) return 'Poll closed';
    const mins = Math.round(ms / 60000);
    if (mins < 60) return `Closes in ${mins} min${mins === 1 ? '' : 's'}`;
    const hrs = Math.round(mins / 60);
    return `Closes in ${hrs} hour${hrs === 1 ? '' : 's'}`;
  }

  // The poll widget under a poll card: the question, then the choices, then a
  // status line. Results stay HIDDEN until you cast a vote (no bandwagon) — then
  // each choice grows a fill bar with its share, your pick is checked, and the
  // leader is marked. A closed poll locks to a read-only final tally. Voting is
  // friends-only (canSocial); a non-friend viewing a public account sees the
  // choices statically with no results and no way to vote.
  // `justVoted` (a choice index or null) is set only when re-rendering the widget
  // straight after a tap — it flags the freshly cast pick so CSS runs the reward
  // flourish (bars grow from zero, your pick washes with the rotating Tria
  // gradient before it settles to the neutral outline). A plain render (feed,
  // navigation, reload) passes null and the results just sit there, flat.
  // The settling burst: the same y2k stars as the like tap (position x/y px, size
  // s, spin r deg, stagger d ms), reused verbatim but painted in page ink so colour
  // stays reserved for the gradient. Fanned up-and-out; offsets stay inside the
  // ~16px radius the shared .spark keyframes fully fade within, so nothing grazes
  // the row's overflow edge (and the layer anchor is clamped off the side walls).
  const POLL_SPARKS = [
    { x:  -2, y: -15, s: 11, r:  16, d:  0 },
    { x: -13, y:  -9, s:  9, r:  -8, d: 30 },
    { x:  14, y:  -8, s: 10, r:  14, d: 20 },
    { x: -16, y:   3, s:  8, r: -14, d: 55 },
    { x:  15, y:   4, s:  8, r:  12, d: 45 },
    { x:  -6, y:  11, s:  7, r: -18, d: 70 },
  ];
  function pollWidgetHtml(post, justVoted = null) {
    if (post.type !== 'poll' || !post.poll) return '';
    const options = post.poll.options || [];
    const closed = Store.pollClosed(post);
    const myChoice = Store.myPollVote(post.id);
    const voted = myChoice !== null;
    const reveal = voted || closed;
    const interactive = canSocial(post) && !closed;
    const votes = Store.pollVotesFor(post.id).filter(v => !Blocks.has(v.user));
    const total = votes.length;
    const counts = options.map((_, i) => votes.filter(v => v.choice === i).length);
    const max = Math.max(0, ...counts);

    const rows = options.map((label, i) => {
      const n = counts[i];
      const pct = total ? Math.round((n / total) * 100) : 0;
      const mine = myChoice === i;
      const leads = reveal && n > 0 && n === max;
      const cls = ['poll-option', mine ? 'is-mine' : '', reveal ? 'is-revealed' : '',
                   leads ? 'is-leading' : ''].filter(Boolean).join(' ');
      const fillCls = 'poll-fill' + (justVoted === i ? ' is-voting' : '');
      // Your freshly cast pick also (a) rolls its percentage in with the same
      // count-tick used by likes/RSVPs and (b) throws a one-shot quintet burst
      // off the fill's leading edge once the sweep lands — "got it, here's where
      // you stand." Both only on the just-voted row, both gated for reduced motion.
      const isFresh = justVoted === i;
      const pctCls = 'poll-option-pct' + (isFresh ? ' count-tick-up' : '');
      const burst = isFresh
        ? `<span class="poll-burst" style="left:clamp(22px, ${pct}%, calc(100% - 22px))" aria-hidden="true">` +
            POLL_SPARKS.map(p =>
              `<span class="spark" style="--x:${p.x}px;--y:${p.y}px;--s:${p.s}px;--r:${p.r}deg;` +
                `animation-delay:calc(0.92s + ${p.d}ms)"></span>`).join('') +
          `</span>`
        : '';
      const inner =
        (reveal ? `<span class="${fillCls}" style="width:${pct}%"></span>` : '') +
        `<span class="poll-option-label">${esc(label)}</span>` +
        (reveal ? `<span class="${pctCls}">${pct}%</span>` : '') +
        (mine ? `<span class="poll-check" aria-hidden="true">${svgIcon('check')}</span>` : '') +
        burst;
      return interactive
        ? `<button type="button" class="${cls}" data-choice="${i}"${mine ? ' aria-pressed="true"' : ''}>${inner}</button>`
        : `<div class="${cls}">${inner}</div>`;
    }).join('');

    const meta = reveal
      ? `${total} vote${total === 1 ? '' : 's'} · ${pollTimeLabel(post)}`
      : interactive
        ? `Vote to see results · ${pollTimeLabel(post)}`
        : pollTimeLabel(post);

    return `<div class="poll${closed ? ' is-closed' : ''}${justVoted !== null ? ' poll--just-voted' : ''}" data-poll="${post.id}">` +
        `<div class="poll-options">${rows}</div>` +
        `<p class="poll-meta">${meta}</p>` +
      `</div>`;
  }

  function cardActionsHtml(post, opts) {
    const attendees = attendeesHtml(post);
    const rsvp = goingToggleHtml(post);
    const like = likeButtonHtml(post);
    const n = Store.commentsFor(post.id).filter(c => !Blocks.has(c.author)).length;
    const expanded = openComments.has(post.id);
    const comment = canSocial(post)
      ? `<button class="card-comment" type="button" aria-expanded="${expanded}" ` +
          `aria-label="${n ? n + ' comment' + (n === 1 ? '' : 's') : 'Comments'}" title="Comments">` +
          svgIcon('comment') +
          (n ? `<span class="card-comment-count">${n}</span>` : '') +
        `</button>`
      : '';
    // The ••• overflow carries every owner tool now (Edit, Delete) plus Copy link
    // and Add to calendar — the same menu whether the card is on your profile or
    // in the feed. It sits leftmost of the left cluster, bottom-left corner of the
    // card, out of the way.
    const menu = menuBtnHtml(post);

    if (!attendees && !rsvp && !like && !comment && !menu) return '';

    // Activities split into two ends. LEFT: the ••• menu, then the attendee count
    // — the plan. RIGHT: the RSVP toggle, then comments + likes. RSVP leads the
    // social cluster so comment + like are ALWAYS the two rightmost glyphs, in the
    // exact same spot whether or not an RSVP rides along.
    if (post.type === 'activity') {
      const meta = `<div class="card-meta">${menu}${attendees}</div>`;
      const social = `<div class="card-social">${rsvp}${comment}${like}</div>`;
      return `<div class="card-actions card-actions--activity">${meta}${social}</div>`;
    }

    // Everything non-activity — a single row: social cluster on the right, the •••
    // menu tucked left (row-reverse, so the menu ends up leftmost).
    return `<div class="card-actions"><div class="card-social">${attendees}${rsvp}${comment}${like}</div>${menu}</div>`;
  }

  // opts.solo → this card sits on a profile (single author): show the slim
  // date line instead of the full avatar + name byline.
  function makeCard(post, opts = {}) {
    const head = opts.solo ? soloMetaEl(post) : bylineEl(post);
    const actions = cardActionsHtml(post, opts);
    const el = document.createElement('article');
    el.className = `card card--${post.type}`;
    el.dataset.id = post.id;
    el.dataset.type = post.type;
    el.dataset.tags = (post.tags || []).join(',');

    if (post.type === 'photo') {
      // Identity first, then caption + tags, then the full-bleed frame last —
      // text settles before the media so the two don't compete for the read.
      // Real uploads (post.image) show the still/clip; seed entries fall back
      // to the tonal placeholder. A Frame video's `image` holds the clip URL;
      // `poster` (best-effort) holds its first-frame still.
      const isVideo = post.image && isVideoUrl(post.image);
      const d = post.image ? imageDimsFromUrl(post.image) : null;
      const img = post.image
        ? { src: isVideo ? (post.poster || null) : post.image, alt: notePlain(post.note) || post.title || 'Frame', w: d && d.w, h: d && d.h, tint: post.tint }
        : placeholderPhoto(post.id, post.note);
      // Known dimensions → width/height attributes let the browser hold the exact
      // space before the media loads (no feed reflow). Legacy photos without a
      // stamped size fall back to a reserved box, cleared once the media lands.
      const sized = img.w && img.h;
      // The placeholder + reserved box live on .photo-frame, NOT the <img>. The
      // image is held at opacity 0 until its bitmap is decoded, so anything painted
      // on the image itself (the old average-colour wash) stayed invisible too —
      // you just saw page background until the photo popped in. The frame instead
      // draws a rounded outline at the photo's real aspect ratio (a crop preview),
      // filled with the photo's average colour (the `tint` column) when we have it;
      // the decoded image then eases in over it on a plain scale + opacity settle.
      // A video Frame with no stored poster skips straight to that tint box —
      // wireFrameVideo's own #t=0.001 clip self-paints the first frame instead.
      const tint = img.tint;
      const frameStyle =
        (sized ? `aspect-ratio:${img.w}/${img.h};` : '') +
        (tint ? `--ph-fill:${tint};` : '');
      // The text block above the media reads exactly like a Note's: serif headline
      // (if any), then the rich caption (headings/emphasis + Read-more clamp), then
      // tags. cardNoteHtml renders the same rich subset the composer offers, so a
      // formatted Frame caption no longer arrives as raw markup.
      const photoTitleHtml = post.title ? `<h2 class="card-title">${esc(post.title)}</h2>` : '';
      const foot = photoTitleHtml + cardNoteHtml(post) + tagChips(post);
      const mediaHtml =
        (img.src ? `<img src="${img.src}" alt="${esc(img.alt)}"${sized ? ` width="${img.w}" height="${img.h}"` : ''} loading="lazy" decoding="async">` : '') +
        (isVideo
          ? `<button type="button" class="frame-sound" aria-label="Play with sound" aria-pressed="false">${svgIcon('mute', 'frame-sound-ico')}</button>` +
            `<span class="frame-play" aria-hidden="true">${svgIcon('play', 'frame-play-ico')}</span>` +
            `<div class="frame-progress" aria-hidden="true"><span class="frame-progress-fill"></span></div>`
          : '');
      // .card-main holds the post itself (ending in the action row); the comment
      // thread expands as a sibling below, tucked under it on the same left axis.
      el.innerHTML =
        `<div class="card-main">` +
          head +
          (foot ? `<div class="card-foot">${foot}</div>` : '') +
          `<figure class="photo${isVideo ? ' frame-video' : ''}" tabindex="0" role="button" aria-label="${isVideo ? 'Play frame' : 'Enlarge photo'}">` +
            `<div class="photo-frame${sized ? '' : ' photo-frame--reserve'}"${frameStyle ? ` style="${frameStyle}"` : ''}>` +
              mediaHtml +
            `</div>` +
          `</figure>` +
          actions +
        `</div>` +
        likersPanelHtml(post) +
        commentsPanelHtml(post);
      el.dataset.sig = hashStr(el.className + '|' + el.innerHTML);
      if (isVideo) wireFrameVideo(el, post);
      else wirePhoto(el, img);
      wireLikes(el, post, opts);
      wireComments(el, post, opts);
      wireCardCollapse(el, post);
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
    // whole — the Read-more clamp would nest a button inside the anchor. Covers
    // a rich caption (headings/emphasis) same as a plain one — renderRichNote's
    // { link: false } keeps a @mention from nesting its own <a> in here too.
    const linkedNote = post.type === 'find' && post.url && !post.title && post.note;
    const extIcon = `<span class="card-title-ext" aria-hidden="true">${svgIcon('extlink')}</span>`;
    const noteHtml = linkedNote
      ? `<a class="card-note-link" href="${esc(post.url)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ''}>` +
          (isRichNote(post.note)
            ? renderRichNote(post.note, post.author, { link: false, trailingIcon: external ? extIcon : '' })
            : noteParas(post.note).map((p, i, arr) =>
                `<p class="card-note">${richText(p, post.author, { link: false })}${i === arr.length - 1 && external
                  ? extIcon : ''}</p>`).join('')) +
        `</a>`
      : cardNoteHtml(post);

    // Activities carry a where-line and a when-line under the caption — a quiet
    // pin + place, then calendar + day (and time). Same voice, stacked.
    const whenHtml = post.type === 'activity' && post.eventDate
      ? `<p class="card-location">${svgIcon('cal', 'card-location-ico')}` +
          `<span>${esc(eventWhenLabel(post.eventDate, post.eventTime))}</span></p>`
      : '';
    const locationHtml = post.type === 'activity' && post.location
      ? `<p class="card-location"><a class="card-location-link" href="${esc(mapsUrl(post.location))}" ` +
          `target="_blank" rel="noopener noreferrer">${svgIcon('pin', 'card-location-ico')}` +
          `<span>${esc(post.location)}</span></a></p>`
      : '';
    // Targeted activity: a quiet lock line. The author sees the headcount they
    // picked (feed + their profile); an invited viewer just sees that it's private
    // (they can't read the full allowlist anyway — RLS hands them only their row).
    const iAmAuthor = post.author === Store.session();
    const audienceHtml = post.type === 'activity' && post.audience === 'list'
      ? `<p class="card-location card-audience">${svgIcon('lock', 'card-location-ico')}` +
          `<span>${iAmAuthor
            ? `Shared with ${audienceCountLabel(Store.audienceCount(post.id))}`
            : 'Shared privately'}</span></p>`
      : '';

    el.innerHTML =
      `<div class="card-main">` +
        head +
        titleHtml +
        noteHtml +
        pollWidgetHtml(post) +
        locationHtml +
        whenHtml +
        audienceHtml +
        tagChips(post) +
        actions +
      `</div>` +
      goingPanelHtml(post) +
      likersPanelHtml(post) +
      commentsPanelHtml(post);
    el.dataset.sig = hashStr(el.className + '|' + el.innerHTML);
    wireReadMore(el, post);
    wirePoll(el, post, opts);
    wireGoing(el, post, opts);
    wireLikes(el, post, opts);
    wireComments(el, post, opts);
    wireCardCollapse(el, post);
    return el;
  }

  // Fades a card's <img> in once its bitmap is fully decoded, and releases the
  // frame's reserved box so it takes the image's true height. `complete` covers
  // a warm cache; `error` reveals a broken image rather than leaving it invisible.
  // Reveal on a fully DECODED bitmap, not just `load`: iOS fires load before the
  // bitmap is paint-ready, so revealing on load stutters/pops. decode() resolves
  // only when it can paint in one clean frame, so the settle reads as a settle.
  // CRUCIAL: only ever call decode() AFTER the browser has chosen to load the
  // image (it's complete, or its `load` fires) — calling decode() up front forces
  // a loading=lazy image to fetch+decode right away, which defeats lazy-loading
  // and, on a long feed, forces EVERY photo's full bitmap resident at once. On
  // iPhone that memory spike kills the renderer (white screen / "a problem
  // repeatedly occurred"). Gating decode behind load keeps offscreen media lazy
  // and the working set small.
  function revealCardImage(fig, im) {
    const landed = () => {
      fig.classList.add('is-loaded');
      fig.querySelector('.photo-frame')?.classList.remove('photo-frame--reserve');
    };
    const reveal = () => im.decode ? im.decode().then(landed).catch(landed) : landed();
    if (im.complete && im.naturalWidth) reveal();
    else {
      im.addEventListener('load', reveal, { once: true });
      im.addEventListener('error', landed, { once: true });
    }
  }

  function wirePhoto(el, img) {
    const fig = el.querySelector('.photo');
    if (!fig) return;
    const im = fig.querySelector('img');
    if (im) revealCardImage(fig, im);
    const open = () => openLightbox(img.src, img.alt);
    fig.addEventListener('click', open);
    fig.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
  }

  /* ── Frame video (feed playback) ─────────────────────────────────────────
     Poster-first, egress-cheap: the card shows only a small poster JPEG until
     it scrolls into view, then a muted <video> is inserted over it and detached
     again on the way out — no clip stays resident (bytes or decoder) offscreen.
     iOS caps concurrent video decoders, so at most one clip plays (and at most
     one carries sound) across the whole feed at a time; see activeFrameVideo /
     soundedFrameVideo below. */
  let activeFrameVideo = null;    // the one <video> currently allowed to play
  let soundedFrameVideo = null;   // the one <video> currently unmuted
  const frameCallbacks = new WeakMap();   // .photo-frame el → { attach, detach }
  // Removing an observed element from the document still fires one last
  // (non-intersecting) entry for it — that's what lets us unobserve + clean up
  // a card's video the moment the feed diff throws the card away, with no extra
  // teardown hook required from the render loop.
  const frameObserver = ('IntersectionObserver' in window)
    ? new IntersectionObserver(entries => {
        entries.forEach(entry => {
          const target = entry.target;
          const cb = frameCallbacks.get(target);
          if (!cb) return;
          if (!target.isConnected) {
            frameObserver.unobserve(target);
            frameCallbacks.delete(target);
            cb.detach();
            return;
          }
          if (entry.isIntersecting) cb.attach(); else cb.detach();
        });
      }, { threshold: 0.6 })
    : null;

  // Loop a <video> inside a stored trim window [start,end] instead of playing the
  // whole file. We upload originals now, so a trimmed post carries its window in the
  // URL (clipWindowFromUrl); the feed clip and the lightbox both honor it here. No
  // window (a whole ≤10s clip) → no-op, the element plays/loops the entire file.
  function wireClipWindow(video, win) {
    if (!win) return;
    video.loop = false;   // native loop restarts at 0 — we own the loop inside the window
    const toStart = () => { try { video.currentTime = win.start; } catch {} };
    video.addEventListener('loadedmetadata', () => {
      if (video.currentTime < win.start - 0.1 || video.currentTime >= win.end) toStart();
    }, { once: true });
    video.addEventListener('timeupdate', () => {
      if (video.currentTime >= win.end - 0.03) toStart();
    });
    // If the real clip ends before the window's end (an unmeasured-length blob, or a
    // window that overshoots the file), loop the window instead of freezing on the
    // last frame.
    video.addEventListener('ended', () => { toStart(); video.play().catch(() => {}); });
  }

  function wireFrameVideo(el, post) {
    const fig = el.querySelector('.photo');
    if (!fig) return;
    const frame = fig.querySelector('.photo-frame');
    const posterImg = frame.querySelector('img');
    const soundBtn = fig.querySelector('.frame-sound');
    const progressFill = fig.querySelector('.frame-progress-fill');
    const alt = post.note || 'Frame';
    const win = clipWindowFromUrl(post.image);   // a trimmed clip loops just this [start,end]
    if (posterImg) revealCardImage(fig, posterImg);
    else fig.classList.add('is-loaded');   // no stored poster: nothing to fade — the clip paints its own first frame

    let clip = null;   // the lazily-inserted <video>, only alive while the card is in view

    function detach() {
      if (!clip) return;
      if (activeFrameVideo === clip) activeFrameVideo = null;
      if (soundedFrameVideo === clip) soundedFrameVideo = null;
      clip.pause();
      // Drop the source (not just pause) so the decoder + buffered bytes are
      // actually freed once the card scrolls away — this is the egress lever.
      clip.removeAttribute('src'); clip.load();
      clip.remove();
      clip = null;
      fig.classList.remove('frame-video--playing');
      if (soundBtn) {
        soundBtn.setAttribute('aria-pressed', 'false');
        soundBtn.innerHTML = svgIcon('mute', 'frame-sound-ico');
      }
    }

    function attach(opts) {
      const withSound = !!(opts && opts.withSound);
      // Reduced motion: stay on the poster/tint box, no ambient autoplay — the
      // clip only plays on an explicit tap. A sound tap IS that explicit tap
      // (withSound), so it overrides the ambient-motion gate and plays anyway.
      if (clip || (prefersReduced() && !withSound)) return;
      clip = document.createElement('video');
      clip.className = 'frame-clip';
      clip.muted = !withSound; clip.playsInline = true; clip.loop = !win; clip.preload = 'metadata';
      // Ground-truth aspect ratio: once the decoder reports the clip's real
      // dimensions, size the frame box to match so object-fit:cover never crops.
      // The stamped `-WxH` dims usually get this right already, but a Frame with
      // no stored poster AND no stamped size otherwise falls back to the 3:2
      // reserve box — which would crop the video. Reading videoWidth/Height off
      // the live element is definitionally correct: the box matches exactly what
      // this element will paint, so the clip keeps its aspect on any device.
      clip.addEventListener('loadedmetadata', () => {
        if (clip && clip.videoWidth && clip.videoHeight) {
          frame.style.aspectRatio = clip.videoWidth + '/' + clip.videoHeight;
          frame.classList.remove('photo-frame--reserve');
        }
      }, { once: true });
      // The #t= media fragment makes the clip self-paint its first frame on iOS even
      // before playback starts — the universal poster fallback for a Frame with no
      // stored `poster` still. For a trimmed clip that frame is the window's start;
      // wireClipWindow then keeps playback looping inside [start,end].
      clip.src = post.image + '#t=' + (win ? Math.max(win.start, 0.001) : 0.001);
      wireClipWindow(clip, win);
      clip.addEventListener('timeupdate', () => {
        if (!progressFill) return;
        const frac = win
          ? (clip.currentTime - win.start) / Math.max(0.1, win.end - win.start)
          : (clip.duration ? clip.currentTime / clip.duration : 0);
        progressFill.style.width = (Math.max(0, Math.min(1, frac)) * 100) + '%';
      });
      frame.appendChild(clip);
      // iOS Low Power Mode (and some embedded contexts) refuse even muted
      // autoplay — never assume play() resolves; on rejection just detach and
      // leave the poster + play badge up, same fallback as reduced-motion.
      const played = clip.play();
      Promise.resolve(played).then(() => {
        if (activeFrameVideo && activeFrameVideo !== clip) activeFrameVideo.pause();
        activeFrameVideo = clip;
        fig.classList.add('frame-video--playing');
        if (withSound && soundBtn) {
          // Only one frame carries sound at a time — hush any other unmuted clip.
          if (soundedFrameVideo && soundedFrameVideo !== clip) soundedFrameVideo.muted = true;
          soundedFrameVideo = clip;
          soundBtn.setAttribute('aria-pressed', 'true');
          soundBtn.innerHTML = svgIcon('sound', 'frame-sound-ico');
        }
      }).catch(() => {
        // Playback refused even on a tap: fall back to the lightbox so a sound
        // tap is never a dead end.
        detach();
        if (withSound) openLightbox(post.image, alt, true);
      });
    }

    if (frameObserver) {
      frameCallbacks.set(frame, { attach, detach });
      frameObserver.observe(frame);
    }

    soundBtn?.addEventListener('click', e => {
      e.stopPropagation();
      // Nothing playing inline yet (declined autoplay / reduced motion): this tap
      // is a user gesture, so start the clip right here WITH sound — the speaker
      // controls audio on the post itself, no tap-through to the lightbox needed.
      if (!clip) { attach({ withSound: true }); return; }
      if (soundedFrameVideo && soundedFrameVideo !== clip) soundedFrameVideo.muted = true;
      clip.muted = !clip.muted;
      soundedFrameVideo = clip.muted ? null : clip;
      soundBtn.setAttribute('aria-pressed', String(!clip.muted));
      soundBtn.innerHTML = svgIcon(clip.muted ? 'mute' : 'sound', 'frame-sound-ico');
    });

    const open = () => openLightbox(post.image, alt, true);
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
     Commenting is friends-only (see canSocial) — the thread is omitted on posts
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
    const list = Store.likesFor(post.id).filter(l => !Blocks.has(l.user));
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
    el.querySelector('.card-attendees')?.setAttribute('aria-expanded', 'false');
    el.querySelector('.going-panel')?.classList.remove('open');
  }

  // Double-tap the card (same whole-card hitbox as an Updates spotlight) to fold
  // away an open dropdown — the comment thread, who liked, or who's going. Skips
  // taps on links/buttons/fields so their own gestures still fire. Pairs with the
  // note collapse in wireReadMore, which listens on the same card element.
  function wireCardCollapse(el, post) {
    onDoubleTap(el, (e) => {
      if (e.target.closest('a, button, input, textarea')) return;
      const open = el.querySelector('.comments-panel.open, .likers-panel.open, .going-panel.open');
      if (!open) return;
      collapseComments(el, post.id);
      collapseLikers(el, post.id);
      collapseGoing(el, post.id);
      scrollCardIntoView(el);
    });
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

  // Build the post's .ics and hand it to the browser as a download — fired from
  // the ••• menu's "Add to calendar" (see openPostMenu).
  function downloadIcs(post) {
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
  }

  // Casting (or changing) a vote. Tapping your current pick is a no-op; any other
  // choice writes through Store.votePoll, then swaps just the poll widget in place
  // (no card reflow) for a fresh copy rendered in the "just voted" flourish state:
  // the bars grow from zero and your pick washes once with the Tria gradient
  // before it settles to the flat result (see the .poll--just-voted CSS).
  function wirePoll(el, post, opts) {
    const widget = el.querySelector('.poll');
    if (!widget) return;
    const buttons = widget.querySelectorAll('.poll-option[data-choice]');
    buttons.forEach(btn => {
      btn.addEventListener('click', async () => {
        const choice = Number(btn.dataset.choice);
        if (Store.myPollVote(post.id) === choice) return;   // re-tapping your pick does nothing
        buttons.forEach(b => b.disabled = true);
        const res = await Store.votePoll(post.id, choice);
        if (!res.ok) { buttons.forEach(b => b.disabled = false); return; }
        const wrap = document.createElement('div');
        wrap.innerHTML = pollWidgetHtml(post, choice);
        const fresh = wrap.firstElementChild;
        widget.replaceWith(fresh);
        wirePoll(el, post, opts);   // rewire the new widget's choice buttons
        // Let the gradient linger a beat, then drop .is-voting so the fill
        // cross-fades down to the neutral outline (color reserved for the tap).
        const votingFill = fresh.querySelector('.poll-fill.is-voting');
        if (votingFill) setTimeout(() => votingFill.classList.remove('is-voting'), 1500);
      });
    });
  }

  function wireGoing(el, post, opts) {
    // The attendee count opens the who's-going panel — pure CSS reveal, same
    // grid-rows ease as the comment thread, for host and friends alike.
    const countBtn = el.querySelector('.card-attendees');
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
    const flip = async () => {
      toggleBtn.disabled = true;
      const res = await Store.toggleGoing(post.id);
      toggleBtn.disabled = false;
      if (!res.ok) return;
      const fresh = makeCard(post, opts);
      fresh.style.animation = 'none';
      // Roll the attendee count in its new direction — up when you join, down
      // when you bow out.
      fresh.querySelector('.card-attendees-count')
        ?.classList.add(res.going ? 'count-tick-up' : 'count-tick-down');
      el.replaceWith(fresh);
    };
    toggleBtn.addEventListener('click', () => {
      // Backing out is a small commitment to undo — the host planned around the
      // headcount — so it gets the sheet (not a bare confirm). Joining stays
      // one tap. Not a danger row: it's a change of plans, not a destruction.
      if (Store.goingByMe(post.id)) {
        openSheet({
          title: 'Can’t make it?',
          items: [{ label: 'Can’t make it', icon: 'notgoing', run: flip }],
        });
        return;
      }
      flip();
    });
  }

  // Sparkle burst on LIKE. A tight cluster of y2k four-point stars — varied
  // position (x/y in px), size (s), spin (r deg) and a little stagger (d ms) so
  // they cascade rather than pop as one. Offsets stay inside a ~16px radius (the
  // heart hugs the card's bottom-right corner and the card is paint-contained),
  // and the down/right ones stay small since that's where the clip edge is; the
  // .spark keyframes fade each fully to 0 before its tip could graze the boundary.
  const SPARKS = [
    { x: -13, y: -11, s: 12, r:  18, d:  0 },
    { x:   2, y: -16, s: 10, r:   8, d: 20 },
    { x:  11, y: -12, s:  9, r: -15, d: 55 },
    { x: -15, y:   3, s:  8, r:  12, d: 35 },
    { x:  12, y:   5, s:  7, r: -18, d: 85 },
  ];
  function burstSparkles(btn) {
    // Reduced-motion: no burst at all (CSS hides it too, belt and suspenders).
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    btn.querySelector('.like-sparkles')?.remove();   // clear a rapid re-tap's layer
    const layer = document.createElement('span');
    layer.className = 'like-sparkles';
    for (const p of SPARKS) {
      const s = document.createElement('span');
      s.className = 'spark';
      s.style.cssText =
        `--x:${p.x}px;--y:${p.y}px;--s:${p.s}px;--r:${p.r}deg;animation-delay:${p.d}ms`;
      layer.appendChild(s);
    }
    btn.appendChild(layer);
    setTimeout(() => layer.remove(), 700);   // matches the .is-liking window
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
      // One-shot ink stamp on LIKE: the heart snaps, the type colour floods up
      // through it, and a little cluster of y2k sparkle stars twinkles out — all
      // transform/clip/mask, so it stays smooth on iOS. Re-add after a reflow so
      // rapid re-taps replay it; a timer clears the class once it settles. The
      // window (700ms) outlasts the longest .is-liking animation (~0.42s) with
      // margin — the ink overlay holds its final frame until then, when the
      // resting .liked fill takes over. Sparkles fire on LIKE only (see below).
      clearTimeout(btn._pop);
      btn.classList.remove('is-liking', 'is-unliking');
      void btn.offsetWidth;
      btn.classList.add(res.liked ? 'is-liking' : 'is-unliking');
      if (res.liked) burstSparkles(btn);
      btn._pop = setTimeout(() => btn.classList.remove('is-liking', 'is-unliking'), 700);
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
            richText(c.text, c.author) +
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
    if (!canSocial(post)) return '';   // friends-only: no thread on a non-friend's post
    // Blocked authors' comments never render, on any post (closes the block gap
    // for threads on mutual friends' posts). The count above filters to match.
    const list = Store.commentsFor(post.id).filter(c => !Blocks.has(c.author));
    const open = openComments.has(post.id);
    // .comments-inner is the collapsing grid child — it holds NO padding/border
    // (that would keep it from reaching 0 height); all spacing + the left rule
    // live on .comments-content inside it.
    return `<div class="comments-panel${open ? ' open' : ''}">` +
        `<div class="comments-inner">` +
          `<div class="comments-content">` +
            (list.length ? `<ul class="comments-list">${list.map(commentItemHtml).join('')}</ul>` : '') +
            `<form class="comment-form">` +
              `<textarea name="text" rows="1" maxlength="300" placeholder="Add a comment…"></textarea>` +
              `<button type="submit" disabled>Post</button>` +
            `</form>` +
          `</div>` +
        `</div>` +
      `</div>`;
  }

  function wireComments(el, post, opts) {
    const toggle = el.querySelector('.card-comment');
    const panel = el.querySelector('.comments-panel');
    if (!toggle || !panel) return;
    const input = panel.querySelector('.comment-form textarea');
    const submitBtn = panel.querySelector('.comment-form button[type="submit"]');
    wireMentions(input);

    // The box starts at one line and grows to fit its text (like the composer),
    // so a long comment wraps into view instead of scrolling off one line.
    const autoGrow = () => { input.style.height = 'auto'; input.style.height = input.scrollHeight + 'px'; };

    // The Post button is inert until there's something to post — flip `disabled`
    // as the field fills/empties (drives the dimmed look; blocks empty submits).
    const syncSubmit = () => { submitBtn.disabled = !input.value.trim(); };
    input.addEventListener('input', () => { syncSubmit(); autoGrow(); });
    syncSubmit();

    // Enter posts (keeping the old single-line field's reflex); Shift+Enter drops
    // a deliberate line break for a multi-paragraph comment.
    // (defaultPrevented → the mentions picker already claimed this Enter to pick
    //  a friend; wireMentions runs first, so let it win.)
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.defaultPrevented) {
        e.preventDefault(); panel.querySelector('.comment-form').requestSubmit();
      }
    });

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
    // never re-animates — rather than re-rendering the whole column (which would
    // replay every card's rise), we rebuild this one card. Its ••• menu keeps
    // working through the delegated click listener, so there's nothing to re-wire.
    const apply = (dir) => {
      openComments.add(post.id);
      const fresh = makeCard(post, opts);
      fresh.style.animation = 'none';               // no rise flash on an in-place swap
      // Roll the comment count in its new direction (up on add, down on delete).
      if (dir) fresh.querySelector('.card-comment-count')
        ?.classList.add(dir === 'up' ? 'count-tick-up' : 'count-tick-down');
      el.replaceWith(fresh);
      fresh.querySelector('.comment-form textarea')?.focus();
    };

    panel.querySelector('.comment-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (submitBtn.disabled) return;               // empty, or a submit already in flight
      submitBtn.disabled = true;                    // debounce: no double-post on a fast double-tap
      const res = await Store.addComment(post.id, e.target.elements.text.value);
      if (res.ok) { apply('up'); return; }          // card rebuilt — its fresh button starts disabled
      submitBtn.disabled = false;                   // failed — let them try again
    });

    panel.querySelectorAll('.comment-delete').forEach(btn =>
      btn.addEventListener('click', () => {
        openSheet({
          title: 'Delete this comment?',
          items: [{ label: 'Delete comment', icon: 'trash', danger: true, run: async () => {
            await Store.deleteComment(btn.dataset.comment);
            apply('down');
          } }],
        });
      }));
  }

  // ── Inline edit (text only) ───────────────────────────────────────────────
  // The post whose card is currently swapped for an edit form, or null. Only one
  // at a time; reset on any navigation (see route()).
  let editingId = null;
  // A post the feed's ••• menu asked to edit, handed across the navigation to the
  // profile (which owns the edit machinery). Consumed once by renderUser.
  let pendingEditId = null;

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

    // Combined title + note box, mirroring the composer's field--combo so create
    // and edit read the same. The title rides as the lead, the note beneath it.
    const combo = (titlePh, titleAria, notePh, noteAria, rows) =>
      `<div class="field field--combo">` +
        `<input id="e-title" class="combo-title" type="text" maxlength="120" ` +
          `value="${esc(post.title || '')}" placeholder="${titlePh}" aria-label="${titleAria}">` +
        `<div class="combo-divider" aria-hidden="true"></div>` +
        `<textarea id="e-note" class="combo-note" rows="${rows}" maxlength="180" ` +
          `placeholder="${notePh}" aria-label="${noteAria}">${esc(post.note || '')}</textarea>` +
      `</div>`;

    if (post.type === 'find') {
      // A Find shares the Note editor (headline + rich body), same as the composer,
      // then carries the link field. Keeps create and edit identical, so a formatted
      // Find edits as rich text instead of raw markup in a flat 180-char box.
      return richNoteField('e', post.title, editorPrefill(post.note), 'What made you want to share it? (optional)') +
        `<div class="field">` +
          `<label for="e-url">Link</label>` +
          `<input id="e-url" type="url" inputmode="url" autocapitalize="none" ` +
            `spellcheck="false" value="${esc(post.url || '')}" placeholder="https://…">` +
        `</div>` + tagsInput;
    }

    if (post.type === 'activity') {
      return combo('Picnic at the park', 'What’s the plan?', 'When to show up, what to bring.', 'Details', 2) +
        `<div class="field">` +
          `<label for="e-location">Where</label>` +
          `<input id="e-location" type="text" maxlength="120" ` +
            `value="${esc(post.location || '')}" placeholder="Liberty Park, by the pond">` +
        `</div>` +
        `<div class="field">` +
          `<label for="e-date">When</label>` +
          `<div class="when-row">` +
            `<input id="e-date" type="date" placeholder="mm/dd/yyyy" value="${esc(post.eventDate || '')}">` +
            `<input id="e-time" type="time" aria-label="Time" placeholder="--:-- --" value="${esc(post.eventTime || '')}">` +
          `</div>` +
          `<p class="field-hint">Optional · dated plans sort by their day.</p>` +
        `</div>` + tagsInput;
    }

    // post (Note) and photo (Frame) share the rich editor — a Frame is a full post
    // that also carries media, so it gets the same headline + rich caption (both
    // optional; the image carries the post). Prefilled from the stored note (a
    // legacy plain-text note upgrades to paragraphs; see editorPrefill).
    const notePh = post.type === 'photo' ? 'Say something about it (optional).' : 'Say it plainly.';
    return richNoteField('e', post.title, editorPrefill(post.note), notePh) + tagsInput;
  }

  function makeEditCard(post) {
    const el = document.createElement('article');
    el.className = `card card--${post.type} card--editing`;
    el.dataset.id = post.id;      // lets the spotlight scroll target the open editor
    el.innerHTML =
      `<form class="edit-form" novalidate>` +
        editFieldsFor(post) +
        `<p class="composer-error" id="e-error" role="alert"></p>` +
        `<div class="edit-actions">` +
          // One button that reads "Cancel" until a field changes, then becomes the
          // accent "Save changes" — see the dirty-tracking wiring in renderUser.
          // Delete lives in the post's ••• menu now, not here.
          `<button type="button" class="edit-toggle">Cancel</button>` +
        `</div>` +
      `</form>`;
    wireWhenHints(el);
    wireLocationSuggest(el.querySelector('#e-location'));
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

  // Photon ranks matches globally unless given a point to lean toward, so the
  // first focus on a Where field asks for the device location (one browser
  // prompt, in context). Declining just means unbiased suggestions.
  let locBias = null;      // {lat, lon} | 'denied' | null (not asked yet)
  function askLocBias() {
    if (locBias || !navigator.geolocation) return;
    locBias = 'denied';    // only ask once, even if the answer never comes
    navigator.geolocation.getCurrentPosition(
      (pos) => { locBias = { lat: pos.coords.latitude, lon: pos.coords.longitude }; },
      () => {}, { timeout: 5000, maximumAge: 600000 });
  }

  // Place autocomplete on the Where field, mirroring the mention picker: a
  // quiet listbox under the input, arrows/enter/escape, mousedown-pick so the
  // field keeps focus. Suggestions come from Photon (OpenStreetMap search,
  // free, no key); picking one fills the field with "Name, City" so the
  // card's maps link resolves to the real place. Free text still stands —
  // ignoring the list and typing "Freds house, iykyk" is fine.
  function wireLocationSuggest(field) {
    if (!field) return;
    const listId = `locs-${++mentionSeq}`;
    const list = document.createElement('ul');
    list.className = 'mention-list loc-list';
    list.id = listId;
    list.setAttribute('role', 'listbox');
    list.hidden = true;
    field.insertAdjacentElement('afterend', list);
    field.setAttribute('aria-autocomplete', 'list');
    field.setAttribute('aria-expanded', 'false');
    field.setAttribute('autocomplete', 'off');

    let items = [];      // suggestion strings: [primary, detail]
    let active = -1;
    let timer = null;
    let ctrl = null;     // in-flight fetch, aborted by the next keystroke
    let picked = false;  // suppress re-search on the input event a pick fires

    const close = () => {
      list.hidden = true;
      items = []; active = -1;
      field.setAttribute('aria-expanded', 'false');
      field.removeAttribute('aria-activedescendant');
    };

    const highlight = (i) => {
      active = i;
      list.querySelectorAll('[role="option"]').forEach((li, j) => {
        li.setAttribute('aria-selected', String(j === i));
        li.classList.toggle('active', j === i);
      });
      if (items[i]) field.setAttribute('aria-activedescendant', `${listId}-${i}`);
    };

    // Picking fills just "Name, City" — the card shows that, and the maps
    // search resolves it to the real place without a full street address
    // cluttering the feed.
    const pick = (i) => {
      const it = items[i];
      if (!it) return;
      picked = true;
      field.value = [it.primary, it.city].filter(Boolean).join(', ').slice(0, 120);
      close();
      field.focus();
    };

    // One Photon feature → a primary line (name or street address), the city,
    // and a detail line (the fuller address, shown in the list to tell twins
    // apart), deduped across results.
    const toItem = (f) => {
      const p = f.properties || {};
      const street = [p.street || (p.osm_key === 'highway' ? p.name : ''), p.housenumber]
        .filter(Boolean).join(' ');
      const primary = p.name && p.osm_key !== 'highway' ? p.name : street;
      const city = p.city || p.district || p.state || '';
      const detail = [primary === street ? '' : street, p.city || p.district,
        p.state, p.country === 'United States' ? '' : p.country]
        .filter(Boolean).join(', ');
      return primary ? { primary, city, detail } : null;
    };

    const search = async (q) => {
      ctrl?.abort();
      ctrl = new AbortController();
      let feats;
      try {
        const bias = locBias && locBias !== 'denied'
          ? `&lat=${locBias.lat}&lon=${locBias.lon}` : '';
        const res = await fetch(
          `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=5&lang=en${bias}`,
          { signal: ctrl.signal });
        feats = (await res.json()).features || [];
      } catch { return; }   // aborted or offline — the field is still free text
      const seen = new Set();
      items = feats.map(toItem).filter(it => {
        if (!it) return false;
        const key = it.primary + '|' + it.detail;
        return seen.has(key) ? false : seen.add(key);
      });
      if (!items.length || document.activeElement !== field) { close(); return; }
      list.innerHTML = items.map((it, i) =>
        `<li role="option" id="${listId}-${i}" aria-selected="false">` +
          `<span class="loc-opt-name">${esc(it.primary)}</span>` +
          (it.detail ? `<span class="loc-opt-detail">${esc(it.detail)}</span>` : '') +
        `</li>`).join('');
      list.hidden = false;
      field.setAttribute('aria-expanded', 'true');
      field.setAttribute('aria-controls', listId);
      list.querySelectorAll('[role="option"]').forEach((li, i) => {
        li.addEventListener('mousedown', (e) => { e.preventDefault(); pick(i); });
      });
      highlight(-1);   // typing stays primary; arrows opt into the list
    };

    field.addEventListener('input', () => {
      if (picked) { picked = false; return; }
      clearTimeout(timer);
      const q = field.value.trim();
      if (q.length < 3) { ctrl?.abort(); close(); return; }
      timer = setTimeout(() => search(q), 300);
    });
    field.addEventListener('focus', askLocBias);
    field.addEventListener('blur', () => setTimeout(close, 100));
    field.addEventListener('keydown', (e) => {
      if (list.hidden) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); highlight((active + 1) % items.length); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); highlight((active - 1 + items.length) % items.length); }
      else if (e.key === 'Enter' || e.key === 'Tab') {
        if (active >= 0) { e.preventDefault(); pick(active); } else close();
      }
      else if (e.key === 'Escape') { e.stopPropagation(); close(); }
    });
  }

  /* ── Masthead ──────────────────────────────────────────────────────────────
     The editorial nameplate that crowns each page: a small uppercase kicker
     (the issue date, or a section eyebrow) over a big Instrument Serif title,
     above a full-width hairline. Callers pass already-safe strings. */
  // `actions` (optional) is markup that rides the title's own line, at the right —
  // e.g. the Friends page's expanding search. The title row is a relative flex
  // container so an action can animate open over the nameplate.
  function mastheadEl(kicker, title, actions) {
    // No title: the kicker carries the page (promoted to <h1> for a11y, same
    // small-caps look) instead of stacking a redundant big serif line under it.
    const kickerTag = title ? 'p' : 'h1';
    return `<header class="masthead">` +
        (kicker ? `<${kickerTag} class="masthead-kicker">${kicker}</${kickerTag}>` : '') +
        `<div class="masthead-row">` +
          (title ? `<h1 class="masthead-title">${title}</h1>` : '') +
          (actions || '') +
        `</div>` +
      `</header>`;
  }

  /* ── Segmented tab control (.seg-tabs) — the reusable iOS view switcher shared
     by Friends (My circle / Find friends) and Updates (All / Mentions). Two
     equal segments over a sliding thumb; markup here, behaviour in wireSegTabs.
     `id` namespaces the tab + panel ids, `tabs` = [{key,label}], `sel` = the
     selected key, `panelId` is the tabpanel it drives. `glow: true` lights the
     brand gradient under the thumb at index 0 (Friends' My circle identity);
     neutral switches leave it off. The thumb slides via data-sel (the selected
     index), so the control stays generic regardless of the tab keys. */
  function segTabsEl(id, tabs, sel, { glow = false, label = 'Show', panelId = '' } = {}) {
    const selIndex = Math.max(0, tabs.findIndex(t => t.key === sel));
    return `<div class="seg-tabs" role="tablist" aria-label="${label}" id="${id}-tabs" data-sel="${selIndex}">` +
        `<span class="seg-tabs-thumb" aria-hidden="true">${glow ? '<span class="seg-tabs-glow"></span>' : ''}</span>` +
        tabs.map(t => {
          const on = t.key === sel;
          return `<button class="seg-tab" role="tab" id="${id}-tab-${t.key}" type="button" data-tab="${t.key}" ` +
            `aria-controls="${panelId}" aria-selected="${on}" tabindex="${on ? 0 : -1}">${t.label}</button>`;
        }).join('') +
      `</div>`;
  }
  // Wire a seg-tabs control: click and Arrow Left/Right select (WAI-ARIA tab
  // pattern, wrapping, focus follows). This drives the control's own visuals —
  // the thumb slide (data-sel), aria-selected, and roving tabindex — then calls
  // onSelect(key) so the caller swaps its panel. getSel reads the live selection.
  function wireSegTabs(tablist, tabs, getSel, onSelect) {
    const select = (key) => {
      if (getSel() === key) return;
      tablist.dataset.sel = Math.max(0, tabs.findIndex(t => t.key === key));
      tablist.querySelectorAll('.seg-tab').forEach(b => {
        const on = b.dataset.tab === key;
        b.setAttribute('aria-selected', String(on));
        b.tabIndex = on ? 0 : -1;
      });
      onSelect(key);
    };
    tablist.querySelectorAll('.seg-tab').forEach(btn =>
      btn.addEventListener('click', () => select(btn.dataset.tab)));
    tablist.addEventListener('keydown', (e) => {
      const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!dir) return;
      e.preventDefault();
      const i = tabs.findIndex(t => t.key === getSel());
      const next = tabs[(i + dir + tabs.length) % tabs.length];
      select(next.key);
      tablist.querySelector(`.seg-tab[data-tab="${next.key}"]`)?.focus();
    });
  }

  /* ── Home view ───────────────────────────────────────────────────────────── */
  const FILTERS = [
    { key: 'all',      label: 'All' },
    { key: 'note',     label: 'Notes' },
    { key: 'find',     label: 'Finds' },
    { key: 'photo',    label: 'Frames' },
    { key: 'poll',     label: 'Polls' },
    { key: 'activity', label: 'Activities' },
  ];
  let activeFilter = 'all';
  let activeTag = null;

  // The masthead's filter control: the sliders glyph plus a hue dot that lights
  // (in the active type's colour) only when a filter is on, so a folded menu
  // still tells you the feed is narrowed. Tapping it fans the filter dial open.
  function filterBtnEl() {
    const on = activeFilter !== 'all';
    return `<button class="masthead-filter" type="button" id="home-filter-btn" ` +
        `aria-haspopup="menu" aria-expanded="false" aria-label="Filter the feed"` +
        `${on ? ` data-active="${activeFilter}"` : ''}>` +
        svgIcon('sliders', 'masthead-filter-ico') +
        `<span class="masthead-filter-dot" aria-hidden="true"${on ? '' : ' hidden'}></span>` +
      `</button>`;
  }
  // Reflect the current filter onto the masthead button without a full re-render
  // (so picking one doesn't flash the whole page): light/clear the dot + hue.
  function syncFilterBtn() {
    const btn = view.querySelector('#home-filter-btn');
    if (!btn) return;
    const on = activeFilter !== 'all';
    if (on) btn.setAttribute('data-active', activeFilter);
    else btn.removeAttribute('data-active');
    const dot = btn.querySelector('.masthead-filter-dot');
    if (dot) dot.hidden = !on;
  }

  function renderHome() {
    view.innerHTML =
      `<section class="view">` +
        mastheadEl('', 'My Circle', filterBtnEl()) +
        `<div class="feed" id="feed"></div>` +
      `</section>`;

    view.querySelector('#home-filter-btn')
      ?.addEventListener('click', (e) => openFilterDial(e.currentTarget));

    renderFeed();
  }

  /* ── Filter dial ──────────────────────────────────────────────────────────────
     The feed's type filter, fanned from the masthead sliders button as a floating
     glass menu — the same speed-dial idiom as the + FAB (labelled rows, each with
     its type colour glowing behind the glyph), just dropping DOWN from the top
     control instead of rising from the nav. Data-driven off FILTERS, so a new post
     type is one array entry, not a layout change. Glass per the material rule (a
     menu floats above content); reduced-motion aware; WAI-ARIA menu semantics. */
  let filterDialOpen = false;
  function openFilterDial(anchor) {
    if (filterDialOpen) return;
    filterDialOpen = true;
    anchor.setAttribute('aria-expanded', 'true');

    const scrim = document.createElement('div');
    scrim.className = 'filter-dial-scrim';
    const rows = FILTERS.map((f, i) => {
      const on = f.key === activeFilter;
      const glyph = f.key === 'all' ? ICON_ALL : (TYPE_ICON[f.key] || '');
      // --glow = the pastel that blooms behind the glyph; the glyph itself takes
      // the type's deep -ink via `color` (fill:currentColor). All's pentad paints
      // its own five hues directly (no currentColor), so it skips the glow wash
      // entirely — the grey radial bloom read muddy on a white ground, and the
      // dots already carry plenty of colour on their own. Set inline rather than
      // via .type-icon--x, whose own sizing rules would fight the 46px disc.
      const glow = f.key === 'all' ? 'transparent' : `var(--type-${f.key})`;
      const ink  = f.key === 'all' ? 'var(--muted)' : `var(--type-${f.key}-ink)`;
      return `<button class="filter-dial-item${on ? ' is-on' : ''}" type="button" ` +
          `role="menuitemradio" aria-checked="${on}" data-filter="${f.key}" style="--i:${i}">` +
          `<span class="filter-dial-label">${f.label}</span>` +
          `<span class="filter-dial-ico" style="--glow:${glow}; color:${ink}">${glyph}</span>` +
        `</button>`;
    }).join('');
    scrim.innerHTML = `<div class="filter-dial" role="menu" aria-label="Filter the feed">${rows}</div>`;
    document.body.appendChild(scrim);
    document.body.style.overflow = 'hidden';

    // Pin the dial's right edge under the button so the icon chips stack straight
    // down from it (label floating to the left — the speed-dial reading, mirrored).
    const dial = scrim.querySelector('.filter-dial');
    const r = anchor.getBoundingClientRect();
    dial.style.top = (r.bottom + 10) + 'px';
    dial.style.right = Math.max(8, window.innerWidth - r.right) + 'px';

    const opener = anchor;
    const items = () => [...scrim.querySelectorAll('.filter-dial-item')];
    requestAnimationFrame(() => {
      scrim.classList.add('open');
      (items().find(b => b.classList.contains('is-on')) || items()[0])?.focus();
    });

    const close = (then) => {
      if (!filterDialOpen) return;
      filterDialOpen = false;
      document.removeEventListener('keydown', onKey);
      scrim.classList.remove('open');
      document.body.style.overflow = '';
      anchor.setAttribute('aria-expanded', 'false');
      if (opener && opener.focus) opener.focus();
      const done = () => { scrim.remove(); if (then) then(); };
      if (prefersReduced()) done(); else setTimeout(done, 220);
    };
    function onKey(e) {
      if (e.key === 'Escape') { close(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const f = items();
        const cur = f.indexOf(document.activeElement);
        const dir = e.key === 'ArrowDown' ? 1 : -1;
        f[(cur + dir + f.length) % f.length]?.focus();
        return;
      }
      if (e.key !== 'Tab') return;
      const f = items();
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }

    scrim.addEventListener('click', (e) => { if (e.target === scrim) close(); });
    items().forEach(btn => btn.addEventListener('click', () => {
      const key = btn.dataset.filter;
      close(() => {
        activeFilter = key;
        activeTag = null;
        syncFilterBtn();
        renderFeed();
      });
    }));
    document.addEventListener('keydown', onKey);
  }

  function renderFeed() {
    const feedEl = view.querySelector('#feed');
    if (!feedEl) return;
    const list = Store.feed().filter(p => {
      if (Blocks.has(p.author)) return false;   // blocked authors never surface
      const typeOk = activeFilter === 'all' || p.type === activeFilter;
      const tagOk = !activeTag || (p.tags || []).includes(activeTag);
      return typeOk && tagOk;
    });

    // The Activities tab answers "what's coming up", so it sorts by EVENT date,
    // not post date: upcoming plans first (soonest on top), then undated ones
    // (newest posted), then the past (most recent happening first). Everywhere
    // else — All, profiles — activities keep their place in the timeline.
    if (activeFilter === 'activity') {
      const rank = (p) => !p.eventDate ? 1 : isPastActivity(p) ? 2 : 0;
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

    if (!list.length) {
      feedEl.innerHTML = '';
      justPostedId = null;   // nothing to sparkle if a filter emptied the feed
      // A brand-new account has no friends yet, so its Circle is genuinely empty —
      // point them at Discover rather than leaving a blank "nothing here".
      const noFilter = activeFilter === 'all' && !activeTag;
      if (noFilter && Store.friends().length === 0) {
        feedEl.innerHTML = `<div class="feed-empty feed-empty--welcome">` +
          `<p>Your circle is empty, for now.</p>` +
          `<a class="feed-empty-cta" href="#/friends">Find people to add →</a>` +
        `</div>`;
      } else {
        feedEl.innerHTML = `<p class="feed-empty">Nothing here yet.` +
          (activeTag ? ` <button class="tag" type="button" data-clear="1">clear ${esc(activeTag)}</button>` : '') +
          `</p>`;
        feedEl.querySelectorAll('[data-clear]').forEach(btn =>
          btn.addEventListener('click', () => { activeTag = null; renderFeed(); }));
      }
      return;
    }

    // Reconcile the feed against what's already on screen rather than wiping it.
    // A nav-tap refresh re-pulls the whole world, but most taps change nothing
    // in view (or just a like/comment on one post). Rebuilding every card from
    // scratch would replay each photo's fade-in — the "already seen it, why did
    // it reload" jitter. So: keep unchanged cards (and their loaded images) in
    // place, rise in only genuinely new posts, drop posts that left the feed,
    // and re-render in place only the cards whose content truly changed.
    const desired = new Set(list.map(p => String(p.id)));
    feedEl.querySelectorAll(':scope > .card').forEach(c => {
      if (!desired.has(c.dataset.id)) c.remove();          // gone from the feed
    });
    feedEl.querySelectorAll(':scope > :not(.card)').forEach(n => n.remove()); // stale empty-state
    const existing = new Map();
    feedEl.querySelectorAll(':scope > .card').forEach(c => existing.set(c.dataset.id, c));

    list.forEach((p, i) => {
      const id = String(p.id);
      const old = existing.get(id);
      let node;
      if (old) {
        const fresh = makeCard(p);
        if (fresh.dataset.sig === old.dataset.sig) {
          node = old;                          // unchanged — leave the live node alone
        } else {
          // Content changed (a new like/comment, an edit). Swap in the new render,
          // but carry over an already-loaded photo when the image itself is the
          // same, and don't re-run the rise — it's an update, not an arrival.
          const oldImg = old.querySelector('.photo img');
          const newFig = fresh.querySelector('.photo');
          if (oldImg && newFig && oldImg.src === newFig.querySelector('img')?.src) {
            newFig.replaceWith(oldImg.closest('.photo'));
          }
          fresh.style.animation = 'none';
          wireFeedCard(fresh);
          old.replaceWith(fresh);
          node = fresh;
        }
      } else {
        node = makeCard(p);                    // brand-new post — rise it in
        node.style.animationDelay = staggerDelay(i);
        wireFeedCard(node);
      }
      const ref = feedEl.children[i] || null;  // slot it into the right position
      if (node !== ref) feedEl.insertBefore(node, ref);
    });

    // Keep the active-tag highlight current on every chip (reused cards included).
    feedEl.querySelectorAll('.tag[data-tag]').forEach(btn =>
      btn.classList.toggle('active', btn.dataset.tag === activeTag));

    // Posted! The post you just made lands at the top of the feed — welcome it
    // with a sparkle. Consume the flag on this one pass (if a filter hid the new
    // post, the card won't be here and the moment is simply skipped).
    if (justPostedId != null) {
      const fresh = [...feedEl.querySelectorAll(':scope > .card')]
        .find(c => c.dataset.id === justPostedId);
      justPostedId = null;
      if (fresh) celebratePost(fresh);
    }
  }

  // Sparkle a freshly published post into the feed, reusing the like-tap's y2k
  // stars. Positions are percentages across the card's top region; sizes (s),
  // spins (r) and a stagger (d ms) vary so the stars cascade and float up rather
  // than pop as one. Kept to the card's upper band (byline + first lines) so a
  // photo post's image stays clean.
  const POST_SPARKS = [
    { x: 12, y: 22, s: 14, r:  16, d:   0 },
    { x: 48, y: 16, s: 16, r:  10, d:  40 },
    { x: 84, y: 24, s: 13, r:  14, d:  80 },
    { x: 30, y: 60, s:  9, r: -12, d: 120 },
    { x: 90, y: 62, s: 11, r: -14, d: 150 },
    { x: 66, y: 52, s: 10, r: -16, d: 180 },
    { x: 20, y: 82, s:  8, r: -10, d: 220 },
    { x: 58, y: 80, s:  9, r:  18, d: 260 },
    { x: 38, y: 40, s:  7, r:  12, d: 300 },
  ];
  function celebratePost(cardEl) {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    // Let the card finish its rise (~0.5s, front-loaded ease) before we anchor to
    // it, so the fixed overlay lands on the card's resting box, not a moving one.
    setTimeout(() => {
      const r = cardEl.getBoundingClientRect();
      if (!r.width) return;
      const layer = document.createElement('div');
      layer.className = 'post-sparkles';
      layer.dataset.type = cardEl.dataset.type;
      layer.style.left = r.left + 'px';
      layer.style.top = r.top + 'px';
      layer.style.width = r.width + 'px';
      layer.style.height = Math.min(r.height, 190) + 'px';   // top band only on tall cards
      for (const p of POST_SPARKS) {
        const s = document.createElement('span');
        s.className = 'spark';
        s.style.cssText =
          `left:${p.x}%;top:${p.y}%;--s:${p.s}px;--r:${p.r}deg;animation-delay:${p.d}ms`;
        layer.appendChild(s);
      }
      document.body.appendChild(layer);
      setTimeout(() => layer.remove(), 1400);
    }, 200);
  }

  // Tag chips inside a feed card filter the feed by that tag; wired once, on the
  // cards we actually create (reused cards keep the listeners they came with).
  function wireFeedCard(card) {
    card.querySelectorAll('.tag[data-tag]').forEach(btn =>
      btn.addEventListener('click', () => {
        activeTag = activeTag === btn.dataset.tag ? null : btn.dataset.tag;
        renderFeed();
      }));
  }

  /* ── Auth gate (setup / login) ──────────────────────────────────────────────
     Shown whenever no one is signed in. Two modes over one form: create an
     account (display name + username + password) or log back in. On success
     we drop the gate and route home. */
  let authMode = 'signup';

  // Signed-out brand header — the front-door echo of the signed-in .topbar (same
  // wordmark), shared by the welcome tutorial and the auth (log in / create)
  // screens so they read as one app. The slogan rides in the header. The account
  // disc is pinned top-left, the mirror of the sprout's top-right perch; it opens
  // the auth form for returning users (and toggles create ⇄ log in from there).
  function authHeader() {
    return `<header class="auth-topbar">` +
        `<div class="auth-topbar-brand">` +
          `<span class="brand-mark">tria</span>` +
          `<span class="auth-topbar-tag">Social media made local</span>` +
        `</div>` +
        `<button class="auth-account" type="button" id="auth-account" aria-label="Sign in">` +
          svgIcon('profile', 'auth-account-ico') +
        `</button>` +
      `</header>`;
  }
  function wireAuthAccount() {
    const btn = document.getElementById('auth-account');
    if (!btn) return;
    btn.addEventListener('click', () => {
      authMode = 'login';   // returning-user affordance; the form offers "create one"
      // Already on the auth screen (e.g. create-account): flip to log in in place,
      // since the hash wouldn't change and the router wouldn't re-render.
      if (location.hash.replace(/\?.*$/, '') === '#/signin') renderAuth('login');
      else go('#/signin');
    });
  }

  function renderAuth(mode) {
    authMode = mode;
    const isSignup = mode === 'signup';

    // Signup leads with your identity as one combo box — display name as the serif
    // headline, @handle as the note beneath it — echoing the composer's title+note.
    const identityField = isSignup
      ? `<div class="field field--combo">` +
          `<input id="f-name" class="combo-title" type="text" autocomplete="name" ` +
            `maxlength="40" placeholder="Display name" autofocus aria-label="Display name">` +
          `<div class="combo-divider" aria-hidden="true"></div>` +
          `<div class="combo-user">` +
            `<span class="at" aria-hidden="true">@</span>` +
            `<input id="f-user" class="combo-userinput" type="text" autocomplete="username" ` +
              `autocapitalize="none" spellcheck="false" maxlength="20" ` +
              `placeholder="username" aria-label="Username">` +
          `</div>` +
        `</div>` +
        `<p class="field-hint field-hint--combo">Lowercase letters, numbers or _ for your @handle.</p>`
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
      `<section class="auth">` +
        authHeader() +
        `<div class="auth-card">` +
        `<h1 class="auth-head">${isSignup ? 'Create your account' : 'Welcome back'}</h1>` +
        `<form id="auth-form" novalidate>` +
          identityField +
          emailField +
          `<div class="field">` +
            `<label for="f-pass">Password</label>` +
            `<input id="f-pass" type="password" ` +
              `autocomplete="${isSignup ? 'new-password' : 'current-password'}" ` +
              `placeholder="••••••">` +
          `</div>` +
          // Login only: a quiet way out for a forgotten password, mirroring the
          // #auth-toggle link's plain text-button treatment.
          (isSignup
            ? ''
            : `<p class="auth-forgot"><a href="#/forgot">Forgot password?</a></p>`) +
          // App Store 1.2 + 5.1.1(i): joining is an explicit agreement to both
          // the guidelines (our zero-tolerance terms) and the privacy policy,
          // folded into one checkbox. Signup only; gated in the submit handler.
          (isSignup
            ? `<label class="auth-agree" for="f-agree">` +
                `<input id="f-agree" type="checkbox">` +
                `<span>I agree to Tria's <a href="#/about?open=guidelines" target="_blank" rel="noopener">Community Guidelines</a> and <a href="#/about?open=privacy" target="_blank" rel="noopener">Privacy Policy</a>.</span>` +
              `</label>`
            : '') +
          `<p class="auth-error" id="auth-error" role="alert"></p>` +
          `<button class="auth-submit publish-fill is-solid" type="submit">` +
            `${isSignup ? 'Create account' : 'Log in'}</button>` +
        `</form>` +
        `<p class="auth-alt">` +
          `${isSignup ? 'Already have an account?' : 'New to Tria?'} ` +
          `<button type="button" id="auth-toggle">` +
            `${isSignup ? 'Log in' : 'Create one'}</button>` +
        `</p>` +
        `<p class="auth-about"><a href="#/about">What is Tria?</a></p>` +
      `</div></section>`;

    wireAuthAccount();
    const nameInput = document.getElementById('f-name');
    const errEl = document.getElementById('auth-error');
    const submitBtn = document.querySelector('.auth-submit');
    document.getElementById('auth-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('f-email').value;
      const password = document.getElementById('f-pass').value;
      errEl.textContent = '';
      const agree = document.getElementById('f-agree');
      if (isSignup && agree && !agree.checked) {
        errEl.textContent = 'Please agree to the Community Guidelines and Privacy Policy to continue.';
        return;
      }
      submitBtn.disabled = true;
      submitBtn.textContent = isSignup ? 'Creating…' : 'Logging in…';
      const res = isSignup
        ? await Store.signup({ name: nameInput.value, username: document.getElementById('f-user').value, email, password })
        : await Store.login(email, password);
      if (!res.ok) {
        // Signup with confirm-email on: the account exists, they just need to
        // click the link. That's a success in disguise, not an error — swap to a
        // calm "check your inbox" screen rather than flashing red.
        if (res.pending) { renderCheckInbox(res.email || email); return; }
        errEl.textContent = res.error;
        // Unconfirmed email on login: valid credentials, unclicked link. Offer a
        // one-tap resend inline instead of leaving them stuck.
        if (res.needsConfirm) showResend(email, errEl);
        submitBtn.disabled = false;
        submitBtn.textContent = isSignup ? 'Create account' : 'Log in';
        return;
      }
      go('#/');
      warmImages();   // world just loaded for this account — warm its images too
    });

    // Toggle signup ⇄ login through the same soft blur-dissolve the pages use, so
    // the switch feels like part of the app rather than an instant redraw.
    document.getElementById('auth-toggle').addEventListener('click',
      () => renderPage(-1, () => renderAuth(isSignup ? 'login' : 'signup')));
  }

  /* ── Install-first welcome (signed-out browser front door) ────────────────────
     The first impression in a browser: lead with adding Tria to the home screen
     (iOS steps — Android is a near-identical two-tap, so a single column keeps
     the page focused), with account actions kept secondary below. The spine is
     "install first, THEN create your account inside the app", because a session
     made in Safari does not carry into the installed PWA (separate storage) —
     which is what was making people sign in twice. Installed visitors never see
     this: route() sends standalone launches straight to the form. Reuses the
     .auth card shell + the About page's animated .install-steps / INSTALL_ICONS. */
  function renderWelcome() {
    view.innerHTML =
      `<section class="auth welcome">` +
        // Shared brand header (wordmark + slogan + the corner account disc). The
        // page's one job is "add Tria to your home screen"; signing up is meant to
        // happen in the installed app (the double-login fix), so account stays a
        // quiet corner escape hatch for returning users.
        authHeader() +
        `<div class="auth-card">` +
        `<h1 class="auth-head welcome-head">Add Tria to your home screen</h1>` +
        `<p class="welcome-lede">Tria lives on the web, so there's nothing to ` +
          `download. <strong>Add it to your home screen</strong> and it opens ` +
          `just like any other app.</p>` +
        installToggleHtml() +
        `<ol class="install-steps welcome-steps">${installStepsHtml()}</ol>` +
        `<p class="auth-about"><a href="#/about">What is Tria?</a></p>` +
      `</div></section>`;

    wireAuthAccount();
    wireInstallToggle(view);
  }

  // Login met the confirm-email gate: drop a one-tap "resend" under the error so
  // an unconfirmed friend isn't stranded. Idempotent (won't stack on re-submit).
  function showResend(email, errEl) {
    if (document.getElementById('auth-resend')) return;
    const p = document.createElement('p');
    p.className = 'auth-resend';
    p.id = 'auth-resend';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Resend confirmation email';
    p.appendChild(btn);
    errEl.insertAdjacentElement('afterend', p);
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Sending…';
      const res = await Store.resendConfirmation(email);
      btn.textContent = res.ok ? 'Sent. Check your inbox.' : 'Could not send, try again';
      if (!res.ok) btn.disabled = false;
    });
  }

  /* ── Forgot password: request a reset link ────────────────────────────────────
     Same screen family as the auth gate (reuses .auth-*). We never reveal whether
     an address has an account — on submit we always show the same calm "sent"
     confirmation, so the form can't be used to probe who's on Tria. */
  function renderRequestReset() {
    view.innerHTML =
      `<section class="auth"><div class="auth-card">` +
        `<div class="auth-brand">tria</div>` +
        `<h1 class="auth-head">Reset your password</h1>` +
        `<p class="auth-sub">Enter your email and we'll send a link to set a new one.</p>` +
        `<form id="reset-form" novalidate>` +
          `<div class="field">` +
            `<label for="f-email">Email</label>` +
            `<input id="f-email" type="email" autocomplete="email" ` +
              `autocapitalize="none" spellcheck="false" ` +
              `placeholder="you@example.com" autofocus>` +
          `</div>` +
          `<p class="auth-error" id="auth-error" role="alert"></p>` +
          `<button class="auth-submit publish-fill is-solid" type="submit">Send reset link</button>` +
        `</form>` +
        `<p class="auth-alt"><button type="button" id="reset-back">Back to log in</button></p>` +
      `</div></section>`;
    const errEl = document.getElementById('auth-error');
    const submitBtn = document.querySelector('.auth-submit');
    document.getElementById('reset-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      errEl.textContent = '';
      const email = document.getElementById('f-email').value;
      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending…';
      const res = await Store.requestPasswordReset(email);
      if (!res.ok) {
        errEl.textContent = res.error;
        submitBtn.disabled = false;
        submitBtn.textContent = 'Send reset link';
        return;
      }
      renderResetSent(email);
    });
    document.getElementById('reset-back').addEventListener('click', () => {
      authMode = 'login';
      go('#/signin');
    });
  }

  // Calm confirmation after a reset request. Same for a real and an unknown
  // address (see renderRequestReset) so it never leaks who has an account.
  function renderResetSent(email) {
    view.innerHTML =
      `<section class="auth"><div class="auth-card">` +
        `<div class="auth-brand">tria</div>` +
        `<h1 class="auth-head">Check your inbox</h1>` +
        `<p class="auth-sub">If ${esc(email)} has an account, a reset link is on its way. ` +
          `The link opens Tria and lets you set a new password.</p>` +
        `<p class="auth-alt"><button type="button" id="reset-back">Back to log in</button></p>` +
      `</div></section>`;
    document.getElementById('reset-back').addEventListener('click', () => {
      authMode = 'login';
      go('#/signin');
    });
  }

  // Post-signup landing when confirm-email is on: the account is made, we just
  // need them to click the link. Positive, with an inline resend and a way back.
  function renderCheckInbox(email) {
    view.innerHTML =
      `<section class="auth"><div class="auth-card">` +
        `<div class="auth-brand">tria</div>` +
        `<h1 class="auth-head">Confirm your email</h1>` +
        `<p class="auth-sub">We sent a link to ${esc(email)}. Click it to confirm your ` +
          `account, then come back and log in.</p>` +
        `<p class="auth-error" id="auth-error" role="alert"></p>` +
        `<p class="auth-alt"><button type="button" id="inbox-back">Back to log in</button></p>` +
      `</div></section>`;
    showResend(email, document.getElementById('auth-error'));
    document.getElementById('inbox-back').addEventListener('click', () => {
      authMode = 'login';
      go('#/signin');
    });
  }

  /* ── Set a new password (recovery landing) ────────────────────────────────────
     Shown when Store.isRecovering() is true: the reset link opened a short-lived
     recovery session and route() holds us here (never hydrating the world) until
     a new password is picked. updatePassword then logs us in for real. */
  function renderNewPassword() {
    view.innerHTML =
      `<section class="auth"><div class="auth-card">` +
        `<div class="auth-brand">tria</div>` +
        `<h1 class="auth-head">Set a new password</h1>` +
        `<p class="auth-sub">Almost there. Pick a new password and you're back in.</p>` +
        `<form id="newpass-form" novalidate>` +
          `<div class="field">` +
            `<label for="f-pass">New password</label>` +
            `<input id="f-pass" type="password" autocomplete="new-password" ` +
              `placeholder="••••••" autofocus>` +
          `</div>` +
          `<p class="auth-error" id="auth-error" role="alert"></p>` +
          `<button class="auth-submit publish-fill is-solid" type="submit">Save password</button>` +
        `</form>` +
      `</div></section>`;
    const errEl = document.getElementById('auth-error');
    const submitBtn = document.querySelector('.auth-submit');
    document.getElementById('newpass-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      errEl.textContent = '';
      const password = document.getElementById('f-pass').value;
      submitBtn.disabled = true;
      submitBtn.textContent = 'Saving…';
      const res = await Store.updatePassword(password);
      if (!res.ok) {
        errEl.textContent = res.error;
        submitBtn.disabled = false;
        submitBtn.textContent = 'Save password';
        return;
      }
      go('#/');           // recovering cleared + world hydrated → drops us home
      warmImages();
    });
  }

  // Landing after an email-confirmation click when Supabase didn't auto-sign the
  // person in (config dependent). A plain "you're verified, log in" reassurance.
  function renderConfirmed() {
    view.innerHTML =
      `<section class="auth"><div class="auth-card">` +
        `<div class="auth-brand">tria</div>` +
        `<h1 class="auth-head">You're all set</h1>` +
        `<p class="auth-sub">Your email is confirmed. Log in and say hello.</p>` +
        `<button class="auth-submit publish-fill is-solid" type="button" id="confirmed-go">Log in</button>` +
      `</div></section>`;
    document.getElementById('confirmed-go').addEventListener('click', () => {
      authMode = 'login';
      go('#/signin');
    });
  }

  /* ── Profile (own account or any friend, at #/u/username) ─────────────────────
     One view renders both: the signed-in identity + their posts as a single-
     author column. Your own profile carries a Log out; a friend's carries a
     an Add-friend toggle and a way back to the directory. */
  // A blocked person's profile: no content, just a quiet wall with an undo. Their
  // posts are already gone from your feed; this closes the last door (their page).
  function renderBlockedWall(u) {
    const b = backTarget();
    view.innerHTML =
      `<section class="view">` +
        `<a class="profile-back" href="${b.href}">← ${esc(b.label)}</a>` +
        `<div class="blocked-wall">` +
          `<div class="blocked-mark">${svgIcon('block')}</div>` +
          `<h1 class="blocked-name">${esc(u.name)}</h1>` +
          `<p class="blocked-note">You blocked @${esc(u.username)}. You won't see each other on Tria.</p>` +
          `<button class="blocked-unblock" type="button" id="unblock">Unblock</button>` +
        `</div>` +
      `</section>`;
    const btn = document.getElementById('unblock');
    if (btn) btn.addEventListener('click', () => { Blocks.remove(u.username); renderUser(u.username); });
  }

  function renderUser(username) {
    const u = Store.user(username);
    if (!u) { location.hash = '#/'; return; }          // stale link → home
    const isSelf = u.username === Store.session();
    // Arriving from the feed's ••• "Edit post": open that post in its editor and
    // scroll it into view (spotlight), same as a copied-link landing.
    if (isSelf && pendingEditId) {
      editingId = pendingEditId;
      spotlightPost = pendingEditId;
      pendingEditId = null;
    }
    if (!isSelf && Blocks.has(u.username)) { renderBlockedWall(u); return; }
    const isFriend = Store.isFriend(u.username);
    // A private profile fences its whole feed to friends: an outsider sees the
    // identity card and a nudge to add them, no posts. (The data layer backs this
    // too — RLS won't hand a non-friend a private author's rows.) A public profile
    // still shows notes/finds/photos to anyone; activities stay circle business,
    // hidden until you've added each other.
    const locked = Store.isPrivate(u.username) && !isSelf && !isFriend;
    const list = locked ? [] : Store.postsBy(u.username)
      .filter(p => p.type !== 'activity' || isSelf || isFriend);
    const friendStatus = isSelf ? null : Store.friendStatus(u.username);
    const areFriends = friendStatus === 'friends';

    // One inline metadata line on the identity's left axis: "N posts · N friends".
    // Friend COUNT is public (same on your card and anyone else's), but WHO those
    // friends are is circle business — so the friend stat is a tappable button only
    // for you or a friend, plain text otherwise. A locked profile fences its feed,
    // so its post stat is dropped (a "0 posts" would mislead) and the line carries
    // the friend count alone (no leading dot).
    const postNum = list.length;
    const postStat = locked ? ''
      : `<span class="account-stat">` +
          `<span class="account-stat-num">${postNum}</span> ` +
          `<span class="account-stat-label">${postNum === 1 ? 'post' : 'posts'}</span>` +
        `</span>`;
    const fc = Store.friendsOf(u.username).length;
    const canSeeFriends = (isSelf || isFriend) && fc > 0;
    const friendInner =
      `<span class="account-stat-num">${fc}</span> ` +
      `<span class="account-stat-label">${fc === 1 ? 'friend' : 'friends'}</span>`;
    const friendStat = canSeeFriends
      ? `<button type="button" class="account-stat account-stat--friends" id="show-friends">${friendInner}</button>`
      : `<span class="account-stat">${friendInner}</span>`;
    const statSep = (postStat && friendStat)
      ? `<span class="account-stat-dot" aria-hidden="true">·</span>` : '';
    const statsRow = `<div class="account-stats">${postStat}${statSep}${friendStat}</div>`;

    // The in-flow action row (foot of the identity grid): Share on your own card,
    // the add / requested / accept tie on a visitor's. Once you're mutually
    // friends the tie leaves this row entirely and becomes a quiet corner badge
    // (see friendBadge) — freeing the card for the bio and, by design, making
    // "un-tie" a deliberate act rather than a standing button.
    // In-flow action row (foot of the identity grid). Your own card has none —
    // Share and Edit both live as corner icons now. A visitor's carries the
    // add / requested / accept tie, unless you're already friends (that's the
    // corner badge too).
    const action = (isSelf || areFriends) ? ''
      : (() => {
          // Three pre-friend states: add / requested (pending, sent) / accept
          // (they asked first). Only "sent" is a committed state (muted outline,
          // undo on tap); add + accept wear the filled accent and create my edge.
          const s = friendStatus;
          const label = { none: 'Add friend', sent: 'Requested', incoming: 'Accept request' }[s];
          const committed = s === 'sent';
          const title = s === 'sent' ? ' title="Tap to cancel your request"' : '';
          return `<div class="account-actions">` +
            `<button class="friend-btn" type="button" id="friend" ` +
              `data-status="${s}" aria-pressed="${committed}"${title}>${esc(label)}</button>` +
          `</div>`;
        })();

    // The photo IS the profile now: it fills the hero edge to edge and blurs
    // progressively toward its base, where a liquid-glass card carries the name,
    // handle, bio, stats and the action. No photo → a tinted panel with the big
    // monogram, same card. The photo's colour still spills into the page wash
    // below the hero via applyAmbient. The top-corner control is change-photo for
    // the owner, back-to-directory for a visitor.
    // Corner badge cluster (top-right of the card): a row of small glass discs.
    // Your own card carries a single ••• glyph (far corner, where Edit always
    // lived); its menu holds Share profile + Edit profile. A visitor's carries the
    // tie ONCE you're friends — the same slot, the two never coexist — where a tap
    // still removes; parking it here rather than as a standing button nudges people
    // to stay friends and frees the card for the bio.
    const friendBadge = areFriends
      ? `<button class="account-friend-badge" type="button" id="friend" data-status="friends" ` +
          `aria-label="Friends, tap to remove" title="Friends · tap to remove">` +
          svgIcon('friends', 'account-friend-ico') + `</button>`
      : '';
    // The ••• glyph: on your own card it carries Share profile + Edit profile; on a
    // visitor who ISN'T your friend it carries Block + Report (App Store 1.2 — you
    // must be able to block an abusive person you haven't added). Friends get those
    // inside the friend badge's menu instead, so the glyph sits out when areFriends.
    const moreBadge = (isSelf || !areFriends)
      ? `<button class="account-more-badge" type="button" id="account-more" ` +
          `aria-label="${isSelf ? 'Profile options' : 'More'}" title="${isSelf ? 'Options' : 'More'}">` +
          svgIcon('dots', 'account-more-ico') + `</button>`
      : '';
    const cornerBadges = (friendBadge || moreBadge)
      ? `<div class="account-badges">${friendBadge}${moreBadge}</div>`
      : '';

    // Bio always rides in the identity column beside the photo, on the same left
    // axis as the name/stats/action — short or long, it just wraps in place (no
    // character-count threshold, no jump to a separate full-width slot).
    const bio = u.bio ? `<p class="account-bio">${esc(u.bio)}</p>` : '';

    const back = isSelf ? '' : (() => { const b = backTarget();
      return `<a class="profile-back" href="${b.href}">← ${esc(b.label)}</a>`; })();

    view.innerHTML =
      `<section class="view">` +
        back +
        `<div class="account">` +
          // A floating glass card on the profile's own colour wash (.ambient,
          // tinted from the photo) — the glass refracts that wash, so each profile
          // reads in a custom hue. Avatar left, identity beside it, bio below,
          // actions centred underneath.
          `<div class="account-card${u.bio ? '' : ' account-card--nobio'}">` +
            cornerBadges +
            `<div class="account-head">` +
              `<div class="account-photo${u.avatar ? '' : ' account-photo--empty'}">` +
                (u.avatar
                  ? `<img src="${esc(u.avatar)}" crossorigin="anonymous" alt="" decoding="async">`
                  : `<span class="account-photo-initial" aria-hidden="true">${esc(initialOf(u.name || u.username))}</span>`) +
              `</div>` +
              // The identity column, all on one left axis: name+handle, an inline
              // "N posts · N friends" stat line, the bio (wraps in place, any
              // length), then the action beneath. No bio → the column vertically
              // centres against the taller photo (see .account-card--nobio).
              `<div class="account-meta">` +
                `<div class="account-id">` +
                  `<h1 class="account-name">${esc(u.name)}</h1>` +
                  `<p class="account-handle">@${esc(u.username)}</p>` +
                `</div>` +
                statsRow +
                bio +
                action +
              `</div>` +
            `</div>` +
          `</div>` +
        `</div>` +
        `<div class="feed" id="feed"></div>` +
      `</section>`;

    // Their posts as a single-author column (slim date line, not a repeated
    // byline). Photos keep the lightbox; tags jump to the home feed filtered.
    const feedEl = view.querySelector('#feed');

    if (locked) {
      // Private profile, seen by an outsider: no posts, just a warm nudge toward
      // the Add-friend button that already sits in the card above.
      feedEl.innerHTML =
        `<div class="profile-locked">` +
          svgIcon('lock', 'profile-locked-ico') +
          `<p class="profile-locked-line">${esc(u.name)} keeps their posts for friends.</p>` +
          `<p class="profile-locked-sub">Add them and, once they add you back, their posts show up here.</p>` +
        `</div>`;
    } else if (!list.length) {
      feedEl.innerHTML = `<p class="feed-empty">` +
        `${isSelf ? 'Nothing posted yet. Whenever you’re ready.' : 'Nothing here yet.'}</p>`;
    } else {
      const frag = document.createDocumentFragment();
      list.forEach((p, i) => {
        const card = (isSelf && p.id === editingId)
          ? makeEditCard(p)
          : makeCard(p, { solo: true });
        card.style.animationDelay = staggerDelay(i);
        frag.appendChild(card);
      });
      feedEl.appendChild(frag);
    }

    // An Updates row targeted this post: bring it into view with a brief wash,
    // so the tap visibly lands on the thing that changed. The router skips its
    // top-snap while a spotlight is pending (see route), so this smooth scroll is
    // the only motion — one glide to the card, not a jump-to-top then back down.
    // (Delayed a beat so the entering-page transition has settled first.)
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
      else scrollTop(false);   // target filtered out — fall back to the top
    }

    const editForm = feedEl.querySelector('.edit-form');
    if (editForm) {
      // Snapshot the fields exactly as rendered. The lone toggle stays a quiet
      // "Cancel" until any field diverges from that baseline, then flips to the
      // accent "Save changes" — so Save never shows on an untouched form, and
      // reverting an edit drops it back to Cancel.
      const toggle = editForm.querySelector('.edit-toggle');
      const snapshot = () => Array.from(editForm.querySelectorAll('input, textarea, [contenteditable]'))
        .map(el => el.isContentEditable ? el.innerHTML : el.value).join('\u0000');
      const baseline = snapshot();
      const dirty = () => snapshot() !== baseline;
      const syncToggle = () => {
        const d = dirty();
        toggle.classList.toggle('is-dirty', d);
        toggle.textContent = d ? 'Save changes' : 'Cancel';
      };
      editForm.addEventListener('input', syncToggle);
      editForm.addEventListener('change', syncToggle);
      toggle.addEventListener('click', () => {
        if (dirty()) submitEdit(editingId, username);
        else { editingId = null; renderUser(username); }
      });
      editForm.addEventListener('submit', (e) => {
        e.preventDefault();
        if (dirty()) submitEdit(editingId, username);   // Enter saves, but never a no-op
      });
      const eNote = editForm.querySelector('#e-note');
      wireMentions(eNote);
      if (eNote && eNote.isContentEditable) wireRichEditor(eNote, editForm.querySelector('#e-note-count'));
      // Don't auto-focus on touch: it yanks up the keyboard and the viewport
      // jumps to center the field, which reads as a jarring lurch. Let the tap
      // that opens the field raise the keyboard instead. Desktop still autofocuses.
      if (window.matchMedia('(hover: hover) and (pointer: fine)').matches)
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
      // Already friends → open the menu (Remove / Block / Report) rather than
      // dropping the edge on one stray tap. sent → cancel the request; add /
      // accept both create my edge.
      const status = friendBtn.dataset.status;
      if (status === 'friends') { openFriendMenu(u.username, () => renderUser(username)); return; }
      if (status === 'sent') await Store.removeFriend(u.username);
      else await Store.addFriend(u.username);
      renderUser(username);      // reflect the new state in place
    });

    // The ••• glyph on the profile header: your own opens Edit profile; a
    // non-friend visitor's carries Block + Report.
    const moreBtn = document.getElementById('account-more');
    if (moreBtn) moreBtn.addEventListener('click', () => {
      if (isSelf) {
        openSheet({ items: [
          { label: 'Share profile', icon: 'send', run: () => shareOrCopy({
              title: `@${u.username} on Tria`,
              text: `Join me on Tria`,
              url: profileLink(u.username),
            }).then(result => {
              if (result === 'cancelled') return;
              toast(result === 'copied' ? 'Link copied' : 'Shared');
            }) },
          { label: 'Edit profile', icon: 'pencil', run: () => openProfileEditor(() => renderUser(username)) },
        ] });
        return;
      }
      openSheet({
        title: u.name || '@' + u.username,
        items: [
          { label: 'Block', icon: 'block', danger: true, run: () => confirmBlock(u.username, () => renderUser(username)) },
          { label: 'Report', icon: 'flag', danger: true, run: () => reportUser(u.username) },
        ],
      });
    });

    const friendsBtn = document.getElementById('show-friends');
    if (friendsBtn) friendsBtn.addEventListener('click',
      () => openFriendsList(u));
  }

  /* Dismiss a .modal by playing the reverse of its open animation (frost fades,
     card sinks back down) and removing it once that settles. Returns a guarded
     close() the modal's own Esc/backdrop/cancel handlers can all share. */
  function modalCloser(modal, cleanup) {
    let closing = false;
    return () => {
      if (closing) return;
      closing = true;
      document.body.style.overflow = '';
      if (cleanup) cleanup();
      modal.classList.add('modal--closing');
      modal.addEventListener('animationend', () => modal.remove(), { once: true });
    };
  }

  /* ── Friends list ────────────────────────────────────────────────────────
     Tapping a profile's friend count opens their circle as a frosted modal:
     the same directory rows as the Friends page, each linking to that person's
     profile (which closes the modal on the way). Read-only — no add controls. */
  function openFriendsList(u) {
    const list = Store.friendsOf(u.username)
      .map(name => Store.user(name))
      .filter(Boolean)
      .sort((a, b) => (a.name || a.username).localeCompare(b.name || b.username));

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', `${u.name}’s friends`);
    const rows = list.map(f =>
      `<a class="friend" href="#/u/${encodeURIComponent(f.username)}">` +
        avatarEl(f, { cls: 'friend-avatar' }) +
        `<span class="friend-text">` +
          `<span class="friend-name">${esc(f.name)}</span>` +
          `<span class="friend-user">@${esc(f.username)}</span>` +
        `</span>` +
        `<span class="friend-go" aria-hidden="true">→</span>` +
      `</a>`).join('');
    modal.innerHTML =
      `<div class="modal-card modal-card--glass modal-card--list">` +
        `<h2 class="modal-title">${esc(u.name)}’s friends</h2>` +
        `<div class="friends-list friends-list--modal">${rows}</div>` +
        `<div class="modal-actions">` +
          `<button type="button" class="edit-cancel" id="fl-close">Close</button>` +
        `</div>` +
      `</div>`;
    document.body.appendChild(modal);
    document.body.style.overflow = 'hidden';

    const close = modalCloser(modal, () => document.removeEventListener('keydown', onEsc));
    const onEsc = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onEsc);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    modal.querySelector('#fl-close').addEventListener('click', close);
    // Rows cascade in with the same soft stagger as the Friends page and feed,
    // so the popup reads as part of the same family. A row navigates to that
    // friend's profile — close first so we don't leave a scroll-locked modal
    // behind the new page.
    modal.querySelectorAll('.friend').forEach((a, i) => {
      a.style.animationDelay = staggerDelay(i);
      a.addEventListener('click', close);
    });
  }

  /* ── Avatar editor ───────────────────────────────────────────────────────
     A small frosted modal for setting your profile photo: pick → square crop
     (reusing initCropper) → save. On save it exports a 512² JPEG data-URI and
     hands it to Store.updateAvatar, then calls `done` to re-render in place. */
  /* ── Profile editor ──────────────────────────────────────────────────────
     One place for everything about you: your photo, display name, and bio (plus
     the notifications toggle and Log out). The photo folds in here — pick a file
     to reveal an inline square cropper; Save commits the words and, if you chose
     a new photo, the crop too. Saves via Store.updateProfile / updateAvatar, then
     calls `done` to re-render the profile in place. */
  function openProfileEditor(done) {
    const u = Store.currentUser();
    if (!u) return;
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Edit profile');
    modal.innerHTML =
      `<div class="modal-card modal-card--glass">` +
        `<h2 class="modal-title">Edit profile</h2>` +
        `<form id="pf-form" novalidate>` +
          `<div class="pf-photo" id="pf-photo">` +
            `<div class="pf-photo-figure">` +
              avatarEl(u, { cls: 'pf-photo-avatar' }) +
              // Div, not <button>: kills the iOS standalone native pressed-fill
              // flash on this filled badge (same fix as the composer dropzone).
              `<div class="pf-photo-edit" id="pf-photo-pick" role="button" tabindex="0" ` +
                `aria-label="Change your photo" title="Change your photo">` +
                svgIcon('camera', 'pf-photo-ico') + `</div>` +
            `</div>` +
          `</div>` +
          `<input id="pf-file" type="file" accept="image/*" hidden>` +
          `<div class="crop crop--avatar" id="pf-crop" hidden>` +
            `<img id="pf-cropimg" alt="" draggable="false">` +
            `<span class="crop-hint">Drag to reposition</span>` +
          `</div>` +
          // Identity as one combo box — display name as the serif headline, bio as
          // the note beneath it — mirroring the composer's title+note and signup.
          `<div class="field field--combo">` +
            `<input id="pf-name" class="combo-title" type="text" maxlength="40" ` +
              `value="${esc(u.name)}" placeholder="Display name" autocomplete="name" ` +
              `aria-label="Display name">` +
            `<div class="combo-divider" aria-hidden="true"></div>` +
            `<textarea id="pf-bio" class="combo-note" rows="3" maxlength="160" ` +
              `placeholder="A line about you (optional)." aria-label="Bio">${esc(u.bio || '')}</textarea>` +
          `</div>` +
          `<p class="field-hint field-hint--combo" id="pf-count"></p>` +
          // Privacy + notifications sit below the identity as quiet settings.
          `<div class="push-toggle-row">` +
            `<span class="push-toggle-label">Private account</span>` +
            `<button type="button" class="push-toggle" role="switch" id="privacy-toggle" ` +
              `aria-checked="${u.private !== false}" ` +
              `aria-label="Private account, only friends can see your posts">` +
              `<span class="push-toggle-knob" aria-hidden="true"></span>` +
            `</button>` +
          `</div>` +
          `<p class="field-hint">When on, only friends can see your posts. Activities are always friends only.</p>` +
          pushToggleHtml() +
          `<p class="composer-error" id="pf-error" role="alert"></p>` +
          // Cancel + Save are the form's commit row. Account actions (Log out,
          // Delete) live in their own zone below, split off by a hairline — they
          // act on the session, not this form, so they read as a separate group.
          `<div class="modal-actions">` +
            `<button type="button" class="edit-cancel" id="pf-cancel">Cancel</button>` +
            `<button type="submit" class="composer-submit" id="pf-save">Save</button>` +
          `</div>` +
          // Two quiet icon buttons. Delete sits left (coral danger tint, App
          // Store 5.1.1(v) requires the option — still guarded by the confirm
          // sheet); Log out sits right, in the more reachable spot, mirroring
          // Save's position in the row above since it's the one tapped often.
          `<div class="pf-account">` +
            `<button type="button" class="pf-account-btn pf-delete" id="pf-delete">` +
              svgIcon('trash') + `Delete account</button>` +
            `<button type="button" class="pf-account-btn pf-logout" id="pf-logout">` +
              svgIcon('signout') + `Log out</button>` +
          `</div>` +
        `</form>` +
      `</div>`;
    document.body.appendChild(modal);
    document.body.style.overflow = 'hidden';

    const nameEl = modal.querySelector('#pf-name');
    const bioEl = modal.querySelector('#pf-bio');
    const countEl = modal.querySelector('#pf-count');
    const errEl = modal.querySelector('#pf-error');
    const privacyBtn = modal.querySelector('#privacy-toggle');

    // A plain UI switch — it holds its state until Save commits it alongside the
    // words (Cancel discards it, same as name/bio).
    privacyBtn.addEventListener('click', () => {
      const on = privacyBtn.getAttribute('aria-checked') === 'true';
      privacyBtn.setAttribute('aria-checked', String(!on));
    });

    const close = modalCloser(modal, () => document.removeEventListener('keydown', onEsc));
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

    // Photo: pick a file → an inline square crop replaces the thumbnail. Save
    // commits it alongside the words; no file chosen leaves the photo untouched.
    const pfFile = modal.querySelector('#pf-file');
    const pfCropEl = modal.querySelector('#pf-crop');
    const pfCropImg = modal.querySelector('#pf-cropimg');
    const pfPhotoRow = modal.querySelector('#pf-photo');
    let pfCropper = null;
    const pfPick = modal.querySelector('#pf-photo-pick');   // role=button div, not <button>
    pfPick.addEventListener('click', () => pfFile.click());
    pfPick.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pfFile.click(); } });
    pfFile.addEventListener('change', () => {
      const f = pfFile.files && pfFile.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        pfPhotoRow.hidden = true;
        pfCropEl.hidden = false;
        pfCropper = initCropper(pfCropEl, pfCropImg, reader.result);
      };
      reader.readAsDataURL(f);
    });

    modal.querySelector('#pf-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const res = await Store.updateProfile({
        name: nameEl.value, bio: bioEl.value,
        isPrivate: privacyBtn.getAttribute('aria-checked') === 'true',
      });
      if (!res.ok) { errEl.textContent = res.error; return; }
      // A freshly cropped photo commits alongside — optimistic (cache updates
      // synchronously), upload in the background; on failure the store reverts.
      const pendingAvatar = pfCropper ? Store.updateAvatar(pfCropper.export(512)) : null;
      close();
      done();
      if (pendingAvatar) pendingAvatar.then(r => { if (!r.ok) { done(); toast(r.error); } });
    });

    // Account controls: the notifications toggle and Log out, now homed here.
    wirePushToggle();
    modal.querySelector('#pf-logout').addEventListener('click', async () => {
      await Store.logout();
      authMode = 'login';        // returning user — offer login first
      close();
      go('#/signin');
    });

    // Delete account: one sheet standing in for "are you sure", so an accidental
    // tap next to Log out can't fall through to something unrecoverable. The
    // sheet's own Cancel (always rendered) is the escape hatch.
    modal.querySelector('#pf-delete').addEventListener('click', () => {
      openSheet({
        title: 'Delete your account? This can’t be undone.',
        items: [{
          label: 'Delete account', icon: 'trash', danger: true,
          run: async () => {
            const res = await Store.deleteAccount();
            if (!res.ok) { toast(res.error); return; }
            authMode = 'signup';   // no account left to log back into
            close();
            go('#/');
            toast('Account deleted.');
          },
        }],
      });
    });

    // Desktop only — on touch this would pop the keyboard and lurch the modal to
    // center the field (see the same guard on the post edit form).
    if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
      nameEl.focus();
      nameEl.select();
    }
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

  // Offer the native OS share sheet where it exists (iOS/Android, and Tria runs
  // as an installed PWA there), falling back to a clipboard copy on desktop
  // browsers that lack navigator.share. Resolves to 'shared', 'copied', or
  // 'cancelled' so callers can tune their confirmation. A deliberate dismiss of
  // the sheet (AbortError) is a cancel, not a reason to fall back to copy.
  function shareOrCopy(data) {
    if (navigator.share) {
      return navigator.share(data).then(
        () => 'shared',
        (err) => (err && err.name === 'AbortError')
          ? 'cancelled'
          : copyText(data.url).then(ok => ok ? 'copied' : 'cancelled'),
      );
    }
    return copyText(data.url).then(ok => ok ? 'copied' : 'cancelled');
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

  /* ── Action sheet ─────────────────────────────────────────────────────────────
     A floating glass panel that rises from the bottom over a scrim — the iOS
     action-sheet pattern. Home to the per-post overflow (••• → Copy link, Report)
     and the friend menu (Remove friend, Block, Report). Glass per the material
     rule (a menu floats above content). items: {label, icon?, danger?, run?}; run
     may be async and fires after the sheet closes. Reduced-motion aware. */
  let sheetOpen = false;
  function openSheet({ title, items }) {
    if (sheetOpen) return;
    sheetOpen = true;
    const scrim = document.createElement('div');
    scrim.className = 'sheet-scrim';
    const rows = items.map((it, i) =>
      `<button class="sheet-item${it.danger ? ' sheet-item--danger' : ''}" type="button" data-i="${i}">` +
        (it.icon ? svgIcon(it.icon, 'sheet-ico') : '') +
        `<span>${esc(it.label)}</span>` +
      `</button>`).join('');
    scrim.innerHTML =
      `<div class="sheet" role="dialog" aria-modal="true"${title ? ` aria-label="${esc(title)}"` : ''}>` +
        (title ? `<p class="sheet-title">${esc(title)}</p>` : '') +
        `<div class="sheet-items">${rows}</div>` +
        `<button class="sheet-cancel" type="button">Cancel</button>` +
      `</div>`;
    document.body.appendChild(scrim);
    document.body.style.overflow = 'hidden';
    // Remember who opened the sheet so focus can return there on close (HIG /
    // WAI-ARIA dialog: focus moves in on open, is trapped while open, returns on
    // close). Move focus to the first action once it's painted.
    const opener = document.activeElement;
    const focusables = () => [...scrim.querySelectorAll('.sheet-item, .sheet-cancel')];
    requestAnimationFrame(() => {
      scrim.classList.add('open');
      focusables()[0]?.focus();
    });

    const close = (then) => {
      if (!sheetOpen) return;
      sheetOpen = false;
      document.removeEventListener('keydown', onKey);
      scrim.classList.remove('open');
      document.body.style.overflow = '';
      if (opener && opener.focus) opener.focus();   // restore focus to the ••• trigger
      const done = () => { scrim.remove(); if (then) then(); };
      if (prefersReduced()) done(); else setTimeout(done, 220);
    };
    function onKey(e) {
      if (e.key === 'Escape') { close(); return; }
      if (e.key !== 'Tab') return;
      // Trap Tab inside the sheet so a keyboard user can't wander behind the scrim.
      const f = focusables();
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }

    scrim.addEventListener('click', (e) => { if (e.target === scrim) close(); });
    scrim.querySelector('.sheet-cancel').addEventListener('click', () => close());
    scrim.querySelectorAll('.sheet-item').forEach(btn =>
      btn.addEventListener('click', () => {
        const it = items[+btn.dataset.i];
        close(() => { if (it && it.run) it.run(); });
      }));
    document.addEventListener('keydown', onKey);
  }

  // A deep link to a single post: the author's profile plus ?p=<id>, which the
  // router reads to spotlight-scroll the card into view (same mechanism an Updates
  // row uses). Only resolves for someone who can already see that author's posts —
  // correct, since posts are friends-only. Falls back to the bare @handle off-web.
  function postLink(post) {
    const base = profileLink(post.author);
    return /^https?:/.test(base) ? `${base}?p=${encodeURIComponent(post.id)}` : base;
  }

  function copyPostLink(post) {
    const author = Store.user(post.author);
    shareOrCopy({
      title: `${author ? author.name : post.author} on Tria`,
      text: 'A post on Tria',
      url: postLink(post),
    }).then(result => {
      if (result === 'cancelled') return;
      toast(result === 'copied' ? 'Link copied' : 'Shared');
    });
  }

  // Reports ride the same pipe as the feedback form (App Store 1.2: a report
  // channel with a timely response — it lands in Zoe's inbox immediately, and she
  // has the DB access to remove content or suspend an account). No schema needed.
  async function sendReport(payload) {
    const me = Store.user(Store.session());
    try {
      const res = await fetch(FEEDBACK_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ _subject: 'Tria report', reporter: me ? '@' + me.username : '(unknown)', ...payload }),
      });
      if (!res.ok) throw new Error('send failed');
      return true;
    } catch { return false; }
  }

  const REPORT_REASONS = ['Spam', 'Harassment or bullying', 'Hate or abuse', 'Explicit or violent', 'Something else'];
  const reportToast = (ok) =>
    toast(ok ? 'Thanks. Your report has been sent.' : "That didn't send. Please try again in a moment.");

  function reportPost(post) {
    openSheet({
      title: 'Report this post',
      items: REPORT_REASONS.map(reason => ({ label: reason, run: async () =>
        reportToast(await sendReport({
          kind: 'post', reason,
          post_id: post.id, post_type: post.type, post_author: '@' + post.author,
          excerpt: (post.title || post.note || '').replace(/<[^>]*>/g, ' ').trim().slice(0, 280) || '(no text)',
          link: postLink(post),
        })) })),
    });
  }

  function reportUser(username) {
    const u = Store.user(username);
    openSheet({
      title: 'Report @' + username,
      items: REPORT_REASONS.map(reason => ({ label: reason, run: async () =>
        reportToast(await sendReport({ kind: 'user', reason, reported: '@' + username, name: u ? u.name : '' })) })),
    });
  }

  // The per-post overflow (•••). Copy link for everyone; Add to calendar on
  // upcoming activities (a sibling "send this elsewhere" action); Report only on
  // posts that aren't yours (you can't report yourself).
  function openPostMenu(post) {
    const own = post.author === Store.session();
    const items = [{ label: 'Copy link', icon: 'link', run: () => copyPostLink(post) }];
    if (isCalendarable(post))
      items.push({ label: 'Add to calendar', icon: 'cal', run: () => downloadIcs(post) });
    if (own) {
      // Polls aren't editable — the choices are fixed once posted (editing them out
      // from under people who already voted makes no sense), so it's delete-only.
      if (post.type !== 'poll')
        items.push({ label: 'Edit post', icon: 'pencil', run: () => startPostEdit(post) });
      items.push({ label: 'Delete post', icon: 'trash', danger: true, run: () => confirmDeletePost(post) });
    } else {
      items.push({ label: 'Report post', icon: 'flag', danger: true, run: () => reportPost(post) });
    }
    openSheet({ items });
  }

  // Delete confirm for one of your own posts. A nested sheet (its own Cancel is
  // the escape hatch, the danger row the deliberate act — the same one-sheet guard
  // Delete account uses). Fired from the post's ••• menu wherever the card lives,
  // so it refreshes whichever view is showing rather than assuming the profile.
  function confirmDeletePost(post) {
    openSheet({
      title: 'Delete this post? This can’t be undone.',
      items: [{ label: 'Delete post', icon: 'trash', danger: true, run: async () => {
        if (editingId === post.id) editingId = null;   // may be open in the inline editor
        const res = await Store.deletePost(post.id);
        if (res && res.ok === false) { toast(res.error || 'Couldn’t delete, try again.'); return; }
        refreshPostViews();
      } }],
    });
  }

  // After a post mutation (delete), re-render whichever of the two surfaces that
  // can show your OWN posts is live: your profile (renderUser recomputes the
  // "N posts" stat + empty state) or the home feed (renderFeed reconciles the
  // card out). A visitor's #/u/<handle> never shows your posts, so it can't be
  // the delete context.
  function refreshPostViews() {
    const path = (location.hash || '#/').split('?')[0];
    if (path === '#/profile') renderUser(Store.session());
    else renderFeed();
  }

  // Edit swaps the card for a form, but that machinery lives on the profile
  // (renderUser + editingId). From anywhere else the ••• "Edit post" lands you
  // on your own profile with that post already open in its editor.
  function startPostEdit(post) {
    if (location.hash === '#/profile') {
      editingId = post.id;
      renderUser(Store.session());
      return;
    }
    pendingEditId = post.id;      // survives the router's editingId reset; consumed by renderUser
    location.hash = '#/profile';
  }

  // The friend badge/menu: Remove friend, Block, Report. Replaces the old
  // tap-to-unfriend so an accidental tap can't silently drop a friendship.
  function openFriendMenu(username, after) {
    const u = Store.user(username);
    openSheet({
      title: u ? u.name : '@' + username,
      items: [
        { label: 'Remove friend', icon: 'friends', run: async () => { await Store.removeFriend(username); if (after) after(); } },
        { label: 'Block', icon: 'block', danger: true, run: () => confirmBlock(username, after) },
        { label: 'Report', icon: 'flag', danger: true, run: () => reportUser(username) },
      ],
    });
  }

  // Block is heavy, so confirm it. Blocking severs the friendship (removeFriend
  // drops the mutual edge server-side too) and adds them to the local block list,
  // which hides their posts and swaps their profile for a blocked wall.
  function confirmBlock(username, after) {
    const u = Store.user(username);
    openSheet({
      title: `Block ${u ? u.name : '@' + username}?`,
      items: [
        { label: 'Block', icon: 'block', danger: true, run: () => {
            Blocks.add(username);   // hides them now (local mirror) + Store.block severs the tie server-side
            toast("Blocked. You won't see each other.");
            if (after) after();
          } },
      ],
    });
  }

  // Delegated: any post's ••• opens its menu, wherever the card is rendered.
  document.addEventListener('click', (e) => {
    const mb = e.target.closest('.card-menu');
    if (!mb) return;
    e.preventDefault();
    const post = Store.posts().find(p => p.id === mb.dataset.menu);
    if (post) openPostMenu(post);
  });

  /* ── Friends (your mutual circle) + Discover (people you haven't added) ───────
     A segmented control (seg-tabs) splits the page: My circle wears the brand
     gradient glow under the thumb, Find friends rests monochrome. */
  const FRIENDS_TABS = [
    { key: 'circle', label: 'My circle' },
    { key: 'find',   label: 'Find friends' },
  ];
  let friendsTab = 'circle';
  let friendsQuery = '';   // live filter over the shown list (name + @username)
  function renderFriends() {
    const me = Store.session();
    const friendSet = new Set(Store.friends());
    const byName = (a, b) => a.name.localeCompare(b.name);

    const friends = Store.friends().map(Store.user).filter(Boolean)
      .filter(u => !Blocks.has(u.username)).sort(byName);
    // Everyone signed up who isn't you, isn't already a friend, and isn't blocked.
    const discover = Store.users()
      .filter(u => u.username !== me && !friendSet.has(u.username) && !Blocks.has(u.username))
      .sort(byName);

    // The inline control on a Discover row, keyed to where the tie stands:
    //   none     → Add       (send a request)
    //   incoming → Accept     (they asked first; add them back → mutual)
    //   sent     → Requested  (muted; tap to take my request back)
    const addBtn = (u) => {
      const s = Store.friendStatus(u.username);
      if (s === 'sent')
        return `<button class="friend-add friend-add--pending" type="button" data-cancel="${esc(u.username)}" ` +
          `aria-label="Cancel your request to ${esc(u.name)}">Requested</button>`;
      const accept = s === 'incoming';
      return `<button class="friend-add" type="button" data-add="${esc(u.username)}" ` +
        `aria-label="${accept ? 'Accept ' + esc(u.name) + '’s request' : 'Add ' + esc(u.name) + ' as a friend'}">` +
        `${accept ? 'Accept' : 'Add'}</button>`;
    };

    // A directory row. `discover` rows swap the go-arrow for the status control
    // above so you can add (or answer) someone without leaving the page.
    const row = (u, add) =>
      `<a class="friend" href="#/u/${encodeURIComponent(u.username)}" ` +
        `data-name="${esc(u.name.toLowerCase())}" data-user="${esc(u.username.toLowerCase())}">` +
        avatarEl(u, { cls: 'friend-avatar' }) +
        `<span class="friend-text">` +
          `<span class="friend-name">${esc(u.name)}</span>` +
          `<span class="friend-user">@${esc(u.username)}</span>` +
          (u.bio ? `<span class="friend-bio">${esc(u.bio)}</span>` : '') +
        `</span>` +
        (add ? addBtn(u) : `<span class="friend-go" aria-hidden="true">→</span>`) +
      `</a>`;

    const circleCount = `${friends.length} ${friends.length === 1 ? 'friend' : 'friends'} in your circle`;
    const onCircle = friendsTab === 'circle';
    // The soft ask to share Tria stands at the foot of Find Friends always — a
    // standing invite, not just what you see when there's no one new to add.
    const shareAsk =
      `<div class="feed-empty friends-share">` +
        `<p class="friends-share-ask">Know someone who’d like it here?</p>` +
        `<button class="friends-share-copy publish-fill is-solid" type="button" ` +
          `aria-label="Copy triaonline.com to share">` +
          svgIcon('send', 'friends-share-ico') +
          `<span>Share Tria</span>` +
        `</button>` +
      `</div>`;
    // The tab panel: the "no matches" note plus the active tab's list. Rebuilt in
    // place on a tab switch (the masthead, search field, and tabs all persist), so
    // switching slides the thumb and keeps any open search rather than tearing the
    // whole view down.
    const panelHtml = () => {
      const listHtml = friendsTab === 'circle'
        ? (friends.length
            ? `<div class="friends-list">` + friends.map(u => row(u, false)).join('') + `</div>`
            : `<p class="feed-empty">Your circle is empty, for now.</p>`)
        : (discover.length
            ? `<div class="friends-list">` + discover.map(u => row(u, true)).join('') + `</div>` + shareAsk
            : `<p class="feed-empty">No one new to add right now.</p>` + shareAsk);
      return `<p class="feed-empty friend-search-empty" hidden>No one by that name.</p>` + listHtml;
    };
    const searchAction =
      `<div class="masthead-search">` +
        `<input type="search" id="friend-search" class="masthead-search-field" ` +
          `autocapitalize="none" autocomplete="off" spellcheck="false" tabindex="-1" ` +
          `placeholder="Search by name or @username" aria-label="Search people">` +
        `<button type="button" class="masthead-search-btn" id="friend-search-toggle" ` +
          `aria-label="Search people" aria-expanded="false">` +
          `<span class="msb-ico msb-ico--search">${svgIcon('search')}</span>` +
          `<span class="msb-ico msb-ico--close">${svgIcon('close')}</span>` +
        `</button>` +
      `</div>`;
    // The circle / find switch is the shared iOS segmented control, driving the
    // tabpanel below. My circle opts into the brand gradient glow.
    view.innerHTML =
      `<section class="view view--friends">` +
        mastheadEl(circleCount, 'Friends', searchAction) +
        segTabsEl('friends', FRIENDS_TABS, friendsTab, { glow: true, panelId: 'friends-panel' }) +
        `<div class="seg-panel" id="friends-panel" role="tabpanel" ` +
          `aria-labelledby="friends-tab-${friendsTab}" tabindex="0">` +
          panelHtml() +
        `</div>` +
      `</section>`;

    // Live search over the shown list — filter rows in place (no re-render, so the
    // field keeps focus as you type) against name + @username. The share ask and
    // "no matches" note toggle to match. State persists in friendsQuery so the
    // filter survives a tab switch's re-render.
    const searchEl = view.querySelector('#friend-search');
    const toggleBtn = view.querySelector('#friend-search-toggle');
    const masthead = view.querySelector('.masthead');
    // Stable containers: the panel keeps its identity across tab-switch swaps
    // (only its innerHTML changes), so the search filter always re-queries the
    // current list/share/empty nodes from it rather than caching stale ones.
    const panel = view.querySelector('#friends-panel');
    const tablist = view.querySelector('#friends-tabs');
    // Rank a row against the query: 2 = a name-word or the username STARTS with it
    // (the strong match), 1 = it appears somewhere, 0 = no match. Both the profile
    // name and the @username are searched.
    const scoreRow = (r, q) => {
      const name = r.dataset.name || '', user = r.dataset.user || '';
      if (user.startsWith(q) || name.split(' ').some(w => w.startsWith(q))) return 2;
      if (user.includes(q) || name.includes(q)) return 1;
      return 0;
    };
    const applyFilter = () => {
      const listEl = panel.querySelector('.friends-list');
      const searchEmpty = panel.querySelector('.friend-search-empty');
      const shareEl = panel.querySelector('.friends-share');
      if (!listEl) { if (searchEmpty) searchEmpty.hidden = true; return; }
      const q = friendsQuery.trim().toLowerCase();
      const rows = [...listEl.querySelectorAll('.friend')];
      if (!q) {   // cleared — restore the natural order, show everyone
        rows.sort((a, b) => a.dataset.order - b.dataset.order)
            .forEach(r => { r.hidden = false; listEl.appendChild(r); });
        if (searchEmpty) searchEmpty.hidden = true;
        if (shareEl) shareEl.hidden = false;
        return;
      }
      // Matches float to the top (best first, ties keep natural order); the rest
      // sink and hide. Re-appending existing nodes reorders without replaying the
      // rise animation, so the list settles rather than flashes.
      const ranked = rows
        .map(r => ({ r, s: scoreRow(r, q), o: +r.dataset.order }))
        .sort((a, b) => b.s - a.s || a.o - b.o);
      let shown = 0;
      ranked.forEach(({ r, s }) => {
        r.hidden = s === 0;
        if (s > 0) shown++;
        listEl.appendChild(r);
      });
      if (searchEmpty) searchEmpty.hidden = shown !== 0;
      if (shareEl) shareEl.hidden = true;   // the standing invite steps aside while searching
    };

    // Wire the freshly mounted rows: stamp each one's natural order + feed stagger
    // (so search can restore order after reordering), then attach the per-row
    // controls (add / accept / cancel) and the share ask. Runs on first render and
    // after every tab-switch panel swap.
    function wirePanel() {
      panel.querySelectorAll('.friend').forEach((el, i) => {
        el.style.animationDelay = staggerDelay(i);
        el.dataset.order = i;
      });
      // Add (or accept) from a Discover row: create my edge, then re-render — a
      // mutual add moves them into your circle, a fresh one flips to "Requested".
      // The button sits inside the row link, so stop it navigating.
      panel.querySelectorAll('.friend-add[data-add]').forEach(btn =>
        btn.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          btn.disabled = true;
          await Store.addFriend(btn.dataset.add);
          renderFriends();
        }));
      // Take back a request already sent (the "Requested" pill).
      panel.querySelectorAll('.friend-add[data-cancel]').forEach(btn =>
        btn.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          btn.disabled = true;
          await Store.removeFriend(btn.dataset.cancel);
          renderFriends();
        }));
      // The share ask: native share sheet where it exists, clipboard copy as the
      // desktop fallback. Confirm softly either way.
      const shareBtn = panel.querySelector('.friends-share-copy');
      if (shareBtn) shareBtn.addEventListener('click', async () => {
        const result = await shareOrCopy({
          title: 'Tria',
          text: 'Join me on Tria',
          url: 'https://triaonline.com',
        });
        if (result === 'cancelled') return;
        const label = shareBtn.querySelector('span');
        label.textContent = result === 'copied' ? 'Link copied' : 'Shared';
        setTimeout(() => { label.textContent = 'Share Tria'; }, 1600);
      });
    }
    wirePanel();

    // Open/close the field. The icon fans it out over the nameplate and focuses
    // it; tapping again (or Escape) folds it back and clears the filter so the
    // full list returns. `foldIfEmpty` reflects the collapsed state without
    // touching a live query (used on blur-away and the reveal helpers).
    const foldIfEmpty = () => {
      if (searchEl.value.trim()) return;
      masthead.classList.remove('searching');
      toggleBtn.setAttribute('aria-expanded', 'false');
      toggleBtn.setAttribute('aria-label', 'Search people');
      searchEl.tabIndex = -1;
    };
    const openSearch = () => {
      masthead.classList.add('searching');
      toggleBtn.setAttribute('aria-expanded', 'true');
      toggleBtn.setAttribute('aria-label', 'Close search');
      searchEl.tabIndex = 0;
      searchEl.focus();
    };
    const closeSearch = () => {
      if (friendsQuery) { friendsQuery = searchEl.value = ''; applyFilter(); }
      masthead.classList.remove('searching');
      toggleBtn.setAttribute('aria-expanded', 'false');
      toggleBtn.setAttribute('aria-label', 'Search people');
      searchEl.tabIndex = -1;
      toggleBtn.focus();
    };

    // Keep focus on the field while the icon is pressed so its blur-to-fold can't
    // race the toggle (mousedown default would move focus off the field first).
    toggleBtn.addEventListener('mousedown', (e) => e.preventDefault());
    toggleBtn.addEventListener('click', () =>
      masthead.classList.contains('searching') ? closeSearch() : openSearch());
    searchEl.addEventListener('blur', foldIfEmpty);
    searchEl.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSearch(); });

    // Reopen (without stealing focus) if a query carried over a tab-switch re-render.
    searchEl.value = friendsQuery;
    if (friendsQuery) {
      masthead.classList.add('searching');
      toggleBtn.setAttribute('aria-expanded', 'true');
      toggleBtn.setAttribute('aria-label', 'Close search');
      searchEl.tabIndex = 0;
    }
    searchEl.addEventListener('input', () => { friendsQuery = searchEl.value; applyFilter(); });
    applyFilter();

    // Switch tabs in place: the shared control slides the thumb + updates aria;
    // here we swap only the panel and keep the masthead and any open search
    // intact. A full renderFriends only runs when membership changes (an add or
    // accept), which the row handlers in wirePanel trigger.
    wireSegTabs(tablist, FRIENDS_TABS, () => friendsTab, (tab) => {
      friendsTab = tab;
      panel.setAttribute('aria-labelledby', 'friends-tab-' + tab);
      panel.innerHTML = panelHtml();
      wirePanel();
      applyFilter();
    });
  }

  /* ── Updates — a quiet ledger, visited on your own time ────────────────────
     A reverse-chronological list of what friends did on YOUR posts: comments,
     likes, hands-up on activities. Deliberately pull-based: no badge, no count
     on the nav, no push — the tab tells you nothing until you choose to look.
     "Read" state is just a soft dot on anything newer than your last visit,
     remembered per-account in localStorage (this device only, and that's fine
     for a signal this gentle). */
  const notifSeenKey = () => `tria:updates-seen:${Store.session()}`;

  // A note as clean one-line plain text — for previews (Updates snippets) where
  // a rich note's headings/emphasis markup would otherwise leak in. Strips the
  // rich-note tags to their words (blocks joined by a space) and collapses
  // whitespace; a legacy plain-text note just gets its whitespace collapsed.
  function notePlain(note) {
    if (!note) return '';
    const text = isRichNote(note)
      ? Array.from(parseNoteHtml(note).childNodes).map(n => n.textContent || '').join(' ')
      : note;
    return text.replace(/\s+/g, ' ').trim();
  }

  // "…liked ‘Metalheart’" — name the post by its title or a note snippet, so a
  // row is recognisable without leaving the list.
  function notifPostLabel(post) {
    if (!post) return 'a post';
    const t = post.title || notePlain(post.note) || '';
    const snip = t.length > 44 ? t.slice(0, 44).trimEnd() + '…' : t;
    if (snip) return `“${snip}”`;
    const yours = post.author === Store.session();
    return post.type === 'photo'
      ? (yours ? 'your photo' : 'a photo')
      : (yours ? 'your post' : 'a post');
  }

  function notifItemHtml(n, lastSeen) {
    const u = Store.user(n.user);
    const name = esc(u ? u.name : n.user);
    const post = Store.posts().find(p => p.id === n.postId);
    const label = esc(notifPostLabel(post));
    const quote = (n.kind === 'comment' || n.kind === 'mention')
      ? esc(n.text.length > 90 ? n.text.slice(0, 90).trimEnd() + '…' : n.text)
      : '';
    const what =
      n.kind === 'comment' ? `commented on ${label}` :
      n.kind === 'like'    ? `liked ${label}` :
      n.kind === 'mention' ? `mentioned you in ${label}` :
      n.kind === 'vote'    ? `voted in ${label}` :
                             `is going to ${label}`;
    // Mentions live on someone else's post, so the row walks to that profile;
    // everything else lands on your own column.
    const href = (n.kind === 'mention' && post)
      ? `#/u/${esc(encodeURIComponent(post.author))}` : '#/profile';
    const fresh = n._ts && n._ts > lastSeen;
    // data-key is the row's stable identity for the reconcile in renderUpdates
    // (kind + which post + who + when) — one event, one row, across refreshes.
    const key = esc(`${n.kind}:${n.postId}:${n.user}:${n._ts || ''}`);
    return `<li data-key="${key}">` +
        `<a class="notif${fresh ? ' notif--new' : ''}" href="${href}" ` +
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

  // The ledger's view switcher (shared seg-tabs control). Only mentions get their
  // own segment; every other kind just shows under All.
  const NOTIF_FILTERS = [
    { key: 'all',     label: 'All'      },
    { key: 'mention', label: 'Mentions' },
  ];
  let notifFilter = 'all';

  // Incoming friend requests — the one actionable thing on an otherwise passive
  // ledger, so it sits up top with Accept / Ignore inline. Shown only under the
  // All filter (a request isn't a mention). Empty string when nobody's asked.
  function friendRequestsHtml() {
    if (notifFilter !== 'all') return '';
    const reqs = Store.requestsReceived().map(Store.user).filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name));
    if (!reqs.length) return '';
    // Each request reads like a ledger row — "<name> wants to be friends" in the
    // same notif voice — but carries Accept / Ignore where a passive row's dot
    // would sit. The avatar + text link walks to their profile, like a notif.
    const rows = reqs.map(u =>
      `<li class="request-row" data-key="req:${esc(u.username)}">` +
        `<a class="request-who" href="#/u/${encodeURIComponent(u.username)}">` +
          avatarEl(u, { cls: 'comment-avatar' }) +
          `<span class="request-text"><strong>${esc(u.name)}</strong> wants to be friends</span>` +
        `</a>` +
        `<span class="request-actions">` +
          `<button class="request-accept" type="button" data-accept="${esc(u.username)}">Accept</button>` +
          `<button class="request-ignore" type="button" data-ignore="${esc(u.username)}" ` +
            `aria-label="Ignore request from ${esc(u.name)}">Ignore</button>` +
        `</span>` +
      `</li>`).join('');
    return `<div class="requests">` +
        `<p class="requests-kicker">Friend request${reqs.length === 1 ? '' : 's'}</p>` +
        `<ul class="requests-list">${rows}</ul>` +
      `</div>`;
  }

  // ── Push pre-prompt ──────────────────────────────────────────────────────
  // A one-time soft card on Updates inviting the device to receive push. Shown
  // only where it's honest to ask: signed in, the browser CAN do push, we
  // haven't asked yet (permission still 'default'), and they haven't waved it
  // off. iOS only lets us raise the real OS prompt from a tap and a "no" is
  // permanent there — so "Turn on" is the gesture that opens it, and this
  // pre-ask keeps us from spending that one shot before anyone wants it.
  const pushAskKey = () => `tria:push-ask:${Store.session()}`;
  // Add ?demo to the URL (e.g. …/?demo#/updates) to force the card in — bypasses
  // the "only ask once, only when permission is unset" gate so it can be reviewed
  // at any time. Purely a preview aid; delivery still needs real permission.
  const pushDemo = () => /(?:^|[?&])demo\b/.test(location.search);
  function pushAskEligible() {
    if (!Store.pushSupported()) return false;
    if (pushDemo()) return true;
    return Notification.permission === 'default'
      && localStorage.getItem(pushAskKey()) !== 'off';
  }
  function pushAskHtml() {
    if (!pushAskEligible()) return '';
    return `<div class="push-ask">` +
        `<div class="push-ask-copy">` +
          `<p class="push-ask-title">Stay in the loop</p>` +
          `<p class="push-ask-body">Get a quiet nudge when a friend replies, tags you, ` +
            `adds you, or shows up for your plans.</p>` +
        `</div>` +
        `<div class="push-ask-actions">` +
          `<button type="button" class="push-ask-dismiss" id="push-not-now">Not now</button>` +
          `<button type="button" class="push-ask-on" id="push-turn-on">Turn on</button>` +
        `</div>` +
      `</div>`;
  }
  function wirePushAsk(rerender) {
    const card = view.querySelector('.push-ask');
    if (!card) return;
    card.querySelector('#push-not-now').addEventListener('click', () => {
      localStorage.setItem(pushAskKey(), 'off');
      card.classList.add('push-ask--out');
      setTimeout(rerender, 220);
    });
    card.querySelector('#push-turn-on').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = 'Turning on…';
      const res = await Store.enablePush();
      if (res.ok) { localStorage.setItem(pushAskKey(), 'off'); toast('Notifications on.'); }
      else toast(res.error);
      rerender();
    });
  }

  // The standing on/off control, on your own profile foot. Mirrors the pre-prompt
  // but is always available — the place to turn push back on after "Not now", or
  // off later. Hidden entirely where the browser can't do push.
  function pushToggleHtml() {
    if (!Store.pushSupported()) return '';
    const on = Notification.permission === 'granted';   // sync guess; refined below
    return `<div class="push-toggle-row">` +
        `<span class="push-toggle-label">Notifications</span>` +
        `<button type="button" class="push-toggle" role="switch" id="push-toggle" ` +
          `aria-checked="${on}" aria-label="Push notifications on this device">` +
          `<span class="push-toggle-knob" aria-hidden="true"></span>` +
        `</button>` +
      `</div>`;
  }
  function wirePushToggle() {
    const btn = document.getElementById('push-toggle');
    if (!btn) return;
    // Reconcile the sync guess with this device's real subscription state.
    Store.pushSubscribed().then(on => btn.setAttribute('aria-checked', String(on)));
    btn.addEventListener('click', async () => {
      const on = btn.getAttribute('aria-checked') === 'true';
      btn.disabled = true;
      if (on) {
        await Store.disablePush();
        btn.setAttribute('aria-checked', 'false');
        toast('Notifications off.');
      } else {
        const res = await Store.enablePush();
        if (res.ok) { btn.setAttribute('aria-checked', 'true'); toast('Notifications on.'); }
        else toast(res.error);
      }
      btn.disabled = false;
    });
  }

  function renderUpdates() {
    const all = Store.notifications();
    const lastSeen = localStorage.getItem(notifSeenKey()) || '';

    // The panel under the tabs: incoming friend requests (All only) then the
    // ledger. Rebuilt in place on a filter switch so the segmented thumb slides
    // rather than the whole view tearing down. friendRequestsHtml reads the live
    // notifFilter and yields '' under Mentions.
    const panelHtml = () => {
      const list = notifFilter === 'all' ? all : all.filter(n => n.kind === notifFilter);
      const requestsHtml = friendRequestsHtml();
      return requestsHtml +
        (list.length
          ? `<ul class="notif-list">${list.map(n => notifItemHtml(n, lastSeen)).join('')}</ul>`
          : requestsHtml
            ? ''   // requests are up top; don't also say "all quiet" beneath them
            : `<p class="feed-empty">${all.length
                ? 'No mentions yet.'
                : 'All quiet. When a friend likes, comments, or says they’re going, it lands here.'}</p>`);
    };
    // Answer a friend request in place. Accept adds them back (→ mutual, they
    // now show in each other's feeds); Ignore clears the request quietly.
    function wireRequests(scope) {
      scope.querySelectorAll('.request-accept').forEach(btn =>
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          await Store.addFriend(btn.dataset.accept);
          renderUpdates();
        }));
      scope.querySelectorAll('.request-ignore').forEach(btn =>
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          await Store.removeFriend(btn.dataset.ignore);
          renderUpdates();
        }));
    }
    // A row walks you to the post itself (your profile column) with the right
    // panel already open — the comment thread, who liked, or who's going — and
    // the profile render scrolls that card into view (see spotlightPost).
    function wireNotif(a) {
      a.addEventListener('click', () => {
        const id = a.dataset.post;
        openComments.delete(id); openLikers.delete(id); openGoing.delete(id);
        if (a.dataset.kind === 'comment' || a.dataset.kind === 'mention') openComments.add(id);
        else if (a.dataset.kind === 'like') openLikers.add(id);
        else if (a.dataset.kind === 'going') openGoing.add(id);
        // 'vote' opens no panel (a poll has none) — just spotlights the post.
        spotlightPost = id;
      });
    }
    // Wire a freshly mounted panel and stagger its rows — request rows lead, the
    // ledger follows. Runs on first mount and after every filter-switch swap.
    function wirePanelFull(panel) {
      wireRequests(panel);
      panel.querySelectorAll('.notif').forEach(wireNotif);
      panel.querySelectorAll('.request-row, .notif').forEach((el, i) => {
        el.style.animationDelay = staggerDelay(i);
      });
    }

    // First mount (or a page navigation into Updates): build the whole view.
    function mount() {
      // All / Mentions is the shared segmented control, neutral (no brand glow) —
      // colour stays reserved for post types.
      view.innerHTML =
        `<section class="view view--updates">` +
          mastheadEl('', 'Updates') +
          pushAskHtml() +
          segTabsEl('updates', NOTIF_FILTERS, notifFilter, { label: 'Filter updates', panelId: 'updates-panel' }) +
          `<div class="seg-panel" id="updates-panel" role="tabpanel" ` +
            `aria-labelledby="updates-tab-${notifFilter}" tabindex="0">` +
            panelHtml() +
          `</div>` +
        `</section>`;

      wirePushAsk(renderUpdates);

      const panel = view.querySelector('#updates-panel');
      const tablist = view.querySelector('#updates-tabs');
      wirePanelFull(panel);

      wireSegTabs(tablist, NOTIF_FILTERS, () => notifFilter, (key) => {
        notifFilter = key;
        panel.setAttribute('aria-labelledby', 'updates-tab-' + key);
        panel.innerHTML = panelHtml();
        wirePanelFull(panel);
      });
    }

    // Already on Updates: reconcile the panel in place instead of tearing the
    // whole view down and replaying it. A background refresh (refreshWorld) often
    // fires for a change that isn't even on this page — a like on some post you
    // aren't looking at — and a full rebuild would replay the masthead, the tab
    // thumb, and every row's entrance: the "why did it reload" flicker the feed
    // already avoids. So keep unchanged rows (and their loaded avatars) put, rise
    // in only genuinely new ones, and drop those that left.
    function reconcile(panel) {
      const tmp = document.createElement('div');
      tmp.innerHTML = panelHtml();

      // Requests block — rare and actionable, so reconcile it whole by signature.
      const liveReq = panel.querySelector('.requests');
      const wantReq = tmp.querySelector('.requests');
      if (wantReq && !liveReq) {
        panel.insertBefore(wantReq, panel.firstChild);
        wireRequests(wantReq);
        wantReq.querySelectorAll('.request-row').forEach((el, i) => { el.style.animationDelay = staggerDelay(i); });
      } else if (liveReq && !wantReq) {
        liveReq.remove();
      } else if (liveReq && wantReq && liveReq.outerHTML !== wantReq.outerHTML) {
        wireRequests(wantReq);
        liveReq.replaceWith(wantReq);
      }

      // Empty state (mutually exclusive with the ledger list).
      const liveEmpty = panel.querySelector('.feed-empty');
      const wantEmpty = tmp.querySelector('.feed-empty');
      if (wantEmpty && !liveEmpty) {
        panel.querySelector('.notif-list')?.remove();
        panel.appendChild(wantEmpty);
      } else if (liveEmpty && !wantEmpty) {
        liveEmpty.remove();
      } else if (liveEmpty && wantEmpty && liveEmpty.outerHTML !== wantEmpty.outerHTML) {
        liveEmpty.replaceWith(wantEmpty);
      }

      // Ledger — key-matched row reconcile (see makeCard's feed reconcile).
      const liveList = panel.querySelector('.notif-list');
      const wantList = tmp.querySelector('.notif-list');
      if (!wantList) { liveList?.remove(); return; }
      if (!liveList) {
        panel.appendChild(wantList);
        wantList.querySelectorAll('.notif').forEach(wireNotif);
        wantList.querySelectorAll('.notif').forEach((el, i) => { el.style.animationDelay = staggerDelay(i); });
        return;
      }
      const norm = s => s.replace(' notif--new', '');   // freshness alone isn't a content change
      const wantLis = Array.from(wantList.children);
      const wantKeys = new Set(wantLis.map(li => li.dataset.key));
      Array.from(liveList.children).forEach(li => { if (!wantKeys.has(li.dataset.key)) li.remove(); });
      const liveByKey = new Map(Array.from(liveList.children).map(li => [li.dataset.key, li]));
      wantLis.forEach((want, i) => {
        let node = liveByKey.get(want.dataset.key);
        if (node) {
          if (norm(node.innerHTML) !== norm(want.innerHTML)) {
            // content genuinely changed (an edited post's label) — swap, no rise
            const a = want.querySelector('.notif');
            if (a) { wireNotif(a); a.style.animation = 'none'; }
            node.replaceWith(want);
            node = want;
          } else {
            // same row — just clear the "new" dot if this visit has now seen it,
            // keeping the live node (and its already-decoded avatar) in place
            const fresh = !!want.querySelector('.notif')?.classList.contains('notif--new');
            node.querySelector('.notif')?.classList.toggle('notif--new', fresh);
          }
        } else {
          const a = want.querySelector('.notif');   // brand-new — rise it in
          if (a) { wireNotif(a); a.style.animationDelay = staggerDelay(i); }
          node = want;
        }
        const ref = liveList.children[i] || null;
        if (node !== ref) liveList.insertBefore(node, ref);
      });
    }

    // Reconcile only when Updates is already mounted AND the push pre-prompt
    // isn't appearing/vanishing (its dismiss + turn-on lean on a full rebuild to
    // drop the card); otherwise mount fresh.
    const livePanel = view.querySelector('#updates-panel');
    const canReconcile = livePanel && view.querySelector('#updates-tabs')
      && (!!view.querySelector('.push-ask') === !!pushAskHtml());
    if (canReconcile) reconcile(livePanel); else mount();

    // Everything has now been seen (a visit counts even under a filter) —
    // next visit, the dots move on.
    if (all.length && all[0]._ts) localStorage.setItem(notifSeenKey(), all[0]._ts);
  }

  /* ── Publish (composer) ───────────────────────────────────────────────────
     One form, three types. The type picker reuses the home filter chips (same
     colored language); the fields below swap per type. Photos get a real upload,
     shown and posted at their native aspect ratio (no crop). On publish we route
     home so the new entry animates in at the top of the feed. */
  const PUB_TYPES = [
    { key: 'note',     label: 'Note'     },
    { key: 'find',     label: 'Find'     },
    { key: 'photo',    label: 'Frame'    },
    { key: 'activity', label: 'Activity' },
  ];
  // The composer has two groups (see PUB_GROUPS): Post and Activity, chosen by a
  // seg-tab switcher. Within Post, the real type is INFERRED, not picked — attach a
  // link and it's a Find, a photo and it's a Frame, otherwise a Note. `pubGroup` is
  // the switcher's value; `pubType` is the inferred/active type the data layer + the
  // masthead mark + the bottom colour-wash read. Activity fixes pubType='activity'.
  let pubGroup = 'post';
  let pubType = 'note';
  let cropper = null;        // set once a still is captured/picked; .export() → data-URI
  let videoCapture = null;   // set once a video is captured/picked; { blob, mimeType, ext, poster, tint, dims }
  let stopActiveCapture = null;   // teardown for the live camera/mic (getUserMedia or native preview)
  let onCaptureChange = null;     // set by the Post composer so the type indicator re-reads when a frame lands/clears
  let justPostedId = null;   // id of a just-published post → sparkle it in when the feed next paints

  // Audience targeting for activities. mode 'circle' = everyone in your circle
  // (default, unchanged behaviour); 'list' = only the chosen usernames, enforced
  // server-side by RLS (posts.audience + the post_audience allowlist).
  let pubAudience = { mode: 'circle', users: [] };
  const audienceCountLabel = (n) =>
    n === 0 ? 'Choose people' : n === 1 ? '1 person' : `${n} people`;

  // A rotating cast of example tags for the composer's Tags placeholder — two
  // picked at random each time the field mounts, so it never goes stale.
  const TAG_PLACEHOLDERS = [
    'garden', 'clay', 'vinyl', 'sourdough', 'thrifted',
    'group chat', 'road trip', 'gremlin era', 'reading nook',
    'review', 'hobbies', 'gaming', 'painting',
    'villain arc', 'delulu era', 'small dog energy', 'chaotic good',
    'girl dinner', '3am thoughts',
    'meal prep', 'farmers market', 'polaroids',
    'houseplants', 'sports', 'side quest', 'npc moment',
  ];
  const randomTagPlaceholder = () => {
    const pool = [...TAG_PLACEHOLDERS];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, 2).join(', ');
  };

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

  // A URL inside a Note renders as plain text (notes don't linkify, on purpose)
  // — links belong to Finds, where the destination gets a real home. The
  // composer watches for one and offers the switch (see wireFindNudge).
  const NOTE_URL_RE = /(https?:\/\/\S+|\bwww\.\S+)/i;

  // The photo/video capture surface. On Frame the field reveals a plain upload
  // dropzone (a visible, labelled field like every other one — more discoverable
  // than a chip that silently pops the OS picker); tapping it opens the picker.
  // A picked still previews at native aspect; a picked clip drops into the in-app
  // trim reel, as Frames have always done. wireFrameCapture drives it; the whole
  // thing lives under a .frame-field wrapper the type filter reveals on Frame and
  // folds away when you move off it (clearFrame). The dropzone hides once media
  // lands (the crop/trim preview takes over); "Choose another" swaps the pick.
  function frameFieldHtml() {
    return `<div class="field frame-field" hidden>` +
        `<label for="c-file">Photo or clip</label>` +
        `<input id="c-file" type="file" accept="image/*,video/*" hidden>` +
        // A div, not a <button>: iOS standalone PWAs paint a native pressed-state
        // fill on filled form controls that -webkit-appearance:none doesn't remove
        // (the white tap-flash). A role=button element has no native chrome to
        // paint. Keyboard activation is wired by hand below. Same for #c-replace.
        `<div class="dropzone" id="c-dropzone" role="button" tabindex="0">` +
          svgIcon('image', 'dropzone-ico') +
          `<span class="dropzone-label">Choose a photo or clip</span>` +
        `</div>` +
        `<div class="combo-frame">` +
          `<div class="crop crop--free" id="c-crop" hidden>` +
            `<img id="c-cropimg" alt="" draggable="false">` +
          `</div>` +
          `<div class="trim" id="c-trim" hidden>` +
            `<div class="trim-stage">` +
              `<video class="trim-video" id="c-trimvideo" playsinline muted loop></video>` +
              `<div class="trim-loading" aria-live="polite"><span class="trim-loading-dot"></span>Getting your clip ready</div>` +
              `<button type="button" class="trim-sound" id="c-trimsound" ` +
                `aria-label="Toggle sound" aria-pressed="false">${svgIcon('mute', 'trim-sound-ico')}</button>` +
            `</div>` +
            `<div class="reel-wrap" id="c-reelwrap">` +
              `<div class="reel-ticks" id="c-reelticks" aria-hidden="true"></div>` +
              `<div class="reel" id="c-reel">` +
                `<div class="reel-track" id="c-reeltrack"></div>` +
              `</div>` +
              `<div class="reel-scrim" id="c-reelscriml" aria-hidden="true"></div>` +
              `<div class="reel-scrim" id="c-reelscrimr" aria-hidden="true"></div>` +
              `<div class="reel-frame" id="c-reelframe" role="slider" aria-label="Trim window">` +
                `<span class="reel-handle reel-handle--l" data-edge="l" aria-hidden="true"></span>` +
                `<span class="reel-handle reel-handle--r" data-edge="r" aria-hidden="true"></span>` +
              `</div>` +
              `<div class="reel-playhead" id="c-reelplayhead" aria-hidden="true"></div>` +
            `</div>` +
            `<p class="trim-meta">` +
              `<span class="trim-dur" id="c-trimdur">0.0s</span>` +
              `<span class="trim-hint">Scroll to choose the moment. Drag the ends to set length, up to 10 seconds.</span>` +
            `</p>` +
          `</div>` +
          `<div class="crop-replace" id="c-replace" role="button" tabindex="0" hidden>Choose another</div>` +
        `</div>` +
      `</div>`;
  }

  function fieldsFor(type) {
    const tags =
      `<div class="field">` +
        `<label for="c-tags">Tags</label>` +
        `<input id="c-tags" type="text" autocapitalize="none" ` +
          `placeholder="${randomTagPlaceholder()}">` +
        `<p class="field-hint">Optional · separate with commas.</p>` +
      `</div>`;

    if (type === 'activity') {
      // Headline + details ride in one bordered box, split by a divider — same
      // combo pattern as find and note, so all four types read the same up top.
      return `<div class="field field--combo">` +
          `<input id="c-title" class="combo-title" type="text" maxlength="120" ` +
            `placeholder="Picnic at the park" aria-label="What's the plan?" autofocus>` +
          `<div class="combo-divider" aria-hidden="true"></div>` +
          `<textarea id="c-note" class="combo-note" rows="2" maxlength="180" ` +
            `placeholder="When to show up, what to bring." aria-label="Details"></textarea>` +
        `</div>` +
        `<div class="field">` +
          `<label for="c-location">Where</label>` +
          `<input id="c-location" type="text" maxlength="120" ` +
            `placeholder="Liberty Park, by the pond">` +
        `</div>` +
        `<div class="field">` +
          `<label for="c-date">When</label>` +
          `<div class="when-row">` +
            `<input id="c-date" type="date" placeholder="mm/dd/yyyy">` +
            `<input id="c-time" type="time" aria-label="Time" placeholder="--:-- --">` +
          `</div>` +
          `<p class="field-hint">Optional · dated plans sort by their day.</p>` +
        `</div>` +
        audienceRowHtml() + tags;
    }

    // The unified Post field set, shared by note / find / photo. The Note rich
    // editor is the base (headline + a contenteditable body + the H1/H2/B/I toolbar,
    // 15k). The link row and the frame surface ship hidden; the type filter reveals
    // the one its type needs — Find shows the link row, Frame opens the picker — so
    // the body carries over as you switch among the three (see renderPublish).
    return richNoteField('c', '', '', randomNotePlaceholder()) +
      `<p class="field-hint find-nudge" id="c-find-nudge" hidden>Dropping a link? ` +
        `<button type="button" id="c-make-find">Make it a Find</button></p>` +
      `<div class="field" id="c-link-row" hidden>` +
        `<label for="c-url">Link</label>` +
        `<input id="c-url" type="url" inputmode="url" autocapitalize="none" ` +
          `spellcheck="false" placeholder="https://…">` +
      `</div>` +
      pollFieldHtml() +
      frameFieldHtml() + tags;
  }

  // The poll surface, shipped hidden in the Post field set — revealed when the
  // poll attach toggle is on (which also makes the post a Poll). Just the choices:
  // the QUESTION is the post itself (headline / body), so there's no separate
  // question field. 2 to start, up to 4 via "Add option", each removable down to
  // the minimum two. Flat editorial, like the rest of the composer (never glass).
  const POLL_OPT_PH = ['First choice', 'Second choice', 'Third choice', 'Fourth choice'];
  function pollOptRowHtml(i) {
    return `<div class="poll-opt-row">` +
        `<input class="poll-opt-input" type="text" maxlength="60" ` +
          `aria-label="Choice ${i + 1}" placeholder="${POLL_OPT_PH[i] || 'Choice'}">` +
        `<button type="button" class="poll-opt-remove" aria-label="Remove choice ${i + 1}">` +
          `${svgIcon('close', 'poll-opt-remove-ico')}</button>` +
      `</div>`;
  }
  function pollFieldHtml() {
    return `<div class="field poll-field" id="c-poll-row" hidden>` +
        `<label>Poll choices</label>` +
        `<div class="poll-opts" id="c-poll-opts">` +
          pollOptRowHtml(0) +
          pollOptRowHtml(1) +
        `</div>` +
        `<button type="button" class="poll-add-opt" id="c-poll-add">Add option</button>` +
        `<p class="field-hint">2 to 4 choices. Closes a day after you post it.</p>` +
      `</div>`;
  }

  // ── Audience picker (design preview) ──────────────────────────────────────
  // A settings-style disclosure row under the activity fields: label left, the
  // current audience + a chevron right. Tapping opens a glass sheet to switch
  // between the whole circle and a hand-picked list (reuses the friend rows and
  // the mention/tagging model). Demo-gated until the backend lands.
  function audienceRowHtml() {
    const val = pubAudience.mode === 'circle'
      ? 'Everyone in your circle'
      : audienceCountLabel(pubAudience.users.length);
    return `<div class="field">` +
        `<button type="button" class="audience-row" id="c-audience">` +
          `<span class="audience-row-key">Shared with</span>` +
          `<span class="audience-row-val" id="c-audience-val">${esc(val)}` +
            `<span class="audience-row-chev" aria-hidden="true"></span></span>` +
        `</button>` +
        `<p class="field-hint">Everyone in your circle can see this, or pick a few.</p>` +
      `</div>`;
  }
  function wireAudienceRow(root) {
    const btn = root.querySelector('#c-audience');
    if (btn) btn.addEventListener('click', () => openAudienceSheet(root));
  }
  function openAudienceSheet(root) {
    const friends = Store.friends().map(n => Store.user(n)).filter(Boolean)
      .sort((a, b) => (a.name || a.username).localeCompare(b.name || b.username));
    const chosen = new Set(pubAudience.users);
    let mode = pubAudience.mode;

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Who can see this');

    const pickRows = friends.map((f, i) =>
      `<button type="button" class="aud-pick" role="checkbox" data-user="${esc(f.username)}" ` +
        `aria-checked="${chosen.has(f.username)}" style="animation-delay:${staggerDelay(i)}">` +
        avatarEl(f, { cls: 'aud-avatar' }) +
        `<span class="friend-text">` +
          `<span class="friend-name">${esc(f.name)}</span>` +
          `<span class="friend-user">@${esc(f.username)}</span>` +
        `</span>` +
        `<span class="aud-check" aria-hidden="true"></span>` +
      `</button>`).join('');

    const modeBtn = (m, t, d) =>
      `<button type="button" class="aud-mode" data-mode="${m}" aria-pressed="${mode === m}">` +
        `<span class="aud-mode-t">${t}</span><span class="aud-mode-d">${d}</span>` +
        `<span class="aud-mode-tick" aria-hidden="true"></span>` +
      `</button>`;

    modal.innerHTML =
      `<div class="modal-card modal-card--glass modal-card--list">` +
        `<h2 class="modal-title">Who can see this?</h2>` +
        `<div class="aud-modes">` +
          modeBtn('circle', 'Everyone in your circle', 'All your mutual friends') +
          modeBtn('list', 'Choose people', 'Only who you pick') +
        `</div>` +
        `<div class="aud-list-wrap${mode === 'list' ? ' is-open' : ''}">` +
          `<div class="aud-list friends-list--modal">` +
            (pickRows || `<p class="aud-empty">Add some friends first.</p>`) +
          `</div>` +
        `</div>` +
        `<div class="modal-actions">` +
          `<button type="button" class="composer-submit" id="aud-done">Done</button>` +
        `</div>` +
      `</div>`;
    document.body.appendChild(modal);
    document.body.style.overflow = 'hidden';

    const listWrap = modal.querySelector('.aud-list-wrap');
    const close = modalCloser(modal, () => document.removeEventListener('keydown', onEsc));
    const onEsc = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onEsc);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

    modal.querySelectorAll('.aud-mode').forEach(b =>
      b.addEventListener('click', () => {
        mode = b.dataset.mode;
        modal.querySelectorAll('.aud-mode').forEach(x =>
          x.setAttribute('aria-pressed', String(x.dataset.mode === mode)));
        // Expand/collapse the checklist (grid-rows glide, matching the About folds);
        // re-stamp the row stagger so they cascade in fresh each time it opens.
        listWrap.classList.toggle('is-open', mode === 'list');
        if (mode === 'list') {
          modal.querySelectorAll('.aud-pick').forEach((row, i) => {
            row.style.animation = 'none';
            void row.offsetWidth;                 // reflow so the restart takes
            row.style.animation = '';
            row.style.animationDelay = staggerDelay(i);
          });
        }
      }));

    modal.querySelectorAll('.aud-pick').forEach(b =>
      b.addEventListener('click', () => {
        const u = b.dataset.user;
        if (chosen.has(u)) chosen.delete(u); else chosen.add(u);
        b.setAttribute('aria-checked', String(chosen.has(u)));
      }));

    modal.querySelector('#aud-done').addEventListener('click', () => {
      // Picking nobody in "Choose people" is really the whole circle again.
      const users = [...chosen];
      pubAudience = (mode === 'list' && users.length)
        ? { mode: 'list', users }
        : { mode: 'circle', users: [] };
      const valEl = root.querySelector('#c-audience-val');
      if (valEl) {
        valEl.textContent = pubAudience.mode === 'circle'
          ? 'Everyone in your circle'
          : audienceCountLabel(pubAudience.users.length);
        valEl.insertAdjacentHTML('beforeend', `<span class="audience-row-chev" aria-hidden="true"></span>`);
      }
      close();
    });
  }

  // The reactive type mark that rides the "New post" masthead (same slot the
  // Friends search uses). It mirrors the active type filter — note / find → Find /
  // photo → Frame / activity — and pops when it flips (see paintIndicator).
  function typeIndicatorHtml() {
    return `<span class="type-indicator type-icon type-icon--${pubType}" id="c-type-ind" ` +
      `role="img" aria-label="${TYPE_LABEL[pubType]}">${TYPE_ICON[pubType]}</span>`;
  }

  function renderPublish() {
    // The composer never persists a draft across navigations, so every entry opens
    // fresh on the Post group (a plain Note until something's attached).
    pubGroup = 'post';
    pubType = 'note';
    // The reactive colour lives full-screen now: the page ambient wash adopts the
    // inferred type's hue (see body[data-ambient="publish"] .ambient), keyed off
    // --glow-pub which syncType keeps in step. Set it before the wash fades in so
    // it opens on the right colour rather than tweening up from the default.
    document.body.dataset.ambient = 'publish';
    document.body.style.setProperty('--glow-pub', TYPE_HEX[pubType]);
    view.innerHTML =
      `<section class="view">` +
        mastheadEl('Share to your circle', 'New post', typeIndicatorHtml()) +
        `<form class="composer" id="composer" novalidate>` +
          // The Post / Activity switcher sits inline just above the note field (not
          // docked to the nav like the Friends / Updates one — see #c-group-tabs).
          // Neutral (no brand glow): colour is carried by the full-screen wash.
          segTabsEl('c-group', PUB_GROUPS, pubGroup,
            { glow: false, label: 'What are you posting', panelId: 'c-fields' }) +
          `<div class="fields" id="c-fields"></div>` +
          `<p class="composer-error" id="c-error" role="alert"></p>` +
          `<div class="post-progress" id="c-progress" aria-live="polite">` +
            `<span class="post-progress-label" id="c-progress-label"></span>` +
            `<div class="post-progress-track"><div class="post-progress-fill" id="c-progress-fill"></div></div>` +
          `</div>` +
          `<button class="composer-submit composer-post publish-fill is-solid" type="submit">Share</button>` +
        `</form>` +
      `</section>`;

    const fieldsEl = view.querySelector('#c-fields');
    let family = null;              // 'base' (the unified Post form) | 'activity'
    let lastIndType = null;         // last type the mark showed, so it only pops on a real change
    let wantLink = false;           // link row open → this Post is a Find
    let wantPhoto = false;          // frame surface open → this Post is a Frame
    let wantPoll = false;           // poll surface open → this Post is a Poll

    // Within the Post group the type is INFERRED from what's attached: a photo wins
    // (strongest visual), then a poll, then a link, else a plain Note. The three
    // attachments are mutually exclusive (opening one folds the others), so at most
    // one is ever active. Activity fixes itself.
    function derivePostType() {
      if (wantPhoto || cropper || videoCapture) return 'photo';
      if (wantPoll) return 'poll';
      const url = fieldsEl.querySelector('#c-url');
      if (wantLink || (url && url.value.trim())) return 'find';
      return 'note';
    }

    // Re-infer the active type, then reflect it: pop the masthead mark, shift the
    // bottom colour-wash to the type's hue, and light the matching attach button.
    function syncType() {
      pubType = pubGroup === 'activity' ? 'activity' : derivePostType();
      const ind = document.getElementById('c-type-ind');
      if (ind && pubType !== lastIndType) {
        lastIndType = pubType;
        ind.className = `type-indicator type-icon type-icon--${pubType}`;
        ind.setAttribute('aria-label', TYPE_LABEL[pubType] || pubType);
        ind.innerHTML = TYPE_ICON[pubType] || '';
        ind.classList.remove('is-changing');
        void ind.offsetWidth;                // restart the pop
        ind.classList.add('is-changing');
      }
      // Full-screen ambient wash adopts the inferred hue; registered --glow-pub
      // tweens the colour (see the publish .ambient rule).
      document.body.style.setProperty('--glow-pub', TYPE_HEX[pubType] || TYPE_HEX.note);
      fieldsEl.querySelector('#c-add-link')?.setAttribute('aria-pressed', String(pubType === 'find'));
      fieldsEl.querySelector('#c-add-photo')?.setAttribute('aria-pressed', String(pubType === 'photo'));
      fieldsEl.querySelector('#c-add-poll')?.setAttribute('aria-pressed', String(pubType === 'poll'));
    }

    // Drop any attached photo/clip and fold the frame surface away. Also resets the
    // dropzone back to visible so a later re-open shows the upload field.
    function clearFrame() {
      if (stopActiveCapture) { stopActiveCapture(); stopActiveCapture = null; }
      cropper = null; videoCapture = null;
      fieldsEl.querySelector('#c-crop')?.setAttribute('hidden', '');
      fieldsEl.querySelector('#c-trim')?.setAttribute('hidden', '');
      fieldsEl.querySelector('#c-replace')?.setAttribute('hidden', '');
      fieldsEl.querySelector('#c-dropzone')?.removeAttribute('hidden');
      const file = fieldsEl.querySelector('#c-file'); if (file) file.value = '';
      fieldsEl.querySelector('.frame-field')?.setAttribute('hidden', '');
      const b = view.querySelector('.composer-submit'); if (b) b.disabled = false;
    }

    // Show the surfaces the attach toggles asked for: the link row when wantLink,
    // the frame field when wantPhoto. Both ship hidden; the body carries throughout.
    function applyBaseSurface() {
      if (family !== 'base') return;
      const linkRow = fieldsEl.querySelector('#c-link-row');
      if (linkRow) linkRow.hidden = !wantLink;
      const frameField = fieldsEl.querySelector('.frame-field');
      if (frameField) frameField.hidden = !wantPhoto;
      const pollRow = fieldsEl.querySelector('#c-poll-row');
      if (pollRow) pollRow.hidden = !wantPoll;
    }

    function mountFields() {
      // Leaving a live camera/mic stream running behind a torn-down capture surface
      // would keep recording (and draining battery) after a re-mount — always stop
      // it before replacing the DOM.
      if (stopActiveCapture) { stopActiveCapture(); stopActiveCapture = null; }
      cropper = null;
      videoCapture = null;
      onCaptureChange = null;
      wantLink = false;
      wantPhoto = false;
      wantPoll = false;
      pubAudience = { mode: 'circle', users: [] };   // each fresh composer defaults to the full circle
      const submitBtn = view.querySelector('.composer-submit');
      if (submitBtn) submitBtn.disabled = false;
      family = pubGroup === 'activity' ? 'activity' : 'base';
      fieldsEl.innerHTML = fieldsFor(family === 'activity' ? 'activity' : 'post');
      const cNote = fieldsEl.querySelector('#c-note');
      wireMentions(cNote);
      if (family === 'activity') {
        wireWhenHints(fieldsEl);
        wireLocationSuggest(fieldsEl.querySelector('#c-location'));
        wireAudienceRow(fieldsEl);
      } else {
        wireRichEditor(cNote, fieldsEl.querySelector('#c-note-count'));
        wireFrameCapture(fieldsEl);        // the frame surface ships hidden in the Post field set
        wireFindNudge();
        wireAttachBar();
        onCaptureChange = () => syncType();   // a frame landing/clearing re-infers the type
      }
      applyBaseSurface();
    }

    // Switch top-level group (Post ⇄ Activity). Each crossing re-mounts the field
    // set (they share nothing structurally) and resets to a fresh, plain form.
    function selectGroup(key) {
      if (key === pubGroup) return;
      pubGroup = key;
      document.getElementById('c-error').textContent = '';
      mountFields();
      syncType();
    }

    // The two attach toggles at the note field's foot. Link opens the link row (and
    // makes it a Find); Photo opens the frame field and pops the OS picker (a Frame).
    // Both are live toggles: tap again to fold the surface and revert the type.
    function wireAttachBar() {
      const linkBtn  = fieldsEl.querySelector('#c-add-link');
      const photoBtn = fieldsEl.querySelector('#c-add-photo');
      const pollBtn  = fieldsEl.querySelector('#c-add-poll');
      // The three attachments are one-at-a-time: turning one on folds the others so
      // the inferred type is never ambiguous. Photo owns a live picker/capture, so
      // clearing it routes through clearFrame (stops any stream); link + poll just
      // fold their rows (leaving typed content, so a mis-tap doesn't wipe it).
      const foldPhoto = () => { if (wantPhoto) { wantPhoto = false; clearFrame(); } };
      const foldLink  = () => { wantLink = false; };
      const foldPoll  = () => { wantPoll = false; };
      linkBtn?.addEventListener('click', () => {
        wantLink = !wantLink;
        document.getElementById('c-error').textContent = '';
        if (wantLink) { foldPhoto(); foldPoll(); }
        else { const u = fieldsEl.querySelector('#c-url'); if (u) u.value = ''; }
        applyBaseSurface();
        syncType();
      });
      photoBtn?.addEventListener('click', () => {
        const opening = !wantPhoto;
        wantPhoto = opening;
        document.getElementById('c-error').textContent = '';
        if (opening) {
          foldLink(); foldPoll();
          applyBaseSurface();                          // reveal the frame field first
          fieldsEl.querySelector('#c-file')?.click();  // then pop the picker
        } else {
          clearFrame();                                // drop any media + fold it away
        }
        syncType();
      });
      pollBtn?.addEventListener('click', () => {
        wantPoll = !wantPoll;
        document.getElementById('c-error').textContent = '';
        if (wantPoll) { foldPhoto(); foldLink(); }
        applyBaseSurface();
        syncType();
      });
      wirePollOpts();
    }

    // The choice list: grow from 2 up to 4 ("Add option", which hides at 4), and
    // remove any row back down to the minimum 2 (the × hides when only two remain,
    // so a poll can never drop below a real choice). After either, renumber the
    // rows so aria-labels + placeholders stay in order.
    function wirePollOpts() {
      const addBtn = fieldsEl.querySelector('#c-poll-add');
      const opts = fieldsEl.querySelector('#c-poll-opts');
      if (!addBtn || !opts) return;
      const rows = () => opts.querySelectorAll('.poll-opt-row');
      const renumber = () => {
        rows().forEach((row, i) => {
          const input = row.querySelector('.poll-opt-input');
          input.setAttribute('aria-label', `Choice ${i + 1}`);
          input.placeholder = POLL_OPT_PH[i] || 'Choice';
          row.querySelector('.poll-opt-remove')?.setAttribute('aria-label', `Remove choice ${i + 1}`);
        });
        const n = rows().length;
        addBtn.hidden = n >= 4;
        opts.classList.toggle('is-min', n <= 2);   // CSS hides the × at the floor
      };
      addBtn.addEventListener('click', () => {
        if (rows().length >= 4) return;
        opts.insertAdjacentHTML('beforeend', pollOptRowHtml(rows().length));
        renumber();
        opts.querySelector('.poll-opt-row:last-child .poll-opt-input')?.focus();
      });
      // Delegate removal — rows come and go, so listen on the container.
      opts.addEventListener('click', (e) => {
        const btn = e.target.closest('.poll-opt-remove');
        if (!btn || rows().length <= 2) return;
        btn.closest('.poll-opt-row')?.remove();
        renumber();
      });
      renumber();
    }

    // The Note body's link sense: a URL typed straight into the body offers to lift
    // it into the link field and make the post a Find, instead of leaving the link
    // buried in prose. One quiet promotion, nothing retyped.
    function wireFindNudge() {
      const editor  = fieldsEl.querySelector('#c-note');
      const nudge   = fieldsEl.querySelector('#c-find-nudge');
      if (!editor || !nudge) return;
      const sync = () => {
        const url = fieldsEl.querySelector('#c-url');
        nudge.hidden = pubType !== 'note' || !NOTE_URL_RE.test(editor.textContent) || !!(url && url.value.trim());
      };
      editor.addEventListener('input', sync);
      sync();
      nudge.querySelector('#c-make-find').addEventListener('click', () => {
        // innerText keeps the block breaks textContent would swallow, so the
        // leftover words don't run together once the URL is lifted out.
        const text = editor.innerText || editor.textContent;
        const m = NOTE_URL_RE.exec(text);
        // Trim trailing sentence punctuation off the captured URL ("…x.com."),
        // and give a bare www. link the scheme the Find field validates for.
        const raw = m ? m[0].replace(/[),.;!?]+$/, '') : '';
        const link = raw.startsWith('www.') ? 'https://' + raw : raw;
        if (m) editor.textContent = text.replace(m[0], ' ').replace(/[ \t]{2,}/g, ' ').trim();
        wantLink = true;
        applyBaseSurface();               // reveals the link row
        const url = fieldsEl.querySelector('#c-url');
        if (url) { url.value = link; url.focus(); }
        syncType();
        nudge.hidden = true;
      });
    }

    const groupTabs = view.querySelector('#c-group-tabs');
    if (groupTabs) wireSegTabs(groupTabs, PUB_GROUPS, () => pubGroup, selectGroup);

    document.getElementById('composer').addEventListener('submit', (e) => {
      e.preventDefault();
      submitComposer();
    });

    // Mount the group we arrived on (default Post), then reflect its inferred type.
    mountFields();
    syncType();
  }

  // The Frame capture surface: a plain file picker (photo or video). A picked
  // photo previews at its native aspect (no crop); a picked video drops into the
  // in-app trim surface, where you pick the ≤10s window to keep. The cut/re-encode
  // happens once, on Post (see submitComposer).
  const MAX_CLIP_SEC = 10;                              // the published clip cap — the trimmer enforces it
  const MAX_SOURCE_SEC = 180;                          // longest source we accept (Tria trims it down to ≤10s)
  const TRIM_MIN_SEC = 1;                               // shortest window you can drag to
  // The upload ceiling: the Storage `media` bucket's file_size_limit (150 MB). We
  // upload the ORIGINAL clip (no in-browser re-encode — that real-time re-encode is
  // what stripped audio on iOS Safari, a WebKit MediaRecorder+WebAudio bug), so a
  // trim is stored as a play-window, not a cut. This is therefore the real gate:
  // anything over it can't post. Caught on the client, at pick time and pre-upload,
  // with copy that says what to do — not a generic server error.
  const MAX_UPLOAD_BYTES = 150 * 1024 * 1024;

  function wireFrameCapture(root) {
    const file     = root.querySelector('#c-file');
    const frameField = root.querySelector('.frame-field');
    const dropzone = root.querySelector('#c-dropzone');
    const cropEl   = root.querySelector('#c-crop');
    const imgEl    = root.querySelector('#c-cropimg');
    const trimEl     = root.querySelector('#c-trim');
    const trimVideo  = root.querySelector('#c-trimvideo');
    const trimSound  = root.querySelector('#c-trimsound');
    const reel       = root.querySelector('#c-reel');
    const reelTrack  = root.querySelector('#c-reeltrack');
    const reelTicks  = root.querySelector('#c-reelticks');
    const reelFrame  = root.querySelector('#c-reelframe');
    const reelScrimL = root.querySelector('#c-reelscriml');
    const reelScrimR = root.querySelector('#c-reelscrimr');
    const reelPlay   = root.querySelector('#c-reelplayhead');
    const trimDur    = root.querySelector('#c-trimdur');
    const replace  = root.querySelector('#c-replace');
    const errEl    = () => document.getElementById('c-error');

    // Put a pick rejection where it can't be missed. iOS holds the user in the
    // Photos sheet while it exports the pick (we're not even running yet), so by
    // the time we can say anything they've been staring elsewhere for a while —
    // scroll the message into view the moment control returns.
    function showPickError(msg) {
      const err = errEl();
      if (!err) return;
      err.textContent = msg;
      const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      try { err.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' }); } catch {}
    }

    // Reel state — tD = full clip duration; [tStart,tEnd] = the selected ≤10s window;
    // selLen = its length; PPS = pixels-per-second zoom; lead = constant side padding
    // (half the initial frame) so the frame's edges sit flush with the clip at both
    // scroll extremes; frameW0 = the initial frame width; vw = the reel's on-screen
    // width. Everything visible derives from reel.scrollLeft + selLen. cells[] are the
    // thumbnail tiles. All hoisted so the listeners wired once below read live values;
    // finishVideo/buildReel reset them per clip. tPlaying gates the playback loop.
    let tD = 0, tStart = 0, tEnd = 0, selLen = 0, PPS = 0, lead = 0, frameW0 = 0, vw = 0;
    let tPlaying = false, dragging = null, cells = [];
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

    // Switching post type (or re-mounting) tears this surface down — release the
    // trim clip's object URL so a played preview doesn't leak. mountFields calls
    // this via stopActiveCapture before replacing the DOM.
    function teardown() {
      tPlaying = false;
      try { trimVideo.pause(); } catch {}
      // Drop the source and reload so iOS actually frees the decoder (not just
      // pauses it) — the Post-time re-encode needs that one decoder slot.
      try { trimVideo.removeAttribute('src'); trimVideo.load(); } catch {}
      if (trimVideo._url) { try { URL.revokeObjectURL(trimVideo._url); } catch {} trimVideo._url = null; }
    }
    stopActiveCapture = teardown;

    // Open the OS picker. The upload dropzone and the post-pick "Choose another"
    // button both lead here — one way in, the system does the rest.
    const pick = () => file.click();
    // dropzone + replace are role=button divs (see frameFieldHtml), so wire the
    // keyboard activation a native <button> would give for free.
    const pickKey = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } };
    dropzone.addEventListener('click', pick);
    dropzone.addEventListener('keydown', pickKey);
    replace.addEventListener('click', pick);
    replace.addEventListener('keydown', pickKey);

    file.addEventListener('change', () => {
      const f = file.files && file.files[0];
      if (!f) return;
      if (f.type.startsWith('video/')) handleLibraryVideo(f);
      else {
        const reader = new FileReader();
        reader.onload = () => finishPhoto(reader.result);
        reader.readAsDataURL(f);
      }
    });

    // ── Photo → native-aspect preview ────────────────────────────────────────
    function finishPhoto(dataUrl) {
      if (frameField) frameField.hidden = false;   // the surface appears now the still has landed
      if (dropzone) dropzone.hidden = true;        // the preview takes over from the upload field
      cropEl.hidden = false;
      // Swapping in from a video pick — tear the trim surface down.
      tPlaying = false;
      try { trimVideo.pause(); } catch {}
      trimEl.hidden = true;
      replace.hidden = false;
      videoCapture = null;
      cropper = initPhotoPreview(imgEl, dataUrl);
      onCaptureChange?.();   // a still landed → the Post composer flips its type mark to Frame
      // Hold Post until the preview decodes — export() reads naturalWidth, so
      // posting early would ship a 1x1 canvas. Re-enable on load (or straight away
      // if the browser already had it decoded).
      const submitBtn = document.querySelector('.composer-submit');
      if (submitBtn) {
        submitBtn.disabled = true;
        const ready = () => { submitBtn.disabled = false; };
        if (imgEl.complete && imgEl.naturalWidth) ready();
        else imgEl.addEventListener('load', ready, { once: true });
      }
    }

    // ── Video → trim reel ────────────────────────────────────────────────────
    // A picked clip of any length (≤3 min) lands here. The native <video> loops the
    // selected window as a preview; below it a full-width, horizontally-scrollable
    // thumbnail reel lets you SCROLL to choose the moment and drag the frame's ends
    // to set length (≤10s). videoCapture holds the ORIGINAL blob plus the window; the
    // cut/re-encode happens once, on Post (submitComposer).
    //
    // Thumbnails ARE sampled here — canvas-from-video works on real iOS Safari
    // (confirmed on-device; the old blank preview was the reveal gate, not the draw).
    // Sampling runs behind the loading shimmer so the seeking never shows, and it is
    // best-effort: any black/failed frame just leaves a neutral cell, so the reel
    // still scrubs perfectly even where a device's canvas readback misbehaves. The
    // preview itself is pure native playback (the one thing iOS does reliably).
    async function finishVideo(blob) {
      if (frameField) frameField.hidden = false;   // the surface appears now the clip has landed
      if (dropzone) dropzone.hidden = true;        // the trim surface takes over from the upload field
      cropEl.hidden = true;
      cropper = null;
      trimEl.hidden = false;
      replace.hidden = false;

      const mimeType = blob.type || 'video/mp4';
      const ext = /mp4/i.test(mimeType) ? 'mp4' : /webm/i.test(mimeType) ? 'webm' : 'mov';

      // Reset per-clip state.
      tPlaying = false; dragging = null; tD = 0;
      trimEl.classList.add('trim--loading');   // calm placeholder while metadata reads (heavy 4K/iCloud clips)

      if (trimVideo._url) { try { URL.revokeObjectURL(trimVideo._url); } catch {} }
      const url = URL.createObjectURL(blob);
      trimVideo._url = url;
      trimVideo.muted = true;
      trimSound.setAttribute('aria-pressed', 'false');
      trimSound.innerHTML = svgIcon('mute', 'trim-sound-ico');
      trimVideo.src = url;

      // Metadata (duration + native size) off the preview element itself.
      const meta = await loadClipMeta(trimVideo);
      tD = meta.duration;

      // 3-minute source cap. Tria trims any clip down to ≤10s, but a longer source is
      // a heavier seek + re-encode than we want to promise, so bounce it kindly back
      // to the picker. (Unknown-duration blobs report ≤10s and pass — those are quick
      // MediaRecorder captures, never long library picks.)
      if (meta.known && tD > MAX_SOURCE_SEC) {
        showPickError('That video is longer than 3 minutes. Trim it in Photos first, or pick a shorter one.');
        tPlaying = false;
        try { trimVideo.pause(); trimVideo.removeAttribute('src'); trimVideo.load(); } catch {}
        if (trimVideo._url) { try { URL.revokeObjectURL(trimVideo._url); } catch {} trimVideo._url = null; }
        trimEl.classList.remove('trim--loading');
        trimEl.hidden = true;
        replace.hidden = true;
        videoCapture = null;
        if (dropzone) dropzone.hidden = false;      // no clip landed — restore the upload field
        onCaptureChange?.();                         // unlight the Photo tool + reset the type mark
        return;
      }

      selLen = Math.min(tD, MAX_CLIP_SEC);
      tStart = 0; tEnd = selLen;
      videoCapture = { blob, mimeType, ext, duration: tD, durationKnown: meta.known,
                       start: tStart, end: tEnd, poster: null, tint: null,
                       dims: (meta.w && meta.h) ? { w: meta.w, h: meta.h } : null };
      onCaptureChange?.();   // a clip landed → the Post composer flips its type mark to Frame

      // Build the reel geometry + tiles + ticks, reflect the initial window.
      buildReel(tD, meta.w, meta.h);
      layoutReel();

      // Sample thumbnails off this same element (still hidden behind the shimmer, so
      // the seeking never shows), then cue the window's start, play, and reveal on a
      // genuine moving frame. A guard drops the loading state regardless, so a clip
      // that refuses muted autoplay still shows its first frame.
      await sampleThumbs();
      tPlaying = true;
      scrubTo(tStart);
      const reveal = () => trimEl.classList.remove('trim--loading');
      trimVideo.addEventListener('playing', reveal, { once: true });
      trimVideo.addEventListener('canplay', reveal, { once: true });
      setTimeout(reveal, 1200);
      trimVideo.play().catch(reveal);
    }

    // Build the reel for a freshly-loaded clip. Reads the reel's on-screen width NOW
    // (it's visible), lays out a constant-padding track wide enough to scroll the
    // whole clip under the centered frame, tiles empty thumbnail cells + time ticks,
    // and parks the scroll at the start. sampleThumbs fills the cells afterward.
    function buildReel(duration, w, h) {
      vw = reel.clientWidth || 340;
      selLen = Math.min(MAX_CLIP_SEC, duration);
      // Aim the initial window at ~62% of the viewport width.
      PPS = clamp((vw * 0.62) / Math.max(0.1, selLen), 8, 120);
      frameW0 = selLen * PPS;
      // Side padding = half the initial frame, held constant, so the frame's edges
      // sit flush with the clip at both scroll extremes (no dead space) and the tiles
      // never reflow when the window is resized.
      lead = (vw - frameW0) / 2;
      const trackW = lead * 2 + duration * PPS;
      reelTrack.style.width = trackW + 'px';
      reelTrack.innerHTML = '';
      reelTicks.innerHTML = '';
      reel.scrollLeft = 0;

      // Thumbnail tiles — one every ~thumbW px, capped so sampling stays quick even
      // on a 3-minute source.
      const ar = (w && h) ? w / h : 16 / 9;
      const thumbW = Math.max(34, Math.round(60 * ar));
      const count = clamp(Math.ceil(duration * PPS / thumbW), 4, 16);
      const cellW = duration * PPS / count;
      cells = [];
      for (let i = 0; i < count; i++) {
        const cell = document.createElement('div');
        cell.className = 'reel-thumb';
        cell.style.left = (lead + i * cellW) + 'px';
        cell.style.width = Math.ceil(cellW) + 'px';
        reelTrack.appendChild(cell);
        cells.push(cell);
      }

      // Time ticks, labelled at the clip's real seconds, scrolling with the reel.
      const step = duration <= 20 ? 5 : duration <= 60 ? 15 : 30;
      for (let t = 0; t <= duration + 0.01; t += step) {
        const el = document.createElement('span');
        el.className = 'reel-tick';
        el.textContent = tickLabel(t);
        el.style.left = (lead + t * PPS) + 'px';
        reelTicks.appendChild(el);
      }
    }

    // Fill the tiles with real frames sampled off the preview element. Best-effort: a
    // black/failed draw leaves the cell neutral (the reel still scrubs), so a device
    // where canvas-from-video misbehaves degrades to a plain bar rather than breaking.
    async function sampleThumbs() {
      if (!cells.length) return;
      const w = trimVideo.videoWidth || 16, h = trimVideo.videoHeight || 9;
      const th = 120, tw = Math.max(1, Math.round(th * w / h));
      // iOS WebKit draws a never-played <video> to canvas as TRANSPARENT — the
      // element has to present a real frame before seek-and-draw lands pixels.
      // Prime it with a brief muted play (allowed without a gesture; we're still
      // behind the shimmer), then sample paused.
      try {
        await trimVideo.play();
        await new Promise((res) => {
          const tm = setTimeout(res, 350);
          if (typeof trimVideo.requestVideoFrameCallback === 'function')
            trimVideo.requestVideoFrameCallback(() => { clearTimeout(tm); res(); });
        });
      } catch {}
      trimVideo.pause();
      for (let i = 0; i < cells.length; i++) {
        const t = Math.min((i + 0.5) * tD / cells.length, Math.max(0, tD - 0.05));
        await seekPaint(trimVideo, t, 900);
        try {
          const c = document.createElement('canvas'); c.width = tw; c.height = th;
          const g = c.getContext('2d');
          g.drawImage(trimVideo, 0, 0, tw, th);
          // A failed WebKit draw leaves the canvas transparent, which a JPEG data
          // URL would flatten to a solid black tile — so gate on ALPHA, not
          // colour. Checking colour here would also throw away genuinely dark
          // frames (night clips, letterboxed edges), which is why the reel could
          // come up all-neutral on iPhone.
          const px = g.getImageData(tw >> 1, th >> 1, 1, 1).data;
          if (px[3]) cells[i].style.backgroundImage = `url(${c.toDataURL('image/jpeg', 0.7)})`;
        } catch {}
      }
    }

    // Derive [tStart,tEnd] from the current scroll + selLen, and reflect it onto the
    // frame width, the dimming scrims, the ticks, the duration pill, and videoCapture
    // (so Post always cuts the currently-shown selection). The frame is CSS-centered;
    // everything else is positioned to line up with it.
    function layoutReel() {
      if (!tD) return;
      const centerTime = (reel.scrollLeft + frameW0 / 2) / PPS;
      tStart = clamp(centerTime - selLen / 2, 0, Math.max(0, tD - selLen));
      tEnd = Math.min(tD, tStart + selLen);
      const frameW = selLen * PPS;
      const frameLeft = (vw - frameW) / 2;
      reelFrame.style.width = frameW + 'px';
      reelScrimL.style.left = '0'; reelScrimL.style.width = Math.max(0, frameLeft) + 'px';
      reelScrimR.style.left = (frameLeft + frameW) + 'px';
      reelScrimR.style.width = Math.max(0, vw - frameLeft - frameW) + 'px';
      trimDur.textContent = fmtClip(tEnd - tStart);
      reelFrame.setAttribute('aria-valuetext',
        `${fmtClip(tEnd - tStart)} selected, from ${fmtClip(tStart)} to ${fmtClip(tEnd)}`);
      // Ticks ride with the reel (they live in a non-scrolling strip).
      const sx = reel.scrollLeft;
      for (const el of reelTicks.children) el.style.transform = `translateX(calc(-50% - ${sx}px))`;
      if (videoCapture) { videoCapture.start = tStart; videoCapture.end = tEnd; }
    }

    // Move the preview to time t and reposition the playhead (used by scroll, drag,
    // and the loop reset).
    const scrubTo = (t) => { try { trimVideo.currentTime = t; } catch {} positionPlayhead(); };
    // The playhead lives inside the fixed centered frame, tracking the fraction of
    // the way through the selected window.
    const positionPlayhead = () => {
      if (!tD || !selLen) return;
      const f = clamp((trimVideo.currentTime - tStart) / selLen, 0, 1);
      const frameW = selLen * PPS, frameLeft = (vw - frameW) / 2;
      reelPlay.style.left = (frameLeft + f * frameW) + 'px';
    };

    // Scroll the reel → move the window through the clip (the frame stays centered).
    // Scrubbing the preview live as you scroll gives the "scroll through the video"
    // feel. Gated on tPlaying so the programmatic scrollLeft reset in buildReel (and
    // any scroll before a clip is loaded) doesn't scrub.
    reel.addEventListener('scroll', () => {
      if (dragging || !tPlaying) return;
      layoutReel();
      scrubTo(tStart);
    });

    // Loop preview playback inside [tStart,tEnd]; the playhead tracks position inside
    // the frame. Driven per-frame off rAF — not `timeupdate` (only ~4x/sec, the clip
    // would visibly overrun tEnd before looping) and not requestVideoFrameCallback,
    // which iOS WebKit stalls (same lesson as the re-encode draw loop): a stalled
    // tick means nothing clamps playback to the window, so the looping preview
    // drifts off the trimmer's selection entirely.
    const previewTick = () => {
      if (!trimVideo.isConnected) return;   // surface torn down — end this loop (a remount wires a fresh one)
      if (tD && tPlaying && !dragging) {
        // Loop the instant we reach the window's end (or fall before its start).
        if (trimVideo.currentTime >= tEnd || trimVideo.currentTime < tStart - 0.1) {
          trimVideo.currentTime = tStart;
        }
        positionPlayhead();
      }
      requestAnimationFrame(previewTick);
    };
    requestAnimationFrame(previewTick);

    trimSound.addEventListener('click', () => {
      trimVideo.muted = !trimVideo.muted;
      trimSound.setAttribute('aria-pressed', String(!trimVideo.muted));
      trimSound.innerHTML = svgIcon(trimVideo.muted ? 'mute' : 'sound', 'trim-sound-ico');
    });

    // ── Handle drag: change the window's length around its centre ──────────────
    // The reel stays put; only the frame grows/shrinks. The dragged handle tracks the
    // finger 1:1, and because the frame is centred the window grows symmetrically —
    // so selLen changes by twice the drag. Clamped to [1s, min(10s, clip)].
    reelFrame.querySelectorAll('.reel-handle').forEach((hb) => {
      hb.addEventListener('pointerdown', (e) => {
        if (!tD) return;
        dragging = { edge: hb.dataset.edge, x: e.clientX, len0: selLen };
        hb.setPointerCapture?.(e.pointerId);
        e.preventDefault();
      });
      hb.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const dSec = (e.clientX - dragging.x) / (PPS || 1);
        const delta = dragging.edge === 'r' ? dSec : -dSec;
        selLen = clamp(dragging.len0 + delta * 2, Math.min(TRIM_MIN_SEC, tD), Math.min(MAX_CLIP_SEC, tD));
        layoutReel();
        // Scrub to the edge being dragged so you see the exact frame (the loop is
        // paused while dragging).
        scrubTo(dragging.edge === 'r' ? Math.max(0, tEnd - 0.06) : tStart);
      });
      const end = () => { if (dragging) { dragging = null; scrubTo(tStart); trimVideo.play().catch(() => {}); } };
      hb.addEventListener('pointerup', end);
      hb.addEventListener('pointercancel', end);
    });

    async function handleLibraryVideo(f) {
      if (f.size > MAX_UPLOAD_BYTES) {
        // We upload the original (a trim is a play-window, not a cut), so a source
        // over the bucket ceiling can never post — bounce it up front, not after
        // the trim dance. Speak to size, since length alone is fine.
        showPickError('That clip is over 150 MB. Please pick a shorter or smaller clip.');
        return;
      }
      const err = errEl();
      if (err) err.textContent = '';
      // Any length is fine — the trim surface enforces the ≤10s cut.
      await finishVideo(f);
    }
  }

  // Read a just-loaded clip's duration + native size straight off the preview
  // <video> (src already set). Safari/WebKit reports `Infinity` for a MediaRecorder
  // blob until the element is forced to seek to the end, so nudge it and wait for a
  // finite `durationchange`. Returns { duration, w, h, known }: `known` is false
  // when we couldn't measure the length, which tells Post to cut defensively rather
  // than trust an untrimmed upload. Hardened against two WebKit traps:
  //   • `durationchange` can fire mid-seek while duration is STILL Infinity — only
  //     settle once it's finite, or we'd fall back on a perfectly good clip.
  //   • a stubborn blob might never settle — a 3s guard resolves rather than
  //     leaving finishVideo's `await` (and the whole trim surface) hung forever.
  function loadClipMeta(v) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (d) => {
        if (settled) return;
        settled = true;
        clearTimeout(guard);
        v.ondurationchange = null;
        const known = Number.isFinite(d) && d > 0;
        try { v.currentTime = 0; } catch {}
        resolve({ duration: known ? d : MAX_CLIP_SEC, known, w: v.videoWidth, h: v.videoHeight });
      };
      const guard = setTimeout(() => finish(v.duration), 3000);
      const onMeta = () => {
        if (v.duration === Infinity || Number.isNaN(v.duration)) {
          v.currentTime = 1e9;
          v.ondurationchange = () => { if (Number.isFinite(v.duration)) finish(v.duration); };
        } else finish(v.duration);
      };
      if (v.readyState >= 1) onMeta();
      else v.addEventListener('loadedmetadata', onMeta, { once: true });
      v.addEventListener('error', () => finish(0), { once: true });
    });
  }

  // Seek a <video> to t and resolve once a frame is actually painted there, so a
  // canvas draw right after lands real pixels: requestVideoFrameCallback fires on the
  // decoded frame (rAF-after-`seeked` fallback), and a time budget guarantees the
  // sampling loop never hangs on a stubborn frame.
  function seekPaint(v, t, budget = 900) {
    return new Promise((res) => {
      let done = false;
      const fin = () => { if (!done) { done = true; clearTimeout(tm); res(); } };
      const tm = setTimeout(fin, budget);
      // Race BOTH signals, first one wins: rVFC is the precise one (the decoded
      // frame is truly presented), but iOS WebKit can stall it on a paused
      // element — seeked→rAF backstops it so sampling never crawls through the
      // full budget on every cell.
      if (typeof v.requestVideoFrameCallback === 'function') v.requestVideoFrameCallback(fin);
      v.addEventListener('seeked', () => requestAnimationFrame(fin), { once: true });
      try { v.currentTime = t; } catch { fin(); }
    });
  }

  // Best-effort poster grab from a recorded/picked video Blob. Current iOS WebKit
  // (GPU-process canvas) can return an all-black frame from a <video> draw — sample
  // a pixel and bail rather than uploading a black poster; the feed's #t=0.001
  // fragment still self-paints a first frame with no stored poster at all.
  // Grab a poster still from a clip's blob. `atSec` seeks to the trim window's first
  // frame (so a trimmed clip's poster matches where it starts playing); `maxEdge`
  // downscales the still since we now poster from the ORIGINAL clip, which can be 4K.
  function grabPosterFromBlob(blob, { atSec = 0.05, maxEdge = 1280 } = {}) {
    return new Promise((resolve) => {
      const v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.preload = 'auto';
      v.src = URL.createObjectURL(blob);
      const cleanup = () => URL.revokeObjectURL(v.src);
      const fail = () => { cleanup(); resolve({ dataUrl: null }); };
      const timer = setTimeout(fail, 4000);
      v.addEventListener('error', fail, { once: true });
      v.addEventListener('loadeddata', () => {
        const onSeeked = () => {
          clearTimeout(timer);
          try {
            const vw = v.videoWidth || 1, vh = v.videoHeight || 1;
            const scale = Math.min(1, maxEdge / Math.max(vw, vh));
            const cw = Math.max(1, Math.round(vw * scale));
            const ch = Math.max(1, Math.round(vh * scale));
            const canvas = document.createElement('canvas');
            canvas.width = cw; canvas.height = ch;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(v, 0, 0, cw, ch);
            const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
            cleanup();
            if (r === 0 && g === 0 && b === 0) { resolve({ dataUrl: null }); return; }
            resolve({ dataUrl: canvas.toDataURL('image/jpeg', 0.82), w: vw, h: vh });
          } catch { cleanup(); resolve({ dataUrl: null }); }
        };
        const dur = Number.isFinite(v.duration) ? v.duration : 0;
        v.currentTime = dur ? Math.min(Math.max(atSec, 0.05), dur - 0.05) : Math.max(atSec, 0.05);
        v.addEventListener('seeked', onSeeked, { once: true });
      }, { once: true });
    });
  }

  // Same 1×1-downscale average-colour trick as a photo's tint, but sourced from
  // an already-captured poster <img> — never from a <video> (see grabPosterFromBlob).
  function tintFromDataUrl(dataUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 1; canvas.height = 1;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, 1, 1);
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
        resolve('#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join(''));
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  }

  // Short-clip duration label: "8.2s" reads better than "0:08" for a ≤10s window.
  function fmtClip(sec) {
    const s = Math.max(0, sec || 0);
    return s >= 60 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`
                   : `${s.toFixed(1)}s`;
  }

  // Reel timeline tick — whole-second clock time ("0:05", "1:30"). (fmtClip is for
  // the duration pill and reads "8.2s"; the ticks want clock time instead.)
  function tickLabel(sec) {
    const s = Math.max(0, Math.floor(sec || 0));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  // A whole-image preview that keeps the photo's native aspect ratio. export()
  // downscales the longest edge to `maxEdge` (to keep upload size sane) but never
  // crops — the shape you upload is the shape that posts.
  function initPhotoPreview(imgEl, src) {
    imgEl.style.transform = '';
    imgEl.src = src;
    const api = {
      dims: null,   // {w, h} of the last export — stamped into the upload filename
      export(maxEdge = 1400) {
        const iw = imgEl.naturalWidth  || 1;
        const ih = imgEl.naturalHeight || 1;
        const scale = Math.min(1, maxEdge / Math.max(iw, ih));
        const w = Math.max(1, Math.round(iw * scale));
        const h = Math.max(1, Math.round(ih * scale));
        api.dims = { w, h };
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(imgEl, 0, 0, w, h);
        return canvas.toDataURL('image/jpeg', 0.82);
      },
      // The photo's average colour as one #rrggbb string (~7 bytes). Stored on the
      // post row (not uploaded) so the feed paints the reserved box in the photo's
      // own colour and the full image fades in over it — a calm colour-up, one
      // layer, no filtered thumbnail. Downscaling the whole image to a single pixel
      // IS the average; the source is a local object/data URL so the canvas stays
      // untainted and getImageData is allowed.
      tint() {
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(imgEl, 0, 0, 1, 1);
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
        return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
      },
    };
    return api;
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
    const data = { type: pubType, tags: parseTags(val('c-tags')), note: readNoteField('c-note') };

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
      if (!data.location) {
        errEl.textContent = 'Add a place so people know where to show up.'; return;
      }
      if (data.eventTime && !data.eventDate) {
        errEl.textContent = 'Add a date to go with that time.'; return;
      }
      data.audience = pubAudience.mode;          // 'circle' | 'list'
      data.audienceUsers = pubAudience.users;    // usernames when 'list'
    } else if (pubType === 'photo') {
      // A Frame is a full post that carries a photo/clip: keep the headline and the
      // rich caption (both optional), same as a Note. Only the media is required.
      data.title = val('c-title');
      if (!cropper && !videoCapture) { errEl.textContent = 'Capture or choose a frame first.'; return; }
      if (videoCapture) {
        const vc = videoCapture;
        // We upload the ORIGINAL clip — no in-browser re-encode (that real-time pass
        // is what stripped audio on iOS Safari). A trim is stored as a play-window,
        // not a cut, so the original's size is the real gate: catch it here, before
        // the upload, with copy that says what to do rather than a generic server
        // error. The trim surface stays live (we haven't freed the decoder yet), so
        // they can drag a shorter selection or pick again.
        if (vc.blob.size > MAX_UPLOAD_BYTES) {
          errEl.textContent = 'That clip is over 150 MB. Please choose a shorter or smaller clip.';
          return;
        }
        data.video = vc.blob;
        data.imageDims = vc.dims || null;   // native size → filename -WxH stamp + feed reserve box
        // Store a play-window unless the post is simply a whole, known-≤10s clip:
        // a moved start, an unmeasured length, or an over-cap source all get windowed
        // to [start, start+10] so the feed + lightbox loop just that stretch.
        const windowed = vc.start > 0.05 || !vc.durationKnown || vc.duration > MAX_CLIP_SEC + 0.1;
        if (windowed) data.clip = { start: vc.start, end: Math.min(vc.end, vc.start + MAX_CLIP_SEC) };
        // Free the preview decoder before we grab the poster (iOS hands out one).
        if (stopActiveCapture) stopActiveCapture();
        // Poster + tint from the window's first frame, so the feed still opens on the
        // moment the clip starts on. Best-effort — the feed self-paints via #t= if
        // this fails. The row's dims come from vc.dims (native), not this downscaled
        // still, so the reserve box keeps the clip's true aspect.
        try {
          const g = await grabPosterFromBlob(vc.blob, { atSec: vc.start, maxEdge: 1280 });
          if (g.dataUrl) { data.poster = g.dataUrl; data.imageTint = await tintFromDataUrl(g.dataUrl); }
        } catch {}
      } else {
        data.image = cropper.export();
        data.imageDims = cropper.dims;   // stamped into the filename → zero feed reflow
        data.imageTint = cropper.tint(); // photo's average colour → colour-up in the feed
      }
    } else if (pubType === 'poll') {
      // The QUESTION is the post itself (headline and/or body), same as a Note —
      // no separate question field. The choices come from the list, trimmed with
      // empties dropped, so a blank box just isn't a choice.
      data.title = val('c-title');
      const options = Array.from(document.querySelectorAll('#c-poll-opts .poll-opt-input'))
        .map(el => el.value.trim()).filter(Boolean);
      if (!data.title && !data.note) { errEl.textContent = 'Ask your poll a question first.'; return; }
      if (options.length < 2) { errEl.textContent = 'Give the poll at least two choices.'; return; }
      data.poll = { options };
    } else {
      data.title = val('c-title');
      if (!data.title && !data.note) {
        errEl.textContent = 'Write a title or a note first.'; return;
      }
    }

    // Good-faith objectionable-content gate (App Store 1.2). Checks the text
    // fields the composer collected; a hit stops the post with a nudge toward the
    // guidelines rather than silently eating it.
    if (BLOCKLIST.hits(data.note, data.title, data.location,
        ...(data.poll ? data.poll.options : []))) {
      errEl.textContent = 'That looks like it breaks our community guidelines. Please revise before posting.';
      return;
    }

    // Writes now hit the network (and, for photos/videos, an upload), so reflect
    // the wait rather than freezing on click.
    const btn = document.querySelector('.composer-submit');
    if (btn) { btn.disabled = true; btn.textContent = 'Sharing…'; }
    errEl.textContent = '';

    // A video shows a real, byte-level upload bar (it's the big transfer). Photos
    // and text posts are small enough that a spinner-word says enough; the bar
    // stays hidden for them.
    const res = await Store.createPost(data, {
      onProgress: data.video ? (p) => setPostProgress('Uploading', p) : undefined,
    });
    if (!res.ok) {
      errEl.textContent = res.error;
      clearPostProgress();
      if (btn) { btn.disabled = false; btn.textContent = 'Share'; }
      return;
    }
    clearPostProgress();
    cropper = null;
    videoCapture = null;
    justPostedId = String(res.post.id);   // feed will sparkle this card in on arrival
    pubGroup = 'post';          // next compose opens on the Post group…
    pubType = 'note';           // …as a plain Note until something's attached
    go('#/');
  }

  // The composer's progress affordance for a video post's network upload (the big
  // transfer — we no longer re-encode). Determinate bar + a "Label 42%" caption;
  // the Post button mirrors the caption as its text.
  function setPostProgress(label, frac) {
    const wrap = document.getElementById('c-progress');
    const fill = document.getElementById('c-progress-fill');
    const cap  = document.getElementById('c-progress-label');
    const btn  = document.querySelector('.composer-submit');
    const pct  = Math.max(0, Math.min(100, Math.round((frac || 0) * 100)));
    // Reveal via a class (opacity/max-height on its own layer), never by toggling
    // `display` — a display:none→flex flip during the main-thread-heavy re-encode/
    // upload won't repaint on iOS WebKit until a scroll forces it (the "invisible
    // until I scroll" bug). Compositor-friendly props paint reliably under load.
    if (wrap) wrap.classList.add('is-active');
    if (fill) fill.style.width = pct + '%';
    if (cap)  cap.textContent = `${label} ${pct}%`;
    if (btn)  { btn.disabled = true; btn.textContent = `${label}… ${pct}%`; }
  }
  function clearPostProgress() {
    const wrap = document.getElementById('c-progress');
    const fill = document.getElementById('c-progress-fill');
    if (wrap) wrap.classList.remove('is-active');
    if (fill) fill.style.width = '0%';
  }

  // Save an inline text edit. Reads the form by type, applies the same rules as
  // the composer (a find needs a valid link; a post needs a headline or note),
  // then persists and re-renders the profile in place.
  async function submitEdit(id, username) {
    const errEl = document.getElementById('e-error');
    const val = (elId) => (document.getElementById(elId)?.value || '').trim();
    const post = Store.posts().find(p => p.id === id);
    if (!post) { editingId = null; renderUser(username); return; }

    const data = { note: readNoteField('e-note'), tags: parseTags(val('e-tags')) };

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
      if (!data.location) {
        errEl.textContent = 'Add a place so people know where to show up.'; return;
      }
      if (data.eventTime && !data.eventDate) {
        errEl.textContent = 'Add a date to go with that time.'; return;
      }
    } else if (post.type === 'note') {
      data.title = val('e-title');
      if (!data.title && !data.note) {
        errEl.textContent = 'Write a title or a note first.'; return;
      }
    } else if (post.type === 'photo') {
      // Headline + caption both optional (the image carries the post), but save the
      // title so an edited Frame keeps/gains its headline like a Note.
      data.title = val('e-title');
    }

    const res = await Store.updatePost(id, data);
    if (!res.ok) { errEl.textContent = res.error; return; }
    editingId = null;
    renderUser(username);
  }

  /* ── Lightbox ────────────────────────────────────────────────────────────── */
  let lightbox = null;
  let lightboxReturn = null;   // element to restore focus to on close
  function openLightbox(src, alt, isVideo) {
    if (!lightbox) {
      lightbox = document.createElement('div');
      lightbox.className = 'lightbox';
      lightbox.tabIndex = -1;
      lightbox.setAttribute('role', 'dialog');
      lightbox.setAttribute('aria-modal', 'true');
      lightbox.addEventListener('click', closeLightbox);
      document.body.appendChild(lightbox);
    }
    lightbox.setAttribute('aria-label', isVideo ? 'Frame viewer' : 'Photo viewer');
    // Rebuilt fresh on every open (not just swapping src) so a video never
    // lingers as dead markup once the lightbox is reused for a photo, or vice
    // versa. A Frame plays full sound here — this is the one explicit,
    // user-initiated place unmuted/fullscreen autoplay is safe to assume.
    // A trimmed clip plays its window here too: seek the initial frame to the start
    // and let wireClipWindow loop inside [start,end], so the lightbox shows the same
    // stretch the feed does (not the untrimmed original behind it).
    const win = isVideo ? clipWindowFromUrl(src) : null;
    lightbox.innerHTML = isVideo
      ? `<video src="${esc(src + (win ? '#t=' + Math.max(win.start, 0.001) : ''))}" playsinline controls autoplay></video>`
      : `<img src="${esc(src)}" alt="${esc(alt || '')}">`;
    // Native video controls (scrub, pause) must not bubble into the backdrop's
    // click-to-close; tapping the photo itself, though, still closes as before.
    if (isVideo) {
      const v = lightbox.querySelector('video');
      v.addEventListener('click', e => e.stopPropagation());
      wireClipWindow(v, win);
    }
    lightboxReturn = document.activeElement;
    document.body.style.overflow = 'hidden';   // lock the page behind it
    lightbox.classList.add('open');
    lightbox.focus();
    document.addEventListener('keydown', onKey);
  }
  function closeLightbox() {
    if (!lightbox) return;
    // A playing <video> must be stopped, not just visually hidden, or it keeps
    // decoding (and, if unmuted, keeps making sound) behind the closed sheet.
    const v = lightbox.querySelector('video');
    if (v) { v.pause(); v.removeAttribute('src'); v.load(); }
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
    // About is the front door — greet it with the same self-lit, hue-drifting
    // glow signed-out visitors already see on the gate, so the page reads the
    // same either side of sign-in. Locked to the viewport bottom (see .ambient),
    // rising up under the guidelines and the floating nav.
    if (path.split('?')[0] === '#/about') { body.dataset.ambient = 'about'; return; }
    // Support wears the same self-lit, hue-drifting glow as About.
    if (path.split('?')[0] === '#/support') { body.dataset.ambient = 'support'; return; }
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

  // Full <svg> strings (not svgIcon glyphs) — these carry their own fills. They
  // share ICON_ATTRS, defined up top alongside svgIcon.
  const INSTALL_ICONS = {
    share: `<svg ${ICON_ATTRS}><path d="M12 15V3" /><path d="M8 6.5 12 3l4 3.5" />` +
      `<path d="M5 10v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-9" /></svg>`,
    add: `<svg ${ICON_ATTRS}><rect x="4" y="4" width="16" height="16" rx="3.5" />` +
      `<path d="M12 9.2v5.6" /><path d="M9.2 12h5.6" /></svg>`,
    // Chrome's three-dot menu — the Android counterpart of Safari's Share.
    menu: `<svg ${ICON_ATTRS}><circle cx="12" cy="5.5" r="1.4" fill="currentColor" stroke="none"/>` +
      `<circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/>` +
      `<circle cx="12" cy="18.5" r="1.4" fill="currentColor" stroke="none"/></svg>`,
  };

  function installStep(icon, text) {
    return `<li><span class="install-icon">${icon}</span><span>${text}</span></li>`;
  }

  // Which phone the install steps speak to. Guessed once from the UA, then the
  // small iPhone/Android toggle above the steps flips it in place — same three
  // rows, same footprint, only the words and the lead icon change. Shared by
  // the welcome front door and the About fold, so they can never drift apart.
  let installOS = /Android/i.test(navigator.userAgent) ? 'android' : 'ios';

  // The two platform-specific rows as [icon, text] pairs — the shared shape the
  // first render and the in-place toggle swap both read from.
  function installStepData() {
    return installOS === 'android'
      ? [[INSTALL_ICONS.menu, `Tap the <strong>three-dot menu</strong> in Chrome's toolbar.`],
         [INSTALL_ICONS.add, `Tap <strong>Add to Home screen</strong>.`]]
      : [[INSTALL_ICONS.share, `Tap the <strong>Share</strong> button in Safari's toolbar.`],
         [INSTALL_ICONS.add, `Scroll down and tap <strong>Add to Home Screen</strong>.`]];
  }

  function installStepsHtml() {
    // The payoff tile IS the Tria app icon (the drifting pastel quintet) — the
    // same close on either platform.
    return installStepData().map(([icon, text]) => installStep(icon, text)).join('') +
      `<li><span class="install-icon install-appicon"><span class="install-t">t</span></span>` +
        `<span>Tap <strong>Add</strong>. Tria is now on your home screen.</span></li>`;
  }

  function installToggleHtml() {
    const opt = (os, label) =>
      `<button type="button" class="os-opt" data-os="${os}" aria-pressed="${installOS === os}">${label}</button>`;
    return `<div class="os-toggle" role="group" aria-label="Which phone?">` +
      opt('ios', 'iPhone') + opt('android', 'Android') + `</div>`;
  }

  function wireInstallToggle(root) {
    const wrap = root.querySelector('.os-toggle');
    if (!wrap) return;
    wrap.querySelectorAll('.os-opt').forEach(btn =>
      btn.addEventListener('click', () => {
        if (btn.dataset.os === installOS) return;
        installOS = btn.dataset.os;
        wrap.querySelectorAll('.os-opt').forEach(b =>
          b.setAttribute('aria-pressed', String(b.dataset.os === installOS)));
        // Swap only the two rows' CONTENT, never the rows themselves: rebuilding
        // the list restarts every tile's drift animation from zero (a visible
        // jolt mid-tap). The <li>s and their .install-icon tiles stay put, so
        // the drift keeps breathing straight through the switch.
        const list = root.querySelector('.install-steps');
        if (!list) return;
        installStepData().forEach(([icon, text], i) => {
          const li = list.children[i];
          if (!li) return;
          li.querySelector('.install-icon').innerHTML = icon;
          li.lastElementChild.innerHTML = text;
        });
      }));
  }

  function renderAbout(gated) {
    const me = !gated && Store.isAuthed() ? Store.currentUser() : null;

    // The install steps live behind a fold like the guidelines/FAQ (the browser
    // welcome landing is now the primary place this content is shown). Keeps its
    // id="install" via aboutFold, so #/about?open=install still deep-links here.
    const installHtml =
      `<p>Tria lives on the web, so there's nothing to download and no store in ` +
        `between. Add it to your home screen and it opens full screen, just like ` +
        `any other app on your phone.</p>` +
      installToggleHtml() +
      `<ol class="install-steps">${installStepsHtml()}</ol>`;

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

    const privacyHtml = aboutFold('privacy', 'Privacy policy',
      `<p>This policy explains what Tria collects, why, and what happens to it. ` +
        `The short version: we collect the little we need to run the app, we ` +
        `don't sell it, and you can delete all of it at any time.</p>` +
      `<h3>What we collect.</h3>` +
      `<p>Your email address, which we use to sign you in and, if you ask, to ` +
        `reply to feedback. Your username and profile details. The content you ` +
        `choose to share, including posts, comments, photos, and the time and ` +
        `place attached to any activities. If you turn on notifications, the ` +
        `push subscription your device hands us so we can deliver them.</p>` +
      `<h3>How we use it.</h3>` +
      `<p>Only to make Tria work: to show your posts to the circle you've ` +
        `chosen, to deliver the notifications you asked for, and to keep the ` +
        `community safe. We don't build advertising profiles or track you ` +
        `across other apps and sites.</p>` +
      `<h3>Who can see it.</h3>` +
      `<p>Your posts reach the people in your circle, following the privacy ` +
        `settings you choose. Private likes stay private. We do not sell your ` +
        `data, and we do not share it with advertisers or data brokers. There ` +
        `are no third-party advertising or analytics systems inside Tria.</p>` +
      `<h3>Where it lives.</h3>` +
      `<p>Your data is stored with our hosting provider, Supabase, and moves ` +
        `over encrypted connections. We keep it only as long as your account ` +
        `exists.</p>` +
      `<h3>Deleting your account.</h3>` +
      `<p>You can delete your account at any time from Edit profile. Deleting ` +
        `removes your account and the content tied to it, including your posts, ` +
        `comments, photos, and profile.</p>` +
      `<h3>Children.</h3>` +
      `<p>Tria is not directed to children under 13, and we don't knowingly ` +
        `collect their information.</p>` +
      `<h3>Changes and questions.</h3>` +
      `<p>If this policy changes in a meaningful way, we'll let you know in the ` +
        `app. Questions about your data? Reach us through the Feedback form ` +
        `below.</p>`);

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

    const businessHtml = aboutFold('business', 'Tria for business',
      `<p>Tria is available to businesses and nonprofits for ` +
        `<strong>$99.99 per month</strong>. That's the whole price. No ad ` +
        `auctions, no hidden fees. <strong>Your social strategy is determined by ` +
        `you and your audience, not an algorithm.</strong></p>` +
      `<p>Tria doesn't use an algorithm to push promotional content into anyone's ` +
        `feed. Instead, organizations share posts the same way people do, and those ` +
        `posts reach the people who choose to follow them.</p>` +
      `<p>This is why an organization account costs a flat monthly fee instead of ` +
        `thousands in ad spend. We're not selling attention or building profiles to ` +
        `target you. We're just letting the people who already care about your ` +
        `organization keep up with it.</p>` +
      `<p>Organization accounts follow the same community guidelines as everyone ` +
        `else. <strong>No spam, no deceptive promotion, no buying your way past the ` +
        `people who didn't ask to hear from you.</strong></p>` +
      `<h3>Interested?</h3>` +
      `<p>If you'd like to set up an organization account, reach us through the ` +
        `Feedback form below and we'll help you get started.</p>`);

    const feedbackHtml = aboutFold('feedback', 'Feedback',
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
      `</form>`);

    view.innerHTML =
      `<section class="view about${gated ? ' about--front' : ''}">` +
        // Signed out, the signed-in .topbar is hidden, so carry the same front-door
        // brand header here too. Signed in, the real topbar is already up top.
        (gated ? authHeader() : '') +
        (gated ? `<p class="about-back"><a href="#/">&larr; Back to sign in</a></p>` : '') +
        mastheadEl('Social media made local', 'About Tria') +
        `<div class="about-body">` +
          `<p class="about-lede">Tria is a social media app built for <em>real ` +
            `relationships</em>. Whether you're keeping up with lifelong friends, ` +
            `or finding your people for the first time, <strong>Tria ` +
            `is the place to do it.</strong></p>` +
          `<p class="about-lede"><strong>Your feed is chronological. There are ` +
            `no ads, and no algorithm deciding for you.</strong> Just a place to ` +
            `share your life, discover things worth caring about, and stay ` +
            `connected.</p>` +
          aboutFold('install', 'Add Tria to your home screen', installHtml) +
          guidelinesHtml + privacyHtml + faqHtml + businessHtml + feedbackHtml +
        `</div>` +
      `</section>`;

    view.querySelectorAll('.about-fold-toggle').forEach((btn) => {
      btn.addEventListener('click', () => {
        const open = btn.closest('.about-fold').classList.toggle('open');
        btn.setAttribute('aria-expanded', String(open));
      });
    });

    wireInstallToggle(view);   // the install fold's iPhone/Android switch

    // Deep link: #/about?open=<foldId> (the signup guidelines link) opens that
    // fold and scrolls it into view, so "Community Guidelines" lands you right on
    // the open section instead of the top of a collapsed page.
    const openId = new URLSearchParams(location.hash.split('?')[1] || '').get('open');
    if (openId) {
      const fold = document.getElementById(openId);
      if (fold && fold.classList.contains('about-fold')) {
        fold.classList.add('open');
        const tog = fold.querySelector('.about-fold-toggle');
        if (tog) tog.setAttribute('aria-expanded', 'true');
        setTimeout(() => fold.scrollIntoView({
          behavior: prefersReduced() ? 'auto' : 'smooth', block: 'start',
        }), 80);
      }
    }

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

  /* ── Support (#/support) ─────────────────────────────────────────────────────
     A quiet love letter from Zoe with a soft ask: invite the people you want in
     your circle. Reachable only from the sprout glyph in the header, which the
     signed-out gate hides — so this is signed-in only (the route() gate would
     redirect a logged-out hash here to the login screen regardless). Reuses the
     About page's editorial body + hue-drifting glow (data-ambient="support"). */
  function renderSupport() {
    // Root invite link (drop any #/… route), so the share points at Tria itself.
    const shareUrl = /^https?:/.test(location.origin)
      ? location.origin + location.pathname
      : location.href;

    view.innerHTML =
      `<section class="view about support">` +
        mastheadEl('A note from the designer', 'Thank you') +
        `<div class="about-body">` +
          `<p class="about-lede">I built Tria because I believe online community ` +
            `should be <em>fun, authentic, and free.</em> The internet needs a ` +
            `place for people you actually know and love.</p>` +
          `<p class="about-lede">The best way to help Tria grow is the simplest: ` +
            `<strong>invite your friends to join you here.</strong> Every circle that ` +
            `starts here is proof that social media can be fun again.</p>` +
          `<p class="support-sign">&mdash; <a href="#/u/zoe">Zoe</a></p>` +
          `<button class="support-share publish-fill is-solid" type="button" ` +
            `aria-label="Share Tria with a friend">` +
            svgIcon('send', 'support-share-ico') +
            `<span>Share Tria</span>` +
          `</button>` +
        `</div>` +
      `</section>`;

    // Native share sheet where it exists (mobile/PWA), clipboard copy on desktop.
    const shareBtn = view.querySelector('.support-share');
    shareBtn.addEventListener('click', async () => {
      const result = await shareOrCopy({
        title: 'Join me on Tria',
        text: 'Join me on Tria',
        url: shareUrl,
      });
      if (result === 'cancelled') return;
      const label = shareBtn.querySelector('span');
      label.textContent = result === 'copied' ? 'Link copied' : 'Shared';
      setTimeout(() => { label.textContent = 'Share Tria'; }, 1600);
    });

    wireAuthAccount();   // no-op when signed in (the header is signed-out only)
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
    const reduce = prefersReduced();
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
      // First paint / deep-link: no page slide, but a docked switcher still gets
      // its rise (unless reduced motion, which shows it in place). Tuck-commit-
      // release so it lifts from behind the nav on landing.
      if (!reduce) {
        const seg = page.querySelector('.seg-tabs:not(#c-group-tabs)');
        if (seg) {
          seg.classList.add('tuck');
          void seg.offsetWidth;                     // commit the tucked start state
          requestAnimationFrame(() => seg.classList.remove('tuck'));
        }
      }
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

    // Content mounted during a navigation rides in on the page's own slide+fade —
    // it does NOT also play its per-row rise. Freezing every fresh row here (not
    // pausing it in CSS) keeps it VISIBLE for the whole move instead of held at the
    // rise's transparent first frame: that blank window over the near-white page
    // was the "white flash" on the card-heavy Circle. Inline, so it survives the
    // class cleanup and the rows never replay the rise once the page settles; and
    // with no row animation in flight the move carries the fewest possible layers
    // (the same iOS-crash win the old CSS pause was after). Covers feed .card AND
    // the Updates ledger (.notif / .request-row), which carry the same rise and
    // were otherwise stacking their translateY layers on top of the slide — the
    // Updates-page stutter/refresh. Rows that arrive later without a page change
    // (refreshWorld / the Updates reconcile) are untouched and still rise in.
    page.querySelectorAll('.card, .notif, .request-row').forEach(c => { c.style.animation = 'none'; });

    // A docked view switcher (Friends / Updates on mobile) starts tucked behind
    // the nav so it can rise once the page settles (see cleanup) rather than
    // riding the horizontal page slide. No-op on pages without one.
    page.querySelector('.seg-tabs:not(#c-group-tabs)')?.classList.add('tuck');

    prev.className = 'page';    // clear any stale transition classes before reuse
    prev.classList.add('leave', leaveTo);

    void stage.offsetWidth;    // commit the start states before flipping to rest
    requestAnimationFrame(() => {
      page.classList.add('active');
      prev.classList.add('active');
    });

    // Clean up the instant the page finishes settling: drop the outgoing page and
    // clear the transition classes — which also releases the will-change layer AND
    // hands the in-page glass back its live frost (see the glass rule in app.css),
    // so the frost returns exactly as motion ends, no flat tail. Driven by the
    // entering page's own transitionend on the property that finishes LAST (the
    // slide's transform, or opacity on a fade — the filter clears early and must
    // not trigger cleanup). A timeout backs it up if the event is ever missed.
    const settleProp = dir === 0 ? 'opacity' : 'transform';
    let cleaned = false;
    const cleanup = () => {
      if (cleaned || token !== navToken) return;   // a newer navigation owns the stage
      cleaned = true;
      page.removeEventListener('transitionend', onSettle);
      prev.remove();
      page.className = 'page';
      // The page has settled and its transform is gone, so the fixed switcher
      // now anchors to the viewport — drop .tuck and it rises straight up from
      // behind the nav on its own transition.
      page.querySelector('.seg-tabs:not(#c-group-tabs)')?.classList.remove('tuck');
    };
    const onSettle = (e) => {
      if (e.target === page && e.propertyName === settleProp) cleanup();
    };
    page.addEventListener('transitionend', onSettle);
    window.setTimeout(cleanup, TRANSITION_MS + 120);
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
    // Navigating away from Publish must stop a live camera/mic stream — the
    // capture surface's own DOM is about to be replaced, which wouldn't
    // otherwise release it (see wireFrameCapture's teardown).
    if (stopActiveCapture) { stopActiveCapture(); stopActiveCapture = null; }

    // Gate: no session → the setup / login screen, whatever the hash says.
    // The one exception is About, the public front door — reachable from a
    // link on the gate itself (it renders chromeless, with a way back).
    if (!Store.isAuthed()) {
      document.body.classList.add('gate');
      const gatePath = (location.hash || '#/').split('?')[0];
      // Installed (home-screen / standalone) visitors are already past the
      // install step, so they skip the tutorial and land straight on the sign-in
      // form. navigator.standalone is iOS-only; the media query covers the rest.
      const installed = navigator.standalone === true
        || window.matchMedia('(display-mode: standalone)').matches;
      // The install-first welcome is the browser front door: any signed-out route
      // that isn't an explicit auth / About / recovery screen lands there. It
      // leads with "add Tria to your home screen, then sign in there", which is
      // what keeps people from signing in twice — a session made in Safari does
      // not carry into the installed app (separate storage).
      const showWelcome = !installed && !Store.isRecovering()
        && gatePath !== '#/signin' && gatePath !== '#/about'
        && gatePath !== '#/forgot' && gatePath !== '#/reset-password'
        && gatePath !== '#/confirmed';
      // Welcome + About keep the hue-drift wash; the bare auth form does not
      // (its pastel now comes from the gradient submit button).
      document.body.dataset.ambient =
        (gatePath === '#/about' || showWelcome) ? 'about' : 'none';
      renderPage(-1, () => {
        // A live recovery session (from the reset link) always wins: set-new-
        // password, whatever the hash says.
        if (Store.isRecovering()) return renderNewPassword();
        if (gatePath === '#/about') return renderAbout(true);
        // #/reset-password is the link's landing; with no recovery session it has
        // expired or been reused, so route them to request a fresh one.
        if (gatePath === '#/forgot' || gatePath === '#/reset-password') return renderRequestReset();
        if (gatePath === '#/confirmed') return renderConfirmed();
        if (showWelcome) return renderWelcome();
        return renderAuth(authMode);
      });
      window.scrollTo(0, 0);
      return;
    }
    document.body.classList.remove('gate');
    editingId = null;           // navigating away cancels any in-progress edit

    const hash = location.hash || '#/';
    const path = hash.split('?')[0];
    // A copied post link carries ?p=<id> onto the author's profile. Set the
    // spotlight so renderUser scrolls that card into view (same path an Updates
    // row uses). Only honoured on a profile route.
    if (path.startsWith('#/u/') || path === '#/profile') {
      const p = new URLSearchParams(hash.split('?')[1] || '').get('p');
      if (p) spotlightPost = p;
    }
    renderNav(path);   // a friend view (#/u/…) matches nothing → nothing highlighted

    // Remember where a friend profile's "← Back" should return to: the page you
    // came from. Chained profile→profile hops keep the original origin, so Back
    // always lands you back on the feed/directory you started browsing from.
    if (path.startsWith('#/u/')) {
      if (lastPath && !lastPath.startsWith('#/u/')) profileOrigin = lastPath;
    }
    lastPath = path;

    applyAmbient(path);   // warm (Circle) / cool (Friends) / photo tint (a profile)

    // Coming from an Updates row, the profile render scrolls the tapped post into
    // view itself — so skip the router's top-snap below (renderUser consumes and
    // clears spotlightPost during the render, hence capturing it here) or the page
    // would jump to the top and then scroll back down.
    const spotlighting = !!spotlightPost;

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
        case '#/support': renderSupport(); break;
        default:          location.hash = '#/';
      }
    });

    if (!spotlighting) scrollTop(false);   // spotlight scrolls itself (see above)
    nudgeNav();           // iOS standalone: re-composite the nav's frosted layer
    refreshWorld(path);   // Circle/Updates: quietly re-pull behind the render
  }

  // iOS Safari (standalone) sometimes drops the fixed, backdrop-filtered nav's
  // layer after a page's DOM is replaced, leaving it invisible until you scroll.
  // (navigator.standalone is true only inside an iOS standalone PWA; everywhere
  // else this is pure cost, so bail.) Rescue it GENTLY: flick the frosted pill's
  // backdrop-filter off and back on, which rebuilds that dropped layer WITHOUT
  // pulling the element out of flow. The old fix toggled the nav's display, which
  // did the same repaint but also (a) cancelled the nav's own slide transitions
  // (the active-icon glide, the compose +) and (b) RESTARTED their CSS gradient
  // animation from 0% — so the colour loop visibly jumped to the start on every
  // page change. The backdrop flick leaves the slides and the gradient untouched.
  function nudgeNav() {
    if (!navigator.standalone) return;
    const pill = document.querySelector('.nav-pill');
    if (!pill) return;
    pill.style.webkitBackdropFilter = 'none';
    pill.style.backdropFilter = 'none';
    void pill.offsetHeight;   // rebuild the frosted layer; no paint in between
    pill.style.webkitBackdropFilter = '';
    pill.style.backdropFilter = '';
  }

  /* ── Warm image cache ────────────────────────────────────────────────────────
     Every navigation re-renders from scratch, minting fresh <img>s. Even though
     the files carry a 1-year cache, a brand-new element still has to decode before
     it paints — so avatars and photos would pop in a frame late on each page/tab
     change, reading as a "reload". We pre-fetch AND pre-decode them here (once the
     world is loaded, on idle) so the browser holds a ready-to-paint copy: by the
     time you reach a page its images ride in with it, no reload.

     crossOrigin must match how each is DISPLAYED so we fill the same cache bucket:
     avatars are crossorigin (shared with the ambient sampler), post photos aren't.
     Recent photos only (bounded) — no point decoding the whole history up front. */
  const warmedImages = new Set();
  function warmImages() {
    const warm = (url, cors) => {
      if (!url || url.startsWith('data:') || warmedImages.has(url)) return;
      warmedImages.add(url);
      const im = new Image();
      if (cors) im.crossOrigin = 'anonymous';
      im.decoding = 'async';
      im.src = url;
      im.decode?.().catch(() => {});   // decode + cache the bitmap; ignore aborts
    };
    const run = () => {
      Store.users().forEach(u => warm(u.avatar, true));
      Store.posts().filter(p => p.image).slice(-40).forEach(p => warm(p.image, false));
    };
    ('requestIdleCallback' in window) ? requestIdleCallback(run, { timeout: 2000 }) : setTimeout(run, 400);
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
    warmImages();   // new friends/posts may have brought new avatars + photos
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
  // Never reloads mid-thought: composing, an open modal, or a page mid-transition
  // defers the update to the next foreground (a reload during the slide is the
  // jarring "navigating hard-refreshed" flicker). Throttled so foreground flips
  // don't spam the network.
  (() => {
    const booted = (document.querySelector('script[src*="js/app.js"]')?.src
      .match(/[?&]v=([^&]+)/) || [])[1];
    if (!booted) return;   // unstamped build (local harness) → nothing to compare
    let lastCheck = 0;
    async function check() {
      if (Date.now() - lastCheck < 60000) return;
      lastCheck = Date.now();
      try {
        // Unique URL + no-store: GitHub Pages sends index.html with max-age=600,
        // and an iOS home-screen app will happily hand back the cached copy even
        // to a no-store fetch — so make the URL uncacheable outright.
        const html = await (await fetch('index.html?_=' + Date.now(), { cache: 'no-store' })).text();
        const latest = (html.match(/js\/app\.js\?v=([^"&]+)/) || [])[1];
        if (!latest || latest === booted) return;
        const busy = location.hash.split('?')[0] === '#/publish' ||
          document.querySelector('.modal-card') ||
          document.querySelector('.page.enter, .page.leave');
        // location.reload() re-reads the CACHED index.html on iOS standalone (same
        // max-age=600), which reloads the very build we're trying to leave — an
        // update that never lands. Navigate to a fresh document URL instead: a new
        // ?u= stamp is a cache key iOS has never seen, so it must refetch, pulling
        // the new index.html and its new asset stamps. The router reads the hash,
        // so the search param is inert; replace() keeps it out of history.
        if (!busy) {
          const sp = new URLSearchParams(location.search);
          sp.set('u', latest);
          location.replace(location.pathname + '?' + sp.toString() + location.hash);
        }
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

  // Register the service worker (idempotent): it powers Web Push AND keeps the
  // shell fresh (network-first navigations — see sw.js). Nudge an update check on
  // launch and every foreground so a new worker (e.g. this very freshness fix)
  // propagates within a session or two instead of waiting on the browser's own
  // ~24h cadence — the SW script itself is fetched bypassing the HTTP cache.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then(reg => {
      const poke = () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); };
      document.addEventListener('visibilitychange', poke);
    }).catch(() => { /* push + shell-refresh simply stay off */ });
  }

  // If the recovery event lands after the first paint (it usually resolves during
  // init, but the URL parse is async), re-route so set-new-password takes over.
  Store.onRecovery(route);

  // Load the world from Supabase before the first render (this resolves any
  // persisted session too). On failure we still route — straight to the gate.
  Store.init().then(() => {
    route();
    warmImages();   // decode avatars + recent photos up front so navigation is flash-free
  }).catch((err) => {
    console.error('Boot failed:', err);
    route();
  }).finally(dismissSplash);
})();
