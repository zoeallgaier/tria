# The iOS shell

Tria is an **iOS app**. `ios/` is a **Capacitor 8** wrapper whose webview loads a
**bundled copy** of the same HTML/CSS/JS the repo root holds — `ios-sync.sh`
mirrors them into `www/` (gitignored; Capacitor rejects a `webDir` of `"."`,
which is the only reason that folder exists) and runs `cap sync`.

Bundled, not `server.url` pointing at a live site: a thin wrapper around a URL is
the clearest reading of guideline 4.2 "repackaged website", and it shows a blank
screen on a bad network, which review does test. The cost is the one named in
[shipping.md](shipping.md) — **the `?v=` self-updater is a no-op in the app**, so
a change reaches a phone only through a new build.

`TriaViewController` is a `CAPBridgeViewController` subclass because
`prepareWebView` hard-sets things `capacitor.config.json` cannot reach: it turns
the scroll bounce back on (the rubber band **is** pull-to-refresh), turns on
`allowsBackForwardNavigationGestures`, paints all three surfaces with a dynamic
`--bg` so an overscroll doesn't open a white seam, and registers app-target
plugins from `capacitorDidLoad`. `Main.storyboard` names it as the scene's
`customClass`; if that is ever reset to `CAPBridgeViewController`, every one of
those goes silent with nothing in the log.

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
while bisecting. The real cause was the card signature (see **A disclosure is not content** in [data.md](data.md)). If the buzz is ever re-argued, re-argue it against a panel
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

