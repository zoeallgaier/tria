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

  // The feed's entrance rhythm: each card/row rises a beat after the one above it,
  // capped so a long list doesn't trail on forever. Shared by every list view.
  const staggerDelay = (i) => Math.min(i * 0.05, 0.4).toFixed(2) + 's';

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
      nav.innerHTML =
        `<div class="nav-pill"><span class="nav-glide" aria-hidden="true"></span>` +
          NAV.filter(n => !n.publish).map(link).join('') +
        `</div>` +
        NAV.filter(n => n.publish).map(link).join('') +
        dialEl();
      wireDial(nav);
    }
    nav.querySelectorAll('.nav-link').forEach(a => {
      if (a.getAttribute('href') === active) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
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
    glide.style.transform = `translate(${cur.offsetLeft}px, ${cur.offsetTop}px)`;
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
        pubType = item.dataset.type;   // preselect the composer's type
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
      return `<span class="${cls} avatar--photo" aria-hidden="true">` +
          `<img src="${esc(user.avatar)}" crossorigin="anonymous" alt="" loading="lazy" decoding="async">` +
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
  const TYPE_LABEL = { note: 'Note', find: 'Find', photo: 'Photo', activity: 'Activity' };
  // Single-colour glyphs, one per type, inlined so they inherit the type's own
  // colour via `fill: currentColor` (set on the CSS class) — and grey out for
  // a past activity with no extra markup. viewBoxes are the artboard sizes.
  const TYPE_ICON = {
    note: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M11.99,3.91c.13.16.37.57.62,1.51l.4,1.46.92-1.2c.6-.78.98-1.07,1.16-1.17.06.2.12.66,0,1.63l-.19,1.5,1.31-.75c.81-.47,1.27-.59,1.51-.62-.03.21-.15.66-.62,1.49l-.75,1.31,1.5-.19c.37-.05.7-.07.98-.07.34,0,.55.04.66.07-.1.18-.39.56-1.18,1.17l-1.2.92,1.46.39c.95.26,1.36.5,1.53.63-.16.13-.57.36-1.5.62l-1.45.4,1.19.92c.77.59,1.05.97,1.15,1.15-.12.03-.32.07-.67.07-.28,0-.61-.02-.97-.07l-1.5-.19.75,1.31c.48.85.6,1.3.63,1.51-.2-.03-.66-.14-1.5-.62l-1.31-.75.19,1.49c.12.96.06,1.42,0,1.62-.18-.1-.57-.39-1.17-1.18l-.93-1.21-.39,1.47c-.26.98-.5,1.39-.64,1.56-.13-.17-.37-.57-.62-1.52l-.39-1.46-.92,1.19c-.6.77-.97,1.05-1.15,1.15-.06-.2-.12-.67,0-1.65l.19-1.5-1.31.75c-.82.47-1.27.59-1.51.62.03-.21.15-.67.63-1.51l.75-1.31-1.5.19c-.36.05-.69.07-.96.07-.34,0-.55-.04-.67-.07.1-.18.38-.55,1.14-1.14l1.19-.92-1.45-.4c-.93-.25-1.33-.49-1.5-.62.17-.13.58-.37,1.53-.63l1.46-.39-1.2-.92c-.78-.6-1.06-.98-1.17-1.16.12-.03.32-.07.67-.07.28,0,.61.02.97.07l1.5.19-.75-1.31c-.48-.85-.6-1.3-.63-1.51.2.03.67.14,1.52.64l1.31.75-.19-1.5c-.13-.98-.06-1.45,0-1.65.18.1.55.38,1.14,1.13l.92,1.18.4-1.44c.25-.91.48-1.3.61-1.46M11.99,3.08c-.51,0-.97.79-1.33,2.09-.73-.94-1.38-1.48-1.84-1.48-.07,0-.14.01-.2.04-.48.2-.6,1.13-.42,2.51-.83-.48-1.52-.74-1.99-.74-.21,0-.38.05-.49.17-.36.36-.12,1.27.57,2.47-.39-.05-.75-.08-1.07-.08-.78,0-1.29.16-1.43.5-.2.48.38,1.22,1.48,2.07-1.35.36-2.16.83-2.16,1.35s.8.98,2.13,1.34c-1.08.84-1.64,1.58-1.45,2.05.14.34.65.5,1.43.5.31,0,.67-.03,1.06-.08-.69,1.21-.94,2.12-.57,2.48.11.11.28.17.49.17.47,0,1.15-.26,1.98-.74-.18,1.38-.06,2.31.42,2.51.06.03.13.04.2.04.47,0,1.13-.55,1.86-1.5.36,1.34.83,2.15,1.35,2.15s1-.83,1.36-2.2c.74.97,1.41,1.53,1.89,1.53.07,0,.14-.01.2-.04.47-.2.6-1.12.42-2.49.82.47,1.5.73,1.96.73.21,0,.38-.05.49-.17.36-.36.12-1.27-.57-2.47.39.05.75.08,1.07.08.78,0,1.29-.16,1.43-.5.2-.47-.37-1.22-1.46-2.06,1.33-.36,2.13-.83,2.13-1.34s-.82-.99-2.17-1.35c1.11-.85,1.69-1.6,1.49-2.08-.14-.34-.65-.5-1.43-.5-.32,0-.68.03-1.07.08.68-1.2.92-2.1.56-2.46-.11-.11-.28-.17-.49-.17-.47,0-1.15.26-1.97.73.17-1.37.05-2.29-.42-2.49-.06-.03-.13-.04-.2-.04-.47,0-1.13.56-1.87,1.52-.36-1.33-.83-2.14-1.35-2.14h0Z"/></svg>`,
    find: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12,2.76c1.11,0,2.58.43,3.08,1.65.37.9.46,2.94-3.08,6.53-3.54-3.59-3.45-5.63-3.08-6.53.5-1.22,1.97-1.65,3.08-1.65M18.67,8.74c1.77,0,2.58,1.69,2.58,3.26,0,1.57-.81,3.26-2.58,3.26-1.06,0-2.88-.57-5.6-3.26,2.72-2.69,4.55-3.26,5.6-3.26M5.34,8.74c1.06,0,2.88.57,5.6,3.26-2.72,2.69-4.55,3.26-5.6,3.26-1.77,0-2.58-1.69-2.58-3.26s.81-3.26,2.58-3.26M12,13.06c3.54,3.59,3.45,5.63,3.08,6.53-.5,1.22-1.97,1.65-3.08,1.65s-2.58-.43-3.08-1.65c-.37-.9-.46-2.94,3.08-6.53M12,2.01c-3.4,0-6.8,3.2-.41,9.58-2.62-2.62-4.71-3.6-6.26-3.6-4.44,0-4.44,8.01,0,8.01,1.55,0,3.63-.97,6.26-3.6-6.39,6.39-2.99,9.58.41,9.58s6.8-3.2.41-9.58c2.62,2.62,4.71,3.6,6.26,3.6,4.44,0,4.44-8.01,0-8.01-1.55,0-3.63.97-6.26,3.6,6.39-6.39,2.99-9.58-.41-9.58h0Z"/></svg>`,
    photo: `<svg viewBox="2.5 2.5 19 19" fill="currentColor" aria-hidden="true"><path d="M12,4.92c3.91,0,7.08,3.18,7.08,7.08s-3.18,7.08-7.08,7.08-7.08-3.18-7.08-7.08,3.18-7.08,7.08-7.08M12,16.87c2.69,0,4.88-2.19,4.88-4.88s-2.19-4.88-4.88-4.88-4.88,2.19-4.88,4.88,2.19,4.88,4.88,4.88M12,4.17c-4.33,0-7.83,3.51-7.83,7.83s3.51,7.83,7.83,7.83,7.83-3.51,7.83-7.83-3.51-7.83-7.83-7.83h0ZM12,16.12c-2.28,0-4.13-1.85-4.13-4.13s1.85-4.13,4.13-4.13,4.13,1.85,4.13,4.13-1.85,4.13-4.13,4.13h0Z"/></svg>`,
    activity: `<svg viewBox="0 0 18.88 19.82" fill="currentColor" aria-hidden="true"><path d="M9.44,2.85l.33,1.66c.14.72.78,1.25,1.52,1.25.39,0,.76-.15,1.05-.41l1.24-1.15-.71,1.54c-.22.48-.19,1.04.1,1.48.29.45.77.72,1.3.72.06,0,.12,0,.19-.01l1.68-.2-1.48.83c-.49.27-.79.79-.79,1.35s.3,1.08.79,1.35l1.48.83-1.68-.2c-.06,0-.13-.01-.19-.01-.53,0-1.02.27-1.3.72-.29.45-.32,1-.1,1.48l.71,1.54-1.24-1.15c-.29-.27-.66-.41-1.05-.41-.74,0-1.38.53-1.52,1.25l-.33,1.66-.33-1.66c-.14-.72-.78-1.25-1.52-1.25-.39,0-.76.15-1.05.41l-1.24,1.15.71-1.54c.22-.48.19-1.04-.1-1.48-.29-.45-.77-.72-1.3-.72-.06,0-.12,0-.19.01l-1.68.2,1.48-.83c.49-.27.79-.79.79-1.35s-.3-1.08-.79-1.35l-1.48-.83,1.68.2c.06,0,.13.01.19.01.53,0,1.02-.27,1.3-.72.29-.45.32-1,.1-1.48l-.71-1.54,1.24,1.15c.29.27.66.41,1.05.41.74,0,1.38-.53,1.52-1.25l.33-1.66M9.44,0c-.11,0-.21.07-.24.2l-.83,4.18c-.08.4-.43.65-.79.65-.19,0-.38-.07-.54-.21L3.92,1.91c-.05-.05-.11-.07-.16-.07-.16,0-.3.17-.22.35l1.79,3.87c.25.54-.15,1.14-.72,1.14-.03,0-.07,0-.1,0L.27,6.68s-.02,0-.03,0c-.24,0-.34.33-.11.45l3.72,2.08c.55.31.55,1.09,0,1.4L.12,12.69c-.22.12-.13.45.11.45.01,0,.02,0,.03,0l4.23-.5s.07,0,.1,0c.57,0,.97.6.72,1.14l-1.79,3.87c-.08.18.06.35.22.35.06,0,.11-.02.16-.07l3.12-2.89c.16-.15.35-.21.54-.21.36,0,.71.24.79.65l.83,4.18c.03.13.13.2.24.2s.21-.07.24-.2l.83-4.18c.08-.4.43-.65.79-.65.19,0,.38.07.54.21l3.12,2.89c.05.05.11.07.16.07.16,0,.3-.17.22-.35l-1.79-3.87c-.25-.54.15-1.14.72-1.14.03,0,.07,0,.1,0l4.23.5s.02,0,.03,0c.24,0,.34-.33.11-.45l-3.72-2.08c-.55-.31-.55-1.09,0-1.4l3.72-2.08c.22-.12.13-.45-.11-.45-.01,0-.02,0-.03,0l-4.23.5s-.07,0-.1,0c-.57,0-.97-.6-.72-1.14l1.79-3.87c.08-.18-.06-.35-.22-.35-.06,0-.11.02-.16.07l-3.12,2.89c-.16.15-.35.21-.54.21-.36,0-.71-.24-.79-.65L9.68.2c-.03-.13-.13-.2-.24-.2h0Z"/></svg>`,
  };
  function typeTagEl(post) {
    const past = isPastActivity(post);
    const label = past ? 'Happened' : (TYPE_LABEL[post.type] || post.type);
    const cls = past ? 'past' : post.type;
    return `<span class="type-icon type-icon--${cls}" role="img" aria-label="${esc(label)}">` +
      `${TYPE_ICON[post.type] || ''}</span>`;
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
    return esc(text).replace(MENTION_RE, (m, lead, handle) => {
      const u = Store.user(handle);
      if (!u || !Store.areFriends(author, handle)) return m;
      const name = esc(u.name);
      return lead + (opts.link === false
        ? `<strong class="mention">${name}</strong>`
        : `<a class="mention" href="#/u/${esc(encodeURIComponent(handle))}">${name}</a>`);
    });
  }

  // The note block for a text entry. Paragraphs always render intact; a long note
  // additionally wraps them in a height-clamped clip + a "Read more" toggle. Open
  // state lives in `openReadMore` so it survives a card rebuild (like openComments).
  function cardNoteHtml(post) {
    if (!post.note) return '';
    const body = noteParas(post.note).map(p => notePara(p, post.author)).join('');
    if (post.note.length <= READMORE_MIN) return body;

    const open = openReadMore.has(post.id);
    return `<div class="readmore${open ? ' open' : ''}">` +
        `<div class="readmore-clip">${body}</div>` +
        `<button class="readmore-toggle" type="button" aria-expanded="${open}">` +
          `${open ? 'Read less' : 'Read more'}</button>` +
      `</div>`;
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
      setOpen(false);
      scrollCardIntoView(el);
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
    const listId = `mentions-${++mentionSeq}`;
    const list = document.createElement('ul');
    list.className = 'mention-list';
    list.id = listId;
    list.setAttribute('role', 'listbox');
    list.hidden = true;
    const live = document.createElement('div');
    live.className = 'visually-hidden';
    live.setAttribute('aria-live', 'polite');
    // The comment form is a flex row, so the list sits after the form itself;
    // in the composer/edit stacks it sits right under the textarea.
    const anchor = field.closest('.comment-form') || field;
    anchor.insertAdjacentElement('afterend', list);
    list.insertAdjacentElement('afterend', live);
    field.setAttribute('aria-autocomplete', 'list');
    field.setAttribute('aria-expanded', 'false');

    let items = [];        // matched user objects
    let active = -1;       // highlighted row
    let token = null;      // {start, end} of the "@query" being typed

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
      field.setRangeText(`@${u.username} `, token.start, token.end, 'end');
      close();
      field.focus();
    };

    const update = () => {
      const caret = field.selectionStart;
      // Only while the caret sits at the end of an "@word" that starts the
      // text or follows whitespace — never mid-email, never after letters.
      const m = /(?:^|\s)@([a-z0-9_]*)$/i.exec(field.value.slice(0, caret));
      if (!m) { close(); return; }
      const q = m[1].toLowerCase();
      items = Store.friends().map(Store.user).filter(u => u &&
        (u.username.includes(q) || u.name.toLowerCase().includes(q)));
      if (!items.length) { close(); return; }
      token = { start: caret - m[1].length - 1, end: caret };
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
    return `<button class="card-like${liked ? ' liked' : ''}" type="button" aria-pressed="${liked}" ` +
        `aria-label="${liked ? 'Unlike' : 'Like'}" title="${liked ? 'Liked' : 'Like'}">` +
        svgIcon('heart') +
      `</button>`;
  }

  // Attendees — activities only, and public (unlike likes): the count is the
  // point. The people-glyph + count anchor the LEFT of the action row for host
  // and guests alike (gradient-filled like a liked heart — see .card-attendees);
  // tapping opens the who's-going panel.
  function attendeesHtml(post) {
    if (post.type !== 'activity') return '';
    if (!canSocial(post)) return '';
    const n = Store.headcountFor(post.id).length;
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
        `aria-label="${going ? 'You’re in. Tap to bow out' : 'Count me in'}" ` +
        `title="${going ? 'You’re in' : 'Count me in'}">` +
        (going ? `<span>going</span>${svgIcon('check')}` : `<span>going?</span>`) +
      `</button>`;
  }

  // Add-to-calendar — activities with a date only, same friends gate as the
  // hand-up toggle, and gone once the plan has Happened. Sits at the left of the
  // action row beside the attendee count; tapping downloads a one-event .ics the
  // phone hands to whatever calendar the person actually uses.
  function calendarBtnHtml(post) {
    if (post.type !== 'activity' || !post.eventDate || isPastActivity(post)) return '';
    if (!canSocial(post)) return '';
    return `<button class="card-cal" type="button" aria-label="Add to calendar" ` +
        `title="Add to calendar">${svgIcon('cal')}</button>`;
  }

  function goingPanelHtml(post) {
    if (post.type !== 'activity') return '';
    if (!canSocial(post)) return '';
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
    const attendees = attendeesHtml(post);
    const rsvp = goingToggleHtml(post);
    const like = likeButtonHtml(post);
    const n = Store.commentsFor(post.id).length;
    const expanded = openComments.has(post.id);
    const comment = canSocial(post)
      ? `<button class="card-comment" type="button" aria-expanded="${expanded}" ` +
          `aria-label="${n ? n + ' comment' + (n === 1 ? '' : 's') : 'Comments'}" title="Comments">` +
          svgIcon('comment') +
          (n ? `<span class="card-comment-count">${n}</span>` : '') +
        `</button>`
      : '';
    // Just the edit pencil now — the destructive delete moved inside the edit
    // form (see makeEditCard), so the card row carries one quiet owner tool that
    // leads the left of the row (leftmost), ahead of the plan glyphs.
    const owner = opts.owner
      ? `<button class="card-edit" type="button" data-edit="${esc(post.id)}" ` +
          `aria-label="Edit this post" title="Edit post">${svgIcon('pencil')}</button>`
      : '';

    if (!cal && !attendees && !rsvp && !like && !comment && !owner) return '';

    // Activities split into two ends. LEFT: the owner's edit pencil (leftmost, on
    // your own profile only), then calendar + attendee count — the plan. RIGHT:
    // the RSVP toggle, then comments + likes. RSVP leads the social cluster so
    // comment + like are ALWAYS the two rightmost glyphs, in the exact same spot
    // whether or not an RSVP rides along. Holds on the feed and every profile.
    if (post.type === 'activity') {
      const meta = `<div class="card-meta">${owner}${cal}${attendees}</div>`;
      const social = `<div class="card-social">${rsvp}${comment}${like}</div>`;
      return `<div class="card-actions card-actions--activity">${meta}${social}</div>`;
    }

    // Everything non-activity — a single row: social cluster on the right, the
    // edit tool tucked left (row-reverse).
    return `<div class="card-actions"><div class="card-social">${cal}${attendees}${rsvp}${comment}${like}</div>${owner}</div>`;
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
      const d = post.image ? imageDimsFromUrl(post.image) : null;
      const img = post.image
        ? { src: post.image, alt: post.note || 'Photo', w: d && d.w, h: d && d.h }
        : placeholderPhoto(post.id, post.note);
      // Known dimensions → width/height attributes let the browser hold the exact
      // space before the photo loads (no feed reflow). Legacy photos without a
      // stamped size fall back to a reserved box, cleared once the image lands.
      const sized = img.w && img.h;
      const foot = (post.note ? `<p class="card-note">${richText(post.note, post.author)}</p>` : '') + tagChips(post);
      // .card-main holds the post itself (ending in the action row); the comment
      // thread expands as a sibling below, tucked under it on the same left axis.
      el.innerHTML =
        `<div class="card-main">` +
          head +
          (foot ? `<div class="card-foot">${foot}</div>` : '') +
          `<figure class="photo${sized ? '' : ' photo--reserve'}" tabindex="0" role="button" aria-label="Enlarge photo">` +
            `<img src="${img.src}" alt="${esc(img.alt)}"${sized ? ` width="${img.w}" height="${img.h}"` : ''} loading="lazy" decoding="async">` +
          `</figure>` +
          actions +
        `</div>` +
        likersPanelHtml(post) +
        commentsPanelHtml(post);
      wirePhoto(el, img);
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
    // whole — the Read-more clamp would nest a button inside the anchor.
    const linkedNote = post.type === 'find' && post.url && !post.title && post.note;
    const noteHtml = linkedNote
      ? `<a class="card-note-link" href="${esc(post.url)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ''}>` +
          noteParas(post.note).map((p, i, arr) =>
            `<p class="card-note">${richText(p, post.author, { link: false })}${i === arr.length - 1 && external
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
      ? `<p class="card-location"><a class="card-location-link" href="${esc(mapsUrl(post.location))}" ` +
          `target="_blank" rel="noopener noreferrer">${svgIcon('pin', 'card-location-ico')}` +
          `<span>${esc(post.location)}</span></a></p>`
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
    wireCardCollapse(el, post);
    return el;
  }

  function wirePhoto(el, img) {
    const fig = el.querySelector('.photo');
    if (!fig) return;
    // A legacy photo (no stamped size) reserves a neutral box until it loads;
    // release it once the real image lands so the figure takes the true height.
    if (fig.classList.contains('photo--reserve')) {
      const im = fig.querySelector('img');
      const clear = () => fig.classList.remove('photo--reserve');
      if (im && im.complete) clear();
      else im && im.addEventListener('load', clear, { once: true });
    }
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
    toggleBtn.addEventListener('click', async () => {
      // Bowing out is a small commitment to undo — the host planned around the
      // headcount — so confirm before dropping off. Joining stays one tap.
      if (Store.goingByMe(post.id) &&
          !window.confirm('Take your name off the headcount for this plan?')) return;
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
              `<input type="text" name="text" maxlength="300" placeholder="Add a comment…">` +
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
    const input = panel.querySelector('.comment-form input');
    const submitBtn = panel.querySelector('.comment-form button[type="submit"]');
    wireMentions(input);

    // The Post button is inert until there's something to post — flip `disabled`
    // as the field fills/empties (drives the dimmed look; blocks empty submits).
    const syncSubmit = () => { submitBtn.disabled = !input.value.trim(); };
    input.addEventListener('input', syncSubmit);
    syncSubmit();

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
    // never re-animates — including your OWN posts: rather than re-rendering the
    // whole column (which would replay every card's rise), we rebuild this one
    // card and re-wire its owner edit/delete controls via opts.wireOwner.
    const apply = (dir) => {
      openComments.add(post.id);
      const fresh = makeCard(post, opts);
      fresh.style.animation = 'none';               // no rise flash on an in-place swap
      // Roll the comment count in its new direction (up on add, down on delete).
      if (dir) fresh.querySelector('.card-comment-count')
        ?.classList.add(dir === 'up' ? 'count-tick-up' : 'count-tick-down');
      el.replaceWith(fresh);
      opts.wireOwner?.(fresh);                       // re-attach edit/delete on own posts
      fresh.querySelector('.comment-form input')?.focus();
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
      btn.addEventListener('click', async () => {
        if (!window.confirm('Delete this comment?')) return;
        await Store.deleteComment(btn.dataset.comment);
        apply('down');
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
          `<textarea id="e-note" rows="2" maxlength="5000" ` +
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
          `<textarea id="e-note" rows="2" maxlength="5000" ` +
            `placeholder="When to show up, what to bring.">${esc(post.note || '')}</textarea>` +
        `</div>` + tagsInput;
    }

    if (post.type === 'photo') {
      return `<div class="field">` +
          `<label for="e-note">Caption</label>` +
          `<textarea id="e-note" rows="2" maxlength="5000" ` +
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
        `<textarea id="e-note" rows="4" maxlength="5000" ` +
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
          `<button type="button" class="edit-delete" aria-label="Delete this post" ` +
            `title="Delete post">${svgIcon('trash')}<span>Delete</span></button>` +
          // One button that reads "Cancel" until a field changes, then becomes the
          // accent "Save changes" — see the dirty-tracking wiring in renderUser.
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
    return `<header class="masthead">` +
        (kicker ? `<p class="masthead-kicker">${kicker}</p>` : '') +
        `<div class="masthead-row">` +
          `<h1 class="masthead-title">${title}</h1>` +
          (actions || '') +
        `</div>` +
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
        card.style.animationDelay = staggerDelay(i);
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
            svgIcon('send', 'account-share-ico') +
            `<span class="account-share-label">Share</span>` +
          `</button>` +
        `</div>`
      : (() => {
          // Four-state tie button: add / requested (pending, sent) / accept
          // (they asked first) / friends. The two "I've committed" states —
          // friends and sent — wear the muted outline (aria-pressed) and undo on
          // tap; add + accept wear the filled accent and create my edge.
          const s = Store.friendStatus(u.username);
          const label = { none: 'Add friend', sent: 'Requested', incoming: 'Accept request', friends: 'Friends' }[s];
          const committed = s === 'friends' || s === 'sent';
          const title = s === 'sent' ? ' title="Tap to cancel your request"'
                      : s === 'friends' ? ' title="Tap to remove"' : '';
          return `<button class="friend-btn" type="button" id="friend" ` +
            `data-status="${s}" aria-pressed="${committed}"${title}>${esc(label)}</button>`;
        })();

    const count = `${list.length} ${list.length === 1 ? 'post' : 'posts'}`;
    // Friend COUNT is public — it reads the same on your own profile and anyone
    // else's. But WHO those friends are is circle business: only you or a friend
    // can tap through to the list. To everyone else the count is plain text.
    const fc = Store.friendsOf(u.username).length;
    const fLabel = `${fc} ${fc === 1 ? 'friend' : 'friends'}`;
    const canSeeFriends = (isSelf || isFriend) && fc > 0;
    const friendStat = canSeeFriends
      ? `<button type="button" class="profile-friends" id="show-friends">${fLabel}</button>`
      : `<span>${fLabel}</span>`;
    const stats = `${count} <span class="dot">·</span> ${friendStat}`;

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
      `</section>`;

    // Their posts as a single-author column (slim date line, not a repeated
    // byline). Photos keep the lightbox; tags jump to the home feed filtered.
    const feedEl = view.querySelector('#feed');

    // Wire the owner edit control within a root (the whole column on first
    // render, or a single rebuilt card after an in-place comment swap — see
    // wireComments' opts.wireOwner). Edit swaps the card for a form; delete now
    // lives inside that form (wired below).
    const wireOwner = (root) => {
      root.querySelectorAll('.card-edit').forEach(btn =>
        btn.addEventListener('click', () => {
          editingId = btn.dataset.edit;
          renderUser(username);
        }));
    };

    if (!list.length) {
      feedEl.innerHTML = `<p class="feed-empty">` +
        `${isSelf ? 'Nothing posted yet. Whenever you’re ready.' : 'Nothing here yet.'}</p>`;
    } else {
      const frag = document.createDocumentFragment();
      list.forEach((p, i) => {
        const card = (isSelf && p.id === editingId)
          ? makeEditCard(p)
          : makeCard(p, { solo: true, owner: isSelf, wireOwner });
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

    // Owner controls (own profile only) for the freshly rendered column.
    wireOwner(feedEl);

    const editForm = feedEl.querySelector('.edit-form');
    if (editForm) {
      // Snapshot the fields exactly as rendered. The lone toggle stays a quiet
      // "Cancel" until any field diverges from that baseline, then flips to the
      // accent "Save changes" — so Save never shows on an untouched form, and
      // reverting an edit drops it back to Cancel.
      const toggle = editForm.querySelector('.edit-toggle');
      const snapshot = () => Array.from(editForm.querySelectorAll('input, textarea'))
        .map(el => el.value).join('\u0000');
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
      editForm.querySelector('.edit-delete')?.addEventListener('click', async () => {
        if (!window.confirm('Delete this post? This can’t be undone.')) return;
        const id = editingId;
        editingId = null;
        await Store.deletePost(id);
        renderUser(username);
      });
      editForm.addEventListener('submit', (e) => {
        e.preventDefault();
        if (dirty()) submitEdit(editingId, username);   // Enter saves, but never a no-op
      });
      wireMentions(editForm.querySelector('#e-note'));
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
      // friends → unfriend, sent → cancel; add / accept both create my edge.
      const committed = friendBtn.dataset.status === 'friends' || friendBtn.dataset.status === 'sent';
      if (committed) await Store.removeFriend(u.username);
      else await Store.addFriend(u.username);
      renderUser(username);      // reflect the new state in place
    });

    const shareBtn = document.getElementById('share');
    if (shareBtn) shareBtn.addEventListener('click', () => {
      const label = shareBtn.querySelector('.account-share-label');
      shareOrCopy({
        title: `@${u.username} on Tria`,
        text: `Come find me on Tria.`,
        url: profileLink(u.username),
      }).then(result => {
        if (result === 'cancelled') return;
        shareBtn.classList.add('copied');
        label.textContent = result === 'copied' ? 'Link copied' : 'Shared';
        clearTimeout(shareBtn._t);
        shareBtn._t = setTimeout(() => {
          shareBtn.classList.remove('copied');
          label.textContent = 'Share';
        }, 1800);
      });
    });

    const editPhotoBtn = document.getElementById('edit-photo');
    if (editPhotoBtn) editPhotoBtn.addEventListener('click',
      () => openAvatarEditor(() => renderUser(username)));

    const editProfileBtn = document.getElementById('edit-profile');
    if (editProfileBtn) editProfileBtn.addEventListener('click',
      () => openProfileEditor(() => renderUser(username)));

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
      `<div class="modal-card modal-card--list">` +
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
  function openAvatarEditor(done) {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Change your photo');
    modal.innerHTML =
      `<div class="modal-card modal-card--glass">` +
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

    const close = modalCloser(modal, () => document.removeEventListener('keydown', onEsc));
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
      `<div class="modal-card modal-card--glass">` +
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
          // Notifications sits with the profile fields as a quiet setting.
          pushToggleHtml() +
          `<p class="composer-error" id="pf-error" role="alert"></p>` +
          // Log out weights to the far left (styled like the post editor's Delete)
          // so it's never the accidental tap next to Save.
          `<div class="modal-actions">` +
            `<button type="button" class="edit-delete pf-logout" id="pf-logout">Log out</button>` +
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

    modal.querySelector('#pf-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const res = await Store.updateProfile({ name: nameEl.value, bio: bioEl.value });
      if (!res.ok) { errEl.textContent = res.error; return; }
      close();
      done();
    });

    // Account controls: the notifications toggle and Log out, now homed here.
    wirePushToggle();
    modal.querySelector('#pf-logout').addEventListener('click', async () => {
      await Store.logout();
      authMode = 'login';        // returning user — offer login first
      close();
      go('#/');
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

  /* ── Friends (your mutual circle) + Discover (people you haven't added) ───────
     Two pills split the page, echoing the feed's filter menu: My circle wears
     the Post button's gradient, Find friends stays monochrome like All. */
  let friendsTab = 'circle';
  let friendsQuery = '';   // live filter over the shown list (name + @username)
  function renderFriends() {
    const me = Store.session();
    const friendSet = new Set(Store.friends());
    const byName = (a, b) => a.name.localeCompare(b.name);

    const friends = Store.friends().map(Store.user).filter(Boolean).sort(byName);
    // Everyone signed up who isn't you and isn't already a friend.
    const discover = Store.users()
      .filter(u => u.username !== me && !friendSet.has(u.username))
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
    const listHtml = onCircle
      ? (friends.length
          ? `<div class="friends-list">` + friends.map(u => row(u, false)).join('') + `</div>`
          : `<p class="feed-empty">Your circle’s empty, for now.</p>`)
      : (discover.length
          ? `<div class="friends-list">` + discover.map(u => row(u, true)).join('') + `</div>` + shareAsk
          : `<p class="feed-empty">No one new to add right now.</p>` + shareAsk);
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
    view.innerHTML =
      `<section class="view">` +
        mastheadEl(circleCount, 'Friends', searchAction) +
        `<div class="filters" role="group" aria-label="Show">` +
          `<button class="filter publish-fill" type="button" data-tab="circle" ` +
            `aria-pressed="${onCircle}">My circle</button>` +
          `<button class="filter filter--mono" type="button" data-tab="find" ` +
            `aria-pressed="${!onCircle}">Find friends</button>` +
        `</div>` +
        `<p class="feed-empty friend-search-empty" hidden>No one by that name.</p>` +
        listHtml +
      `</section>`;

    // Rows rise in with the feed's stagger, so switching pills feels like a feed.
    // Stamp each row's natural order so the search can restore it after reordering.
    view.querySelectorAll('.friend').forEach((el, i) => {
      el.style.animationDelay = staggerDelay(i);
      el.dataset.order = i;
    });

    // Live search over the shown list — filter rows in place (no re-render, so the
    // field keeps focus as you type) against name + @username. The share ask and
    // "no matches" note toggle to match. State persists in friendsQuery so the
    // filter survives a tab switch's re-render.
    const searchEl = view.querySelector('#friend-search');
    const toggleBtn = view.querySelector('#friend-search-toggle');
    const masthead = view.querySelector('.masthead');
    const listEl = view.querySelector('.friends-list');
    const searchEmpty = view.querySelector('.friend-search-empty');
    const shareEl = view.querySelector('.friends-share');
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
      if (!listEl) return;
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

    view.querySelectorAll('.filter[data-tab]').forEach(btn =>
      btn.addEventListener('click', () => {
        if (friendsTab === btn.dataset.tab) return;
        friendsTab = btn.dataset.tab;
        renderFriends();
      }));

    // Add (or accept) from a Discover row: create my edge, then re-render — a
    // mutual add moves them into your circle, a fresh one flips to "Requested".
    // The button sits inside the row link, so stop it navigating.
    view.querySelectorAll('.friend-add[data-add]').forEach(btn =>
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        btn.disabled = true;
        await Store.addFriend(btn.dataset.add);
        renderFriends();
      }));

    // Take back a request already sent (the "Requested" pill).
    view.querySelectorAll('.friend-add[data-cancel]').forEach(btn =>
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        btn.disabled = true;
        await Store.removeFriend(btn.dataset.cancel);
        renderFriends();
      }));

    // The share ask on an empty Discover list: native share sheet where it
    // exists, clipboard copy as the desktop fallback. Confirm softly either way.
    const shareBtn = view.querySelector('.friends-share-copy');
    if (shareBtn) shareBtn.addEventListener('click', async () => {
      const result = await shareOrCopy({
        title: 'Tria',
        text: 'Come find me on Tria.',
        url: 'https://triaonline.com',
      });
      if (result === 'cancelled') return;
      const label = shareBtn.querySelector('span');
      label.textContent = result === 'copied' ? 'Link copied' : 'Shared';
      setTimeout(() => { label.textContent = 'Share Tria'; }, 1600);
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

  // "…liked ‘Metalheart’" — name the post by its title or a note snippet, so a
  // row is recognisable without leaving the list.
  function notifPostLabel(post) {
    if (!post) return 'a post';
    const t = post.title || post.note || '';
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
                             `is in for ${label}`;
    // Mentions live on someone else's post, so the row walks to that profile;
    // everything else lands on your own column.
    const href = (n.kind === 'mention' && post)
      ? `#/u/${esc(encodeURIComponent(post.author))}` : '#/profile';
    const fresh = n._ts && n._ts > lastSeen;
    return `<li>` +
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

  // Filter pills over the ledger — same chip language as the home feed.
  // Only mentions get their own pill; every other kind just shows under All.
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
      `<li class="request-row">` +
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
          `<button type="button" class="push-ask-on publish-fill" id="push-turn-on">Turn on</button>` +
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
    const list = notifFilter === 'all' ? all : all.filter(n => n.kind === notifFilter);
    const lastSeen = localStorage.getItem(notifSeenKey()) || '';
    const requestsHtml = friendRequestsHtml();
    view.innerHTML =
      `<section class="view">` +
        mastheadEl('', 'Updates') +
        pushAskHtml() +
        `<div class="filters" role="group" aria-label="Filter updates">` +
          NOTIF_FILTERS.map(f =>
            `<button class="filter" type="button" data-filter="${f.key}" ` +
              `aria-pressed="${f.key === notifFilter}">${f.label}</button>`).join('') +
        `</div>` +
        requestsHtml +
        (list.length
          ? `<ul class="notif-list">${list.map(n => notifItemHtml(n, lastSeen)).join('')}</ul>`
          : requestsHtml
            ? ''   // requests are up top; don't also say "all quiet" beneath them
            : `<p class="feed-empty">${all.length
                ? 'No mentions yet.'
                : 'All quiet. When a friend likes, comments, or raises a hand, it lands here.'}</p>`) +
      `</section>`;

    wirePushAsk(renderUpdates);

    view.querySelectorAll('.filter[data-filter]').forEach(btn =>
      btn.addEventListener('click', () => {
        if (notifFilter === btn.dataset.filter) return;
        notifFilter = btn.dataset.filter;
        renderUpdates();
      }));

    // Answer a friend request in place. Accept adds them back (→ mutual, they
    // now show in each other's feeds); Ignore clears the request quietly.
    view.querySelectorAll('.request-accept').forEach(btn =>
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        await Store.addFriend(btn.dataset.accept);
        renderUpdates();
      }));
    view.querySelectorAll('.request-ignore').forEach(btn =>
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        await Store.removeFriend(btn.dataset.ignore);
        renderUpdates();
      }));

    // Rows rise in with the feed's stagger, same as the Friends page — the
    // request rows lead, the ledger follows.
    view.querySelectorAll('.request-row, .notif').forEach((el, i) => {
      el.style.animationDelay = staggerDelay(i);
    });

    // A row walks you to the post itself (your profile column) with the right
    // panel already open — the comment thread, who liked, or who's going —
    // and the profile render scrolls that card into view (see spotlightPost).
    view.querySelectorAll('.notif').forEach(row =>
      row.addEventListener('click', () => {
        const id = row.dataset.post;
        openComments.delete(id); openLikers.delete(id); openGoing.delete(id);
        if (row.dataset.kind === 'comment' || row.dataset.kind === 'mention') openComments.add(id);
        else if (row.dataset.kind === 'like') openLikers.add(id);
        else openGoing.add(id);
        spotlightPost = id;
      }));

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
        // Title + why-share ride in one bordered box, split by a divider — the
        // headline reads as the lead, the caption as the note beneath it.
        `<div class="field field--combo">` +
          `<input id="c-title" class="combo-title" type="text" maxlength="120" ` +
            `placeholder="Title (optional)" aria-label="Title">` +
          `<div class="combo-divider" aria-hidden="true"></div>` +
          `<textarea id="c-note" class="combo-note" rows="2" maxlength="5000" ` +
            `placeholder="Why’s it worth their two minutes?" aria-label="Why share it"></textarea>` +
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
        `</div>` +
        `<div class="field">` +
          `<label for="c-note">Details</label>` +
          `<textarea id="c-note" rows="2" maxlength="5000" ` +
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
          `<textarea id="c-note" rows="2" maxlength="5000" ` +
            `placeholder="Say something, or let the photo do the talking."></textarea>` +
        `</div>` + tags;
    }

    // post — headline + note share one bordered box, split by a divider: the
    // optional title reads as the lead, the note flows beneath it.
    return `<div class="field field--combo">` +
        `<input id="c-title" class="combo-title" type="text" maxlength="120" ` +
          `placeholder="Headline (optional)" aria-label="Headline">` +
        `<div class="combo-divider" aria-hidden="true"></div>` +
        `<textarea id="c-note" class="combo-note" rows="4" maxlength="5000" ` +
          `placeholder="${esc(randomNotePlaceholder())}" aria-label="Your note" autofocus></textarea>` +
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
          `<button class="composer-submit composer-post" type="submit">Post</button>` +
        `</form>` +
      `</section>`;

    const fieldsEl = view.querySelector('#c-fields');

    function mountFields() {
      cropper = null;
      // Fresh fields carry no pending photo decode — clear any hold left on Post
      // (e.g. switching type away from a photo mid-decode; see wirePhotoPicker).
      const submitBtn = view.querySelector('.composer-submit');
      if (submitBtn) submitBtn.disabled = false;
      fieldsEl.innerHTML = fieldsFor(pubType);
      wireMentions(fieldsEl.querySelector('#c-note'));
      if (pubType === 'photo') wirePhotoPicker(fieldsEl);
      if (pubType === 'activity') {
        wireWhenHints(fieldsEl);
        wireLocationSuggest(fieldsEl.querySelector('#c-location'));
      }
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
        // Hold Post until the preview has decoded — export() reads naturalWidth,
        // so posting before the image is ready would ship a 1×1 canvas. Re-enable
        // on load (or straight away if the browser already had it decoded).
        const submitBtn = document.querySelector('.composer-submit');
        if (submitBtn) {
          submitBtn.disabled = true;
          const ready = () => { submitBtn.disabled = false; };
          if (imgEl.complete && imgEl.naturalWidth) ready();
          else imgEl.addEventListener('load', ready, { once: true });
        }
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
      if (!data.location) {
        errEl.textContent = 'Add a place so people know where to show up.'; return;
      }
      if (data.eventTime && !data.eventDate) {
        errEl.textContent = 'Add a date to go with that time.'; return;
      }
    } else if (pubType === 'photo') {
      if (!cropper) { errEl.textContent = 'Choose a photo first.'; return; }
      data.image = cropper.export();
      data.imageDims = cropper.dims;   // stamped into the filename → zero feed reflow
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
      if (!data.location) {
        errEl.textContent = 'Add a place so people know where to show up.'; return;
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
    // About is the front door — greet it with the same self-lit, hue-drifting
    // glow signed-out visitors already see on the gate, so the page reads the
    // same either side of sign-in. Locked to the viewport bottom (see .ambient),
    // rising up under the guidelines and the floating nav.
    if (path.split('?')[0] === '#/about') { body.dataset.ambient = 'about'; return; }
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
      `<section class="view about">` +
        (gated ? `<p class="about-back"><a href="#/">&larr; Back to sign in</a></p>` : '') +
        mastheadEl('Social media is so back.', 'About Tria') +
        `<div class="about-body">` +
          `<p class="about-lede">Tria is a social media app built around <em>real ` +
            `relationships</em>. Whether you're keeping up with lifelong friends, ` +
            `or finding your people for the first time, Tria ` +
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
        default:          location.hash = '#/';
      }
    });

    if (!spotlighting) scrollTop(false);   // spotlight scrolls itself (see above)
    nudgeNav();           // iOS: force the bottom nav to re-composite after the swap
    refreshWorld(path);   // Circle/Updates: quietly re-pull behind the render
  }

  // iOS Safari (standalone) sometimes drops the fixed, backdrop-filtered bottom
  // nav's layer after a page's DOM is replaced, leaving it invisible until you
  // scroll. Toggling display off/on forces a relayout + repaint that brings it
  // back. Cheap (one small element) and a no-op visually since it's synchronous.
  function nudgeNav() {
    const nav = document.getElementById('nav');
    if (!nav) return;
    nav.style.display = 'none';
    void nav.offsetHeight;   // flush the layout so the toggle actually repaints
    nav.style.display = '';
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

  // Register the push service worker (idempotent). It caches nothing (see sw.js)
  // so it never fights the ?v= self-updater — it only enables Web Push delivery
  // for anyone who's turned notifications on.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* push simply stays off */ });
  }

  // Load the world from Supabase before the first render (this resolves any
  // persisted session too). On failure we still route — straight to the gate.
  Store.init().then(route).catch((err) => {
    console.error('Boot failed:', err);
    route();
  }).finally(dismissSplash);
})();
