# Tria — working notes for Claude

A social app for small circles of friends. Tagline "Social media made local."
Ethos: low-tech, non-addictive, anti-bloat. It promotes context (long posts read
well), not an infinite feed.

**Tria is an iOS app.** It is built out of vanilla HTML/CSS/JS with a tiny hash
router — **no framework, no build step** — bundled into a Capacitor 8 webview.
The same files also serve a website; that is a byproduct, not a target. See
[docs/shipping.md](docs/shipping.md).

## Where things are

- `index.html` — shell, boot splash, fonts, the `?v=` asset stamps.
- `css/tokens.css` — design tokens. `css/app.css` — everything else.
- `js/store.js` — the data layer (in-memory cache of the whole world).
- `js/app.js` — the whole app: router, every view, modals, composer.
- `js/config.js` — Supabase URL + publishable key + VAPID key (safe to commit).
- `ios/` — the Capacitor app: `App/` (Swift, entitlements, Info.plist),
  `CapApp-SPM/` (CLI-managed), `verify-plugins.sh`.
- `supabase/` — `schema.sql` (canonical) + additive migrations + `PUSH-SETUP.md`.

## 1.4 is the chrome going native

The nav — tab bar, compose **+**, the top bar's buttons — becomes real UIKit in
the system's Liquid Glass, around the webview that still draws every page. The
web keeps its CSS glass unchanged. Plan, contract and traps:
[docs/native-chrome.md](docs/native-chrome.md).

**All three stages have landed** (`ios/App/App/TriaChromePlugin.swift`,
`NativeChrome` in app.js, the gate at the end of app.css): the tab bar, the +,
and the top bar's controls with the menus they drop as real `UIMenu`s. So do the
menus a control on the PAGE drops — the post card's •••, the repost circle, the
profile's colour ring — which the web asks for rather than being asked about,
and which fall back to the sheet they always were off-app.

The TWO PIECES THAT HOLD A CARET are native too, and they are the one place
native is more than a face: a field cannot be borrowed from a hidden element, so
the `UITextView` in a post page's COMMENT BAR and the `UITextField` in
DISCOVER'S SEARCH are real, and every keystroke is written back into the web
element that is still the model. Both also needed a way DOWN off the keyboard
built by hand (`TriaKeyboardDismisser`) — a tap on the page reaches a page with
no focus to lose — and the comment bar's leading avatar turns into a discard
mark while you type. The mention picker stays web (a list of friends is app
vocabulary), and so does the find bar.

The top BAR's MATERIAL is native too, and it is real `UIGlassEffect`, not a
hand-painted copy of the CSS: the copy read as fog, and the system's own scroll
edge effect provably cannot be reached from a Capacitor webview (it draws in the
inset Capacitor pins to zero). One pane, three of its four specular rims pushed
off-screen, collapsing to the status strip when the bar tucks away. Its TITLE
had to follow it native — glass is a layer above every web pixel, so a web-drawn
title under it was blurred — which is why the app ships `oxygen-700-latin.ttf`
beside the woff2 and registers it with CoreText at runtime. **Replace the web
font and you must convert the TTF too.** Native is a RENDERER: app.js holds the
route, reads the bar off its own DOM, measures every control and the title and
sends the rects, and native puts glass and type there and hands taps back. The CSS chrome is the default and stays the fallback —
`html[data-chrome="native"]` goes up only after the plugin answers, so an old OS
or a plugin that failed to compile in navigates exactly as 1.3 did.

## The loop

Change → `./bump.sh` → `./ios-sync.sh` → headless boot pass → simulator
screenshot → hand to Zoe (**she reviews on her phone, on the real build — there
is no live preview**) → commit and push to `main` **after** the iOS work.

## Rules that are load-bearing

- **Bump, then sync, every time a css/js/html file changes** — in the same turn,
  without being asked. The webview loads a bundled copy, so an unsynced change is
  silently absent from the app. Verify by grepping the bundle.
- **Never edit `www/` or `ios/App/App/public/`** — generated.
- **Run the headless boot pass** for any `app.js`/`store.js` change; `node
  --check` is not enough. A simulator run is a separate gate.
- **Nothing sits uncommitted.** The gitignored bundle is not a backup, and this
  repo has lost work that way twice.
- **Every cache write goes through `write()`** ([docs/data.md](docs/data.md)), or
  a refresh in flight silently eats it.
- **Never read `Notification.permission` in app.js** — it throws in the app. Go
  through `Store.pushPermission()`.
- **No badge, anywhere** — not in `aps`, not on the nav, not on a native tab.
- **Every control that awaits the network hands itself back on *every* path**,
  rejection included.
- **Ask all three shells, not one** — `nativeShell()` vs `installedShell()`, and
  CSS reads `html[data-shell]` rather than re-deriving it.
- **Verify before repeating that a migration is pending.** This file records
  intent; the dashboard holds the truth, and migration state is checkable
  read-only over PostgREST. The APNs `.p8` key is the one open item and the one
  thing REST cannot reach.

## Copy style

User-facing copy uses commas and periods, **no em dashes** (code comments are
exempt). Voice is playful but not trying-too-hard.

## The reference docs

Read the one that covers what you are touching. They carry the reasoning, the
measurements, and the approaches that were tried and taken out — reach for them
before re-deriving a decision.

- [docs/native-chrome.md](docs/native-chrome.md) — 1.4's native UIKit chrome.
- [docs/shipping.md](docs/shipping.md) — bump, sync, gates, git, what the web is.
- [docs/ios-shell.md](docs/ios-shell.md) — Capacitor, the three shells, haptics,
  outbound links, push and APNs, UIScene, plugins in the binary, the app icon.
- [docs/data.md](docs/data.md) — Supabase, the cache and its write journal,
  audiences and the two interaction gates, friends, reposts, the post page,
  dailies, Discover, activity reminders, the guest list.
- [docs/design.md](docs/design.md) — the design system: liquid glass and its two
  tiers, the pastel quintet, the brand band and reader accents, the toolbar,
  dials and menus, the composer, the wash, corners, targets.
- [docs/navigation.md](docs/navigation.md) — page changes have no transition,
  scroll memory, spotlights, the back gesture.
- [docs/views.md](docs/views.md) — pull-to-refresh, the refresh ring, and why a
  row waits for its photo.
