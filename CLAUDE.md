# Tria — working notes for Claude

A social web app for small circles of friends. Tagline "Social Media is so back."
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

## Before you call an app.js/store.js change done
Run a headless boot pass — `node --check` alone once shipped a runtime
ReferenceError (a name deleted but still referenced in a template literal parses
fine). Launch Chromium (Playwright is cached locally), listen for `pageerror` and
console errors, load the page, assert `#view` has content and there are zero
errors. This is a correctness gate separate from Zoe's visual preview.

## Copy style
User-facing copy uses commas and periods, **no em dashes** (code comments are
exempt). Voice is playful but not trying-too-hard.

## Backend notes
- Login is by **email**; username is the public handle. Email confirmation is off.
- The Supabase service key was rotated/deleted, so **only Zoe has DB admin** —
  Claude can't run SQL or clear accounts. Migrations in `supabase/*.sql` are run
  by her in the dashboard (`schema.sql` already folds them in for fresh installs).
- **Private likes** are enforced at the data layer: RLS hides other authors' like
  rows, so the cache can't compute someone else's count. **Headcount/RSVPs are
  public** by design. **Friends are directed edges** (request → mutual on accept).
- **Private accounts** (`users.private`, defaults true, so new signups open
  closed): when private, only mutual friends see your posts. Enforced at BOTH
  layers — the profile view shows non-friends an "add them to see posts" nudge,
  and RLS won't hand them the rows (`can_view_post` wraps `can_see_post` with a
  mutual-friend check; see `supabase/profile-privacy.sql`). Toggle lives in Edit
  profile. Activities stay friends-only regardless (app-level gate, unchanged).
- Post photos are stored at native aspect ratio (not cropped); only avatars crop
  (circular). Push notifications: see `supabase/PUSH-SETUP.md`; the Edge Function's
  real slug is `swift-processor`, not `push`.

## Design system (short version)
Austere, editorial, cool greyscale base. The only chromatic color is a pastel
quartet reserved for the four post types: note = lavender, find = coral,
photo = cyan, activity = lime. Instrument Serif on titles only; Oxygen everywhere
else. Circular avatars. Don't touch the hue-drift gate wash — Zoe loves it. All
motion is reduced-motion aware.

**Liquid glass — the material rule.** Frosted glass (translucent fill + backdrop
blur + hairline border + lit top rim + float shadow) is reserved for the layer
that *floats above* content, never for content itself. Two tiers: **chrome**
(nav rail, seg-tabs, search field, nav dial — `blur(18–24px)`) and **floating
panels** (modals, autocomplete menus, and the Updates notification + soft-ask
cards — `blur(24–30px)`). Content lists — the feed, the Friends *directory*,
comments — stay flat editorial rows. The Friends *modal* (a popover) is glass;
the Friends *page* (a roster) is flat — that split is correct, not inconsistent
(mirrors iOS: lock-screen notifications are glass, Contacts rows are not). On
phones the Friends/Updates view switcher (seg-tabs) is docked chrome, not an
inline row: it floats just above the bottom nav and *rises up from behind it*
when a page becomes active (router tucks it while the page slides in, releases
it on settle). The bottom nav hugs the home indicator (small float, iOS Liquid
Glass style), not lifted into the screen. **Corner scale:** 3px incidental (`--radius`) · 8px small containers
(`--radius-img`) · 12px composer inputs · 14px photos + glass menus/cards ·
18px nav rail · 20px glass modals · 999px pills. The pastel `publish-fill`
gradient stays reserved for the primary publish/share action — don't spread it
to every button, or it stops meaning anything.

**Lit dome — the primary-action material.** The two hero commit buttons — the
compose **+ FAB** (`.nav-publish`) and the composer's **Post** pill
(`.composer-post`) — aren't flat pastel discs: the drifting quartet sits under a
fixed lit dome (top-left specular hotspot + base cavity shadow + contact/ambient
float) so they read as glossy 3D objects with a real, non-wandering light source
(only the colour band drifts; the highlight/cavity stay pinned). **Dark mode
carries the volume with light, not shadow:** the black cavity + drop shadows all
but vanish on a dark surface, so dark brightens the hotspot and adds a crisp lit
top rim instead. Keep the colour-band scale (`300%`, 2–3 hues in view) identical
across modes — only the gloss is scheme-tuned; redeclaring the `background`
shorthand silently resets `background-size`, so always restate it.

**Comments are a growing textarea, not a one-line input.** The comment composer
auto-grows to fit its text (wraps into view instead of scrolling off one line);
Enter posts, Shift+Enter breaks a line. It stays flat editorial (comments are
content, never glass). Post-photos fade in as they load over the neutral
placeholder box (JS adds `.is-loaded`), so they settle rather than pop.
