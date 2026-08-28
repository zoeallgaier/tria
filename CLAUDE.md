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
forget, no promise per tap. Three rules: **only an act that changed the SHARED
WORLD** gets one — a like, a vote, an RSVP, a comment, a repost, a published
post — never an act that only changed what you are LOOKING at, the **one
exception** being a danger row in `openSheet`, which is a warning *about* what's
coming; LIGHT is for something
that stays on screen and MEDIUM for something that lands in the real world, the
same split as `canSocial` vs `canJoin`; and they are **not** gated on
prefers-reduced-motion, unlike the sparkles — a haptic isn't motion, iOS has its
own system switch that `UIFeedbackGenerator` obeys before we hear about it, and
someone who turned the animations down has lost their tap confirmation, so the
buzz is worth more to them. Silence must stay a correct outcome: on web, on
desktop, with haptics off, nothing may depend on one firing.

**That rule narrowed in 1.3, and the reason is the bridge rather than taste.**
It used to be "anything that lands on the screen", which put a buzz on all three
disclosure panels (comments, who-liked, who's-going) and on the filter dial. All
four are gone. On the web `haptic()` is `navigator.vibrate` or nothing at all, so
the cost was invisible for a year; in the App Store build every call is a round
trip through the Capacitor bridge, and **the bridge has no short-circuit for a
fire-and-forget call.** `cap.toNative` correctly sends `callbackId: '-1'` when no
callback is passed, but `HapticsPlugin.impact` calls `call.resolve()`
unconditionally, which reaches `CapacitorBridge.toJs`, which schedules
`webView.evaluateJavaScript(…)` **on the main thread** to deliver a result that
`-1` means nobody is listening for. Every buzz therefore enters the JS context on
the same thread running the scroll and the CSS animation. A panel opening is
exactly a stretch of moving frames, and it was paying that toll to say "yes, the
thing you tapped opened" — which the thing opening had already said. The device
log is the tell: `To Native -> Haptics impact -1` followed by `TO JS undefined`.

**Putting them back was tried on 2026-08-27 and reverted the same day.** The
argument was that the tween's first beat gives the finger nothing, so the tap
reads as dropped — plausible, and not what was actually wrong. It went in while
chasing a report of the app FREEZING on that exact interaction, which makes
three fresh bridge calls on the suspect gesture the worst thing to be holding
while bisecting. The real cause was the card signature (see **A disclosure is
not content** below). If the buzz is ever re-argued, re-argue it against a panel
that opens cleanly.

Two related facts worth having. The `⚡️` log spam itself is **debug-only** —
`CAPInstanceDescriptor.m` defaults `loggingBehavior` to `Debug` and
`capacitor.config.json` doesn't override it — so an Xcode build is measurably
slower than what ships, and in that build the bridge *also* replaces
`window.console`, making every `console.log` its own message to native. **Compare
against a Release build before chasing a performance report.** And
`Haptics.swift` allocates a fresh `UIImpactFeedbackGenerator` per call with no
`prepare()`, so the Taptic Engine spins up on demand — which is why a buzz can
feel late against the finger. That one is the plugin's code, not ours.

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

**Tria adopts UIScene, as of 2026-08-27, and it had to.** Building against the
iOS 26 SDK logs *"UIScene life cycle is now required when building with the
latest SDKs. Apps that don't adopt will fail to launch."* Tria was on the old
`@UIApplicationMain` + `UIMainStoryboardFile` model, which is exactly what that
warning is aimed at — and Capacitor 8 does not help here, there is no
`UIWindowScene` or `UISceneDelegate` anywhere in its Swift, so adoption is
entirely on our side.

What it cost was small, because both of the delegate methods UIScene takes away
were **already dead**: `application(_:open:)` needs a `CFBundleURLTypes` (Tria
registers none) and `application(_:continue:)` needs an associated-domains
entitlement (Tria has only `aps-environment`). So nothing that ever ran stopped
running. `Info.plist` gains a `UIApplicationSceneManifest` naming
`$(PRODUCT_MODULE_NAME).SceneDelegate` and `Main`, and loses
`UIMainStoryboardFile`; the six empty lifecycle stubs Xcode's template shipped
are deleted, since those are precisely the methods a scene app stops calling.

Three things about it are load-bearing:

- **`SceneDelegate` is EMPTY, and that is the correct version.** The manifest
  names `Main` as the scene's storyboard, so UIKit builds the window,
  instantiates the initial view controller (`TriaViewController`) and assigns it
  to `window` on its own. The classic way to get a black screen is to implement
  `scene(_:willConnectTo:)` and not redo the setup UIKit was already doing. Don't
  add one speculatively.
- **It lives in `AppDelegate.swift`, not a file of its own.** The project lists
  its sources individually (`objectVersion = 60`, no filesystem-synchronized
  group), so a new file must be registered in `project.pbxproj` by hand — and a
  Swift file present on disk but absent from the target compiles to nothing,
  which surfaces as `UISceneDelegateClassName` naming a class that isn't there:
  a launch failure with no build error, the same shape as the missing push
  plugin. A class in a file already in the target cannot fail that way. Swift
  class names are module-scoped, so the manifest resolves it wherever it sits.
- **The APNs forwards did NOT move.** A device token belongs to the app, not to
  a window, and `UIApplicationDelegate` is still where APNs delivers it.

Verified end to end rather than reasoned: `BUILD SUCCEEDED` against
iPhoneSimulator26.5, `nm` finds `_$s3App13SceneDelegateC…` in the binary, the
built Info.plist reads `App.SceneDelegate` (variable expanded, matching the
symbol), and the app launches on an iPhone 17 Pro simulator through the splash
to a rendered feed.

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

**No button may be left dead by a dropped connection.** Every control that waits
on the network disables itself so a second tap can't double-submit, and every one
of them has to hand the control BACK on *every* path — including a rejected
promise, which is the common case on a phone (a dropped connection, an app sent
to the background mid-upload). Half of them had a `try/finally` and half returned
the button only on a *refusal*, so a **throw** sailed past the restore and left
the control disabled for the life of the view, with nothing on screen to say why.
Fifteen sites; the worst was the composer, stuck reading "Sharing…" with the
whole post still in the form. The fix is deliberately the small one — a
`.catch(() => null)` on the await and an unconditional re-enable, not a wrapper
every caller has to be bent to fit — because a rejected write and a refused one
mean the same thing to the person tapping. The audit is a grep: every
`disabled = true` that has an `await` under it needs a `.catch` or a `finally`
AND a hand-back.

**The heart is the ONE reaction that paints before it asks**, and the reason is
worth knowing before copying it. A like is private, so the count belongs to the
post's author and there is nothing of *yours* to recompute — the whole visible
change is one class on one button, needing no cache and no rebuild. So it flips,
buzzes and sparkles on the frame after the finger lifts, and puts itself back if
the write is refused. It is also deliberately **not** `disabled` while it waits.
The RSVP, the poll and the repost all redraw from the cache, so none of them can
do this without the store moving first — and making the store move first is the
optimistic-write layer that was built, measured, and **reverted** for being more
machinery than the problem was worth. Don't rebuild it without a measurement from
a real device.

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

**A row waits for its photo before it is spliced in.** `readyImages` decodes the
photos belonging to the posts a refresh is about to add, and only then does
`showWorld` paint — so a post ARRIVES rather than arriving and then developing.
Under the ring the first 200ms of that wait is free, since the ring needs that
long to drop in regardless, so the two run together and the paint waits for
whichever finishes last. Home only: Discover rebuilds its grid whole and guards
itself with a signature, and an Updates row carries an avatar, which the roster
warm already covers.

Both bounds on it are safety, not tuning, and neither should be relaxed without a
reason. `READY_CAP` (700ms) is what stops a slow bucket turning a refresh into
something that looks stuck — whatever hasn't decoded by then just fades in the old
way, which is the behaviour that shipped through 1.1. `READY_MAX` (6) is because a
resume after a week finds hundreds of new posts and only the first screen of them
is about to be looked at. And the `live()` gate is **re-checked after the wait**,
because the wait is a real gap the reader can navigate or start typing inside.

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

**`supabase/reposts.sql` HAS been run** (confirmed 2026-08-27), and it was on
this list as a release blocker after it had already landed — the same drift
`friend-declines.sql` had, so read the paragraph below about verifying before
repeating. Probed read-only: `posts.repost_of` selects `200`, and both
`can_view_original` and `repost_insert_ok` answer `200 true` over RPC. Those two
functions sit at the END of that file and the `type` check widens near the top,
so the functions existing is proof the whole script ran. The repost glyph is
live, not a button that toasts `42703`.

**`supabase/activity-reminders.sql`'s table has been run too** — `activity_reminders`
selects `200 []`, where a table that was never created answers `404 PGRST205`.
The `pg_cron` job in the same file is the one half of it REST cannot see (cron
lives outside PostgREST's schema), so treat the schedule as unverified rather
than asserting it either way — same standing as the `.p8` key.

**Sweep result, 2026-08-27: every `.sql` file in `supabase/` probes as run.**
`friend_declines` (column `decliner`), `blocks`, `poll_votes`, `post_audience`,
`headcount`, `push_subscriptions`, `users.accent`, `posts.audience` /
`posts.poster` / `posts.tint`, and `claim_push_endpoint` (which answers `401
42501` — permission denied for anon, i.e. it EXISTS; a missing function answers
`404 PGRST202`, which is what the bogus control returned). Controls were run
alongside every probe. So there is no pending migration left: the `.p8` key
above is the whole outstanding list, and it is the one thing REST cannot reach.

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
- **A disclosure is not content, and the card SIGNATURE has to agree.** `makeCard`
  stamps `dataset.sig` and `syncCards` replaces any card whose fresh signature
  differs — that is the whole mechanism keeping a quiet refresh from rebuilding
  the feed. But the three panels write their open state into the markup they
  return (an `open` class, plus `aria-expanded` on the toggle), and the signature
  was a hash of the raw `innerHTML`. Opening a panel toggles that class on the
  LIVE node and never restamps `sig`, so from the tap onward the node's recorded
  signature said "closed" while the node said "open", and **the next refresh
  replaced a card nobody had changed.**

  The cost is not a repaint: `makeCard` re-runs `richText()` over every comment
  in the thread, rebuilds all three panels and re-runs six wiring functions,
  synchronously, for every card with a panel open. The tween dies mid-flight and
  the fresh node arrives already open with no animation, which reads as a snap —
  and since the app re-pulls on **every foreground**, the trigger is "read some
  comments, switch apps, come back". It was reported as the app freezing when
  you open or close comments.

  `cardSig()` normalises the state out rather than restamping on toggle, so the
  hash answers the question `syncCards` is actually asking and no future
  view-state class has to remember to restamp. It is deliberately narrow — the
  three panel classes **by name** and the `aria-expanded` beside them, never a
  blanket strip of the word "open", which would collide with any comment
  containing it. `.readmore` is deliberately left in the signature: its rebuild
  is documented and accepted, it holds no form and no focus, and its toggle's
  label changes too, so it is not the same bug.

  **The tween was the first suspect and it measured clean.** `grid-template-rows:
  0fr → 1fr` looks like the expensive thing — a layout animation over a document
  where every card carries all three panels fully built — and it is not: 200
  cards x 8 comments under a blurred fixed bar holds ~9ms frames, and `contain:
  layout` on `.card` makes it marginally **worse**. Don't add containment here,
  and don't reach for the tween the next time this interaction is slow.

- **A POST HAS ITS OWN PAGE, `#/p/<id>`, and it replaced four separate answers
  to the same question.** Before 1.3 a single post was a POSITION IN A COLUMN: a
  copied link opened the author's profile with `?p=<id>` and the router scrolled
  to the card, an Updates row did the same *and* force-opened whichever panel
  matched the notification, a frame-wall tile did it a third time, and "the whole
  note" was a max-height tween inside the feed. Four mechanisms, one of which had
  to teleport the window a thousand pixels down somebody's archive to land you on
  one card.

  `renderPost` draws `makeCard(post, { full: true })` and nothing else. **It is
  the same function the feed calls** — every type, both repost forms, the poll,
  the photo branch, `canSocial` and `canJoin` all keep meaning exactly what they
  meant, and that is the design rather than an economy: a post has to read the
  same in both places, so the page is only where it is allowed to be COMPLETE.
  `full` does three things and no more — no clamp on the note, the comment thread
  drawn open, and who-liked / who's-going drawn in place of the disclosures a
  feed card wears.

  **A FEED CARD CARRIES NO PANEL AT ALL, and all three glyphs are links.** The
  comment glyph, and the author's heart, both open the post's page; the headcount
  still raises your hand in place and only walks to the page for the list. The
  writing box survived one round of this holding just the form, on the argument
  that starting a sentence shouldn't cost a navigation. What it actually bought
  was a box you could type into while the conversation it belonged to was
  somewhere else, and a submit that walked you there anyway — so the navigation
  happened regardless, after the typing instead of before it. One door beats a
  box plus a door to the same place. Retired with it: `openComments` (the last of
  the four open-sets), the toggle handler, and `justCommentedId`.

  **THE CARD SITS IN A `.feed`, and that is the fix rather than a shortcut.** A
  post has to measure exactly as it does at home, and the feed's width is not one
  number: it is `max-width: var(--feed-width)` on desktop AND `margin-inline:
  -1.15rem` on phones, which is how a card bleeds to the screen edge past
  `.view`'s own padding. Written out by hand the page had neither — the card took
  the view's 1.15rem inset, so its text column measured **316px against the
  feed's 353** (squished by exactly twice that padding), and on a wide screen it
  took no cap at all, **836px against the feed's 660**. Same class, same
  measurements, nothing left to drift. Verified at 390 / 900 / 1280: identical
  text bounds on both surfaces.

  **THE THREE SECTIONS ARE MUTUALLY EXCLUSIVE AGAIN, and the action row is the
  switcher.** Comments is the resting state and the floor; the author's heart
  swaps in who liked, the headcount swaps in who's going, and tapping the live
  one comes back to comments rather than leaving bare space under the card. On a
  CARD these three excluded each other because a card must never grow two threads
  at once, which is an argument about space; on the PAGE they exclude each other
  because they are three answers to different questions about one post, and
  drawing all three at once makes the reader do the sorting.

  Three things about it: `postPane` is **module state, not per-render**, because
  posting or deleting a comment rebuilds the card in place and the pane has to
  survive that (`renderPost` resets it, so every arrival opens on the
  conversation). Switching panes is a **class toggle and never a re-render** —
  `setPostPane` writes `aria-expanded` on all three buttons itself for exactly
  that reason. And it is `display: none`, **not a height tween**: this is a swap
  between two things of unrelated length, not a disclosure opening out of
  nothing. The lit glyph is the section showing, which is what
  `[aria-expanded="true"]` already meant on all three.

  **The composer sits at the TOP of the thread**, above the comments rather than
  under them. This is a page you navigated to in order to say something, so the
  thing you came to do should not be below however many replies are already
  there — and the box then sits in the same place whether a post has two comments
  or two hundred. The empty state ("No comments yet.") goes UNDER it, never over:
  above an empty composer it would be the page saying the same thing twice before
  you had a chance to answer it.

  **RAISING YOUR HAND STAYS IN THE FEED.** `canJoin` is the one act on a card
  that lands in the real world, it is one tap, and charging a navigation for it
  would be the redesign taxing the thing it was meant to make easier. The
  headcount button joins when there is a hand to raise and walks to the page
  otherwise, where the list and `.going-out` live. The heart is the same story
  from the other side: a friend's heart is still an optimistic one-tap like in
  the feed, and only the AUTHOR'S — which was never a like, always a disclosure —
  became a link.

  **THE PANELS ARE PAGE SECTIONS, so the collapse machinery is gone from the CSS
  too.** `.comments-panel` / `.likers-panel` / `.going-panel` were a grid-rows
  0fr→1fr tween under an opacity lift, with a 0.7rem left gutter for the reply
  rule, a right pad of `--inset`, and a compensating left pad on
  `.comments-content` to drag the text back onto the post's type axis — three
  paddings cancelling to one alignment. Right while the thing was nested under a
  card, pure overhead once it IS the page. They take `padding-inline: var(--inset)`
  and stop. Note the phone override at the bottom of app.css was the same
  arithmetic and had to be flattened with them: it is `.comments-panel` at (0,1,0)
  in a later media query, so it would have beaten any `--full` modifier at equal
  specificity.

  **Each name list needs a LABEL, and its absence was a real bug for a day.**
  Under a disclosure the button was the label — you tapped a heart carrying a
  count, so the names that unfolded could only be who liked it. On a page nothing
  has been tapped, and the list arrives as a bare name between the action row and
  the composer, where a reader cannot tell a liker from an attendee. `.panel-label`
  ("Liked by", "Going"), sentence case at `--kicker`, the app's one label voice.
  **Every functional check passed while this was broken** — it was caught by
  screenshotting the page and looking at it.

  **The bar says "Sam's post" / "Sam's activity"**, not a bare name. A name alone
  answers "whose page is this", which is the wrong question on a route that is one
  post, and the one a reader arriving from a notification is least likely to be
  asking. Only activity earns its own word: the other four types are all things
  you wrote, and "Sam's frame" or "Sam's find" names Tria's filing system at
  someone who may only have met it on a filter dial. The name is the one on the
  card's own BYLINE, so `postPageTitle` takes makeCard's branch (`repostOf &&
  note` is a quote, `repostOf && !note` is a pass-along) and the bar can't
  disagree with the byline under it.

  Five more that are easy to undo by accident:

  - **`Read more` is an `<a>`, not a button.** No `.open` state, no inline
    max-height, no 0.42s tween, no `transitionend`. It was the one control in
    Tria that could make a single card taller than the screen it sits in, and the
    reader who wants the whole note wants the comments under it too.
  - **The action row is no longer all `<button>`s**, so `.card-actions button`
    alone no longer describes it. `.card-social > a` (the author's heart in a
    feed) and `.card-social > span` (both counts on the page) carry the same
    geometry, named by class in the same rules — a second set of measurements
    would drift the first time one of them moved.
  - **`wireComments` guards on the PANEL, never on a toggle.** There is no toggle
    anywhere any more (the count beside the thread is a span), and the form is
    the thing that has to be wired. A `if (!toggle) return;` leaves the page's
    composer inert, which is the one control the page exists for.
  - **The post page delegates its tag chips from the section**, not per chip:
    posting a comment runs `apply`, which swaps in a fresh `makeCard`, and
    `makeCard` cannot wire a chip's destination because that is the caller's
    decision. Bound directly, the chips die on the first comment.
  - **`mountToolbar`'s title is assigned with `textContent`.** Don't `esc()` it —
    an apostrophe in a name prints the entity. `toolbarBackEl` escapes its own
    label, which is the opposite convention two lines away.

  Retired with it: `openLikers`, `openGoing`, `openReadMore`, `collapsePanel` and
  its three wrappers, `wireCardCollapse`, `wireReadMore`, `onDoubleTap`,
  `scrollCardIntoView`, `scrollCardToTop`, and `wireNotif`. `spotlightPost` and
  `parkCard` **stay**, with exactly one caller left: the edit flow, which is the
  one case that genuinely IS a position in a column, because the editor lives on
  the profile.

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
- **A repost IS a post row, and its audience is checked TWICE.** One column
  (`posts.repost_of`) and a sixth value in the `type` check is the whole schema
  change (`supabase/reposts.sql`) — no table, so it inherits the feed, the
  profile column, the boot read, `refresh()`'s change detection and the existing
  `posts` push trigger for free. `readAll` selects `*`, so the column simply
  arrives.

  **The double gate is the feature.** The read policy is
  `can_view_post(...) and can_view_original(repost_of)`: you see a repost only
  if you could already see what it points at. `can_view_post` is deliberately
  **not** rewritten to hold that clause — it is this schema's worst regression
  site (`restore-block-gate.sql` exists because a `create or replace` dropped
  one of its clauses), so the new condition lives in its own `security definer`
  function and the POLICY is what gets replaced. Blocking then falls out for
  free, since `can_view_original` calls `can_view_post` against the original's
  author. The insert policy copies the rule the other way: a repost must wear
  the original's audience exactly, the original may not be `list` (its allowlist
  isn't yours to reproduce) and may not itself be a repost (a chain collapses to
  its first original). Every reference to the inserted row is written
  `posts.<col>`, because the subquery aliases the original as `o` and `o` has a
  `repost_of` and an `audience` of its own — a bare column name there binds to
  the ORIGINAL and the check compares a row against itself.

  **The consequence to understand before reading a bug report about it:**
  reposting a `circle` post reaches only the **intersection** of your circle and
  theirs, which can be nobody. That is correct, not a bug, and the sheet says so
  (`Only the friends you share will see it.`).

  **Two forms, drawn differently on purpose.** A **bare** repost is the
  original's card with one quiet line above the byline (`passedCard` → `makeCard`
  calls itself, so every type, the photo branch, the note clamp and all the wiring
  are the original's, already correct). A **quote** is your byline, your words, then
  the original as a nested tile (`quoteCard` + `quotedCardEl`) — the feed's one
  framed object, which is the point: the feed is boxless, so a box reads
  instantly as "not mine". The tile takes `.ptile`'s glass-minus-blur, because
  the bill for a blur is area × radius × moving frames and this one scrolls.

  A quote takes a **headline and a note like any other post**, and no payload of
  its own — the shape check forbids media, a poll, a place and a time, because
  those are things you MAKE and this row is about something somebody else made.
  Its composer is the ordinary one with the attach bar, the tags and the audience
  lock removed, and the quoted post drawn UNDER the note field in the order the
  published card puts them. `passedCard` also forces `solo: false`: a profile
  column drops the byline on the argument that the page header already names the
  author, which is the one thing a repost makes untrue — without it a passed-along
  note on your own profile is somebody else's words under your name.

  Four rules that aren't guessable from the code:
  - **The heart and the comment act on the ORIGINAL, the ••• acts on the ROW.**
    Likes are private, so a like credited to a quote splits a count the original's
    author can never see; but ••• manages the thing in your feed, which is the
    quote and the only part you can delete. `cardActionsHtml`'s `opts.menuPost`
    is that split.
  - **`data-burst` overrides `data-type` for sparkles.** A repost's type names no
    colour, so `celebratePost` and the button's `--burst` take the ORIGINAL's
    type. A hue naming a type is the one thing the quintet is for. That is also
    what the reposted glyph itself wears — `.card-repost.reposted` is
    `var(--burst)`, the same ink `.card-like.liked` takes, and it sits AFTER the
    hover/active rules for `.liked`'s reason: at equal specificity the later rule
    wins, so the mark keeps its colour under the finger that earned it. It said
    `var(--accent)` until 1.3, and `--accent` is `var(--text)`, so the button's
    one state read as plain ink.
  - **A repost celebrates like a post, and the ORDER of the two calls is the
    whole reason it does.** `celebrateRepost` runs AFTER `refreshPostViews()`,
    never before. The tap flips the button to `.reposted`, which changes the
    innerHTML signature `syncCards` compares, so the repaint rebuilds that card —
    and `burstSparkles` appends its layer *inside* the button. Written the other
    way round the stars were added and destroyed in the same millisecond, with no
    frame in between: measured on a MutationObserver, add and remove on one
    timestamp. The bare repost sparkle was therefore not dim or brief, it was
    **absent**, from the day it shipped. Anything that decorates a node a
    re-render can replace inherits this.

    Where it lands is the second half. A quote uses `justPostedId` like any other
    post — composer, `#/`, cascade on arrival. A bare repost can't: closing a
    sheet restores focus to its opener and `.focus()` scrolls that button into
    view, so the reader is parked on the card they tapped while the new row lands
    at the top of a feed they are no longer looking at (measured: scrollY 0 → 461,
    new row 759px above the fold). So it sparkles the first card on screen
    carrying a button aimed at that original — which for a bare repost is a
    pixel-identical redraw of the new row anyway, since `passedCard` draws the
    original's own card. Setting `justPostedId` from here would be worse than
    useless: only `renderFeed` consumes it, so a repost from a profile would leave
    it armed and fire the cascade minutes later on a forgotten card.
  - **The home feed filters on the SUBJECT, a profile on the ROW.** `subjectOf`
    is why: a bare repost draws a Frame, so hiding it under Frames would hide a
    Frame that is visibly there. A profile has a Reposts row instead, so filtering
    on the subject there would make two rows overlap and the checkmark lie.
  - **`repost` is not a sixth quintet member.** No `--type-repost`, no heart, no
    pull-ring dot, no `TYPE_GLYPH` / `FILTERS` / `ICON_ALL` entry. It is in
    `TYPE_PLURAL` only because the profile's empty state needs a plural. The
    Reposts row is APPENDED after the five, for People's reason: `All` → the five
    types is one ladder from widest to narrowest and a repost is a different axis.
- **An activity reminds its AUDIENCE, three times, and never its headcount.**
  A week out, two days out, and the morning of (`supabase/activity-reminders.sql`
  + the `activity-reminders` branch in the push function). Keying it on
  `headcount` is the obvious version and it is wrong: the week-out reminder
  exists precisely to reach somebody who has NOT answered, so the RSVP list is
  the one set that excludes the people it was written for. Invited therefore
  means the post's own audience — the allowlist for `list`, the host's mutual
  friends for `circle` **and for `public`**. Public is the case worth
  understanding: its audience is technically every account on Tria, but `canJoin`
  is friends-only, so anybody outside the circle would be asked a question the
  app will not let them answer. Same friends-only line, one more place.

  **The copy splits on whether they have answered, not on the stage.** Someone
  who is going gets logistics (`Zoe’s activity, a week away, Saturday at 7:00 PM.
  My place.`); someone who hasn't gets the question, in the app's own word for it
  (`Are you in?` — the RSVP button reads *Count me in* and the host's push reads
  *<name> is in*). On the DAY both get logistics: by then the address is the
  useful half and a third ask is pestering. The host is not in their own
  audience, so they get one line on the day and it carries the only thing a host
  needs, the count.

  Three things that aren't guessable:
  - **The host's NAME has to lead the body**, and the reason is in the data. A
    location is written by its host in the first person, so a real activity says
    `My place` — which, stripped of the card it sits on, has no antecedent. It's
    `name` and not the handle, like every other notification this function sends
    and like a Discover tile's byline; `@zoe’s activity` reads as a mention,
    which means something else here.
  - **The sweep runs HOURLY and the journal is what makes that safe.** One row
    per (post, user, stage) means the extra passes are a *retry* rather than a
    repeat — if the 9am run dies on a cold start, 10am finishes it and nobody
    hears twice. Hourly rather than one daily run because `pg_cron` schedules in
    UTC, so a fixed hour drifts twice a year across DST, and because one shot a
    day means one failure costs a whole day with nothing to catch it. The only
    clock guard is a 09:00–21:00 US Mountain window, on the app's own `dayMT`
    clock, so a reminder is never what wakes somebody up. **Journal before
    sending, not after** — a crash between the two costs a missed reminder, and
    the other order costs a duplicate, which for a notification is the worse
    failure.
  - **`apns-collapse-id` is capped at 64 bytes and `sendApns` SLICES to fit**, so
    a key built from two full uuids truncates mid-user-id and two people's
    reminders collapse into each other, i.e. into one. `collapseKey` takes eight
    hex characters of each instead.

  Reminders are **push-only and deliberately not in the Updates ledger**:
  `notifications()` is a record of what *people* did, and this is the app
  talking. A moved date does not re-arm a stage that already sent, and an
  activity that has already started gets no day-of line.

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
  (`DISCOVER_FILTERS`): **People**, which drops every post and
  gives each account the portrait tile, alphabetically — the directory answer to
  "I know roughly who I'm after", since the browse grid is chronological and
  capped so a quiet account sits a long way down it. People takes **no pastel**
  (the quintet is reserved for post types) and its masthead dot is ink. Search
  under it still reaches post text via `saidBy`, so hunting by interest works on a
  page of faces. It **leads** the list, under the View row and above All — the
  two rows that change what the page is MADE OF, kept together so All → the five
  types stays an unbroken ladder from widest to narrowest. People sat inside that
  ladder until 1.3 and stopped it halfway to answer a different question.

  **Format is a second axis, and it rides the dial's HEAD as an ACTION row.** As
  of 1.3 Discover draws either the masonry wall or Circle's reading column
  (`discoverView`, `DISCOVER_VIEWS`) — four rounded squares for the wall, three
  flush lines for the column — switched from a row at the top of the dial rather
  than from a second toolbar button. That makes `openFilterDial` hold two kinds
  of row, which is the thing to understand before editing it:

  - a **filter** row is a RADIO (`menuitemradio`) — picking one un-picks another
    and the checkmark says which is live;
  - an **action** row (`opts.extras`) is a SWITCH (`menuitem`) that does a thing
    and comes back. It never wears the checkmark, because it isn't a member of
    the set the checkmark chooses between — marking it would say "you are
    currently looking at View". It also always buzzes, and gets that for free:
    the haptic fires when the tapped key differs from `current`, and an action
    key never equals it. Correct rather than lucky — a toggle always changes
    something, so there is no silent case to protect.

  It names the form it would switch **to**, the only reading that works on a row
  you tap once. It is **absent under People** rather than disabled (a directory
  of portraits has no column form, and a dead row is worse than no row); the dial
  is rebuilt per open, so that's re-evaluated each time rather than hidden and
  unhidden. Three more: **`discoverView` is in the paint signature** and has to
  be — the tiles are identical either way, so without it the early return would
  swallow the repaint the tap asked for. **List reuses `makeCard`**, not a second
  design of one, so a stranger's post reads exactly as a friend's does at home and
  `canSocial` / `canJoin` keep meaning what they already mean. **Portrait tiles
  are dropped in list mode** — a tile with no post has nothing for a card to be,
  which only bites a name search under All.
- **A profile carries the same dial, and Frames is a wall.** The dial is in the
  **toolbar** with the page's other controls, rightmost, after the identity
  button — one control, one treatment, one place, the same as every other page.
  It used to live in a `.profile-shelf` between the identity header and the
  posts: a tracked micro-caps caption naming the pane, with the dial at its
  right. Both halves came out in 1.3. The caption was a third telling of
  something the button's hue dot and the dial's own checkmark already say, and
  once it went there was nothing holding the row up; "the bar carries identity,
  the shelf narrows the pane it captions" is a distinction no reader has any way
  to know they were supposed to be making. Three rules make it a
  profile filter rather than a copy of Home's: its rows are **derived from what
  that person actually posted** (All + only the present types, in `FILTERS`
  order — no dead ends, no People row), the dial is **absent** when
  there's nothing to narrow (one type and one layout isn't a choice; a single
  photo still earns it), and **Frames swaps the layout** — that person's
  photographs dealt into the same masonry grid Discover uses, at their real
  aspect ratios. That ragged edge is the point: a square contact sheet flattens
  a portrait and a landscape into one brick, and Tria stores photos uncropped so
  it doesn't have to. A wall tile is the **face and nothing else** (no foot, no
  byline, no counts — every tile is the same person), and it carries the real
  deep link (`#/p/<id>`), so the wall is an *index into* a long profile: a tap
  opens that post's own page. It used to drop back into the post COLUMN with the
  card spotlighted, which meant teleporting the window down the archive to show
  you one post. `profileFilter` resets
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
  the photo/link/poll surface the prompt's type implied), and the calendar
  toggle is dropped from that flow entirely (it was the Post/Activity switcher
  until 1.3) — an activity is the one thing a daily never took, and with it gone
  the only choice left is what to attach, so
  a caption ("Answering the daily") sits over the question in plain grey rather
  than a colour that has nothing left to signal. Since any type answers any
  prompt, the Discover card can't wear the one colour it's asking for either. It
  wore all three for a while (a fixed lavender→coral→cyan band) and now wears
  **none**: the card is plain glass and the colour went to the button in its foot
  (see the glass note below). The page it opens now
  **drifts** through the same three (`daily-drift`, 24s — a daily's own unit is
  its 24-hour window), a registered `--glow-daily` interpolating smoothly rather
  than a plain custom property; reduced motion freezes it on the prompt's own
  hue, which is also the frame it opens on before the drift starts. The tag an
  answer wears keeps a band — not the prompt's nominal hue, and no longer
  matching the card, because a chip in a row of chips has nothing but colour to
  tell it from the words beside it — but as of 1.3 that band is **`--pill-band`,
  the reader's own**, not a hand-rolled tri-colour of note/find/photo at 18%.
  Three of the five type pastels chosen to mean "not any one type" is the
  quintet spent on its own negation; `--pill-band` is the ramp that already
  means Tria-rather-than-a-type. It rides a `::before` at `opacity: 0.17` under
  `isolation: isolate` rather than a `background`, because a gradient cannot be
  `color-mix`ed to a tint. The composer banner and the detail
  page's kicker stay plain grey, having nothing left to signal once nothing is
  ever blocked.
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
**Post-type icons are OFF every card and every tile, as of 1.3.** The ornate
identity set — the hand-drawn burst, the aperture, the asterisk — is **deleted**,
not merely unused: `TYPE_ICON`, `POLL_ICON_PATH` and `pollGlyph` were 6.8KB of
inline SVG that nothing referenced but every shell still downloaded and the App
Store binary still carried. `typeTagEl` is gone with them, and a Discover tile's
`sayFaceEl` leads with the words. A mark announcing "this one is a Find" beside a
headline that is visibly a link is the same fact told twice, and any reader
arriving at Tria already knows what a post is. A past activity used to grey its
mark and relabel it "Happened"; that signal lives where it was always legible, in
the card's own event date and past state.

What survives is the two places a type is a **choice** rather than a label — the
composer's inferred-type indicator and a profile's filter dial — and both now
speak `TYPE_GLYPH`, the plain line glyphs the composer's own attach buttons wear
(`pencil` / `link` / `image` / `poll` / `cal`), as does the phone's + speed dial.
That is the point of the swap: a reader learns "link means Find" by pressing the
link button and watching the nameplate change, so every later appearance should
be the mark they already pressed rather than a second drawing of the same idea.
One vocabulary, learned in one place — and as of 1.3 that is nearly literal:
`cal` joined the attach bar with the Activity toggle, so four of the five glyphs
ARE buttons the reader has pressed and only `pencil` (a Note, i.e. nothing
attached) is a mark with no control behind it. Note `list` and `poll` in `ICONS` are both
three horizontal lines and are told apart *only* by `poll` being ragged (it's a
bar chart) and `list` being flush — keep them that way.

**And the surviving marks go MONOCHROME under a chosen accent.** `--type-mark`
is stamped on `<html>` by `paintBrandBand` as `var(--text)` — near-black on
paper, near-white on ink, resolved at the point of use so no JS learns the
scheme. It is stamped for a **palette pick** and for **"none"**, and removed for
**Default** and **Photo**. The line is not "which sources are colourful", it is
which ones the quintet is already inside: Default *is* four of the five type
pastels, and a Photo accent is sampled off a face and makes no claim about the
palette, so under either the five glyphs read as part of the app. Under a picked
accent the chrome is one colour end to end and the + dial is five others, and
the quintet stops reading as a vocabulary and starts reading as stray hues.
It is written as a **fallback** around the type's own ink so Default and Photo
need no branch and `tokens.css` never learns the token exists.

**It is down to ONE reader, and the line it draws is what you are about to MAKE
versus what you are choosing to LOOK AT.** That reader is `.type-icon--*`, which
after 1.3 is the phone's **+** speed dial and nothing else. Two things left, for
two different reasons, and the difference is the rule:

- **The composer's masthead mark** opted out in the edit that took the wash off
  that page (see the two-pages-wash note below). It is `.type-icon--*` too, so
  it opts out **at the element** with `--type-mark: initial` rather than by
  being excluded from the list — that page has no accent on it any more, so
  there is nothing for the quintet to be stray against, and the mark is the only
  colour on a sheet of white paper.
- **The filter dial** — `openFilterDial`'s inline row ink and `ICON_ALL`'s five
  dots — left by **not reading the token at all**, and it left because the
  receipt never folded. `.masthead-filter`'s hue dot lights in the raw pastel
  whenever a filter is on, so under a picked accent the row you tapped was ink
  and the dot it lit was lavender: the legend disagreeing with the thing it
  labels, in the one control where the two exist to teach each other. Fold both
  or fold neither, and a dial whose whole job is to name the five is the wrong
  place to fold. The two are now the same fact in two places, so **keep them in
  step** — a hue change to one is a hue change to both. This covers every dial
  that carries type rows (Circle, Discover, a profile); the non-type rows
  (People, Mentions, the View switch) still take `--muted`, unchanged.

The **+ dial's `--glow` bloom is still not a reader** — it is the disc's
material rather than a mark, it is the one surface where the quintet means
"things you can make", and the mono glyph reads better on it than the tinted one
did. `.type-icon--past` still wins its grey on source order.

Austere, editorial, cool greyscale base. The chromatic colour is a pastel
quintet reserved for the five post types: note = lavender, find = coral,
photo = cyan, activity = lime, poll = rose. Four of those five are also borrowed
as `--brand-band`, the gradient on the primary-act buttons — where they name
Tria rather than a type, and where a reader's own accent may replace them
outright (see Lit dome). Instrument Serif on titles only; Oxygen everywhere
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
  scrolls under it: the toolbar, nav pill, daily card. Re-samples
  every frame of every scroll, so it stays lean. The toolbar's own BUTTONS are
  the exception, and it's the "never glass on glass" rule: they sit on a bar
  that already blurs, so they keep the fill, rim and edge and drop the sample —
  and Discover's search field is one of them, not a chrome surface of its own.
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
**No glass carries a hue, and the daily card is why that rule is worth having.**
It was the one exception through 1.2 — first the prompt's own type colour, then
a fixed three-colour band once every prompt stopped naming a type. Both failed
the same way. A filled coloured panel is the app's *button* vocabulary (the
brand band under a lit dome means "press this to make something"), so the card
read as an enormous button that wasn't one, and the real button in its foot had
to be drawn as bare type to avoid competing with it — which left "Add yours", the
one control on Discover whose whole job is to invite you to post, as a 24px scrap
of text below the HIG floor. The card is ordinary glass now and the colour moved
down into the pill, where the band already means what the pill does. **A hue
belongs on the control, not on the surface it sits on.**

**"Add yours" is ONE button drawn in two places**, and it is the newest member of
the `.publish-fill.is-solid` lit-dome set. It appears in the foot of Discover's
card and in the bar on the daily's own page, and both were separate objects until
1.3 — the bar's wore a tri-colour glass of its own, the card's was bare type with
an arrow — so the same invitation looked like a button in one place and a link in
the other. The geometry and material are declared once for both selectors, up in
the toolbar block of `app.css`; each keeps only what its context needs (the bar's
exact disc height; the card's z-index over the stretched link, and a foot allowed
to wrap, since at 320px the faces, the count and a 122px pill want more room than
the card has). It qualifies for the dome on the rule that has always governed it:
this is the app's primary act — commit, or go and commit — and "Add yours" opens
the composer. It is still not decoration for any button that would look nice with
a gradient on it.
**The profile and its editor open the same photo at the same height.**
`--identity-air` (1.7rem) is `.account`'s `padding-block` and `.pf-form`'s
`padding-top`. The editor had neither: it draws no masthead (deliberately — a
serif nameplate over a settings form is the page introducing itself to someone
who asked for it by name), so the form was the section's first child and the
avatar started at `.view`'s padding-top, ~27px above where the *same*
photograph sits on the profile you just came from. Walking into the editor
jumped it up the screen. One token, read by both, because the two pages with no
masthead are exactly the two that have to agree.

**A profile's identity is FLAT, and its colour is the page.** There is no
identity card as of 1.2 — no glass panel, no 26px corners, no corner glow clipped
inside one. The photo is an ordinary circular avatar at profile size (the app
had exactly one non-circular avatar and it was this page), the name/handle/stats
sit on the same type axis as the feed below, and the
person's colour is the shared `.ambient` wash — the SAME `data-ambient="profile"`
Edit profile carries, so the page that shows a colour and the page that sets it
are one gradient with one set of tokens. Don't fork a per-page geometry for it; a
top-right variant was built and thrown away for being a second thing to keep in
step.

**TWO pages wash, and both name a PERSON: a profile and Edit profile.** One
gradient, one question — whose is the thing in front of me — asked by the page
that shows someone's colour and the page that sets it. `paintWash(user,
'profile')` is the only call and `--wash-amt` has one value (56%).

**The COMPOSER was the third and took two removals to stop being one, which is
the note to read before adding a wash anywhere.** It first carried the inferred
post **type**'s hue, re-tweened on every attach off a `TYPE_HEX` table of the
five quintet literals — so the app's largest gradient meant "whose page is this"
on two routes and "what am I filing this as" on a third, a vocabulary a reader
has to be told about rather than pick up. In 1.3 it became the reader's own
accent, which fixed the meaning and left one page-sized gradient too many: an
empty form you just opened is the single route where nobody is asking whose page
it is, and the bloom was lighting the surface somebody was about to write on.
The composer is paper now. `TYPE_HEX` went with the first removal (type fills
come from `tokens.css` by `var()`), `body[data-ambient="publish"]` and the 68%
`--wash-amt` with the second. Nothing replaces the call — `applyAmbient` already
lands every non-profile route on `none`, so the composer keeps what the router
gave it.

**And the composer's type mark went BACK to the quintet in the same edit**, as
the one opt-out from `--type-mark` written *at an element* (the filter dial has
since left too, by not reading the token at all — see the monochrome note
above).
`.type-indicator` sets `--type-mark: initial`, which is the guaranteed-invalid
value at that element, so `.type-icon--*`'s `var(--type-mark, …)` falls through
to the type's own ink — one line, all five, no colour restated. The reason the
mono rule stopped applying here is the removal above: it exists because a picked
accent makes the chrome one colour and five stray hues beside it stop reading as
a vocabulary, and this page now has no accent on it at all. The mark is the only
colour on a sheet of white paper, saying the one thing a hue is *for* here —
what you are about to make, at the moment that is a live choice.

**The wash is tinted before it is saturated, and that is what lets it be seen.**
`--wash-tint` mixes the accent toward the scheme's own extreme (`#fff` light,
`#000` dark) at `--wash-keep`, then `--wash-sat` buys the chroma back — alpha
moves luminance away from the paper the ink was chosen against and spends
contrast, `saturate()` is luma-preserving and nearly free. `--wash-sat` is also
the **pastel** dial: past ~2.5 the mix stops reading as the accent lit up and
starts reading as a louder colour standing in for it, which is dramatising the
hue rather than emphasising it. Two inks pay for the rest: `--wash-ink` for a
lone mark in the hottest band (a toolbar glyph — the back chevron, •••, the
friends tie — which is what a washed page has up there) and
`--wash-ink-soft` for the identity's whole secondary line, which would flatten
the header if inked as hard. Re-measure both against every accent, both schemes,
if any of those numbers move.

**The wash is the top of the page's BACKGROUND, and must stay ordinary content.**
`.ambient` is `position: absolute` at the document origin on washed pages, so it
scrolls away with the header it belongs to and the compositor carries it for
free. The version to never build again is the clever one: a fixed layer with the
gradient moved inside it from a scroll handler. It measures perfectly and is
wrong in the hand — WKWebView scrolls on the compositor and delivers scroll
events coalesced behind it, so the wash visibly slides against the content it is
supposed to be part of. Anything that recomputes the wash's position per frame
has this bug, whatever it is written in.

**Being absolute used to cost one seam, and the fix is that the layer now starts
ABOVE the document origin.** A document-anchored layer stops at the document and
iOS does not, so an over-pull past the top opened a band that `body::before`
fills with flat paper, meeting the wash at its peak — a hard divide across a
single row on any pull-up. This file used to name `overscroll-behavior-y: none`
as the lever and it is no longer needed: `--wash-rise` (26vh) pulls the box's top
edge above y=0 and the gradient simply continues into the gap. The old note
saying an upward-grown box is inert is about the **fixed** gate copy, where a
negative top parks the gradient above the *screen*; in document space it is a
real position. **Don't add the overscroll lever** — it costs the top bounce on
those routes for a seam that is closed.

The rise has to clear the gradient's own reach or the seam just moves up: the
colour resolves to transparent at 82% of the vertical radius, so `0.82 × 43vh −
15vh = 20.3vh` above the origin, inside a 26vh rise. **Those three numbers move
together.** Note the gate's copy of `.ambient` is still fixed and should stay
that way; it does not scroll.

**The wash is a shallow band, and the WIDTH is the one thing that isn't a
knob.** The ellipse is `112% 43vh at 50% calc(--wash-rise + --wash-drop)`. The
112% overruns the viewport on purpose so the gradient never terminates anywhere
the reader can see it end — a bloom with a visible left and right edge reads as
an *object sitting on* the page rather than as light falling on it, so resizing
means moving the vertical radius and leaving the horizontal one alone. The
vertical radius is stated in **vh and not %** since the rise: it was a percentage
of a box that was exactly 100vh tall and the box is 126 now, so `43%` would
quietly have grown the bloom by a quarter.

**The peak is `--wash-drop` (15vh) DOWN the page, not pinned to the top edge**,
and that is the third position it has had. `-10%` pushed the hot core off-screen
to keep it gentle — an eighth of an 86% radius, nearly a quarter of a 43% one, so
it cropped the bloom rather than positioning it. Then `0%`, with `--wash-amt`
(56%) doing the softening, which is what that variable is for. What 0% still had
wrong is that half an ellipse centred on the document origin is half an ellipse
nobody sees: the top half is off the page and the first 48px of the rest is
behind the top bar, so the brightest band of the app's largest gradient was spent
in the two places it cannot be looked at. 15vh lands the peak on the avatar and
the name. Nothing else changed — same radii, same alpha, same falloff, translated
— so the reach down the page grew by exactly that 15vh, to ~50. Shortening the
gradient does not soften it either: the peak is exactly as saturated and the
falloff just gets steeper, which is why the alpha came down when the height did.

**Glyph buttons owe 44pt, and the disc is not always the target.** Apple's HIG
floor is 44×44 and the pattern for a control drawn smaller is a transparent
`::after` that grows the hit area without touching the paint. Two traps: `inset`
resolves against the **padding box**, so a 1px border means `-7px` and not `-6px`
to reach 44 (`-6` measures 42 — passes review, fails the device), and overlapping
targets are only safe where a single control is guaranteed. Verify by
hit-testing the live page with `elementFromPoint`, not by reading the number off
the rule.

**And know which controls actually take that fix, because several don't.**
`.comment-delete` does (28px box, 44×44 live). `.tag` **does not** — a chip is
one line of type and hit-tests **52×26**. The `::after` this note used to point
at belonged to `.filter`, the old chip row, which stopped being rendered when the
dial replaced it in 1.3 and whose 17 rules were deleted with it. Measured live at
390px, the controls under the floor are `.tag` (52×26), the composer's
`.rt-attach` (40×40) and `.aud-lock` (81×34), `.pf-photo-edit` / `.pf-photo-accent`
(40×40), `.push-toggle` (40×24), and Updates' `.request-accept` (78×36) /
`.request-ignore` (58×34). All predate 1.3 and all shipped through two approved
builds, so this is a backlog and not a release blocker — but don't read the rule
above as a claim that it is already applied everywhere.

**Toolbar buttons are the counter-example and they are drawn at 44.**
`--toolbar-btn` has been 44px since 1.3 and the disc IS the target: no invisible
box, nothing to keep in step. The `::after` that was there overshot to 50 because
it had been written against a 40px disc, which put two invisible boxes 0.4px
apart. A quiet corner mark stays small and buys its target; a bar full of the
page's own controls is drawn at the size it is touched. Measured rather than
asserted: every bar the app mounts, both engines, phone and desktop, paints
44×44 and hit-tests 44×44 through the middle of the disc.

**When the bar "looks small", it is the GLYPH and not the disc — check that
first.** The disc is a hairline rim over a thin fill, so what a reader reads as
the button is the mark, and the mark spent 1.3 at 22px in a 44px box. Two
measurements moved it to **24**: the phone's bottom nav draws a 28px glyph in a
50px target (56%) and is on screen at the same moment as the bar, which made 22
in 44 (50%) the smaller of the app's two glyph sets by 21% with nothing saying
why; and `ICON_ATTRS` authors every one of these on a `viewBox="0 0 24 24"` at
`stroke-width="1.8"`, so 22px was the icon's own grid scaled to 0.917 with its
strokes landing at 1.65px, off-pixel and soft. At 24 the glyph is 1:1 with the
grid it was drawn on. **Keep the two numbers separate if either moves** — 44 is
the HIG floor and is not a style knob; the glyph is. And it takes THREE rules,
because two marks in the bar carry classes of their own: `.toolbar-btn svg`,
`.msb-ico svg` (the search magnifier/X, which live in a span) and
`.masthead-filter-ico`. That is exactly how one mark drifts a size away from
every other one up there.

**The toolbar is the page's nav bar, and it is the only chrome above content.**
One fixed bar per page (`.topbar`): a **leading** slot (nothing on the four root
tabs — the tab bar already says where you are; a back chevron on a pushed page),
a **centered small title**, and **trailing** actions as glass buttons. `renderPage`
calls `resetToolbar()` before every `renderFn` and each page fills the three slots
from `mountToolbar({ leading, title, actions })`. That's 1.3's whole subject: what
used to sit up there was the app's NAME, generic on every page, while the thing
that answered "where am I" was a flat in-flow masthead that scrolled away.

Six things about it are load-bearing:

- **The small title hides behind the page's own big one.** The nameplate still
  lives in flow, large serif, scrolling away with content (`mastheadEl`, or a
  profile's `.account-name`) — the bar's copy crossfades in once that has
  scrolled bodily under the bar, so the two never show at once. `BIG_TITLE_SEL`
  names the elements this measures against, and **a new page-level `<h1>` has to
  join that list** or its page shows the small title from the moment it lands.
  Which is right for a page with no big title (Edit profile) and silently wrong
  for one whose heading is under another class.
- **`toolbarBackEl(href, label)` is the one leading control**, and passing NO href
  makes it a `<button>` for a page whose exit has to POP rather than push (the
  profile editor). Same disc, same glyph, same label: the difference is in the
  history, not on the screen. No page has an ad hoc "← Back" text link any more.
- **The profile editor's bar carries the form's two answers, and neither is
  unconditional.** Cancel and Save used to be a pill row at the foot of the
  form, under the toggles and above the account zone, so committing meant
  scrolling back past everything you had just decided *not* to change. They're
  bar controls now: an X leading, a check trailing, both fed by one predicate
  (`syncAnswers` → `pfDirty`, which counts name, bio, privacy and a live crop —
  **not** the notifications switch, which commits on the tap and so costs
  nothing to leave). A pristine form shows neither. The check is `--idle`:
  present in the DOM but hidden by `visibility`, so it's out of the tab order
  and the a11y tree while staying a transition target — it fades in on the
  keystroke that earns it rather than popping into the corner of the eye, and
  the bar's slot count is settled once at mount. The leading control is a plain
  back chevron until then, because the act is the same either way and only the
  *cost* of leaving changes; over unsaved words a chevron is a door pretending
  not to be a bin. Implicit submission still reaches the submit handler with the
  check hidden (Enter in the name field), so the handler bails on a pristine
  form rather than making a no-op round trip that ends in `leave()`.
- **`.toolbar-commit` is the check, and it is the fourth tinted-glass surface.**
  Geometry is `.toolbar-btn`'s entirely — the 44px disc that is its own tap
  target — and only the material differs: `.publish-fill.is-solid`, the same
  tinted glass the compose **+** and the composer's Post pill
  wear, declared in the same rule as those two so the set can't drift. It needs
  no overrides (`.publish-fill` is later in app.css than `.toolbar-btn`, so its
  `background: none` / `border: none` already win, and `--on-type` beats
  `--toolbar-ink` on specificity in either scheme) — but its `transition` is
  written as `.toolbar-btn.toolbar-commit`, because at one class it would lose
  the ramp to `.publish-fill`'s own `transition` further down the file.
- **`--toolbar-side` is a count of SLOTS**, stamped by `mountToolbar`, from which
  CSS derives how far the centered title has to stop short on each side. A
  percentage can't see how many controls are mounted, and a profile carrying both
  the friends tie and the filter put a long name under the glyph. A control that
  carries words declares `data-slots="2"`; approximate on purpose, since a pill's
  width isn't final until the webfont lands.
- **`--toolbar-mid` is not 50%.** An absolute child resolves against the padding
  box and on phones the bar's top padding IS `env(safe-area-inset-top)`, so 50%
  centres on the notch too and lands everything high. Headless Chromium reports
  a zero inset, so this is the one measurement no boot pass can check; verified
  on the simulator instead (iPhone 17 Pro, inset 62pt: bar 0–122, controls and
  title both centred at 92, which is past the inset then half the 60pt bar).
- **`body.toolbar-live` means "this bar is a page's own"** — it started as the
  migration flag and every page is converted now. It's false in exactly two
  places, both of which want a bar that isn't there rather than an empty one:
  under the gate (which hides `.topbar` and draws `.auth-topbar` instead) and in
  the frames between boot and the first route landing. Geometry is unconditional;
  what the class still gates is the material, hide-on-scroll, and the reserves.
- **A page under a bar opens with a hairline, not an editorial margin.** `main`
  clears the bar and then `.view` used to open with the 4rem/1.5rem it had when
  the thing above it was a wordmark resting on the nav card. Two reserves for one
  piece of chrome measured as a 38.7px hole on Circle and 70.5px on a profile
  (which pays a third time in `.account`'s own padding). The bar is the air now.
  Same argument retired the 84px head on the desktop nav card, which was
  clearing a wordmark that is no longer drawn.
- **Discover's search button BECOMES the field, and that costs a third node.**
  One glass surface (`.toolbar-search-shell`) pinned by its right edge — exactly
  where the disc's right edge already sat — growing its **width** into the bar,
  with the button on top reduced to glyph and tap target (no fill, no rim, no
  lift). It was two materials until 1.3: a full-glass `.toolbar-btn` at z-index 2
  over a separate field that wiped open from a `clip-path`, which ends every open
  looking like a button sitting ON a bar, with the disc's rim drawing a hard
  circle a third of the way along the pill. The clip was there to hide a seam it
  created — a clipped edge carries no border and no inset rim, so a clip stopping
  at the disc's width leaves three-quarters of a ring, which is why the disc had
  to cover it. **The glass cannot live on the `<input>`**: a border-box width
  smaller than the element's own padding floors the content at zero and grows the
  BORDER box instead, so an input needing 3rem of right clearance for the glyph
  measured **66px** shut where 44 was wanted. Hence shell + input, the shell's
  `overflow: hidden` clipping the input's overhang while it's narrow. Width, not
  `clip-path`: one out-of-flow box laying out for the length of a tap is not the
  area × radius × **moving-frames** bill this file refuses elsewhere.

- **A script `focus()` inherits the keyboard ring from the element it took focus
  FROM, and a text input always has one.** Closing the search has to say where
  focus goes and the two answers differ: a keyboard close (Escape, or Enter on
  the icon) must hand it back to the button or the next Tab restarts at the top
  of the document, while a **tap** must not park it anywhere. `closeSearch` did
  the first unconditionally, so tapping the X on an open field drew 2px of
  `--accent` around the disc — and `--accent` is `var(--text)`, i.e. **a white
  ring on dark paper**. The cause isn't the button: `:focus-visible`'s heuristic
  passes through a scripted focus when the previously focused element matched,
  and an input matches *always*. So the ring only ever appeared on an open field,
  which is the only state where focus was in the input to begin with. The tell is
  **`event.detail`** — 0 from the keyboard, 1 from a pointer, on both engines,
  since WebKit fires an ordinary click either way. The tap branch **blurs**
  rather than leaving focus in a folded field, which iOS would answer with a
  keyboard standing over a closed search. Any future control that closes itself
  and restores focus inherits this; a menu whose opener and rows are both buttons
  does not, because a pointer-focused button never matched in the first place.

**The wordmark is signed-out only.** `.brand` is gone from `index.html`; the one
place a wordmark still earns its space is `.auth-topbar` on the front door, where
there is no page identity to show instead. It was also the only signed-in link to
About, so **About is a row in the ••• sheet on your own profile** — which matters
more than a colophon would, because the feedback form is there and it is the only
way to report a bug.

**There is no seg-tabs any more, and the composer is why.** `.seg-tabs` was the
iOS segmented control — two equal segments over a sliding thumb — and it lost its
callers one at a time: Friends' pair went with the Friends page, Updates' All /
Mentions became a toolbar filter in 1.3 so all four root pages narrow through one
control in one place, and the composer's **Post / Activity** became the calendar
button in the attach bar (see the composer note below). The last one is what
settles it, because it retires the argument that kept the control alive through
the other two — that the composer's segments weren't *narrowing* anything, they
picked what you were about to make. That turned out to be the case against it: a
form can read what you attached, so asking first was asking for an answer the
reader didn't have yet. `segTabsEl`, `wireSegTabs` and the whole stylesheet block
are **deleted**, with tombstones at both sites; nothing left in the app puts two
whole versions of one page side by side, and a new one should be sure it isn't a
filter (toolbar dial) or an attachment (a button in the bar) before it rebuilds
this. Two things that fell out of Updates' dock coming out in 1.2 still hold:
**no page has a `position: fixed` child**, which is what the containment cautions
elsewhere in this file are guarding, and the bottom nav hugs the home indicator
(small float, iOS Liquid Glass style) rather than being lifted into the screen.

**The composer is ONE form and the type is inferred, never picked.** Four toggles
ride the foot of the note box — `link` → Find, `image` → Frame, `poll` → Poll,
`cal` → Activity — each opening its own surface (the link row, the picker, the
choices, Where and When) and folding the other three, with `derivePostType`
reading whichever is live. Nothing else is a type control: no chips, no groups,
no switcher. Five things about it:

- **Activity stopped being a GROUP in 1.3.** It had its own field set behind the
  seg-tabs, which meant two forms to keep in step, and the plan form was the one
  falling behind — flat 180-char details box, no rich body, an optional headline
  it didn't offer, its own copy of the audience lock. A plan is a note with a
  place and a time attached, so that is what it is made of now: the same rich
  editor every other type writes into, plus `eventFieldHtml`'s two fields
  shipped hidden beside the poll's and the frame's.
- **The words survive every flip.** Folding a surface leaves what's typed in it,
  and the headline and body belong to the form rather than to a type, so a
  mis-tap costs the tap back and nothing else. That is the whole reason this is
  cheaper than a switcher, which re-mounted a field set and threw the draft away.
- **The audience default follows the type, but only while it IS a default.** An
  activity stays circle-first for a public account, the way it always has
  (`canJoin` is friends-only, so a plan the whole room can read is still one only
  your circle can turn up to). Under the switcher that was settled once at mount;
  the type can now change under the reader's hand, so `syncDefaultAudience`
  recomputes it on the toggle — gated on `pubAudienceTouched`, which latches the
  moment the sheet writes an answer. After that nothing moves it but them.
- **The headline's placeholder carries the requirement.** It reads *Title
  (optional)* everywhere except an activity, where `submitComposer` refuses a
  post without one, so the box says *Picnic at the park* rather than letting the
  reader find out at the foot of the form.
- **The daily flow drops the calendar toggle and its surface** (`fieldsFor`'s
  `event` option), because an activity answers no prompt (`dailyAccepts`) and a
  button offering one there is offering a dead end. A quote has no attach bar at
  all, for the stronger reason that it isn't a type.
- **A live toggle is INK, never a fill.** Each of the four carried a disc of its
  own type pastel at ~24%, and the `Aa` styles button and the H1/H2/B/I row
  carried a grey one — all removed. This bar lives *inside* the note box, which
  is the quietest surface in the app, and a filled pill was the fill doing the
  shouting rather than the mark: four grey line glyphs and one pastel button
  reads as a chip left switched on. The colour alone is unambiguous, nothing
  else in the bar is coloured, and it is the same hue the nameplate and the
  masthead mark are already wearing — one type, one hue, three places, no extra
  geometry. `:hover` keeps its neutral fill on purpose: that is a pointer
  finding a target, not the form saying what it's making.

**Bars get the scroll edge effect, not a hairline.** `.topbar` and `.auth-topbar`
are a vertical gradient — heaviest at the very top (that band is the safe-area
inset, i.e. exactly where the OS clock and battery need something to read
against) and thinning toward the bottom edge, so content dissolves *into* the bar
instead of hitting a wall. The gradient **is** the edge, so `border-bottom` is
gone: a hard 1px rule under a fading bar draws the one line the effect exists to
remove.

**And as of 1.3 it is an EFFECT, not a permanent fill.** At the top of a page
nothing has passed under the bar, so there is nothing to separate it from: the
material is simply absent, the page runs clean to the top edge, and the controls
sit on it as the glass objects they already are. It fades in the moment content
starts sliding underneath — `.topbar--bare`, driven by `syncToolbarEdge`, the
same shape as the collapsing title (a boolean crossing with a 2px deadband for
iOS's rubber band, instant on navigation, never a per-frame value read off the
scroll). It lives on `.topbar::before` because it has to FADE and neither half
can do that in place: `background-image` doesn't interpolate between gradients at
all, and dropping the fill while the blur ramps is two events for one change. One
`opacity` transition on a layer carrying both does all of it. The status-bar
scrim goes to full strength while the bar is bare, the same answer it already
gives for `.topbar--hidden` — which is now two reasons the scrim matters rather
than one.

**And the two rules that take it there must restate the shell gate, or they
lose.** `.statusbar-scrim`'s baseline is `html[data-shell="installed"]
.statusbar-scrim` — an attribute plus a class, (0,2,1). A bare `.topbar--hidden
~ .statusbar-scrim` is two classes, (0,2,0), so the baseline outranks it and
0.8 is what the glyphs get in every state. That is not a hypothetical: the
deepen rule was written when the gate was `@media (display-mode: standalone)`,
which carries no specificity at all and let it win on source order, and the gate
became an attribute on `<html>` in the App Store commit. **The scrim was stuck
at 0.8 in the installed shell from that day until 1.3** — no error, no log, and
no visual tell short of noticing the clock over a scrolled feed, and invisible
in every other shell because the scrim isn't drawn there at all. Restating
`html[data-shell="installed"]` on the overrides reads as redundant and is
load-bearing. Measured on the simulator: 1 while bare, 1 while tucked, 0.8 under
a painted bar, at exactly the 62pt inset's height.

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

**Never glass on glass.** One material at a time: the FAB speed dial's discs
(`.nav-dial-ico`) sit on a veil that already blurs the frozen page, so they carry
no `backdrop-filter` of their own — a second sample per disc is redundant work
fighting the stagger transform each row animates through. The modal *veil* +
card is the one deliberate exception (iOS does the same with a dimmed backdrop
under a sheet).

**The two dials stopped being the same component in 1.3, on purpose.** They were
one recipe on two anchors — a fan of frosted 46px discs, each with its type
colour blooming behind the glyph, staggering in a row at a time. The **FAB's**
dial keeps all of it, because that vocabulary is exactly right for a set of
things you can *make*: objects you reach for. The **filter** dial is now a plain
panel-glass card of listed rows — glyph rail on the left, label, checkmark on
the live one — because "what am I looking at" is a list you *read*. A fan of
floating discs made the eye assemble a list out of scattered pills before it
could choose from one, and put a radial gradient under every row of the surface
whose whole job is to get out of the way. **Don't re-converge them**, and note
the filter dial's chrome is now all glass tokens, so it needs no dark-mode block
beyond the scrim.

**Every menu a toolbar glyph opens is that same card, and the card is no longer
the filter's.** `.bar-menu` (renamed from `.filter-dial` when it stopped being
one control's) is the panel: glass card, rows pinned under the button that
opened it, scrim over a frozen page. `openBarMenu` owns the panel and nothing
about what a row *means* — the scrim, the glass, the position, the focus trap
and the one way out — while `openFilterDial` fills it with radios and
`openGlyphMenu` with actions. The profile's **•••** and the **friends tie** were
still rising from the bottom as action sheets until 1.3: same bar, two buttons
apart, and the app answered one tap by dropping a card under your finger and the
next by throwing a panel up from the opposite edge. A menu belongs to the
control that opened it.

**What stays a sheet is everything with no control to belong to**, and the line
isn't fussy: a **confirmation** (delete a post, block someone, delete your
account), which comes second after the menu that offered it has already closed;
a **list of report reasons**, opened from a row rather than a button; a panel
opened from the **page** rather than the bar (the accent picker's colour ring,
the notifications switch's route into iOS Settings). And **the post card's own
•••**, which is the deliberate one — it is not a toolbar glyph, it rides a card
at an arbitrary scroll position, so a menu dropped from it would land anywhere
between mid-screen and the 40px gutter above the nav and the same tap would
produce a different-shaped thing every time.

Three things about the move. `openGlyphMenu`'s items are `{label, icon?,
danger?, run?}` — **deliberately `openSheet`'s own shape**, so a menu can move
between the two without being rewritten and a caller that grows a confirmation
step hands the identical array to a sheet. A **`danger` row carries its meaning
across rather than being restyled**: the same coral (`--type-find-ink`) and the
same haptic, which is the one in the app that fires on the *touch* rather than
on a confirmed write, because it warns about what's coming instead of receipting
what's done. And **`.bar-menu-item` states `min-height: 44px`** — the card's
padding alone measured **41.3**, which it got away with while it held nothing but
a filter and stopped getting away with the moment Block and Report moved in from
a sheet whose rows have always measured 46. A destructive row must not shrink
because its menu changed shape. It's the `--toolbar-btn` settlement again: a
full-width row has no need of an invisible `::after` to buy its 44, so the floor
is stated where the paint is.

**Tinted glass — the primary-action material, and what the lit dome became.**
The primary-act buttons — the compose **+ FAB** (`.nav-publish`), the composer's
**Post** pill (`.composer-post`), the gate's submit, Share Tria, the editor's
**Save** check, and the daily's **Add yours** in both places it is drawn — are
the brand band behind the app's ordinary glass: `--glass-edge`, `--glass-rim`,
`--glass-lift`, with the band thinned to `--pill-alpha`. Same three parts every
other glass surface in Tria is built from, so a CTA is recognisably made of the
same stuff as the toolbar and the sheets rather than out of a vocabulary it
alone spoke.

It replaced a **lit dome** in 1.3 — a top-left specular hotspot over a base
cavity shadow, so the button read as a glossy 3D bubble. Three things fell out
of retiring it, all worth keeping:

- **Dark mode needs no second recipe.** The dome's black cavity and drop shadows
  all but vanished on dark paper, so the volume had to be rebuilt out of light,
  which meant two hand-tuned copies of every button. The glass tokens answer the
  scheme once, in `tokens.css`. There is nothing left here to restate — and in
  particular no `background` shorthand to accidentally reset `background-size`
  with, which was the old trap.
- **`--pill-alpha` (0.85) is a CONTRAST FLOOR, not a style knob.** `--on-type`
  rides this fill and translucency composites the button against the page, so
  dark paper is the hard case. Measured across the four brand stops and all
  eight palette accents: worst pair is **6.04** at 0.85, **5.45** at 0.80,
  **4.91** at 0.75. That worst pair is a **reader's accent**, not a brand stop —
  the brand ramp is bright and measures 8.38 at its own worst, while an accent
  is pinned to L* 74 and is the deepest thing this fill ever carries. The margin
  is **wider** than the 5.51/4.98/4.50 this note used to record, because accents
  are normalised to one weight now and the palest and deepest measure the same;
  0.85 stays for how solid a primary button reads, not because 0.75 fails.
  Deepening `BAND_LSTAR` is what would bring the cliff back — that number and
  this one draw on the same account.
- **The FAB is the one OPAQUE member, deliberately.** It takes the same edge,
  rim and float but not `--pill-alpha`. It floats over the feed itself rather
  than over a form, so thinning it would show live content sliding through the
  app's most permanent object, and the **+** sits on that fill at every moment
  of the app's life — an opaque band is the only version whose contrast doesn't
  depend on what happens to be scrolling underneath.

**No `backdrop-filter` on any of them, FAB included**, and that is the same
glass-minus-blur settlement the masonry tiles already take. The bill is area ×
radius × moving-frames and the FAB is on screen on *every route* over a scrolling
feed — the exact cost this file refuses everywhere else. Fill, edge, rim and
float carry the read; the sample is the one part that would only be visible while
it was also being expensive.

The band also doesn't drift, and that predates the material change: the loop that
slid `background-position` across a 300%-wide gradient was a paint invalidation
at refresh rate, and the FAB's copy ran on every route. It is 1:1 now, which is
the truer statement anyway.

**The band is BRAND now, not the quintet, and that swap is what retired the
all-five rule.** Until 1.3 the gradient on these buttons *was* the five type
pastels, under a rule that all five had to appear on every one of them: the
gradient is the quintet, the quintet is the five things you can make, so a
button showing four says the fifth isn't on offer. Rose was dropped twice for
legibility (it sits at hue 336, between lavender at 255 and coral at 15, and on
a 122px pill those three smear) and put back both times, correctly — that was a
legibility complaint being paid for out of meaning.

What changed is what the band *says*. It is `--brand-band` (`css/tokens.css`):
**lavender → blue → green → orange**, four stops, pointed at `--type-note` /
`--type-photo` / `--type-activity` / `--type-find` so there is one copy of each
hex and dark mode is answered where the type fills already answer it. Borrowed
on purpose — these are the colours people already read as Tria — but it no
longer *names* types. On a primary button it is the app signing its own name on
the one act that is Tria's, and it says nothing about what you're about to make.
So four stops is not a type deleted from a set of five, and rose finally comes
out as the plain legibility fix it always was. **Nothing about the quintet
changed anywhere a hue actually names a type** — a filter row, a heart, a tag,
the pull-to-refresh dots, a daily's card. Those five are untouched, and a hue
naming a type is still the only thing the quintet is for.

The **order** survives intact and is still not negotiable: sorted by hue, 255 →
195 → 83 → 15, monotonically descending, so the band is one continuous ramp
rather than a climb and a fall. It is still NOT `FILTERS` order — the
pull-to-refresh quintet is the opposite case and correctly uses filing order,
five discrete dots where the sweep argument has nothing to say.

**The colour source has THREE rows, and the third one is why.** The picker's
"Colour source" group is **Default** (Tria's brand ramp) · **Photo** (sampled
from your avatar, still what a null `accent` means) · **None** (monochrome).
Until 1.3 it had two, and `'none'` and "no accent set" both landed on the same
line in `paintBrandBand` — `set(null)`, which removes the properties and lets
`--pill-band` fall through to `--brand-band`. So the row named *no colour*
painted the most colourful button in the app. They part now: `'default'` takes
the removal, `'none'` stamps `--mono-band`. Three things about it:

- **No migration.** `users.accent` is plain `text` with no check constraint, so
  a value the DB has never seen writes and reads like any other, and an older
  client meeting a `'default'` row falls through to the photo path — i.e. to the
  same brand ramp the row is asking for.
- **The mono band is stamped as `var(--mono-band)`, not as a literal.** A custom
  property holding a `var()` is substituted at the point of USE, so it resolves
  against whichever scheme is live when a button paints and no JS has to know
  which that is. Dark mode stays answered once, in the tokens. Same trick the
  two heart weights already lean on.
- **`'default'` gets no `.ambient` wash**, joining `'none'` in `withAccent`. A
  wash is one hue lighting a page and neither "Tria's ramp" nor "no colour"
  names one. The buttons are where those two differ.

**The brand ramp is BRIGHT on dark paper, and that is a decision that was
tested.** `--band-deepen` mixes each pastel toward its `-ink` twin, and the dark
block sets every `-ink` twin equal to its pastel, so the mix resolves to the
pastel and the ramp arrives undeepened in dark mode. A deepened version was
built and reverted: it evened the four stops to a common L\* 65 and measured
beautifully. It was still wrong. This gradient is the app signing its own name
on the primary act and the brand reads bright — muting it on dark paper made the
one permanent object on the screen recede exactly where it should carry. **Don't
re-derive the even version**; it has been measured and turned down. Deepening
belongs on a reader's accent instead, which is the next note.

**The band travels through OKLAB.** sRGB interpolates down the straight line
between two hex values, and between two pastels that line sags — the midpoint
comes out duller and a shade darker than either end, so four stops read as four
bands with three grey seams. Worst exactly where the band is smallest: on the
60px FAB the gradient is the whole button. Same four stops, same 115deg, same
order; only the travel between them changed. It sits behind
`@supports (background: linear-gradient(in oklab, …))` because the deployment
target is **iOS 15** and this landed in Safari 16.2, and it has to be a feature
query rather than a second declaration — an unregistered custom property accepts
**any** token stream, so a `--brand-band` an engine cannot parse would still win
the cascade and take the fill to nothing at the point of use. The `--spring`
block above it is the same shape for the same reason.

**`--pill-band` is declared exactly once**, in `tokens.css`, as
`var(--user-band, var(--brand-band))` — and both halves of that matter. It used
to be written out by hand in two places, the `.is-solid` fill and
`.publish-fill::before`'s resting ring, which are the same band in two modes
(the ring IS the fill with a mask over it), so a stop dropped from one and not
the other made *hovering a button reshuffle its colours*. One declaration, five
readers, nothing left to drift. The `.splash-t` boot mark is the deliberate
exception and reads `--brand-band` directly: it paints before auth resolves, so
there is no reader whose colour it could be wearing (see the splash below).

**A reader's accent rides the same buttons, and it is YOUR accent, not the one
you're looking at.** `--user-band` is stamped on `<html>` by `paintBrandBand()`
from `Store.currentUser()`, and absent is the meaningful state — "no colour",
the gate, and the frames before auth resolves all fall through to the brand ramp
with no branch for it. Two things about it:

- **It must not be confused with the `.ambient` wash.** They wear the same
  palette and answer different questions: the wash is the person whose *page is
  on screen* and changes as you browse; the buttons are your app chrome, the
  same on every route. (The composer is where the two coincide — its wash is
  yours, because the page is — and that is a coincidence of subject, not a
  merge.) Repainting your Post button in a stranger's colour while
  you scrolled their profile would be the app telling you something false about
  whose app it is. Hence `paintBrandBand` reads the current user and
  `applyAmbient` reads the route, and they deliberately do **not** share
  `ambientSeq` — a stale-sample cancel is right within one question and wrong
  across two.
- **"None" is the one fill that FLIPS with the scheme, because a neutral has
  nothing but lightness to separate it from the page.** Every chromatic fill
  here is light in both schemes and separates by hue; grey cannot, so a light
  grey button on light paper is not a quiet button, it is an absent one —
  `#f5f6f8` on `#edeef0` measures **1.10**, and it shipped that way for an
  afternoon. `--mono-band` is ink-side on paper and paper-side on ink, and
  `--mono-ink` is the glyph that rides it. Measured: **8.90** fill-against-paper
  and 9.55 glyph-on-fill in light, 17.63 / 16.64 in dark.
  - **`--pill-ink` is the other half and is declared once**, as
    `var(--user-ink, var(--on-type))` — the same shape as `--pill-band` right
    above it, so the fill and its glyph travel together. Six rules read it
    (`.publish-fill` solid/hover/focus, `.auth-submit`, `.nav-publish` and its
    current-page state); none of them know which band is live.
  - **`--user-ink` is stamped in the same call as `--user-band`** and is absent
    for every chromatic band, which is not an omission — an accent and the brand
    ramp both want the near-black `--pill-ink` already falls back to. A light
    glyph arriving a frame after a light band is a **+** you cannot see, on
    every route.

- **Three palette accents have moved OFF the quintet, and that decoupling is
  the point.** A palette's job is nine choices a reader can tell apart; the
  quintet's job is five type identities. Where those disagreed the palette lost:
  measured, cyan sat **20.8°** from ocean — closer than the band's own **32°**
  sweep, so their gradients overlapped and each ended partway through the other
  — and rose's red end came within **6.7°** of coral's pink end. Cyan
  `#9fd6e8`→`#88e4f2` (hue 194.8→188), ocean `#8fb4ea`→`#5f95f2` (215.6→218),
  rose `#ea86ae`→`#ea8696` (336→350; rose has since moved again, to `#ea7b8e`,
  and split off Ruby — see the declared-band note below). **`--type-photo` and
  `--type-poll` are untouched**: a Photo card is still cyan and a poll still
  rose.
  - **Ocean's hue is 218 and not 228, and that took two goes.** It first went to
    228 to buy clearance from cyan, and 228 plus the arc lands the last stop at
    **239** — where R catches G and the band turns violet, on lavender's
    doorstep. That check is that cheap: while **G leads R** the eye calls it
    blue, and it holds at every depth ocean has been drawn at (the +11 stop was
    `#9baaef`, G ahead by 15, at the old L\* 74; it is `#7990f4`, G ahead by 23,
    at today's L\* 65 — lavender correctly runs negative throughout). 8° of
    clearance from cyan is enough because two bands read from their centres, and
    those are a turquoise and a blue. **What this
    note used to say is that ocean's depth came from *saturation*,** which was
    making the best of a lever that doesn't reach: under the inherited recipe a
    hex's lightness is discarded and its saturation clamped, so ocean's deep hex
    bought a deeper profile *wash* and a button identical to everyone else's.
    It declares its own band now.
  - **`BAND_ARC` is 11°, down from 16.** Hue moves alone were not enough — the
    blue-green quarter holds four accents in 97°, and at ±16 they need 128. At
    a 22° span every neighbour clears, the tightest being coral→amber at 22.9
    and rose→coral at 24.7. Widening it re-opens both.
  - **A hex's LIGHTNESS now only decides the wash.** The band re-pins L\* and
    clamps saturation, so a brighter hex buys a brighter *profile page* and an
    identical button. That is what caps cyan: at HSL l 0.80 it was a lovely
    swatch and took `--wash-ink-soft` on a dark profile to **4.40**, under AA.
    0.74 measures 4.58, beside lime's 4.65. Re-measure that ink, both schemes,
    if a palette hex ever moves again.

- **A reader's accent is pinned to a perceptual weight, and that one change
  fixes the band AND the heart.** `BAND_LSTAR` = **74** (`bandFrom` in app.js).
  Both were pinned in **HSL lightness** before — 0.78 for the band, 0.52/0.78
  for the heart — and HSL lightness is not perceptual: the same 0.78 lands
  lavender at L\* 71.7 and lime at **L\* 89.0**, nearly white, because the eye
  reads green as far brighter than blue at equal HSL L. So the eight accents
  were spread over 17 points of real lightness on the buttons and **43** on the
  hearts. Pinning L\* levels them, and level is what lets the set move at all.
  - **74 is a settlement.** Two versions shipped for an afternoon each: the old
    pale 80.5 and a deep 68. 68 read as a different app's button rather than as
    Tria's in a colour. The floor is real but lower: measured across all eight
    accents and every hue on the wheel, `--on-type` gets **6.01** at L\* 74,
    **5.05** at 68, **4.62** at 65, **4.33 — a fail** at 63, with the binding
    surface the **thinned** one on dark paper (the FAB is opaque and never the
    hard case). Deeper than 68 needs a lighter ink, which is a second ink rule.
  - **The lime heart was invisible, and that is what "cohesive" was about.** At
    HSL 0.52 the accent hearts ran L\* 37.0 (lavender) to **80.2 (lime)**, and
    lime measured **1.3** against `#edeef0` — picking Lime turned your likes
    off. Pinned, every accent measures **3.46–3.50** on paper and **9.37–9.43**
    on ink, both inside the per-type hearts' own ranges (3.02–4.04 and
    7.73–12.63), so an accent heart sits where a type heart sits.
  - **In dark mode the heart IS the band's weight.** `HEART_LSTAR_DK` is
    `BAND_LSTAR` by reference, not by a copied number — measured, the dark heart
    and the band's mid stop land within **0.1 L\*** for every accent. Light
    can't join them (a mark at 74 vanishes into paper, which is the bug above),
    so it drops to `HEART_LSTAR_LT` = **53**, the per-type hearts' mean.
  - **THREE ACCENTS DECLARE THEIR OWN BAND, and 74 governs the other six.**
    The palette is **nine**, because rose split into **Ruby** (L\* 65) and
    **Rose** (L\* 72); **Ocean** joined them on 2026-08-24 at L\* 65. All three
    wear the **same near-black `+` as every other accent** — 65 is the floor
    where `--on-type` gives out, and both deep ones stop exactly there. Ruby
    spent a day at L\* 42/44 with a white `--user-ink` and came back up: one
    glyph colour across the whole palette is worth more than one deeper red.
    Rose is at 72 rather than 65 because the two hexes are **1.1° apart** and a
    band re-pins lightness *and* chroma, so at a shared 65 they painted
    `#f47ba5` and `#f47ba6` — the same colour twice. Depth is the only axis
    left to separate them on. An `ACCENTS` entry may carry
    `band: {lstar, sat}`, which
    **replaces** the derivation rather than capping it — the old `sat` clamp is
    a ceiling, so `min(0.85, a duller hex)` silently hands back the hex and
    paints the band you didn't ask for. Absent, which is the other six and
    every sampled photo colour, is exactly the behaviour above, so **moving 74
    still moves the palette.** Why it had to exist: at L\* 74 every red is a
    pink, and that is a *lightness* fact — at 74, saturation .72 → 1.0 moves
    OKLCH chroma .096 → .125 and still paints `#ff98aa`. **65 is the bottom of
    the palette**, and going under it means leaving the set — see below.
  - **A declared band has TWO landing zones and nothing between them, and the
    OPAQUE FAB is what makes the gap uncrossable.** The near-black ink is
    bounded from below by the thinned fill on **dark** paper; a white ink is
    bounded from above by the FAB, which has no scheme to vary with. Measured at
    ocean's hue: near-black holds to L\* **65** (4.68) and fails at 64 (4.48);
    white doesn't clear the FAB until **48** and the light thinned fill until
    44. So an accent is a deepened pastel at ~65 or a gem at ~44, and **nothing
    lives in the lower zone today** — `--user-ink` stays wired end to end
    (`ACCENTS` `ink` → `paintBrandBand` → `--pill-ink`) because it is the only
    thing that makes that zone reachable, but no accent sets it. **And there is
    no per-scheme ink to bridge it** — the natural answer in the gap is
    near-black on light paper and white on dark, but at L\* 52 the FAB measures
    3.85 against the near-black and 3.96 against the white, so a glyph that
    flipped by scheme would fail on that button in *both*. One ink per accent is
    what the FAB permits, not a shortcut. Final: ruby 4.65 / 6.90 / 6.06, ocean
    4.68 / 7.08 / 6.09, rose 5.69 / 8.39 / 7.55 (thin-on-dark, thin-on-light,
    opaque FAB).
  - **The hex and the band have fully parted, and the hex is now tuned for the
    WASH.** A declared band takes lightness and chroma from the recipe, so rose
    `#ea7b8e`, ruby `#c32842` and ocean `#5f95f2` exist only for `.ambient`
    (which paints them straight) and `heartsFrom`. They look duller than the
    bands they produce, and that is correct — don't "fix" a hex to match its
    button. **Ocean's hex deliberately did not move** when its band deepened,
    so its profile page stays the blue it has been and its wash figures are the
    ones already measured. Two costs, both
    accepted: **a deep band no longer matches its own heart on dark paper**
    (`HEART_LSTAR_DK` stays 74 and a band at 65 is nine points off it — a heart
    that followed a band down is the lime-heart bug in red, which is the worse
    failure), and **`app.css`'s 5.89 wash-ink figure was measured
    over eight accents** — ruby is the deepest hex the wash has ever carried
    (L\* 43.5 against a previous floor of ocean's 61.9) and is **not**
    re-measured there; the note beside it says so and names the lever.
    Ruby's key is new, so an older client falls through to the brand ramp;
    **rose keeps the key `'rose'`** so everyone who already picked it lands on
    the rose above rather than on nothing, and ocean keeps `'ocean'` so an older
    client just paints the light blue it already knows.
  - **The swatch grid is ROYGBIV, 3×3.** `ACCENTS` is sorted by hue from the red
    end — 350 · 15 · 40 · 83 · 158 · 188 · 218 · 255 — which deals warm / green
    / cool as the three rows. Ruby and rose are 1.1° apart, so depth breaks that
    tie and the true red leads the pink. **Nothing reads the array by index**
    (the picker maps it; everything else goes through `accentOf` on the stored
    key), so the order is presentation only and free to change.
  - **It is also the only reason the Photo option can touch a button.**
    `glowNorm` pins a sample to HSL 0.55 — right behind a wash, wrong under
    text, where a saturated blue measures **2.30** against that ink. Neither
    source is trusted; both are pinned here.

**The boot splash TURNS, and the mark is Tria's rather than the reader's.**
`.splash-t` walks the four brand stops one position along its 115deg gradient
every second, so the whole band passes through the glyph inside the curtain's
own life. Two halves of that are worth keeping:

- **It wears no accent, deliberately.** A version reading a `--user-band` cached
  in localStorage was built and taken out. The splash is static HTML precisely
  so it paints before any script, which means the only accent it could ever show
  is the one this install wore LAST time — and a curtain that is sometimes your
  colour and sometimes the brand's is the app looking uncertain about whose name
  is on the door. It is the door. It says Tria. Keeping no cache also keeps
  `--user-band`'s absence load-bearing everywhere it matters: there is nothing
  for the gate to paint its submit button with by accident.
- **The rotation is four registered `@property` colours interpolating in
  place**, not a `background-position` slide over a widened gradient. A 115deg
  ramp slid horizontally does not advance by a whole period — the shift maps
  onto the gradient axis through `sin(115deg)` while the period is set by a line
  length carrying the box's height too — so that version seams once a second
  unless the ramp is flattened to horizontal. Rotating the stops is seamless by
  construction and keeps the brand angle. Unregistered properties would step
  between keyframes instead of interpolating, the same reason `--glow-wash` is
  registered. The stops are named once in `tokens.css` (`--band-note` /
  `--band-photo` / `--band-activity` / `--band-find`) and `--brand-band` is
  built from the same four, so the mark that turns them and the button that
  paints them cannot drift.

It **is** the per-frame repaint of a text-clipped gradient that the old 2s loop
was removed for, and the cost is real. What makes it affordable is that it is
bounded where that one wasn't: one glyph, one element, about a second and a half
before `dismissSplash` removes the node. If boot ever needs those frames back,
drop the second animation and the mark falls back to the band at rest.

**Page changes have NO transition, as of 1.2.** `renderPage` builds the
destination and mounts it in the same task as the navigation: the new page is
there on the next frame and the old one is gone. There is no `.page.leave`, no
outgoing pin, no `instant` flag, no cleanup pass, and nothing to sequence against
— the whole thing is `replaceChildren` plus a scroll settle.

**Every step that got here was a real fix, and the last one was removing the fix.**
Pages first *slid* along a nav line, which read as snapping on Discover, whose
grid is dozens of photos still decoding while the slide ran. So it became a cross
dissolve, which flashed — not a mistimed animation but arithmetic: two ramps
crossing means neither layer is opaque mid-move, so the composite was `0.5·out +
0.25·in + 0.25·PAGE BACKGROUND`, and that quarter of bare `--bg` landed on the
ink (measured: the arriving page's type sat 31 luminance points lighter at the
midpoint). So it became ONE fade, destination mounted opaque with only the
outgoing layer dissolving off it, which fixed the flash completely and was still
240ms of the app withholding a page it had already finished building. Nothing was
broken by then. The fade itself was the cost, and a route change is not an event
that needs narrating. **Don't reintroduce a slide, a scale, an entry blur, a
cross dissolve, or a single fade**, and keep pages off `will-change: transform` —
it makes a page a containing block for any `position: fixed` child. No page has
one now that the Updates switcher is inline, and that is worth not undoing by
accident from either end.

**The two things the fade was quietly paying for still have to be paid.** Both
survive, and without them "instant" just relocates the wait — the page frame
lands at once and then assembles itself in front of the reader, which is the
sluggishness this removal was for wearing a different coat:

- **`renderPage` freezes every row it just mounted** (`.card, .notif,
  .request-row, .ptile`, inline so it can't replay) so a navigation never plays
  a per-row rise. Discover is why this is strict rather than tidy: it mounts its
  whole grid at once, so before the freeze covered `.ptile` an arrival there ran
  87 concurrent animations with a burst of bitmaps decoding under them — the
  pile-up behind the iOS WebKit crash. **Any new page-level row entrance has to
  join that list.**
- **`.page.enter` holds photo fades off for one beat** (`SETTLE_MS`, 240) on
  `.photo-frame img` + `.ptile-face--media img`. It is now the *only* thing that
  class does. A page that arrives complete in one frame and then dissolves a wave
  of photos up through itself is a second move stapled to a change that was
  already over, and readers read that as loading.

The row entrance itself is not gone, it is scoped: it plays on a **discrete act**
(landing, a filter, a tag, clearing search) and stays out of **typing** and
**background re-pulls**, via `paint({ stage })` → `layoutGrid(fresh)` →
`.pgrid--settled`. A profile's frame wall inherits all of it for free: its tiles
are `.ptile`, so the freeze already covers them, and `paintPosts(stage)` →
`dealMasonry(fresh)` is the same contract. Rows that arrive *without* a page
change still rise — that's a thing happening, which is what the entrance is for.

**The App Store build's BACK GESTURE needed a special case, and no longer does —
but the trap it sat on is still there.** `TriaViewController` turns on
`allowsBackForwardNavigationGestures`, and that gesture is not a passive input:
WebKit slides a snapshot of the destination in under the reader's thumb, and
because Tria's routes are same-document hash changes it drops that snapshot the
moment the navigation commits, waiting for nothing to paint. While the router
still drew a fade, the live document at that instant was the page you'd swiped
away, so the move ended on *that* page snapping back to full opacity and then
dissolving for a quarter second — two transitions for one gesture, reading as a
reload. Instant rendering fixed it, and now everything is instant, so the case
has dissolved into the general rule. **If a page transition is ever reintroduced,
this is the bug that comes back with it — and `popstate` is NOT how to dodge it.**
`popstate` is specified to fire for traversals and not for a fragment assignment,
but WebKit fires it for `location.hash =` as well, in the same `popstate →
hashchange` order, so a tap and a swipe back are byte-identical by event (measured
on WebKit 26.5). The only reliable tell is whether `navStamp` **minted** the
history key (a push) or **found** it (a return), which is the same stamp the
scroll memory runs on.

**`settleScroll` stays a callback, and nothing may move the scroll after
`renderPage` returns.** There are three destinations — the top, a spotlighted card
`parkCard` already jumped to during `renderFn`, and a remembered position from
`restoreScroll` — and only the caller knows which. This mattered doubly under the
fade, because the outgoing page's pin was measured against wherever the scroll
finished; the pin is gone but the rule stands, since `syncTopbar` is placed off
the settled position and a later jump leaves the bar answering the wrong page.

**Scroll is remembered TWICE, and the two memories answer different questions.**
`scrollMemory` is keyed per history ENTRY (`navStamp`), which is exactly right for
a back or an edge-swipe and useless for a tab: tapping Circle from Discover mints
a *new* entry, so there is nothing on file and you land at the top. So `pathScroll`
is a second memory keyed by PATH, consulted only when the entry key comes up
empty. `restoreScroll(key, path)` reads them in that order.

**Only Circle and Discover keep the path memory** (`TAB_SCROLL`). Those are the
two pages you live in and scroll deep. Updates, a profile, About and Publish are
pages you arrive at to read from the top, and one that opens halfway down for a
reason you can't remember is worse than one that opens where it starts. The two
ways to clear a held position are the ones that already existed and already say
what they do: re-tap the tab you're on, or pull the page down (which only arms at
the top anyway) — both end at the top, and leaving then files that.

Two guards, because a held scroll outliving its account is the failure here.
`rememberScroll` **never files from the gate** — the signed-out branch returns
before it advances `lastPath`, so on a dropped session `lastPath` still names the
authed page while the scroll on screen belongs to the login form. And logging out
**clears both maps**, or the next person to sign in opens someone else's feed
part-way down.

**A jump is not a scroll gesture.** The topbar's hide-on-read handler ignores any
scroll delta larger than a viewport, because the router teleports the window (to a
spotlight, to a remembered position, back to the top) and a thousand-pixel jump
was reading as "scrolling down fast" — so landing on a post also slid the bar
away, a second move stapled onto a navigation meant to have none.

**A spotlight has no travel and no wash — and there is only ONE left.** Discover,
Updates and the frame wall all open `#/p/<id>` now (see the post-page note under
Backend notes), so the only thing still setting `spotlightPost` is the edit flow,
which lands on your profile with a post's editor open. The rest of this note is
about that one case, and about why the travel must not come back if another
caller ever appears. Setting `spotlightPost` makes the render call `parkCard`, which
moves the scroll **synchronously, inside `renderFn`**, so the position is set
before the new page's first paint and the post is simply where the page opens. It
used to glide 460ms to the card and then flash a tint over it, both starting 120ms
after the route settled — three moves stacked on one tap, and the travel got
longer and more obviously wrong the older the post was, since a spotlight
routinely aims a thousand pixels down a feed. Don't reintroduce either: landing
already there isn't a cheaper animation, it's the right one, and a highlight
answers "which one did I mean?" when nothing asked. What `parkCard` **keeps** is
the silent 900ms re-aim after landing — lazy media resolving *above* the card (a
legacy photo swapping its 3:2 reserve box for its real shape) shoves it down, and
on a page that has only just landed that reads as the post sliding away.

**The seg-tabs rise went with the fade, then the dock went, then the control
did.** The Updates switcher used to float above the bottom nav, tucked behind the
pill on arrival and released a frame later. The rise came out first, for the
fade's own reason: the router only ever played it when the outgoing page had no
switcher of its own — two copies of the same fixed control at the same
coordinates never moved, so animating one is inventing a move, and on a page that
arrives instantly *nothing* moved. The dock came out after (see the design-system
note above), and in 1.3 All / Mentions became a toolbar filter like every other
page's, so on Updates there is nothing left here to sequence at all — and with
the composer's Post / Activity gone the same way, the control itself is deleted.
(The arriving
page's glass has stayed live since the one-fade change, for
the neighbouring reason: `backdrop-filter: none` applied to a promoted fading
layer, and the destination is neither, so a page used to land wearing flat glass
and frost up on cleanup — a little pop of the material switching on at the end of
every navigation.)

**Share is the tray, and the tray is not in the header any more.** `ICONS.send`
is the arrow-out-of-a-box the OS itself draws for share, not an envelope (an
envelope promises a message you compose; these buttons hand a link to the OS).
Its mouth matters: an early circular vessel with a narrow break reads as the IEC
standby/power glyph at 22px, so if the vessel is ever redrawn, check it at true
disc size, not at 96px.

Its history is three removals in a row, each for the same reason. It began as a
sprout opening `#/support` — a note from Zoe with the share button at the bottom,
which put a page between someone and the thing they meant to do. The note moved
to an About fold, then was removed outright (`#/support` redirects to `#/about`),
leaving a glyph in the header that fired `shareOrCopy` in place. Then 1.3 gave
the bar to the page, and a *generic* action on every page is exactly what the bar
stopped being for: sharing Tria is not something you do from Updates. So the
header disc is gone too, along with the path data index.html used to inline for
it (the header painted before app.js ran, so that copy and `ICONS.send` had to be
changed together — no longer a hazard). What remains is where sharing belongs:
**Share profile** in a profile's ••• sheet, a post's own ••• menu, and the
invite banner at the foot of Discover.

**Comments are a growing textarea, not a one-line input.** The comment composer
auto-grows to fit its text (wraps into view instead of scrolling off one line);
Enter posts, Shift+Enter breaks a line. It stays flat editorial (comments are
content, never glass). Post-photos fade in as they load over the neutral
placeholder box (JS adds `.is-loaded`), so they settle rather than pop.
