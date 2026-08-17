# Tria — working notes for Claude

A social web app for small circles of friends. Tagline "Social media made local."
Ethos: low-tech, non-addictive, anti-bloat. The app promotes context (long posts
read well), not an infinite feed.

## Stack
Vanilla HTML/CSS/JS with a tiny hash router. **No framework, no build step.**
Real multi-user backend on **Supabase** (Auth + Postgres + Storage).

- `index.html` — shell, boot splash, font/manifest links, the `?v=` asset stamps.
- `css/tokens.css` — design tokens. `css/app.css` — everything else.
- `js/config.js` — Supabase URL + publishable key + VAPID public key (safe to commit).
- `js/store.js` — the data layer (in-memory cache of the whole world; sync reads, async writes).
- `js/app.js` — the whole app: router + every view + modals + composer.
- `sw.js` — push-only service worker (caches nothing, on purpose — see below).
- `supabase/` — `schema.sql` (canonical) + additive migrations + `functions/push/` + `PUSH-SETUP.md`.

## Building & Running it
Zoe previews on her **VSCode Live Server** — she strongly prefers seeing changes
live over screenshots, so default to letting her preview. For design changes that she is unable to preview directly, generate an artifact (ask before). Any static file server works (e.g. `python3 -m http.server`); Supabase is remote, so there's nothing to run locally beyond serving the files.

`?demo` in the URL (e.g. `/?demo#/updates`) is a preview aid — it currently forces
the push pre-prompt card to show regardless of permission state. Handy for showing
UI that's otherwise state-gated.

## Deploy
GitHub Pages serves `main` root; every push to `main` auto-redeploys (~1 min).
Push straight to main — no PRs or feature branches.

**That includes while a build is in review, and the reasoning changed on
2026-08-01.** There was a freeze here: 1.0 went to the App Store on 2026-07-30,
and because there is one branch and the app is a bundled copy of the same files,
a commit to `main` *is* a web deploy — so review-window work was landing on a
branch to keep the web from shipping. That exception is **retired**. The web
deploys again on the normal cadence, and everything from the lightbox zoom
(`v=339`) onward accumulates toward **1.1**.

What made the freeze stop earning its keep is the bundle. The App Store build
carries its own copy of these files, so a web deploy cannot reach a phone that
has 1.0 installed and cannot change what a reviewer is looking at — the two
shells were already independent for the length of a review, which is the thing
the branch was being used to simulate. So the cost was real (a branch to
remember, a merge to not forget) and the protection was not.

What that leaves: a change still ends with `./ios-sync.sh` and still gets its
`?v=` bump, because the bundle carries the stamp that ships — bump, sync, commit,
push. And **the review queue is still the release cycle for iOS**: work merged
today reaches phones when 1.1 is submitted and approved, not when it lands. Which
is why nothing should sit uncommitted in a working tree (that has bitten this
project before — see the iOS-shell tree that went a month without a commit): the
gap between "done" and "on a phone" is now measured in App Store builds, so the
repo is the only place the work is real in the meantime.

**The one ritual:** any deploy that touches a css/js file MUST bump the `?v=N`
stamp — the same number on all five asset lines in `index.html`. Use the script:

```sh
./bump.sh        # increment by 1
./bump.sh 70     # set an explicit number
```

The stamp busts HTTP caches AND drives the self-updater in app.js (it refetches
index.html on launch/foreground and reloads when the `app.js?v=` number changed),
which is how friends on home-screen installs get updates. `sw.js` caches nothing
so it won't fight this. Docs/tooling changes (this file, README, bump.sh) don't
touch assets, so they don't need a bump.

## The iOS app
**This is the product now.** Submitted 2026-07-30, in review. The web was the
whole app for a year and is now the second shell: it stays live, it stays
correct, and it stops being where features land first. A change that helps the
web and not the app is not a priority; a change that can only be *seen* on the
web (a hover state, a desktop breakpoint) is worth doing only when it's free.
When the two shells disagree about what's right, the app wins — that inverts the
rule this file carried until now, and most of the iOS notes below were written
under the old one, so read them as "here is what the third shell costs" rather
than "here is the exception to the web."

Same files, third shell. `ios/` is a **Capacitor 8** wrapper whose webview loads a
**bundled copy** of the site — `ios-sync.sh` mirrors the web assets into `www/`
(gitignored; Capacitor rejects a `webDir` of `"."`, which is the only reason that
folder exists) and runs `cap sync`. **Run it after every css/js/html change, in
the same turn as the change** — not "before opening Xcode", which was the rule
while the app was something Claude built occasionally and is now a way to leave
Zoe testing yesterday's bundle (see the sync gate under Before you call an
app.js/store.js change done). Bundled, not `server.url` pointing at triaonline.com: a thin
wrapper around a live URL is the clearest reading of guideline 4.2 "repackaged
website", and it shows a blank screen on a bad network, which review does test.
The cost is real and worth naming — **the `?v=` self-updater is a no-op in the
app** (it refetches the bundled index.html and finds the same stamp), so iOS
users only get changes through a new App Store build. So **the app sets the pace
and the web keeps its push-to-main cadence** — the two are decided separately,
and the priority ordering above is about which shell a change is *for*, not about
holding the web back. A change lands on `main` and is on the web in a minute; it
reaches a phone when the next build is approved. Since 2026-08-01 the ones piling
up are **1.1** (see Deploy).

**Tria now runs in three shells, and code that asks "am I installed?" has to name
all three.** There are **two** predicates in app.js and they answer different
questions. `nativeShell()` is "am I the App Store build?" — Capacitor injects its
bridge before any app JS runs, so `window.Capacitor.toNative` is the tell, no UA
sniffing. `installedShell()` is the broader "am I installed rather than a browser
tab?", and it has to OR all three dialects together, because **each shell answers
in exactly one of them**: the native app has the bridge, an iOS home-screen PWA
has `navigator.standalone`, every other installed PWA reports `display-mode:
standalone`. Asking only one is therefore always a bug in the other two, and it
shipped twice — `.statusbar-scrim` was gated on `@media (display-mode:
standalone)` (dead in the App Store build, which reports `browser`), and
`nudgeNav()` bailed on `!navigator.standalone`, naming the shell the WebKit
layer-drop was *found* in rather than the engine that has it. WKWebView is the
same engine, so the native app carried the bug with the rescue switched off.

**CSS must never re-derive this** — `display-mode` is the one dialect the native
app doesn't speak. `installedShell()` stamps `html[data-shell="installed"|
"browser"]` once at boot and stylesheets read the attribute. It exists because the native app has **neither** `navigator.standalone`
(Safari-only) **nor** `display-mode: standalone` (Capacitor's webview reports
plain `browser`), so the signed-out gate read it as a browser and opened the App
Store build on *"Add Tria to your home screen — Tria lives on the web, so there's
nothing to download."* Nonsense to someone holding the download, and a 4.2/3.1.1
rejection. The same predicate hides the About install fold. Any future "you're in
a browser" branch has to consult it.

**Haptics speak to the bridge directly** (`haptic()` → `hapticTap` /
`hapticEvent`). `@capacitor/haptics`' tidy `registerPlugin` wrapper is an ES
module and Tria has no build step, so app.js calls
`Capacitor.toNative('Haptics', …)` instead — identical wire format, fire and
forget, no promise per tap. Three rules: they fire on the **confirmed change**,
never the touch (the buzz means "that landed", which is worth feeling; "you
touched glass" the finger already knew), the **one exception** being a danger row
in `openSheet`, which is a warning *about* what's coming; LIGHT is for something
that stays on screen and MEDIUM for something that lands in the real world, the
same split as `canSocial` vs `canJoin`; and they are **not** gated on
prefers-reduced-motion, unlike the sparkles — a haptic isn't motion, iOS has its
own system switch that `UIFeedbackGenerator` obeys before we hear about it, and
someone who turned the animations down has lost their tap confirmation, so the
buzz is worth more to them. Silence must stay a correct outcome: on web, on
desktop, with haptics off, nothing may depend on one firing.

"Confirmed change" is why the **filter dial** taps from inside `openFilterDial`
and not from its three `onPick` callbacks: the dial is the one place a pick from
the home feed, Discover and a profile shelf all pass through, and it is also the
only place that still knows what the filter *was*. Picking the row that already
wears the checkmark repaints nothing, so it stays silent — a buzz there would be
the phone confirming a write that never happened, which is the whole thing the
haptic is supposed to mean.

**Outbound links need a plugin, because a WKWebView will not open a window.**
`window.open` returns null and a `target="_blank"` anchor is completely inert —
it doesn't navigate, doesn't hand off to Safari, does nothing. That silently
killed the primary action of three post types (a Find's title and note link, an
activity's map pin) and made the Privacy Policy link on the signup form a dead
tap. Two fixes, and they're different: internal hash routes just **drop
`target="_blank"`** (a new tab was only ever a second copy of the app), while
external `http(s)` links are intercepted by a delegated capture-phase click
handler and handed to **@capacitor/browser**, which presents
SFSafariViewController *over* Tria with a Done button. Tria is not "running in
Safari" — it stays underneath, and the reader lands back on the same card. Any
new outbound link inherits this for free; a new *internal* one must not carry
`target="_blank"`.

**Push is two transports behind one switch, because a WKWebView has no Push
API.** Not a degraded one — absent. `PushManager` is undefined, `Notification` is
undefined, and a worker can't be registered from a custom scheme, so the entire
web push path is unreachable in the App Store build. Nothing errored when that
shipped: `Store.pushSupported()` answered false and every piece of push UI
correctly hid itself, which is why push simply *wasn't there* in the app rather
than broken in it. The app registers with **APNs** instead
(@capacitor/push-notifications), and the split lives entirely in store.js — the
pre-prompt card, the profile toggle, the Edge Function's fan-out and the
`push_subscriptions` table are all shared.

Only the ADDRESS differs, and **the address is the platform column**: an APNs row
is `endpoint = 'apns:<hex token>'` with empty keys, which is the whole reason iOS
push needed **no migration**. The sender branches on that prefix; RLS, uniqueness
and the per-user index all still mean what they meant.

**And the plugin has to actually BE in the binary, which is a different fact from
being in `package.json`.** Capacitor resolves `packageClassList` through the
Objective-C runtime when the bridge starts, so a class that was never compiled is
simply not found, and the whole symptom is one line in the device log at the
moment somebody taps: `Error loading plugin PushNotifications for call. Check
that the pluginId is correct`. Nothing fails at build time. That is what was
wrong for three weeks. `CapacitorPushNotifications` was added to CapApp-SPM's
`Package.swift` on 2026-07-29; the Swift package graph cached in DerivedData was
a day older, Xcode never re-planned it, and so the target was never compiled — no
`PushNotificationsPlugin.o`, no `CapacitorPushNotifications.build` intermediate,
no class in the app. Browser and Haptics were added before that cache froze and
linked fine, which is why push was the only casualty and why every layer below it
read clean under inspection: the AppDelegate forwards, the entitlement, the
`apns:` row and the JS were all correct the entire time, and none of them were
ever reached. **1.0 and 1.1 both shipped without the push plugin in them.**

The fix is deleting DerivedData. The reason nobody has to *remember* that is
`ios/App/verify-plugins.sh`, a build phase on the App target that `nm`s the
linked binary for every class in `packageClassList` and fails the build naming
the one that isn't there. It reads the generated
`ios/App/App/capacitor.config.json`, so it covers every plugin the CLI knows
about, present and future, and it costs one `nm` per build. If it ever fires, the
answer is DerivedData, not the Swift. Two notes for anyone editing it: user
script sandboxing is **on** in both configurations, so anything it reads has to
be declared in the phase's `inputPaths`, and a Debug build keeps its Swift in
`App.debug.dylib` rather than in `App`, so both get scanned.

**When you do clear DerivedData, clear only this project's folder.** There are at
least three Xcode projects called `App` on this machine — this one, one under
`The Archive`, one under `_Personal/Tria` — so their DerivedData folders differ
only by hash and `rm -rf DerivedData/App-*` takes all three. Read
`<folder>/info.plist`'s `WorkspacePath` to tell them apart; the failure message
prints the right path for you.

Four things about it are load-bearing:

- **`AppDelegate` must forward the two APNs callbacks** to
  `.capacitorDidRegisterForRemoteNotifications` /
  `…DidFailToRegister…`. APNs hands its answer to the app delegate and nowhere
  else, and the plugin only listens on NotificationCenter — without the forwards
  `register()` resolves happily, the `registration` event never fires, and the
  toggle turns on and does nothing. This is the failure with *no* symptom.
- **Never read `Notification.permission` in app.js** — it throws in the app. All
  three shells go through `Store.pushPermission()`, which returns the same three
  words from a cache primed at boot (there is no synchronous read of
  `UNUserNotificationCenter`, and the push UI renders synchronously).
- **Tokens rotate** (restore from backup, reinstall), and a stale one fails
  silently — Apple says Unregistered to the *server*, the phone says nothing. So
  `Store.pushResume()` re-registers on every launch and drops the old row.
- **Sandbox vs production is not in the token.** A build installed from Xcode
  registers with APNs sandbox, TestFlight and the App Store with production, both
  off the same `aps-environment: development` line in `App.entitlements` (codesign
  rewrites it at distribution signing). The sender tries production and retries
  sandbox on `BadDeviceToken` rather than making anyone pick.

**The permission prompt is ONE SHOT per install, and that is a dead end the app
has to carry a door for.** `UNUserNotificationCenter.requestAuthorization` shows
its alert exactly once ever; after it's been answered, either way,
`requestPermissions` resolves instantly with **no UI at all**. So a reader who
tapped "Don't Allow" once — or who switched Tria off under Settings later — lands
in a state where the profile's Notifications switch cannot do the thing it names:
no prompt appears, the switch stays off, and iOS will never ask again. That's the
same class of bug as the inert `target="_blank"` link, and it reads to the user as
"notifications are broken" rather than "notifications are denied". Diagnosing it
from the code is a trap, because **every layer tests clean**: the bridge, the
plugin, the AppDelegate forwards and the `registration` event all work, and
`enablePush` correctly returns `blocked: true`. The old copy then named a place
("you can turn them on in your settings") the app was able to open but wasn't
offering to.

So `blocked` now opens a sheet with a route in it, via **`TriaSettings`**, Tria's
own one-method Swift plugin (`TriaSettingsPlugin.swift` →
`UIApplication.open(openSettingsURLString)`), reached by
`Store.openAppSettings()`. Three things about it: it **must** be native —
`location.href = 'app-settings:'` is completely inert in the webview (measured;
Capacitor's navigation delegate hands off `http(s)` and leaves other schemes
alone) and @capacitor/browser is SFSafariViewController, which takes web URLs
only. It lives in the **app target**, so it is registered by hand from
`TriaViewController.capacitorDidLoad` — `packageClassList` in
`capacitor.config.json` is CLI-generated from `package.json` and `ios-sync.sh`
would overwrite an entry added there. And it's **native-only on purpose**: a
browser's permission is re-askable from site settings the reader already knows,
so on the web the words are still the whole answer.

Both `enablePush` callers also wrap the round trip in `try/finally`. The switch
disables itself while it waits, and a **throw** (the Supabase write at the end is
a bare network call that can reject) would skip the re-enable and leave the switch
dead for the life of the modal with no toast either — a control that does nothing,
forever, from one unlucky tap, which is indistinguishable from the denied state
above.

Deliberately kept: **no badge.** `aps` carries no `badge`, and
`presentationOptions` is `["banner", "sound"]` — the omission of `"badge"` from
that list is the load-bearing part, so don't "complete" it. Updates has no count
on the nav and no dot on the tab — it tells you nothing until you choose to look
— and a number on the app icon is that badge by another route. What the two
words that ARE there buy is the foreground case: the list was unset until 1.2,
which the plugin reads as "present nothing", so a notification arriving while
Tria was open was delivered silently and only discoverable by going to look for
it. A banner is not ambient pressure the way a badge is — it says something just
happened and then it leaves.
See `supabase/PUSH-SETUP.md` for the .p8 and the secrets, which only Zoe can do.

**The app icon is an Icon Composer file, and the build setting has to name it.**
`ASSETCATALOG_COMPILER_APPICON_NAME = TriaAppIcon`, not `AppIcon` — the
`AppIcon.appiconset` still holds Xcode's default blue placeholder, and while that
setting pointed at it, the icon that would have shipped was the template. Apple
rejects the stock Xcode icon, and it's the one thing nobody proofreads because
everyone assumes the designer's icon is the icon. Check `CFBundlePrimaryIcon` in
the built Info.plist, not the Xcode sidebar.

A **simulator run is a separate gate from the headless boot pass** and catches
what it can't — the install-tutorial bug was a clean Chromium boot and a clean
`BUILD SUCCEEDED`. Build, install, launch, screenshot. The simulator has no
haptic hardware, so a bridge call can only be verified as *resolving*, not as
felt; do that by probing from the gitignored `www/` copy (never the source), and
regenerate with `ios-sync.sh` after.

## Before you call an app.js/store.js change done
Run a headless boot pass — `node --check` alone once shipped a runtime
ReferenceError (a name deleted but still referenced in a template literal parses
fine). Launch Chromium (Playwright is cached locally), listen for `pageerror` and
console errors, load the page, assert `#view` has content and there are zero
errors. This is a correctness gate separate from Zoe's visual preview.

**Then sync the app, every time — Zoe now tests on the real iOS build.** Any
change touching a css/js/html file ends with `./ios-sync.sh`, in the same turn,
without being asked. It is not an Xcode-day chore any more; it is the second half
of "done", the same way the `?v=` bump is. The reason is the one named under The
iOS app: the webview loads a **bundled copy**, so the self-updater cannot reach
it — an unsynced change is simply absent from the app, and it is absent
*silently*. Nothing errors, nothing looks stale, the old build just runs. That
failure is indistinguishable from "Claude's change didn't work", which puts Zoe
debugging a fix that was never on the device. Order matters: **bump first, then
sync**, so the stamp the bundle carries is the one that shipped. Verify by
grepping the bundle rather than trusting the script's output — `grep` the new
stamp in `ios/App/App/public/index.html` and a name from the diff in
`ios/App/App/public/js/app.js`. Never edit anything under `www/` or
`ios/App/App/public/` (both are generated; `www/` is gitignored) — the one
exception is the haptics probe described above, which reads from that copy on
purpose and regenerates after.

**Pull down is the only refresh.** Five dots, one per post type in `FILTERS`
order, arranged on a **ring**, riding the iOS rubber band: JS reads the negative
`window.scrollY` and drives `--ptr-y`/`--ptr-p`, CSS turns progress into
**radius** — the five sit stacked at 2px at rest, reading as one small object,
and the ring opens out of that point to 12px as you pull, so a fully open ring
*is* the "let go now" signal rather than a separate pop. Then the whole ring
turns while the re-pull goes out. It was a horizontal row doing a stagger wave
first, and the wave was wrong for the job: five dots counting left to right is a
*progress bar's* gesture and this is an indefinite wait, which every platform
draws as something going round. The ring reads as an ordinary spinner at a glance
and is still unmistakably the quintet up close. Spin `linear`, never `--ease` (an
eased spinner lurches once per turn and the lurch reads as a stall). The drop and
the turn live on **two elements** (`.ptr` and `.ptr-ring`) because an animation on
`.ptr` would beat the transition that settles it into place, snapping the drop.
Flat pastel, not the lit dome (that's reserved for the FAB and the Post pill, and
at 7px a specular hotspot is mud). Re-tapping the nav tab you're already on used
to refresh too; it now only scrolls to top and clears a filter. Two refreshes was
one too many, and the hidden one was doing the damage — nothing on screen says a
tab is also a reload button, so the app seemed to reload at moments the user
couldn't connect to anything they'd done.

**The ring is the app's only word for "the world is being re-pulled", so the
silent refresh borrows it rather than inventing a second one.** Pulling is the
only refresh *gesture*, but it isn't the only refresh: coming back to a
foregrounded app re-pulls too, and that path used to splice new rows in with
nothing on screen to account for them. Unexplained movement is indistinguishable
from a glitch — the ring is the whole difference between the app updating and the
app twitching. `refreshRing.on()/off()` (exposed by the pull module, driven by
`refreshWorld`) shows the same quintet with no finger involved: it lands first,
the page changes under it, it stays a beat, so the whole thing reads as one event.
Two guards keep it from becoming noise — a real pull always wins (`on()` declines
while one is in flight), and it only fires when the pull actually **changed**
something, so a resume that finds nothing new is completely silent, which is most
of them. `.ptr--spin` therefore has to remain a *complete* state on its own
(opacity, the 44px drop and the open 12px radius all on that one class); it used
to only ever be added on top of `.ptr--show`. And `on()` forces a style flush
before adding it, because the first show also creates the node and doing both in
one task gives the browser nothing to transition from — the ring would appear
instead of dropping in.

## Copy style
User-facing copy uses commas and periods, **no em dashes** (code comments are
exempt). Voice is playful but not trying-too-hard.

## Backend notes

**One owner-side step is outstanding, and shipping raised the stakes on it.**
The backend is code in this repo but *state* in Zoe's dashboard, and the client
is deliberately tolerant of a database that hasn't caught up — which means a
missing step has no error, no log and no symptom except a feature quietly not
being there. That was survivable while the only users were us. It is not
survivable in a build strangers are installing, because "it doesn't work" is now
a review, so treat it as a release blocker rather than a chore:

- **The APNs `.p8` key** (`supabase/PUSH-SETUP.md`) — until the key exists and
  `APNS_KEY_ID` / `APNS_TEAM_ID` / `APNS_PRIVATE_KEY` are set as function
  secrets, **push in the App Store build is silent**. Everything on the device
  side is built and verified: the toggle turns on, the token registers, the row
  lands in `push_subscriptions` with its `apns:` endpoint. The fan-out simply has
  nothing to sign with. Nobody is notified and nothing complains.

It has no client-side fix and Claude cannot do it; if a report looks like
"notifications are broken", check this before reading code. (The other recurring
not-a-bug is the one-shot iOS permission prompt — see the push section above.)

**`supabase/friend-declines.sql` HAS been run** (confirmed 2026-08-13), so
follows are announced on Updates and *Ignore* writes a durable row. It sat in
the list above long after it was done, and got re-raised as a blocker while
prepping the 1.1 submission — this file records intent, the dashboard holds the
truth, so **verify before repeating that something is pending.** Claude has no
DB admin, but migration state is checkable read-only through PostgREST with the
publishable key in `js/config.js`, because the select list is validated against
the schema *before* RLS: a missing table is `404 PGRST205`, a missing column is
`400 42703`, and a table that exists but filters an anonymous caller is `200 []`.
An empty array is proof the thing EXISTS. Run a bogus table and column alongside
as controls. The `.p8` key is the one thing this cannot reach — Edge Function
secrets aren't readable over REST, so say it's unverified rather than asserting
it either way.

- Login is by **email**; username is the public handle. Email confirmation is off.
- The Supabase service key was rotated/deleted, so **only Zoe has DB admin** —
  Claude can't run SQL or clear accounts. Migrations in `supabase/*.sql` are run
  by her in the dashboard; `schema.sql` folds them all in for fresh installs.
  **Careful with `create or replace function` in a new migration** — a rewritten
  `can_view_post` once silently dropped the block gate a previous migration had
  folded into it (see `restore-block-gate.sql`). When you touch that function,
  restate *every* clause it's accumulated, and re-read the current definition
  first rather than layering on an older copy.
- **Every cache write goes through `write()`, and that is what stops your own
  post vanishing.** `loadWorld` replaces every table wholesale from reads issued
  before it resolved, so a write that lands while a pull is in the air was
  overwritten by rows that predate it: the comment saved, the foreground refresh
  already in flight landed, and the comment was gone from the cache while sitting
  in the database. It was silent twice over — nothing errors, and `refresh()`
  compares against the world as it was before *both*, so it reported "nothing
  changed" and didn't even repaint; the row stayed on screen until something else
  rebuilt that card and then quietly wasn't there. It needed a load in flight,
  which is why it was intermittent, and loads are invisible: the app re-pulls
  every time it foregrounds, which is exactly what picking a photo or answering a
  push does. So `write(key, fn)` journals what it did for as long as any load is
  in flight and `loadWorld` **replays** those writes over the world it fetched —
  what you did while we were waiting is newer than anything we read. Replay is
  only safe because every write is idempotent: removals are filters, additions go
  through `upsert` (same identity replaces, never appends a second), because the
  read may or may not have caught the new row and both have to end the same way.
  A row mutated **in place** is therefore also out — it's a change with nothing to
  replay. `worldGen` is the other half: signing out throws the world away, and a
  load still in the air must be dropped rather than repopulate the app of someone
  who just left.
- **Private likes** are enforced at the data layer: RLS hides other authors' like
  rows, so the cache can't compute someone else's count. **Headcount/RSVPs are
  public** by design. A read that errors keeps its **last good copy** (`core()` in
  loadWorld) — headcount, poll votes and post_audience were the three tables
  missing that guard, so one failed read emptied every RSVP and vote in the app.
- **Friends are directed edges, and one edge means two different things.** A lone
  `a → b` row is a *follow* when b is public (immediate, nothing pending) and a
  *request* when b is private (waiting on b). Mutual is always friendship. Which
  one it is depends on the TARGET's privacy for outgoing edges and on MY privacy
  for incoming ones — so a public account has no friend requests at all, only
  followers. `store.js` splits this in one place (`outgoingEdges`/`incomingEdges`
  → `following`/`followers`/`requestsSent`/`requestsReceived`); don't re-derive it
  per view. Following buys exactly one thing: that account's **public** posts join
  your home feed. Their circle posts stay circle business until you're mutual, and
  the DB agrees — `can_view_post`'s circle branch needs both edges.
- **An add is an EVENT, and only a request is a chore.** Both halves of that were
  wrong until July 2026, and both failed the same way: a row on Updates that
  nothing could ever clear. Followers were drawn as a standing block above the
  ledger with an "Add back" button — but on a public account nothing is pending
  and nothing needs answering, so being followed left a permanent item on your
  page. A follow is now an ordinary ledger row (`notifications()`, `kind:
  'follow'`, dated from **`friends.created_at`**) that ages down the list beside
  the likes; the pinned block holds requests and nothing else. Two rules keep it
  honest: an edge with **no stamp is never announced** (the migration deliberately
  leaves existing rows null, or the day it ran would dump your whole circle at the
  top of everyone's Updates), and adding someone back **doesn't retract their
  row** — a line that deletes itself when you answer it is the same bug wearing
  the opposite coat. Meanwhile *Ignore* was a delete, and a deleted edge answers
  nothing: the same person re-adding you put the request straight back. It writes
  **`friend_declines`** now (`Store.declineRequest`), which suppresses the row,
  the push, and the accept state on their profile, forever and silently — quiet by
  design, like a block, and cleared only if you add them yourself. Both live in
  `supabase/friend-declines.sql`; the client tolerates a DB that hasn't run it
  (unstamped edges just stay quiet, declines fall back to a localStorage mirror).
- **Two interaction gates, not one** (`app.js`). The split isn't cheap-vs-costly,
  it's *stays on the screen* vs *lands in the real world*. `canSocial` (likes,
  comments, **poll votes**) is open on your own post, a friend's, *or any public
  post* — Discover only builds relationships if strangers can react, and a poll
  made public is asking the wider room. `canJoin` (RSVP/headcount,
  add-to-calendar) is activities-only and stays friends-only on purpose: a public
  activity carries a place and a time, so anyone may see it but only your circle
  shows up to it. The store guards every write behind the matching rule; keep the
  two in sync.
- **Audience is per-post authoritative** (`posts.audience`, one of `public` /
  `circle` / `list`; see `supabase/post-audience-public.sql`). `can_view_post`
  decides reads from the post's own tag: public → everyone · author → self ·
  list → the `post_audience` allowlist · circle → mutual friends only. `circle`
  means friends-only for EVERY account, public ones included. Any post type can
  be made public, activities included.
- **Discover is the whole room, not the public square.** Its grid shows every
  post you're allowed to see that isn't yours: strangers' public posts *and*
  your circle's circle posts, in ONE grid (no bands). `Store.discover()` mirrors
  `can_view_post` client-side rather than trusting the cache to have been
  filtered. Hand-addressed (`list`) posts are the one exclusion, and they fold
  back in for SEARCH, which also drops the per-person cap: a browsing courtesy
  must never hide the thing someone is hunting for. The grid is
  **chronological** (the About page's promise) and only *nudged*, never
  re-sorted: a face that just appeared waits a slot or two, nobody holds more
  than 3 tiles, and the nudge yields back to time order rather than drifting
  (`spaced` in app.js). Its masonry columns are **dealt by JS** (`layoutGrid`),
  because CSS `columns` fills column one to the bottom first and would turn a
  chronological list into parallel timelines side by side; CSS owns only the
  count, via `--cols` — 2 on a phone, 3 from tablet, and **3 is the ceiling** (a
  4-up shipped for an afternoon and came out: it only fits if the page abandons
  `--feed-width` for the full content box, and 196px tiles wrap the name beside
  its avatar). Note every breakpoint here reads the VIEWPORT while the grid lives
  in the column left over after the 268px sidebar, which is why 681–899px is
  pinned back to 2: three columns there
  made a tile *narrower* than the same tile on a phone. **Discover's paint is the
  app's hottest path** — a repaint is a full rebuild, and search doubles the grid
  (no cap, hand-addressed folded in). Keep it cheap: `notePlain` is memoised
  (a rich note costs a DOMParser document, and this walks every post), haystacks
  are cached per post object, `Store.discover()` is pooled per paint, scoring
  happens once per tile rather than inside the sort comparator, and typing paints
  on a trailing `SEARCH_BEAT` rather than per keystroke. Five **trending tags** head the page, each a shortcut
  into search. A **post** tile shows the person's **name only, no @handle** —
  there it's a byline, and a handle under every one of them is the same fact
  twice — while a **portrait** tile prints the handle under the name, because
  there the person is the content and nothing else on the tile tells one Sam
  from the other. Search matches handles either way. A tile speaks the post's
  **caption**, falling back to its title only when there is no caption. Its filter dial carries one row Home's can't
  (`DISCOVER_FILTERS`): **People**, directly under All, which drops every post and
  gives each account the portrait tile, alphabetically — the directory answer to
  "I know roughly who I'm after", since the browse grid is chronological and
  capped so a quiet account sits a long way down it. People takes **no pastel**
  (the quintet is reserved for post types) and its masthead dot is ink. Search
  under it still reaches post text via `saidBy`, so hunting by interest works on a
  page of faces.
- **A profile carries the same dial, and Frames is a wall.** Between the identity
  card and the posts sits the **profile shelf** (`.profile-shelf`): a tracked
  micro-caps caption naming the pane below, with `filterBtnEl` at its right — the
  masthead's own arrangement borrowed for a page whose masthead is a photograph.
  Flat editorial, never glass (it captions content; a second frosted bar under
  the frosted card is two panes with nothing between). Three rules make it a
  profile filter rather than a copy of Home's: its rows are **derived from what
  that person actually posted** (All + only the present types, in `FILTERS`
  order — no dead ends, no People row), the whole shelf is **absent** when
  there's nothing to narrow (one type and one layout isn't a choice; a single
  photo still earns it), and **Frames swaps the layout** — that person's
  photographs dealt into the same masonry grid Discover uses, at their real
  aspect ratios. That ragged edge is the point: a square contact sheet flattens
  a portrait and a landscape into one brick, and Tria stores photos uncropped so
  it doesn't have to. A wall tile is the **face and nothing else** (no foot, no
  byline, no counts — every tile is the same person), and it carries the real
  `?p=<id>` deep link, so the wall is an *index into* a long profile: a tap drops
  back into the post column with that card spotlighted. `profileFilter` resets
  whenever you land on a different person, and a pending spotlight or open editor
  always forces the column. Both grids share `dealMasonry`, `mediaFaceEl` and
  `wireFrameFades` at module scope — one grid, two callers, no second set of
  breakpoints. (`.pgrid--frames` needs an explicit `width: 100%`: `.pgrid`
  centres with `margin-inline: auto`, and an auto cross-axis margin cancels the
  stretch inside `#feed`'s flex column, which collapsed every `flex: 1 1 0`
  column to nothing.)
- **A daily is a question, and answering it is just posting.** One prompt for the
  whole room, 24h, heading Discover as a coloured glass card and opening a page
  washed in a hue. An answer is an **ordinary post carrying a `daily-<slug>`
  tag**, which is why the feature needed no table, no migration and no new privacy
  rule: answers inherit the audience rules, the edit path, the profile column and
  search for free. **The schedule is an array** (`DAILIES` in `app.js`) rotating
  from `DAILY_EPOCH` in local time, so N prompts is an N-day loop with no server.
  Seventy (was 21 until 2026-08-16) is **a multiple of 7 and that is the
  load-bearing part**: every prompt keeps a permanent weekday, which is the whole
  scheduling tool (cheap Mondays, Thursday is always the Find, Friday is
  argumentative, Sunday lands soft). Day 0 is a **Tuesday**, so a row's weekday is
  its index mod 7 from there (Thursdays ≡ 2, Mondays ≡ 6) — count from the epoch's
  weekday, not the top of the list; **grow it a whole week at a time**, and if the
  epoch moves, **rotate the array by the same number of days** or every role
  slides. **Space the rotation by `kind`, never by `type`** — every prompt accepts
  every type, so `type` describes the answer's filing, not the ask, and it was
  only ever a proxy. `kind` is what the prompt costs the reader (`retrieval` it
  already exists · `report` one sentence from your head · `errand` you have to go
  get it), and the first 21 days priced them: **retrieval 8.3 answers, report 6.7,
  errand 4.6**. Hence **at most one errand a week** and **never three of one kind
  in a row** (two is fine; the original complaint was four photo prompts in a
  row). A retrieval must point at something *chosen* — never-delete scored 13,
  desk scored 3. A post resolves its prompt **by slug**,
  never by recomputing `day % length` (`dailyForPost`): the old derivation made
  the array's *length* immutable, since changing it remapped every past day and
  silently stripped the question off every answer ever posted. Deleting a row
  still retires its label, so retire by moving out of the rotation, not out of the
  array. **The named type is a default, not a requirement** (`dailyAccepts`, the
  one home of the rule, read by the submit gate to decide whether the tag rides
  along): any non-activity type answers any prompt. It used to be binding, with
  `accepts: 'any'` as a per-prompt waiver — every prompt waives it now, so the
  named `type` is just the colour. The composer no longer pre-aims at it either:
  answering a daily opens a plain Note like any other compose (it used to raise
  the photo/link/poll surface the prompt's type implied), and the Post/Activity
  switcher is dropped from that flow entirely — an activity was the one thing a
  daily never took, and with it gone the only choice left is what to attach, so
  a caption ("Answering the daily") sits over the question in plain grey rather
  than a colour that has nothing left to signal. Since any type answers any
  prompt, the Discover card can't wear the one colour it's asking for either, so
  it carries all three question types dailies use at once — a fixed
  lavender→coral→cyan gradient, same on every card. The page it opens now
  **drifts** through the same three (`daily-drift`, 24s — a daily's own unit is
  its 24-hour window), a registered `--glow-daily` interpolating smoothly rather
  than a plain custom property; reduced motion freezes it on the prompt's own
  hue, which is also the frame it opens on before the drift starts. The tag an
  answer wears matches the card now too — same fixed gradient, not the prompt's
  nominal hue — so every surface of the feature but two agrees: the composer
  banner and the detail page's kicker are the plain-grey holdouts, having
  nothing left to signal once nothing is ever blocked.
  **Activities are excluded from every daily**, open ones included:
  an activity lands in the real world behind `canJoin`'s friends-only gate, and a
  page of answers from the whole room is the wrong doorway to that. **Polls are
  excluded editorially, not structurally** (`type: 'poll'` still works) — every
  other prompt asks for a thing you already have, a poll asks you to author a
  question. One answer each, window-scoped, so a prompt coming round again opens
  empty rather than on last month's replies. Daily tags are held out of the
  trending rail (`topTags`) and out of the tag chips (`DAILY_TAG_RE`,
  `shownTags`) — the question shows in place of the slug, as a link to everyone
  else's answers. **Never add:** streaks, push for the daily, a missed-day
  counter, a leaderboard. The 24h window plus a coarse timer is the whole
  pressure budget; each of those will look like an obvious improvement and each
  one turns an invitation into a chore.
- **A daily answer never touches your audience.** The composer opens on its normal
  default and the answer goes wherever your account sends things, so a private
  account's answer reaches its circle and not the daily page. That thins the page
  on purpose: nudging someone public because they answered a prompt would be the
  app quietly widening an audience the user chose, which is the one thing this
  app doesn't do. The cold-start answer is seeding by hand, not a default change.
- **`users.private`** (defaults true, so new signups open closed) no longer gates
  reads at all. It does three things: picks the composer's default audience (a
  public account's posts default to `public`, activities stay `circle`-first),
  shows non-friends the "add them to see posts" nudge on a private profile —
  softened when that person has public posts to show — and decides whether a
  one-way edge is a follow or a request (see above).
- Post photos are stored at native aspect ratio (not cropped); only avatars crop
  (circular). Push notifications: see `supabase/PUSH-SETUP.md`; the Edge Function's
  real slug is `swift-processor`, not `push`.

## Design system (short version)
Austere, editorial, cool greyscale base. The only chromatic color is a pastel
quintet reserved for the five post types: note = lavender, find = coral,
photo = cyan, activity = lime, poll = rose. Instrument Serif on titles only; Oxygen everywhere
else. Circular avatars. Don't touch the hue-drift gate wash — Zoe loves it. All
motion is reduced-motion aware.

**Liquid glass — the material rule.** Frosted glass (translucent fill + backdrop
blur + hairline border + specular rim + float shadow) is reserved for the layer
that *floats above* content, never for content itself. **The whole recipe is
tokens** (`css/tokens.css`) — `--glass-bg`/`--glass-bg-panel`,
`--glass-blur`/`--glass-blur-panel`, `--glass-filter-panel`, `--glass-rim`,
`--glass-edge`, `--glass-lift`/`--glass-lift-panel`. A surface names its tier and
inherits the rest; **dark mode is answered once, in the tokens**, so a glass rule
with its own `prefers-color-scheme` block restating a fill or a rim is a
regression. Before this was tokenised the "one" material was really nine, with
fills from 62% to 88% and rims from `#fff 12%` to `40%`, each hand-rolled beside
its own dark-mode copy.

**The two tiers are about what's BEHIND a surface, not what it's called.** A
`backdrop-filter` only costs anything when its backdrop *changes*, so the bill is
area × radius × moving-frames:

- **chrome** (`--glass-blur`, 15px, no `saturate`) — fixed over a feed that
  scrolls under it: top bar, nav pill, seg-tabs, search, share disc, daily card.
  Re-samples every frame of every scroll, so it stays lean.
- **panel** (`--glass-filter-panel`, 30px + `saturate(1.7)`) — over a page that's
  frozen behind it: modals, sheets, the mention popover, the lightbox. Samples
  once and holds, so it can afford the depth that actually reads as glass.

That's why the daily card takes a **panel-grade fill over a chrome-grade blur**:
it carries a serif question, but it sits in Discover's normal flow with a grid of
photographs re-sampling behind it. Cost follows the backdrop, not the component.

`--glass-blur` is the **heat knob**, and it has been dialled both ways: it was 24
until the July 2026 battery pass took every surface to 8 and dropped `saturate()`
outright (phone-heat, and the real culprit was thirty surfaces re-rasterizing
during scroll). 15 + a thinner fill is the settlement — the scroll-hot tier stays
well under its old value, and the depth went where nothing moves. If a device
runs warm, that one line is the fix; don't re-flatten the fills.

**Fill is thin, blur is deep — never the reverse.** A 62–88% fill behind an 8px
blur is the inverse of every native material and is precisely why glass can read
as frosted *plastic*: you're meant to see content through glass, and the blur is
what stops it competing with the text, not the fill.

**The rim is a perimeter, not a top line.** `--glass-rim` is two insets at
opposite offsets (bright top-left, faint bottom-right), because native glass
lights its whole edge and varies around it. A single `inset 0 1px 0` is a lit
*lip* — one bright edge and three dead ones. Costs nothing either way; a
box-shadow is not a filter.

Content lists — the feed, comments, your profile's circle roster — stay flat
editorial rows. The Friends *modal* (a popover) is
glass; a *roster* of people (your profile's circle) is flat — that split is
correct, not inconsistent (mirrors iOS: lock-screen notifications are glass,
Contacts rows are not). **The masonry grid is the one glass-minus-blur surface**
(Discover's, and a profile's frame wall): its tiles float above the page so the
material is right, but a `backdrop-filter` is per-element compositor work and a
scrolling masonry grid is exactly where that bill lands, so they keep the fill +
`--glass-edge` + `--glass-rim` + float shadow and drop only the sample-and-blur.
**The daily card is the one piece of glass that carries a hue.** The colour is the post type the
prompt asks for, straight from the quintet — a daily wanting a Frame is cyan on
the card, on the chip an answer wears, and in the page wash behind it, so the
colour still says *what to make* rather than a sixth hue meaning "daily". On phones the Updates view
switcher (seg-tabs) is docked chrome, not an inline row: it floats just above
the bottom nav and *rises up from behind it* when a page becomes active (router
tucks it while the page fades in, releases it on settle). The composer's
Post/Activity switcher is the one seg-tabs that stays inline — it's excluded by
`:not(#c-group-tabs)` wherever the router tucks them. The bottom nav hugs the
home indicator (small float, iOS Liquid Glass style), not lifted into the screen.

**Bars get the scroll edge effect, not a hairline.** `.topbar` and `.auth-topbar`
are a vertical gradient — heaviest at the very top (that band is the safe-area
inset, i.e. exactly where the OS clock and battery need something to read
against) and thinning toward the bottom edge, so content dissolves *into* the bar
instead of hitting a wall. The gradient **is** the edge, so `border-bottom` is
gone: a hard 1px rule under a fading bar draws the one line the effect exists to
remove. This is also why the bar does most of the status-bar scrim's work while
it's on screen — the scrim still matters because `.topbar--hidden` takes all of
it away on scroll-down.

**Corner scale:** 3px incidental (`--radius`) · 8px small containers
(`--radius-img`) · 12px composer inputs (`--radius-field`) · 14px photos + glass
menus/cards (`--radius-card`) · 18px nav rail (`--radius-nav`) · 20px glass
modals (`--radius-modal`) · 999px pills (`--radius-pill`). **Nested corners are
concentric:** a child that reaches its parent's corner takes the parent's radius
*minus* the padding between them, so the two curves stay parallel instead of the
inner one bending tighter. That's `--radius-row` (a menu row inside a 14px panel)
and `--radius-row-lg` (a sheet row inside a 20px one), both derived from
`--pad-panel` so the pair can't drift apart. It only applies when the child
actually reaches the corner — a form field 1.6rem inside a modal is nowhere near
it and keeps its own radius. The pastel `publish-fill`
gradient stays reserved for the primary publish/share action — don't spread it
to every button, or it stops meaning anything.

**Never glass on glass.** One material at a time: both dial discs
(`.filter-dial-ico`, `.nav-dial-ico`) sit on a veil that already blurs the frozen
page, so neither carries a `backdrop-filter` of its own — a second sample per disc
is redundant work fighting the stagger transform each row animates through. The
modal *veil* + card is the one deliberate exception (iOS does the same with a
dimmed backdrop under a sheet).

**Lit dome — the primary-action material.** The two hero commit buttons — the
compose **+ FAB** (`.nav-publish`) and the composer's **Post** pill
(`.composer-post`) — aren't flat pastel discs: the drifting quintet sits under a
fixed lit dome (top-left specular hotspot + base cavity shadow + contact/ambient
float) so they read as glossy 3D objects with a real, non-wandering light source
(only the colour band drifts; the highlight/cavity stay pinned). **Dark mode
carries the volume with light, not shadow:** the black cavity + drop shadows all
but vanish on a dark surface, so dark brightens the hotspot and adds a crisp lit
top rim instead. Keep the colour-band scale (`300%`, 2–3 hues in view) identical
across modes — only the gloss is scheme-tuned; redeclaring the `background`
shorthand silently resets `background-size`, so always restate it.

**Page changes are ONE fade, and only that.** Every route swap mounts the
destination fully opaque and dissolves the outgoing page away on top of it, 0.24s
(`--dur-quick`, mirrored by `TRANSITION_MS`), no direction. **One ramp, not two,
and that distinction is load-bearing.** It was a true cross dissolve until July
2026 and the flash people kept reporting was not a mistimed animation, it was
arithmetic: two ramps crossing means neither layer is opaque in the middle of the
move, so the composite is `0.5·out + 0.25·in + 0.25·PAGE BACKGROUND`. A `.page` is
a transparent div, so that quarter of bare `--bg` barely moves the frame's mean
luminance and instead lands entirely on the ink — measured, the arriving page's
type sat 31 luminance points lighter at the midpoint than under one fade. The
destination *arrived washed out* on every single navigation. Fading only the
outgoing layer holds coverage at 100% throughout, and halves the promoted layers
while it's there (only `.page.leave` gets `will-change`). Pages used to slide
along a nav line (forward from the right, back from the left, outgoing page
receding for depth), but Discover's grid is dozens of photos still decoding while
the slide ran, so the movement read as the page snapping rather than loading.
Don't reintroduce a slide, a scale, an entry blur, or a second opacity ramp, and
keep pages off `will-change: transform` — it makes a page a containing block for
its `position: fixed` children (the docked seg-tabs).

**The fade is ours to draw only when nobody else is drawing one — so in the App
Store build a BACK GESTURE renders instantly instead.** `TriaViewController`
turns on `allowsBackForwardNavigationGestures`, and that gesture is not a passive
input: WebKit slides a snapshot of the destination in under the reader's thumb,
and because Tria's routes are same-document hash changes it drops that snapshot
the moment the navigation commits, waiting for nothing to paint. The live
document at that instant is still the page you swiped away, so the move ended on
that page snapping back to full opacity and then dissolving for a quarter second
— two transitions for one gesture, and it reads as a reload because the page you
left comes back whole before it goes. Measured in WebKit 26.5: opacity 1.00 for
three frames, ~200ms of it. A traversal now mounts in the same task as the
`hashchange`, so the live page already matches the snapshot when WebKit lifts it.
It owes the same debts the fade does — the row freeze and the `.enter`
photo-snap window both apply, or 72 tiles rising under an already-complete page
re-creates the "it reloaded" read by another route. Taps keep their fade in every
shell; the other two shells keep theirs on back too, since nothing there animates
a back for us.

**Do not detect that with `popstate` — on this engine it cannot.** `popstate` is
specified to fire for traversals and not for a fragment assignment, but WebKit
fires it for `location.hash =` as well, in the same `popstate → hashchange`
order, so a tap and a swipe back are byte-identical by event. Trusting it makes
EVERY navigation in the app instant and quietly deletes the fade app-wide. The
history entry answers it without an event: `navStamp` mints a key the first time
we stand on an entry, so a key it had to **mint** is a push and a key it
**found** is a return (`navFresh`) — the same stamp the scroll memory already
runs on, plus a `!== navHere` guard for `go()`'s same-target branch.

**The outgoing page is pinned to the band the reader was on, and the pin cannot
be measured until the scroll has finished moving.** `.page.leave` is lifted out of
flow, so it has to be re-anchored by hand or it fades out showing the wrong part
of itself. The invariant is simply `leaveTop === -fromY` in viewport coordinates
— the page you left freezes exactly where you last saw it — which `renderPage`
gets by pinning `top = toY - fromY`. **`toY` is why `settleScroll` is a callback
and not a boolean.** There are three destinations (the top, a spotlighted card
`parkCard` already jumped to during `renderFn`, and a remembered position from
`restoreScroll`), and the third one used to run *after* `renderPage` returned: the
pin was measured against a destination of 0 and then the window jumped somewhere
else entirely, leaving the old page anchored a whole remembered scroll off. **That
was the swipe-back flicker** — measured at 519px of error on a short test page, and
on a real restored Discover it puts the outgoing page clean off screen, so a back
swipe dissolves nothing over the new page for a quarter second. Any new caller
that wants a different landing point passes a callback; nothing may move the
scroll after `renderPage` returns.

**A jump is not a scroll gesture.** The topbar's hide-on-read handler ignores any
scroll delta larger than a viewport, because the router teleports the window (to a
spotlight, to a remembered position, back to the top) and a thousand-pixel jump
was reading as "scrolling down fast" — so landing on a post also slid the bar
away, a second move stapled onto a navigation meant to be one clean fade.

**A spotlight has no travel and no wash.** Tapping a post from Discover, Updates
or a frame wall sets `spotlightPost`; the render then calls `parkCard`, which
moves the scroll **synchronously, inside `renderFn`**, so the position is set
before the new page's first paint and the fade reveals the card already
in place. The fade *is* the transition to the post. It used to glide 460ms to the
card and then flash a tint over it, both starting 120ms after the route settled —
three moves stacked on one tap, and the travel got longer and more obviously
wrong the older the post was, since a spotlight routinely aims a thousand pixels
down a feed. Don't reintroduce either: landing already there isn't a cheaper
animation, it's the right one, and a highlight answers "which one did I mean?"
when nothing asked. What `parkCard` **keeps** is the silent 900ms re-aim after
landing — lazy media resolving *above* the card (a legacy photo swapping its 3:2
reserve box for its real shape) shoves it down, and mid-fade that reads as
the post sliding away. Because the scroll moves during `renderFn`,
`renderPage` captures `fromY` **before** calling it (see the pin rule above).

**Nothing else animates during a page change.** The fade is the whole move:
`renderPage` freezes every row it just mounted (`.card, .notif, .request-row,
.ptile`) so they ride the swap instead of stacking a per-row rise on
top of it, and CSS kills the photo fade on `.photo-frame img` +
`.ptile-face--media img` for the same window — which the one-fade swap gives a
second reason for, since the destination is now on screen complete from frame one
and a wave of photos fading up under a page dissolving away is two moves in the
same 240ms. **Any new page-level row entrance
has to join that list.** Discover is why the rule is strict rather than tidy: it
mounts its whole grid at once, so before the freeze covered `.ptile` an arrival
there ran 87 concurrent animations over two promoted page layers with a burst of
bitmaps decoding under them — the exact pile-up behind the iOS WebKit crash. The
entrance itself is not gone, it is scoped: it plays on a **discrete act**
(landing, a filter, a tag, clearing search) and stays out of **typing** and
**background re-pulls**, via `paint({ stage })` → `layoutGrid(fresh)` →
`.pgrid--settled`. A profile's frame wall inherits all of it for free: its tiles
are `.ptile`, so the freeze already covers them, and `paintPosts(stage)` →
`dealMasonry(fresh)` is the same contract (a filter pick stages, a re-deal on
resize parks).

Two things came *off* that list when the swap became one fade, and both for the
same reason — the destination is no longer a promoted, fading layer, so rules
written to protect one no longer apply to it. **The arriving page's glass stays
live** (`backdrop-filter: none` is now `.page.leave` only): a page used to land
wearing flat glass and frost up when the router's cleanup ran, so every
navigation onto Discover, Updates or a profile *ended* on a little pop of the
material switching on. And **the docked seg-tabs rises with the fade rather than
after it**, and only when the outgoing page hasn't got one of its own — two copies
of the same control at the same fixed coordinates never moved, so animating one
is inventing a move. Released in the same `requestAnimationFrame` that starts the
fade, at `--dur-move` rather than `--dur-slow`: when the rise ran *after* the page
change it could afford 0.5s, but alongside a 0.24s fade it was the last thing
still moving by a clear quarter second and the navigation ended on it instead of
with it.

**Share is the tray, and the header tray shares.** `ICONS.send` is the
arrow-out-of-a-box the OS itself draws for share, not an envelope (an envelope
promises a message you compose; these buttons hand a link to the OS). Its mouth
matters: an early circular vessel with a narrow break reads as the IEC
standby/power glyph at 22px, so if the vessel is ever redrawn, check it at true
disc size, not at 96px. The header glyph is the share — it fires `shareOrCopy`
in place and goes nowhere. It used to be a sprout opening `#/support`, a note
from Zoe with the share button at the bottom, which put a page between someone
and the thing they meant to do; the note moved to an About fold and has since
been removed outright, and `#/support` redirects to `#/about`. index.html **inlines** the tray's
path data because the header paints before app.js runs, so that copy and
`ICONS.send` have to be changed together.

**Comments are a growing textarea, not a one-line input.** The comment composer
auto-grows to fit its text (wraps into view instead of scrolling off one line);
Enter posts, Shift+Enter breaks a line. It stays flat editorial (comments are
content, never glass). Post-photos fade in as they load over the neutral
placeholder box (JS adds `.is-loaded`), so they settle rather than pop.
