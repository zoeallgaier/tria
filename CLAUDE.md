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
  into search. A tile shows the person's **name only, no @handle** (search still
  matches handles), and speaks the post's **caption**, falling back to its title
  only when there is no caption. Its filter dial carries one row Home's can't
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
  washed in the same hue. An answer is an **ordinary post carrying a `daily-<slug>`
  tag**, which is why the feature needed no table, no migration and no new privacy
  rule: answers inherit the audience rules, the edit path, the profile column and
  search for free. **The schedule is an array** (`DAILIES` in `app.js`) rotating
  from `DAILY_EPOCH` in local time, so N prompts is an N-day loop with no server.
  Twenty-one is **3 × 7 and therefore load-bearing**: every prompt keeps a
  permanent weekday, which is the whole scheduling tool (cheap Mondays, Thursday
  is always the Find, Friday is argumentative, Sunday lands soft). Day 0 is a
  **Tuesday**, so Mondays are indexes 6/13/20 — count from the epoch's weekday,
  not the top of the list, and if the epoch moves, **rotate the array by the same
  number of days** or every role slides. A post resolves its prompt **by slug**,
  never by recomputing `day % length` (`dailyForPost`): the old derivation made
  the array's *length* immutable, since changing it remapped every past day and
  silently stripped the question off every answer ever posted. Deleting a row
  still retires its label, so retire by moving out of the rotation, not out of the
  array. **The named type is binding** (`dailyAccepts`, the one home of the rule,
  read by both the composer banner and the submit gate so they can't disagree):
  the tag rides along only if what you made is what was asked for, nothing is ever
  blocked, and the banner just drains to a grey `Daily:`. `accepts: 'any'` waives
  it per prompt. **Activities are excluded from every daily**, open ones included:
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
blur + hairline border + lit top rim + float shadow) is reserved for the layer
that *floats above* content, never for content itself. Two tiers: **chrome**
(nav rail, seg-tabs, search field, nav dial — `blur(18–24px)`) and **floating
panels** (modals, autocomplete menus, and the Updates notification + soft-ask
cards — `blur(24–30px)`). Content lists — the feed, comments, your profile's
circle roster — stay flat editorial rows. The Friends *modal* (a popover) is
glass; a *roster* of people (your profile's circle) is flat — that split is
correct, not inconsistent (mirrors iOS: lock-screen notifications are glass,
Contacts rows are not). **The masonry grid is the one glass-minus-blur surface**
(Discover's, and a profile's frame wall): its tiles float above the page so the
material is right, but a `backdrop-filter` is per-element compositor work and a
scrolling masonry grid is exactly where that bill lands, so they keep the fill +
hairline + lit rim + float shadow and drop only the sample-and-blur. **The daily
card is the one piece of glass that carries a hue**, and it keeps the real blur:
it's a single element sitting still at the top of Discover, not dozens of them
scrolling, so it can afford what the tiles can't. The colour is the post type the
prompt asks for, straight from the quintet — a daily wanting a Frame is cyan on
the card, on the chip an answer wears, and in the page wash behind it, so the
colour still says *what to make* rather than a sixth hue meaning "daily". On phones the Updates view
switcher (seg-tabs) is docked chrome, not an inline row: it floats just above
the bottom nav and *rises up from behind it* when a page becomes active (router
tucks it while the page fades in, releases it on settle). The composer's
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

**Page changes are a cross dissolve, and only that.** Every route swap fades the
outgoing page out while the incoming one fades in, 0.3s, same curve, no
direction. Pages used to slide along a nav line (forward from the right, back
from the left, outgoing page receding for depth), but Discover's grid is dozens
of photos still decoding while the slide ran, so the movement read as the page
snapping and glitching rather than loading. Opacity has nothing to be out of step
with. Don't reintroduce a slide, a scale, or an entry blur, and keep pages off
`will-change: transform` — it makes a page a containing block for its
`position: fixed` children (the docked seg-tabs).

**Nothing else animates during a page change.** The dissolve is the whole move:
`renderPage` freezes every row it just mounted (`.card, .notif, .request-row,
.ptile`) so they ride the page's own fade instead of stacking a per-row rise on
top of it, and CSS kills the photo fade on `.photo-frame img` +
`.ptile-face--media img` for the same window. **Any new page-level row entrance
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

**Share is the tray, and the header tray shares.** `ICONS.send` is the
arrow-out-of-a-box the OS itself draws for share, not an envelope (an envelope
promises a message you compose; these buttons hand a link to the OS). Its mouth
matters: an early circular vessel with a narrow break reads as the IEC
standby/power glyph at 22px, so if the vessel is ever redrawn, check it at true
disc size, not at 96px. The header glyph is the share — it fires `shareOrCopy`
in place and goes nowhere. It used to be a sprout opening `#/support`, a note
from Zoe with the share button at the bottom, which put a page between someone
and the thing they meant to do; the note is an About fold (`#note`) now and the
retired route redirects to `#/about?open=note`. index.html **inlines** the tray's
path data because the header paints before app.js runs, so that copy and
`ICONS.send` have to be changed together.

**Comments are a growing textarea, not a one-line input.** The comment composer
auto-grows to fit its text (wraps into view instead of scrolling off one line);
Enter posts, Shift+Enter breaks a line. It stays flat editorial (comments are
content, never glass). Post-photos fade in as they load over the neutral
placeholder box (JS adds `.is-loaded`), so they settle rather than pop.
