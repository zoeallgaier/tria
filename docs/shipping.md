# Building, reviewing, shipping

## Zoe reviews on her phone, on the real build

There is no live preview any more. The VSCode Live Server loop is retired: a
change is not reviewable until it is in a build on her device, which means the
sync step below is not a chore that can wait for an Xcode day, and it means
Claude has to check its own work before handing anything over — the headless boot
pass and a simulator screenshot are the two gates that used to be "Zoe will see
it in a second".

## The loop, in order

1. Make the change.
2. `./bump.sh` — the `?v=` stamp, same number on all five asset lines in
   `index.html`. `./bump.sh 70` sets an explicit number.
3. `./ios-sync.sh` — mirrors the assets into `www/` and runs `cap sync`.
4. Headless boot pass (below), for any `app.js` / `store.js` change.
5. Build and launch on the simulator, screenshot, look at it.
6. Hand it to Zoe. She builds to her phone and reviews there.
7. Commit and push to `main` — **after** the iOS work, never before it.

**Bump first, then sync**, so the stamp the bundle carries is the one that
shipped. **Verify by grepping the bundle**, not by trusting the script's output:
`grep` the new stamp in `ios/App/App/public/index.html` and a name from the diff
in `ios/App/App/public/js/app.js`.

**Never edit anything under `www/` or `ios/App/App/public/`.** Both are
generated; `www/` is gitignored. The one exception is the haptics probe (see
[ios-shell.md](ios-shell.md)), which reads from that copy on purpose and
regenerates after.

**Why the sync is half of "done".** The webview loads a bundled copy, so the
`?v=` self-updater cannot reach it: an unsynced change is simply absent from the
app, and it is absent *silently*. Nothing errors, nothing looks stale, the old
build just runs — which is indistinguishable from "Claude's change didn't work",
and puts Zoe debugging a fix that was never on the device.

## The headless boot pass

`node --check` alone once shipped a runtime ReferenceError (a name deleted but
still referenced in a template literal parses fine). Launch Chromium (Playwright
is cached locally), listen for `pageerror` and console errors, load the page,
assert `#view` has content and there are zero errors. It is a **correctness**
gate, and it is blind to everything the device decides — safe-area insets are
zero there, there is no haptic hardware, and the App Store build's own shell
predicates answer differently. A simulator run is a separate gate and catches
what this can't; the install-tutorial bug was a clean boot pass and a clean
`BUILD SUCCEEDED`.

`?demo` in the URL (e.g. `/?demo#/updates`) forces the push pre-prompt card to
show regardless of permission state — handy for looking at UI that is otherwise
state-gated.

## Git, and the web

GitHub Pages serves `main` root, so **a push to `main` is a web deploy** (~1 min,
auto). Push straight to main — no PRs, no feature branches — but push **after**
the iOS change is made, synced and verified, not as a way of saving work in
progress.

**Nothing may sit uncommitted.** The gap between "done" and "on a phone" is now
measured in App Store builds, so the repo is the only place the work is real in
the meantime. That has bitten this project twice: a working copy of `js/app.js`
and `css/app.css` was replaced by an older one while the only newer copy sat in
the gitignored bundle, and one sync from a stale source destroyed a finished
pass that had to be restored from a scratch copy.

**The review queue is the release cycle.** Work committed today reaches phones
when the next build is submitted and approved. `MARKETING_VERSION` is **1.3**;
everything in the tree accumulates toward **1.4**.

## What the web still is

It stays live and it stays correct. It is not reviewed, it is not where anything
lands first, and it is not worth a turn of work on its own — a hover state or a
desktop breakpoint is worth doing only when it is free. Two things follow:

- **The web keeps the CSS glass chrome exactly as it is.** 1.4's native chrome is
  gated to the app (see [native-chrome.md](native-chrome.md)); the CSS nav, the
  CSS toolbar and the CSS post bar are the web's and stay.
- **The `?v=` bump still matters**, because the stamp drives the web's
  self-updater as well as busting caches. Docs and tooling changes don't touch
  assets, so they don't need one.
- **`sw.js` is web-only and caches nothing, on purpose** — it exists for web
  push and nothing else, so it can't fight the `?v=` self-updater. `app.js`
  skips registering it in the app entirely (`nativeShell()`). Don't "finish" it
  into an offline cache; the app is already a bundle.
