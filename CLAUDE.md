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
  by her in the dashboard; `schema.sql` folds them all in for fresh installs.
  **Careful with `create or replace function` in a new migration** — a rewritten
  `can_view_post` once silently dropped the block gate a previous migration had
  folded into it (see `restore-block-gate.sql`). When you touch that function,
  restate *every* clause it's accumulated, and re-read the current definition
  first rather than layering on an older copy.
- **Private likes** are enforced at the data layer: RLS hides other authors' like
  rows, so the cache can't compute someone else's count. **Headcount/RSVPs are
  public** by design.
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
  be made public, activities included, and public posts are what feed Discover.
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
blur + hairline border + lit top rim + float shadow) is reserved for the layer
that *floats above* content, never for content itself. Two tiers: **chrome**
(nav rail, seg-tabs, search field, nav dial — `blur(18–24px)`) and **floating
panels** (modals, autocomplete menus, and the Updates notification + soft-ask
cards — `blur(24–30px)`). Content lists — the feed, Discover's people rows,
comments — stay flat editorial rows. The Friends *modal* (a popover) is glass;
a *roster* of people (Discover's search results, your profile's circle) is flat
— that split is correct, not inconsistent (mirrors iOS: lock-screen
notifications are glass, Contacts rows are not). On phones the Updates view
switcher (seg-tabs) is docked chrome, not an inline row: it floats just above
the bottom nav and *rises up from behind it* when a page becomes active (router
tucks it while the page slides in, releases it on settle). The composer's
Post/Activity switcher is the one seg-tabs that stays inline — it's excluded by
`:not(#c-group-tabs)` wherever the router tucks them. The bottom nav hugs the
home indicator (small float, iOS Liquid Glass style), not lifted into the screen. **Corner scale:** 3px incidental (`--radius`) · 8px small containers
(`--radius-img`) · 12px composer inputs · 14px photos + glass menus/cards ·
18px nav rail · 20px glass modals · 999px pills. The pastel `publish-fill`
gradient stays reserved for the primary publish/share action — don't spread it
to every button, or it stops meaning anything.

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

**Comments are a growing textarea, not a one-line input.** The comment composer
auto-grows to fit its text (wraps into view instead of scrolling off one line);
Enter posts, Shift+Enter breaks a line. It stays flat editorial (comments are
content, never glass). Post-photos fade in as they load over the neutral
placeholder box (JS adds `.is-loaded`), so they settle rather than pop.
