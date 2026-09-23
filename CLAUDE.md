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
- `supabase/` — `schema.sql` (canonical) + additive migrations + `PUSH-SETUP.md`
  + `OAUTH-SETUP.md`.

## 1.7 is chats, activities and the public site

Zoe's answers, the calls Claude made, and the three stages:
[docs/1.7.md](docs/1.7.md). **Chats replaced Updates as a tab**; Updates is the
pinned first row of the chat list and still lives at `#/updates`. The message
bar is the comment bar (`mountPostBar(null, chat)`), so it needed nothing new in
Swift. Every rule about who may message whom is in `supabase/add-chats.sql`.

## Signing in is three doors now (2026-09-22)

Email and password, **Continue with Apple**, **Continue with Google**. Apple and
Google are a package and not a menu: App Store **4.8** requires a privacy-
preserving option alongside any third-party sign-in, Sign in with Apple is it,
so Google may not ship without Apple and neither may go out alone.

**Apple is native, Google is a browser sheet**
(`ios/App/App/TriaAuthPlugin.swift`). Apple because the web flow asks for an
Apple ID password on a device already signed in to one, and because the native
credential is the ONLY place Apple ever says the person's name. Google because
Supabase is the OAuth client and not this app, so an SDK would buy nothing.

**A provider sign-in makes no profile row**, and that is the whole design. Tria's
identity is an `@handle` and neither provider has one, so `handle_new_user`
returns early with no username in the metadata and the app lands in a THIRD
STATE: an auth session with nobody behind it (`Store.pendingProfile()`,
`renderClaimHandle`, `claim_profile` in `supabase/oauth-signin.sql`). Do not mint
a provisional handle — the reasoning is at the top of that file. Note the trap
`usersFresh` guards: a failed `users` read looks exactly like a missing profile,
and getting it wrong meets a reader of two years with *pick a username*.

**The migration is run; the dashboard half is not.** `supabase/OAUTH-SETUP.md`
is what is left: Google Cloud, three Apple registrations, the redirect allow
list. This is the rare backend gap that is NOT silent, and every remaining
misconfiguration says the same thing, "That way in isn't switched on yet."

## 1.4 is the chrome going native

The nav — tab bar, compose **+**, the top bar's buttons — becomes real UIKit in
the system's Liquid Glass, around the webview that still draws every page. The
web keeps its CSS glass unchanged. Plan, contract and traps:
[docs/native-chrome.md](docs/native-chrome.md).

**All three stages have landed** (`ios/App/App/TriaChromePlugin.swift`,
`NativeChrome` in app.js, the gate at the end of app.css): the tab bar, the +,
and the top bar's controls with the menus they drop as real `UIMenu`s. Edit
profile's music pick drops a `UIMenu` too — a control on the PAGE, which the web
asks for rather than being asked about, and which falls back to a sheet off-app.
**The post card's •••, the repost circle beside it (2026-08-30) and the
profile's colour ring (2026-09-10) went back to the web sheet** in the app as
well (`openPostMenu`, `openRepostMenu`, `openAccentSheet` in app.js) — they no
longer try a native menu at all; the colour ring because the sheet shows the
colours off and a menu row can't. See "A menu the page asks for" in
[docs/native-chrome.md](docs/native-chrome.md).

So do the page's own PRIMARY ACTS: the auth gate's submit and **Share Tria**.
Those sit in content that SCROLLS, which is why they could not be native until
now — each one crosses with its position in the document and native tracks the
web view's own `contentOffset`, clipped to the band between the bars. "Not
native, ever: content" still holds and always meant what a reader READS; the one
button on a page that commits was never that. **The set is closed** — `PAGE_SEL`
in app.js is a list of selectors, not a rule about buttons, and it only gets
shorter. **The composer's Share pill and the daily card's Add yours left it
(2026-09-19)** and are painted CSS again on every shell: glass does not stack,
and both of those sit ON glass, where a second lens samples a backdrop the first
has already flattened and reads as a flat patch.

**The band crosses as one of three things**, sorted off the stops themselves
(`bandFill`): a reader's accent is one colour and tints the glass, Tria's own
ramp is four and stays a thinned gradient UNDER the material, "no colour" sends
nothing and the button is plain glass wearing the system's `.label`. Only a tint
carries its own ink; the other two take `.label`, which is how the same code is
black on paper and white on ink. **The round + is the one control that turns
Tria's ramp down** and takes it as no colour: four hues need a capsule to travel
across, and a 56pt disc is not one. Every capsule still wears it. **On "no
colour" the + and Add yours on the BAR wear the neutral** (`--mono-band` as a
tint, `--mono-ink`, see `monoWear` in app.js), the paper's opposite, rather than
plain glass; Share Tria and the gate's submit stay plain, and the two painted
commits wear the same neutral in CSS.

The PIECES THAT HOLD A CARET are native too, and they are the one place native is
more than a face: a field cannot be borrowed from a hidden element, so the
`UITextView` in a post page's COMMENT BAR, the `UITextField` in a circle's FIND
BAR and the one in DISCOVER'S SEARCH are real, and every keystroke is written
back into the web element that is still the model. All of them needed a way DOWN
off the keyboard built by hand (`TriaKeyboardDismisser`) — a tap on the page
reaches a page with no focus to lose — and the comment bar's leading avatar turns
into a discard mark while you type. The comment bar and the find bar are ONE
class doing two jobs (`kind` swaps the two ends and the field, nothing else); the
find bar was left web at first, on the argument that it had no growth and no send
to gain, and that looked at the wrong half of the bar — what makes the class
necessary is that the bar sits ON the keys. The mention picker stays web (a list
of friends is app vocabulary) and is the only thing that does.

**And the PAGE has to answer the keyboard too** (2026-09-18). The bar rode the
keys and the page under it did not, so the last screenful of a thread sat behind
them with no way to scroll to it. A keyboard raised for a NATIVE field is
invisible to the web view — `visualViewport` reports the same height either way
— so the plugin measures it (one observer, `keyboardInset`, the reach past the
safe area) and app.js does two different-sized things with it: a RESERVE on
`#view` on every route, which makes covered content reachable, and a SHIFT
clamped to what is actually covered, only while one of our own bars holds the
caret. See "What the keyboard stands on" in [docs/native-chrome.md](docs/native-chrome.md).

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
- **No COUNT, anywhere** — not in `aps`, not on the nav, not on a native tab.
  What the rule refuses is a NUMBER: something that climbs while you are away
  and asks to be driven back to zero. A DOT is allowed, on the Chats tab only
  (it answers for Updates and for chats since 1.7), and it is one: it cannot climb, there is nothing to be behind on, and it clears
  by looking. Zoe's call, 2026-09-09. See `updatesAreNew` in app.js and
  `setDots` in `TriaChromePlugin.swift`; the dot wears `--dot`, the reader's
  own colour.
- **Every control that awaits the network hands itself back on *every* path**,
  rejection included.
- **Ask all three shells, not one** — `nativeShell()` vs `installedShell()`, and
  CSS reads `html[data-shell]` rather than re-deriving it.
- **Verify before repeating that a migration is pending.** This file records
  intent; the dashboard holds the truth, and migration state is checkable
  read-only over PostgREST — call the RPC with its REAL signature, because a
  wrong one answers PGRST202 whether or not the function exists. **`chat-roster.sql`
  is confirmed run** (2026-09-19): live `remove_chat_member` raises "That chat has
  no guest list.", a string that exists only in that file. Two open items REST
  cannot reach: the APNs `.p8` key, and whether the deployed Edge Function is
  current. It carries its own copy of the audience rule twice, so `supabase
  functions deploy swift-processor` has to follow chat-roster.sql or reminders and
  the calendar feed will name a different set of people from the app's guest list.
  **The folder is `push`, the deployed slug is `swift-processor`** (PUSH-SETUP.md);
  a GET on it answers `ok` but says nothing about which revision is live.
  **`oauth-signin.sql` is confirmed run** (2026-09-22): live `claim_profile`
  answers `28000 "You need to be signed in."`, a string that exists only in that
  file, against a bogus control still answering PGRST202. `claim_profile` is the
  LAST thing in the script, so the `handle_new_user` rewrite above it ran too.
  The rest of provider sign-in is dashboard state REST cannot see at all; see
  `supabase/OAUTH-SETUP.md`. **`public-friend-counts.sql` is NOT run**
  (2026-09-22): anon `GET /rest/v1/friends?select=a,b&limit=3` answers `[]` while
  `users` answers rows, so the policy is the missing half. Until it is run, every
  friend count on the web reads 0; the app is unaffected (it reads as
  `authenticated`).

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
