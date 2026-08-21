/* ── Tria app ──────────────────────────────────────────────────────────────
   A tiny hash router over a handful of views — My Circle (the feed), Friends,
   Updates, Profile (own + any friend's, at #/u/username), Publish, and the
   public About page. Every view renders into #view and inherits the router's
   page transition (see renderPage). */

(function () {
  'use strict';

  // ── Error breadcrumbs ──────────────────────────────────────────────────────
  // First thing in the file, because an exception thrown during boot is the one
  // nobody can reconstruct afterwards.
  //
  // Nothing here used to install these at all, so a render that threw left NO
  // trace: the page stopped half-drawn or blank, the exception unwound into
  // nothing, and the entire report was "it broke". On the web that's one devtools
  // tab away. In the App Store build it takes a Mac, a cable and Safari's
  // inspector already attached BEFORE the thing happens, which is never how it
  // happens, so a real failure on a real phone was unreadable by construction.
  //
  // Which is why these land in localStorage as well as the console, and that half
  // is the point: storage outlives the document, so the last few are still
  // readable after a reload, after WebKit kills the WebContent process and
  // Capacitor reloads the webview under us, and hours later on a device nobody
  // was watching. Read them back with JSON.parse(localStorage['tria:errors']).
  //
  // Capped at ten, one stack frame deep, newest first. This is a breadcrumb
  // trail and not telemetry: it never leaves the phone, it never reaches the UI,
  // and a render erroring in a loop can't fill the quota.
  const ERR_KEY = 'tria:errors';
  const logError = (what, err) => {
    const e = err instanceof Error ? err : null;
    console.error(`[tria] ${what}:`, err);
    try {
      const log = JSON.parse(localStorage.getItem(ERR_KEY) || '[]');
      log.unshift({
        at: new Date().toISOString(),
        route: location.hash || '#/',
        what,
        msg: String(e?.message ?? err ?? '').slice(0, 300),
        where: (e?.stack || '').split('\n')[1]?.trim().slice(0, 200) || ''
      });
      localStorage.setItem(ERR_KEY, JSON.stringify(log.slice(0, 10)));
    } catch { /* private mode, or a quota not worth fighting over */ }
  };
  window.addEventListener('error', (ev) => {
    // A photo that fails to load fires `error` too, and a feed is mostly photos.
    // Resource errors don't bubble, so they only reach window in the capture
    // phase this listener deliberately isn't in; the target check is the belt.
    if (ev.target && ev.target !== window) return;
    logError('uncaught', ev.error || ev.message);
  });
  window.addEventListener('unhandledrejection', (ev) => logError('unhandled rejection', ev.reason));

  // `stage` is the fixed shell (#view); `view` is the current *page* inside it
  // that every render function fills. The router (see renderPage) replaces one
  // with the next in a single task, so render code just targets `view` and never
  // has to know a navigation happened.
  const stage = document.getElementById('view');
  let view = null;
  let navToken = 0;           // guards a stale settle against a newer navigation
  let lastPath = null;        // the path we were on before the current one (for back links)
  let profileOrigin = '#/discover';  // where a friend profile's "← Back" returns to
  // Set by the tap that opens #/profile/edit and consumed by the render, so the
  // editor knows whether leaving can pop an entry or has to navigate.
  let editorPushed = false;
  let stopActiveCrop = null;  // teardown for the profile editor's cropper (rAF + ResizeObserver)
  // One beat after a page mounts. Not a transition — nothing animates on a route
  // change any more — but the window in which a freshly mounted page is still
  // arriving: photo fades stay off (see `.page.enter` in app.css) and the topbar
  // re-measures once the layout has settled.
  const SETTLE_MS = 240;

  const esc = (s) => String(s ?? '').replace(/[&<>"]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const prefersReduced = () =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // "Is there a cursor and a real keyboard behind this?" — asked wherever a
  // behaviour only makes sense with one (autofocusing a field, Enter-to-submit).
  // A DIFFERENT question from the three shells above: an iOS home-screen PWA and
  // a browser tab on the same phone both answer false, and a desktop browser tab
  // answers true. Kept as one predicate because it was inlined as this exact
  // media string in three places and a fourth was about to make it a habit.
  const finePointer = () =>
    window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  // Tria runs in three shells: a browser tab, a home-screen PWA, and (since the
  // App Store build) a native iOS app wrapping the same files. Capacitor injects
  // its bridge into the webview before any app JS runs, so the global's presence
  // IS the shell test — no user-agent sniffing, and it's the same object the
  // haptics talk to, so one truth serves both.
  //
  // It has to be a function, not a captured boolean: this module is evaluated
  // from a <script> in <head> order, and reading the global once at parse time
  // is exactly the kind of thing that works until it silently doesn't.
  const nativeShell = () => !!window.Capacitor?.toNative;

  // "Am I installed?" — a DIFFERENT question from "am I the native app?", and the
  // three shells each answer it in their own dialect: the App Store build has the
  // Capacitor bridge, an iOS home-screen PWA has navigator.standalone, and every
  // other installed PWA reports display-mode: standalone. No shell answers more
  // than one of those, which is why asking only one of them is always a bug in
  // the other two.
  //
  // It kept being asked in CSS, where only the third dialect exists. That's how
  // .statusbar-scrim ended up dead in the App Store build: it was gated on
  // `@media (display-mode: standalone)`, and Capacitor's webview reports
  // `browser`. So the answer is stamped onto <html> once, here, and the
  // stylesheet reads the attribute instead of re-deriving it from a media
  // feature that only one of the three shells sets.
  const installedShell = () =>
    nativeShell() ||
    navigator.standalone === true ||
    window.matchMedia?.('(display-mode: standalone)').matches === true;

  document.documentElement.dataset.shell = installedShell() ? 'installed' : 'browser';

  // The two pages a signed-out visitor is allowed to read, and the only two that
  // are written for someone who hasn't got an account. They share a masthead, a
  // voice, an ambient wash and the gate's permission to exist, so the router
  // asks this once rather than testing two strings in four places.
  const frontDoor = (path) =>
    path === '#/about' || path === '#/business';

  // The --spring token (tokens.css) doubles as the WAAPI easing for the press
  // engine and the lightbox flight — WAAPI takes the same easing strings CSS
  // does, so the token stays the single source of truth. Read once, lazily.
  let springCache = null;
  const springEase = () =>
    springCache ??
    (springCache =
      getComputedStyle(document.documentElement).getPropertyValue('--spring').trim() ||
      'cubic-bezier(0.3, 1.35, 0.45, 1)');

  // Scroll the page back to the top. Smooth when asked (and motion is allowed),
  // instant on a plain route change.
  const scrollTop = (smooth) =>
    window.scrollTo({ top: 0, behavior: smooth && !prefersReduced() ? 'smooth' : 'auto' });

  /* ── The top bar's hidden state ─────────────────────────────────────────────
     Mobile: the bar steps out of the way while you read down a feed and returns
     the moment you scroll back up (the watcher is further down; the transform
     lives in CSS and only applies at phone widths).

     Hiding is INFERRED from a scroll delta, and that is fine for a thumb — but a
     navigation is not a thumb, and the bar was being left to a scroll event that
     may never come. The router places the window itself (top, a remembered
     position, a spotlighted card), and if the destination happens to already be
     where the window sits, nothing scrolls, no event fires, and the bar keeps a
     `hidden` that was a statement about a page that isn't on screen any more.
     Worse, the page you land on is often SHORTER than the one you left: at the
     top of a page with nothing to scroll there is no gesture left that can bring
     the bar back, so it is gone until you navigate somewhere tall. Hence: the
     router STATES the bar the same way it states the scroll, rather than hoping
     to infer it.

     Two rules, and the asymmetry is deliberate. At the top of a page the bar is
     always shown, because "hidden" only ever meant "you are reading DOWN
     something". Anywhere else it is left exactly as the reader set it — a
     spotlight lands a thousand pixels into a feed, and slamming the bar back
     there would staple a second move onto a navigation meant to be one fade. */
  let barLastY = 0;
  function syncTopbar() {
    const bar = document.querySelector('.topbar');
    if (!bar) return;
    const y = window.scrollY;
    // Also show it on a page too short to scroll at all: there is no way back.
    const canScroll = document.documentElement.scrollHeight - window.innerHeight > 48;
    if (y < 48 || !canScroll) bar.classList.remove('topbar--hidden');
    barLastY = y;    // a placed scroll is not a gesture — don't let the next one measure from it
  }

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

  // Put a targeted card where it needs to be, with NO travel — this runs inside
  // renderFn, so the scroll is set before the page's first paint and the post is
  // simply what's on screen when it arrives.
  //
  // It used to glide: a 460ms eased scroll to the card, then a tinted wash over
  // it, both starting 120ms after the route settled. Three moves stacked on one
  // tap — fade the page in, THEN travel, THEN flash — and the travel got longer
  // and more obviously wrong the older the post was, because a spotlight from
  // Discover or Updates routinely aims a thousand pixels down a feed. Landing
  // already there is not a cheaper version of that animation, it's the correct
  // one: you asked for a post, and the post is the page.
  //
  // The HOLD survives, and matters more now than it did. Everything between the
  // top of the feed and the target is lazy-loaded, so it resolves over the next
  // few hundred ms: legacy photos swap their 3:2 reserve box for the media's real
  // shape, videos resolve, avatars arrive. Each one that lands ABOVE the card
  // shoves it down, and on a page that has only just landed that reads as the
  // post sliding away from you. So for a beat we keep re-aiming every frame —
  // the content moves, the card doesn't. That's scroll anchoring, done by hand
  // because WebKit won't do it for us. Any real input and we're gone; this never
  // fights the user's own scroll.
  function parkCard(el) {
    const aim = () => {
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      // Short card parks in the middle. A card taller than the screen pins its
      // TOP just clear of the masthead instead, since centring something that
      // doesn't fit means arriving with its first line already scrolled off.
      const pad = r.height > vh - 140 ? 88 : (vh - r.height) / 2;
      const max = Math.max(0, document.documentElement.scrollHeight - vh);
      return Math.min(max, Math.max(0, window.scrollY + r.top - pad));
    };

    window.scrollTo(window.scrollX, aim());   // synchronous: before the first paint of the new page
    if (prefersReduced()) return;

    const t0 = performance.now();
    const HOLD = 900;
    const events = ['wheel', 'touchstart', 'keydown'];
    let stopped = false;
    const bail = () => { stopped = true; };
    const done = () => events.forEach(ev => window.removeEventListener(ev, bail));
    events.forEach(ev => window.addEventListener(ev, bail, { passive: true }));

    const step = (now) => {
      if (stopped || now - t0 > HOLD) return done();
      const want = aim();
      if (Math.abs(want - window.scrollY) > 0.5) window.scrollTo(window.scrollX, want);
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // The feed's entrance rhythm: each card/row rises a beat after the one above it,
  // capped so a long list doesn't trail on forever. Shared by every list view.
  const staggerDelay = (i) => Math.min(i * 0.05, 0.4).toFixed(2) + 's';

  // Counts roll like a little odometer: the outgoing value hands off through a
  // one-glyph slot while the new one springs in (the masthead title-swap
  // pattern, miniaturized). Card rebuilds only ever move a count by one, so the
  // old value is derivable from the fresh markup — no need to thread it through.
  function odoTick(countEl, dir) {
    if (!countEl || prefersReduced()) return;
    const now = parseInt(countEl.textContent, 10);
    if (isNaN(now)) return;
    const was = dir === 'up' ? now - 1 : now + 1;
    countEl.classList.add('odo', dir === 'up' ? 'odo--up' : 'odo--down');
    countEl.innerHTML =
      `<span class="odo-new">${now}</span><span class="odo-old">${was}</span>`;
    setTimeout(() => {
      countEl.classList.remove('odo', 'odo--up', 'odo--down');
      countEl.textContent = String(now);
    }, 540);
  }

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
    // Three interlocking rings — overlapping circles, a nod to the name (Tria)
    // and to the wider community you meet on Discover. Kept an outline to sit
    // with the other nav glyphs.
    circle:  '<circle cx="8.5" cy="10" r="3.8"/><circle cx="15.5" cy="10" r="3.8"/><circle cx="12" cy="15.5" r="3.8"/>',
    // One ring — your single, intimate circle (the home feed). The plainest mark
    // against Discover's three, so "the small private one" reads at a glance.
    myCircle: '<circle cx="12" cy="12" r="7"/>',
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
    // The headcount control's glyph, both states in one drawing. The person sits
    // LEFT of centre so the check has somewhere to land — a centred figure would
    // have to jump sideways to make room, which reads as a bug. The check arm
    // ships in every copy and stays hidden (dashed fully out, see .check-arm)
    // until aria-pressed flips: joining DRAWS it on rather than swapping icons.
    // pathLength normalizes the dash math to the arm's real geometry.
    going:   '<circle cx="8.5" cy="8.5" r="3.1"/><path d="M3 20a5.5 5.5 0 0 1 11 0"/>' +
             '<path class="check-arm" pathLength="1" d="m15.5 12.5 2.2 2.2 4.2-4.2"/>',
    // Bare check — the poll's "your pick" mark.
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
    // The tray — an arrow lifting out of an open box. Worn by every share
    // affordance. It replaced an envelope, which promised a message you compose
    // and send; what these buttons actually do is hand a link to the OS. iOS and
    // Android both draw share this way, so the gesture arrives already learned.
    // The header's one-tap Share Tria inlines this same path data in index.html
    // (it has to paint before JS runs) — keep the two in step.
    send:    '<path d="M12 15V3"/><path d="M8 6.5 12 3l4 3.5"/><path d="M5 10v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-9"/>',
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
    // Globe — the "Anyone" audience level (a public post, discoverable by all).
    globe:   '<circle cx="12" cy="12" r="8"/><path d="M4 12h16"/><path d="M12 4a12 12 0 0 1 0 16 12 12 0 0 1 0-16"/>',
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
    // Optically centred IN THE PATH, and only here: the bbox (x 7 → 18.5) sits 0.75
    // units right of the box's middle, ~6% of the triangle's width, because a
    // right-pointing triangle carries its mass at the base and reads left-heavy when
    // its bbox is centred exactly. Don't add a margin to the rendered icon on top of
    // this — the old path leaned right AND .frame-play-ico nudged it right again,
    // which put the triangle 4px off the middle of its own disc.
    play:    '<path d="M7 5.8v12.4a1 1 0 0 0 1.5.85l10-6.2a1 1 0 0 0 0-1.7l-10-6.2a1 1 0 0 0-1.5.85z" fill="currentColor" stroke="none"/>',
    // A framed picture (sun + hills) — the composer's "add a photo or clip" tool.
    image:   '<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><circle cx="8.5" cy="10" r="1.5"/><path d="M4.5 17.5 9 13l3 2.5L15.5 12l4 5"/>',
    // A drop of ink — the profile-colour control on your own identity card.
    // Not a painter's palette: the thumb-hole and the four blobs that make that
    // glyph legible are ~2px each at the 18px this renders at, which is mud. A
    // drop is one closed shape, and the disc it sits in takes the colour it
    // sets, so the icon says "colour" by BEING the colour rather than by
    // drawing the tool you'd change it with.
    // Colour, and it draws the thing it sets rather than a container for it: a
    // ring with one half filled, which is how every OS draws appearance/tint. It
    // survives the size the palette glyph could not — a palette at 19px is three
    // blobs and a hole — and the fill takes the current colour, so at a glance
    // the badge IS the swatch. The half is filled and unstroked on the element
    // so no stylesheet has to know how this one is built.
    tint:    '<circle cx="12" cy="12" r="8.6"/>' +
             '<path d="M12 3.4a8.6 8.6 0 0 0 0 17.2z" fill="currentColor" stroke="none"/>',
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
    { route: '#/',         key: 'myCircle', label: 'My Circle' },
    { route: '#/discover', key: 'circle',   label: 'Discover' },
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
    // Built ONCE and kept, so the links persist across renders and only their
    // aria-current flips. The four destinations ride inside a glass pill; Post
    // floats beside it as its own round button on phones. On desktop .nav-pill is
    // display:contents, so the sidebar sees the same flat column of links it
    // always has.
    if (!nav.querySelector('.nav-pill')) {
      // The four-way speed dial is retired: the composer now surfaces link + photo
      // inline and Activity is one seg-tab tap away, so the + routes straight to the
      // Post composer. dialEl/wireDial are kept dormant in case we ever want a
      // lighter Post/Activity fan here.
      nav.innerHTML =
        `<div class="nav-pill">` +
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
  }

  // There used to be a glideNav() here that measured the current link and moved
  // a blurred gradient lozenge under it on every route change. The marker is now
  // pure CSS — the pill's non-current links sit at reduced opacity and the
  // current one comes forward (see .nav-pill .nav-link in the mobile block) — so
  // the active state costs no layout read, no inline styles, and no per-frame
  // filter work. Nothing calls into the nav on navigation any more beyond the
  // aria-current flip above.

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
  // The same five, pluralised — for prose that has to name a type in the plural
  // ("No frames out here yet" when a filter empties Discover's grid).
  const TYPE_PLURAL = { note: 'notes', find: 'finds', photo: 'frames', activity: 'activities', poll: 'polls' };
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
  const READMORE_MIN_BLOCKS = 5;   // …or with fewer paragraph/heading blocks than this

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
    // A caption written as many short lines (a recipe, a list) blows past the
    // teaser's ~6-line clamp well under the character threshold, so also gate on
    // how many paragraph/heading blocks it renders as — whichever trips first.
    const plainLen = rich ? post.note.replace(/<[^>]+>/g, '').length : post.note.length;
    const blockCount = rich ? (body.match(/<(?:h1|h2|p)[ >]/g) || []).length : noteParas(post.note).length;
    if (plainLen <= READMORE_MIN && blockCount < READMORE_MIN_BLOCKS) return body;

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
  function richNoteField(idp, titleVal, noteHtml, notePh, opts = {}) {
    const tools = opts.tools !== false;   // attach toggles: composer only (see the foot bar below)
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
        // Foot bar. Right (opts.tools): link + photo + poll toggles — each a live toggle
        // that flips the post's inferred type (link → Find, photo → Frame, poll → Poll)
        // and pops the masthead mark. Left (opts.lock): the audience lock, so who sees it
        // and what it is share one row. Both are composer-only — wired in renderPublish
        // (wireAttachBar + wireAudienceLock). An edit card reuses this field with NEITHER:
        // you can't swap a post's media or its type after the fact, so offering the
        // buttons there would only promise something the editor can't do.
        (tools || opts.lock
          ? `<div class="rich-attach${opts.lock ? ' rich-attach--withlock' : ''}" role="group" aria-label="Post options">` +
              (opts.lock ? audienceLockHtml() : '') +
              (tools
                ? `<div class="rich-attach-tools">` +
                    `<button type="button" class="rt-attach" id="${idp}-add-link" ` +
                      `aria-label="Add a link" aria-pressed="false">${svgIcon('link', 'rt-attach-ico')}</button>` +
                    `<button type="button" class="rt-attach" id="${idp}-add-photo" ` +
                      `aria-label="Add a photo or clip" aria-pressed="false">${svgIcon('image', 'rt-attach-ico')}</button>` +
                    `<button type="button" class="rt-attach rt-attach--poll" id="${idp}-add-poll" ` +
                      `aria-label="Add a poll" aria-pressed="false">${svgIcon('poll', 'rt-attach-ico')}</button>` +
                  `</div>`
                : '') +
            `</div>`
          : '') +
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
    if (finePointer()) editor.focus();
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

  // The tag chips, wrapped — reused in text and photo entries. A daily answer
  // leads with the question it answered (a link to everyone else's) in place of
  // the machine tag that carries it; see DAILY_TAG_RE for why the slug never
  // shows. The chip is a link, not a filter button, so the feed's tag wiring
  // (which looks for [data-tag]) leaves it alone.
  function tagChips(post) {
    const occ = dailyForPost(post);
    const tags = shownTags(post);
    if (!occ && !tags.length) return '';
    return `<div class="tags">` +
      (occ ? `<a class="tag tag--daily" data-type="${occ.type}" ` +
          `href="#/daily/${encodeURIComponent(occ.slug)}">` +
          `<span class="tag-daily-cap">Daily</span>` +
          `<span class="tag-daily-q">${esc(occ.prompt)}</span>` +
        `</a>` : '') +
      tags.map(t => `<button class="tag" type="button" data-tag="${esc(t)}">${esc(t)}</button>`).join('') +
      `</div>`;
  }

  /* The one-way-tie vocabulary, in ONE place. A one-way tie to a public account
     is named in two spots — the profile button and the Updates ledger line — so
     they live here rather than as loose strings that drift apart. Change the word
     once, it changes everywhere. (The commit button stays "Add friend": you're
     always reaching for the same thing, a mutual tie. This names what you get
     until they reach back.) There was a third, the kicker over a standing
     "followers" block on Updates; that block is gone — a follow is an event in
     the ledger now, not a list of people waiting on an answer they never needed. */
  const FOLLOW_STATE = 'Following';           // the committed state, on a button
  const FOLLOW_LINE  = 'started following you';   // the ledger row itself

  // Two gates, because the gestures split now that Discover puts strangers in
  // front of each other. The line between them isn't "cheap vs. costly" — it's
  // whether the gesture stays on the screen or lands in the real world.
  //
  // canSocial — likes, comments, AND poll votes. Open on your own post, a
  // friend's, OR any public post. Discover only builds relationships if a
  // stranger can react to what they found; a like leaks nothing (RLS shows the
  // count to the author alone), a comment is the actual conversation, and a
  // public poll wants the wider read — that's the whole reason to make one
  // public.
  //
  // canJoin — RSVP/headcount and add-to-calendar. Activities only, and still
  // friends-only on purpose: a public activity carries a place and a time, so
  // anyone may SEE it but only your circle shows up to it.
  //
  // The store guards every write behind the matching rule too — see
  // Store.addComment / toggleLike / votePoll (open) vs toggleGoing (closed).
  const canSocial = (post) =>
    post.author === Store.session() || Store.isFriend(post.author) || post.audience === 'public';
  const canJoin = (post) =>
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

  // Headcount AND RSVP, one control — activities only. The count is public
  // (unlike likes) and YOU ARE IN IT: joining rolls the number up by one, which
  // is the whole feedback. State lives in the glyph (a check draws onto the
  // person) and its colour, never in a word, so this stays the same species as
  // the comment count beside it instead of being the row's one text toggle.
  //
  // Three shapes, one button:
  //   · friend, plan still ahead → a toggle. One tap puts you in; tapping again
  //     opens the list. Backing out lives at the foot of that panel, one level
  //     down, because an accidental un-RSVP is a genuinely bad outcome (a stray
  //     un-like isn't).
  //   · the host, or a plan that's already happened → plain disclosure. Same
  //     pixels, no toggle.
  // aria-expanded rides every state (the button always controls the panel);
  // aria-pressed appears only where it's actually a toggle, which is also how
  // wireGoing tells the two apart.
  function goingControlHtml(post) {
    if (post.type !== 'activity') return '';
    if (!canJoin(post)) return '';
    const n = Store.headcountFor(post.id).filter(h => !Blocks.has(h.user)).length;
    const open = openGoing.has(post.id);
    const rsvpable = post.author !== Store.session() && !isPastActivity(post);
    const going = rsvpable && Store.goingByMe(post.id);
    return `<button class="card-attendees${going ? ' going' : ''}" type="button" ` +
        `aria-expanded="${open}"${rsvpable ? ` aria-pressed="${going}"` : ''} ` +
        `aria-label="${n} going${going ? ', including you' : ''}. ` +
          `${rsvpable && !going ? 'Count me in' : 'See who'}" ` +
        `title="${rsvpable && !going ? 'Count me in' : 'Who’s going'}">` +
        svgIcon('going') +
        // Always present, even at 0: the headcount is a public planning number
        // ("nobody's in yet" is real info), and the span has to exist for the
        // odometer to roll it on the 0<->1 boundary when you join or bow out.
        `<span class="card-attendees-count">${n}</span>` +
      `</button>`;
  }

  // Add-to-calendar — activities with a date only, same friends gate as the
  // hand-up toggle, and gone once the plan has Happened. It's a "take this plan
  // somewhere else" action, sibling to Copy link, so it lives in the ••• menu
  // rather than as its own glyph (see openPostMenu). This predicate gates it.
  function isCalendarable(post) {
    return post.type === 'activity' && post.eventDate && !isPastActivity(post) && canJoin(post);
  }

  function goingPanelHtml(post) {
    if (post.type !== 'activity') return '';
    if (!canJoin(post)) return '';
    const list = Store.headcountFor(post.id).filter(h => !Blocks.has(h.user));
    const open = openGoing.has(post.id);
    // The way back out sits under the list, the mirror of joining and one level
    // down from it — the host planned around this headcount, so changing your
    // mind should cost a deliberate second tap rather than ride the same button
    // you joined with.
    const out = post.author !== Store.session() && !isPastActivity(post) && Store.goingByMe(post.id)
      ? `<button class="going-out" type="button">${svgIcon('notgoing')}<span>Can’t make it</span></button>`
      : '';
    return `<div class="going-panel${open ? ' open' : ''}">` +
        `<div class="comments-inner">` +
          `<div class="comments-content">` +
            (list.length
              ? `<ul class="likers-list">${list.map(likerItemHtml).join('')}</ul>`
              : `<p class="likers-empty">No one’s going yet.</p>`) +
            out +
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
  // leader is marked. A closed poll locks to a read-only final tally. Voting
  // follows canSocial, so a PUBLIC poll takes anyone's vote — a poll made public
  // is asking the wider room, and a room that can't answer isn't one. A circle
  // poll stays friends-only: a non-friend sees the choices statically, with no
  // results and no way to vote.
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
    const going = goingControlHtml(post);
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

    if (!going && !like && !comment && !menu) return '';

    // One row for every card type now that the headcount and the RSVP are a
    // single control: social cluster on the right, the ••• menu tucked left
    // (row-reverse, so the menu ends up leftmost). Activities used to split the
    // row into two ends to keep the plan away from the gestures — with one fewer
    // control they sit flush with notes and photos instead, which is most of what
    // made them read busy in the feed. The headcount leads the cluster, so
    // comment + like stay the two rightmost glyphs on every card.
    return `<div class="card-actions"><div class="card-social">${going}${comment}${like}</div>${menu}</div>`;
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
      // Frames cap at 5:4 tall — a taller photo reserves (and centre-crops into)
      // the capped box, so the outline you see before it lands is the real crop.
      const tint = img.tint;
      const cropped = sized && frameIsTall(img.w, img.h);
      const frameStyle =
        (sized ? `aspect-ratio:${frameRatio(img.w, img.h)};` : '') +
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
            `<div class="photo-frame${sized ? '' : ' photo-frame--reserve'}${cropped ? ' photo-frame--crop' : ''}"${frameStyle ? ` style="${frameStyle}"` : ''}>` +
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
      wireReadMore(el, post);
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
    // Targeted post ('list', any type): a quiet lock line. The author sees the
    // headcount they picked (feed + their profile); an invited viewer just sees
    // that it's private (they can't read the full allowlist anyway — RLS hands
    // them only their row).
    const iAmAuthor = post.author === Store.session();
    const audienceHtml = post.audience === 'list'
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

  // ── The 5:4 ceiling on feed frames ────────────────────────────────────────
  // A frame in the feed is never taller than 5:4 (height ≤ 1.25 × width). Phone
  // screenshots run 9:19.5, and a screenshot of a playing video arrives padded
  // with black bars top and bottom — at full height both eat the whole column and
  // read as broken. Anything past the ceiling is centre-cropped into it (the bars
  // are the first thing to go). Nothing is lost: tapping still opens the whole
  // uncropped image in the lightbox, which is what tap-to-open is for.
  const FRAME_MAX_TALL = 5 / 4;
  const frameIsTall = (w, h) => !!(w && h) && h / w > FRAME_MAX_TALL;
  // What the frame should reserve: the media's own shape, or the capped box.
  const frameRatio = (w, h) => frameIsTall(w, h) ? '4 / 5' : `${w} / ${h}`;
  // Stamp that onto a live .photo-frame. .photo-frame--crop is what switches the
  // media from "fill the width, take its own height" to "cover the capped box".
  function capFrame(frame, w, h) {
    if (!frame || !w || !h) return;
    frame.style.aspectRatio = frameRatio(w, h);
    frame.classList.toggle('photo-frame--crop', frameIsTall(w, h));
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
      const frame = fig.querySelector('.photo-frame');
      frame?.classList.remove('photo-frame--reserve');
      // Legacy media carries no stamped size, so the cap can only be applied once
      // the bitmap is here and its real shape is known.
      if (im.naturalWidth) capFrame(frame, im.naturalWidth, im.naturalHeight);
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
    const open = () => openLightbox(img.src, img.alt, false, im);
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
    const alt = notePlain(post.note) || 'Frame';
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
      // dimensions, size the frame box to match so object-fit:cover never crops
      // (below the 5:4 ceiling, where capFrame does mean to crop). The stamped
      // `-WxH` dims usually get this right already, but a Frame with no stored
      // poster AND no stamped size otherwise falls back to the 3:2 reserve box —
      // which would crop the video. Reading videoWidth/Height off the live element
      // is definitionally correct: the box matches exactly what this element will
      // paint, so the clip keeps its aspect on any device.
      clip.addEventListener('loadedmetadata', () => {
        if (clip && clip.videoWidth && clip.videoHeight) {
          capFrame(frame, clip.videoWidth, clip.videoHeight);
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
        // A final timeupdate can fire after detach() has already nulled `clip`
        // (the card scrolled out mid-play) — bail before dereferencing it.
        if (!clip || !progressFill) return;
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
        hapticTap('LIGHT');
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
    const btn = el.querySelector('.card-attendees');
    const panel = el.querySelector('.going-panel');
    if (!btn || !panel) return;

    // The who's-going panel — pure CSS reveal, same grid-rows ease as the
    // comment thread.
    const setPanel = (open) => {
      if (open) openGoing.add(post.id); else openGoing.delete(post.id);
      if (open) { collapseComments(el, post.id); collapseLikers(el, post.id); }
      btn.setAttribute('aria-expanded', String(open));
      panel.classList.toggle('open', open);
    };

    // Joining changes the count, the glyph, the who's-going list AND whether the
    // way back out exists, so the card is rebuilt in place — no rise flash, same
    // pattern as adding a comment.
    const flip = async () => {
      btn.disabled = true;
      const res = await Store.toggleGoing(post.id);
      btn.disabled = false;
      if (!res.ok) return;
      // Joining is the one gesture here that commits you to a place and a time,
      // so it's the one that gets the heavier knock. Bowing out is just a screen
      // changing its mind.
      hapticTap(res.going ? 'MEDIUM' : 'LIGHT');
      // Joining lands you on the list: you see who you just joined, and the way
      // back out is right there under them. Bowing out leaves it open too — you
      // were already reading it.
      if (res.going) openGoing.add(post.id);
      const fresh = makeCard(post, opts);
      fresh.style.animation = 'none';
      // Roll the count in its new direction — up when you join, down when you
      // bow out. The number moving IS the confirmation that you're in it.
      odoTick(fresh.querySelector('.card-attendees-count'), res.going ? 'up' : 'down');
      el.replaceWith(fresh);
      // Joining earns the RSVP's own reward beat (see celebrateGoing).
      if (res.going) celebrateGoing(fresh);
    };

    // Only a friend looking at a plan that hasn't happened gets a toggle;
    // goingControlHtml marks those with aria-pressed. Everyone else's tap is
    // purely the disclosure.
    const rsvpable = btn.hasAttribute('aria-pressed');
    btn.addEventListener('click', () => {
      if (rsvpable && btn.getAttribute('aria-pressed') === 'false') { flip(); return; }
      setPanel(!openGoing.has(post.id));
      // The disclosure half of this button now speaks too, matching the comment
      // thread and the who-liked list. flip() has its own (heavier) buzz and
      // returns before this — a tap is one event, so it gets one haptic.
      hapticTap('LIGHT');
    });

    el.querySelector('.going-out')?.addEventListener('click', flip);
  }

  /* ── Haptics ────────────────────────────────────────────────────────────────
     The reward moments have a visual voice already (the sparkle burst, the ink
     stamp, the RSVP check). Inside the installed iOS app they get a physical one.

     Capacitor injects its native bridge into the webview before any app JS runs,
     so `window.Capacitor.toNative(plugin, method, options)` is simply there when
     Tria is the app and undefined everywhere else — the same file boots on the
     web untouched, which is the whole reason to reach for the bridge's raw call
     instead of @capacitor/haptics' tidier `registerPlugin` wrapper. That wrapper
     is an ES module and Tria has no build step. The wire format is identical,
     and fire-and-forget allocates nothing (no promise, no stored callback id),
     which is what a buzz thrown from a tap handler wants.

     Deliberately NOT gated on prefers-reduced-motion, unlike the sparkles. A
     haptic isn't motion; iOS has its own system-wide switch for it (Sounds &
     Haptics → System Haptics, which UIFeedbackGenerator obeys long before we
     hear about it); and someone who turned the animations down has *lost* their
     confirmation that a tap landed, so the buzz is worth more to them, not less.

     Every call fires on the CONFIRMED WRITE, never on the touch. The buzz means
     "that saved" — a thing worth feeling — where "you touched glass" is
     something the finger already knew. Nothing may depend on one firing: on the
     web, on a desktop, or with system haptics off this is silence, and silence
     has to stay a correct outcome.  */
  function haptic(method, options) {
    if (nativeShell()) {
      try { window.Capacitor.toNative('Haptics', method, options || {}); }
      catch { /* a garnish, never a failure */ }
      return;
    }
    // Android web has the Vibration API; iOS Safari has never shipped it. A
    // coarse motor buzz is a poor cousin to a real impact generator, so keep it
    // brief enough to read as punctuation rather than an alarm.
    if (navigator.vibrate) {
      try { navigator.vibrate(method === 'notification' ? [10, 40, 10] : 8); } catch { /* ignore */ }
    }
  }

  // LIGHT for something that stays on the screen, MEDIUM for something that
  // lands in the real world — the same split as canSocial vs canJoin.
  const hapticTap = (style) => haptic('impact', { style: style || 'LIGHT' });
  const hapticEvent = (type) => haptic('notification', { type: type || 'SUCCESS' });

  /* ── Outbound links in the native shell ──────────────────────────────────────
     A WKWebView will not open a second window: `window.open` returns null and a
     `target="_blank"` anchor does nothing at all — not navigate, not hand off to
     Safari, nothing. On the web that attribute is exactly right (a Find's link
     opens beside Tria instead of replacing it), but in the App Store build it
     silently killed the primary action of three post types: a Find's title and
     note link, and an activity's map pin. A tap that visibly does nothing is a
     broken feature, and review reads it as one too.

     So: in the native shell only, intercept those clicks and hand the URL to
     @capacitor/browser, which presents SFSafariViewController *over* the app —
     the reader gets Safari's chrome and a Done button that returns them exactly
     where they were. That's the behaviour iOS users expect from a link inside an
     app, and it's better than what _blank does on the web. Plain in-app hash
     links are untouched; they already work.

     Delegated at the document, so it covers every card the feed will ever build
     without a per-render wiring step. Capture phase, because a card's own click
     handlers shouldn't get to swallow it first.  */
  document.addEventListener('click', (e) => {
    if (!nativeShell()) return;
    const a = e.target.closest?.('a[target="_blank"]');
    if (!a) return;
    const href = a.getAttribute('href') || '';
    if (!/^https?:\/\//i.test(href)) return;   // in-app routes navigate normally
    e.preventDefault();
    try { window.Capacitor.toNative('Browser', 'open', { url: href }); }
    catch { /* if the sheet can't open, leaving the tap inert is the old behaviour */ }
  }, true);

  // The RSVP's own reward verb (deliberately NOT a fifth sparkle — that motif
  // belongs to likes, comments, polls, and fresh posts): the check draws itself
  // onto the person glyph while the quintet gradient sweeps once across the
  // count and settles on the resting activity green. Both halves run in CSS
  // (see .rsvp-inked); the check arm carries pathLength=1 in the icon itself, so
  // the dash math covers its real geometry exactly.
  function celebrateGoing(card) {
    if (prefersReduced()) return;
    const btn = card.querySelector('.card-attendees.going');
    if (!btn) return;
    btn.classList.add('rsvp-inked');
    setTimeout(() => btn.classList.remove('rsvp-inked'), 1100);
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
        // Fires on the confirmed change like every other haptic in the app — the
        // difference is that this change is synchronous, so there's no round trip
        // to wait for: the panel state has already flipped by the time we buzz.
        // LIGHT, because opening a list of names is the definition of something
        // that stays on the screen. Both directions: opening and closing are each
        // a real repaint, unlike the filter dial's no-op re-pick.
        hapticTap('LIGHT');
      });
      return;
    }

    // Friend: toggle my own like. The count belongs to the author, not to me, so
    // there's nothing on my card to recompute — just flip the heart in place (no
    // card rebuild, no rise-flash).
    btn.addEventListener('click', async () => {
      // The re-enable is in a finally for the reason the push toggle's is: this
      // is the only control for the state it names, and a throw between the two
      // lines leaves it disabled for the life of the card with no toast either —
      // a heart that stops answering, forever, from one unlucky tap.
      btn.disabled = true;
      let res = null;
      try { res = await Store.toggleLike(post.id); }
      catch { /* falls through to the !ok return: the heart just doesn't move */ }
      finally { btn.disabled = false; }
      if (!res?.ok) return;
      hapticTap('LIGHT');   // both directions: the tap is confirming an async write
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

    /* Enter posts, and ONLY where there's a keyboard that can also say
       Shift+Enter. That pairing was written for a desktop browser and it does
       not survive the trip to a phone: an iOS software keyboard has no way to
       deliver `shiftKey` on a Return keydown, so on every touch shell the
       "deliberate line break" half of the rule was unreachable and Return was an
       unlabelled Publish. Two bad outcomes from the one gap — a comment could not
       be given a paragraph break from a phone at all, and the key that means
       "new line" in every other multiline field on iOS silently published
       instead. The keyboard even says `return` while doing it, so there was
       nothing on screen to warn anyone.

       On touch, Return is now just a Return and the Post button is the send —
       which is what the field was already built for: it auto-grows for exactly
       this, Post carries a 44px target, and it disables itself when empty. The
       desktop reflex is untouched.
       (defaultPrevented → the mentions picker already claimed this Enter to pick
        a friend; wireMentions runs first, so let it win.) */
    input.addEventListener('keydown', (e) => {
      if (!finePointer()) return;
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
      hapticTap('LIGHT');   // see the who-liked toggle: synchronous change, stays on screen
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
      if (dir) odoTick(fresh.querySelector('.card-comment-count'), dir);
      el.replaceWith(fresh);
      // The rebuilt card's textarea is deliberately NOT refocused. On the web that
      // was a courtesy (the caret stays in the box, you can keep typing); on iOS a
      // focused textarea IS the keyboard, so posting a comment re-claimed focus and
      // the keyboard never went away — which read as iOS failing to dismiss it.
      // It also parked a focused field on screen, and a focused field makes every
      // background refresh skip its paint (see `showWorld`).
      return fresh;
    };

    panel.querySelector('.comment-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (submitBtn.disabled) return;               // empty, or a submit already in flight
      submitBtn.disabled = true;                    // debounce: no double-post on a fast double-tap
      const res = await Store.addComment(post.id, e.target.elements.text.value);
      if (res.ok) {
        // The like heart has buzzed on its confirmed write since the haptics
        // landed; its neighbour on the same row never did, which left the two
        // halves of the social row speaking different languages. LIGHT: a posted
        // comment lands on the screen, not in the world.
        hapticTap('LIGHT');
        const fresh = apply('up');                  // card rebuilt — its fresh button starts disabled
        const mine = [...fresh.querySelectorAll('.comments-list > .comment')].pop();
        celebrateComment(mine, post.type);
        return;
      }
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
          // shownTags, not post.tags: a daily answer's join tag is invisible here
          // too, and saveEdit puts it back (otherwise editing a typo in the
          // caption would quietly drop the post off the daily page).
          `value="${esc(shownTags(post).join(', '))}" placeholder="garden, clay">` +
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
      return richNoteField('e', post.title, editorPrefill(post.note), 'What made you want to share it? (optional)', { tools: false }) +
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
    return richNoteField('e', post.title, editorPrefill(post.note), notePh, { tools: false }) + tagsInput;
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
          // Cancel and Save are both always on screen (the same commit row Edit
          // profile uses), so backing out is never hidden behind "have I changed
          // anything yet". Save just sits disabled until a field diverges — see the
          // dirty-tracking wiring in renderUser. Delete lives in the ••• menu.
          `<button type="button" class="edit-cancel">Cancel</button>` +
          `<button type="submit" class="composer-submit edit-save" disabled>Save changes</button>` +
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
  // Discover's dial carries one row the home feed has no use for: People, which
  // drops the posts and faces every account with its portrait, turning the grid
  // into a directory. It sits directly under All because those two are the whole
  // room seen two ways (everything, or everyone) and the five type rows narrow
  // beneath both. It takes no pastel: the quintet is reserved for post types, and
  // People isn't one.
  const DISCOVER_FILTERS = [FILTERS[0], { key: 'people', label: 'People' }, ...FILTERS.slice(1)];
  let activeFilter = 'all';
  let activeTag = null;

  // The masthead's filter control: the sliders glyph plus a hue dot that lights
  // (in the active type's colour) only when a filter is on, so a folded menu
  // still tells you the feed is narrowed. Tapping it fans the filter dial open.
  // `id` namespaces the button so Home and Discover can each carry their own
  // filter (they hold separate state — narrowing one never touches the other).
  // `label` names what's being narrowed, because Discover isn't a feed and its
  // dial can now pick People — "Filter the feed" would be announcing the wrong
  // thing twice over.
  function filterBtnEl(id, filterVal, label = 'Filter the feed') {
    const on = filterVal !== 'all';
    return `<button class="masthead-filter" type="button" id="${id}" ` +
        `aria-haspopup="menu" aria-expanded="false" aria-label="${esc(label)}"` +
        `${on ? ` data-active="${filterVal}"` : ''}>` +
        svgIcon('sliders', 'masthead-filter-ico') +
        `<span class="masthead-filter-dot" aria-hidden="true"${on ? '' : ' hidden'}></span>` +
      `</button>`;
  }
  // Reflect the current filter onto the masthead button without a full re-render
  // (so picking one doesn't flash the whole page): light/clear the dot + hue.
  function syncFilterBtn(id, filterVal) {
    const btn = view.querySelector('#' + id);
    if (!btn) return;
    const on = filterVal !== 'all';
    if (on) btn.setAttribute('data-active', filterVal);
    else btn.removeAttribute('data-active');
    const dot = btn.querySelector('.masthead-filter-dot');
    if (dot) dot.hidden = !on;
  }

  function renderHome() {
    view.innerHTML =
      `<section class="view">` +
        mastheadEl('', 'My Circle', filterBtnEl('home-filter-btn', activeFilter)) +
        `<div class="feed" id="feed"></div>` +
      `</section>`;

    view.querySelector('#home-filter-btn')
      ?.addEventListener('click', (e) => openFilterDial(e.currentTarget, {
        current: activeFilter,
        onPick: (key) => { activeFilter = key; activeTag = null; syncFilterBtn('home-filter-btn', activeFilter); renderFeed(); },
      }));

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
  function openFilterDial(anchor, opts = {}) {
    if (filterDialOpen) return;
    filterDialOpen = true;
    anchor.setAttribute('aria-expanded', 'true');
    // Caller supplies the current selection (for the checkmark) and what to do on
    // a pick, so the one dial drives either the home feed or Discover.
    const current = opts.current || 'all';
    const onPick = opts.onPick || (() => {});
    // Which rows to fan. Home takes the five types; Discover adds People (see
    // DISCOVER_FILTERS), so the dial itself stays a dumb renderer of a list.
    const filters = opts.filters || FILTERS;

    const scrim = document.createElement('div');
    scrim.className = 'filter-dial-scrim';
    const rows = filters.map((f, i) => {
      const on = f.key === current;
      const glyph = f.key === 'all' ? ICON_ALL
        : f.key === 'people' ? svgIcon('friends')
        : (TYPE_ICON[f.key] || '');
      // --glow = the pastel that blooms behind the glyph; the glyph itself takes
      // the type's deep -ink via `color` (fill:currentColor). All's pentad paints
      // its own five hues directly (no currentColor), so it skips the glow wash
      // entirely — the grey radial bloom read muddy on a white ground, and the
      // dots already carry plenty of colour on their own. People skips it for the
      // other reason: it isn't a post type, and spending one of the five hues on
      // it would blunt what the quintet means. Set inline rather than via
      // .type-icon--x, whose own sizing rules would fight the 46px disc.
      const plain = f.key === 'all' || f.key === 'people';
      const glow = plain ? 'transparent' : `var(--type-${f.key})`;
      const ink  = plain ? 'var(--muted)' : `var(--type-${f.key}-ink)`;
      return `<button class="filter-dial-item${on ? ' is-on' : ''}" type="button" ` +
          `role="menuitemradio" aria-checked="${on}" data-filter="${f.key}" style="--i:${i}">` +
          `<span class="filter-dial-label">${f.label}</span>` +
          `<span class="filter-dial-ico" style="--glow:${glow}; color:${ink}">${glyph}</span>` +
        `</button>`;
    }).join('');
    scrim.innerHTML = `<div class="filter-dial" role="menu" ` +
      `aria-label="${esc(opts.label || 'Filter the feed')}">${rows}</div>`;
    document.body.appendChild(scrim);
    document.body.style.overflow = 'hidden';

    // Pin the dial's right edge under the button so the icon chips stack straight
    // down from it (label floating to the left — the speed-dial reading, mirrored).
    // A small extra gutter (past the button's own overhang past --inset) keeps the
    // chips from hugging the screen edge.
    const dial = scrim.querySelector('.filter-dial');
    const r = anchor.getBoundingClientRect();
    dial.style.top = (r.bottom + 10) + 'px';
    dial.style.right = Math.max(8, window.innerWidth - r.right + 8) + 'px';

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
      // The dial is the single place every filter pick passes through — the home
      // feed, Discover and a profile's shelf all hand it their own list — so the
      // tap belongs here rather than copied into three onPick callbacks.
      //
      // LIGHT, because a filter lands on screen and nowhere else (the same split
      // as canSocial vs canJoin). And only when the pick actually CHANGES the
      // filter: re-choosing the row that already wears the checkmark repaints
      // nothing, and a buzz for it would be the phone confirming a write that
      // never happened, which is the one thing the haptic is supposed to mean.
      if (key !== current) hapticTap('LIGHT');
      close(() => onPick(key));
    }));
    document.addEventListener('keydown', onKey);
  }

  /* Reconcile a list of cards against what's already on screen rather than wiping
     it. A refresh re-pulls the whole world, but most pulls change nothing in view
     (or just a like/comment on one post). Rebuilding every card from scratch would
     replay each photo's fade-in — the "already seen it, why did it reload" jitter.
     So: keep unchanged cards (and their loaded images) in place, rise in only
     genuinely new posts, drop posts that left, and re-render in place only the
     cards whose content truly changed. `wire` hooks up every node built here (the
     home feed and Discover wire their tag chips to different pages). */
  function syncCards(container, list, wire) {
    const desired = new Set(list.map(p => String(p.id)));
    container.querySelectorAll(':scope > .card').forEach(c => {
      if (!desired.has(c.dataset.id)) c.remove();          // gone from the feed
    });
    container.querySelectorAll(':scope > :not(.card)').forEach(n => n.remove()); // stale empty-state
    const existing = new Map();
    container.querySelectorAll(':scope > .card').forEach(c => existing.set(c.dataset.id, c));

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
          wire(fresh);
          old.replaceWith(fresh);
          node = fresh;
        }
      } else {
        node = makeCard(p);                    // brand-new post — rise it in
        node.style.animationDelay = staggerDelay(i);
        wire(node);
      }
      const ref = container.children[i] || null;   // slot it into the right position
      if (node !== ref) container.insertBefore(node, ref);
    });
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
          `<a class="feed-empty-cta" href="#/discover">Discover people to add →</a>` +
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

    syncCards(feedEl, list, wireFeedCard);

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

  // Sparkle a freshly posted comment — the same y2k motif as the post/like
  // bursts, dialed down: three stars instead of five-to-nine, smaller, dimmer
  // peak, gone quicker. A nod that it landed, not a fanfare (a comment is
  // lower-stakes than a post). Anchored over the new <li>'s avatar corner.
  const COMMENT_SPARKS = [
    { x: -9, y: -8, s: 7, r:  14, d:  0 },
    { x:  8, y: -9, s: 6, r: -10, d: 30 },
    { x:  2, y:  9, s: 5, r:  16, d: 60 },
  ];
  function celebrateComment(li, type) {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    if (!li) return;
    const layer = document.createElement('span');
    layer.className = 'comment-sparkles';
    layer.dataset.type = type;
    for (const p of COMMENT_SPARKS) {
      const s = document.createElement('span');
      s.className = 'spark';
      s.style.cssText =
        `--x:${p.x}px;--y:${p.y}px;--s:${p.s}px;--r:${p.r}deg;animation-delay:${p.d}ms`;
      layer.appendChild(s);
    }
    li.appendChild(layer);
    setTimeout(() => layer.remove(), 600);
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
  // wordmark), shared by the auth (log in / create) screens and the gated About
  // page so they read as one app. The slogan rides in the header.
  //
  // It carried a person disc at the right edge until July 2026, a "returning
  // user, sign in here" escape hatch left over from when the signed-out front
  // door was the install-first welcome tutorial. Once that page came out and the
  // account form became the front door in every shell, the disc was pointing at
  // the screen it was standing on: on log in it re-rendered the current view, on
  // create account it duplicated the "Already have an account? Log in" toggle
  // sitting under the submit button, and on About it was never even wired (that
  // page has its own "Back to sign in") — a glyph you could press three times and
  // get nothing twice. Don't re-add one: a door doesn't need a sign saying door.
  function authHeader() {
    return `<header class="auth-topbar">` +
        `<div class="auth-topbar-brand">` +
          `<span class="brand-mark">tria</span>` +
          `<span class="auth-topbar-tag">Social media made local</span>` +
        `</div>` +
      `</header>`;
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
                // No target="_blank": these are hash routes into Tria's own About
                // page, so a new tab was only ever a second copy of the app — and
                // in the native shell WKWebView refuses to open one at all, which
                // made the Privacy Policy link on the very first screen a dead tap.
                `<span>I agree to Tria's <a href="#/about?open=guidelines">Community Guidelines</a> and <a href="#/about?open=privacy">Privacy Policy</a>.</span>` +
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
      // Claim this device's push address for whoever just signed in. Signing out
      // hands it back (Store.logout), and without this half the device stayed
      // unregistered until the next cold launch — so a session that began with a
      // login got no notifications at all, and on a phone that had been used by
      // another account the old row was still the live one.
      Store.pushResume();
    });

    // Toggle signup ⇄ login through the router, so the form is rebuilt exactly
    // the way arriving on it builds it.
    document.getElementById('auth-toggle').addEventListener('click',
      () => renderPage(() => renderAuth(isSignup ? 'login' : 'signup')));
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

  /* ── A frame's face, and its settle ───────────────────────────────────────────
     The photo (or a video's poster still) at its own aspect ratio, which is what
     gives both masonry grids their ragged edge in the first place. Same
     reserve-then-settle trick the feed uses — the box holds the media's real
     shape filled with its average colour (the `tint` column) and the bitmap eases
     in over it, so nothing reflows and nothing pops. A video shows its play mark
     but never plays inside a grid: autoplaying clips on a surface you're only
     browsing is both a data bill and a tone we don't want.

     Deliberately NO type glyph over it: a photo announces itself as a photo, so
     the badge would be labelling the one face that never needed a label. */
  function mediaFaceEl(p, label) {
    const isVideo = isVideoUrl(p.image);
    const src = isVideo ? p.poster : p.image;
    const d = imageDimsFromUrl(p.image);
    const style = `aspect-ratio:${d ? frameRatio(d.w, d.h) : '1 / 1'};` +
      (p.tint ? `--ph-fill:${p.tint};` : '');
    return `<div class="ptile-face ptile-face--media" style="${style}">` +
        (src ? `<img src="${esc(src)}" alt="${esc(label || 'Frame')}" ` +
               `loading="lazy" decoding="async">` : '') +
        (isVideo ? `<span class="ptile-play" aria-hidden="true">${svgIcon('play', 'ptile-play-ico')}</span>` : '') +
      `</div>`;
  }

  /* Photos settle rather than pop: the tinted box already holds the right shape,
     so the bitmap just fades in over it once it's decoded. A photo that never
     arrives drops out and leaves the tint behind, which is a calmer failure than
     a broken-image glyph in the middle of a grid. */
  function wireFrameFades(root) {
    root.querySelectorAll('.ptile-face--media img').forEach(img => {
      if (img.complete && img.naturalWidth) { img.classList.add('is-loaded'); return; }
      img.addEventListener('load', () => img.classList.add('is-loaded'), { once: true });
      img.addEventListener('error', () => img.remove(), { once: true });
    });
  }

  /* ── The masonry deal ─────────────────────────────────────────────────────────
     Shared by the two grids in the app: Discover's wall of people, and a
     profile's wall of frames. Both hand this a `.pgrid` holding a flat run of
     `.ptile`s and get real columns back.

     Deal the tiles into real columns, ROW-MAJOR: newest across the top, then
     the next row. CSS `columns` can't do this — it fills one column to the
     bottom before starting the next, which turns a chronological list into N
     parallel timelines side by side, the second one starting dozens of posts
     back. Both callers are in time order (rule 5 in renderDiscover; a profile
     is newest-first), and that layout would hide the very thing the order fixes.

     Every tile starts in column one, because the columns are `flex: 1 1 0` and
     therefore already at final WIDTH from the first frame — so the heights read
     here are the heights we'll get, text wrapping included. Then each tile goes
     to whichever column is currently shortest, which is row-major while the
     rows are even and self-corrects when a tall photo lands. One forced layout
     read, in the same task as the writes, so nothing paints mid-shuffle.

     The deal hands us the entrance stagger for free, so we take it here rather
     than measuring again: a tile's top IS the running height of the column it
     lands in, and its column index stands in for left, so sorting by (top,
     column) gives the reading order exactly. Tiles must arrive by ROW — a
     stagger in DOM order would light one whole column and then the next, which
     reads as several loads instead of one grid landing.

     `fresh` is the entrance. Clearing the grid detaches every tile, which
     cancels and restarts its CSS animation on re-insert — right on a repaint,
     wrong on a rotate, where the entrance already played and replaying the
     whole page because the phone turned is just noise. So a re-layout parks
     the animation instead of re-timing it. */
  function dealMasonry(grid, fresh) {
    if (!grid) return;
    const tiles = [...grid.querySelectorAll('.ptile')];
    if (!tiles.length) return;
    const n = Math.max(1, parseInt(getComputedStyle(grid).getPropertyValue('--cols'), 10) || 1);
    grid.textContent = '';
    const cols = Array.from({ length: n }, () => {
      const c = document.createElement('div');
      c.className = 'pgrid-col';
      grid.append(c);
      return c;
    });
    tiles.forEach(t => cols[0].append(t));
    const gap = parseFloat(getComputedStyle(tiles[0]).marginBottom) || 0;
    const h = tiles.map(t => t.offsetHeight + gap);      // the one read pass
    const run = new Array(n).fill(0);
    const placed = tiles.map((t, i) => {
      let k = 0;
      for (let j = 1; j < n; j++) if (run[j] < run[k]) k = j;
      if (k) cols[k].append(t);                          // k === 0 is already home
      const at = { t, top: run[k], col: k };
      run[k] += h[i];
      return at;
    });
    grid.classList.toggle('pgrid--settled', !fresh);
    if (!fresh) return;
    placed.sort((a, b) => a.top - b.top || a.col - b.col)
      .forEach((p, i) => { p.t.style.animationDelay = staggerDelay(i); });
  }

  /* ── The grid tile ────────────────────────────────────────────────────────────
     One tile, three callers: Discover's wall of people, and now a daily's wall of
     answers (a profile's frame wall keeps its own bare face — every tile there is
     the same person, so a foot naming them forty times is noise). It takes
     `{ user, post }` and faces it by what's there: a photo posts its media, any
     other type speaks, and a person with nothing to show gets their portrait.

     Same reason dealMasonry is shared: two copies of a tile is two places to keep
     a decision, and every decision written into this one is load-bearing. */

  // What a post SAYS, in one line: its caption, and its title only when there
  // isn't a caption. One rule for all five types, because every type carries a
  // title field (see the composer) and none of them treats it as the voice —
  // the caption is the person talking, the title is the label they filed it
  // under, and a browse surface should show the talking. `poll.q` is a legacy
  // shape: the composer has stored a poll's question in title/note for a while
  // now, so it's a last resort rather than the first look.
  const saidOf = (p) =>
    notePlain(p.note) || p.title || (p.poll && p.poll.q) || '';

  // Everything that isn't a photo speaks instead: what it said, set in the
  // serif, with a quiet second line where the type has one worth adding. A
  // note set large is a better tile than a bad selfie, which is most of why
  // the text face exists at all rather than falling back to a portrait.
  const TILE_SUB = {
    find:     (p) => domainOf(p.url || ''),
    activity: (p) => p.location || '',
  };
  const tileTypeGlyph = (p) =>
    `<span class="type-icon type-icon--${p.type}" role="img" ` +
      `aria-label="${esc(TYPE_LABEL[p.type] || p.type)}">${TYPE_ICON[p.type] || ''}</span>`;
  function sayFaceEl(p) {
    const sub = TILE_SUB[p.type] ? TILE_SUB[p.type](p) : '';
    return `<div class="ptile-face ptile-face--say">` +
        `<span class="ptile-type">${tileTypeGlyph(p)}</span>` +
        `<p class="ptile-say">${esc(saidOf(p) || TYPE_LABEL[p.type] || '')}</p>` +
        (sub ? `<p class="ptile-sub">${esc(sub)}</p>` : '') +
      `</div>`;
  }

  // Nothing to show here: the portrait, full square. See rule 4 in renderDiscover
  // — this is the tile that keeps a private account from reading as a gap.
  const whoFaceEl = (u) =>
    `<div class="account-photo ptile-face ptile-face--who${u.avatar ? '' : ' account-photo--empty'}">` +
      (u.avatar
        ? `<img src="${esc(u.avatar)}" alt="" loading="lazy" decoding="async">`
        : `<span class="account-photo-initial" aria-hidden="true">${esc(initialOf(u.name || u.username))}</span>`) +
    `</div>`;

  // Face on top, the person underneath. The name is a <p>, not the profile's
  // <h1> — a page of h1s is a heading outline that says nothing.
  //
  // The tie is a go-arrow, and there is no Add anywhere on these grids. That
  // isn't a shortcut, it's the point: adding someone is a commitment, and a
  // page whose job is browsing shouldn't ask for one at every tile. The arrow
  // says "go look", their profile carries the real Add.
  //
  // NO counts. A post count and a friend count on every tile turned the grid
  // into a page of scoreboards, and neither number is why you'd tap: the face
  // already tells you what this person makes, and how many friends a stranger
  // has is nobody's decision criterion. The only mark left is the lock, which
  // isn't a statistic — it's a warning that the tap lands on a wall, and it
  // rides the NAME because it's a property of the account, not of the post.
  // `fenced` is the caller's answer, because both callers already cache it.
  //
  // The @handle rides the PORTRAIT tile only, and that split is the whole rule.
  // On a post tile the name is a byline — it answers "who said this", the face
  // above it is the content, and a handle there was the second line of every
  // foot on the page saying the same thing twice. On a portrait tile the person
  // IS the content: nothing else on that tile distinguishes one Sam from the
  // other Sam, and a directory that can't tell them apart is a directory you
  // have to tap through twice. So it prints where it disambiguates and stays
  // out of the browse grid's bylines. Search matches handles either way (see
  // scoreName), so the two Sams were always FINDABLE — they just weren't
  // separable once found.
  //
  // A post tile deep-links to the post ON their profile (?p=<id>, the same
  // link Copy-link mints), so tapping a thing you're curious about takes you
  // to that thing rather than dumping you at the top of a stranger's page.
  function ptileEl(t, fenced) {
    const u = t.user;
    const fence = fenced
      ? svgIcon('lock', 'ptile-lock') + `<span class="visually-hidden"> Private account</span>` : '';
    // The lock is glued to the name's LAST WORD, because on a tile this narrow a
    // two-word name wraps and an inline mark left to itself lands alone on a
    // line of its own — a whole third row of foot, taller than the tile beside
    // it, holding one padlock. Gluing costs the last word its soft wrap, which
    // is why a long one is left loose: `overflow-wrap: anywhere` exists on this
    // name so a single unbroken word can't shove the arrow off the tile, and
    // nowrap would switch that rescue off. Under ~14 characters the word fits a
    // column anyway, so there's nothing to switch off.
    const name = (u.name || '').trimEnd();
    const cut = name.lastIndexOf(' ');
    const tail = name.slice(cut + 1);
    const nameHTML = !fence ? esc(name)
      : tail.length > 14 ? esc(name) + fence
      : esc(name.slice(0, cut + 1)) + `<span class="name-fence">${esc(tail)}${fence}</span>`;
    // The portrait rejoins the foot only when the face is a POST — otherwise
    // the face already is their photo and a second copy is just noise. Same
    // reason the bio only shows on a portrait tile: one thing per tile.
    const av = t.post ? avatarEl(u, { cls: 'ptile-av' }) : '';
    const href = `#/u/${encodeURIComponent(u.username)}` +
      (t.post ? `?p=${encodeURIComponent(t.post.id)}` : '');
    return `<a class="ptile" href="${href}">` +
        (t.post
          ? (t.post.type === 'photo' && t.post.image
            ? mediaFaceEl(t.post, saidOf(t.post))
            : sayFaceEl(t.post))
          : whoFaceEl(u)) +
        `<div class="ptile-foot">` +
          `<div class="ptile-who">` + av +
            `<div class="ptile-id">` +
              `<p class="account-name">${nameHTML}</p>` +
              (t.post ? '' : `<p class="ptile-handle">@${esc(u.username)}</p>`) +
            `</div>` +
            `<span class="friend-go" aria-hidden="true">→</span>` +
          `</div>` +
          (!t.post && u.bio ? `<p class="ptile-bio">${esc(u.bio)}</p>` : '') +
        `</div>` +
      `</a>`;
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

  /* The profile's own view filter — the same dial Home and Discover carry, in
     the same place relative to the page's nameplate, just narrowing ONE person's
     posts. Two things make it worth having here rather than being a copy of
     Home's: its rows are derived from what that person has actually posted (a
     dial offering Polls on a profile with no polls is a control that lies), and
     Frames doesn't narrow the column, it replaces it with a masonry wall of that
     person's photographs (see the frame wall in renderUser). `profileFilterFor`
     remembers whose profile the choice was made on, so it resets the moment you
     land on someone else: arriving at a stranger's page already in a mode their
     posts can't fill is nobody's idea of a profile. */
  let profileFilter = 'all';
  let profileFilterFor = null;
  let profileResizeOff = null;   // drops the frame wall's resize listener when the view goes

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
    // A private account fences its circle to friends, but can now float individual
    // posts public (Stage 2). So an outsider isn't shown a bare wall — they see the
    // public posts RLS actually hands over, plus a softened nudge that the rest is
    // friends-only. Activities stay circle business unless explicitly made public.
    const locked = Store.isPrivate(u.username) && !isSelf && !isFriend;
    const list = Store.postsBy(u.username).filter(p =>
      (p.type !== 'activity' || isSelf || isFriend || p.audience === 'public') &&
      (!locked || p.audience === 'public'));
    const friendStatus = isSelf ? null : Store.friendStatus(u.username);
    const areFriends = friendStatus === 'friends';

    // The dial's rows: All, then only the types this person has actually posted,
    // in FILTERS order. There's no People row here (a profile is one person) and
    // no dead ends, which is the whole reason the dial takes its list as an
    // argument. A profile with nothing but notes gets no control at all — one
    // type and one layout isn't a choice — but a single photo earns one on its
    // own, because Frames isn't a narrowing, it's the wall.
    const types = new Set(list.map(p => p.type));
    const filters = [FILTERS[0], ...FILTERS.slice(1).filter(f => types.has(f.key))];
    const canFilter = filters.length > 2 || types.has('photo');
    if (profileFilterFor !== u.username) { profileFilter = 'all'; profileFilterFor = u.username; }
    // A spotlight is aimed at one CARD — a copied link, an Updates row, an Edit
    // handed over from the feed — so it always lands in the post column.
    if (spotlightPost || (isSelf && editingId)) profileFilter = 'all';
    // The world moves under a held filter (their last frame gets deleted while
    // you're standing in the wall), so re-check rather than trust it.
    if (!canFilter || !filters.some(f => f.key === profileFilter)) profileFilter = 'all';

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
          // Five pre-friend states. Two are already-done and undo on tap
          // ("Requested" on a private account, "Following" on a public one) —
          // muted outline. The other three are the live commit, and are the one
          // primary action on a visitor's card (Share lives in the ••• menu
          // here), so they wear the publish-fill gradient. The done states
          // deliberately do NOT: the gradient means "this is the move", not
          // "you already did it".
          const s = friendStatus;
          const label = { none: 'Add friend', sent: 'Requested', following: FOLLOW_STATE,
                          incoming: 'Accept request', follower: 'Add back' }[s];
          const committed = s === 'sent' || s === 'following';
          const title = s === 'sent' ? ' title="Tap to cancel your request"'
            : s === 'following' ? ` title="Tap to stop ${FOLLOW_STATE.toLowerCase()}"` : '';
          const fill = committed ? '' : ' publish-fill is-solid';
          return `<div class="account-actions">` +
            `<button class="friend-btn${fill}" type="button" id="friend" ` +
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

    // The seam between the identity and the posts: a quiet caption naming what
    // the pane below is, with the same sliders dial at its right. It's the
    // masthead's own arrangement (nameplate left, filter right) borrowed for a
    // page whose masthead is a photograph — set as flat editorial type, not
    // chrome, because it captions content rather than floating above it. Absent
    // entirely when there's nothing to narrow, so a quiet profile reads exactly
    // as it always did.
    const shelfLabel = () => profileFilter === 'all' ? 'All posts'
      : (FILTERS.find(f => f.key === profileFilter) || {}).label || 'All posts';
    const shelf = canFilter
      ? `<div class="profile-shelf">` +
          `<p class="profile-shelf-cap">${esc(shelfLabel())}</p>` +
          filterBtnEl('profile-filter-btn', profileFilter,
            isSelf ? 'Filter your posts' : `Filter ${u.name}’s posts`) +
        `</div>`
      : '';

    view.innerHTML =
      `<section class="view">` +
        back +
        // The identity header, flat on the page. There is no card here any more
        // — the profile's colour is the full-screen .ambient wash, the same one
        // Edit profile carries (see applyAmbient), the photo is an ordinary
        // circular avatar at profile size, and everything else is type on the
        // page's own axis. Corner discs, then photo left, identity beside it.
        `<div class="account">` +
          cornerBadges +
          `<div class="account-head">` +
            `<div class="account-photo${u.avatar ? '' : ' account-photo--empty'}">` +
              (u.avatar
                ? `<img src="${esc(u.avatar)}" crossorigin="anonymous" alt="" decoding="async">`
                : `<span class="account-photo-initial" aria-hidden="true">${esc(initialOf(u.name || u.username))}</span>`) +
            `</div>` +
            // The identity column, all on one left axis: name+handle, an inline
            // "N posts · N friends" stat line, the bio (wraps in place, any
            // length), then the action beneath. A short or missing bio simply
            // centres the column against the photo.
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
        shelf +
        `<div class="feed" id="feed"></div>` +
      `</section>`;

    // Their posts as a single-author column (slim date line, not a repeated
    // byline). Photos keep the lightbox; tags jump to the home feed filtered.
    const feedEl = view.querySelector('#feed');

    // A warm nudge toward the Add-friend button (which already sits in the card
    // above). Full when there's nothing public to show; softened when we're
    // rendering their public posts and only the circle is held back.
    const lockedNudge = (soft) =>
      `<div class="profile-locked${soft ? ' profile-locked--soft' : ''}">` +
        svgIcon('lock', 'profile-locked-ico') +
        `<p class="profile-locked-line">${soft
          ? `More from ${esc(u.name)} is for friends.`
          : `${esc(u.name)} keeps their posts for friends.`}</p>` +
        `<p class="profile-locked-sub">Add them and, once they add you back, the rest of their posts show up here.</p>` +
      `</div>`;

    /* ── The frame wall ───────────────────────────────────────────────────────
       Frames is the one dial row that changes the LAYOUT rather than just
       narrowing the column: this person's photographs, dealt into the same
       masonry grid Discover uses, at their own aspect ratios. That ragged edge
       is the whole point — a square-cropped contact sheet flattens a portrait
       and a wide landscape into the same brick, which is what every other
       platform's profile grid does and precisely the thing Tria doesn't (photos
       are stored uncropped; only avatars crop).

       A tile is the face and nothing else: no foot, no byline, no caption, no
       counts. Discover's tiles carry a person because the grid is a room full of
       strangers; here every tile is the same person and repeating them forty
       times down the page would be forty labels saying what the card at the top
       already said.

       Tapping one is the real deep link (?p=<id>, the same one Copy-link mints),
       so it drops back into the post column with that card spotlighted — the
       wall is an INDEX into a long profile, not a dead-end lightbox, and you
       land on the thing with its caption, likes and comments attached. */
    const postRoute = isSelf ? '#/profile' : `#/u/${encodeURIComponent(u.username)}`;
    const frameTile = (p) => {
      const cap = notePlain(p.note) || p.title || '';
      return `<a class="ptile ptile--frame" href="${postRoute}?p=${encodeURIComponent(p.id)}" ` +
          `aria-label="${esc(cap || 'Frame')}">` +
          mediaFaceEl(p, cap) +
        `</a>`;
    };

    /* Paint the posts pane for the current filter, in place. The identity card
       above never rebuilds, so picking a filter doesn't flash the photograph or
       re-run the ambient wash — the page stays exactly where it was and only the
       thing you asked to change changes. `stage` is the grid entrance, taken on
       a discrete act (landing, picking a row) and parked on a re-deal, same
       contract as Discover's. */
    const paintPosts = (stage) => {
      feedEl.textContent = '';
      const shown = profileFilter === 'all' ? list : list.filter(p => p.type === profileFilter);
      if (locked && !shown.length) {
        // Private profile, seen by an outsider, with nothing public to show.
        feedEl.innerHTML = lockedNudge(false);
        return;
      }
      if (!shown.length) {
        feedEl.innerHTML = `<p class="feed-empty">` +
          (profileFilter !== 'all' ? `No ${TYPE_PLURAL[profileFilter]} here yet.`
            : isSelf ? 'Nothing posted yet. Whenever you’re ready.'
            : 'Nothing here yet.') + `</p>`;
        return;
      }
      if (profileFilter === 'photo') {
        feedEl.innerHTML = `<div class="pgrid pgrid--frames">${shown.map(frameTile).join('')}</div>`;
        if (locked) feedEl.insertAdjacentHTML('beforeend', lockedNudge(true));
        dealMasonry(feedEl.querySelector('.pgrid'), stage);
        wireFrameFades(feedEl);
        return;
      }
      const frag = document.createDocumentFragment();
      shown.forEach((p, i) => {
        const card = (isSelf && p.id === editingId)
          ? makeEditCard(p)
          : makeCard(p, { solo: true });
        card.style.animationDelay = staggerDelay(i);
        frag.appendChild(card);
      });
      feedEl.appendChild(frag);
      // Their public posts are shown; tell an outsider the circle holds more.
      if (locked) feedEl.insertAdjacentHTML('beforeend', lockedNudge(true));
      wirePosts();
    };

    paintPosts(true);

    // An Updates row or a Discover tile targeted this post: the page arrives
    // already sitting on it. Synchronous, so the position is set before the new
    // page's first paint — the post is simply where the page opens.
    //
    // No wash. A highlight pulse answers "which one did I mean?", and nothing
    // asked: the card is centred on a page you opened by tapping it. The router
    // skips its top-snap while a spotlight is pending (see route), so there's no
    // jump-to-top to undo either.
    if (spotlightPost) {
      const target = feedEl.querySelector(`[data-id="${spotlightPost}"]`);
      spotlightPost = null;
      if (target) parkCard(target);
      else scrollTop(false);   // target filtered out — fall back to the top
    }

    // Everything the post COLUMN needs hooked up. Called by paintPosts rather
    // than once at the end of the render, because the column is now rebuilt
    // whenever the dial moves and its wiring has to come back with it. (The
    // frame wall needs none of it: a tile is a link and nothing else.)
    function wirePosts() {
      const editForm = feedEl.querySelector('.edit-form');
      if (editForm) {
        // Snapshot the fields exactly as rendered. Save stays disabled until a field
        // diverges from that baseline (and re-disables if the edit is reverted), so it
        // can never commit a no-op; Cancel sits beside it the whole time as the way
        // back out, rather than being the same button wearing a different name.
        const cancelBtn = editForm.querySelector('.edit-cancel');
        const saveBtn = editForm.querySelector('.edit-save');
        const snapshot = () => Array.from(editForm.querySelectorAll('input, textarea, [contenteditable]'))
          .map(el => el.isContentEditable ? el.innerHTML : el.value).join('\u0000');
        const baseline = snapshot();
        const dirty = () => snapshot() !== baseline;
        const syncSave = () => { saveBtn.disabled = !dirty(); };
        editForm.addEventListener('input', syncSave);
        editForm.addEventListener('change', syncSave);
        cancelBtn.addEventListener('click', () => { editingId = null; renderUser(username); });
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
        if (finePointer())
          editForm.querySelector('#e-note')?.focus();
      }
      feedEl.querySelectorAll('.tag[data-tag]').forEach(btn =>
        btn.addEventListener('click', () => {
          activeFilter = 'all';
          activeTag = btn.dataset.tag;
          location.hash = '#/';
        }));
    }

    // The dial. Picking a row repaints only the pane below the card and relabels
    // the shelf in place — no page re-render, so the identity, its wash and your
    // scroll position all stay exactly where they were. An open inline editor is
    // dropped the same way navigating away drops it: the row you just picked is
    // the newer intent.
    const shelfCap = view.querySelector('.profile-shelf-cap');
    view.querySelector('#profile-filter-btn')
      ?.addEventListener('click', (e) => openFilterDial(e.currentTarget, {
        current: profileFilter,
        filters,
        label: isSelf ? 'Filter your posts' : `Filter ${u.name}’s posts`,
        onPick: (key) => {
          if (key === profileFilter) return;
          profileFilter = key;
          profileFilterFor = u.username;
          editingId = null;
          syncFilterBtn('profile-filter-btn', profileFilter);
          if (shelfCap) shelfCap.textContent = shelfLabel();
          paintPosts(true);
        },
      }));

    // JS deals the frame wall's columns, so a WIDTH change is ours to answer —
    // the same contract as Discover's, and it watches width and nothing else for
    // the same reason: on iOS a `resize` is mostly a HEIGHT event (the keyboard
    // rising, Safari's URL bar collapsing as you scroll), and re-dealing then is
    // a forced reflow of the whole wall for an answer that cannot have changed.
    profileResizeOff?.();
    let sizeTimer = 0, lastW = window.innerWidth;
    const onResize = () => {
      if (window.innerWidth === lastW) return;
      lastW = window.innerWidth;
      clearTimeout(sizeTimer);
      sizeTimer = setTimeout(() => {
        if (feedEl.isConnected) dealMasonry(feedEl.querySelector('.pgrid'), false);
      }, 120);
    };
    window.addEventListener('resize', onResize, { passive: true });
    profileResizeOff = () => {
      clearTimeout(sizeTimer);
      window.removeEventListener('resize', onResize);
      profileResizeOff = null;
    };

    const friendBtn = document.getElementById('friend');
    if (friendBtn) friendBtn.addEventListener('click', async () => {
      // Already friends → open the menu (Remove / Block / Report) rather than
      // dropping the edge on one stray tap. sent → cancel the request; add /
      // accept both create my edge.
      const status = friendBtn.dataset.status;
      if (status === 'friends') { openFriendMenu(u.username, () => renderUser(username)); return; }
      // sent → cancel the request · following → unfollow. Both drop my edge.
      if (status === 'sent' || status === 'following') await Store.removeFriend(u.username);
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
          { label: 'Edit profile', icon: 'pencil', run: () => { editorPushed = true; go('#/profile/edit'); } },
        ] });
        return;
      }
      openSheet({
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

  /* ── Profile editor ──────────────────────────────────────────────────────
     One place for everything about you: your photo, display name, and bio (plus
     the notifications toggle, Log out and Delete). There is no separate avatar
     editor any more — the photo folds in here: pick a file to reveal an inline
     square cropper (initCropper, the app's only crop), move and scale it, and
     Save commits the words plus, if you chose a new photo, a 512² JPEG of the
     framed region. Saves via Store.updateProfile / updateAvatar and then leaves,
     which re-renders the profile off the cache the write already updated.

     It is a PAGE (`#/profile/edit`), and it used to be a modal. Three things
     were wrong with the card, and only the first one is cosmetic. `.modal` is a
     fixed, centred flex box with no `overflow` and no `max-height` on the card,
     so a form taller than the screen was clipped at BOTH ends with nothing left
     to scroll — the body is locked while a modal owns it, and the veil doesn't
     scroll either. It shipped that way: the title was shorn off the top on a
     normal phone. Second, a modal is not a history entry and `route()` never
     swept one away, so the App Store build's edge-swipe rendered the page
     underneath and left the card floating over a body still stuck at
     `overflow: hidden`. Third, this is a fixed panel with a keyboard-summoning
     textarea in it, which is where iOS puts the keyboard over the buttons and
     leaves nothing to scroll. A page answers all three by being an ordinary
     page. It also puts the app's two editors in the same shell, since the
     composer — the bigger one, and the owner of the other cropper — has always
     been a page.

     Two rules the photo half earns the hard way. Save is DISABLED from the
     moment a file is picked until the crop has actually decoded, and export()
     is taken before anything commits — a pick that never decodes used to throw
     out of the submit handler, leaving the name and bio saved, the photo not,
     and the modal open with nothing said. And every failure along the way says
     so in `#pf-error`: a photo that can't be read is the one thing here the
     reader can fix, and silence made it look like the whole editor was dead. */
  /* The Private account hint, written in the present tense about the profile as
     it stands. Since Stage 2 the account flag no longer gates who can read a
     post (each post carries its own audience), so it describes what it actually
     still does: pick the default the composer preselects in "Who can see this?".
     Both states name the activity default too, since it doesn't follow the flag. */
  function privacyHint(isPrivate) {
    return isPrivate
      ? `Your profile is private. New posts are visible to your circle by ` +
        `default. Activities are visible to your circle by default.`
      : `Your profile is public. New posts are visible to everyone by default. ` +
        `Activities are visible to your circle by default.`;
  }

  function renderEditProfile() {
    const u = Store.currentUser();
    if (!u) { go('#/'); return; }
    // Consumed on arrival, the way renderPublish consumes pendingDaily: the flag
    // belonged to the tap that came here, not to the page.
    const canPop = editorPushed;
    editorPushed = false;

    view.innerHTML =
      `<section class="view">` +
        // The way out, in the spot every other pushed page keeps it. A button
        // and not an <a href="#/profile">, because leaving here should POP the
        // entry rather than push a third one (see leave()).
        // No masthead. The back button already names where you are relative to,
        // the ••• row you came from was labelled "Edit profile", and every field
        // below says what it is — a kicker and a serif title over a settings form
        // is the page introducing itself to someone who just asked for it.
        `<button type="button" class="profile-back" id="pf-back">← Profile</button>` +
        `<form id="pf-form" class="pf-form" novalidate>` +
          // The photo sits in its own colour: the profile gradient, the same
          // --glow-photo the identity card wears, washed out from behind the
          // circle. It is here rather than only on the card because this is the
          // page where you SET it, and a colour is the one setting you cannot
          // read off a control — you have to watch it land on something.
          //
          // Two badges on the rim, and they are a pair on purpose: the camera at
          // bottom-right changes the picture, the half-filled ring at bottom-left
          // changes the colour, both tucked into the same arc at the same size.
          // The ring's fill takes the current colour, so the control displays the
          // setting rather than describing it.
          `<div class="pf-photo" id="pf-photo">` +
            `<div class="pf-photo-figure">` +
              avatarEl(u, { cls: 'pf-photo-avatar' }) +
              // Div, not <button>: kills the iOS standalone native pressed-fill
              // flash on this filled badge (same fix as the composer dropzone).
              `<div class="pf-photo-edit" id="pf-photo-pick" role="button" tabindex="0" ` +
                `aria-label="Change your photo" title="Change your photo">` +
                svgIcon('camera', 'pf-photo-ico') + `</div>` +
              `<div class="pf-photo-accent" id="pf-accent" role="button" tabindex="0" ` +
                `aria-label="Profile colour" title="Profile colour">` +
                svgIcon('tint', 'pf-accent-ico') + `</div>` +
            `</div>` +
          `</div>` +
          `<input id="pf-file" type="file" accept="image/*" hidden>` +
          // The crop surface: the round frame, its caption, its way back out, in
          // a centred column on the same axis as the resting avatar it replaces
          // and at the same size, so picking a photo fills the circle instead of
          // moving it. Nothing floats INSIDE the circle (`overflow: hidden` plus a
          // 50% radius clips a pill to the chord, which sliced the ends off the
          // hint this arrangement replaced).
          `<div class="crop-stage" id="pf-cropstage" hidden>` +
            `<div class="crop crop--avatar" id="pf-crop">` +
              `<img id="pf-cropimg" alt="" draggable="false">` +
            `</div>` +
            `<p class="crop-hint" id="pf-crophint"></p>` +
            `<div class="crop-replace" id="pf-replace" role="button" tabindex="0">Choose another</div>` +
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
          // Notifications + privacy sit below the identity as quiet settings.
          // Notifications lead: it's the smaller, self-contained switch, so the
          // privacy pair (switch + its live sentence) closes the group instead of
          // being split by another row.
          pushToggleHtml() +
          `<div class="push-toggle-row">` +
            `<span class="push-toggle-label" id="privacy-label">Private account</span>` +
            `<button type="button" class="push-toggle" role="switch" id="privacy-toggle" ` +
              `aria-checked="${u.private !== false}" ` +
              `aria-labelledby="privacy-label privacy-hint">` +
              `<span class="push-toggle-knob" aria-hidden="true"></span>` +
            `</button>` +
          `</div>` +
          // The hint states what the profile *is* right now, not what the switch
          // would do — one less translation step between the control and reality.
          `<p class="field-hint" id="privacy-hint">${privacyHint(u.private !== false)}</p>` +
          `<p class="composer-error" id="pf-error" role="alert"></p>` +
          // Cancel + Save are the form's commit row. Account actions (Log out,
          // Delete) live in their own zone below, split off by a hairline — they
          // act on the session, not this form, so they read as a separate group.
          `<div class="form-actions">` +
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
      `</section>`;

    const nameEl = view.querySelector('#pf-name');
    const bioEl = view.querySelector('#pf-bio');
    const countEl = view.querySelector('#pf-count');
    const errEl = view.querySelector('#pf-error');
    const privacyBtn = view.querySelector('#privacy-toggle');

    // A plain UI switch — it holds its state until Save commits it alongside the
    // words (Cancel discards it, same as name/bio).
    const privacyHintEl = view.querySelector('#privacy-hint');
    privacyBtn.addEventListener('click', () => {
      const on = privacyBtn.getAttribute('aria-checked') === 'true';
      privacyBtn.setAttribute('aria-checked', String(!on));
      privacyHintEl.textContent = privacyHint(!on);
    });

    // Leaving POPS where it can. go() always pushes (see its note), so a Save
    // that navigated forward would leave the editor sitting one edge-swipe
    // behind the profile you just saved, ready to reopen itself — the modal's
    // one genuine advantage, given away for nothing. A cold arrival (a bookmark,
    // a reload on this hash) has no entry to pop, so it navigates instead.
    const leave = () => {
      if (canPop) history.back();
      else go('#/profile');
    };
    view.querySelector('#pf-back').addEventListener('click', leave);
    view.querySelector('#pf-cancel').addEventListener('click', leave);

    // The avatar write is optimistic and the store rolls the cache back if the
    // upload fails — but by then the reader has left this page, so the repaint
    // has to find them. Only on a page their own face is actually on: a blind
    // route() from here would rebuild the whole of Discover to correct an avatar
    // that isn't in it.
    const revertedAvatar = () => {
      const here = (location.hash || '#/').split('?')[0];
      if (here === '#/profile' || here === '#/u/' + encodeURIComponent(Store.session())) route();
    };

    // A page's DOM is replaced by the next navigation, which drops the nodes but
    // not the cropper's ResizeObserver or a frame it has already queued. Same
    // contract as the composer's camera teardown, and route() calls both.
    stopActiveCrop = () => { if (pfCropper) pfCropper.destroy(); };

    // A quiet live count so the 160-char bio ceiling never feels like a surprise.
    const updateCount = () => {
      countEl.textContent = `${bioEl.value.length} / 160`;
    };
    bioEl.addEventListener('input', updateCount);
    updateCount();

    // Photo: pick a file → an inline square crop replaces the thumbnail. Save
    // commits it alongside the words; no file chosen leaves the photo untouched.
    const pfFile = view.querySelector('#pf-file');
    const pfStage = view.querySelector('#pf-cropstage');
    const pfCropEl = view.querySelector('#pf-crop');
    const pfCropImg = view.querySelector('#pf-cropimg');
    const pfPhotoRow = view.querySelector('#pf-photo');
    const pfHint = view.querySelector('#pf-crophint');
    const pfSave = view.querySelector('#pf-save');
    let pfCropper = null;
    // Two gestures, one of which doesn't exist on the device you're holding, so
    // name the one that does.
    pfHint.textContent = finePointer()
      ? 'Drag to move, scroll to zoom.'
      : 'Drag to move, pinch to zoom.';

    const pfPick = view.querySelector('#pf-photo-pick');   // role=button div, not <button>
    const pfReplace = view.querySelector('#pf-replace');
    // Clearing the input first is what makes re-picking the SAME file fire
    // `change` again — otherwise choosing the photo you just chose does nothing,
    // which reads as the picker being broken rather than as a no-op.
    const openPicker = () => { pfFile.value = ''; pfFile.click(); };
    const pickKey = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPicker(); } };
    pfPick.addEventListener('click', openPicker);
    pfPick.addEventListener('keydown', pickKey);

    // The colour ring on the opposite rim. Same role=button div as the camera, for
    // the same reason (iOS standalone flashes a native pressed fill on a filled
    // <button>), so it needs the same keyboard pair the camera gets.
    const pfAccent = view.querySelector('#pf-accent');
    const openAccent = () => openAccentSheet();
    pfAccent.addEventListener('click', openAccent);
    pfAccent.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openAccent(); }
    });
    pfReplace.addEventListener('click', openPicker);
    pfReplace.addEventListener('keydown', pickKey);

    // Save waits for the crop to decode: export() reads the image, so committing
    // early is how a pick that never landed used to take the whole submit down
    // with it. Cheap here (a data URL decodes in a frame or two) and the one
    // thing standing between a bad file and a form that does nothing.
    const cropBusy = (busy) => { pfSave.disabled = busy; };

    pfFile.addEventListener('change', () => {
      const f = pfFile.files && pfFile.files[0];
      if (!f) return;
      errEl.textContent = '';
      cropBusy(true);
      const reader = new FileReader();
      reader.onerror = () => {
        cropBusy(false);
        errEl.textContent = 'Couldn’t read that file, try another photo.';
      };
      reader.onload = () => {
        pfPhotoRow.hidden = true;
        pfStage.hidden = false;
        if (pfCropper) pfCropper.destroy();
        pfCropper = initCropper(pfCropEl, pfCropImg, reader.result, {
          onReady: () => { cropBusy(false); },
          onError: () => {
            cropBusy(false);
            pfCropper = null;
            pfStage.hidden = true;
            pfPhotoRow.hidden = false;
            errEl.textContent = 'Couldn’t open that photo, try another one.';
          },
        });
      };
      reader.readAsDataURL(f);
    });

    view.querySelector('#pf-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      // Take the crop BEFORE anything commits. Save is already held until the
      // image decodes, so this is the belt to that pair of braces — but the
      // failure it catches was silent and expensive: export() used to throw
      // InvalidStateError straight out of this handler on an image that never
      // loaded, which left the name and bio saved, the photo not, and the page
      // sitting there with nothing said either way.
      let shot = null;
      if (pfCropper) {
        try { shot = pfCropper.export(512); } catch { shot = null; }
        if (!shot) { errEl.textContent = 'That photo didn’t load, choose another one.'; return; }
      }
      // A network round trip with a live button in front of it is two saves from
      // one impatient tap; finally, so a throw can't leave Save dead either.
      pfSave.disabled = true;
      try {
        const res = await Store.updateProfile({
          name: nameEl.value, bio: bioEl.value,
          isPrivate: privacyBtn.getAttribute('aria-checked') === 'true',
        });
        if (!res.ok) { errEl.textContent = res.error; return; }
        // A freshly cropped photo commits alongside — optimistic (cache updates
        // synchronously), upload in the background; on failure the store reverts.
        const pendingAvatar = shot ? Store.updateAvatar(shot) : null;
        leave();
        if (pendingAvatar) pendingAvatar.then(r => { if (!r.ok) { revertedAvatar(); toast(r.error); } });
      } finally {
        pfSave.disabled = false;
      }
    });

    // Account controls: the notifications toggle and Log out, now homed here.
    wirePushToggle();
    view.querySelector('#pf-logout').addEventListener('click', async () => {
      await Store.logout();
      // Where you had scrolled to is part of the world that just got thrown
      // away. Both memories, because both would otherwise be read by whoever
      // signs in next: the path memory on a tab tap, the entry memory on a back.
      pathScroll.clear();
      scrollMemory.clear();
      authMode = 'login';        // returning user — offer login first
      go('#/signin');
    });

    // Delete account: one sheet standing in for "are you sure", so an accidental
    // tap next to Log out can't fall through to something unrecoverable. The
    // sheet's own Cancel (always rendered) is the escape hatch.
    view.querySelector('#pf-delete').addEventListener('click', () => {
      openSheet({
        title: 'Delete your account? This can’t be undone.',
        items: [{
          label: 'Delete account', icon: 'trash', danger: true,
          run: async () => {
            const res = await Store.deleteAccount();
            if (!res.ok) { toast(res.error); return; }
            authMode = 'signup';   // no account left to log back into
            go('#/');
            toast('Account deleted.');
          },
        }],
      });
    });

    // Desktop only — on touch, opening the keyboard the moment the page lands
    // covers half of it before anyone has decided to type (see the same guard on
    // the post edit form).
    if (finePointer()) {
      nameEl.focus();
      nameEl.select();
    }
  }

  // The "← Back" link atop a friend's profile points wherever you came from
  // (home, Discover, your own profile…), not always one place. `profileOrigin` is
  // set by the router when you enter a profile from a non-profile page.
  function backTarget() {
    const labels = {
      '#/': 'My Circle',
      '#/discover': 'Discover',
      '#/profile': 'Profile',
    };
    // A daily's answers are a browsing surface too, so a profile opened from one
    // goes back to the question rather than dumping you on Discover.
    if (profileOrigin.startsWith('#/daily/')) return { href: profileOrigin, label: 'Daily' };
    const href = labels[profileOrigin] ? profileOrigin : '#/discover';
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
  // Two shapes, one sheet. `items` is the ordinary list of labelled rows; `head`
  // is arbitrary markup mounted ABOVE them inside the same panel, wired by the
  // caller's `wire(scrim, close)`. The accent picker is the one caller that uses
  // it — a grid of swatches is not a list of rows, but it is the same scrim, the
  // same panel, the same focus trap and the same way out, and a second copy of
  // all of that to hold one grid would be the expensive way to be inconsistent.
  // `scrimClass` exists for that caller too (see .sheet-scrim--see-through).
  function openSheet({ title, items, head, wire, scrimClass }) {
    if (sheetOpen) return;
    sheetOpen = true;
    items = items || [];
    const scrim = document.createElement('div');
    scrim.className = 'sheet-scrim' + (scrimClass ? ' ' + scrimClass : '');
    const rows = items.map((it, i) =>
      `<button class="sheet-item${it.danger ? ' sheet-item--danger' : ''}" type="button" data-i="${i}">` +
        (it.icon ? svgIcon(it.icon, 'sheet-ico') : '') +
        `<span>${esc(it.label)}</span>` +
      `</button>`).join('');
    scrim.innerHTML =
      `<div class="sheet" role="dialog" aria-modal="true"${title ? ` aria-label="${esc(title)}"` : ''}>` +
        (title ? `<p class="sheet-title">${esc(title)}</p>` : '') +
        `<div class="sheet-items">${head || ''}${rows}</div>` +
        `<button class="sheet-cancel" type="button">Cancel</button>` +
      `</div>`;
    document.body.appendChild(scrim);
    document.body.style.overflow = 'hidden';
    // Remember who opened the sheet so focus can return there on close (HIG /
    // WAI-ARIA dialog: focus moves in on open, is trapped while open, returns on
    // close). Move focus to the first action once it's painted.
    const opener = document.activeElement;
    const focusables = () => [...scrim.querySelectorAll('.sheet-item, .swatch, .sheet-cancel')];
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
        // The one haptic that fires on the touch rather than on a confirmed
        // write, and correctly so: a danger row is a warning ABOUT what's coming,
        // not a receipt for something done. Blocking, deleting and reporting all
        // route through here, so this is the single place it belongs.
        if (it && it.danger) hapticEvent('WARNING');
        close(() => { if (it && it.run) it.run(); });
      }));
    if (wire) wire(scrim, close);
    document.addEventListener('keydown', onKey);
  }

  /* ── Profile colour ─────────────────────────────────────────────────────────
     The picker behind the colour ring on Edit profile. Ten choices in two
     groups, and the grouping is the argument: a SOURCE row (sample it from my
     photo · no colour at all) over the eight colours you can name. The photo
     option wears the photo, cropped into the same disc as every swatch beside
     it, so the two sources are comparable objects rather than a picture-shaped
     thing sitting next to a colour-shaped thing.

     It reads Store.currentUser() rather than taking the `u` renderEditProfile
     captured: a pick replaces that object in the cache, so a captured one goes
     stale the first time you use this and the checkmark would sit on the
     previous colour.

     A sheet rather than a row of swatches in the form, because a colour is the
     one setting whose value you cannot read off a control — you have to see it
     land. So the scrim is deliberately thin (.sheet-scrim--see-through), the
     page's wash stays lit above it, the pick paints SYNCHRONOUSLY, and the
     ring you opened it from wears the current colour the whole time. */
  function openAccentSheet() {
    const me = Store.currentUser();
    if (!me) return;
    // No photo, no photo option. Falling back to 'none' for the checkmark is
    // exact rather than a shrug: with nothing to sample, "from my photo" and
    // "no colour" are the same card, and the mark belongs on the one you can see.
    const current = me.accent || (me.avatar ? 'auto' : 'none');

    // The fill goes on the DISC, not the button: --sw and the photo's
    // background-image are both painted by .swatch-disc, and a url() on the
    // button would sit behind the label with no background-size to size it.
    const swatch = (key, label, fill) =>
      `<button class="swatch${key === current ? ' is-on' : ''}" type="button" ` +
        `role="menuitemradio" aria-checked="${key === current}" data-accent="${key}" ` +
        `title="${esc(label)}">` +
        `<span class="swatch-disc"${fill ? ` style="${fill}"` : ''}>` +
          `<span class="swatch-tick" aria-hidden="true">${svgIcon('check')}</span>` +
        `</span>` +
        `<span class="swatch-label">${esc(label)}</span>` +
      `</button>`;

    const head =
      `<div class="swatches swatches--source" role="group" aria-label="Colour source">` +
        (me.avatar ? swatch('auto', 'Photo', `background-image:url(${esc(me.avatar)})`) : '') +
        swatch('none', 'None') +
      `</div>` +
      `<div class="swatches" role="group" aria-label="Colours">` +
        ACCENTS.map(a => swatch(a.key, a.label, `--sw:${accentCss(a.key)}`)).join('') +
      `</div>`;

    openSheet({
      scrimClass: 'sheet-scrim--see-through',
      head,
      wire: (scrim, close) => {
        scrim.querySelectorAll('.swatch').forEach(btn =>
          btn.addEventListener('click', () => {
            const key = btn.dataset.accent;
            // Re-picking the colour you already wear repaints nothing, so it gets
            // no buzz and no write — the same rule the filter dial keeps, and for
            // the same reason: a haptic means a change landed.
            if (key === current) { close(); return; }
            hapticTap('LIGHT');
            const val = key === 'auto' ? null : key;
            // updateAccent patches the cache before its first await, so the world
            // this reads is already the new one and the card changes under the
            // sheet in the same frame as the tap.
            const saving = Store.updateAccent(val);
            paintWash(Store.currentUser(), 'profile');
            saving.then(r => {
              if (!r.ok) toast(r.error);
              paintWash(Store.currentUser(), 'profile');  // confirmed, or store reverted it
            });
            close();
          }));
      },
    });
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

  /* ── Dailies — one prompt, twenty-four hours, the whole room ─────────────────
     A daily is a question everybody gets on the same day, and ANSWERING IT IS
     JUST POSTING. Each daily names a post type ("post the best thing you ate
     this week" suggests a Frame) and an answer is an ordinary post carrying the
     daily's tag. No new content type, no new privacy rule, no new table — which
     is why the whole feature is the array below plus one view.

     THE TYPE IS A DEFAULT, NOT A REQUIREMENT (see dailyAccepts). It aims the
     composer and picks the colour, but any non-activity type answers any prompt
     — write a note about the meme instead of posting one, and it still counts.
     This used to be enforced (a photo prompt that took a paragraph "isn't a
     prompt, it's a suggestion box"), and the one escape hatch was `accepts:
     'any'`, spent on exactly one prompt. Opening every prompt is the same move
     made everywhere at once: the question still tells you what's easy to bring,
     it just stops policing what you actually bring.

     THE CARD IS THE COLOUR, THE ANSWER IS THE COLOUR IT WAS ASKED IN. Since any
     type answers any prompt, the Discover card carries all three at once — a
     fixed lavender→coral→cyan gradient, the same on every card, saying "note,
     link or frame, your call" rather than naming one. The detail page it opens,
     the tag an answer wears, and the composer banner keep the PROMPT's single
     nominal hue, unchanged: that's the question's colour, not a claim about what
     you made, and it's exactly how `accepts: 'any'` already behaved before this.
     ACTIVITIES ARE EXCLUDED on purpose: an activity carries a place and a time
     and lands in the real world, and the app's second interaction gate
     (canJoin) keeps that circle-only. A prompt that asks the whole room to show
     up somewhere is the one thing it's built not to do.

     THE SCHEDULE IS THE ARRAY. Day 0 is DAILY_EPOCH, in local time, and the list
     rotates from there — N prompts is an N-day loop that never runs out and never
     needs a server. Editing it reschedules everything from today forward and
     touches nothing behind: posted answers keep their tag AND the question printed
     on them, because a post resolves its prompt by slug rather than by recomputing
     the calendar (see dailyForPost, which is where that has to hold).

     AN ANSWER IS A TAGGED POST, and the tag is `daily-<slug>`. That buys the whole
     feature for free: answers ride the same audience rules as any other post (a
     private account's answer reaches their circle, not the room, which is the right
     behaviour for an app whose whole pitch is local), they're editable and
     deletable from their own card, they show up on their author's profile, and
     search already finds them. The 24-hour WINDOW is what keeps the rotation
     honest: an answer counts for the occurrence it was posted inside, so when a
     prompt comes round again ten weeks later it opens empty rather than on last
     season's replies.

     Daily tags are held out of Discover's trending rail (see topTags): the rail
     indexes what the room brought up on its own, and a tag the app hands out to
     everybody would win it every single day. */
  // Day 0 of the rotation, at local midnight. Launch day, and a Tuesday: the code
  // shipped the evening before so every home-screen install had the night to pick
  // up the new build (the ?v= self-updater only fires on launch/foreground), and
  // then the first card appeared for everybody at once with a full 24h on it
  // rather than trickling out mid-afternoon with seven hours left. Before this
  // date dailyOn returns null and no card renders at all, which is what made that
  // possible. MOVING THIS MOVES EVERY WEEKDAY — see the rotation below.
  const DAILY_EPOCH = '2026-07-28';

  /* The rotation. `type` picks the colour and what the composer opens as — one of
     note / find / photo / poll. It no longer restricts what counts as an answer
     (any non-activity type does, see dailyAccepts); it's a suggestion, not a
     requirement.

     NO HINTS, AND THAT'S THE DESIGN. The optional `hint` field still renders
     everywhere it used to (the card's quiet line, the daily page's lede) and a
     prompt can take one back at any time — but the shipped rotation has none, so
     don't read the empty column as an oversight. Every hint the set started with
     was doing the same job: telling people a low-effort answer was allowed
     ("cereal counts", "bad lighting encouraged", "water counts, barely"). Five of
     them were literally the same "X counts / X is fine" sentence. That's a
     question apologising for itself, and it reads as the app being nervous on
     your behalf. The fix isn't a better hint, it's a prompt specific enough to
     imply its own low bar — "the SMALLEST good thing", "something you've KEPT for
     years" — so the question carries the permission instead of a caption under
     it. If a prompt seems to need a hint, rewrite the prompt.

     SEVENTY, AND THE MULTIPLE OF SEVEN IS THE LOAD-BEARING PART: 70 is 10 × 7,
     so every prompt keeps the same weekday forever. That's the whole scheduling
     tool. Day 0 is a TUESDAY (see DAILY_EPOCH), so a row's weekday is its index
     mod 7 counted from there — 0 Tue, 1 Wed, 2 Thu, 3 Fri, 4 Sat, 5 Sun, 6 Mon —
     and every Thursday is an index ≡ 2, every Monday an index ≡ 6. Count from the
     epoch's weekday, not from the top of the list. Mondays are always cheap
     because nobody has the energy; Thursday is always the Find, one link a week
     on a known day; Friday drifted argumentative (laughed, hot take, pettiest
     hill) and it stays that way; Sunday is the soft landing. Keep the count a
     multiple of 7 or the pattern dissolves, and if the epoch ever moves, ROTATE
     THE ARRAY BY THE SAME NUMBER OF DAYS or every one of those roles slides onto
     the wrong weekday.

     It was 21 (3 × 7) until 2026-08-16 and the loop is now ten weeks. Only the
     number in this heading changed, which is the point of the rule: appending
     whole weeks costs nothing and reschedules nothing behind it, while appending
     a partial one would slide every weekday role in the set onto the wrong day.

     WEEK ONE IS DELIBERATELY ALL CHEAP, and it opens on a meme: the one photograph
     everybody has already saved, already sent, and doesn't have to make, take or
     even look up. A launch week that starts with a wall gets answered by nobody,
     and an empty daily page on day one is an argument against dailies. Day 0 also
     costs nothing to get wrong, which is what a first impression of the feature
     should cost. The first prompt asking for real effort is nine days in, by which
     point a daily is a thing people recognise rather than a thing they're meeting.

     NO POLLS, NO ACTIVITIES. Activities are excluded structurally (see the note
     up top). Polls are excluded editorially: every other prompt asks you for a
     thing you already have, and a poll asks you to author a question — the one
     prompt in the set with real setup cost, on the day most likely to look empty.
     `type: 'poll'` still works everywhere if that ever changes; it's simply not
     scheduled, which is why a daily is a three-colour feature.

     WRITE FOR THE LOOP: this comes round every ten weeks, so a prompt has to be
     re-answerable. "What song is stuck in your head" survives forever because the
     answer moves; "what's your favourite X" doesn't, because you have one and the
     second time round it's a chore. `meme` is the knowing exception, kept because
     it's funny and expected to thin out on later runs — which is exactly why it
     leads: run one is the fullest it will ever be, and that run is launch day. If
     it does thin, the fix is to date it ("the meme you've sent the most this
     week") rather than to move it. Slang dates faster than
     structure, so the humour lives in the specificity, not the vocabulary. */
  /* SCHEDULE ON `kind`, NEVER ON `type`. This is the rule that got re-derived on
     2026-08-16 against the first three weeks of real answers, and the correction
     matters more than the prompts it produced.

     `type` is what the ANSWER is filed as, and every prompt takes every type, so
     it cannot describe a prompt at all. The rotation was still being spaced by it
     ("no two neighbouring days share a type") because in the first 21 the two
     columns happened to agree: note prompts wanted a sentence, photo prompts
     wanted the camera roll, find prompts wanted a link. The proxy holds right up
     until it doesn't — `bookmarked` is a `find` that costs nothing (it's already
     in your bookmarks) and `ate` is a `photo` you have to have thought about
     days ago — and those are exactly the rows where spacing by type puts the
     wrong two days next to each other.

     `kind` is what the prompt COSTS THE READER, which is the thing a rotation is
     actually pacing. Three values, editorial only, read by nobody at runtime:

       retrieval — it already exists, on your phone or in the room. No production.
       report    — it's in your head; it costs one sentence and nothing else.
       errand    — you have to leave the app, make something, or go somewhere.

     THE FIRST 21 DAYS PRICED THESE, and the spread is not subtle. Mean answers:
     retrieval 8.3 (meme 11, on-repeat 10, last-photo 8, never-delete 13, kept 5,
     desk 3) · report 6.7 (stuck 10, npc 9, hot-take 8, overthink 8, miss 7,
     small-good 6, petty 5, flowers 4, laughed 3) · errand 4.6 (come-back 8,
     made 5, must-watch 4, one-song 4, ate 2). An errand costs roughly half the
     room, every time, and the two weeks carrying two errands each (one and two)
     hold four of the five worst-performing prompts in the set.

     So: AT MOST ONE ERRAND A WEEK, and never two adjacent. Thursday holds it
     when there is one — Thursday stays the link day by `type`, which is a
     separate promise and still kept, but a link is only an errand when you
     haven't got it yet. `bookmarked` and `last-link` are Thursday finds that are
     retrievals, and weeks seven and ten are deliberately errand-free.

     AND NEVER THREE OF ONE KIND IN A ROW. Not "never two" — the old type rule
     banned every repeat and paid for it: with Thursday and Friday both pinned,
     strict alternation is arithmetically impossible around a loop whose first
     week opens on a photo, so one repeat was forced and a whole paragraph went
     on choosing where to spend it. Three is the number that was actually wrong.
     The complaint that started all this was four photo prompts at 11-14 reading
     as "post a picture again", and two in a row has never once been the problem.
     Dropping the impossible constraint is what frees `vibe-check` to sit on the
     Monday it was written for instead of being exiled to the end of the array.

     A RETRIEVAL STILL HAS TO POINT AT SOMETHING CHOSEN. The winners are not
     "photograph an object near you", they're "photograph an object that means
     something": never-delete 13, meme 11, on-repeat 10, kept 5. Ten prompts were
     cut on 2026-08-16 for being inventory rather than retrieval (the lock screen,
     the fridge, the closest object to your hand, whatever's on your feet), and
     `desk` at 3 is the one shipped example of the failure. Every retrieval below
     names a reason the thing survived: kept for years, never deleted, almost
     posted, photographed twice, open for weeks. */
  const DAILIES = [
    /* Week one, all cheap. TWO ERRANDS (must-watch, ate) and it shows: 4 answers
       and 2, the worst pair in the set. Kept as shipped because these rows have
       been answered and the slugs are the join key, but `ate` is the first
       candidate if this week is ever revised.                       Tue */
    { slug: 'meme',           type: 'photo', kind: 'retrieval', prompt: 'Post your favorite meme.' },
    { slug: 'stuck',          type: 'note',  kind: 'report',    prompt: 'What song is stuck in your head?' },
    { slug: 'must-watch',     type: 'find',  kind: 'errand',    prompt: 'Share a video you’ve made someone watch.' },
    { slug: 'laughed',        type: 'note',  kind: 'report',    prompt: 'What actually made you laugh this week?' },
    { slug: 'ate',            type: 'photo', kind: 'errand',    prompt: 'Show the best thing you ate this week.' },
    // "The smallest good thing" is answered just as well by the photograph of it
    // as by the sentence — this was the one prompt in the 21 that waived its type
    // before every prompt did.                                       Sun
    { slug: 'small-good',     type: 'note',  kind: 'report',    prompt: 'What’s the smallest good thing that happened this week?' },
    // Cheapest retrieval in the set, on the cheapest day, closing the cheapest
    // week: you open the camera roll and you're done, no thinking at all.  Mon
    { slug: 'last-photo',     type: 'photo', kind: 'retrieval', prompt: 'Show the last photo in your camera roll.' },

    // ── Week two ── also two errands (come-back, made).             Tue
    { slug: 'npc',            type: 'note',  kind: 'report',    prompt: 'What’s the most NPC thing you did today?' },
    { slug: 'on-repeat',      type: 'photo', kind: 'retrieval', prompt: 'Screenshot what you’ve had on repeat.' },
    // Thursday's find, on the reason rather than the medium: made-someone-watch,
    // keep-coming-back, room-needs-to-hear are three different questions. Sorted
    // by recommendation type they were one question asked three ways.
    { slug: 'come-back',      type: 'find',  kind: 'errand',    prompt: 'Share something you keep coming back to.' },
    { slug: 'hot-take',       type: 'note',  kind: 'report',    prompt: 'What’s a hot take you’d defend in court?' },
    { slug: 'made',           type: 'photo', kind: 'errand',    prompt: 'Post something you made this week.' },
    // Sunday, and the softest of the three: the first prompt in the rotation that
    // asks you to REMEMBER something rather than report what's in front of you.
    { slug: 'miss',           type: 'note',  kind: 'report',    prompt: 'What do you miss that you didn’t expect to?' },
    // The one shipped retrieval that points at inventory rather than at something
    // chosen, and it scored 3. "No tidying" made it worse, not cheaper.
    { slug: 'desk',           type: 'photo', kind: 'retrieval', prompt: 'Show us your desk, no tidying.' },

    // ── Week three ──                                               Tue
    { slug: 'overthink',      type: 'note',  kind: 'report',    prompt: 'What are you overthinking right now?' },
    // Still cheap — you look around the room, you don't make anything — but the
    // object has a history, which is the difference between retrieval and
    // inventory, and retrieval is what survives the loop.
    { slug: 'kept',           type: 'photo', kind: 'retrieval', prompt: 'Show us something you’ve kept for years.' },
    { slug: 'one-song',       type: 'find',  kind: 'errand',    prompt: 'Share one song the room needs to hear.' },
    { slug: 'petty',          type: 'note',  kind: 'report',    prompt: 'What’s the pettiest hill you’re dying on?' },
    // Same shrug of effort as the camera-roll prompts, pointed at a chosen picture
    // instead of an arbitrary one. Top of the whole set at 13.
    { slug: 'never-delete',   type: 'photo', kind: 'retrieval', prompt: 'Show us a photo you’d never delete.' },
    { slug: 'flowers',        type: 'note',  kind: 'report',    prompt: 'Who deserves their flowers today?' },
    /* MONDAY IS THE ONE-LINE CHECK-IN, three times in the loop (here, 55, 69).
       The shape is vibe-check's: a question with a hard limit in it, so the whole
       answer is the first thing you'd say out loud. It's the cheapest report
       there is, which is what a Monday wants, and the limit is what keeps it from
       being homework. Three is the ceiling — a fourth and the loop starts feeling
       like a form. Vary the FRAME, never just the word count. */
    { slug: 'title',          type: 'note',  kind: 'report',    prompt: 'Give today a title.' },

    /* ── Weeks four to ten, added 2026-08-16 ──
       The loop is long enough now that a prompt can be specific about the
       internet without being about one week of it. Perfectly-cut screams and the
       video that gets you every time are formats, not slang, so they age like the
       camera-roll prompts do rather than like a catchphrase. The chaos stays
       spread across the week rather than clumped — one cursed photo is funny, a
       run of them is a bit. */

    // ── Week four ──                                                Tue
    { slug: 'cursed',         type: 'photo', kind: 'retrieval', prompt: 'Post a cursed photo.' },
    { slug: 'search',         type: 'note',  kind: 'report',    prompt: 'What’s the last thing you searched that you’d rather not explain?' },
    { slug: 'scream',         type: 'find',  kind: 'errand',    prompt: 'Share a perfectly cut scream.' },
    { slug: 'overrated',      type: 'note',  kind: 'report',    prompt: 'What’s overrated, and you’re tired of pretending otherwise?' },
    { slug: 'outside',        type: 'photo', kind: 'retrieval', prompt: 'Show us where you ended up today.' },
    { slug: 'took',           type: 'note',  kind: 'report',    prompt: 'What are you taking with you from this week?' },
    // A rule picks the photo for you, so there is nothing to choose and nothing
    // to be embarrassed by. The exception that proves the chosen-object rule: the
    // arbitrariness IS the hook, the way last-photo's is.
    { slug: 'ninth',          type: 'photo', kind: 'retrieval', prompt: 'Show us the ninth photo in your camera roll.' },

    // ── Week five ──                                                Tue
    { slug: 'replay',         type: 'note',  kind: 'report',    prompt: 'What sentence keeps replaying in your head?' },
    // One line, not the thread: a screenshot of a whole conversation is somebody
    // else's writing, and out of context is the entire joke anyway.
    { slug: 'group-chat',     type: 'photo', kind: 'retrieval', prompt: 'Screenshot one line from a group chat, no context.' },
    { slug: 'cry-laugh',      type: 'find',  kind: 'errand',    prompt: 'Share the video that makes you cry laugh every time.' },
    { slug: 'wrong-about',    type: 'note',  kind: 'report',    prompt: 'What is everyone wrong about?' },
    { slug: 'bought',         type: 'photo', kind: 'retrieval', prompt: 'Show us the last thing you bought.' },
    { slug: 'unnoticed',      type: 'note',  kind: 'report',    prompt: 'What did you do this week that nobody noticed?' },
    { slug: 'window',         type: 'photo', kind: 'retrieval', prompt: 'Show us the weather out your window.' },

    // ── Week six ──                                                 Tue
    { slug: 'shower',         type: 'note',  kind: 'report',    prompt: 'What argument did you win in the shower?' },
    // Retrieval with a reason attached: the photo exists AND something stopped you
    // posting it, which is the part worth reading.
    { slug: 'almost-posted',  type: 'photo', kind: 'retrieval', prompt: 'Show us the photo you almost posted and didn’t.' },
    { slug: 'rabbit-hole',    type: 'find',  kind: 'errand',    prompt: 'Share the rabbit hole you fell down this week.' },
    { slug: 'food-take',      type: 'note',  kind: 'report',    prompt: 'What food opinion gets you in trouble?' },
    { slug: 'sign',           type: 'photo', kind: 'retrieval', prompt: 'Show us a sign that made you look twice.' },
    { slug: 'kind',           type: 'note',  kind: 'report',    prompt: 'What’s the kindest thing someone did for you lately?' },
    { slug: 'bag',            type: 'photo', kind: 'retrieval', prompt: 'Show us what’s in your bag.' },

    // ── Week seven, errand-free on purpose ──                       Tue
    { slug: 'excuse',         type: 'note',  kind: 'report',    prompt: 'What’s the best excuse you’ve used this week?' },
    { slug: 'reaction',       type: 'photo', kind: 'retrieval', prompt: 'Show us the reaction image you use most.' },
    /* A Thursday find that is a RETRIEVAL: the link is already in your messages,
       so the link day costs nothing this week. must-watch asks for your best one
       and takes an errand to answer; this asks for your LAST one and takes a
       scroll. Cheap and curated are different questions, not the same one twice. */
    { slug: 'last-link',      type: 'find',  kind: 'retrieval', prompt: 'Share the last link you sent someone.' },
    { slug: 'ban',            type: 'note',  kind: 'report',    prompt: 'What would you ban if nobody could argue back?' },
    { slug: 'out-of-place',   type: 'photo', kind: 'retrieval', prompt: 'Show us something that shouldn’t be there.' },
    { slug: 'again',          type: 'note',  kind: 'report',    prompt: 'What would you happily do again tomorrow?' },
    { slug: 'screenshot',     type: 'photo', kind: 'retrieval', prompt: 'Show us your most recent screenshot.' },

    // ── Week eight ──                                               Tue
    { slug: 'convinced',      type: 'note',  kind: 'report',    prompt: 'What are you weirdly convinced of?' },
    { slug: 'walls',          type: 'photo', kind: 'retrieval', prompt: 'Show us what’s on your walls.' },
    { slug: 'rewatch',        type: 'find',  kind: 'errand',    prompt: 'Share something you watched twice in a row.' },
    // The Friday that argues with YOU. Ten weeks of hot takes starts to sound like
    // a comment section, and this is the one that lets the air out.
    { slug: 'worst-take',     type: 'note',  kind: 'report',    prompt: 'What’s the worst take you’ve ever had?' },
    { slug: 'animal',         type: 'photo', kind: 'retrieval', prompt: 'Show us an animal you met.' },
    { slug: 'forward',        type: 'note',  kind: 'report',    prompt: 'What are you quietly looking forward to?' },
    // One-line check-in, two of three. A number is the hardest possible limit, and
    // "no explaining" is the whole joke.
    { slug: 'rate-week',      type: 'note',  kind: 'report',    prompt: 'Rate the week out of ten, no explaining.' },

    // ── Week nine ──                                                Tue
    { slug: 'reflex',         type: 'photo', kind: 'retrieval', prompt: 'Show us the app you open without thinking.' },
    { slug: 'avoiding',       type: 'note',  kind: 'report',    prompt: 'What are you avoiding right now?' },
    // The undone half of must-watch: not what you made someone watch, what you
    // never got round to. An errand, and the week's only one.
    { slug: 'keep-meaning',   type: 'find',  kind: 'errand',    prompt: 'Share something you keep meaning to show someone.' },
    { slug: 'rule',           type: 'note',  kind: 'report',    prompt: 'What rule do you break on principle?' },
    { slug: 'mess',           type: 'photo', kind: 'retrieval', prompt: 'Show us the mess you’re not dealing with.' },
    { slug: 'said',           type: 'note',  kind: 'report',    prompt: 'What did someone say to you that stuck?' },
    { slug: 'old-tab',        type: 'photo', kind: 'retrieval', prompt: 'Show us the tab you’ve had open for weeks.' },

    // ── Week ten, errand-free ──                                    Tue
    { slug: 'nemesis',        type: 'note',  kind: 'report',    prompt: 'Who or what is your nemesis this week?' },
    // What you point a camera at twice is a better answer to "what do you care
    // about" than asking it directly would be.
    { slug: 'photographed-twice', type: 'photo', kind: 'retrieval', prompt: 'Show us something you’ve photographed more than once.' },
    // The other Thursday retrieval: it's a find, and it's already saved.
    { slug: 'bookmarked',     type: 'find',  kind: 'retrieval', prompt: 'Share the oldest thing in your bookmarks.' },
    { slug: 'stop',           type: 'note',  kind: 'report',    prompt: 'What should everyone stop doing immediately?' },
    { slug: 'visiting',       type: 'photo', kind: 'retrieval', prompt: 'Show us where you’d take someone visiting.' },
    { slug: 'ended-well',     type: 'note',  kind: 'report',    prompt: 'What ended better than you expected?' },
    // One-line check-in, three of three, and the last row of the loop: it hands
    // the wheel back to the meme at index 0.
    { slug: 'vibe-check',     type: 'note',  kind: 'report',    prompt: 'What’s the vibe today, in five words or fewer?' },
  ];

  const DAY_MS = 86400000;
  const dailyEpochParts = () => DAILY_EPOCH.split('-').map(Number);
  // Whole days since the epoch, counted between local midnights rather than in raw
  // milliseconds so a daylight-saving shift can't slide the day over by an hour.
  function dayNumber(now = new Date()) {
    const [y, m, d] = dailyEpochParts();
    const from = new Date(y, m - 1, d);
    const to = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((to - from) / DAY_MS);
  }

  // One prompt ON one day: the prompt plus the window it's open for. Everything
  // downstream takes one of these, so "today's" and "the last time this one ran"
  // are the same shape and the page doesn't care which it was handed.
  function occurrenceOf(d, day) {
    const [y, m, dd] = dailyEpochParts();
    return {
      ...d,
      day,
      tag: 'daily-' + d.slug,
      opens: new Date(y, m - 1, dd + day),
      closes: new Date(y, m - 1, dd + day + 1),
    };
  }
  // Which prompt the wheel lands on for a given day.
  function dailyOn(day) {
    if (!DAILIES.length || day < 0) return null;
    return occurrenceOf(DAILIES[day % DAILIES.length], day);
  }
  const todaysDaily = () => dailyOn(dayNumber());
  // The most recent run of one prompt, so a link to #/daily/<slug> keeps working
  // after its day is out: it lands on that round's answers instead of nothing.
  function lastDailyFor(slug) {
    const i = DAILIES.findIndex(d => d.slug === slug);
    if (i < 0) return null;
    const today = dayNumber(), n = DAILIES.length;
    return dailyOn(today - (((today - i) % n) + n) % n);
  }
  const dailyIsOpen = (occ, now = Date.now()) =>
    !!occ && now >= +occ.opens && now < +occ.closes;

  // Every answer to one occurrence, newest first. Reads the whole cache rather
  // than Store.discover() because my OWN answer belongs on this page too, and the
  // cache only ever holds what can_view_post already handed over — so this widens
  // nothing. Window-scoped (see the note up top); blocked authors drop out.
  function dailyAnswers(occ) {
    if (!occ) return [];
    const from = +occ.opens, to = +occ.closes;
    return Store.posts().filter(p => {
      if (!(p.tags || []).includes(occ.tag)) return false;
      const t = +new Date(p._ts);
      return t >= from && t < to && !Blocks.has(p.author);
    });
  }

  /* The tag is a JOIN, and it is never a label. `daily-<slug>` rides on the post
     so the page can find its answers without a table — but it must not show up
     among the poster's own tags. Tags are words someone chose for their own
     shelf; the moment app-issued slugs start appearing in that row it reads as
     metadata leaking into writing, and every answer on the page wears a barcode.

     So: the `daily-` namespace is reserved (nothing a person types can enter it —
     see parseTags), it's stripped everywhere tags render or get edited, and it
     rides along invisibly on save. What shows in its place is the QUESTION, as a
     link back to what everyone else said — which is the thing the slug was
     standing in for anyway, and a much better link than a word in a chip. */
  const DAILY_TAG_RE = /^daily-/;
  const dailyTagOf = (post) => (post.tags || []).find(t => DAILY_TAG_RE.test(t)) || null;
  const shownTags = (post) => (post.tags || []).filter(t => !DAILY_TAG_RE.test(t));
  /* Which occurrence a post answered. Resolved by SLUG, from the tag the post is
     carrying, and dated to the day it was posted.

     It has to be the slug, because the alternative — re-deriving the prompt from
     `day % DAILIES.length` — makes the schedule immutable the moment the app has
     users. Change the array's LENGTH and every past day maps onto a different
     prompt, so every answer ever posted stops matching its own tag and quietly
     loses the question off the bottom of its card. That's a rewrite of history as
     the price of adding one prompt, and we will want to add prompts.

     Reading the slug instead, the wheel decides only what comes next, never what
     already happened: reorder freely, append freely. The one edit that still
     costs something is DELETING an entry, which retires its label from old
     answers (they degrade to a plain post, tag still hidden, nothing broken). If
     a prompt is ever retired for real, leave its row in the array and move it out
     of the rotation instead. */
  function dailyForPost(post) {
    const tag = dailyTagOf(post);
    if (!tag || !post._ts) return null;
    const d = DAILIES.find(x => 'daily-' + x.slug === tag);
    return d ? occurrenceOf(d, dayNumber(new Date(post._ts))) : null;
  }

  // "6h left" / "42m left" — coarse on purpose. A ticking clock on a card is a
  // pressure device and this app doesn't run on urgency; the number is here so you
  // know whether you have the evening or the hour, and it never counts seconds.
  function dailyLeft(occ, now = Date.now()) {
    const ms = +occ.closes - now;
    if (ms <= 0) return 'closed';
    const h = Math.floor(ms / 3600000);
    return h >= 1 ? `${h}h left` : `${Math.max(1, Math.ceil(ms / 60000))}m left`;
  }

  // Have I already answered this one? A daily takes ONE answer each: the page is
  // meant to be a room full of different people, and the second answer from the
  // same person is where a prompt starts turning into a feed you can hold the
  // floor in. It's a client-side rule (the tag is just a tag, the database has no
  // idea a daily exists), which is the right weight for something protecting the
  // shape of a page rather than anyone's privacy.
  const myAnswer = (occ, answers) =>
    (answers || dailyAnswers(occ)).find(p => p.author === Store.session()) || null;

  // Does this post type answer that question? Every daily takes any type now — the
  // named `type` on an occurrence is a default and a colour, not a requirement.
  // ACTIVITIES are still out: that exclusion was never about shape, it's that an
  // activity lands in the real world behind a friends-only gate, and a page of
  // answers from the whole room is the wrong doorway to that.
  //
  // This is the ONE place the rule lives — the banner reads it to know what to say
  // and submitComposer reads it to know whether to attach the tag, so the sentence
  // on screen and the tag on the post can't disagree.
  const dailyAccepts = (occ, type) => !!occ && type !== 'activity';

  // The invitation, in ONE place so the card and the page can't drift. Not
  // "Answer": a prompt that asks and then commands is a worksheet, and the arrow
  // is doing the "go" half anyway.
  const DAILY_CTA = 'Add yours';

  // Send the composer to answer this daily: it opens on the type the prompt asked
  // for, and the daily's tag rides along invisibly at submit (see submitComposer).
  // `answeringDaily` outlives the render so a posted answer lands back on the
  // question it answered instead of on the home feed.
  let pendingDaily = null;
  let answeringDaily = null;
  function answerDaily(occ) {
    if (!occ || myAnswer(occ)) return;   // one each — the UI shouldn't have offered
    pendingDaily = occ;
    go('#/publish');
  }

  /* The card on Discover: coloured glass, the one piece of the page that carries a
     hue. It floats above the grid, so the material rule says glass — and unlike the
     tiles it's a single element that doesn't scroll a hundred copies of itself, so
     it can afford the real sample-and-blur.

     The whole card is the tap (a stretched link over it), with Answer sitting on
     top as its own control — read the room, or go say your bit, and nothing in
     between. The faces are who has answered; the count beside them is the one
     number Discover allows besides the trending rail's, and it's here because
     "12 answers" is the difference between a party and an empty room. */
  function dailyCardEl(occ, answers) {
    const faces = answers.slice(0, 4).map(p => Store.user(p.author)).filter(Boolean);
    const n = answers.length;
    const mine = myAnswer(occ, answers);
    return `<section class="daily-card" data-type="${occ.type}">` +
        // No coloured dot here. The card IS the colour — a hue-filled panel with a
        // hue-filled disc on it is the same fact said twice, and the second time
        // reads as decoration.
        `<p class="daily-kicker">` +
          `Today’s daily<span class="daily-sep" aria-hidden="true">·</span>` +
          `<span class="daily-left">${esc(dailyLeft(occ))}</span>` +
        `</p>` +
        `<a class="daily-open" href="#/daily/${encodeURIComponent(occ.slug)}">` +
          `<span class="daily-prompt">${esc(occ.prompt)}</span>` +
        `</a>` +
        (occ.hint ? `<p class="daily-hint">${esc(occ.hint)}</p>` : '') +
        `<div class="daily-foot">` +
          (n
            ? `<div class="daily-answered">` +
                `<div class="daily-faces" aria-hidden="true">` +
                  faces.map(u => avatarEl(u, { cls: 'daily-face' })).join('') +
                `</div>` +
                `<span class="daily-count">${n} answer${n === 1 ? '' : 's'}</span>` +
              `</div>`
            : `<span class="daily-count daily-count--none">No answers yet</span>`) +
          // Answered: the invitation is simply gone, with nothing in its place.
          // "Yours is in" was a caption on an absence — the faces and the count
          // beside them already changed when you posted, and your own answer is
          // waiting one tap away. A card that reports your own action back to you
          // is talking about the app instead of the room.
          (mine ? ''
            : `<button type="button" class="daily-answer">${DAILY_CTA}<span class="daily-go" aria-hidden="true">→</span></button>`) +
        `</div>` +
      `</section>`;
  }

  /* ── The daily's own page (#/daily/<slug>) ────────────────────────────────────
     Discover, held to one question. The page takes the daily's colour through the
     ambient wash (the same full-screen mechanism the composer uses for the type
     it's inferring) so opening the card feels like stepping INTO the card, and the
     answers deal into the same masonry grid the rest of the app browses with.

     Reading it is open to everyone; ANSWERING closes with the window. A daily
     whose day has passed still shows what it got, because the archive is the
     reward for having answered, and its Answer button is simply gone — a dead
     control that explains itself is still a dead control. */
  let dailyResizeOff = null;
  function renderDaily(slug) {
    const occ = lastDailyFor(slug);
    if (!occ) { go('#/discover'); return; }
    const me = Store.session();
    const open = dailyIsOpen(occ);
    const answers = dailyAnswers(occ);

    const fenced = (name) => Store.isPrivate(name) && name !== me
      && Store.friendStatus(name) !== 'friends';
    const tiles = answers
      .map(p => ({ user: Store.user(p.author), post: p }))
      .filter(t => t.user);

    // The invitation is gone once it's been taken (one each) or once the day is
    // out. Your own answer is on the page below either way, which says "you're in"
    // better than a disabled button ever could.
    const canAnswer = open && !myAnswer(occ, answers);

    /* The kicker carries the whole status line: what this is, how long it has
       left, and the way in. All three are the same KIND of fact — small print
       about the occasion rather than the occasion itself — so they share one
       tracked micro-caps line, caption left and control right. That's the
       masthead's own arrangement (nameplate left, filter right) moved up a line,
       and it spares the row an action parked beside a two-line serif question
       that never had a baseline to sit on. The standing half is dimmed so the
       live half reads as the live half. */
    const kicker =
      `<span class="daily-when">Daily` +
        `<span class="daily-sep" aria-hidden="true">·</span>` +
        `${open ? esc(dailyLeft(occ)) : 'closed'}</span>` +
      (canAnswer
        ? `<button type="button" class="daily-answer daily-answer--inline" ` +
          `id="daily-answer">${DAILY_CTA}<span class="daily-go" aria-hidden="true">→</span></button>`
        : '');

    view.innerHTML =
      `<section class="view view--daily" data-type="${occ.type}">` +
        `<a class="profile-back" href="#/discover">← Discover</a>` +
        mastheadEl(kicker, `<span class="masthead-title--daily">${esc(occ.prompt)}</span>`, '') +
        (occ.hint ? `<p class="daily-lede">${esc(occ.hint)}</p>` : '') +
        `<div class="daily-body" id="daily-body"></div>` +
      `</section>`;

    const bodyEl = view.querySelector('#daily-body');
    bodyEl.innerHTML = tiles.length
      ? `<div class="pgrid">${tiles.map(t => ptileEl(t, fenced(t.user.username))).join('')}</div>`
      : `<p class="feed-empty">${open
        ? 'Nobody’s answered yet. Go first?'
        : 'This one went by without an answer.'}</p>`;

    const layout = (fresh) => dealMasonry(bodyEl.querySelector('.pgrid'), fresh);
    layout(true);
    wireFrameFades(bodyEl);
    view.querySelector('#daily-answer')?.addEventListener('click', () => answerDaily(occ));

    // Same contract as Discover's grid: a WIDTH change re-deals the columns (the
    // count flips at the breakpoint), a height change — the iOS keyboard, the URL
    // bar collapsing — is ignored, and a re-deal parks the entrance rather than
    // replaying it because the phone turned.
    dailyResizeOff?.();
    let sizeTimer = 0, lastW = window.innerWidth;
    const onResize = () => {
      if (window.innerWidth === lastW) return;
      lastW = window.innerWidth;
      clearTimeout(sizeTimer);
      sizeTimer = setTimeout(() => { if (bodyEl.isConnected) layout(false); }, 120);
    };
    window.addEventListener('resize', onResize, { passive: true });
    dailyResizeOff = () => {
      clearTimeout(sizeTimer);
      window.removeEventListener('resize', onResize);
      dailyResizeOff = null;
    };
  }

  /* ── Discover — the meeting ground ───────────────────────────────────────────
     ONE surface: a masonry grid where every tile is a post you're allowed to see
     with the person who made it attached, plus a portrait tile for anyone with
     nothing to show. Not a post feed and not a directory, but the join of the
     two. There used to be a People / Posts switcher here, and a tab you have to
     choose is a tab nobody chooses, so the two were merged and the tile carries
     both jobs.

     Seven rules hold the shape, each guarding something the app cares about:

     1. THE POST IS A PREVIEW, NEVER A CARD. No like, no comment, no RSVP, and no
        tag chips. The moment a tile grows an action row, Discover is a public
        timeline again with extra steps, which is precisely the thing Tria is
        built not to be. Read it in full on their page, where the real controls
        live.
     2. THE PERSON IS ALWAYS ATTACHED, and the tap goes to the PROFILE, never to
        the post. That single rule is what keeps this a people-first surface
        while it shows content: you're always looking at someone, never at a
        stream of anonymous stuff.
     3. NO TIMESTAMPS. The order already rewards posting all by itself — rule 5
        puts the newest thing at the top, so recency has a visible consequence
        without ever being written down. A printed date would turn that into a
        staleness scoreboard, which is the frequency treadmill wearing a
        different hat. An old tile looks the same as a fresh one, it just sits
        further down.
     4. A PERSON WITH NOTHING TO SHOW IS FACED BY THEIR PROFILE PHOTO, at full
        square. In a masonry grid the short tiles read as the poor ones, and
        since users.private defaults true, plenty of people have nothing here.
        Making privacy look like poverty in an app that defaults to private is
        backwards, so a quiet account gets a big portrait and its bio instead.
        Its tile is the same WIDTH as everyone's; it just says something else.
     5. IT READS IN TIME ORDER, AND NOBODY OWNS IT. The grid is chronological,
        newest first, because that's the promise the About page makes and it's
        what keeps new posts arriving at the top where they belong. But flat
        recency broke on contact: one heavy poster's run held the whole first
        screen, which reads as a personal feed. So time order is nudged, never
        re-sorted — a post whose author just appeared waits a couple of slots
        while the next face takes the turn, and nobody holds more than TILE_CAP
        tiles. See `spaced`. The result is meant to FEEL chronological while
        never showing you the same person twice in a row.
     6. IT'S THE WHOLE ROOM, NOT THE PUBLIC SQUARE. Every post you're allowed to
        see that isn't yours can tile here, your circle's included, in ONE grid
        rather than a strangers band above a friends band. A page that empties
        out as you make friends punishes you for using the app, and the split
        made your own people read as an appendix to the page rather than part of
        it. Chronology is what now keeps the page distinct from your feed:
        strangers post on their own clock, so their posts land between your
        people's rather than in a section of their own. Nothing here widens who
        may see what — Store.discover only ever filters the cache, and the cache
        only holds what RLS already handed over.
     7. TRENDING TAGS ARE THE ONE INDEX. Five tags at the head of the page, each
        with its post count, each a shortcut into search. It's the only ranked
        thing on Discover and the only place a NUMBER is allowed to show, which
        is why it stays a strip of five and never becomes a leaderboard.

     Search reaches every account by name and @handle AND matches the text and
     tags of every post it can show, so "who here is into ceramics" lands on the
     person who said it. It runs wider than the browse grid on purpose: no
     per-person cap and hand-addressed posts fold back in, because a courtesy
     that hides what you're hunting for isn't one.
     The filter dial narrows the grid to tiles of one type, or — one row below
     All — to PEOPLE, which drops the posts and gives every account rule 4's
     portrait tile in alphabetical order. That row is the answer to "I know
     roughly who I'm looking for": the browse grid is chronological and capped, so
     a quiet account can sit a long way down it, and a directory doesn't care when
     anyone last posted. Search still reaches post text there (see saidBy), so
     hunting by interest works on a page of faces too. Private
     accounts are listed but wear a lock (see isLocked), so you know before the
     tap. This page replaced the Friends page outright — your own
     circle roster lives on your profile, and incoming requests live on Updates,
     so nothing here is orphaned. */
  let discoverQuery = '';     // live search over people + the text of every post here
  let discoverFilter = 'all'; // 'all' · 'people' (a directory of portraits) · one post type
  let discoverRepaint = null; // set while Discover is mounted: repaint the body in place
  let discoverResizeOff = null; // drops the grid's resize listener when the view goes
  function renderDiscover() {
    const me = Store.session();
    const notBlocked = (name) => !Blocks.has(name);

    // Store.discover() re-sorts the whole post cache on every call, and one paint
    // asks for it up to three times over: the grid, the trending rail, and (while
    // searching) saidBy. Hold each variant for the life of ONE paint — cleared at
    // the top of paint, so a background re-pull is never served a stale world.
    let pools = {};
    const discoverPool = (addressed) => {
      const k = addressed ? 'addressed' : 'browse';
      return pools[k] || (pools[k] = Store.discover({ addressed }));
    };

    // A post's searchable text: title, body, tags, and its author's name/@handle
    // — so "search anything" (tags, interests, keywords, names) all land on the
    // person who said it. Cached per post for the life of the view: search asks
    // for the same haystack once per keystroke, and building one means reading a
    // rich note (see notePlain's memo). Keyed by the post OBJECT, so a re-pull
    // that mints fresh rows gets fresh haystacks for free.
    const haystacks = new WeakMap();
    const postHaystack = (p) => {
      let h = haystacks.get(p);
      if (h === undefined) {
        const au = Store.user(p.author);
        h = [p.title, notePlain(p.note), (p.tags || []).join(' '),
          au && au.name, p.author].filter(Boolean).join(' ').toLowerCase();
        haystacks.set(p, h);
      }
      return h;
    };

    // Is this account's feed fenced to me? The same test the profile page runs:
    // private, and not someone I'm mutual with. It's the only per-person fact a
    // tile still needs — the lock it earns is a warning that the tap lands on a
    // wall, not a statistic. Memoised for the paint (one person can hold several
    // tiles now) and cleared at the top of every paint so a background re-pull
    // can't be served a stale answer.
    //
    // Note this does NOT hide their post. A locked account that floated
    // something out meant it to be seen, and hiding it would punish the exact
    // gesture we want more of.
    const lockCache = new Map();
    const isLocked = (name) => {
      if (!lockCache.has(name)) lockCache.set(name, Store.isPrivate(name) && name !== me
        && Store.friendStatus(name) !== 'friends');
      return lockCache.get(name);
    };

    /* ── The tile ────────────────────────────────────────────────────────── */

    // The faces and the tile itself live at module scope (see ptileEl) — they're
    // the third caller of the same grid now that a daily's answers deal into one
    // too. All this view still owns is WHO is fenced, which it caches per paint.
    const tileEl = (t) => ptileEl(t, isLocked(t.user.username));

    /* ── Trending tags: the one index on the page (rule 7) ────────────────────
       The five tags carried by the most posts Discover can show. Counted across
       the whole browse pool rather than the tiles on screen, so a tag's pull
       never depends on where the per-person cap happened to fall.

       A tag has to REPEAT to qualify. One post wearing a tag isn't a trend,
       it's a tag, and "Trending: #kiln 1" is a strip admitting it has nothing to
       say. On a quiet instance the whole rail is simply absent, which is the
       honest state and not a bug.

       Picking one runs it as a search rather than carrying its own filter state.
       That's Zoe's call and it's the right one: search already matches tags, and
       a second parallel narrowing mechanism is two things to keep in sync and
       two ways to end up with a grid nobody can explain. */
    const topTags = () => {
      const n = new Map();
      // Deduped per post, so a post that somehow carries a tag twice still only
      // votes once. Counts the BROWSE pool, which is why tapping a tag can
      // surface more posts than the number says: the tap runs a search, and
      // search reaches hand-addressed posts the rail deliberately doesn't count.
      //
      // A daily's tag never trends. The rail indexes what the room brought up on
      // its own; a tag the app itself hands to everybody on the same morning would
      // hold the top slot every day and say nothing (the daily has its own card
      // three inches above, which is a better link than a word in a strip).
      discoverPool(false).filter(p => notBlocked(p.author)).forEach(p =>
        new Set((p.tags || []).map(t => String(t).trim().toLowerCase().replace(/^#/, '')))
          .forEach(k => { if (k && !k.startsWith('daily-')) n.set(k, (n.get(k) || 0) + 1); }));
      return [...n.entries()].filter(([, c]) => c > 1)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 5);
    };

    const tagRail = (tags, active) => tags.length
      ? `<nav class="dtags" aria-label="Trending tags">` +
          `<p class="dtags-cap">Trending</p>` +
          `<div class="dtags-rail">` +
            tags.map(([t, c]) =>
              `<button type="button" class="dtag" data-tag="${esc(t)}" ` +
                  `aria-pressed="${active === t}">` +
                `<span class="dtag-name"><span class="dtag-hash">#</span>${esc(t)}</span>` +
                `<span class="dtag-n">${c}</span>` +
                `<span class="dtag-go" aria-hidden="true">→</span>` +
              `</button>`).join('') +
          `</div>` +
        `</nav>`
      : '';

    // The standing "share Tria" invite at the foot of the grid (hidden while
    // searching or filtering) — a gentle way to bring someone new into the
    // square, and it earns its keep here: a masonry grid reads as endless, so a
    // small one needs something to end ON.
    const shareAsk =
      `<div class="feed-empty friends-share">` +
        `<p class="friends-share-ask">Know someone who’d like it here?</p>` +
        `<button class="friends-share-copy publish-fill is-solid" type="button" ` +
          `aria-label="Copy triaonline.com to share">` +
          svgIcon('send', 'friends-share-ico') +
          `<span>Share Tria</span>` +
        `</button>` +
      `</div>`;

    const searchAction =
      `<div class="masthead-search">` +
        `<input type="search" id="discover-search" class="masthead-search-field" ` +
          `autocapitalize="none" autocomplete="off" spellcheck="false" tabindex="-1" ` +
          `placeholder="Search people, tags, anything" aria-label="Search Tria">` +
        `<button type="button" class="masthead-search-btn" id="discover-search-toggle" ` +
          `aria-label="Search Tria" aria-expanded="false">` +
          `<span class="msb-ico msb-ico--search">${svgIcon('search')}</span>` +
          `<span class="msb-ico msb-ico--close">${svgIcon('close')}</span>` +
        `</button>` +
      `</div>`;

    // Search then filter, grouped at the right of the nameplate. Opening search
    // wipes its field left across the title, but it's inset to STOP short of the
    // filter (see .view--discover .masthead-search-field) so the filter stays put
    // and tappable on the far right.
    const actions =
      `<div class="masthead-actions">` +
        searchAction +
        filterBtnEl('discover-filter-btn', discoverFilter, 'Filter Discover') +
      `</div>`;

    view.innerHTML =
      `<section class="view view--discover">` +
        mastheadEl('', 'Discover', actions) +
        `<div class="discover-body" id="discover-body"></div>` +
      `</section>`;

    const bodyEl = view.querySelector('#discover-body');
    const masthead = view.querySelector('.masthead');
    const searchEl = view.querySelector('#discover-search');
    const toggleBtn = view.querySelector('#discover-search-toggle');

    // Rank a person against the query: 2 = a name-word or @username STARTS with it,
    // 1 = appears somewhere, 0 = no match.
    const scoreName = (u, q) => {
      const name = (u.name || '').toLowerCase(), user = (u.username || '').toLowerCase();
      if (user.startsWith(q) || name.split(' ').some(w => w.startsWith(q))) return 2;
      if (user.includes(q) || name.includes(q)) return 1;
      return 0;
    };
    // Everything one account has said here, joined. A portrait tile carries no
    // post to match against, so without this, searching under the People filter
    // would only reach names and "who here is into ceramics" would come back
    // empty on the very view that's meant to answer it. Built once per paint and
    // only when a search actually asks for it.
    let saidCache = null;
    const saidBy = (name) => {
      if (!saidCache) {
        saidCache = new Map();
        discoverPool(true).forEach(p =>
          saidCache.set(p.author, (saidCache.get(p.author) || '') + ' ' + postHaystack(p)));
      }
      return saidCache.get(name) || '';
    };

    // A tile matches on WHO it's by first and WHAT it says second, so typing a
    // name still puts that person's tiles up top even if a stranger mentioned them.
    // And within a name match the PORTRAIT outranks every post: someone typing a
    // name is asking for the person, and the profile tile is the person — their
    // photographs are the second answer, not the first. The bump is bigger than
    // the whole name scale (2), so any portrait beats any post rather than a
    // loose match on one sorting under a tight match on the other.
    const tileScore = (t, q) => {
      const named = scoreName(t.user, q);
      if (named) return t.post ? named : named + 3;
      return (t.post ? postHaystack(t.post) : saidBy(t.user.username)).includes(q) ? 0.5 : 0;
    };

    // Every tile on the page, in ONE grid — see rules 5 and 6. Chronological,
    // newest first, with elbow room.
    //
    // Straight recency was the honest order right up until one person outposted
    // the room, and on a small instance that happens immediately: a single
    // enthusiast's run held the whole first screen, which is the precise
    // opposite of a people-first surface. The fix that shipped first was a
    // round-robin deal (everyone's latest, then everyone's second), and it did
    // spread the faces — but it also scattered time badly enough that the page
    // stopped reading as "what happened lately", which is the thing the About
    // page promises.
    //
    // So: walk the posts in strict time order and only ever step FORWARD past a
    // face that just appeared. Three knobs, and they're deliberately small:
    //   TILE_CAP  most tiles one person can hold on the page.
    //   FACE_GAP  how many other faces must pass before they can return.
    //   HOLD_MAX  how far the walk may run ahead of the oldest post still
    //             waiting. This is the knob that keeps it honest: once the
    //             queue is this deep, the GAP yields instead, because drifting
    //             further out of time order is worse than showing a face twice
    //             close together.
    // Nothing is ever sorted backwards, so the page still reads top-to-bottom in
    // time; it just refuses to show you the same person twice in a row.
    //
    // Searching runs the same build wider: no cap, and hand-addressed posts fold
    // back in. Looking something up should reach every account and every post
    // that could answer it.
    const TILE_CAP = 3, FACE_GAP = 2, HOLD_MAX = 3;
    // How long typing has to settle before the grid rebuilds. Short enough that
    // it reads as "keeping up" rather than as a wait, long enough that a normal
    // typing burst lands one paint instead of eight.
    const SEARCH_BEAT = 110;

    const spaced = (posts, cap, gap) => {
      const out = [], held = [], count = new Map();
      const recent = [];                    // authors of the last `gap` tiles
      const over = (p) => (count.get(p.author) || 0) >= cap;
      const tooSoon = (p) => recent.includes(p.author);
      // Someone's own posts must never overtake each other, so once one of
      // theirs is waiting the rest queue behind it rather than at the cursor.
      const waiting = (p) => held.some(h => h.author === p.author);
      const place = (p) => {
        out.push(p);
        count.set(p.author, (count.get(p.author) || 0) + 1);
        recent.push(p.author);
        if (recent.length > gap) recent.shift();
      };
      let i = 0;
      while (i < posts.length || held.length) {
        // Everything held is NEWER than the cursor, so the queue always gets
        // first refusal — that's what keeps the order chronological.
        const ready = held.findIndex(p => !over(p) && !tooSoon(p));
        if (ready > -1) { place(held.splice(ready, 1)[0]); continue; }
        if (i >= posts.length || held.length >= HOLD_MAX) {
          const p = held.shift();           // the gap yields (see HOLD_MAX)
          if (p && !over(p)) place(p);
          continue;
        }
        const p = posts[i++];
        if (over(p)) continue;               // past their cap: it just doesn't tile
        if (tooSoon(p) || waiting(p)) held.push(p);
        else place(p);
      }
      return out;
    };

    // The posts first, then whoever had nothing to show, trailing alphabetically
    // with a portrait (see rule 4).
    //
    // A search adds a third group ahead of both: a portrait for every account
    // whose NAME matches the query. A portrait only ever appeared for someone
    // with nothing on the page, so looking a person up reached them through
    // their posts and nowhere else — the more somebody posted the harder they
    // were to find AS a person, and the answer to their name was a wall of their
    // photographs with the profile one tap inside any of them. Ranking is
    // tileScore's job; this is what gives it a profile to rank.
    const buildTiles = (q) => {
      // Everyone but me (you aren't discovering yourself) and anyone blocked.
      const pool = new Set(Store.users().map(u => u.username)
        .filter(n => !!n && n !== me && notBlocked(n)));
      // People: the room as a directory. Every account gets rule 4's portrait
      // tile, so nobody's row depends on whether they posted lately — which is
      // the whole point of asking for people rather than for posts. Alphabetical,
      // because a directory sorted by recency is just the grid again.
      const byName = (a, b) => (a.name || '').localeCompare(b.name || '');
      if (discoverFilter === 'people') {
        return [...pool].map(n => Store.user(n)).filter(Boolean).sort(byName)
          .map(u => ({ user: u, post: null }));
      }
      // Whoever the query names, portrait first. They keep their post tiles too,
      // further down — the profile leads, the work follows.
      const named = q ? [...pool].map(n => Store.user(n))
        .filter(u => u && scoreName(u, q)).sort(byName) : [];
      const facing = new Set(named.map(u => u.username));
      const posts = spaced(
        discoverPool(!!q).filter(p => pool.has(p.author)),
        q ? Infinity : TILE_CAP, q ? 0 : FACE_GAP);
      const loud = new Set(posts.map(p => p.author));
      // Anyone already holding a portrait above is skipped here, or a quiet
      // account whose name matched would face you twice.
      const quiet = [...pool].filter(n => !loud.has(n) && !facing.has(n))
        .map(n => Store.user(n)).filter(Boolean).sort(byName);
      return named.map(u => ({ user: u, post: null }))
        .concat(posts.map(p => ({ user: Store.user(p.author), post: p })))
        .concat(quiet.map(u => ({ user: u, post: null })));
    };

    const wireFaces = () => wireFrameFades(bodyEl);

    const layoutGrid = (fresh) => dealMasonry(bodyEl.querySelector('.pgrid'), fresh);

    // Build the grid for the current query + filter. A grid has no per-tile
    // reconciliation the way the feed does, so a repaint is a full rebuild, and
    // background refreshes land here too. Sign what the tiles actually render
    // and skip the rebuild when nothing in view moved, otherwise every quiet
    // re-pull would replay the stagger and re-run every photo fade.
    // `stage` is the tile entrance. It plays when a DISCRETE act changed what the
    // page is showing — landing here, picking a filter, tapping a tag, clearing
    // the search — and stays out of the two cases where it reads as noise rather
    // than feedback: mid-TYPING (a fresh stagger of the whole grid on every
    // letter is the page flinching at you while you work), and a background
    // re-pull (one new post arriving should not restage seventy tiles).
    const paint = ({ stage = true } = {}) => {
      pools = {};
      lockCache.clear();
      saidCache = null;
      const q = discoverQuery.trim().toLowerCase();
      // People has already built exactly the tiles it wants, so it keeps them all;
      // a type keeps the tiles faced by it.
      const keep = (t) => discoverFilter === 'all' || discoverFilter === 'people'
        || (t.post && t.post.type === discoverFilter);
      let tiles = buildTiles(q).filter(keep);
      // Score ONCE per tile, then sort the scores. Scoring inside the comparator
      // read every haystack O(n log n) times instead of once, which on a page
      // this size is the difference between a keystroke you feel and one you
      // don't. Sort is stable, so ties still keep grid order.
      if (q) tiles = tiles.map(t => ({ t, s: tileScore(t, q) })).filter(x => x.s > 0)
        .sort((a, b) => b.s - a.s).map(x => x.t);
      // The rail is deliberately NOT rebuilt from the query: it's the index of
      // the page, so it has to stay put and stay tappable while you're standing
      // inside one of its tags, or there's no way back out but the X.
      const tags = topTags();
      // Today's daily heads the page, above the rail: it's the one thing here
      // with a deadline, and it's the same for everybody, so it reads as the
      // room's headline rather than as a tile that happens to be first. It stays
      // out of SEARCH — you asked a question, the page owes you an answer and not
      // a card — but rides every filter, because the card isn't part of the grid
      // it would be narrowing.
      const occ = q ? null : todaysDaily();
      const answers = occ ? dailyAnswers(occ) : [];
      const sig = JSON.stringify([q, discoverFilter, tags,
        occ && [occ.slug, answers.length], tiles.map(t =>
          [t.user.username, t.user.name, t.user.bio || '', t.user.avatar || '',
            t.post && t.post.id, isLocked(t.user.username)])]);
      if (bodyEl.dataset.sig === sig) return;
      bodyEl.dataset.sig = sig;
      const empty = q
        ? `No one matches “${esc(discoverQuery.trim())}”.`
        : TYPE_PLURAL[discoverFilter]
          ? `No ${TYPE_PLURAL[discoverFilter]} out here yet.`
          : 'Nobody here yet.';
      bodyEl.innerHTML = (occ ? dailyCardEl(occ, answers) : '') + tagRail(tags, q) + (tiles.length
        ? `<div class="pgrid">${tiles.map(tileEl).join('')}</div>`
        : `<p class="feed-empty">${empty}</p>`);
      bodyEl.querySelector('.daily-answer')
        ?.addEventListener('click', () => answerDaily(occ));
      // The share ask ends the page, so it follows the two views that ARE the
      // page (All and People) and stays out of a narrowed one. It earns its place
      // under People especially: a list of everyone here is exactly where "know
      // someone who'd like it?" lands.
      if (!q && (discoverFilter === 'all' || discoverFilter === 'people')) {
        bodyEl.insertAdjacentHTML('beforeend', shareAsk);
        wireShare();
      }
      layoutGrid(stage);
      wireFaces();
      wireTags();
    };

    // Share Tria: native share sheet where it exists, clipboard copy otherwise.
    function wireShare() {
      const shareBtn = bodyEl.querySelector('.friends-share-copy');
      if (!shareBtn) return;
      shareBtn.addEventListener('click', async () => {
        const result = await shareOrCopy({ title: 'Tria', text: 'Join me on Tria', url: 'https://triaonline.com' });
        if (result === 'cancelled') return;
        const label = shareBtn.querySelector('span');
        label.textContent = result === 'copied' ? 'Link copied' : 'Shared';
        setTimeout(() => { label.textContent = 'Share Tria'; }, 1600);
      });
    }

    // Open/close the search field. The icon fans it out over the nameplate and
    // focuses it; tapping again (or Escape) folds it back and clears the query so
    // the full grid returns.
    const foldSearch = () => {
      masthead.classList.remove('searching');
      toggleBtn.setAttribute('aria-expanded', 'false');
      toggleBtn.setAttribute('aria-label', 'Search Tria');
      searchEl.tabIndex = -1;
    };
    const foldIfEmpty = () => { if (!searchEl.value.trim()) foldSearch(); };
    // Focus is opt-OUT for the tag rail: tapping a tag should show you the query
    // it just ran, not raise a keyboard over the results you asked for.
    const openSearch = (focus = true) => {
      masthead.classList.add('searching');
      toggleBtn.setAttribute('aria-expanded', 'true');
      toggleBtn.setAttribute('aria-label', 'Close search');
      searchEl.tabIndex = 0;
      if (focus) searchEl.focus();
    };
    const closeSearch = () => {
      if (discoverQuery) { discoverQuery = searchEl.value = ''; paintNow(); }
      foldSearch();
      toggleBtn.focus();
    };

    // A tag is a shortcut into search, and tapping the live one again undoes it —
    // the rail is the only control on this page that can turn itself off, so it
    // has to be able to.
    const wireTags = () => {
      bodyEl.querySelectorAll('.dtag').forEach(btn => btn.addEventListener('click', () => {
        const on = btn.getAttribute('aria-pressed') === 'true';
        discoverQuery = searchEl.value = on ? '' : btn.dataset.tag;
        if (discoverQuery) openSearch(false); else foldSearch();
        paintNow();
      }));
    };

    // Keep focus on the field while the icon is pressed so its blur-to-fold can't
    // race the toggle (mousedown default would move focus off the field first).
    toggleBtn.addEventListener('mousedown', (e) => e.preventDefault());
    toggleBtn.addEventListener('click', () =>
      masthead.classList.contains('searching') ? closeSearch() : openSearch());
    searchEl.addEventListener('blur', foldIfEmpty);
    searchEl.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSearch(); });
    // Typing repaints on a short trailing beat rather than per letter. A paint
    // here is a full rebuild — search lifts the per-person cap and folds the
    // hand-addressed posts back in, so the grid it builds is roughly double the
    // browse grid, and every letter was re-laying out every tile. Coalescing a
    // burst into one paint at the end of it costs nothing you can perceive (the
    // field itself is native and never waits) and takes the work per word from
    // one-per-keystroke to one. `discoverQuery` still moves on the keystroke, so
    // anything else reading it (a background re-pull's guard, a re-render
    // restoring the field) sees what's actually typed.
    let searchTimer = 0;
    const paintSoon = () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        if (bodyEl.isConnected) paint({ stage: false });
      }, SEARCH_BEAT);
    };
    // Any discrete gesture (Escape, the X, a tag) paints straight away and must
    // cancel a beat still in flight, or the stale one lands on top of it.
    const paintNow = (opts) => { clearTimeout(searchTimer); paint(opts); };
    searchEl.addEventListener('input', () => { discoverQuery = searchEl.value; paintSoon(); });

    // The filter — same dial as My Circle, on its own state, plus the People row
    // (DISCOVER_FILTERS). A type narrows the grid to tiles FACED by that type, so
    // picking Frame gives you a wall of photos and the people behind them, and
    // accounts with nothing to show drop out: they have no face to match. People
    // is the opposite move — it drops every post and faces everyone alike.
    view.querySelector('#discover-filter-btn')?.addEventListener('click', (e) => openFilterDial(e.currentTarget, {
      current: discoverFilter,
      filters: DISCOVER_FILTERS,
      label: 'Filter Discover',
      onPick: (key) => { discoverFilter = key; syncFilterBtn('discover-filter-btn', discoverFilter); paintNow(); },
    }));

    // A re-pull while you're standing on Discover repaints the body in place
    // instead of re-rendering the whole view (which would tear down the masthead
    // and replay every tile). A quiet refresh skips a live search — results
    // shifting under a query you're still typing is worse than showing them a
    // beat late — but an explicit tab re-tap (`force`) repaints regardless,
    // because a refresh you asked for has to answer. Returns false only if this
    // closure has gone stale (the view was rebuilt under it), which is the
    // caller's cue to render Discover from scratch.
    discoverRepaint = (force) => {
      if (!bodyEl.isConnected) return false;
      if (force || !discoverQuery.trim()) paintNow({ stage: false });
      return true;
    };

    // JS owns the column deal, so a WIDTH change is ours to answer: the count
    // flips at the breakpoint and the balance depends on how text wraps. Only
    // the layout re-runs, never the paint — rebuilding the markup would replay
    // every photo fade because someone turned their phone.
    //
    // Width, and only width. On iOS a `resize` is mostly a HEIGHT event: the
    // keyboard rising under the search field fires one, and so does Safari's
    // URL bar collapsing as you scroll. Re-dealing the columns then is a forced
    // reflow of the whole grid for an answer that cannot have changed, landing
    // in the exact moment (mid-type, mid-scroll) where a stall is most visible.
    // So we remember the last width we dealt at and ignore everything else.
    discoverResizeOff?.();
    let sizeTimer = 0, lastW = window.innerWidth;
    const onResize = () => {
      if (window.innerWidth === lastW) return;
      lastW = window.innerWidth;
      clearTimeout(sizeTimer);
      sizeTimer = setTimeout(() => { if (bodyEl.isConnected) layoutGrid(); }, 120);
    };
    window.addEventListener('resize', onResize, { passive: true });
    discoverResizeOff = () => {
      clearTimeout(sizeTimer);
      window.removeEventListener('resize', onResize);
      discoverResizeOff = null;
    };

    // Restore an in-flight query if a background refresh re-rendered the page.
    searchEl.value = discoverQuery;
    if (discoverQuery.trim()) {
      masthead.classList.add('searching');
      toggleBtn.setAttribute('aria-expanded', 'true');
      toggleBtn.setAttribute('aria-label', 'Close search');
      searchEl.tabIndex = 0;
    }
    paint();
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
  //
  // MEMOISED, because a rich note costs a whole inert DOMParser document to
  // read and this is on the hottest path in the app: Discover's search calls it
  // through postHaystack for every post it can show, and Discover's tiles call
  // it again through `said` for every tile. One keystroke was building 574
  // documents on a 144-post instance (~36ms on a desktop, several times that on
  // a phone). A note is an immutable string — an edit mints a new one — so the
  // string IS the cache key and a hit can never be stale. Capped so a long
  // editing session can't grow it without bound; at the cap it simply starts
  // over, which costs one re-parse per note and nothing else.
  const NOTE_PLAIN_MAX = 600;
  const notePlainCache = new Map();
  function notePlain(note) {
    if (!note) return '';
    const hit = notePlainCache.get(note);
    if (hit !== undefined) return hit;
    const text = isRichNote(note)
      ? Array.from(parseNoteHtml(note).childNodes).map(n => n.textContent || '').join(' ')
      : note;
    const out = text.replace(/\s+/g, ' ').trim();
    if (notePlainCache.size >= NOTE_PLAIN_MAX) notePlainCache.clear();
    notePlainCache.set(note, out);
    return out;
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
    // A mention can land on a rich note, whose text IS stored HTML, so quoting it
    // raw printed "<p>" at the reader. notePlain flattens the subset back to its
    // words (and is a no-op on a comment, which is always plain). The 90-char cut
    // has to happen AFTER that or the budget is spent on markup and the slice can
    // land mid-tag.
    const said = (n.kind === 'comment' || n.kind === 'mention') ? notePlain(n.text) : '';
    const quote = esc(said.length > 90 ? said.slice(0, 90).trimEnd() + '…' : said);
    const what =
      n.kind === 'comment' ? `commented on ${label}` :
      n.kind === 'like'    ? `liked ${label}` :
      n.kind === 'mention' ? `mentioned you in ${label}` :
      n.kind === 'vote'    ? `voted in ${label}` :
      // The only row here about a person rather than a post. 'back' is them
      // answering an add of yours; plain is them arriving on their own.
      n.kind === 'follow'  ? (n.back ? 'added you back' : FOLLOW_LINE) :
                             `is going to ${label}`;
    // Mentions live on someone else's post, so the row walks to that profile;
    // a follow has no post at all and walks to the person; everything else lands
    // on your own column.
    const href =
      n.kind === 'follow' ? `#/u/${esc(encodeURIComponent(n.user))}` :
      (n.kind === 'mention' && post) ? `#/u/${esc(encodeURIComponent(post.author))}`
                                     : '#/profile';
    const fresh = n._ts && n._ts > lastSeen;
    // data-key is the row's stable identity for the reconcile in renderUpdates
    // (kind + which post + who + when) — one event, one row, across refreshes.
    const key = esc(`${n.kind}:${n.postId || ''}:${n.user}:${n._ts || ''}`);
    return `<li data-key="${key}">` +
        `<a class="notif${fresh ? ' notif--new' : ''}" href="${href}" ` +
          `data-post="${esc(n.postId || '')}" data-kind="${n.kind}">` +
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
  //
  // ONLY requests. Followers used to get a second block here, with an "Add back"
  // button, and it never emptied: nothing about a follow is pending — on a public
  // account it never needed your permission in the first place — so a row that
  // demands an answer to it is asking a question with no wrong answer and no way
  // to finish. Being followed became a chore list. A follow is an event now and
  // files itself in the ledger below (notifications(), kind 'follow'), where it
  // ages down the page like a like does. This block only ever holds things that
  // genuinely stop until you say something, and every one of them can be ended
  // for good with Ignore.
  function friendRequestsHtml() {
    if (notifFilter !== 'all') return '';
    const people = (list) => list.map(Store.user).filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name));
    const reqs = people(Store.requestsReceived());
    if (!reqs.length) return '';

    // A ledger row in the notif voice, with buttons where a passive row's dot
    // would sit. The avatar + text link walks to their profile, like a notif.
    const row = (u, key, line, actions) =>
      `<li class="request-row" data-key="${key}:${esc(u.username)}">` +
        `<a class="request-who" href="#/u/${encodeURIComponent(u.username)}">` +
          avatarEl(u, { cls: 'comment-avatar' }) +
          `<span class="request-text"><strong>${esc(u.name)}</strong> ${line}</span>` +
        `</a>` +
        `<span class="request-actions">${actions}</span>` +
      `</li>`;

    // Accept adds them back. Ignore is a real answer, not a dismissal: it clears
    // the request and remembers it, so the same person can ask again as often as
    // they like and this never comes back (Store.declineRequest). That's the
    // difference between a decision and a snooze, and it's why the label can stay
    // this quiet.
    const reqRows = reqs.map(u => row(u, 'req', 'wants to be friends',
      `<button class="request-accept" type="button" data-accept="${esc(u.username)}">Accept</button>` +
      `<button class="request-ignore" type="button" data-ignore="${esc(u.username)}" ` +
        `aria-label="Ignore request from ${esc(u.name)}">Ignore</button>`)).join('');

    return `<div class="requests">` +
        `<p class="requests-kicker">Friend request${reqs.length === 1 ? '' : 's'}</p>` +
        `<ul class="requests-list">${reqRows}</ul>` +
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
    // Store.pushPermission(), never `Notification.permission` — there is no
    // `Notification` object in a WKWebView, so reading it directly throws in the
    // App Store build, which is exactly where push is newest.
    //
    // `!pushArmed()` is belt to the permission check's braces. Permission is
    // primed before the first route now (see init), so 'default' is trustworthy
    // — but this card is the one piece of push UI that appears unbidden, on the
    // page you land on, and asking someone to turn on a thing they already have
    // on is the loudest way to look broken. Two independent reasons to stay
    // hidden is the right ratio for that.
    return Store.pushPermission() === 'default'
      && !Store.pushArmed()
      && localStorage.getItem(pushAskKey()) !== 'off';
  }
  // One answer for a failed "turn on", shared by the pre-prompt card and the
  // profile switch so the two can't drift. The interesting failure isn't an error
  // string, it's a DEAD END: iOS gives `requestAuthorization` one shot per
  // install, so once it's been answered the system prompt can never appear again
  // and `enablePush` resolves 'denied' instantly with no UI at all. The switch
  // then reads as a control that visibly does nothing, which is the same bug as
  // an inert `target="_blank"` link, and the old copy ("you can turn them on in
  // your settings") named a place the app could open but wasn't offering to.
  //
  // Native only, because it's an iOS-only dead end: a browser's permission is
  // re-askable from site settings the reader already knows how to reach, so on
  // the web the words really are the whole answer. `blocked` is the store's flag
  // for a denied permission specifically, not for any old failure, so a network
  // or save error still just says what went wrong.
  function pushBlocked(res) {
    if (!res.blocked || !nativeShell()) { toast(res.error); return; }
    openSheet({
      title: 'Notifications are turned off for Tria in iOS Settings. Turn on Allow Notifications and this switch will work.',
      items: [{
        label: 'Open Settings', icon: 'bell',
        // A rejection here means iOS refused the hand-off, which leaves the
        // reader exactly where the toast used to leave them, so say the path out
        // loud rather than closing the sheet on silence.
        run: async () => {
          if (!(await Store.openAppSettings()))
            toast('Open Settings, then Notifications, then Tria.');
        },
      }],
    });
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
    // Same `finally` as the profile switch, for the same reason: this button
    // rewrites its own label to "Turning on…", so a throw would strand the card
    // mid-sentence with nothing to tap.
    card.querySelector('#push-turn-on').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = 'Turning on…';
      try {
        const res = await Store.enablePush();
        if (res.ok) { localStorage.setItem(pushAskKey(), 'off'); toast('Notifications on.'); }
        else pushBlocked(res);
      } catch {
        toast('Couldn’t reach notifications just now. Try again in a moment.');
      } finally {
        rerender();
      }
    });
  }

  // The standing on/off control, on your own profile foot. Mirrors the pre-prompt
  // but is always available — the place to turn push back on after "Not now", or
  // off later. Hidden entirely where the shell can't do push.
  function pushToggleHtml() {
    if (!Store.pushSupported()) return '';
    // Permitted AND holding a saved address — not just permitted. Turning push
    // off leaves the OS permission granted on purpose (disablePush only drops
    // the row), so the old permission-only guess painted this switch back ON
    // every time the modal reopened, and it stayed wrong until the async read
    // below landed. Store.pushArmed() answers the question the switch is asking.
    const on = Store.pushArmed();   // sync; reconciled against the server below
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
    // `finally`, because the switch disables itself for the round trip and a
    // THROW would otherwise skip the re-enable and leave it dead for the life of
    // the modal, with no toast either — a switch that does nothing, forever, from
    // one unlucky tap. Every documented failure inside `enablePush` comes back as
    // `{ ok: false }`, but the Supabase write at the end of it is a bare network
    // call that can reject, and this is the one handler where a rejection is
    // indistinguishable from the bug being reported.
    btn.addEventListener('click', async () => {
      const on = btn.getAttribute('aria-checked') === 'true';
      btn.disabled = true;
      try {
        if (on) {
          await Store.disablePush();
          btn.setAttribute('aria-checked', 'false');
          toast('Notifications off.');
        } else {
          const res = await Store.enablePush();
          if (res.ok) { btn.setAttribute('aria-checked', 'true'); toast('Notifications on.'); }
          else pushBlocked(res);
        }
      } catch {
        toast('Couldn’t reach notifications just now. Try again in a moment.');
      } finally {
        btn.disabled = false;
      }
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
                : 'When someone adds you, likes, comments, or says they’re going, it lands here.'}</p>`);
    };
    // Answer a friend request in place. Accept adds them back (→ mutual, they
    // now show in each other's feeds); Ignore declines it for good — the edge
    // goes AND the answer is remembered, so re-adding you can't put this row
    // back. Quietly, on both counts: nothing is said to them either way.
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
          await Store.declineRequest(btn.dataset.ignore);
          renderUpdates();
        }));
    }
    // A row walks you to the post itself (your profile column) with the right
    // panel already open — the comment thread, who liked, or who's going — and
    // the profile render scrolls that card into view (see spotlightPost).
    function wireNotif(a) {
      a.addEventListener('click', () => {
        const id = a.dataset.post;
        // A follow is about a person, not a post — the href already walks to
        // their profile, and there's nothing to spotlight.
        if (!id) return;
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
    // And the same is true of Notification Center: this ledger is that news, so
    // the delivered copies are spent. Nothing cleared them before, which left
    // the shade holding every notification Tria had ever sent — the running
    // count this app deliberately refuses to put on its icon, arriving by
    // another route. Native-only and fire-and-forget (the web's own
    // notifications close themselves on tap).
    Store.clearDelivered();
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
          // The audience lock rides the box's foot, same as the Post note's attach
          // bar — one consistent place for "who sees this" across every composer.
          `<div class="rich-attach rich-attach--withlock" role="group" aria-label="Post options">` +
            audienceLockHtml() +
          `</div>` +
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
        `</div>` + tags;
    }

    // The unified Post field set, shared by note / find / photo. The Note rich
    // editor is the base (headline + a contenteditable body + the H1/H2/B/I toolbar,
    // 15k). The link row and the frame surface ship hidden; the type filter reveals
    // the one its type needs — Find shows the link row, Frame opens the picker — so
    // the body carries over as you switch among the three (see renderPublish).
    return richNoteField('c', '', '', randomNotePlaceholder(), { lock: true }) +
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

  // ── Audience lock ─────────────────────────────────────────────────────────
  // One flat control, shared by every composer: a lock button showing who can
  // see this post (Anyone / My circle / N people). Tapping opens the glass sheet
  // (openAudienceSheet). It rides the foot of the Post note (bottom-left of the
  // attach bar) and stands as its own field on the Activity form. 'public' wears
  // a globe; circle/list wear a padlock. Flat editorial — the composer is content.
  function audienceLockText() {
    if (pubAudience.mode === 'public') return 'Anyone';
    if (pubAudience.mode === 'circle') return 'My circle';
    return audienceCountLabel(pubAudience.users.length);   // 'list'
  }
  function audienceLockInner() {
    const glyph = pubAudience.mode === 'public' ? 'globe' : 'lock';
    return svgIcon(glyph, 'aud-lock-ico') +
      `<span class="aud-lock-label" id="c-audience-val">${esc(audienceLockText())}</span>`;
  }
  function audienceLockHtml() {
    return `<button type="button" class="aud-lock" id="c-audience" ` +
        `aria-label="Who can see this post">` + audienceLockInner() + `</button>`;
  }
  function wireAudienceLock(root) {
    const btn = root.querySelector('#c-audience');
    if (btn) btn.addEventListener('click', () => openAudienceSheet(root));
  }
  function syncAudienceLock(scope) {
    const btn = (scope || document).querySelector('#c-audience');
    if (btn) btn.innerHTML = audienceLockInner();
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
          modeBtn('public', 'Anyone', 'Everyone on Tria, friend or not') +
          modeBtn('circle', 'My circle', 'Only your mutual friends') +
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
      // Picking nobody in "Choose people" falls back to My circle (no empty list).
      const users = [...chosen];
      if (mode === 'public') pubAudience = { mode: 'public', users: [] };
      else if (mode === 'list' && users.length) pubAudience = { mode: 'list', users };
      else pubAudience = { mode: 'circle', users: [] };
      syncAudienceLock(root);
      close();
    });
  }

  // The reactive type mark that rides the "New post" masthead (same slot the
  // Friends search uses). It mirrors the active type filter — note / find → Find /
  // photo → Frame / activity — and pops when it flips (see paintIndicator).
  // The composer nameplate names what you're actually making: New note until an
  // attachment reshapes it (New find / New frame / New poll), or New activity.
  function pubTitle() {
    return `New ${(TYPE_LABEL[pubType] || 'post').toLowerCase()}`;
  }
  function typeIndicatorHtml() {
    return `<span class="type-indicator type-icon type-icon--${pubType}" id="c-type-ind" ` +
      `role="img" aria-label="${TYPE_LABEL[pubType]}">${TYPE_ICON[pubType]}</span>`;
  }

  function renderPublish() {
    // Answering a daily no longer pre-aims the form at the prompt's type — any
    // type answers any prompt (see dailyAccepts), and the composer's natural rest
    // state (a plain Note) is the lowest-friction way to arrive, so it opens
    // exactly like any other compose. Consumed once — navigate away and come back
    // and you get a plain composer, because the intent belonged to the tap, not
    // to the page.
    const daily = pendingDaily;
    pendingDaily = null;
    answeringDaily = daily;
    // The composer never persists a draft across navigations, so every entry opens
    // fresh on the Post group (a plain Note until something's attached).
    pubGroup = 'post';
    pubType = 'note';
    // The reactive colour lives full-screen now: the page ambient wash adopts the
    // inferred type's hue (see body[data-ambient="publish"] .ambient), keyed off
    // --glow-wash which syncType keeps in step. Set it before the wash fades in so
    // it opens on the right colour rather than tweening up from the default.
    document.body.dataset.ambient = 'publish';
    document.body.style.setProperty('--glow-wash', TYPE_HEX[pubType]);
    view.innerHTML =
      `<section class="view">` +
        // No kicker: the audience row below now says who this reaches, so
        // "Share to your circle" was both redundant and sometimes wrong. The
        // title names the inferred type instead (see syncTitle), so the word
        // rides in a span the swap animation can hand off between.
        mastheadEl('', `<span class="title-word">${pubTitle()}</span>`, typeIndicatorHtml()) +
        // What you're answering: the daily page's own masthead in miniature, the
        // caption over the question. It sits OUTSIDE the form and on the
        // nameplate's axis, because it's a lede for the page rather than a field
        // in the form — inside, it started var(--inset) to the left of the title
        // it hangs under (the composer's boxes are outdented on purpose; a line of
        // type isn't a box).
        //
        // A plain grey caption, not the daily's ink: with the Post/Activity
        // toggle gone from this flow (an activity was the only way to stop
        // answering, and it's simply not offered here any more), whatever you
        // write always counts, so there's nothing left for a colour to signal.
        (daily
          ? `<div class="daily-banner">` +
              `<p class="daily-banner-cap">Answering the daily</p>` +
              `<p class="daily-banner-prompt">${esc(daily.prompt)}</p>` +
            `</div>`
          : '') +
        `<form class="composer" id="composer" novalidate>` +
          // The Post / Activity switcher sits inline just above the note field (not
          // docked to the nav like the Friends / Updates one — see #c-group-tabs).
          // Neutral (no brand glow): colour is carried by the full-screen wash.
          // Absent while answering a daily: an activity is excluded from every
          // prompt (see dailyAccepts), so the one thing this switcher could do here
          // is offer a dead end. pubGroup stays 'post' for the whole flow.
          (daily ? '' : segTabsEl('c-group', PUB_GROUPS, pubGroup,
            { glow: false, label: 'What are you posting', panelId: 'c-fields' })) +
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
    const titleEl = view.querySelector('.masthead-title');
    titleEl?.classList.add('masthead-title--swap');   // hosts the outgoing ghost word
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

    // Re-infer the active type, then reflect it: swap the nameplate, pop the masthead
    // mark, shift the bottom colour-wash to the type's hue, light the attach button.
    function syncType() {
      pubType = pubGroup === 'activity' ? 'activity' : derivePostType();
      const ind = document.getElementById('c-type-ind');
      if (ind && pubType !== lastIndType) {
        lastIndType = pubType;
        syncTitle();                         // nameplate and mark flip together
        ind.className = `type-indicator type-icon type-icon--${pubType}`;
        ind.setAttribute('aria-label', TYPE_LABEL[pubType] || pubType);
        ind.innerHTML = TYPE_ICON[pubType] || '';
        ind.classList.remove('is-changing');
        void ind.offsetWidth;                // restart the pop
        ind.classList.add('is-changing');
      }
      // Full-screen ambient wash adopts the inferred hue; registered --glow-wash
      // tweens the colour (see the publish .ambient rule).
      document.body.style.setProperty('--glow-wash', TYPE_HEX[pubType] || TYPE_HEX.note);
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
      // A public account's posts default to Anyone (continuity: their notes/finds/
      // photos were world-readable before). Activities stay circle-first regardless,
      // matching how they've always been friends-only until you opt them public.
      const me = Store.currentUser();
      const defaultPublic = pubGroup !== 'activity' && !!(me && me.private === false);
      pubAudience = { mode: defaultPublic ? 'public' : 'circle', users: [] };
      const submitBtn = view.querySelector('.composer-submit');
      if (submitBtn) submitBtn.disabled = false;
      family = pubGroup === 'activity' ? 'activity' : 'base';
      fieldsEl.innerHTML = fieldsFor(family === 'activity' ? 'activity' : 'post');
      const cNote = fieldsEl.querySelector('#c-note');
      wireMentions(cNote);
      if (family === 'activity') {
        wireWhenHints(fieldsEl);
        wireLocationSuggest(fieldsEl.querySelector('#c-location'));
        wireAudienceLock(fieldsEl);
      } else {
        wireRichEditor(cNote, fieldsEl.querySelector('#c-note-count'));
        wireFrameCapture(fieldsEl);        // the frame surface ships hidden in the Post field set
        wireFindNudge();
        wireAttachBar();
        wireAudienceLock(fieldsEl);        // the lock rides the attach bar's bottom-left
        onCaptureChange = () => syncType();   // a frame landing/clearing re-infers the type
      }
      applyBaseSurface();
    }

    // The nameplate rides the inferred type alongside the mark: attach a link and
    // "New note" hands off to "New find", a photo to "New frame", and so on. The
    // live <h1> takes the new word straight away (so the row's width is right from
    // frame one) and a cloned ghost of the old word sinks out over the top of it.
    // Any stale ghost is swept first, so fast toggling can't strand a word.
    function syncTitle() {
      const word = titleEl?.querySelector('.title-word:not(.title-word--out)');
      const next = pubTitle();
      if (!word || word.textContent === next) return;
      titleEl.querySelectorAll('.title-word--out').forEach(g => g.remove());
      const ghost = word.cloneNode(true);
      ghost.classList.add('title-word--out');
      ghost.setAttribute('aria-hidden', 'true');
      word.textContent = next;
      word.classList.remove('title-word--in');
      void word.offsetWidth;                          // restart the rise
      word.classList.add('title-word--in');
      titleEl.appendChild(ghost);
      ghost.addEventListener('animationend', () => ghost.remove(), { once: true });
    }

    // Switch top-level group (Post ⇄ Activity). Each crossing re-mounts the field
    // set (they share nothing structurally) and resets to a fresh, plain form.
    function selectGroup(key) {
      if (key === pubGroup) return;
      pubGroup = key;
      document.getElementById('c-error').textContent = '';
      mountFields();
      syncType();                            // carries the nameplate swap with it
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
    // Nothing pre-aims a daily's surface any more — it opens on the same plain
    // Note every other compose does, and the tag rides along at submit regardless
    // of what ends up attached (see submitComposer).
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
      else if (f.type === 'image/gif' && f.size > MAX_UPLOAD_BYTES) {
        // GIFs upload as their original bytes (see initPhotoPreview) — no
        // in-browser re-encode to shrink them, so the bucket ceiling is the
        // real gate. Catch it here rather than after the read.
        showPickError('That GIF is over 150 MB. Please choose a smaller one.');
      } else {
        const err = errEl();
        if (err) err.textContent = '';
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
    // A GIF drawn to canvas would flatten to whatever frame happened to be
    // showing — the animation is gone for good. Ship the original bytes
    // untouched instead (same call as video: no in-browser re-encode).
    const isGif = /^data:image\/gif;/i.test(src);
    const api = {
      dims: null,   // {w, h} of the last export — stamped into the upload filename
      export(maxEdge = 1400) {
        const iw = imgEl.naturalWidth  || 1;
        const ih = imgEl.naturalHeight || 1;
        if (isGif) {
          api.dims = { w: iw, h: ih };
          return src;
        }
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

  /* ── Square cropper (the avatar editor only) ───────────────────────────────
     Post photos go through initPhotoPreview and keep their aspect; this is the
     one place in the app that crops, because avatars are the one thing that
     displays round. Cover-fits the image in the square frame, then lets you MOVE
     and SCALE it: drag (one finger) to pan, pinch or scroll to zoom, or drive
     the zoom from the slider under the frame. export() draws the framed region
     to a canvas.

     Geometry, all of it. The <img> is sized ONCE to its cover fit (baseW ×
     baseH) and everything after that is `translate(tx, ty) scale(zoom)` against
     a `transform-origin: 0 0`. That origin is what makes the arithmetic one
     line each way — the displayed box is simply [tx, tx + baseW·zoom] — and the
     transform is what makes a pinch smooth: rewriting width/height per frame
     would relayout the whole modal sixty times a second, where a transform is
     compositor work. `zoom` is 1 at the cover fit and never less, which is what
     guarantees the square stays covered, and `base · zoom` is the one number
     converting natural pixels to displayed ones — export() runs it backwards.

     State lives on the element (cropEl._crop) so a re-pick re-inits without
     re-wiring the gesture handlers (attached once, guarded by data-wired). */
  const CROP_ZOOM_MAX = 4;     // times the cover fit
  const CROP_MIN_SRC = 160;    // never frame fewer source px than this: past that
                               // point zoom is just enlarging JPEG mush, so the
                               // ceiling comes down to meet a small photo instead.

  function cropClamp(s) {
    s.tx = Math.min(0, Math.max(s.square - s.baseW * s.zoom, s.tx));
    s.ty = Math.min(0, Math.max(s.square - s.baseH * s.zoom, s.ty));
  }

  // Clamp, then write the transform on the next frame. Batched because a pinch
  // on a ProMotion phone delivers pointermove faster than the display can paint,
  // and two style writes per frame is one wasted. `now` skips the wait for the
  // first paint after a pick, where a frame of un-positioned image would show.
  function cropApply(cropEl, now) {
    const s = cropEl._crop;
    cropClamp(s);
    const write = () => {
      s.frame = 0;
      s.img.style.transform = `translate(${s.tx}px, ${s.ty}px) scale(${s.zoom})`;
    };
    if (now) { if (s.frame) cancelAnimationFrame(s.frame); write(); return; }
    if (!s.frame) s.frame = requestAnimationFrame(write);
  }

  // Zoom about a focal point (in frame coordinates), so the pixel under the
  // pinch midpoint or the cursor stays put. Both gestures come through here.
  function cropZoom(cropEl, z, fx, fy) {
    const s = cropEl._crop;
    z = Math.min(s.zoomMax, Math.max(1, z));
    if (z === s.zoom) { cropApply(cropEl); return; }   // held spread is still a pan
    const k = z / s.zoom;
    s.tx = fx - (fx - s.tx) * k;
    s.ty = fy - (fy - s.ty) * k;
    s.zoom = z;
    cropApply(cropEl);
  }

  // Centroid + spread of the live pointers. One pointer is a pan (spread 0), two
  // are a pinch; the centroid carries the pan either way, so lifting one finger
  // of two hands the drag over without a jump rather than ending it.
  function cropGesture(s) {
    const list = [...s.pts.values()];
    if (!list.length) return null;
    const cx = list.reduce((a, p) => a + p.x, 0) / list.length;
    const cy = list.reduce((a, p) => a + p.y, 0) / list.length;
    const d = list.length > 1 ? Math.hypot(list[0].x - list[1].x, list[0].y - list[1].y) : 0;
    return { cx, cy, d };
  }

  // Measure the frame and fit the image to it. Runs on load AND on any resize of
  // the frame (rotation, the keyboard closing under the modal) — the old cropper
  // measured once, so a frame that grew afterwards was left with an image too
  // small to cover it and exported a transparent wedge. The visual centre is
  // held across the re-fit, in natural pixels, so nothing jumps.
  function cropMeasure(cropEl) {
    const s = cropEl._crop;
    const img = s.img;
    if (!img.naturalWidth || !img.naturalHeight) return;
    // The frame's width is a vw clamp, so it is routinely fractional (132.6px on
    // a 390pt phone). clientWidth rounds, and rounding DOWN is a cover fit that
    // doesn't quite cover — a hairline of the empty frame at one edge, and an
    // export framing a sliver more than the circle showed. Measure the real box.
    const square = cropEl.getBoundingClientRect().width || s.square || 1;
    const px = s.base * s.zoom;                       // displayed px per natural px
    const held = s.square
      ? { x: (s.square / 2 - s.tx) / px, y: (s.square / 2 - s.ty) / px }
      : null;

    s.square = square;
    s.natW = img.naturalWidth;
    s.natH = img.naturalHeight;
    s.base = square / Math.min(s.natW, s.natH);        // cover fit
    s.baseW = s.natW * s.base;
    s.baseH = s.natH * s.base;
    s.zoomMax = Math.max(1, Math.min(CROP_ZOOM_MAX,
      Math.min(s.natW, s.natH) / CROP_MIN_SRC));
    s.zoom = Math.min(s.zoomMax, Math.max(1, s.zoom));
    img.style.width = s.baseW + 'px';
    img.style.height = s.baseH + 'px';

    const npx = s.base * s.zoom;
    if (held) { s.tx = s.square / 2 - held.x * npx; s.ty = s.square / 2 - held.y * npx; }
    else { s.tx = (s.square - s.baseW * s.zoom) / 2; s.ty = (s.square - s.baseH * s.zoom) / 2; }
    cropApply(cropEl, true);
  }

  // opts: { onReady, onError } — the caller holds Save until the image has
  // actually decoded, because a pick that never decodes (a stray HEIC, a file
  // the OS handed over half-exported) used to reach export() and throw
  // InvalidStateError out of the submit handler: name and bio saved, the photo
  // silently didn't, and the modal just sat there with nothing said.
  function initCropper(cropEl, imgEl, src, opts = {}) {
    const prev = cropEl._crop;
    if (prev && prev.frame) cancelAnimationFrame(prev.frame);
    const s = {
      img: imgEl, ready: false, frame: 0, pts: new Map(), g: null, rect: null,
      square: 0, natW: 0, natH: 0, base: 1, baseW: 0, baseH: 0,
      zoom: 1, zoomMax: CROP_ZOOM_MAX, tx: 0, ty: 0,
    };
    cropEl._crop = s;
    imgEl.style.transform = 'translate(0px, 0px) scale(1)';

    imgEl.onload = () => {
      if (cropEl._crop !== s) return;      // a newer pick landed first
      s.ready = true;
      cropMeasure(cropEl);
      if (opts.onReady) opts.onReady();
    };
    imgEl.onerror = () => {
      if (cropEl._crop !== s) return;
      s.ready = false;
      if (opts.onError) opts.onError();
    };
    imgEl.src = src;

    if (!cropEl.dataset.wired) {
      cropEl.dataset.wired = '1';
      const at = (c, e) => ({ x: e.clientX - c.rect.left, y: e.clientY - c.rect.top });

      cropEl.addEventListener('pointerdown', (e) => {
        const c = cropEl._crop;
        if (!c.ready) return;
        // Stops WebKit lifting the <img> into a native drag (and, with the
        // callout killed in CSS, that is the whole of the long-press hijack
        // that used to eat the pan on iOS mid-gesture).
        e.preventDefault();
        if (!c.pts.size) c.rect = cropEl.getBoundingClientRect();
        c.pts.set(e.pointerId, at(c, e));
        c.g = cropGesture(c);
        try { cropEl.setPointerCapture(e.pointerId); } catch {}
        cropEl.classList.add('dragging');
      });

      cropEl.addEventListener('pointermove', (e) => {
        const c = cropEl._crop;
        if (!c.pts.has(e.pointerId)) return;
        c.pts.set(e.pointerId, at(c, e));
        const g = cropGesture(c), was = c.g;
        c.g = g;
        if (!was) return;
        c.tx += g.cx - was.cx;                       // pan rides the centroid…
        c.ty += g.cy - was.cy;
        cropClamp(c);
        // …and a second finger scales, about the midpoint the pan just followed.
        if (was.d > 8 && g.d > 8) cropZoom(cropEl, c.zoom * (g.d / was.d), g.cx, g.cy);
        else cropApply(cropEl);
      });

      const lift = (e) => {
        const c = cropEl._crop;
        if (!c.pts.delete(e.pointerId)) return;
        try { cropEl.releasePointerCapture(e.pointerId); } catch {}
        c.g = cropGesture(c);                        // re-baseline, don't jump
        if (!c.pts.size) cropEl.classList.remove('dragging');
      };
      cropEl.addEventListener('pointerup', lift);
      cropEl.addEventListener('pointercancel', lift);

      // Trackpad/wheel zoom, focused on the cursor. Non-passive because it has
      // to beat the page scroll; the frame is touch-action:none anyway, so this
      // only ever fires from a real pointing device.
      cropEl.addEventListener('wheel', (e) => {
        const c = cropEl._crop;
        if (!c.ready) return;
        e.preventDefault();
        const r = cropEl.getBoundingClientRect();
        cropZoom(cropEl, c.zoom * Math.exp(-e.deltaY * 0.0022),
          e.clientX - r.left, e.clientY - r.top);
      }, { passive: false });

      // The other half of cropMeasure's reason for existing: the frame is
      // `max-width: 100%` inside a modal, so a rotation resizes it after the fit.
      if (typeof ResizeObserver === 'function') {
        cropEl._cropRO = new ResizeObserver((entries) => {
          const c = cropEl._crop;
          const w = entries[0] && entries[0].contentRect.width;
          if (c && c.ready && w && Math.abs(w - c.square) > 0.5) cropMeasure(cropEl);
        });
        cropEl._cropRO.observe(cropEl);
      }
    }

    return {
      get ready() { return cropEl._crop === s && s.ready; },
      // Returns null rather than throwing when there is nothing to export, so a
      // Save with a broken pick behind it is a message, not a dead modal.
      export(out = 1000) {
        if (cropEl._crop !== s || !s.ready || !s.img.naturalWidth) return null;
        const px = s.base * s.zoom;                  // displayed px per natural px
        const srcSize = s.square / px;               // source px framed by the square
        // Never enlarge: a tightly zoomed crop of a small photo exports at its
        // own size instead of being blown up to a rounder number.
        const edge = Math.max(256, Math.min(out, Math.round(srcSize)));
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = edge;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';          // a 12MP source lands on 512
        ctx.drawImage(s.img, -s.tx / px, -s.ty / px, srcSize, srcSize, 0, 0, edge, edge);
        return canvas.toDataURL('image/jpeg', 0.82);
      },
      destroy() {
        if (s.frame) cancelAnimationFrame(s.frame);
        s.frame = 0;
        s.pts.clear();
        imgEl.onload = imgEl.onerror = null;
        if (cropEl._cropRO) { cropEl._cropRO.disconnect(); cropEl._cropRO = null; }
      },
    };
  }

  // The `daily-` namespace is reserved for the join tag (see DAILY_TAG_RE), so
  // nothing typed into a tag field can land in it — otherwise a post could talk
  // its way onto a daily page it never answered, and the strip-on-display rule
  // would swallow someone's real tag on the way there.
  const parseTags = (str) => [...new Set(String(str || '').split(',')
    .map(t => t.trim().replace(/^#/, '').toLowerCase())
    .filter(t => t && !DAILY_TAG_RE.test(t)))].slice(0, 6);

  async function submitComposer() {
    const errEl = document.getElementById('c-error');
    const val = (id) => (document.getElementById(id)?.value || '').trim();
    const data = { type: pubType, tags: parseTags(val('c-tags')), note: readNoteField('c-note') };
    // A daily answer carries its join tag invisibly — it's the app's bookkeeping,
    // not one of the poster's words, so it never sat in the field they can see.
    // It rides PAST the six-tag cap for the same reason: it isn't one of theirs.
    // The tag goes on only if what you made is what the prompt asked for
    // (dailyAccepts, which is also what the banner has been showing you the whole
    // time), and only once — one answer each (see myAnswer). A post that misses
    // either test is just a post: it publishes normally and lands on the home
    // feed instead of the daily page (see the routing after res).
    if (dailyAccepts(answeringDaily, pubType) && !myAnswer(answeringDaily)) {
      data.tags.push(answeringDaily.tag);
    }
    // Audience rides EVERY post type, not just activities — the lock is on the
    // note box's foot too, and a picked 'public' that never reached the row is
    // how a public post quietly landed back in 'circle' (and out of Discover).
    data.audience = pubAudience.mode;          // 'public' | 'circle' | 'list'
    data.audienceUsers = pubAudience.users;    // usernames when 'list'

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
      hapticEvent('ERROR');
      if (btn) { btn.disabled = false; btn.textContent = 'Share'; }
      return;
    }
    clearPostProgress();
    // Publishing is the one thing in the app that earns the full success
    // notification rather than an impact: it's the end of a piece of work, not
    // an acknowledgement of a tap. A photo or clip may have been uploading for
    // a while with the phone face-down, which is exactly when a buzz carries
    // information a screen can't.
    hapticEvent('SUCCESS');
    cropper = null;
    videoCapture = null;
    justPostedId = String(res.post.id);   // feed will sparkle this card in on arrival
    pubGroup = 'post';          // next compose opens on the Post group…
    pubType = 'note';           // …as a plain Note until something's attached
    // An answer goes home to its question: the point of answering is seeing what
    // everyone else said, and the home feed is not where that is. Only if the tag
    // actually survived — someone who deleted it out of the field posted a normal
    // post, and dropping them on a page their post isn't on would be a small lie.
    const answered = answeringDaily;
    answeringDaily = null;
    if (answered && (res.post.tags || []).includes(answered.tag)) {
      go(`#/daily/${encodeURIComponent(answered.slug)}`);
      return;
    }
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
    // The daily join tag isn't in the field (see editFieldsFor), so put it back —
    // an edit is a change to what you SAID, never a retraction of the answer.
    const carried = dailyTagOf(post);
    if (carried) data.tags.push(carried);

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
  let lbOrigin = null;         // the feed <img> a photo flew out of (hidden mid-flight)
  let lbBaseRect = null;       // the lightbox img's untransformed layout box
  let lbClosing = false;       // swallow re-entry while the close flight runs
  function openLightbox(src, alt, isVideo, originEl) {
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
      wireLightboxDrag(v, true);   // swipe-out to dismiss, without stealing the native controls
    }
    lbClosing = false;
    lbOrigin = null;
    lbBaseRect = null;
    lightboxReturn = document.activeElement;
    document.body.style.overflow = 'hidden';   // lock the page behind it
    lightbox.classList.add('open');
    lightbox.focus();
    document.addEventListener('keydown', onKey);

    // Shared-element flight (photos only): FLIP — measure the tapped card image,
    // invert the lightbox image onto it, then release, so the photo FLIES from
    // its card into the viewer instead of fading in. Transform-only (translate +
    // scale about 0 0), one promoted layer, and the origin img is hidden for the
    // whole session so there's exactly one copy of the photo moving.
    const pic = isVideo ? null : lightbox.querySelector('img');
    if (pic) wireLightboxDrag(pic, false);
    if (!pic || !originEl?.isConnected || prefersReduced()) return;
    const r0 = originEl.getBoundingClientRect();
    if (!r0.width || !r0.height) return;
    pic.style.opacity = '0';           // hold until it's decoded and measurable
    const fly = () => {
      pic.style.opacity = '';
      if (lbClosing) return;
      const r1 = pic.getBoundingClientRect();
      if (!r1.width || !r1.height) return;
      // The feed crops tall media toward 5:4; a big shape mismatch would shear
      // mid-flight, so past ~20% keep the old plain fade.
      const shear = (r0.width / r0.height) / (r1.width / r1.height);
      if (shear > 1.2 || shear < 0.83) return;
      lbOrigin = originEl;
      lbBaseRect = r1;
      originEl.style.visibility = 'hidden';
      try {
        pic.animate([
          { transformOrigin: '0 0',
            transform: `translate(${r0.left - r1.left}px, ${r0.top - r1.top}px) ` +
                       `scale(${r0.width / r1.width}, ${r0.height / r1.height})` },
          { transformOrigin: '0 0', transform: 'none' },
        ], { duration: 480, easing: springEase() });
      } catch { /* no WAAPI transform support: the photo simply appears in place */ }
    };
    if (pic.complete && pic.naturalWidth) fly();
    else {
      pic.addEventListener('load', fly, { once: true });
      pic.addEventListener('error', () => { pic.style.opacity = ''; }, { once: true });
    }
  }
  function closeLightbox() {
    if (!lightbox || lbClosing) return;
    lbClosing = true;                 // reset by the next openLightbox
    // A playing <video> must be stopped, not just visually hidden, or it keeps
    // decoding (and, if unmuted, keeps making sound) behind the closed sheet.
    const v = lightbox.querySelector('video');
    if (v) { v.pause(); v.removeAttribute('src'); v.load(); }
    // Reverse flight: fly the photo home while the veil fades, then reveal the
    // (hidden) card image right as they trade places. Departs from wherever a
    // drag left it — the current visual box is re-expressed as a transform of
    // the layout box so both keyframes share origin 0 0 and nothing snaps. If
    // home has left the DOM (a background refresh rebuilt the card), it's the
    // plain fade, and the fresh card was never hidden anyway.
    const pic = lightbox.querySelector('img');
    const home = lbOrigin;
    lbOrigin = null;
    const unhide = () => { if (home) home.style.visibility = ''; };
    let flying = false;
    if (pic && lbBaseRect && home?.isConnected && !prefersReduced()) {
      const r0 = home.getBoundingClientRect();
      const r1 = lbBaseRect;
      if (r0.width && r1.width) {
        const rc = pic.getBoundingClientRect();
        pic.style.transform = '';     // keyframes own it from here; no paint between
        try {
          const flight = pic.animate([
            { transformOrigin: '0 0',
              transform: `translate(${rc.left - r1.left}px, ${rc.top - r1.top}px) ` +
                         `scale(${rc.width / r1.width}, ${rc.height / r1.height})` },
            { transformOrigin: '0 0',
              transform: `translate(${r0.left - r1.left}px, ${r0.top - r1.top}px) ` +
                         `scale(${r0.width / r1.width}, ${r0.height / r1.height})` },
          ], { duration: 260, easing: 'cubic-bezier(0.32, 0.72, 0.35, 1)', fill: 'forwards' });
          flying = true;
          flight.onfinish = unhide;
          setTimeout(unhide, 400);    // backstop if the event is ever missed
        } catch { /* fall through to the plain fade */ }
      }
    }
    if (!flying) unhide();
    lbBaseRect = null;
    lightbox.classList.remove('open');
    lightbox.style.opacity = '';      // clear any drag dim; the fade takes over
    document.body.style.overflow = '';
    document.removeEventListener('keydown', onKey);
    if (lightboxReturn && lightboxReturn.focus) lightboxReturn.focus();
    lightboxReturn = null;
  }
  const onKey = (e) => { if (e.key === 'Escape') closeLightbox(); };

  // Drag to dismiss: the media follows the finger, the veil thins with distance,
  // and a real flick or a long pull lets go — closeLightbox then flies a photo
  // home from wherever it was released (a video just fades out in place). A short
  // drag springs back to centre on the shared spring.
  //
  // A photo owns its whole surface, so it can capture the pointer the instant a
  // finger lands. A video can't — its native controls (scrub, pause, tap-to-play)
  // need those same taps and sideways drags. So a video *arms* the dismiss only
  // once the finger commits to a vertical pull, and never from the bottom control
  // strip: taps and horizontal scrubs fall straight through to the controls.
  //
  // A photo ALSO zooms here, and the lightbox is the only place it can: the feed
  // caps a tall frame at 5:4 and tap-to-open is the promise that nothing was
  // lost, which a viewer fixed at 92vw only half keeps — the whole photo is on
  // screen but the small print in it is still out of reach. The zoom is ours to
  // draw for the same reason the drag is: `touch-action: none` is what hands us
  // the vertical pull, and it takes the browser's pinch away in the same breath,
  // so a photo without this code cannot be zoomed by any gesture at all.
  //
  // Pinch scales about the midpoint of the two fingers, one finger pans once
  // you're past fit, a trackpad/wheel does it on a desktop, and a tap while
  // zoomed returns to fit INSTEAD of closing — the way out must never be behind
  // a gesture. There is deliberately no double-tap-to-zoom: its first tap is
  // indistinguishable from the tap that closes, so buying it means delaying
  // every close by a double-tap window, and pinch is the gesture a phone
  // already reaches for.
  function wireLightboxDrag(mover, isVideo) {
    // touch-action:none is what actually hands us the vertical drag on a touch
    // device — without it the browser claims the pull as a (dead) page scroll and
    // we never see the moves to arm, so the swipe silently does nothing. It does
    // NOT gag a video's native controls: touch-action gates the browser's own
    // scroll/zoom gestures, not event delivery, so the scrubber's shadow-DOM
    // widget still gets its taps and drags. The video keeps them usable through
    // the arm-on-vertical-intent + skip-the-control-strip logic below, not by
    // leaving its surface pannable.
    mover.style.touchAction = 'none';
    const CTRL_STRIP = 56;   // px of native controls along a video's bottom edge, left to the UA
    const zoomable = !isVideo;   // a video's surface belongs to its own controls
    const LB_MAX = 5;            // past ~5x a phone photo is bitmap, not detail
    let sx = 0, sy = 0, dx = 0, dy = 0, dragging = false, armed = false, raf = 0;
    let lastY = 0, lastT = 0, vy = 0;
    let sc = 1, tx = 0, ty = 0;      // the viewer's transform while zoomed, ours alone
    const pts = new Map();           // live pointers, so two fingers can be told from one
    let pinch = null;                // { d, s } captured when the second finger lands
    let panning = false, panned = false, tx0 = 0, ty0 = 0;
    let box = null;                  // the untransformed layout box, held for the gesture

    const vw = () => window.visualViewport?.width || window.innerWidth;
    const vh = () => window.visualViewport?.height || window.innerHeight;
    const apply = () => {
      mover.style.transform = (sc === 1 && !tx && !ty)
        ? '' : `translate(${tx}px, ${ty}px) scale(${sc})`;
    };
    // The untransformed layout box, DERIVED rather than re-measured: a transform
    // never moves layout, and scaling about the centre leaves the centre wherever
    // the translate put it, so the live rect minus the translate is that box.
    // Taken once per gesture — layout can't change mid-pinch, and reading it per
    // move would force a sync layout against the transform we just wrote.
    const measure = () => {
      const r = mover.getBoundingClientRect();
      return { cx: r.left + r.width / 2 - tx, cy: r.top + r.height / 2 - ty,
               w: r.width / sc, h: r.height / sc };
    };
    // No gap and no drift: an axis larger than the screen may pan only as far as
    // its own edges, and one smaller than the screen is pinned back to centre.
    const clampPan = (b) => {
      const w = b.w * sc, h = b.h * sc;
      tx = w > vw() ? Math.min(Math.max(tx, vw() - b.cx - w / 2), w / 2 - b.cx) : vw() / 2 - b.cx;
      ty = h > vh() ? Math.min(Math.max(ty, vh() - b.cy - h / 2), h / 2 - b.cy) : vh() / 2 - b.cy;
    };
    // Scale about a point on the screen, keeping whatever sits under it under it.
    const zoomAt = (next, px, py, b, floor = 1) => {
      const s = Math.min(Math.max(next, floor), LB_MAX);
      tx = px - b.cx - (s / sc) * (px - b.cx - tx);
      ty = py - b.cy - (s / sc) * (py - b.cy - ty);
      sc = s;
      clampPan(b);
      apply();
    };
    // Back to the photo as the viewer laid it out, on the shared spring. The
    // keyframes start from wherever the fingers left it, so nothing snaps first.
    const toFit = () => {
      const from = `translate(${tx}px, ${ty}px) scale(${sc})`;
      sc = 1; tx = ty = 0;
      apply();
      try {
        const a = mover.animate([{ transform: from }, { transform: 'none' }],
          { duration: 320, easing: springEase() });
        a.onfinish = () => a.cancel();
      } catch { /* no WAAPI: it's already at fit */ }
    };
    // A gesture that moved must not also land as a click — that would close the
    // lightbox out from under a pan, or bounce a pinch back to fit.
    const swallowClick = () => {
      const stop = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
      lightbox.addEventListener('click', stop, { capture: true, once: true });
      setTimeout(() => lightbox.removeEventListener('click', stop, { capture: true }), 120);
    };

    if (zoomable) {
      // Tap while zoomed goes back to fit rather than closing, so a reader who
      // pinched in is never one tap from losing the photo. At fit it falls
      // through to the backdrop's click-to-close, exactly as before.
      mover.addEventListener('click', (e) => {
        if (sc > 1.01) { e.stopPropagation(); toFit(); }
      });
      // Desktop: a trackpad pinch arrives as ctrl+wheel, a mouse as plain wheel.
      mover.addEventListener('wheel', (e) => {
        e.preventDefault();
        zoomAt(sc * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025)),
          e.clientX, e.clientY, measure());
      }, { passive: false });
    }

    mover.addEventListener('pointerdown', (e) => {
      if (lbClosing) return;
      if (zoomable) {
        pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        try { mover.setPointerCapture(e.pointerId); } catch { /* older engines */ }
        // A second finger outranks whatever the first was doing: a dismiss drag
        // in flight becomes a pinch, and the veil it thinned goes back to full.
        if (pts.size === 2) {
          const [a, c] = [...pts.values()];
          dragging = armed = panning = false;
          if (raf) { cancelAnimationFrame(raf); raf = 0; }
          lightbox.style.opacity = '';
          box = measure();
          pinch = { d: Math.hypot(a.x - c.x, a.y - c.y) || 1, s: sc };
          return;
        }
        if (pts.size > 2) return;
        // Zoomed in, one finger: this is a pan of the photo, never a dismiss.
        if (sc > 1) {
          panning = true; panned = false;
          sx = e.clientX; sy = e.clientY; tx0 = tx; ty0 = ty;
          box = measure();
          return;
        }
      } else {
        if (!e.isPrimary) return;
        // A press that lands on the control strip is a scrub or a pause, never a swipe-out.
        const r = mover.getBoundingClientRect();
        if (e.clientY > r.bottom - CTRL_STRIP) return;
      }
      dragging = true;
      armed = !isVideo;      // a photo is armed at once; a video waits for vertical intent
      sx = e.clientX; sy = e.clientY; dx = dy = vy = 0;
      lastY = e.clientY; lastT = e.timeStamp;
      if (armed) { try { mover.setPointerCapture(e.pointerId); } catch { /* older engines */ } }
    });
    mover.addEventListener('pointermove', (e) => {
      if (zoomable && pts.has(e.pointerId)) pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch) {
        if (pts.size < 2) return;
        const [a, c] = [...pts.values()];
        const d = Math.hypot(a.x - c.x, a.y - c.y) || 1;
        // Under fit it goes elastic rather than hard-stopping, and springs back
        // on release — a pinch that meets a wall reads as a broken gesture.
        zoomAt(pinch.s * (d / pinch.d), (a.x + c.x) / 2, (a.y + c.y) / 2, box, 0.6);
        return;
      }
      if (panning) {
        tx = tx0 + (e.clientX - sx); ty = ty0 + (e.clientY - sy);
        if (Math.hypot(e.clientX - sx, e.clientY - sy) > 8) panned = true;
        clampPan(box);
        apply();
        return;
      }
      if (!dragging) return;
      dx = e.clientX - sx; dy = e.clientY - sy;
      // Video: commit to the dismiss only once the pull is real and vertical-dominant.
      // A mostly-sideways move is a scrub, so bail (un-dragged) and let the controls have it.
      if (!armed) {
        if (Math.abs(dy) < 10 || Math.abs(dy) <= Math.abs(dx)) return;
        armed = true;
        try { mover.setPointerCapture(e.pointerId); } catch { /* older engines */ }
      }
      if (e.timeStamp > lastT) {      // velocity for the flick test, px/ms
        vy = (e.clientY - lastY) / (e.timeStamp - lastT);
        lastY = e.clientY; lastT = e.timeStamp;
      }
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (!dragging || !armed) return;
        const d = Math.hypot(dx, dy);
        mover.style.transform =
          `translate(${dx}px, ${dy}px) scale(${Math.max(0.82, 1 - d / 1400)})`;
        // The veil thins as the media pulls away (its own transition smooths it).
        lightbox.style.opacity = String(Math.max(0.45, 1 - d / 520));
      });
    });
    const end = () => {
      if (!dragging) return;
      dragging = false;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      if (!armed) return;      // a tap or a scrub: it never became a drag, nothing to undo
      armed = false;
      const d = Math.hypot(dx, dy);
      // A drag was a drag: swallow the click that follows so it can't double-close
      // (or close against the user after a spring-back).
      if (d > 8) swallowClick();
      if ((Math.abs(vy) > 0.55 || d > 110) && !lbClosing) { closeLightbox(); return; }
      lightbox.style.opacity = '';    // re-thicken the veil
      if (d > 2) {
        try {
          const back = mover.animate({ transform: 'none' },
            { duration: 460, easing: springEase() });
          back.onfinish = () => { mover.style.transform = ''; back.cancel(); };
        } catch { mover.style.transform = ''; }
      } else mover.style.transform = '';
    };
    // A finger leaving: retire a pinch or a pan first, and only fall through to
    // the dismiss test if this pointer was actually driving one. Lifting one of
    // two fingers ends the pinch without promoting the survivor to a drag — it
    // never went through pointerdown as one, so it has no start to measure from.
    const lift = (e) => {
      if (zoomable) {
        pts.delete(e.pointerId);
        try { mover.releasePointerCapture(e.pointerId); } catch { /* older engines */ }
      }
      if (pinch) {
        if (pts.size >= 2) return;
        pinch = null;
        dragging = armed = false;
        swallowClick();
        if (sc <= 1.01) toFit();
        else { clampPan(box); apply(); }   // the elastic pull settles back inside its edges
        return;
      }
      if (panning) {
        panning = false;
        if (panned) swallowClick();
        return;
      }
      end();
    };
    mover.addEventListener('pointerup', lift);
    mover.addEventListener('pointercancel', lift);
  }

  /* ── Press grammar ──────────────────────────────────────────────────────────
     One delegated engine gives every tappable control the same physical
     response: a fast compression the instant a finger lands, a springy release
     on let-go. It animates the `scale` property (NOT `transform`) so it
     composes with whatever transform a control already carries — the going
     label's optical nudge, the FAB's glide, the dome — with zero collisions.
     WAAPI rather than CSS :active because (a) the release can ride the shared
     --spring token and (b) a CSS transition on scale would clobber each
     control's own transition shorthand. Elements whose press is a child-icon
     pop (the dial items) keep their CSS :active rules and stay off this list. */
  const PRESS_TARGETS = [
    '.card-social button', '.card-menu', '.going-out',
    '.seg-tab', '.sheet-item', '.sheet-cancel',
    '.comment-form button', '.comment-delete', '.modal-actions button',
    '.masthead-filter', '.friend-btn', '.request-accept', '.request-ignore',
    '.account-badges > button', '.pf-photo-edit', '.nav-link',
    '.feed-empty-cta', '.composer-post',
  ].join(', ');
  let pressing = null;   // { el, scale, down } while a finger is down
  function pressRelease() {
    if (!pressing) return;
    const { el, scale, down } = pressing;
    pressing = null;
    try {
      const up = el.animate({ scale: [String(scale), '1'] },
        { duration: 480, easing: springEase() });
      up.onfinish = () => up.cancel();   // hand the property back to CSS at rest
      down.cancel();
    } catch { down.cancel(); }
  }
  document.addEventListener('pointerdown', (e) => {
    if (e.button > 0 || prefersReduced()) return;
    const el = e.target.closest?.(PRESS_TARGETS);
    if (!el || el.disabled) return;
    pressRelease();                      // a stray press whose pointerup got lost
    // Same grammar, sized to the object: rows barely compress, buttons more.
    const w = el.offsetWidth;
    const scale = w > 240 ? 0.98 : w > 120 ? 0.96 : 0.93;
    try {
      const down = el.animate({ scale: ['1', String(scale)] },
        { duration: 90, easing: 'ease-out', fill: 'forwards' });
      pressing = { el, scale, down };
    } catch { /* engine can't animate `scale`: no press feedback, no harm */ }
  }, { passive: true });
  document.addEventListener('pointerup', pressRelease, { passive: true });
  document.addEventListener('pointercancel', pressRelease, { passive: true });

  /* ── Ambient wash ───────────────────────────────────────────────────────────
     The soft background glow (see .ambient) is on-brand by default. On a profile
     with a photo we sample a representative colour from that photo and feed it to
     the --glow-* CSS vars, so the page's own background picks up the person's hue
     — a gradient underneath the content, not a blurred photo layered on top. */
  const sampleCache = new Map();
  let ambientSeq = 0;

  /* THE PALETTE. Eight colours a profile can wear, and the first five are the
     post quintet itself — lavender, coral, cyan, lime, rose — because those are
     Tria's colours and a ninth family of hues invented for one control would be
     the design system saying two different things about the same app.

     Spending them here doesn't blunt what they mean on a post, and the reason is
     that this surface never carried a promise to blunt: the profile glow has
     been an ARBITRARY sampled colour since the day it shipped, free to land on
     exactly lime or exactly rose depending on someone's jumper. The quintet's
     meaning lives where a hue names a TYPE (a filter chip, the Publish button, a
     daily's card), and nothing on a profile card does that.

     Three added, chosen to fill the gaps the quintet leaves on the hue wheel
     rather than to be new brand colours — amber at ~40 degrees, jade at ~158,
     ocean at ~218, which are the three widest holes between the five. They are
     drawn at the quintet's own weight (~0.75 lightness, saturation in its range)
     so a row of eight reads as one family and not as five Tria colours with
     three guests. */
  const ACCENTS = [
    { key: 'lavender', label: 'Lavender', hex: '#b7a6e8' },   // = --type-note
    { key: 'coral',    label: 'Coral',    hex: '#f2a58c' },   // = --type-find
    { key: 'cyan',     label: 'Cyan',     hex: '#9fd6e8' },   // = --type-photo
    { key: 'lime',     label: 'Lime',     hex: '#b9df7d' },   // = --type-activity
    { key: 'rose',     label: 'Rose',     hex: '#ea86ae' },   // = --type-poll
    { key: 'amber',    label: 'Amber',    hex: '#e8c07d' },
    { key: 'jade',     label: 'Jade',     hex: '#8fdcc0' },
    { key: 'ocean',    label: 'Ocean',    hex: '#8fb4ea' },
  ];

  /* WHY ONE SOURCE IS NORMALISED AND THE OTHER IS NOT.

     A photo colour is an AVERAGE, and an average of a photograph comes out limp
     and at whatever lightness the room happened to be — a night shot and a
     snowfield would otherwise glow at wildly different weights. So sampleColor
     pins it: hue kept, saturation lifted and clamped, lightness forced to 0.55.

     A palette hex is not an average, it is a decision, and putting it through
     the same gate was tried and was plainly wrong. The quintet lives at ~0.78
     lightness and that IS the pastel — dragging it to 0.55 turned lavender into
     a strong purple and rose into magenta, eight sweets in a row on the one
     surface in the app that is meant to be austere. The palette therefore goes
     in raw, and what that costs is checked on the surface it lands on rather than
     assumed (see the .ambient wash in app.css, measured against every accent in
     both schemes). It errs light, which is the safe direction on paper and the
     expensive one on ink — which is why the wash mixes toward the scheme's own
     extreme before it saturates, rather than trusting the source. */
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

  const glowNorm = (r, g, b, boost) => {
    const hsl = rgbToHsl(r, g, b);
    return hslToRgb(hsl.h, Math.max(0.5, Math.min(0.85, hsl.s * (boost || 1))), 0.55);
  };

  // A palette slug -> the colour it paints. Unknown slug (an older client meeting
  // a newer row, or a value typed into the DB by hand) returns null, which every
  // caller reads as "not a palette pick" and falls back to the photo: the
  // default, not a broken card. Swatches paint from this too, so the picker is
  // showing the colour you will actually get.
  const accentCss = (key) => (ACCENTS.find(x => x.key === key) || {}).hex || null;

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
          // 1.5x: a saturation-weighted AVERAGE is still an average, and comes
          // out limper than any pixel that fed it. A chosen hex needs no such
          // rescue, which is the only difference between the two sources.
          out = glowNorm(R / W, G / W, B / W, 1.5);
        } catch { out = null; }
        sampleCache.set(src, out);
        resolve(out);
      };
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  // A person's colour: a palette pick if they made one, otherwise sampled from
  // their photo. It lights the full-screen .ambient wash on their profile and on
  // Edit profile, and rides along as --glow-photo because the colour ring badge
  // on the edit form wears it — so the control that sets the colour is showing
  // it.
  //
  // It spent a while as a glow clipped into the bottom-right corner of the
  // identity card, which was a smaller answer to the same question and is
  // retired with that card. The wash it went back to is not the old one: the
  // page-wide blob that used to live here (data-ambient "photo") was untinted,
  // unsaturated and paid for entirely in alpha, and About and a daily had copies
  // of it. What a profile lights now is the composer's wash, whole — same
  // tokens, same tinted mix, same ink rule — with the origin moved to the
  // top-right corner. Colour where it is information; nowhere it is decoration.
  //
  // Sampling is async; a seq guard drops a stale result if you've navigated on.
  //
  // Two functions, one question. withAccent RESOLVES a person's colour —
  // synchronously for a palette pick, after a decode for a photo — and paintWash
  // spends it. Split that way so a colour PICK can repaint without a navigation,
  // which is the whole reason the picker can sit on the page it sets.
  //
  // The seq guard is shared and that is deliberate: only one of these is ever
  // the live answer, so a later call cancelling an earlier sample is correct.
  function withAccent(user, apply) {
    const seq = ++ambientSeq;
    const done = (css) => { if (seq === ambientSeq) apply(css); };
    if (!user || user.accent === 'none') return done(null);   // no one, or colour off
    // A chosen colour is SYNCHRONOUS, and that is worth more than it looks: the
    // photo path has a decode in it, so a pick lands in the same frame as the tap.
    const picked = accentCss(user.accent);
    if (picked) return done(picked);
    if (!user.avatar) return done(null);                      // nothing to sample
    sampleColor(user.avatar).then(rgb => done(rgb && `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`));
  }

  // Light the wash. Both callers pass "profile" — a profile page and the form
  // that edits it are the same colour on the same gradient, and there is
  // deliberately no third geometry for them to drift apart on. The parameter
  // stays because the composer's "publish" is the same switch, set in
  // renderPublish where the hue is a post type rather than a person.
  //
  // Turning the wash OFF leaves --glow-wash where it was on purpose: the fade is
  // an opacity ramp, and clearing the colour under it would swap the hue to the
  // initial lavender halfway out.
  function paintWash(user, mode) {
    const body = document.body;
    withAccent(user, (css) => {
      if (!css) { body.style.removeProperty('--glow-photo'); body.dataset.ambient = 'none'; return; }
      body.style.setProperty('--glow-photo', css);
      body.style.setProperty('--glow-wash', css);
      body.dataset.ambient = mode;
    });
  }

  function applyAmbient(path) {
    const body = document.body;
    if (path === '#/profile/edit') { paintWash(Store.currentUser(), 'profile'); return; }
    let user = null;
    if (path.startsWith('#/u/')) user = Store.user(decodeURIComponent(path.slice(4)));
    else if (path === '#/profile') user = Store.currentUser();
    if (!user) { body.style.removeProperty('--glow-photo'); body.dataset.ambient = 'none'; return; }
    // A page that IS going to wash keeps the current colour lit while the next
    // one resolves, so profile to profile TWEENS rather than blinking out and
    // back — the sample is a decode, and a hard reset would spend it as a gap.
    // The composer is the one wash that can't be inherited that way: its hue
    // names a post type, and leaving it up over someone's profile would be the
    // page saying something false for the length of a fetch.
    if (body.dataset.ambient === 'publish') body.dataset.ambient = 'none';
    paintWash(user, 'profile');
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

    // The business fold is now a doorway, not the pitch. A business owner
    // shouldn't have to expand a panel under the FAQ to find out what Tria
    // costs, so the plans, the price ladder and the anti-advertising promise
    // live on their own page at #/business and this stays three lines and a
    // link. Everything the fold used to say is on that page, said better.
    const businessHtml = aboutFold('business', 'Tria for business',
      `<p><strong>A direct line to the people who chose to follow you, for a ` +
        `flat monthly price and no ad auction.</strong> Everyone following you ` +
        `sees everything you post, in the order you posted it.</p>` +
      `<p>Every business on Tria runs on an organization account. Three plans, ` +
        `starting at $19.99 a month.</p>` +
      `<p><a class="about-more" href="#/business">See the plans and what they ` +
        `cost &rarr;</a></p>`);

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
          // The install fold is browser-only. In the App Store build its whole
          // premise is false ("nothing to download, no store in between") and
          // pointing a user at Safari to re-install what they're already holding
          // is both silly and the sort of thing review reads as a web redirect.
          (nativeShell() ? '' : aboutFold('install', 'Add Tria to your home screen', installHtml)) +
          guidelinesHtml + privacyHtml + faqHtml +
          // The business fold is browser-only for a different reason than the
          // install one above, and it is Apple's rather than ours. Guideline
          // 3.1.1 reads a price plus a way to act on it as a purchasing
          // mechanism, and an organization account is a thing that exists
          // INSIDE Tria, so naming $49.99 and pointing at the feedback form is
          // the exact shape the rule describes — a call to action for an in-app
          // feature bought anywhere but IAP. The predicate is nativeShell()
          // rather than installedShell() on purpose: this is a rule about the
          // App Store build specifically, and a home-screen PWA is not
          // something Apple reviews. So the web page keeps the fold in full,
          // which is where the enquiries come from anyway.
          (nativeShell() ? '' : businessHtml) + feedbackHtml +
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

  /* ── Tria for business (#/business) ────────────────────────────────────────
     The pricing page, and the only page in Tria written for someone who hasn't
     signed up. It is reachable signed out for exactly that reason (the gate
     lets #/about and #/business through and nothing else), because a business
     owner following a link from an email is not going to make an account first
     to find out what the account costs.

     Three plans, good/better/best, and the FENCES matter more than the prices:
     every one of them is a fact about the ORGANIZATION (how many places, how
     many people posting, whether they gather anyone in a room) and not one of
     them is a fact about the AUDIENCE. That is the whole design constraint.
     Tiering on reach, ranking, frequency or analytics is the ordinary way to
     build this page and it is the business model Tria exists to not have: the
     moment a plan buys you more of someone else's attention, the app has to
     start deciding whose attention, and it has an algorithm. So the ladder can
     only ever be priced on the seller's size, never on the buyer's eyeballs.

     The page ARGUES for none of that, and it used to. There was a whole section
     under the plans headed "four things it doesn't buy" (reach, a ranking, data
     about people, an ad), which was accurate, well written and the wrong genre:
     a business owner who has come to look at prices does not want to be told
     what they can't have, and a page that spends its second half naming things
     Tria refuses to sell reads as a smaller product rather than a better deal.
     The constraint above is real and it stays real, it just doesn't need
     defending in copy. The app is the proof. Keep this page to one paragraph,
     the plans, and how to start one.

     Activities are the middle fence because they're the one thing here that
     lands in the real world: a time, a place, and people showing up to it. See
     the note on `canJoin` in CLAUDE.md — RSVPs are friends-only today, so a
     business account posting an activity its FOLLOWERS can join is the one
     promise on this page the app can't keep yet. It's the first thing to build
     when there's a paying client; nothing else here needs code. */
  const BIZ_PLANS = [
    {
      key: 'local',
      name: 'Local',
      price: '$19.99',
      // The seat count is a feature line rather than a sentence over the list.
      // Each card used to open with a self-select line ("One place. One or two
      // people posting.") that said in prose exactly what the items under it
      // said in items, so it read as the card clearing its throat.
      feat: [
        ['', 'A verified organization profile'],
        ['', 'Notes, finds, photos and polls, with comments and replies'],
        ['', 'Everything you post, in order, to everyone who follows you'],
        ['', 'Up to two people posting'],
      ],
    },
    {
      key: 'team',
      name: 'Team',
      price: '$49.99',
      feat: [
        ['', 'Everything in Local'],
        // The one pastel on the page, and it is the activity lime, used the way
        // the daily card uses the quintet: the colour says WHAT YOU CAN MAKE,
        // not "this is the upsell". A second hue here would invent a sixth
        // meaning for the palette.
        ['activity', 'Activities, with a real time, a real place and an RSVP list'],
        ['', 'Up to ten people posting'],
      ],
    },
    {
      key: 'chapters',
      name: 'Chapters',
      price: '$99.99',
      feat: [
        ['', 'Everything in Team'],
        ['', 'An account for each location or chapter, billed together'],
        ['', 'No limit on how many people post'],
        ['', 'A named person here, and help getting set up'],
      ],
    },
  ];

  function renderBusiness(gated) {
    const plansHtml = BIZ_PLANS.map(p =>
      // All three cards are equal. The middle one used to carry a "Most
      // businesses" label plus a brighter rim and a deeper float to back it up;
      // the label went, and the emphasis went with it, because a card drawn
      // heavier than its neighbours with nothing saying why reads as a
      // rendering fault rather than a recommendation.
      `<article class="biz-plan">` +
        `<h3 class="biz-plan-name">${p.name}</h3>` +
        `<p class="biz-plan-price">${p.price}<span>a month</span></p>` +
        `<ul class="biz-plan-feat">` +
          p.feat.map(([type, text]) =>
            `<li${type ? ` class="biz-feat--${type}"` : ''}>${text}</li>`).join('') +
        `</ul>` +
      `</article>`).join('');

    view.innerHTML =
      `<section class="view about business${gated ? ' about--front' : ''}">` +
        (gated ? authHeader() : '') +
        `<p class="about-back"><a href="#/about">&larr; ` +
          `${gated ? 'Back to About' : 'About Tria'}</a></p>` +
        mastheadEl('Social media made local', 'Tria for business') +
        `<div class="about-body">` +
          // One paragraph, and it sells rather than explains. It leads on the
          // two things a business owner actually gets (a price that isn't an
          // auction, and every single person who followed them), because the
          // page used to open on how Tria is funded, which frames the reader as
          // the one paying for everybody else's free app instead of the one
          // getting a better deal than they're getting anywhere else.
          `<p class="about-lede"><strong>Tria gives your business a direct line ` +
            `to the people who chose to follow you, for a flat monthly price ` +
            `that costs less than a week of ads almost anywhere else.</strong> ` +
            `Everyone following you sees everything you post, in the order you ` +
            `posted it. No bidding, no boosting, and no algorithm deciding how ` +
            `much of your own audience you get to reach today.</p>` +

          `<div class="biz-plans">${plansHtml}</div>` +

          `<h2 class="about-head biz-head">Getting started</h2>` +
          `<p>Every business on Tria runs on an organization account, at any ` +
            `size, including the one where you're doing all of it yourself. ` +
            `Send us a note through the feedback form and say which plan looks ` +
            `right, roughly how many people will be posting, and whether you ` +
            `need activities. We'll take it from there.</p>` +
          `<p><a class="about-more" href="#/about?open=feedback">Start an ` +
            `organization account &rarr;</a></p>` +
        `</div>` +
      `</section>`;
  }

  /* ── Router ────────────────────────────────────────────────────────────────
     A route change has NO transition. The destination is built and mounted in
     the same task as the navigation, so the new page is simply there on the next
     frame and the old one is simply gone.

     That is a deliberate reversal, and the history is worth keeping because each
     step was an improvement that still left the app feeling slow. Pages used to
     slide along a nav line; the slide read as snapping on Discover, whose grid is
     dozens of photos still decoding while it ran, so it became a cross dissolve.
     The cross dissolve flashed — two ramps crossing means neither layer is opaque
     mid-move, so a quarter of the bare page background punched through every
     navigation — so it became ONE fade, the destination mounted opaque with only
     the outgoing page dissolving off the top of it. That fixed the flash and it
     was still 240ms of the app withholding a page it had already finished
     building. Nothing was mistimed by then; the fade itself was the cost. Tapping
     a tab is not an event that needs narrating, and the app has plenty of motion
     left in the places where something actually happened — a card landing, the
     pull-to-refresh ring, the publish sparkles.

     Two things the fade paid for have to be paid some other way, and they are
     both still here: rows mounted by a navigation do NOT play their entrance
     (the freeze below), and photos do not fade in for one beat afterwards (the
     `.page.enter` rule in app.css). Without those, "instant" means the page frame
     arrives instantly and then 87 tiles rise and a wave of bitmaps fades up under
     it, which is the sluggishness this removal is for, wearing a different coat.

     One path, so every view renders the same way and inherits it. */

  // Build the next page and put it on screen. `renderFn` fills the fresh `view`.
  //
  // `settleScroll` puts the window where this navigation wants it. It stays a
  // callback rather than a flag because there are three destinations and only
  // the caller knows which: the top (an ordinary navigation), the spotlighted
  // card (parkCard, which renderFn has already jumped to — pass a no-op), and a
  // remembered position (restoreScroll, on a back or an edge-swipe). Omit it for
  // the default. Nothing may move the scroll after renderPage returns.
  function renderPage(renderFn, settleScroll) {
    const reduce = prefersReduced();
    const token = ++navToken;

    const page = document.createElement('div');
    page.className = 'page';

    // Where the window sat BEFORE the render, so the default settle can tell
    // "already at the top" from "needs to go there". renderFn can move the scroll
    // itself (parkCard, aiming at the spotlighted card), so reading this
    // afterwards would measure the destination, not the origin.
    const fromY = window.scrollY;
    // Put the window where this navigation wants it. Every path runs this, so no
    // caller is ever left holding a scroll the router didn't place.
    const settle = () => {
      if (settleScroll) settleScroll();
      else if (fromY > 0) window.scrollTo(0, 0);
      // …and place the top bar while we're here. Note the spotlight path hands in
      // an EMPTY callback (parkCard already moved the window during renderFn), so
      // a branch that only ran "if we scrolled" would skip it.
      syncTopbar();
      // Again once the page has finished laying out — the same beat restoreScroll
      // re-aims over. Discover deals its masonry from JS and a photo swaps its
      // reserve box for its real shape, either of which can shorten the document
      // after we've already answered, turning a page that looked scrollable at
      // settle time into one with no gesture left to recover the bar. Only ever
      // shows it, so a late fire under a newer navigation is harmless.
      window.setTimeout(syncTopbar, SETTLE_MS + 120);
    };

    // Mount, THEN render — render code resolves its own nodes via
    // document.getElementById, so the page has to be in the document before
    // renderFn runs. replaceChildren also sweeps away anything an earlier
    // navigation left in the stage.
    view = page;
    // `.enter` is the only class that outlives the mount, and it does one job:
    // it is what the photo-snap rule in app.css looks for. A page arriving
    // complete in a single frame and then dissolving a wave of photos up
    // through itself is a move nobody asked for, and on a fresh grid it is the
    // densest burst of decoding bitmaps in the app. Held for one beat, then
    // dropped, so photos fade normally again for everything that arrives later.
    // Reduced motion needs neither this nor the freeze — CSS has stilled both.
    if (!reduce) page.classList.add('enter');
    stage.replaceChildren(page);
    renderFn();

    // Rows mounted BY a navigation do not play their entrance. This is the other
    // half of what the old fade was covering for, and without it "instant" just
    // relocates the wait: the page frame lands at once and then every card,
    // ledger row and tile on it rises for half a second afterwards, which reads
    // as the page assembling itself in front of you.
    //
    // Frozen inline rather than paused in CSS, so it survives the class drop and
    // the rows never replay the rise once the page settles — a CSS pause held
    // them at the rise's transparent first frame, and that blank window over the
    // near-white page was the old "white flash" on the card-heavy Circle.
    //
    // `.ptile` is the worst offender of the lot: Discover mounts its entire grid
    // at once, so arriving there once ran one rise per tile — measured at 87
    // concurrent animations on a 72-tile grid, on top of a burst of photo bitmaps
    // decoding, which is the pile-up behind the iOS WebKit crash. Discover is the
    // one page that hits it every single time you open it.
    //
    // Rows that arrive LATER without a page change (refreshWorld, the Updates
    // reconcile, a fresh post) are untouched and still rise in — that is a thing
    // happening, which is exactly what the entrance is for. Any new page-level row
    // entrance has to join this list.
    if (!reduce) {
      page.querySelectorAll('.card, .notif, .request-row, .ptile')
        .forEach(c => { c.style.animation = 'none'; });
      window.setTimeout(() => {
        if (token === navToken) page.classList.remove('enter');
      }, SETTLE_MS);
    }

    settle();
  }

  // Programmatic navigation. Setting location.hash to a NEW value fires a
  // `hashchange`, which already calls route() — so calling route() ourselves too
  // would render (and animate) twice, interrupting the transition. Only drive
  // route() directly when the hash won't actually change (same target).
  function go(hash) {
    if (location.hash === hash || (hash === '#/' && location.hash === '')) route();
    else location.hash = hash;   // hashchange → route()
  }

  /* ── Where you were ─────────────────────────────────────────────────────────
     Going back should return you to the paragraph you left, not to the top of a
     page you already read. That matters most on the two pages people go deep
     into and come straight back from — a long feed and Discover's grid — and it
     matters more now that the iOS app answers the edge-swipe, because a gesture
     that costs nothing gets used constantly and a page that resets every time
     punishes it.

     Position is remembered per HISTORY ENTRY, not per route, which is the whole
     distinction: tapping the Circle tab is a fresh visit and should land you at
     the top, while swiping back to the Circle you were reading is a return and
     should not. Both are '#/'. So each entry gets a key stamped into its own
     history state on first arrival, and the scroll is filed under that key —
     `location.hash` could never tell the two apart.

     Keys carry a per-load prefix, so entries stamped before a reload can't
     collide with this session's; a stale entry simply has nothing on file and
     lands at the top, which is the honest answer after a reload anyway. */
  const NAV_LOAD = Math.random().toString(36).slice(2, 8);
  const SCROLL_KEEP = 40;                 // entries remembered; a long session forgets the far past
  const scrollMemory = new Map();
  let navSerial = 0;
  let navHere = null;                     // the entry currently on screen
  // Circle and Discover hold their place across a TAB TAP, not just a back. The
  // key above is per history ENTRY, which is exactly right for a traversal and
  // useless for a tab: tapping Circle from Discover mints a NEW entry, so there
  // is nothing on file and you land at the top. These two are the pages you live
  // in and scroll deep, so they get a second memory keyed by PATH, consulted
  // only when the entry key has nothing.
  //
  // Deliberately just these two. You arrive at Updates and at a profile to read
  // them from the top, and a page that opens halfway down for a reason you can't
  // remember is worse than one that opens where it starts. The two ways out are
  // the ones that already existed and already say what they do: re-tap the tab
  // you're on, or pull the page down (which only arms at the top anyway).
  const TAB_SCROLL = new Set(['#/', '#/discover']);
  const pathScroll = new Map();
  // The browser's own guess fights ours (and WebKit's is wrong for a hash router
  // whose DOM is rebuilt after the navigation lands).
  try { history.scrollRestoration = 'manual'; } catch { /* older engine: ours still runs */ }

  // The key for the entry we're standing on, minted on first arrival. Whether it
  // was FOUND or MINTED is the whole back-vs-tap distinction: a key already
  // carrying one of this load's prefixes belongs to an entry we have stood on
  // before, so it has a scroll on file, while a key we have to mint is an entry
  // nobody has been on and lands at the top.
  function navStamp() {
    const st = history.state;
    if (st && typeof st.tk === 'string' && st.tk.startsWith(NAV_LOAD + ':')) return st.tk;
    const tk = NAV_LOAD + ':' + (++navSerial);
    try { history.replaceState({ ...(st || null), tk }, ''); } catch { return null; }
    return tk;
  }

  function rememberScroll() {
    // File the PATH we're leaving too. `lastPath` is still the outgoing route at
    // this point in route() — it isn't advanced until well below.
    //
    // Never from the gate, though: the signed-out branch returns before it
    // advances lastPath, so on a dropped session lastPath still names the authed
    // page the reader was on while the scroll on screen belongs to the login
    // form. Filing that would open the next person's feed part-way down.
    if (lastPath && TAB_SCROLL.has(lastPath) && !document.body.classList.contains('gate')) {
      pathScroll.set(lastPath, window.scrollY);
    }
    if (!navHere) return;
    scrollMemory.delete(navHere);         // re-set to move it to the fresh end
    scrollMemory.set(navHere, window.scrollY);
    while (scrollMemory.size > SCROLL_KEEP) scrollMemory.delete(scrollMemory.keys().next().value);
  }

  // Land where you left off, or at the top if this page is new to you. Two
  // memories, consulted in that order: this history ENTRY (a back or an
  // edge-swipe — exact, and it knows one '#/' from another), then the PATH (a
  // tab tap, which mints a fresh entry and so has no key on file). Only Circle
  // and Discover keep the second one; see TAB_SCROLL.
  //
  // The re-aim is for the pages that finish laying out a beat after they render
  // — Discover deals its masonry from JS, a photo swaps its reserve box for its
  // real shape — either of which can shorten the document under a scroll that
  // already landed. Any real input and we're gone; nothing here fights the
  // reader.
  function restoreScroll(key, path) {
    const filed = key ? scrollMemory.get(key) : undefined;
    const y = filed ?? (TAB_SCROLL.has(path) ? pathScroll.get(path) : undefined) ?? 0;
    if (!y) { scrollTop(false); return; }
    window.scrollTo(0, y);
    const moves = ['wheel', 'touchstart', 'keydown'];
    let frames = 0, stopped = false;
    const bail = () => { stopped = true; };
    moves.forEach(ev => window.addEventListener(ev, bail, { passive: true }));
    const again = () => {
      if (stopped || ++frames > 4) {
        moves.forEach(ev => window.removeEventListener(ev, bail));
        return;
      }
      if (Math.abs(window.scrollY - y) > 1) window.scrollTo(0, y);
      requestAnimationFrame(again);
    };
    requestAnimationFrame(again);
  }

  /* ── The back gesture, and why it needs nothing from us now ─────────────────
     The App Store build turns on WKWebView's edge-swipe (`allowsBackForward
     NavigationGestures` in TriaViewController.swift), and that gesture is not a
     passive input: WebKit takes over the screen for it, sliding a SNAPSHOT of the
     page you're going back to in from the left. Because Tria's routes are hash
     changes — same-document navigations — it drops that snapshot the instant the
     navigation commits, without waiting for anything to paint.

     While the router still drew a fade, that was a real bug and it needed a real
     special case: the live document at the moment the snapshot lifted was still
     the page you'd swiped away, so the move ended on the WRONG page snapping back
     to full opacity and then dissolving for a quarter second. Two transitions for
     one gesture, which reads as a reload. The fix was to render a traversal
     instantly, and telling a back from a tap to do it — which is the awkward part,
     because on this engine `popstate` fires for `location.hash =` as well, in the
     same `popstate → hashchange` order, so the two are byte-identical by event
     (measured, WebKit 26.5). It had to be derived from whether navStamp minted or
     found the history key instead.

     Every navigation renders instantly now, so the special case has dissolved
     into the general rule and both the detection and the fade are gone. Kept as a
     warning rather than as code: if a page transition is ever reintroduced, this
     is the bug it brings back with it, and `popstate` is NOT how to dodge it. */

  function route() {
    // File the outgoing page's scroll BEFORE anything renders — at this moment
    // window.scrollY is still where the reader left it, and renderPage is about
    // to reset it.
    rememberScroll();
    const arriving = navStamp();
    navHere = arriving;

    // Navigating away from Publish must stop a live camera/mic stream — the
    // capture surface's own DOM is about to be replaced, which wouldn't
    // otherwise release it (see wireFrameCapture's teardown). Same story for the
    // profile editor's cropper: its ResizeObserver and any frame it has queued
    // outlive the nodes the next render replaces.
    if (stopActiveCapture) { stopActiveCapture(); stopActiveCapture = null; }
    if (stopActiveCrop) { stopActiveCrop(); stopActiveCrop = null; }

    // Gate: no session → the setup / login screen, whatever the hash says.
    // The one exception is About, the public front door — reachable from a
    // link on the gate itself (it renders chromeless, with a way back).
    if (!Store.isAuthed()) {
      document.body.classList.add('gate');
      const gatePath = (location.hash || '#/').split('?')[0];
      // The signed-out front door is the ACCOUNT FORM, in every shell. It used to
      // be an install-first welcome ("add Tria to your home screen, then sign in
      // there") built to stop people signing in twice, since a Safari session
      // doesn't carry into a home-screen install. That page cost more than it
      // saved: it put a tutorial in front of a door, and in the App Store build
      // it was actively wrong — telling someone holding the download to go
      // install it from Safari, which is a 4.2/3.1.1 rejection besides. Tria now
      // opens the way every other social app does, on a form, with a populated
      // Discover one tap behind it. The install steps still live in the About
      // fold for anyone who wants the web app on their home screen.
      // No wash on either side of the gate any more. About used to carry a blue
      // one here so the front door read the same signed-out as signed-in; that
      // wash is retired along with the profile and daily ones (see
      // applyAmbient). The auth form's pastel comes from the gradient submit
      // button, which is now the only colour on the page and reads better for
      // having the field to itself.
      document.body.dataset.ambient = 'none';
      renderPage(() => {
        // A live recovery session (from the reset link) always wins: set-new-
        // password, whatever the hash says.
        if (Store.isRecovering()) return renderNewPassword();
        if (gatePath === '#/about') return renderAbout(true);
        // Signed out is the NORMAL way to arrive at the pricing page — it's the
        // page you send a business owner a link to, and asking them to make an
        // account to find out what an account costs is the joke that writes
        // itself. In the App Store build it doesn't exist at all (see the switch
        // below for why it's Apple's rule and not ours), so a deep link there
        // lands on About, which is where the fold used to point anyway.
        if (gatePath === '#/business') return nativeShell() ? renderAbout(true) : renderBusiness(true);
        // #/reset-password is the link's landing; with no recovery session it has
        // expired or been reused, so route them to request a fresh one.
        if (gatePath === '#/forgot' || gatePath === '#/reset-password') return renderRequestReset();
        if (gatePath === '#/confirmed') return renderConfirmed();
        return renderAuth(authMode);
      }, () => restoreScroll(arriving));
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
    // A friend view (#/u/…) matches nothing → nothing highlighted. The editor is
    // the one route that borrows another's highlight: it is somewhere you went,
    // but it is somewhere INSIDE your profile, so that tab stays lit rather than
    // the nav going blank while you edit.
    renderNav(path === '#/profile/edit' ? '#/profile' : path);

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
    // Discover's grid is laid out by JS, so it keeps a resize listener alive.
    // Drop it on the way out; renderDiscover re-arms one on the way back in.
    if (path !== '#/discover') discoverResizeOff?.();
    // A profile's frame wall is the same deal, so it keeps the same listener.
    if (!path.startsWith('#/u/') && path !== '#/profile') profileResizeOff?.();
    // And a daily's wall of answers, which is the same grid a third time.
    if (!path.startsWith('#/daily/')) dailyResizeOff?.();

    renderPage(() => {
      if (path.startsWith('#/u/')) {
        renderUser(decodeURIComponent(path.slice(4)));
        return;
      }
      // A daily lives at #/daily/<slug> — like a profile it highlights no nav tab,
      // because it's somewhere you went, not one of the four places you live.
      if (path.startsWith('#/daily/')) {
        renderDaily(decodeURIComponent(path.slice(8)));
        return;
      }
      switch (path) {
        case '#/':         renderHome(); break;
        case '#/discover': renderDiscover(); break;
        case '#/friends':  go('#/discover'); break;   // Friends folded into Discover; keep old links alive
        case '#/updates':  renderUpdates(); break;
        case '#/profile': renderUser(Store.session()); break;
        case '#/profile/edit': renderEditProfile(); break;
        case '#/publish': renderPublish(); break;
        case '#/about':   renderAbout(false); break;
        // #/business is browser-only, and the reason is Apple's rather than
        // ours: guideline 3.1.1 reads a price plus a way to act on it as a
        // purchasing mechanism, and an organization account is a thing that
        // exists INSIDE Tria, so a page naming three prices and pointing at the
        // feedback form is the exact shape the rule describes. The predicate is
        // nativeShell() and not installedShell() on purpose — this is a rule
        // about the App Store build specifically, and a home-screen PWA is not
        // something Apple reviews. In the app the route simply isn't there and
        // the link into it isn't drawn, so nothing dead-ends.
        case '#/business':
          if (nativeShell()) { go('#/about'); break; }
          renderBusiness(false); break;
        // #/support is retired — the header tray shares directly, and the note
        // from the designer it used to hold is gone. Old links land on About.
        case '#/support': go('#/about'); break;
        default:          location.hash = '#/';
      }
      // A spotlight has already parked the window on its card during the render,
      // so this navigation's scroll is done; anything else lands where you left
      // this history entry, or where you left this PAGE if it's Circle or
      // Discover reached by a tab tap, or at the top.
    }, spotlighting ? () => {} : () => restoreScroll(arriving, path));

    nudgeNav();           // installed shells: re-composite the nav's frosted layer
    // Deliberately NO background re-pull here: a refresh landing on the heels of
    // a navigation rebuilds rows under a page the reader has only just been
    // handed, which is unexplained movement. Refresh is always an explicit
    // gesture now — re-tapping the tab you're on, or pulling the feed down.
  }

  // WebKit sometimes drops the fixed, backdrop-filtered nav's layer after a
  // page's DOM is replaced, leaving it invisible until you scroll.
  //
  // This used to bail on `!navigator.standalone`, which named the shell the bug
  // was FOUND in rather than the engine that has it — and WKWebView is the same
  // engine, so the App Store build had the bug with the rescue switched off.
  // installedShell() covers all three shells; a browser tab still skips it,
  // which is all the original bail was really protecting. Rescue it GENTLY:
  // flick the frosted pill's
  // backdrop-filter off and back on, which rebuilds that dropped layer WITHOUT
  // pulling the element out of flow. The old fix toggled the nav's display, which
  // did the same repaint but also (a) cancelled the nav's own slide transitions
  // (the active-icon glide, the compose +) and (b) RESTARTED their CSS gradient
  // animation from 0% — so the colour loop visibly jumped to the start on every
  // page change. The backdrop flick leaves the slides and the gradient untouched.
  function nudgeNav() {
    if (!installedShell()) return;
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
    // Avatars are the whole roster, and that's fine — they're small, they're
    // circular crops, and every one of them is a face you might scroll past in
    // Discover's People pane. Photos are the opposite and this list used to hold
    // FORTY of them: uploads are downscaled to a 1400px long edge, so forty is
    // roughly ten megabytes over the wire and a quarter of a gigabyte of decoded
    // bitmap, all requested at launch, all competing with the handful of images
    // actually on the screen. Warming is supposed to make the next page arrive
    // whole; forty of them made THIS page arrive late. Ten covers what a first
    // screen of Home and a first screen of Discover can hold between them, which
    // is the entire job.
    //
    // And take them from the FRONT. `posts()` is newest-first, so `slice(-40)`
    // was reaching past every photo anyone might actually scroll to and warming
    // the forty OLDEST images on Tria — paying the entire bill above for the one
    // set of pictures nobody was about to look at.
    const WARM_PHOTOS = 10;
    const run = () => {
      Store.users().forEach(u => warm(u.avatar, true));
      Store.posts().filter(p => p.image).slice(0, WARM_PHOTOS).forEach(p => warm(p.image, false));
    };
    ('requestIdleCallback' in window) ? requestIdleCallback(run, { timeout: 2000 }) : setTimeout(run, 400);
  }

  /* ── Explicit refresh ───────────────────────────────────────────────────────
     Pulling the feed down quietly re-pulls the
     world — the page renders from cache instantly, and only if something
     actually changed does the view re-render, so new cards rise in with the
     usual entrance and an unchanged page never flickers. Plain navigation
     deliberately does NOT refresh (a re-pull landing mid-slide can rebuild rows
     under the transition); the world is otherwise refreshed at boot and on
     foreground. Nothing polls on a timer — a page you're reading stays put until
     you ask it for more, which is the whole point of a feed that doesn't chase
     you. */

  // Rows a re-render may splice in ABOVE what you're reading. Discover isn't
  // here: its grid rebuilds whole rather than splicing, and it guards its own
  // repaint with a signature (see paint) so a quiet re-pull leaves it untouched.
  const LIVE_ROWS = '#feed > .card, .notif-list > li';

  // Hold the reader's place across a render. A post that lands while you're deep
  // in the feed would otherwise shove everything down under your eyes — and
  // WebKit has no scroll anchoring of its own to catch it. So: note where the
  // topmost visible row sits, render, find that row again, and take the drift
  // back out of the scroll. At the very top there's nothing to hold (new cards
  // simply arrive where you're already looking), so it stays out of the way.
  function keepPlace(render) {
    const key = (el) => el.dataset.id ?? el.dataset.key;
    const anchor = window.scrollY > 0
      ? [...document.querySelectorAll(LIVE_ROWS)].find(el => el.getBoundingClientRect().bottom > 0)
      : null;
    const id = anchor && key(anchor);
    const was = anchor && anchor.getBoundingClientRect().top;
    render();
    if (id == null) return;
    const again = [...document.querySelectorAll(LIVE_ROWS)].find(el => key(el) === id);
    if (!again) return;
    const drift = again.getBoundingClientRect().top - was;
    if (drift) window.scrollBy(0, drift);
  }

  let refreshSeq = 0;
  let lastRefresh = Date.now();   // boot just loaded the world — don't re-pull it
  // Set by the pull-to-refresh module below, which owns the quintet ring. Null
  // until it initialises, hence the optional calls.
  let refreshRing = null;
  const nap = (ms) => new Promise(r => window.setTimeout(r, ms));

  // Decode a batch of photos BEFORE painting the rows that carry them, so a post
  // arrives whole rather than arriving and then developing. The browser holds the
  // decoded bitmap, so the <img> the card mints a moment later paints on its
  // first frame — the same mechanism warmImages leans on, aimed at the handful of
  // rows a refresh is actually about to splice in.
  //
  // Both bounds are the safety, not tuning. The CAP: these are 1400px photos off
  // a remote bucket, and a wait long enough to be worse than the pop is a refresh
  // that looks stuck — whatever hasn't decoded by then simply fades in the old
  // way, which is the behaviour we already shipped. The COUNT: a resume after a
  // week finds hundreds of new posts and only the first screen of them is about
  // to be looked at.
  const READY_CAP = 700;
  const READY_MAX = 6;
  function readyImages(urls) {
    const jobs = urls.slice(0, READY_MAX).map(url => {
      const im = new Image();
      im.decoding = 'async';
      im.src = url;
      return im.decode?.().catch(() => {}) ?? Promise.resolve();
    });
    if (!jobs.length) return Promise.resolve();
    return Promise.race([Promise.all(jobs), nap(READY_CAP)]);
  }

  // The caret is in a text field, so a refresh must not rebuild the card someone
  // is half-way through typing into.
  const typing = () => !!document.activeElement?.matches?.('input, textarea');

  // The route we still owe a paint for, and the reason a skipped paint has to be
  // remembered at all. `Store.refresh()` replaces the cache BEFORE anything gets
  // to decide whether to paint, so a paint we drop is NOT a paint postponed to the
  // next pull: the next pull diffs against the world that already moved, reports
  // nothing changed, and the screen stays behind PERMANENTLY, with nothing left to
  // trigger it. The debt is carried here instead and settled by the next refresh,
  // which paints on `changed || we owe one` rather than on `changed` alone.
  //
  // Deliberately not spent on blur, though the caret leaving is the obvious cue:
  // a field loses focus because you tapped something, and that something is
  // usually Post, so the app would repaint the feed out from under a write that
  // hasn't landed yet. Catching up on the next pull or foreground is the app's
  // normal cadence and nothing here polls, so waiting for one costs nothing.
  let owedPaint = null;

  // `force` marks a gesture you actually made (a tab re-tap, a pull): it skips the
  // spam guard, because a tap that visibly does nothing reads as a broken tap.
  // `hold` keeps your place across the render — right for a refresh that arrives
  // while you're reading, wrong for a re-tap, which is already taking you to the
  // top and would only fight the scroll.
  async function refreshWorld(path, { force = false, hold = true } = {}) {
    if (path !== '#/' && path !== '#/discover' && path !== '#/updates') return;
    if (!force && Date.now() - lastRefresh < 4000) return;   // tap-spam / boot guard
    lastRefresh = Date.now();
    const seq = ++refreshSeq;
    const changed = await Store.refresh();
    if (seq !== refreshSeq) return;                // stale response — a newer pull won
    if (!changed && owedPaint !== path) return;    // nothing new, and nothing owed
    warmImages();   // new friends/posts may have brought new avatars + photos
    await showWorld(path, { force, hold, seq });
  }

  // The paint half, split out because it can land later than the pull that earned
  // it: a paint skipped while a field had focus is held in `owedPaint` and run by
  // whichever refresh comes next, rather than discarded (see the note there).
  async function showWorld(path, { force = false, hold = true, seq = refreshSeq } = {}) {
    // Two of the three bails settle themselves. A newer pull owns the screen and
    // will paint or owe on its own; navigating away ends with the destination
    // rendering from the same fresh cache. Only a focused field ends with nothing.
    const here = () =>
      seq === refreshSeq
      && (location.hash || '#/').split('?')[0] === path;   // navigated away
    const live = () => here() && !typing();                // half-typed comment
    if (!live()) { if (here()) owedPaint = path; return; }
    const paint = () => {
      owedPaint = null;                                    // screen has caught up
      if (path === '#/') renderFeed();
      else if (path === '#/discover') { if (!discoverRepaint?.(force)) renderDiscover(); }
      else renderUpdates();
    };

    // The quintet is the app's ONE word for "the world is being re-pulled", so a
    // refresh nobody asked for borrows it rather than inventing a second
    // vocabulary. Coming back to a foregrounded app used to splice new rows in
    // with nothing on screen to explain them, and unexplained movement is
    // indistinguishable from a glitch — the ring is the difference between the
    // app updating and the app twitching. The pull already holds the ring
    // (refreshRing.on() declines while it does), so this only ever fires on the
    // silent path, and only when there is actually something to show: a resume
    // that finds nothing new (and owes nothing) never gets this far, which is
    // most of them.
    const ringOn = !!refreshRing?.on();

    // Photos on the rows this paint is about to splice in. Home only: Discover
    // rebuilds its grid whole and guards itself with a signature, and an Updates
    // row carries an avatar, which the roster warm already covers. The cache is
    // fresh by now and the DOM is not, so the difference between the two is
    // exactly what is about to appear.
    const onScreen = new Set(
      [...document.querySelectorAll('#feed > .card')].map(c => c.dataset.id));
    const incoming = path !== '#/' ? []
      : Store.feed().filter(p => p.image && !onScreen.has(String(p.id))).map(p => p.image);

    // Wait for those to decode before anything moves. Under the ring the first
    // 200ms of it is free — the ring needs that long to drop in regardless — so
    // the two run together and the paint waits for whichever finishes last.
    await Promise.all([readyImages(incoming), ringOn ? nap(200) : Promise.resolve()]);

    // Re-checked after the wait, because it is a real gap: the reader can have
    // navigated away or started typing a comment inside it.
    if (!live()) {
      if (here()) owedPaint = path;
      if (ringOn) refreshRing.off();
      return;
    }
    if (!ringOn) { hold ? keepPlace(paint) : paint(); return; }
    try {
      hold ? keepPlace(paint) : paint();
      await nap(500);                     // stay a beat after, so it reads as one event
    } finally {
      refreshRing.off();
    }
  }

  // Tapping the tab (or the brand) for the page you're already on scrolls back
  // to the top and clears any active filter/tag on Home. No `hashchange` fires
  // when the target matches the current route, so we catch it here. This is the
  // familiar bottom-tab-bar gesture on mobile, and that's ALL it is.
  //
  // It used to re-pull the world as well, which made it a second refresh sitting
  // beside the pull — and an invisible one, since nothing on screen says a tab is
  // also a reload button. The result was an app that seemed to refresh at random
  // moments the user hadn't connected to anything they did. Pulling down is the
  // gesture people already know and the one the indicator actually describes, so
  // it's the only one now. Nothing polls on a timer; the world is otherwise
  // refreshed at boot and on foreground.
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

  // The wordmark is the front door to About (My Circle in the nav is home);
  // tapping it while already there just scrolls back to the top.
  document.querySelector('.brand').addEventListener('click', (e) => {
    if ((location.hash || '#/').split('?')[0] === '#/about') {
      e.preventDefault();
      reclick('#/about');
    }
  });

  // The header tray IS the share, not a door to a page holding one. Native sheet
  // on mobile, clipboard copy on desktop — and the copy path gets a toast,
  // because a bare glyph has no label to flip to "Link copied" and a silent tap
  // reads as a dead button. A shared/cancelled result stays quiet: the OS sheet
  // already said its piece. Always the canonical URL, never location.href, so an
  // invite sent from a dev server or a deep route still points at Tria's door.
  document.querySelector('.share-tria').addEventListener('click', async () => {
    const result = await shareOrCopy({
      title: 'Tria', text: 'Join me on Tria', url: 'https://triaonline.com',
    });
    if (result === 'copied') toast('Link copied. Send it to someone good.');
  });

  window.addEventListener('hashchange', route);

  // The reading gesture half of the rule above: a thumb going down tucks the bar,
  // a thumb going up brings it back. Pure class-toggling — the transform and its
  // transition live in CSS and only apply at phone widths, so desktop (where the
  // bar is the sidebar's sibling brand rail) never moves. State is shared with
  // syncTopbar via barLastY, so a scroll the ROUTER placed can't be mistaken for
  // a direction the reader chose on the next real gesture.
  (() => {
    const topbar = document.querySelector('.topbar');
    barLastY = window.scrollY;
    let ticking = false;
    window.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        // The top of a page always wears its bar, however the window got there —
        // checked BEFORE the teleport guard, or a jump bigger than a viewport
        // (a long feed back to the top of a short page) takes the early return
        // and strands you at the top with no header and nothing to scroll up
        // against. Position beats direction: "hidden" is only ever a statement
        // about reading DOWN something.
        if (y < 48) { topbar.classList.remove('topbar--hidden'); barLastY = y; ticking = false; return; }
        // A teleport is not a reading direction. The router jumps the window in
        // one frame — to a spotlighted card, to a remembered position — and a jump
        // of a thousand pixels used to read as "scrolling down fast", so landing
        // on a post also slid the bar away: a second move stapled onto a
        // navigation that was meant to be one clean fade. A move bigger than the
        // viewport can't have come from a thumb, so take the new position and
        // leave the bar exactly as the reader last set it.
        if (Math.abs(y - barLastY) > window.innerHeight) { barLastY = y; ticking = false; return; }
        if (y > barLastY + 4) topbar.classList.add('topbar--hidden');
        else if (y < barLastY - 4) topbar.classList.remove('topbar--hidden');
        barLastY = y;
        ticking = false;
      });
    }, { passive: true });
  })();

  /* ── Pull-to-refresh ────────────────────────────────────────────────────────
     Standalone PWAs don't get Safari's native pull-to-refresh, so the feed
     pages grow their own. iOS's rubber band does all the physics: overscrolling
     at the top drives window.scrollY NEGATIVE, and that reading IS the pull —
     no preventDefault, no scroll hijack, and engines without the bounce simply
     never produce a negative scrollY (so this is inert on desktop). The
     indicator is the quintet: five dots, one per post type, drawn together at
     rest and spreading as the pull arms, then running a wave while the re-pull
     goes out. Reduced motion keeps the feature, drops the theatrics (CSS side).

     This is now the ONLY refresh gesture. Re-tapping the tab you were already on
     used to refresh too, which was a second, invisible way to do the same thing —
     nothing on screen said a tab was also a button, so the discoverable gesture
     was carrying the feature and the hidden one just made the app feel like it
     reloaded at random. The tab re-tap still scrolls you to the top and clears a
     filter; it simply no longer re-pulls the world. */
  (() => {
    const THRESHOLD = 72;
    let ptr = null, pulling = false, raf = 0, busy = false;
    const el = () => {
      if (!ptr) {
        ptr = document.createElement('div');
        ptr.className = 'ptr';
        ptr.setAttribute('aria-hidden', 'true');
        // Five dots, one per post type, in FILTERS order — note, find, photo,
        // activity, poll. The quintet already means "the five things Tria makes",
        // so a refresh is those five going round rather than a generic spinner
        // wearing brand colours. Colour and position both come from CSS
        // (:nth-child sets the hue and the dot's angle on the ring), not here.
        // The .ptr-ring wrapper exists only to carry the rotation, so the drop
        // and the turn stay on separate elements — see the CSS.
        ptr.innerHTML = '<span class="ptr-ring">' +
          '<span class="ptr-dot"></span>'.repeat(5) + '</span>';
        document.body.appendChild(ptr);
      }
      return ptr;
    };
    const herePath = () => (location.hash || '#/').split('?')[0];
    const eligible = () =>
      Store.isAuthed() && !busy
      && (herePath() === '#/' || herePath() === '#/discover' || herePath() === '#/updates')
      && document.body.style.overflow !== 'hidden';   // not under a lightbox/modal
    const draw = () => {
      raf = 0;
      if (!pulling) return;
      const d = Math.max(0, -window.scrollY);
      const box = el();
      if (d <= 0) { box.classList.remove('ptr--show', 'ptr--armed'); return; }
      const p = Math.min(d / THRESHOLD, 1);
      box.classList.add('ptr--show');
      box.classList.toggle('ptr--armed', p >= 1);
      box.style.setProperty('--ptr-p', p.toFixed(3));
      box.style.setProperty('--ptr-y', (Math.min(d, 140) * 0.72).toFixed(1) + 'px');
    };
    const onScroll = () => { if (pulling && !raf) raf = requestAnimationFrame(draw); };
    window.addEventListener('touchstart', () => {
      if (window.scrollY > 1 || !eligible()) return;
      pulling = true;
      window.addEventListener('scroll', onScroll, { passive: true });
    }, { passive: true });
    const finish = async () => {
      if (!pulling) return;
      pulling = false;
      window.removeEventListener('scroll', onScroll);
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      const d = Math.max(0, -window.scrollY);
      const box = el();
      if (d >= THRESHOLD && !busy) {
        busy = true;
        box.classList.add('ptr--spin');
        // Hold the page open under the ring while the re-pull runs (see the CSS).
        // Gesture only, never the silent path: this continues a movement the
        // finger already started, and the pull can only begin at the very top so
        // the space opens where there is nothing above to shove. A background
        // re-pull moved nothing and may find you anywhere down the feed, where
        // the same 56px would be the page lurching for no reason you could name.
        document.body.classList.add('ptr-hold');
        // Hold the churn a beat even when nothing changed, so the gesture
        // always visibly did something.
        try {
          await Promise.all([
            refreshWorld(herePath(), { force: true }),
            new Promise(r => setTimeout(r, 650)),
          ]);
        } catch { /* offline pull: let go quietly */ }
        box.classList.remove('ptr--spin', 'ptr--show', 'ptr--armed');
        document.body.classList.remove('ptr-hold');
        busy = false;
      } else {
        box.classList.remove('ptr--show', 'ptr--armed');
      }
    };
    window.addEventListener('touchend', finish, { passive: true });
    window.addEventListener('touchcancel', finish, { passive: true });

    // Lend the ring to the silent refresh path (see refreshWorld). `.ptr--spin`
    // alone is a complete state — opacity, the drop and the open radius are all
    // on that one class — so a programmatic show is the same three-frame move the
    // gesture ends with, easing in from the base rule rather than teleporting.
    // A real pull always wins: a finger on the glass, or a re-pull already in
    // flight, and this declines and the caller repaints without it.
    refreshRing = {
      on() {
        if (busy || pulling || !Store.isAuthed()) return false;
        busy = true;
        const box = el();
        // The very first show also CREATES the node, and creating it and classing
        // it in the same task means the browser only ever resolves style once,
        // with .ptr--spin already on — so there is no start state to transition
        // from and the ring snaps into place instead of dropping in. Resolve the
        // base state first. (The pull never hits this: draw() has been styling a
        // live element all the way down the rubber band.)
        void box.offsetHeight;
        box.classList.add('ptr--spin');
        return true;
      },
      off() {
        ptr?.classList.remove('ptr--spin', 'ptr--show', 'ptr--armed');
        busy = false;
      },
    };
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
          document.querySelector('.page.enter');
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
  // Skipped in the App Store build: that shell has neither of the two jobs a
  // worker does here. Its assets are bundled, so there is no stale HTML shell to
  // outrun, and its push arrives over APNs rather than through a `push` event —
  // a WKWebView can't register a worker from a custom scheme anyway, so this was
  // only ever a rejected promise being swallowed.
  if (!nativeShell() && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then(reg => {
      const poke = () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); };
      document.addEventListener('visibilitychange', poke);
    }).catch(() => { /* push + shell-refresh simply stay off */ });
  }

  /* ── A tapped notification, in the app ──────────────────────────────────────
     sw.js's `notificationclick` handler is the web's half of this and can't run
     in the App Store build (see above), so the bridge answers the same question:
     a tap lands you on the page the payload names, defaulting to Updates, which
     is where every notification Tria sends is accounted for.

     Only the hash is honoured. The payload carries a relative URL because the web
     worker needs one to call `clients.openWindow` with; here the document is
     already open and the router reads the hash, so anything else in that string
     is not ours to navigate to.

     Registered at boot, before anything else touches the route, because the
     plugin RETAINS this event until something consumes it — a cold launch from a
     notification fires it the moment the listener exists, which is how a tap on a
     closed app still lands on the right page rather than the home feed. */
  if (nativeShell()) {
    try {
      window.Capacitor.nativeCallback('PushNotifications', 'addListener',
        { eventName: 'pushNotificationActionPerformed' }, (ev) => {
          if (ev?.actionId === 'dismiss') return;
          const url = String(ev?.notification?.data?.url || '');
          const hash = url.slice(url.indexOf('#'));
          location.hash = /^#\//.test(hash) ? hash : '#/updates';
        });
    } catch { /* no listener; a tap just opens the app where it was */ }
  }

  // If the recovery event lands after the first paint (it usually resolves during
  // init, but the URL parse is async), re-route so set-new-password takes over.
  Store.onRecovery(route);

  // Load the world from Supabase before the first render (this resolves any
  // persisted session too). On failure we still route — straight to the gate.
  Store.init().then(() => {
    route();
    warmImages();   // decode avatars + recent photos up front so navigation is flash-free
    // Native push housekeeping, after init because it needs the signed-in user:
    // read the OS permission into the cache the push UI renders from, and if push
    // is already on, re-register — APNs tokens rotate, and a stale one fails
    // silently (Apple just says Unregistered, the phone says nothing at all).
    Store.pushResume();
  }).catch((err) => {
    logError('boot failed', err);   // caught, so no global handler would see it
    route();
  }).finally(dismissSplash);
})();
