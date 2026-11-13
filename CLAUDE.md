# Tria — working notes for Claude

A social app for small circles of friends. Tagline "No algorithm, ad-free social." (Zoe, 2026-11-08; it was "Social media made local.")
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

## The admin dashboard, triaonline.com/admin (2026-11-11)

**Zoe: "a user admin dashboard, with all features listed with names so we're
always talking about the same thing ... I also want to see metrics."**
`admin/` (index.html, admin.js, admin.css, dictionary.js) is a page of its
own on the site, in the app's tokens and type, **never bundled into iOS**
(ios-sync.sh copies only the root index.html) and a real folder, so Pages
never hands it 404.html's app. Same origin, so a session made on the site is
its session too; `bump.sh` stamps it with the app. Six pages since
2026-11-12 (**Retention went**, Zoe: "remove."; its week 1 figure stays on the
Overview, so `admin_retention` is still read, and an old `#retention` lands on
the Overview). **Three chart styles, no more** (Zoe, 2026-11-12: "use like max
3 styles of charts for data, picking the best options for the type of data"):
THE LINE for anything over time (`lineChart`/`mountLine`, one or two lines on
one axis, a dotted last stretch while a day or week is still going), THE BARS
for anything across kinds (`barChart`: the name over its bar, the value right;
with `total` a share as a percent over its count), THE HEATMAP for weekday by
hour (`rhythmHtml`). Columns and the lists' little meters are gone; a list is
for people and days. **Overview** (top cards **Active today**, Weekly active,
Monthly active, New this week since 2026-11-12, Zoe: "make active today a top
card, swap it for settled in", so Settled in is a small figure; the charts,
Monthly's change on the 30 days before (`mauPrev`), an **All time** chart
(`history`, weekly and monthly active a point a week since the first sign of
life), **Settling in** (`paintSettling`, `admin_settling`; an old `#funnel`
lands there) and When, the weekday by hour heatmap). **Settling in replaced
the six step funnel** (Zoe: "painful to look at or understand"): what people
did in their FIRST WEEK, each thing on its own out of the same people, only
accounts a week old; **Settled in** (a friend or circle AND shared something,
in week one) is the old Activated folded in (Zoe: "can be folded"). The audit
behind it: **Connected is a MUTUAL friend** (a follow or unanswered request
counted until then), a friendship's meaningful event is stamped on each side
when THEY acted (being accepted made you "active"), and week one figures
counted accounts still inside their week. `admin_funnel` stays for Word of
mouth's source split. **Activity** (Zoe: Made, Done and Opened on "should be
its own page and I want to see more data") is `admin_activity(p_days)`, a
window beside the one before it; until the SQL is re-run it draws the
Overview's last 7 days. **Audited 2026-11-11** (Zoe: "clean/accurate,
concise/clear, easy to interpret ... without losing the details"): a
friendship counts ONCE, the day it turned mutual (each side was counted);
Made's bars leave bare reposts out (a quote is `quote`) so they add up to the
Made tile; Done is **Interactions** (Made has the posts); the chart is people
active a day (as the Active tile); Opened on, Devices and App versions are
PEOPLE from `devices` (user_days keeps only a day's first platform, and
signed-out visitors were mixed in). **A tap shows just one thing** (Zoe:
"lemme tap a card to filter data by type"): the Made, Comments and Messages
tiles and every bar under Made and Interactions are picks (`astate.f`,
`paintActivity`, no refetch); the chart, the figures, Posted to and Busiest
circles follow (`series[].by`, `audiencesBy`, `conversationBy`, circles'
`types`), chats and devices don't. **Every page's caveat note leads it**
(Zoe: "put disclaimer on top since i want to know"; `leadNote`). **Test accounts are left out like admins**
(Zoe: "remove activity from tria reviewer as well, I use that to test"):
`metrics_ignore`, seeded by "review" in a handle, name or email, folded into
`metrics.skip`, so every page and Nudge drop it; the SQL's check row lists
who is left out. **Nudge**,
Community, **Dailies**, Dictionary. `?demo` draws sample numbers, flagged.
**Nudge** (Zoe: "an email for users who haven't really been in the funnel"):
`supabase/admin-nudge.sql` (**confirmed run** 2026-11-11: anon `rpc/admin_nudge`
answers its 42501; "Not back" waits until an account is a week old) lists everyone a day old or more who
stopped at a step (profile, connect, post, return, quiet: 21 days without a
sign of life) with their email from auth.users, logs sends in `nudges` and
keeps `nudge_stop`. Sending is the `nudge` Edge Function
(`supabase/functions/nudge`, **confirmed deployed** 2026-11-12 from the
dashboard: a bare GET answers `rev` 2026-11-12, `ready: true`, and an
unsigned POST its 403 "forbidden"; **JWT verification is OFF**, the function
gates itself through `is_admin()` as the caller, so redeploy with
`--no-verify-jwt`; Resend's API, secrets `RESEND_API_KEY` (a sending only key
for triaonline.com) and `NUDGE_REPLY_TO` set, `NUDGE_FROM` unset; refuses
without a reply-to, since "reply stop" is the way out; nothing receives mail
AT triaonline.com, no MX, so the reply-to is not a hello@ address until a
forwarder exists), two taps to send; **Open in
Mail** works without it (mailto, Bcc for several) and "Mark as nudged" logs
it. **Send me a test** (Zoe, 2026-11-12: "add a send test email feature"):
one tap, the letter as written with {name} filled as the preview fills it,
POSTed as `{ test: true, name, subject, message }` and sent ONLY to the
caller's own auth email (never an address the page names, so the function
is no relay), not logged in `nudges`. It is function REV 2026-11-12b, **NOT
deployed** as of 2026-11-12: the live 2026-11-12 answers a test with its 400
and the page says to redeploy. **Nudged is its own section** (Zoe,
2026-11-12: "put nudged in a new section"): everyone written to in the last
week, under What they get, with when, where they stopped and their stop
button (a reply saying stop lands there); the list to nudge never shows
them and the "Show N nudged this week" toggle is gone. A week on they are
back in the list. **The email leads the page** (Zoe, 2026-11-12: "put send
form n all at the top"): the step chips, then Email with Select all in its
head (so a whole step is a pick and a send with no scrolling), the form,
What they get, then the people (titled People or the chip's step), Nudged
and Asked us to stop. **What they get** (Zoe, 2026-11-12: "where is the email sent from and what
does it look like?"): under the letter, the email as it lands, From (`Tria
<hello@triaonline.com>`, the function's GET says its `from`, never the reply
address), To, Subject and the card itself, redrawn as you type, with whether
sending is set up under its title; `letterHtml` in admin.js is the function's
`html()` and **the two are kept equal by hand**. **Dailies** is `supabase/admin-dailies.sql` (**confirmed run**, anon
answers its 42501; needs daily-analytics.sql's views, which **know the
season since 2026-11-11**: `metrics.daily_season`, written out of app.js's
SEASON by script, is consulted before the rotation as `dailyOn` does; without
it every day since 2026-09-14 matched a prompt nobody saw and read zero, Zoe:
"its all 0s rn". **Regenerate it if SEASON changes.** Since 2026-11-12 (Zoe:
"format the data more cleanly", "best and least on top after today same for
answered with") the page is Today, then Land best, Land least (never the same
prompt twice, one scale) and Answered with, then the four figures, People a
day, All time and By weekday, then Every day as a calendar list, its last week
until asked), never reading likes. The Monthly chart needs
admin-dashboard.sql re-run (`series.monthly`).
**The Dictionary is `admin/dictionary.js`: a new feature adds its entry in
the same commit.** Its names are the ones to use with Zoe.
**The numbers are `supabase/admin-dashboard.sql`** (**confirmed run**
2026-11-11: its own check answered admins 1, profile_done 77, functions 5, and
anon `rpc/admin_overview` answers its 42501 "Only Tria's team can see that.";
**it must be RE-RUN for the admin exclusion below**, safe to re-run) and
`supabase/admin-extras.sql` (the Community section, **confirmed run**
2026-11-11: anon `rpc/admin_extras` answers its 42501). `admins` (Zoe, seeded by
username) gates `admin_overview`, `admin_funnel`, `admin_retention`,
`admin_extras`, each a 42501 to anyone else. **Admins are left out of every
number** (Zoe: "exclude my metrics? I post a lot and probably skew data"):
`admins.in_metrics` defaults false, `metrics.skip` lists them, and
`metrics.people`, `.posts`, `.days`, `.devices`, `meaningful_events`,
`journeys` all drop them; only Top inviters keeps them (credit, not skew).
**Community adds no tracking** (Zoe: "goodies (without adding any tracking)"):
friends each, people on their own, circles by size, what people have set up
(**never a bio or pronouns**, Zoe, 2026-11-12: "bio doesn't need to be tracked,
same for pronouns"; Settling in's "a photo or bio" is `profile_done` and stays),
themes, when Tria is used (weekday by hour), dailies, audiences, top
inviters, the newest accounts' progress, blocks. **The page is laid out to
the HIG** (Zoe): a large title handing over to the bar's inline title, a
tab bar on a phone and a floating glass sidebar from 900px, segmented
controls, inset grouped lists, 44pt targets, charts drawn at their card's
width. **Its chrome wears real materials** (Zoe: "proper blurs ... this is a
web desktop thing"): `saturate() blur()` on the bar, tab bar, sidebar and
hover card, with solid fallbacks. **Meaningful** (Zoe: create
or connect) is a post, Moment, daily answer, comment, message, RSVP, vote,
friendship made or circle joined, never a like (`metrics.meaningful_events`).
The funnel is Install, Account, Profile complete (a photo or bio,
`profile_done`), Connected (a friend row they made or a circle joined),
First action, Returned (any of the 7 days after the account's day);
**Activated** is connected and a first action, both within 7 days.
**The open ping is Tria's only usage tracking** (Zoe agreed, first party, no
SDK): `openPing` in app.js keeps a random `tria:device` id and calls
`Store.noteOpen` once a day per person, signed in or out (route(), a
foreground), which writes `devices` (platform ios | pwa | web, there is no
Android app, Chrome's shortcut is pwa; os; source read once on a device's
first run off the link it arrived on) and `user_days`; an account's first
device is `user_origin`, and a redeemed invite always wins its source. None
of the three tables has a select policy. **App Store Connect's privacy label
needs "Product Interaction, linked to user" before a build with the ping
ships.**

## Double tap a post to like it (2026-11-13)

**Zoe: "since I can tap a post to open comments let me double tap to like
like moments, frames too"**, then "give it the animation where I tap like
moments". A card's words (the same targets whose tap raises the thread) and
its Frame (a photo, a carousel, a clip) take a second tap as a like, in every
feed and on the post's own page (`tapOrLike`): the Moments viewer's heart
springs up where the finger was (`popHeart`, `.heart-pop`, which the viewer
now shares; on the body at z 90, over the page and under the bar) and the
card's own heart is clicked, so the write, buzz and sparkles are `wireHeart`'s.
**Only ever adds**: on a liked post it pops and taps LIGHT, no write. **The
single tap waits `MOMENT_TAP_MS` (200ms)** for a second, and only on a card
you could like (`likeableHeart`: signed in, a friend's heart button, not the
author's); your own post, a guest's or one you can't react to answers at
once. **The words do it on touch only** (`nativeShell() || !finePointer()`): a
mouse's double click there is picking a word, and a desktop's click on them is
a link. A Frame's double click likes on a desktop too, as Instagram's does.

## A filled mark wears your colour's gradient (2026-11-13)

**Zoe: "since we have a gradient for all the color styles can we use that on
the filled like icon and stuff?"** Every filled mark in `--heart` paints
`--heart-ink` (`url(#tria-heart-ink) var(--heart)`): a liked heart (card,
comment, Moment's rail, the double tap's `.heart-pop`, the like's ink
overlay as `--heart-ramp`), a Take's stars (`--star-ink`, unset where they
are white over a picture) and the composer's rating, a favourite's bookmark,
a pinned post's pin, and an Updates mark's disc (`--heart-ramp`). Three stops
per scheme, `--user-heart-{a,b,c}-{lt,dk}`, stamped by paintBrandBand beside
the hearts: `stopsAround` of each heart at `HEART_ARC` (the wash's 18
degrees; the band's 11 was one colour at 28px), so each weight and contrast
is the flat heart's. Tria's own is the ramp, deepened on paper to
`--brand-ink`'s weight (#007578 to #00735c); None is three of `--mono-heart`,
flat. The gradient is ONE `<linearGradient>` laid at the body's foot
(`heartInkDefs`), in ICONS' 24 unit box at 115 degrees, where CSS lays the
ramp on that box, so the overlay hands over to the fill without a shift.
**Not on it:** the native tab bar's lit tab (UIKit tints one colour; the web
nav's lit tab is left to match), charms (the wearer's heart, `#charm-inks`),
words in the colour (mentions, Going), the dot.

## Charms: solid, in a heart's colour, on every byline (2026-11-12)

**Zoe: "make pfp in feeds a bit bigger, and add everyone's charms. keep
syntax clean for loading"**, then "bit bigger for both, then make charms
bigger to compensate". `bylineEl`'s face is `.byline-avatar`, 50px (40
before; `AVATAR_PX` and the warm-up read it), and wears its author's
`charmsOnFace` in a `.byline-face` box only when they wear some. There a
charm is **54% of the face** (27px, Zoe: "27"; 24px for an afternoon; at a profile's share it was 18px of
specks), on the same rim points, with a smaller halo. **Everywhere else a
worn charm is 44%** (40% until the same day, Zoe: "scale charms up a touch on
moments and profile pages too. pfp size as is"), offsets -7.4% and 63.4%.
**Tria's charms are SOLID** (Zoe: "make our tria charms filled, round the
star a bit more"): each shape its outline grown solid as a tab's mark is
(`cb`, fill plus the 1.8 line), the triad interlaced like the Discover tab
(`tria-charm-weave`, a mask), Sunny a rounder star, the trims' ring a dot;
the spiral, stems, ground and the note's flag stay lines. **And in a HEART'S
colour** ("match users color themes the way like buttons filled do"): a
charm on a face wears the WEARER's heart, the colour their filled like is
(`heartOf`: a pick's hex or its paper `ink`, a photo's `heartsFrom` off the
kept sample `keptTone`, `--mono-heart` for None, `--brand-ink` for Tria's
own); one with no face (picker, unlock, welcome, Edit profile's row) wears
yours, `--heart`. It was plain `--text` from 2026-10-24. **The colour is not
in the markup**: a worn charm carries `data-ink="<user id>"` (`charmInk`) and
ONE stylesheet, `#charm-inks`, holds a rule per person setting
`--charm-lt`/`--charm-dk`, picked by scheme as tokens.css picks `--heart`;
a photo still sampling wears Tria's until it lands, and no card rebuilds.
**A charm is drawn ONCE**: `drawCharmSprite` writes every CHARMS art into a
hidden `.charm-sprite` at the body's foot (`#tria-charm-<key>`) the first
time one is drawn, and `charmSvg` emits a `<use>` of it, about 100 bytes a
charm in a card where the paths were 1.3KB. Rules can't reach into a `<use>`
copy, so the sprite's paint is attributes in currentColor (`CHARM_INK`) and
`.charm` sets `color: var(--charm-ink)`; `CHARMS` keeps its art in the
cl/cb/cf classes as authored. Sticker charms are still an inline `<image>`,
worn as they are.

## A Take can be about a place, from Apple Maps (2026-11-12)

**Zoe: "allow for takes on places and stuff, built into maps"**, then picked
Apple Maps over Waze (Waze has no places database to search or store), Google
(costly, its terms forbid keeping the data) and the open sets. **A place is a
fifth `take.kind`, not a new type or column**: `{ kind: 'place', title, by?,
cat?, lat, lng, src: 'apple', id? }` in `posts.take`, rated with the same
half stars, in the Takes tab like any Take. `id` is Apple's Place ID
(`MKMapItem.identifier`, iOS 18, made to be stored); `lat`/`lng` are required
so a take draws and opens without it; the link is never stored, it is read
off the point (`placeLink`, maps.apple.com). **The composer's one Take search
finds places too** (`searchPlaces` in `lookUpTakes`; a place whose name
starts with what you typed leads the list), through **`TriaPlacesPlugin.swift`**:
`search` is `MKLocalSearch`, points of interest and areas, never a bare
street address, and **asks for NO location permission** (Tria never asks, so
results lean on what Apple infers; naming a town finds it). **The tile's art
is the place's own little map** (`snapshot`, `MKMapSnapshotter`, no other
pins, a dot in the reader's `--heart`, kept in Caches/tria-maps; an area,
which has no `cat`, is drawn wider; `fillPlaceArt`), a pin glyph until it
lands and on the web. **A tap opens Apple's own place card over the page**
(`open`, `MKMapItemDetailViewController`, iOS 18 with an id), else Maps at the
point, else the link (the capture click handler's `data-place`). **Picking is
the app only and needs `supabase/place-takes.sql`** (**NOT run** as of
2026-11-12; until `take_kinds()` names 'place', `Store.placeTakesReady` is
false and the search finds no places, since the shape check would refuse
them). An older binary or the web still DRAWS a place take (pin, link out).
**Needs a new binary** for the plugin.

## A private post wears a lock (2026-11-11)

**Zoe: "if a post is posted on a private circle, include a lock icon on the
post in feed and profile feeds ... or privately to select people ... top
right corner is best".** `privateMarkHtml` (`isPrivatePost`: audience `list`,
or a post in an INVITE-ONLY circle; never My circle, which is most posts)
ends the byline or a profile's date line (`headLockHtml`), after a Take's
stars, in muted ink. **An invite-only circle's post wears it IN PLACE of the
circle's mark** on its "Posted in c/slug" line (`communityTagHtml`, Zoe,
2026-11-13: "use lock instead of circles icon on feed for posts in private
circles. One icon is fine"); the second lock at that line's right and its
`.card-community-line` row are gone. A Frames tile wears it
in its top right corner, a solid white lock with a soft shadow and no pill (`.ptile-private`); a clip's play mark wears the same, and a Frame said in a circle the solid trio (`circleOn`; Zoe: "for frames posted in circles, use the circle trio icon"). **A tile wears ONE mark** (`frameMarkHtml`, Zoe: "private and play icons trump circle icon. only one"): the lock, else the play, else the trio.
**The old "Shared privately" / "Shared with N" line at a card's foot is
gone**: the lock's label holds those words. A circle's own page hides every
lock (`.view--community`), where the bar's c/slug already wears one.

## Drafts: the composer saves as you write (2026-11-11)

**Zoe: "Draft posts and autosave ... I want people to be able to come back to
thoughts or not worry about losing one."** Modelled on Substack (researched
the same day): autosave with no Save button and no question on the way out,
the drafts at the composer's own door, synced across devices. **The
autosave** (`THE AUTOSAVE` in renderPublish, `draftOf`): 700ms after the last
key, tap or pick anywhere (capture listeners on document, so the audience
sheet counts), on the way out (`route()` calls `liveDraft.flush(true)` while
the fields are still on the page) and on a trip to the background
(visibilitychange hidden, pagehide). Only a real change saves, so a draft
opened and left is not re-dated; emptied, it is deleted. Leaving with
something kept toasts **"Saved to drafts."**, the whole of the reassurance.
A share spends it (`liveDraft.spend()`, after the post is out; a refused
share keeps it). **What a draft holds:** the words as they post
(`serializeNote`) and the quill, tags, the ONE live attachment with what is
in it (link, poll choices, plan, song, take and its stars), the audience once
answered, and what began it (a quote, a daily while still today's and
unanswered, a Moment, a circle's card), not Music's own page. **Photos and
clips too** (Zoe, 2026-11-11: "make sure drafts also save images/videos";
they were left out that morning): **a photo is its upload** (it goes up as
it's picked, so the draft keeps `photos: [{ url, dims, tint }]` and it is on
every device; a still still going up as the composer goes is `held` from
`sweepUploads` and written in once it lands; `sweepUploads(true)` spares
what `draftPhotoUrls` names; a reopened one is `makeStill`'s `it.url`, never
uploaded again). **A clip stays on the phone that made it** (`clips: [{ path,
type, start, end }]` and `dev`, the open ping's `tria:device`; never uploaded
before Share): TriaClip `keep` hard links each into `Application
Support/tria-drafts` (never purged, out of backups, out of `clear`'s reach)
and the draft is rewritten naming them there; `prune` drops every file no
draft on the phone names (after sync, a spend, a delete). Another device
opens the words with "This draft's clip is on the phone you started it on."
The app only: the web's and iOS 15 and 16's clips are a File, so their drafts
keep the words. Deleting a draft by hand deletes its photos' files
(`dropDraftFiles`); posting one hands them to the post. **Needs a new
binary** for the clips (`keep`, `prune`); photos are web only. **Reopening** (`pendingDraft`, an id, read
after the outgoing composer flushed) fills the fresh fields before they are
wired (`fillFromDraft`), so every surface wakes holding it; `editorPrefill`
takes the quill explicitly. **Where they are:** the New sheet's last row,
**Drafts**, only while one waits, never a number (`openDrafts`, `ICONS.drafts`,
"sleep on it", a crescent moon and a small star, Zoe's pick of eight in
https://claude.ai/artifact/GRkJ7mKndfmRKv2Ed8gSw5): its mark, its headline or first line, and
"Poll · 3h ago". The x is two taps (Delete pill, then gone, a WARNING tap),
as iOS's swipe to delete. **Kept on the device first** (`tria:drafts:<me>`,
`Store.saveDraft`), **then the account** (`supabase/drafts.sql`, owner only,
**NOT run** as of 2026-11-11; until it runs `Store.draftsReady` is false and
they stay per device): `syncDrafts` merges newest edit wins, `dirty` and
`synced` marks tell an edit not yet up from a draft deleted elsewhere, and a
delete is a tombstone (`tria:drafts-gone:<me>`) until the account takes it.
Synced at boot, on a foreground and as the New sheet opens.

## Favorite circles are a bookmark (2026-11-09)

**Any circle you can open can be a favorite** (Zoe: "Favorite circles for
the menu, circles view, etc use bookmark icon"), joined or not, signed in.
`ICONS.bookmark`/`bookmarkOn` (solid in `--heart` while on, as a pinned
post's pin). **Kept on the account so they sync across devices** (Zoe,
2026-11-09): `community_favorites`, readable and writable by its owner only
(`supabase/circle-favorites.sql`, **NOT run** as of 2026-11-09;
`Store.favCirclesReady`, `favCircleIds`, `setFavCircle`). Until it runs they
stay per device and reader (`tria:fav-circles:<me>`); the first time the table
answers, a device's list is carried up and the key dropped (`carryFavsUp`).
`favCircles`, `isFavCircle`, `toggleFavCircle` (toasts, taps LIGHT).
Where it shows: **the end of the circle page's bar, after the •••** (Zoe:
"swap save icon and glyph placement"; `#community-fav`, swapped in place by
`syncFavBtn`, the bar's observer carries it native); **the end of every
circle's row in the sidebar** (Zoe: "put save icons on the menu itself";
`.feed-side-fav`, its own button beside the pick in a `.feed-side-line`, the
row staying in its list until the sidebar opens again); **the top right of
every card on a profile's circles page** (`#/in/<username>`, Zoe,
2026-11-11: "Allow favoriting circles from the page when I tap circles in my
profile"; `communityCardHtml`'s `fav`, `.community-card-fav`, over the
stretched link); the disc's size line
on Explore circles, the bookmark in place of the joined check (`subMark`);
and **the sidebar's Favorites section, over Circles**, which then leaves
them out (an invite-only one only while you're in it). **Not on the lifted
sheet on Explore circles** (Zoe: "save does not need to be on the circles
sheets"; it was there for an hour).

## Your own profile has a back when you were pushed there (2026-11-09)

**Zoe: "ensure 'my profile' always has a back button when needed (if tapped
on feed, etc)".** The Profile TAB (`#/profile`) has no chevron, but most of
your own name's links (a byline, a comment, a mention, likes, a circle's
members) go to `#/u/<you>`, which is no tab (no bar) and had no chevron
either: a dead end but for the edge swipe. Now **`#/u/<you>` always has
one**, and **`#/profile` has one when a LINK pushed it** (a repost line, a
Moment's face, a circle's host, a list row): a capture click on
`a[href="#/profile"]` outside `#nav` and not a `.toolbar-back` stamps the
entry `selfPushed` in its history.state (`stampSelfPush`, expiring 1s after
the click), so a back onto it or a reload keeps it and a tab tap never has
one. A chevron's return to `#/profile` never counts, or a post's back and the
profile's would point at each other. **Both POP** (`#self-back`,
`history.back()`, labelled by `trailLabel(navTrail[1])`), so back is wherever
you were; `backTarget()` would have sent a post page's or Updates' profile to
Discover. A cold `#/u/<you>` with nothing under it falls back to
`backTarget()`. A pushed `#/profile` keeps the tab bar, Profile lit.

## Tips are dashed cards in your colour (2026-11-08)

**A tip is `.tip` (`tipHtml`)** (Zoe: "a tutorial category of cards that
combines the users color preference (color itself not bg) and the dotted
line soft cta stuff ... small dismissable tutorials"): a dashed edge in
`--heart`, no fill (the paper shows through), the glyph in `--heart`, the
title in a note's H2 (italic Instrument Serif, Zoe: "italic instrument h2 to
the card titles") in `--mention-ink`, one short line in ink, and an x.
**A tip has no button and sits BY what it teaches** (Zoe: "tutorials should
never need a button because they should be by the feature already"; a
quiet pill, `TIP_ACTS`, went the same evening). **Voice: a title that names
the thing, one short line of how, never where to find it** (Zoe: "use as
little words to get the point across"). **A tip next to buttons keeps the
head's gap** (`--account-gap` over it; the feed or tabs under it bring their
own, the tabs 12px less since their glyphs stand in by that much).
**A dashed card means a tip and nothing else**: the empty circle's dashed
first post went the same day. Each is told once per device and reader
(`tria:tip:<key>:<me>`, `tipSeen`, `spendTip`), spent by its x (a LIGHT
tap) or quietly by doing the thing it teaches, and **a page shows one at a
time** (`firstTip`, `paintTipHost`). `TIPS` holds them: **moments** (under
the rail, while friends have faces; a like spends it; honours the old
`tria:song-hint-seen:v6` key), **side** (My Circle's `#home-tip` under the
bar's menu, "One at a time ... view one circle or friend", not on a
brand-new empty circle nor while the Moments tip shows; opening the sidebar
spends it), **takes** (the composer, under the note box whose star it
points at, plain posts only, not a daily or a Moment; Zoe: "put takes on
the publish page"; pressing the star spends it), **paper** (Edit profile,
over the Background color row; opening it spends it), **tabs** (over a
profile's tabs; changing tab spends it), **circle** (under a circle's head
and Join, signed in, only where you could join: not a member, not invite
only; joining spends it) and **field** (Explore circles, see below). Not
written: a composer tip for the poem quill; add one to `TIPS` if poets get
lost.

**Explore circles' hint is a tip now**, floating at the field's foot on the
sheet's paper (`.cx-tip`), titled Getting around (the bar already says
Explore circles): "Swipe to explore, pinch to zoom, tap a circle to peek."
(Zoe's words plus the tap; the sheet's own Open foot tells the pull up),
"Pinch to zoom." for someone who has only dragged, on the same rule as the
toast it replaced: every visit until a first drag (and pinch), gone at a
drag or a lift, and its x spends it for good.

**The CTA sweep** (same day, "change oddly placed cta links into cards or
buttons"): signed out, Discover's "You're looking around signed out. Make an
account" sentence is a card under Explore circles (`guestCard`, Make an
account and Log in as two even doors; `GUEST_ASKS` lets `#/signin` through);
the guest pitch's Log in and App Store lines are two quiet pills under
Create an account ("Look around Discover" went, the tab bar is the way
there); About's "See the plans →" and the business page's "Start an
organization account →" are pills (`.about-go`). `.about-more`,
`.guest-note` and `.guest-more` are gone. The auth forms keep their small
links (Forgot password, Log in under Sign up): that is the convention there.

**A circle's page, signed out, is a profile's** (Zoe: "make the circle page
the same as an empty users like the buttons"): no pill in its head (it was
Make an account to join), and an invite-only one's fence says its line
alone, as a private profile's does. **An empty circle you're in is an empty
profile**: a line, Share the first <type> as THE BUTTON with the + sheet's
walk through the types, and Invite friends as the quiet one.

## The paper wears a colour (2026-11-08)

**`--bg`, `--surface`, `--surface-2` and `--rule` are a light or dark version
of a colour** (Zoe: "users feeds and everything should be a light/dark
version of their color choice"), the corner wash kept as it was. The maths
is ONE file, **`js/paper.js`** (`TriaPaper.papers`), loaded by the page and
required by `gen-alt-icons.js`: each neutral turned to the colour's OKLCH hue
at a small fixed chroma (`SURFACES`) **and solved to the neutral's own WCAG
luminance**, so every contrast measured on paper is unchanged. Chroma is even
across hues (cards at 0.010, all that red, blue and violet reach near white)
and reds and pinks give up to 12% back (`evenOut`), after an audit sheet of
all ten in both schemes. The ink stays neutral. **Whose:** yours on every
page; **someone else's profile, a circle's page (and its editor's live
theme, `previewPaper`) and a Moment's page wear THEIRS** (Zoe: "adopt THEIR
colors", "same for circles"; `paperSubject`; a Moment's page wears the tone
of its own wash through `.has-paper`, `wearPaper`). The four tokens are
`@property` colours on `:root, .has-paper`, so the page, cards and sheets
ease together (`--dur-move`). **Background color** in Edit profile sits with
App icon color at the top of the settings, both through `colourSheet` (the
Theme sheet's grid, see-through); per device, `tria:paper`, My theme by
default; None is the opt out and keeps every page neutral, others' included.
Your own paper is kept for index.html's first paint (`tria:paper-css`) and,
natively, in UserDefaults for the next launch (`TriaSettings.setPaper`,
`keep`; a friend's paper is laid live but never kept). **The alternate app
icons:** light is the colour itself as the ground (a 15 degree ramp) under a
WHITE wordmark and rings (Zoe: "the full color punch and the logo white on
top"), each colour deepened in OKLCH until white on it reaches 3:1
(`TriaPaper.forWhite`, also the App icon picker's discs); dark is the
colour's dark paper under the coloured wordmark (`fill-specializations`).
**Tria's own primary icon wears the same scheme since 2026-11-11** (Zoe:
"match the other colors, Tria teal bg"): the brand ramp, each end deepened by
`forWhite` (#07a5aa to #0ba983), under the white wordmark and rings on
light, Tria's dark paper under the brand's fills on dark. gen-alt-icons.js
writes TriaAppIcon.icon too, last, reading its brand fills back off the dark
specialization, so it reruns cleanly; the App icon sheet's Tria disc is that
deepened ramp.

## Explore circles is a field of discs (2026-11-07)

**Discover leads with the Explore circles card** (Zoe: "a new card akin to
daily", "at the very top of discover"), above the daily, `circlesCardHtml`:
words left aligned ("Explore circles" over "Find a circle for something
you're into, or start a new one.", Zoe's line), under **an eyebrow of every
circle's name** where the daily says which day (Zoe: "a list of the existing
names (as added), separated by commas and shifting like a song title would"):
as their hosts wrote them, newest first, one line that moves as a Moment's
song title does once it runs past the column (`rollCircleNames`, its own copy
of `runTune`'s hold and pace), and on the
right a small floating Venn: three discs in the circle mark's own geometry
(`CARD_VENN`), in FIXED colours, the palette's pink and ocean and Tria's teal
(Zoe: "use pink instead of orange"), blended so the overlaps mix
(`.cxm-node`, multiply on paper, screen on ink). Its foot is two even doors,
**Explore** and **New circle** (`.circles-card-acts`). **The
circle rails are gone from the square** (2026-11-08, Zoe: "On discover, Remove
circle carousels. People stay."; they stayed for a day after "Keep circle
carousels in the feed"), and the dashed Start a circle card that ended the last
one went with them: this card, the New sheet's Circle row and a circle's own
posts are the ways to circles from Discover.
`#/circles` (`renderExploreCircles`, signed out too) is the whole window,
fixed: **every circle a disc, its AREA its members, truly** (Zoe,
2026-11-08: "a bit more proportional to the member count"): the biggest at
`rMax`, every other at the square root of its share of it, floored where its
words still fit (`circleField`, 46px on a phone; it was `rMin` plus a share,
which drew 24 people at under 3x the area of 3), crisp at the edge with its theme's spectrum as a soft
mesh inside (`circleInks` through `personTone`, lit with THE LIGHT's numbers
and laid solid on the paper, `setInks`), a hairline, its face, name and size:
the face leads (Zoe: "make the titles smaller and image bigger"), and the
serif name's lines have room under the clamp, which had clipped every g.
Blurred bokeh blobs came first and went the same day (Zoe: "not modern or
clean enough"), and so did a Venn of real shared members ("drop the overlap
idea, space at all properly"). Packing them touching like bubbles was tried and
taken back within minutes (Zoe: "bad call"). **They float, spaced**
(`FIELD_GAP` 16px): a small physics (`stepField`), seeded by id so the field
is the same each visit. **The circles can't be moved** (Zoe): a drag anywhere
moves the view, which runs off the screen. **A pinch zooms, like a watch's
grid** (Zoe, 2026-11-08: "zoom out on the circles page like watchos"): in to
the circles' own size, out until the whole field fits the band (never past
`ZOOM_FLOOR` 0.3), a pinch past either end giving and springing back
(`cam.z`, screen = world times z plus the offset). A trackpad pinch
(ctrl+wheel, Safari's gesture events) and a double tap on the paper (all the
way out, or back in about the tap) do the same. **A circle drawn under
`FOLD_AT` of its size folds to its face** (lens and zoom together, opening
again over `UNFOLD_AT`, on its own `FOLD_MS` clock so none rests half way):
the words go first, then the face travels to the middle and grows to
`ICON_OF_R` of its radius (`--fold`, `--face-at`; drawn at that size and
shown smaller, so never scaled up). Zoomed out the field is a field of
faces, the lens folding the edges first. A lift glides up to z 1, and the
put-away back out to the zoom it came from (`zBack`); `circlesCam` keeps
both. The hint tells the pinch until a first zoom (`tria:circles-pinched`),
and not at all where the field already fits. **Where two meet mid drift, their
hairlines merge into one outline** (Zoe: "combine/disappear on overlap"): the
rings are a canvas over the discs, stroked then every disc cut out
(destination-out). **The lens** (2026-11-08, Zoe: "go crazy"): the middle of
the band is where a circle is whole, and out toward the edges each gives up to
30% (`LENS`), drawn in toward the middle by what it lost so its inner edge
holds and no gap closes (`place`); a drag brings circles up to size as they
come in. Arriving fresh they **rise in as a wave** out from the middle with a
little overshoot (`GROW_MS`); a circle **sinks under the finger** and pops on
its lift (a spring, `sv`); one with a sign of life in the last day
(`communityPulse`, `ALIVE_MS`) **sends a slow ripple** out from its ring in its
own colour, passing behind its neighbours (the same cut). A disc shows **the
faces of friends of yours in it** before its size, as many as it has room for
(Zoe: "make it easier to connect"). **A tap lifts a circle into the band above
THE STANDARD SHEET** (`openPeek`, Zoe: "the card should just be standard
secondary menu"; until 2026-11-08 it was Discover's card risen from the foot):
see-through, **its head the circle page's own** (`communityHeadHtml(c, true)`,
Zoe: "copy whats on the circle's page"), photo left and name, members, host
and about beside it, its sides paying back the sheet's 6px inset and 1px edge
so its column IS the page's (14px from the screen, the lines break alike),
**Join as THE BUTTON's commit**, and on a circle you're in the page's own pills, Post,
Invite and the host's Edit (Zoe, 2026-11-08; there were none that morning). **Going in carries the head up into its place on the page**
(`handHeadOver` in the let-go, `landHeadOver` once renderCommunity paints: a
fixed copy glides on `--ease`, the posts and a member's pills rise in behind;
a desktop's wider column only fades the copy). Drawn smaller in the sheet was
tried and dropped the same minute. The camera and the lens glide on a
critically damped spring (`GLIDE_W`), the put-away too. At its foot **the
Moments Reply foot**, a chevron over "Open c/slug" (Zoe: "the consistent swipe
up as before ... like replies to moments"; for an hour it was an Open row).
**Join is in place** (`joinHere`): the sheet goes and the disc bursts
with `celebrateFace`'s stars in its own colours and wears its check, so you
can join a few without leaving. Signed out the head has no pill (2026-11-08, a profile's rule); Discover's cards' Join goes to `#/join` (it toasted "You need to be signed in." and stopped). A tap round the sheet on the lifted circle goes in,
on another lifts that one, on the paper puts it away, as does a pull down;
**a pull up opens it, the Moments Reply pull** (Zoe: "take a note from
moments replies"): the panel rises at half pace and stiffens past `OPEN_AT`
(70px), where "Open c/slug" inks and its chevron rises with a LIGHT haptic,
and an armed let-go carries it on up and away. **The let-go navigates IN the
pointerup, never from a timer** (Zoe: "the swipe back gesture goes to
discover"): WebKit's back swipe skips a history entry script made outside a
gesture and the one before it, so a circle opened 200ms after the let-go
swiped back past Circles. Playwright's goBack doesn't apply that rule, so
only the phone shows it. **Even in the let-go it wasn't enough**: WebKit
marks an entry made with no user activation in the last 10s, and a drag is not
one, so every way in from the field goes through the app (`goKept`,
`TriaSettings.goTo`, a native `load` of the new hash, which the client asked
for and so is never marked). The foot is Reply's own (56px, its parts and its
10px drop) standing 12px under the safe-area inset measured from the
panel's floor (Zoe, 2026-11-08: "bump the position of the open circle down")
(Zoe: "match that of the reply to moment ... just slightly compensated with
the card"), the same with or without Join. The field and the sheet refuse
native drags (`dragstart`, `-webkit-user-drag`): one that began on a link or
the face's image was the browser's and took the pointer. A click on the scrim
within 450ms of a lift is the lifting tap's own (WebKit hit-tests a touch's
click after it) and is dropped (`firstClick`). **"Swipe to explore, pinch to zoom, tap a circle to peek." (Zoe's words and the tap; without the pinch once it is learnt or the field already fits) is
a tip card at the field's foot since 2026-11-08** (it was the app's toast; see "Tips are dashed cards"), after the rise, on every visit until a first drag on this
device (`tria:circles-dragged`), gone at a drag or a lift. **New circle is the bar's, always** (Zoe: "a perma button
like dailies top right"); the bar's band shows from the first frame here
(`body.circles-live`). `circlesOff` stops the frame loop in route(). **A circle opened from the field
goes back to it** (Zoe: "make sure back goes back to circles"):
`communityBackTarget` knows `#/circles`, and the view is kept (`circlesCam`)
only for a way back from a circle; arriving fresh starts on the biggest.
**Back from a circle opened from its sheet, the sheet is already up**
(Zoe, 2026-11-08: "keep the sheet open on swipe back so no flashing
happens"; `circlesCam.lifted`, `openPeek(i, kept)`): WebKit's back swipe
shows a picture of the field as you left it, sheet and all, so the page
under it is drawn the same, starting where a pull left the panel and
settling. A circle's back chevron steps back onto the field's own entry
(`backStepsTo`, the trail in `history.state.back`) rather than pushing a
copy, so a back swipe from the field reaches Discover; every hash replace
goes through `replaceHash` to keep that trail true.

## A profile's types are tabs you swipe (2026-11-07)

**The bar's filter disc and dial are gone from every profile; the types are a
strip of tabs between the pins and the posts** (Zoe: "like a swipable
instagram filter for profiles post types"): **four at most, All, Frames,
Takes, Reposts** (Zoe, the same day: "far too many options"), each only if
they've posted it, in even columns (`.profile-tabs`), the one you're on in
ink with a short line under it that slides. A tab earns its place by changing
what the page IS (the wall, the shelf, another axis); Notes, Finds, Polls and
Activities only narrowed the same feed, so they live in All. Notes was the
one pushback (writing is Tria's heart): bring it back first if a photo
poster's words get hard to find. No strip when nothing narrows (one type
only, unless it is a wall, Frames or Takes). **Takes is a wall too since
2026-11-12** (Zoe: "give takes the compacted view like frames with the star
rating in the corner", "top right corner", "no circles icons";
`takeWallTileHtml`, `WALL_TILE` picks the tile by tab key): the Frames
wall's 3:4 tile on its grid, the poster, cover or podcast art filling it,
the stars white with the lock's shadow in the TOP RIGHT and a private
take's lock after them, never the circle trio. A place wears its map drawn
at the tile's height (`PLACE_TILE_PX`, `data-size` on `fillPlaceArt`) with
its name over a shade at the foot. The words (serif title, what it is) are
always laid under the picture, so no picture, a broken one, or a place on
the web shows them at the foot with the stars in `--heart`. **A sideways
drag on the posts goes to the next type** (`wireProfileTabs`): the pane and
the line follow the finger one to one (a quarter past either end), past 28% or
a flick it goes; the next pane is not built under the finger, so the old one
slides on out and the new one is painted and slides in from that side. A drag
starting on anything with a sideways drag of its own, or the left 24px (back),
is left alone. The posts are `touch-action: pan-y`, which is also what makes
`swipeAt` stand the tab pager down over them, so on your own profile a swipe
on the posts changes type, not tab. The strip swipes too. **Once it scrolls up
to the header it JOINS it** (Zoe: "add it to the header when it scrolls far
enough ... I don't like that the blur is separated"): it sticks at the bar's
foot and the bar's OWN band (`.topbar::before`) lets its bottom down by
`--profile-tabs-h` behind it, so it is one blur and one hairline
(`body.tabs-stuck`, `body.tabs-live` for the band's transition; a separate
band on the strip showed a seam). The strip is z 101 over the bar's 100,
which works only because nothing between it and the root makes a stacking
context; keep it that way. **On a desktop the strip is a small glass
segmented control** centred on the column (the sidebar's material, glyphs
only with their names on hover), where you are the sidebar's soft neutral
capsule sliding; the desktop bar has no band to join, so it looks the same
stuck or not, docking in the bar's row level with the back disc at every
desktop width (2026-11-10, Zoe: "make sure the profiles post type filter is in
the right place on desktop"; it sat just under the row below 1100px, over the
posts). A type picked while stuck opens at its own top under the
strip, a tap on the tab you're on goes back there, and every switch holds the
pane a screen tall, so the strip never jumps. `profileTabsOff` drops the
scroll watch in route().
**A circle's page has the same strip** (2026-11-11, Zoe: "swipable filters in
circle feeds the way we do under pins on profiles"): `#circle-tabs` between
its head (and tip) and its posts, the same four on the same rule
(`typeTabsFor`, `typeTabsHtml`, `frameTileHtml`, shared with the profile),
Frames the wall. It is drawn by `paintTabs` inside the circle's repaint and
rebuilt only when the set of tabs changes; `wireProfileTabs` hangs every
listener on an AbortController so a rewire never doubles the drag. A pick is
kept per circle (`circleFilter`), and a post just shared there opens on All.
**A circle's page now holds its header** (`holdsHeader`, `#/c/<slug>`), as a
profile does, so the stuck strip has a header to join. The tabs tip shows
there too, after the circle tip.

## A circle has a theme, picked as a profile's is (2026-11-07)

**A circle's host picks its colour in the profile's own Theme sheet** (Zoe:
"the same way pfps are"): Tria, Photo, None and the nine, the same values as
`users.accent` (null is its photo's colour, else Tria's ramp), in
`communities.accent` via `set_community_accent` (`supabase/circle-accent.sql`,
**NOT run** as of 2026-11-07; until it runs `Store.communityAccentReady` is
false and the form has no Theme field). New circle and Edit circle are
**Edit profile's page** (Zoe: "match the design of profiles edit"): no
nameplate, the face left with New photo, Theme and Who can join as `.pf-row`
pills right, the name and about as one combo box with a count, the crop's
Use this photo; Edit circle commits with the bar's check (idle until
something changed, the chevron an X over changes) and has Delete circle at
its foot, New circle commits with Start circle. The page behind the form
wears the theme as
you pick (`syncTheme`, held until Save, like the photo). `openAccentSheet(of,
pick)` takes the circle and a callback; without them it is your own. **A
circle's page wears its wash as a profile's does** (`applyAmbient` on `#/c/`,
`paintWash` with the circle), so every circle washes from its photo or Tria's
ramp even before the SQL runs. **A host's circle page has three pills, Post,
Invite and Edit** (Zoe), three even columns (`.community-head .friend-btn`
drops the 122px floor). **Its stat line is the profile's** (2026-11-08, Zoe:
"use icons ... like how we updated profiles friend count"): icons and counts,
no words or dots (`statIco`, one `.account-stats` rule for both heads), a
pencil for its posts (only where they can be read), the people mark for its
members (a button signed in) and the host's own small face and name. **An
invite-only circle's lock rides its c/slug** (Zoe: "in the c/ like in the
header"; on its name for an hour), after the words in their own ink, on the
bar's title and the head's handle, to everyone (`.title-lock`,
`mountToolbar`'s `lock`), and in the composer's Who can see this, after
its row's NAME (Zoe, 2026-11-12: "private circles need lock icon on audience
picker", then "put it in the name not the smaller text"; `roomBtn`) and on
the field's c/slug once it is picked (`audienceLockInner`).
Natively the title lays the same markup after its
text (`titleSpec`'s `lock`, `lockSize`, `lockGap`, TriaSVG in the title's
`apply`); an older binary shows the words alone. A change to the line alone
swaps the line, never the head, so the face doesn't blink (`wireStats`).

## Pictures are their own files, no renderer (2026-11-06)

**Every picture loads a file of its own; Supabase's image renderer is gone**
(Zoe: "higher res images WITHOUT expensive load times"; it billed per picture,
hit 685% of the Pro quota, and with the spend cap on it stops answering). Don't
bring it back. **A composer photo is three JPEGs made the moment it lands**
(2026-11-07, Zoe: a big photo froze the composer "until things sync and upload
and icloud"): 2048 (the lightbox), `.md.jpg` 1280 (the feed), `.sm.jpg` 640
(small places), marked `-hm` in the name; `sizedSrc` takes the smallest that
covers the drawn width, `fullSrc` the original. In the app they are made
NATIVELY (`TriaPhotoSizes` in TriaPhotosPlugin.swift: ImageIO's thumbnail
read of the file, upright, no metadata, P3 kept, 48MP in ~0.2s off the main
thread; the pickers ask for `.current` so nothing is transcoded first; Take a
photo is a native camera, `TriaPhotos.camera`), and nothing is decoded or
base64'd in the page. The web (and iOS 15 and 16) draws them from the
preview's decoded `<img>` with toBlob (`photoFiles`). **They upload as they're
picked** (`startUpload`, one still at a time, the cover first) and Share waits
only for what's left (`photoUrls`, the bar); a still taken out or a composer
left deletes its files (`sweepUploads`), a refused post's go up again. A
photo still coming down from iCloud holds its place in the post, shimmering
(`rollLoading`, `.cc-slide.is-pending`), and holds Share. `-hd` (640 only) is
the 2026-11-06 scheme, still made for comments', messages' and posters' data
URIs (`smallCopy`). Older uploads and faces are their one original.

## The clip editor (2026-11-06)

**A clip post is up to 30 seconds, stitched from up to ten clips** (15 until the same evening; Zoe:
"vine style editing meets modern reels edits UI ... imovie style bars",
research in the commit). `clipEditor` in app.js replaces the old trim reel:
the preview IS the post (the first clip's shape held to the feed's 4:5, a
Moment's its own shape), two `<video>`s taking turns so a cut is a swap; under
it **the post bar** (one bar per clip, width by length, the selected one ringed
in the reader's `--pill-band`, a dashed + while there is room), and under that
**the trimmer** for the selected clip (its whole source as a filmstrip, the
window in the band with grips in `--pill-ink`, 0.5s least). Tap a bar to pick
and jump, drag along the bars to scrub, hold one (320ms) to lift and reorder.
Split (at the playhead) and Remove sit by the length chip; the x clears it all
(confirming with two or more). **Adding shares the 30s**: a lone first clip
takes up to 30, else each new one takes an equal share and the others give
way pro rata (`makeRoom`), so the + never hides. **In the app the post is a
real cut**: `TriaClipPlugin.swift` (`TriaClip.inspect`, `compose`, `record`,
`clear`) stitches with AVFoundation to H.264 .mp4, each clip covering a canvas
capped at 1920x1080, Rec. 709, 30fps, fast start, progress as `clipProgress`
filling the first quarter of the one upload bar ("Preparing"). Its tmp folder
is TriaPhotos' too, emptied only by `clear` (`paths`, so a fresh pick
survives). **The web, and iOS 15 and 16's file input, keep one clip posted as
its original with its window in the filename** (`clipPostData`'s fallback),
now also when only the end was trimmed (that posted whole before). Every bar
wears the band: the preview's and the feed's progress, the upload, the
lightbox's own scrubber (`wireLightboxClip`, tap to pause, a sound toggle; the
system controls are gone). A Moment's clip loops its window too, with no
progress line (it would read as the story indicator Zoe removed). No sounds,
text or filters: on purpose.

## A song plays its preview (2026-11-06)

**A song row's play disc plays Apple's 30 second preview, a ring in `--heart`
running round it** (Zoe), and the sleeve and words still go to the song
(`.card-song` is a box now: `.card-song-go`, the link, and `.song-play`, the
button). **A Moment's song starts by itself** ("if a user's sound is on"),
from a play disc under the heart on the rail (`.mv-play`). Nothing is stored:
`previewUrl` looks the clip up at play time by the Apple track id in
`song.apple`, else by title and artist (exact match only; a Spotify paste
names no artist, so it has none, nor an album or playlist), kept per device in
`tria:previews`. One clip at a time (`playPreview`, `stopPreview`, stopped by
route(), the viewer's close and slide, and backgrounding). **Every clip is
PLAYBACK audio and plays through the ringer switch, autoplay included** (Zoe:
"I should be able to hear with my ringer off"; `navigator.audioSession.type`,
iOS 16.4, and older WebKit media ignores the switch anyway). Tried and gone
the same day: autoplay as AMBIENT (the switch silenced it) with a native
volume-button watcher to turn it up (`SystemVolumeDidChange`, undocumented).
The play mark is `ICONS.playSoft`, round at every corner (Zoe: "rounded play
icon"). **A Moment's disc wears the sound toggle instead** (Zoe, 2026-11-07:
"use the mute unmute instead of the play button for songs"): `mute` while
stopped, `sound` while it plays, the ring still running round it
(`songPlayHtml`'s `ico`).
**In the app a clip plays NATIVELY, mixable, so iOS shows no Now Playing
player and no Dynamic Island** (Zoe, 2026-11-06: "get rid of dynamic island for
music and ios player"; `TriaSettings.playClip`/`stopClip`, an AVPlayer in
`.playback` with `.mixWithOthers` and `.duckOthers`, a `clipEnded` event).
Web Audio was not enough: iOS makes any app playing NON-MIXABLE audio the Now
Playing app, and WebKit's `'playback'` session is non-mixable; its one mixable
type, `'ambient'`, obeys the ringer switch. The web keeps the paths below.
**Off the app, a clip plays through Web Audio, never an Audio element** (Zoe: "I dont wanna see nor need the ios homescreen player";
`clipBuffer`, `audioCtx`, Apple's clip host answers CORS `*`; before 16.4 the
element stays, since there Web Audio obeys the switch). **Pausing a Moment's
song, or muting its clip, hushes them all** (`preview.hushed`): none starts by itself until the app
comes back from the background; a tap on a disc still plays it.

## Discover's search is the header; chips under it (2026-11-06)

**Discover's bar is the filter, the search field and Chats** (the filter
swapped in for the sidebar's mark the same evening, Zoe: "I dont think we need
the menu on the discover page"; the sidebar and its edge swipe are My Circle's
alone, and the search's back chevron went with the mark) (Zoe: "I
want the search to still always be available in the header"), and it comes
and goes with the header like every tab's. **The field is the web's input in
every shell, a flat neutral fill with no edge, never glass** (Zoe: "the buttons
still glass, not search, like insta, but cleaner"). That works because **the
bar's band is CSS in the app too** (see "The header is the CSS band"): nothing
native sits behind the bar any more, so nothing native has to sit over a web
field in it. The native `TriaSearchField` it replaced the same day is deleted;
its lessons are in docs/native-chrome.md. A drag on the page puts the keys down.
**Under the header, the chips** (`.discover-chips`, Zoe: "filters
below the search/header with trending tags"): up to ten trending tags (the
filter led them until it moved up into the bar), gone when none trend and
while a type is picked (Zoe: "If a filter is open or chosen tags dont need to
be there"; picking a type lets go of a tag) (`trendingTags`: a tag
on two or more findable posts, the last 30 days counting double, never a
daily's), each THE BUTTON at its quiet weight, chosen ones washed. A tag runs
as a search for its word, a second tap takes it off. The filter no longer
slides in at the field's end, so the field's box never moves and nothing is
animated across the bridge. Tried and gone the same day: the field at the top
of the page (it scrolled away), and a web field with the native material cut
around it.

## The header is the CSS band, the buttons native glass (2026-11-06)

**In the app the top bar's material is `.topbar::before`, the web's own**
(Zoe: "make it all our hairline css on iOS, but the buttons still glass ...
that way the glass isn't always so bubbly and prominent up top"): a blur, a
whisper of paper and ONE 0.5px `--rule` hairline under it, there only once
content passes under the bar and gone on a read down, as on the web. Native
draws only the discs, the title and the wordmark on it; `TriaToolbarMaterial`
(Liquid Glass in 1.4, `.systemChromeMaterial` from 1.8) is deleted. The band
and the native title agree because both read the same rule off the same scroll
(`HEADER_SLACK`, `TriaScrollWatch.slack`). **A profile holds its header**,
yours and everyone's (Zoe: "have headers be sticky on people profiles";
`holdsHeader`), like a chat and an open search.

## The camera roll is how a photo gets in (2026-11-06)

**In the app the composer's photo button is gone: a row under the note is the
way in** (Zoe: "make it easier and seamless to post images", then "replace the
frames icon ... take or choose a photo"; public posts over the last 60 days were
47% photo, 43% note). The row is two quiet discs, **Take a photo** (the system
camera, `capture` on `#c-camera`) and **All photos** (the whole library in a
sheet, clips too, opening with what the post already holds ticked, so Add
hands back the post's whole set: `TriaPhotos.pick`, `TriaLibrarySheet`,
`setLibrary`), then the reader's **recent photos in Apple's own picker set into
the page** (`TriaRoll`, `PHPickerViewController` `.compact` and `.continuous`,
iOS 17). A tap on a recent photo puts it in, a second takes it out. **No photo
permission is ever asked**: both pickers run out of process. A strip of our own
would need the whole library; that was the trade refused, and the cost is that
the thumbnails and checks are Apple's.
**The preview's x is how anything comes out** (`rollMode` in
`wireFrameCapture`: `.media-x` on the photo and on the clip, in the carousel
count's material). Under the roll there is no dropzone, no Add more, no Choose
another and no + or x in the tray, which only picks which photo the preview
shows. Picks are ordinary stills (`rollId` is the asset id, none for a camera
photo), so the carousel and its cap are unchanged (**ten photos since 2026-11-11**, Zoe: "Allow up to 10 carousel slides"; `supabase/carousels-ten.sql`, **NOT run** as of 2026-11-11: until `carousel_max()` answers, `Store.carouselMax` keeps the composer to six, and the order strip shrinks its thumbs to fit ten in one row); a still taken out is
unticked in the row (`rollDeselect`), the first thing in opens the photo
surface and the last out folds it. A photo added from All photos is not ticked
in the row (a picker can be unticked from outside, never ticked); tapped there,
it is marked as the one already in. **A clip** comes from All photos as a file
in tmp, read through `Capacitor.convertFileSrc`, never as base64.
**The row lives INSIDE the web view's scroll view** at the document rect of
`#c-roll-strip` (`.compose-roll` 104px, 140 on a Moment, the strip
`--radius-soft`), so it scrolls with the page; a ResizeObserver on the fields
re-sends the box. It shows while the post could take a photo (not over a link,
poll, plan, song or clip) and the picker stands down under a sheet or the
mention list, since native draws over every web pixel. **The web (Android,
desktop) and iOS 15 and 16 keep the photo button; the iOS app on 17 and up
never draws it** (Zoe: "ios should be cleaner"). `rollLikely` reads the OS off
the web view's user agent so the composer knows as it draws; a first pass
shipped the button with `hidden`, and `.rt-attach`'s `display: inline-flex`
beat the attribute, so it stayed on screen. `wireRoll` in renderPublish,
`stopRoll` in route().

## A photo colour is pinned (2026-11-05)

**The first sample of a face is kept** (Zoe: "my pfp color keeps changing"):
`photoTone` is the one way to a photo's colour: the stored ORIGINAL drawn at
64px and averaged in JS (`sampleFace`), kept per device in `tria:tone:<hash of
the avatar URL>`. **Never write anything but a key, 'default', 'none' or null to
`users.accent`**: for one evening the pin lived there as `'p:<hex>:<hash>'`
and older binaries lit their nav in Tria's colours over it. `healPin` seeds
this device from any such value and writes null back; `PHOTO_PIN` and
`isPhotoAccent` still read one as Photo. The native lit tab
wears `--heart` for every colour, as the web's does (a photo sent its paler
band stop).

## A link lands ON what it was about (2026-11-05)

**`#/p/<id>?c=<comment>` and `#/chat/<id>?m=<message>` open with that row a
little over the middle of the screen, washed in `--heart` for 2.2s** (Zoe:
"tapping a comment, notification, etc should also scroll to where it is";
`armSeek`/`seekNow`/`washFound`, `.is-found` in app.css). An Updates row for a
comment, a mention in one or a like on yours carries `?c=` (`commentId` on the
event in store.js); a like opens Likes (`?pane=likers`), a yes or maybe Who's
going, a quote the quote (`quoteId`). **A seek belongs to one FRESH history
entry**: a back onto it restores the reader's scroll, and it survives a
repaint of its own entry, so a push that lands before the thread
(arriveAt, primePost) still finds it. The newest message gets no seek (a chat
opens there). The old `?p=` links carry `c` (`seekQuery`). **A reply's quote in
a chat goes to the message it quotes** (`glideTo`), and the post page goes to a
comment you just sent if it landed off screen, as the sheet does. **The push
function points every post push at `#/p/` now** (`postAt`, `commentAt`) and a
message push at its message, so it needs a redeploy (REV 2026-11-05); until
then a comment push opens the post without the seek.

## An update shows what it was about (2026-11-05)

**An Updates row is a 44px face with a mark on its corner, then the words,
then a preview** (Zoe: "a cute beautiful on brand preview on the right side",
"make the pfp's bigger"). The mark (`notifFaceHtml`, `NOTIF_MARK`) is a disc
in `--heart` with its glyph in paper, ringed in the row's own paper
(`--notif-paper`, so an unread row's wash rings it too): a heart for a like,
a bubble for a comment, solid; @, repost, poll, check, calendar, person and
the triad in line at a heavier stroke. It was sized up the same day (Zoe:
"tough to read") until the glyph fills the disc. The preview (`notifThumbHtml`)
is the post's picture: a photo, a Frame's poster with a small play disc, a
song's sleeve at `--radius-art`, a Find's link picture once read; a plan with
no picture is a little calendar page; a circle join shows the circle's face.
**A text post, a poll or a follow shows no preview** (Zoe: "if its just a text
post no preview needed but keep it clean"; a drop cap was drafted and cut).
Friend request rows wear the same 44px face. **Still no count on the tab**:
Zoe asked for Instagram's count morphing into the dot and agreed to keep the
rule when it was pointed out.

## A new friend gets the stars (2026-11-05)

**When a tie turns mutual, `celebrateFace`'s stars burst off their face, half
in YOUR colour and half in THEIRS, alternating** (Zoe: "a mix of each users
color preferences"; `celebrateFriend`, `friendInks`). Only becoming friends,
never a request or a follow (`madeFriends` compares the status before and
after). Whoever completes it sees it: a profile's button (via
`celebrateArrival`, the face waits on its decode), a list row or Discover's
person card, and Accept in Updates (measured before the row is repainted away,
so the stars burst where it was). Each colour is that person's heart rule
(`starInks`): a pick's hex (its `ink` on paper), a photo's sample through
`heartsFrom`, `--mono-heart` for None, Tria's two ends for the default. The
twinkle replaces the LIGHT tap on that path. The code landed inside 9db51b7
(a parallel session's commit).

## Discover is a town square (2026-11-05)

**Discover has posts again** (Zoe: "include peoples posts if they are public
... like a town square"), undoing 2.0's "shows no posts". It is search, today's
daily, then **the square** (`Store.square`, `paintSquare`): the last TWO WEEKS'
public posts (two weeks since 2026-11-11, Zoe: "2 weeks not 1"), meaning Anyone posts and posts in PUBLIC circles (never
invite-only), friends' included, yours not, no reposts, nothing `offFeed`,
today's daily answers left to the daily's card, at most TWO a person
(`SQUARE_EACH`), newest first and never ranked, as My Circle's own cards in the
reading column (not the old masonry wall). **It ends** on Share Tria, no
closing line (Zoe: "town square" is ours; users only ever see Discover). **People are set between the posts on
a fixed rhythm, never at random** (Zoe asked for random; Claude pushed back:
random reshuffles under the thumb and reads as a slot): TWO CAROUSELS of
people (Zoe: "just have two carousel groups for each"; it was four, two of
circles and two of people, until 2026-11-08), the people split in half
(`halves`, one rail under four), after the 3rd post and every 4th after
(`RAIL_FIRST`, `RAIL_GAP`), the rest at the foot.
**No card under a circle's post** (Zoe: "the post itself is enough with the
reposts style citation"; tried and removed the same day). A rail has a little
less air over it than under (0.55rem, 1rem): the post above already ends on
its action row's space.
**The little algorithm** (Zoe: "a little one is fine if it gets people
connected") is only in the rails: people by friends in common. A rail is a
`.feed-extra` that `syncCards` diffs like a card (`nodeFor`), so a repaint
never re-rises the column. A search's circles stay a stack. No hairline over
the first post; the daily has My Circle's 2rem under it, like the Moments rail.
**Anyone may like, comment and vote on anything public** (Zoe: "I should be
able to like and comment on anything posted publicly on town square"):
`Store.canReact` is THE rule (app.js's `canSocial` and all five store writes
read it): yours, a friend's, Anyone, a circle you're in, or a PUBLIC circle's
post. Public circles' posts were members-only until then, and the store's
writes never knew circles at all, so a member's heart on a stranger's circle
post silently did nothing. RLS only signs the row as you; this is the product
rule. **A private account's post is never reposted or quoted by anyone else**
(Zoe: "no reposts for private users to keep things secure and safe feeling"),
public or not (`repostable`); its author still can. Client rule only: the
repost insert policy does not know it.

## Moments (2026-11-04)

**A Moment is an ordinary post that lasts a day** (Zoe: "24hr posts ... they can
live where the music currently lives, as an extension of it"; she named it
Moments over "In passing"). It is a FLAG, `posts.moment`, not a type: the type is
still inferred (note, photo, find, poll, and a song once
`supabase/moment-songs.sql` runs, **NOT run** as of 2026-11-04), never an activity
or a repost (`posts_moment_shape`). **The New sheet's Music row is Moment now**
(`ICONS.moment`, a bubble pair, off centre so it never reads as a lens; options in
https://claude.ai/artifact/HQYYdesESYAuKUS6NATGsA), and **Activity left the New sheet**
(Zoe, 2026-11-04): it is Note, Moment, Daily, Circle, a plan being the
composer's calendar button. **The Music button is back in the attach bar**
(Zoe, same day, `opts.song` on `richNoteField`, not on a daily answer): on a
note it makes a Music post as ever, on a Moment a song for a day, which On
repeat's week leaves out (`myWeekSong`, `songPostsOnRepeat`) and the rail draws
as a Moment with its sleeve. Moment opens THE composer in a moment mode, like the
daily's (`pendingMoment`/`composingMoment`): New moment, its own mark, no
caption over it (Zoe took the eyebrow off), no calendar, and an audience of My circle or Choose people
(`wide: false` drops Anyone, no circles). **It lives on the rail over My Circle and in no feed** (`offFeed` in store.js,
also off profiles, circles, pins, reposts and Discover search). **The rail is
one round face per person, their posts STACKED like stories** (Zoe, same day:
"each persons moment posts stacking like instagram stories do", then "just
someones pfp no matter how many posts", "circle everything", "just display name
is fine"): `momentStacks`, a stack being their song for the week then their live
Moments oldest first; the face (`.np-avatar`, 92px since 2026-11-06, Zoe: "a touch smaller", from
104; with its ring it fills 104) and the name, nothing under it. **Unseen wears a solid
ring** (Zoe, 2026-11-06, replacing a soft glow under the face): 3px of the
POSTER's band, not the reader's, 3px off the face (`ringFor`, `.np-ring`, a
masked donut): a pick's band, a photo's `bandFrom`, `--brand-band`, or
`--mono-band` for None. Squircles and moment previews in place of faces were
weighed and passed over: a row of squircle photos reads as app icons, a face is
round everywhere else, and a preview leaves a text Moment second class. Seen
ids are kept per device (`tria:moments-seen:<me>`).
Order: you, the unseen, the rest, by newest. Your face wears a + for another
Moment; with nothing up, your place is a round + saying **Share a moment**
(`shareMoment`, the moment composer, Share a song only without
add-moments.sql). **A tap opens the viewer** (`openMoments`, an overlay that
locks the page like a sheet, so the native chrome stands down, and route()
closes it): Tria's paper with a wash off the top-right corner (a photo or a song
takes its picture's own colour, Zoe; anything else, or a sleeve that won't sample, the poster's), face, name, age
and a bare x (the paper is always behind it), the content set as the feed sets it
(a short note big in the serif, a song's sleeve, title and Listen). **Nothing
advances by itself**: tap right for next, left for back, on into the next
person, a double tap likes (the heart where the finger was), a hold hides the
chrome, and on your OWN opens Edit moment and Delete moment (`openMyMoment`, or
Listen/Change song/Take it down for your song).
**One thing moves per gesture (2026-11-06, Zoe: "the full screen should move
down to dismiss rather than just some content").** Three layers: `.mv`, the
`.mv-veil` dim over the page behind, and `.mv-card`, the whole screen. A pull
down carries the CARD with the finger, shrinking a little and rounding its
corners as the page shows through; past `DISMISS_AT` (110px) or on a flick it
falls away, else it springs back. Each person is a whole `.mv-page` (face,
frame, rail, dots, and its own wash), so **a sideways drag is a page drag**:
the next person's page comes in beside it one to one, going on 28% of the
width or a flick (`slideIn`, `mvGlide`), and a tap past a person's last frame
slides the same way. Past the last person a swipe on closes. **A pull up
replies** (past `REPLY_AT`, 70px, the frame rising against a stiffening spring,
the reply words inking, their chevron rising and a LIGHT haptic arming it, Zoe
2026-11-05). **Reply is the foot** (Zoe, 2026-11-06: "replies at the bottom of
moments, cleanly ... more clear about the swipe up gesture"): `.mv-foot`, a
soft up chevron over "Reply to Ana", centred, no pill (Zoe: "remove the
pill"); a tap or a pull up (the words included, a drag never also clicks them)
opens the DM. Hidden with no Reply (`.no-reply`).
**Vertical paging between people was weighed and passed over** (Zoe floated
Reels' grammar, "not married to vertical scroll"): one axis would carry three
jobs (next person, close, reply), and a swipe through faces is the infinite
feed Tria isn't.
**The reactions are a rail on the right** (Zoe: "stack them like tiktok/reels
style"), `.mv-rail`: the heart, the song's play (its ring still runs round it),
the •••, **bare 24px icons, no discs** (Zoe: "I dont love the circle buttons";
the top bar's glyph size), a soft paper halo for a photo behind, no counts.
**The viewer is a grid** (2026-11-06): every Moment's words and the face start
on the gutter; every icon, the x included, ends on it (`--mv-inset` pays back
the 44px hit box); words keep clear of the rail's lane (`--mv-lane`); and ONE
BASE LINE (`--mv-base`: the Reply foot, held to its true 56px `--mv-foot`, plus
`--mv-lift`) carries both the last line of the words and the foot of the last
icon. **A song Moment with words of its own** (a headline or a note, `momentSaid`)
**is a words frame**: the words centred, and the sleeve frame's own caption
(serif title, artist, Listen) at the foot, the three as one group beside a
112px sleeve as tall as it (`tuneHtml`, `.mv-frame--tuned`; Zoe, 2026-11-07:
"let the user's content shine", "this with lil album", "bigger album and group
the listen button with the info"). A title stays on one line and
moves like Apple Music's when it's too long (`runTune`). In the head, under
the name, was tried and taken out the same day. The page still wears the
sleeve's wash, and the rail still plays it. Without words it is the sleeve
frame below.
**Every type is laid out alike** (Zoe: "all types of moments should have
a consistent layout"): the thing itself centred (a picture, a song's sleeve, or
the words), its words at the foot as a caption: a song's title, artist and
Listen moved there from under the sleeve.
**A stack of one has no indicator; two or more get soft dots under the face**
(2026-11-06, left under the avatar; they were at the foot until Reply took it), the
current one a pill (`.mv-dots`, Zoe: "no need for the gross instagram line
indicator if its only one moment"). The hairline segments are gone.
**A reply is a message, not a comment** (Zoe, 2026-11-05: "adding a comment
should actually be replies"): Reply (`replyToSong`) is your DM with the frame
on its bar. Your own frame, or someone you can't message, has no Reply, and
your own heart opens Likes. Every frame has a ••• (yours edits, anyone else's
reports and blocks). **The chip on the bar is led by what the frame showed**
(`setChatSong(post, pic)`, Zoe 2026-11-06: "text moments get the correct reply
preview (no album art)"): a song its sleeve in the round crop, a photo the very
photo answered (a carousel's, not its first) in the sleeve's round crop (Zoe: "the squircle dont fit"; a 12px soft square until 2026-11-06), a clip its
poster with a small play mark, words nothing at all (`.is-words`, padded as a
message reply). Words take the
vertical pan only when they really scroll (`.is-long`, a ResizeObserver), so the
pulls work on a short note. **The viewer is one reading column** (2026-11-06,
`--mv-col` 36rem, `--mv-side`): the head, stage and rail take the same side
inset, 14px on any phone and centred on a desktop. The stage stays full width, so
the tap zones (left third back, the rest forward) are unchanged. **On a desktop or an iPad (681px and up) the
viewer is a phone in the middle** (Zoe, 2026-11-07: "sized and padded
appropriately on desktop"): `.mv-card` is a 9:16 card, centred, 28px corners,
the page dimmed 62% round it, a click on the dim closing it, and inside it
every phone rule holds (full window, a portrait photo ran under the face and
its caption). The tap zones read the card's box, not the window's.
**A photo or clip Moment is edge to edge** (Zoe, 2026-11-06: "full edge to
edge ... captions and content below like tiktok and reels ... don't overdo
this"): the page takes `.is-pic`, the frame becomes the page-sized layer (so a
pull up still carries it), and the picture is centred and never cropped
(`contain`) on the page's own paper and wash. The caption sits at the foot in
the page's ink; **a long one folds to five lines with Read more** (`is-cut`,
the viewer's ResizeObserver, `toggleCaption`): a tap on the words opens it to
46dvh where it scrolls, a tap anywhere else folds it rather than stepping on,
and a hold hides it with the chrome. **Only a folded caption gets a contrast
layer**, one plain 82% layer of paper running on under Reply to the screen's
edge (Zoe: "just go with a regular opacity layer ... I fear we went
overboard"). **A picture 9:16 or taller** (`is-tall`, read off its own size as
it loads) reaches the face and the foot, so it wears the layer under any
caption or, with none, under Reply (`has-words`), and a lighter 60% one under
the head (Zoe: "top contrast can be less intense"). **Every layer is
feathered** on its open edge in eased steps over `--mv-feather` (64px), added
beyond what it covers, and the folded words feather out over their last line
and a half (Zoe: "feather the text above read more too"); dropping the
feather when the layer went plain was a mistake she caught. Tried and cut the same day: a blurred copy of the photo behind
it, a picture ending above Reply on soft corners (its dark band read as a
slab), feathered blur bands at the foot and the top, and a top scrim. **The
clip's sound is on the rail, in the song's play disc's place** (Zoe,
2026-11-07, `.mv-sound` in the rail, shown only on a clip's frame), and **a
clip follows the song's sound rule** (Zoe: "mute and unmute rules for music
... should extend"): it plays with sound by itself, through the ringer switch
(`clipSound` takes the PLAYBACK session), muting either a clip or a song
hushes every Moment until the app is opened again (`preview.hushed`), and a
tap on either speaker brings sound back to all. A browser that refuses sound
without a tap plays it muted and the speaker says so. The sound and mute marks are a soft filled speaker
(playSoft's rounding) with two waves or an x, everywhere.
Words frames are set in a further 10px (24px from a phone's edge) with 0.75rem
of air above and below the scroller; a pictured frame fills the column.
The rail's own double tap and hold are gone (`wireSongGestures` deleted).
The hint is v6 ("Moments last a day. Tap someone to see theirs, and double tap
one to like it."). **A day is enforced twice**: the client
drops it from `Store.posts()` (`momentLive`, `MOMENT_MS`) and a RESTRICTIVE
select policy hides it from everyone but its author (`supabase/add-moments.sql`,
**confirmed run** 2026-11-04: anon `GET /rest/v1/posts?select=moment&limit=1`
answered 42703 that morning and `[{"moment":false}]` that afternoon). Until it runs, `Store.momentsReady` is false and
the New sheet keeps Music. An older binary draws a live Moment as an ordinary
post until it expires.

## The tab you're on is solid, and no tab has a label (2026-11-05)

**Like Instagram** (Zoe; picked in https://claude.ai/artifact/7jHUB4GeuiKsUczsQqkytd).
Each tab's `<key>On` in ICONS is its outline grown solid: My Circle is now a
BUBBLE (the Moments mark's larger one alone, its shine cut through when solid;
the ring and dot is in git), Discover's triad is INTERLACED (the outline's lines
cut into three solid discs), Chats' two bubbles part on a seam, Profile fills.
Natively it is the item's `selectedImage` with no title (the label is its
`accessibilityLabel`); on the web capsule the solid svg sits before the outline
and shows only on `aria-current` or `--under`, and `.nav-label` is hidden there
(the desktop sidebar keeps its words). **Holes are plain SVG `<mask>` (cut only:
white keeps, black takes away) and `<clipPath>`**, which TriaSVG learned for
this, because the bar's images are templates and a hole painted in paper would
come out as ink. `svgIcon` suffixes ids per copy.

## Pins are a grid (2026-11-04)

**A profile's pins are two columns with one row height** (Zoe: "implement a grid
system and clean things up"; they were a stack of 88px rows, and a note or a find
set its words under the ••• with uneven padding). A row is as tall as a column is
wide (`--pin-row`, capped at 220px), the gap is 10px, the pad inside every card is
14px, the page's gutter, all four on `.pin-grid`. An odd count puts the first pin
across both columns at the same height, its picture one `--pin-row` square on the
grid's line. A card is a PICTURE (photo, poster, sleeve, or the picture a link's
page names, `pinLinkPicture`, read on the phone like a tile) with its words in
white on a shade, or WORDS: a headline over the note's first lines, ending on a
whole line (`fitPinWords` measures the clamp), and a foot with the domain, date or
artist. **A wide pin that is ONLY its photo or clip** (no title, words, tag,
link, poll or plan) fills the whole wide card (`pin--bare`, Zoe: "all the way
wide"), and its clip plays muted and looping while on screen
(`wirePinClips`, the feed's attach and let go rule; reduced motion keeps the
poster). **Words cut short get a Read more in the foot** (`fitPinWords` adds
`.pin-readmore` and fits again; the card is the link). **No song pins** (Zoe, 2026-11-08: Moments and Music cover it): a pinned listening status draws nothing and `setPins` drops it; a real Music post pins like any post, a Moment never. **The ••• sits in your own card's top right**, no type glyph (Zoe). A
drag trades places with the card under the finger and the repaint glides every
card there (`settlePins`, a FLIP); the menu's rows stay Move up and Move down.
iOS 15 is the floor, so no container queries: the row reads `100vw`.

## Swipe between the tabs (2026-11-01)

**Drag sideways on any tab and the next one comes in beside it, like Instagram**
(Zoe: "smooth and on brand and pretty", `TriaPager` in TriaChromePlugin.swift, app
only). One to one with the finger, past 30% of the width or on a flick it goes, and
a critically damped spring settles it. **Only pictures move**: the web view never
does (its frame is reset on every layout, and the bars are its subviews), so a
finger picks up `scrollView.snapshotView` of the page and the neighbour is the last
picture of that tab, or paper and its glyph if unvisited this launch. **The route
goes across on the lift, under the pictures**, and the arriving one dissolves off
once `pagerPainted` says the page drew. **Nothing is drawn between the pages** (a
glow of the reader's band was tried and removed the same day, Zoe: "remove the color
glow keep it simple"); past My Circle and Profile the page rubber-bands onto paper.
The title, discs and material fade with the page, never travelling (`setPageFade`).
**`window.triaSwipeAt` decides at touch-down**: a tab, the bar up, no sheet, no
caret, and nothing under the finger that owns a sideways drag, read off the page
(a `touch-action` other than auto, or a box that really scrolls sideways), so a new
rail needs no list. Only My Circle and Discover are pictured scrolled down
(`TAB_SCROLL`, the others open at their top). The edge swipes keep their edges: back
and the sidebar win, the pan waits on them. No haptic: it changes only what you are
looking at. See [docs/navigation.md](docs/navigation.md).

## Swipe a message to reply (2026-11-01)

**Drag a bubble or photo sideways, either way, and past 60px it arms** (Zoe:
"like imessages", who asked for left; iMessage's own is rightward): it follows the
finger, stiffens, a LIGHT haptic and the arrow light up, and the lift springs it
home and calls `setChatReply` (`wireMessages`, `.msg-swipe-mark`, members only).
`touch-action: pan-y` is what lets it share a thread with the scroll.
**The row never leaves the screen** (2026-11-10, Zoe: "replies often go out of
bounds"): it travels only into the room it has (toward its open side up to the
arrow, which waits at that end of the row and holds still; toward the closed
side only into the gutter), and the FINGER's distance arms it, so either way
still replies. The reply chip is `.postbar-msgreply`: from 2026-10-29 it was
found by `.postbar-reply`, which the comment edit's hidden chip also wears, so
no chip ever showed. While a chip waits the thread's foot grows by it
(`syncAnswering`, `body.chat-answering`). Every chat page holds its header
(`holdsHeader`, `#/chat*`): none has a tab bar, so a read down the Chats list
took the only way out. `messageGist` is what a message said, for the list's
preview, a reply's quote and the chip, never a raw URL.

## The + is the tab bar's centre; Chats is a bar button (2026-11-05)

**The tab bar is My Circle, Discover, +, Updates, Profile** (Zoe). The + is an
ACTION, not a place (NAV's `action: true`, route `#/new`, `ICONS.newTab` at a
2.3 stroke to sit with the solid tab marks): a tap raises the New sheet and lights
nothing (`shouldSelect` returns false for it, app.js's tap handler calls
`openComposeDial`), and **a swipe between the tabs goes straight past it**
(`TriaPager.wear` keeps places only). On the web it is a button in the phone
capsule (`.nav-link--pill`, `.nav-new`); the desktop rail has New at its foot. No
top bar wears a + any more (`composeBtnEl` is gone).
**Updates is the tab and Chats is the button on the RIGHT of My Circle's and
Discover's bars** (Zoe, the same evening: "updates is MUCH more active than
messages and I dont want to have a mostly empty feed on the tab bar"; for a few
hours Chats was the tab and Updates the bell). `chatsBtnEl(from)`,
`.toolbar-chats`, the chats glyph with its dot `.toolbar-dot` kept by
`syncNavDot` and read natively by `dotInk`; the Updates tab's dot is
`setDots({ '#/updates' })`, solid `bellOn` where you are. The tab Chats was
opened from (`chatsFrom`) is where the Chats list's back chevron goes; the
filter and New chat share its right. **The tab bar is on the tabs and nowhere
else** (Zoe, 2026-11-06: "just having no nav and the back button above"): a
tab's own page and the pages the + opens (the composer, New circle; the
composer's way out is the bar) have it, and every other page, Chats, a chat, a
friend's profile, a circle, a post, a list, a setting, has none and goes back
by its top bar's chevron, as a pushed page does in any iOS app (`tabbedRoute`,
`body.nav-off`, read by the phone nav's CSS and `NativeChrome.sync`). It
replaced, a day later, lighting no tab on Chats and a friend's profile with the
folded bar wearing Chats' mark or the friend's face (5648550: `hereFor`,
`facePixels`, `calmLens` hiding private `_UITabBarPlatterView` layers), which
leaned on private view names. On desktop Chats is still a sidebar row (`rail:
true`, never a native tab, never swipeable) and the sidebar is always there.
**Both My Circle and Discover lead with the sidebar's mark** (`sideBtnEl`,
`.toolbar-side`); while Discover's search is open that mark is the back chevron
that empties it. **The filter leads on Updates** (Zoe: the tabs you own), and
stays on the right of Chats; a profile has none since 2026-11-07 (its type tabs). With five
tabs the controller ran 10pt past each side of the screen (`tabReach`); that went
when Updates first left the tab bar.

## My Circle's sidebar (2026-11-01)

**The uneven hamburger on the bar's LEFT slides a tall panel in off the screen's
left edge**, on My Circle and Discover (the right, My Circle only, until
2026-11-05, when the bell took the bar back; a pick from Discover goes to My
Circle reading it, `pickFeed`) (Zoe: "like reddit almost", `openFeedSide`, `ICONS.sidebar`,
`.sheet-scrim--side`; a blur was tried and removed the same day, then came back
subtle on 2026-11-04: `--glass-blur-veil` (6px, 0 under Reduce Transparency)
under a lighter 22% dim, the radius fixed so only the scrim's opacity fades): Friends (the whole feed),
**Explore circles** (a way to `#/circles`, not a pick; Zoe, 2026-11-08), every
circle you're in by name, then People, friends and follows as one list (Zoe:
"friends can include following"), each alphabetical. Circles and People are
small Oxygen labels that fold (Instrument was tried and taken back the same day); People starts closed unless your pick is in it. It is `openSheet` with `side`, so its focus trap, the chrome
standing down and the swipe away (`dragToClose`'s `side`) are the sheet's. A pick
is an `activeFilter` key, `c:<id>` or `u:<username>` (`feedMatches`), so the
wordmark's place names it, not a control,, a tab re-tap clears it and the New posts capsule still works.
**A circle is the one pick wider than the feed**: `Store.feed` keeps a circle's
posts to you and your friends, the sidebar reads the whole room (`feedPool`),
strangers' posts too. A row stays listed with no posts in it.
**It starts at the foot of the status bar** (the clock used to straddle its
edge). **A swipe in from the left edge opens it on My Circle and Discover, never
back**, and a drag left closes it: native (`sideEdge` in
TriaViewController.swift, calling `window.triaOpenSide`), because
`allowsBackForwardNavigationGestures` gives WebKit that edge for back whenever
there is back history. WebKit's own swipes wait for it to fail; off `#/` and
`#/discover` it never begins.

## 2.0's brand: cyan to green (2026-10-22)

**Tria's colour is one ramp, `--brand-start` #00c9ce to `--brand-end`
#00cc9e** (Zoe: "these are the new ACTUAL tria brand colors", the app icon's
Icon Composer gradient; it was peach #ffac68 to rose #ff0049 that morning, and
the tokens were `--brand-peach`/`--brand-rose`). **Post types carry no
colour**: a glyph names a type. **`--danger` is its own red** (#d1003c /
#ff0049), never the brand. `--brand-ink` is the green deepened to #00735c for
words on paper and Tria's own heart there. **Tria's ramp is recognised by its
stops (`isBrand` in app.js), not by hue spread**: its ends are 15 degrees apart,
narrower than an accent. The logo SVGs, gen-icons.js, the
splash's `@property` values and the refresh glow (`TriaEdgeGlow`, as its
fallback) hold the two hexes by hand. See the top of [docs/design.md](docs/design.md).

## Refresh, audited (2026-10-30)

**A notification opens its page at once and catches up behind it** (`arriveAt`,
universal links too; it used to await the whole world first, Zoe: "takes a while
and shows whatever the last page was on"). A post's thread comes on one round trip
(`Store.primePost`), a chat's with the chats, then the world. A page that misses
meanwhile draws nothing (`catchingUp`, `#page-wait`), never "isn't here", until the
world has actually said so. **`Store.refresh` shares one pull in flight.**
**A feed down the page gets the New posts capsule** (`offerNewPosts`, `.new-posts`,
`.pill-quiet` in floating glass, up to three faces, never a number): nothing moves until it's tapped, the
paint it holds is `owedPaint`, and at the top of a page posts simply arrive. Besides
a foreground, an open feed asks `Store.newerPosts` once a minute (one row; the world
is pulled only on a yes), so "nothing polls" is no longer true of feeds.
**Re-tapping any tab refreshes it**, Profile too, the edge lit for the whole pull
and a LIGHT haptic on the tap (`reclick`, Zoe's call); profiles can be pulled, repainting by re-routing, only when asked. **A
foreground re-pulls on every page**, so an open chat catches up. **The glow's top
runs down into the status bar and never past its foot, however hard the pull**
(`crown` in `TriaEdgeGlow`, Zoe, 2026-10-31). See [docs/views.md](docs/views.md).

## The light is one set of numbers (2026-10-31)

**Everything that falls on the page as colour is equally bright** (Zoe: the
refresh glow "about the same as the profile gradient", the gradients a touch up
now they're in the corner, "formalize and make cohesive"). **THE LIGHT** in
tokens.css holds them: `--wash-tint`, `--wash-keep`, `--wash-sat`, `--wash-amt`
(62%, was 56) and a `-tria` set for the house ramp (66%, was 60). A profile's
wash, a person card's wash and the refresh glow all read those, so turn the dial
there and never in a rule. The glow is native, so `glowLight` in app.js does the
wash's mix and its `saturate()` matrix to the reader's stops and sends them with
`peak` (the amt) on each pull. Measured in WebKit, paper plus that light lands on
the wash's own pixel within a point or two, all accents, both schemes. The crown
starts at `peak`; the strokes take no scale, because their halo is already about
half strength where it enters the glass.

**The hum starts with the pull's first point** (Zoe: "too subtle, can start
earlier"): app.js says `prime` as a finger lands at the top of a page that can
refresh, native follows the scroll view from then on, and it stands down after 3s
if nobody pulled. **`TriaPullSwell` is built on Apple's HapticPalette sample**: no
dial in the pattern (one at 0 silenced the hum, 2026-10-31), the event at the peak
and `sendParameters` only turning it down, and one engine left up under auto
shutdown. SwiftUI's `sensoryFeedback` is one tap at a time, so it can't swell.

## 2.0's refresh is the screen's edge (2026-10-22, trial)

In the app, pull to refresh glows the reader's own band in off the
display's rounded edge (the stroke sits past the glass; only its halo shows) instead of the dot ring (`TriaEdgeGlow`, `setGlow`,
`NativeChrome.glowLight`), with feathered tips that reach the foot of the status bar at
the threshold, and a haptic swell into a click there (Core Haptics, `TriaPullSwell`, Zoe: Instagram's vanish mode). The web keeps the ring. See the
top of [docs/views.md](docs/views.md).

## 2.0: the version, and the web's nav (2026-10-22)

**1.9 shipped as 2.0** (Zoe: circles earn it). `MARKETING_VERSION` is 2.0 and
every "1.9" release marker in code and docs now says 2.0.

**The web nav is zoeallgaier.com's**, in Tria's glass (`renderNav`, "The nav
(2.0)" in app.css). One DOM, two shapes. **Phone (web, Android, an installed
PWA):** a floating glass capsule with a 1px `--rule` hairline, four tabs, icon
over label, the current tab on a soft neutral capsule, and it **tucks on a read
down** with the header (`nav--tucked`, set in `syncToolbarReading`; back on a
scroll up and at a page's foot). **Desktop:** the inset glass sidebar, its
wordmark ruled off by a hairline (`.nav-head`), the same neutral capsule for
where you are, and **New** at the foot, ruled off (`.nav-foot`). **One
New per shell:** the sidebar's New opens the New sheet
(`openComposeDial`, the old "+ Post" linked straight to the composer), and My
Circle's compose mark is hidden at desktop width outside the native shell. The
native shell never draws the CSS nav, so none of this reaches the iOS build.

## Links are part of the words (2026-10-30)

**A link embeds wherever it is, and Find is still a post type** (Zoe: "I want
every link embedded as much as possible"; Finds were taken out for it the same day,
then back: "lets still use that but with embeds", 2026-10-31). The composer's link
button opens the Link field, which makes a Find (`type: 'find'`, the link in
`posts.url`, the type inferred like any other, its own Finds filter), and its tile
previews under the field. You can also paste a link into what you're writing, on any
post, and that post stays what it is. The Make it a Find nudge stayed gone: a pasted
link already embeds, so it has nothing left to offer. A Find's `url` is read first
(`postLinks`). **A link is a
plain URL in the stored note**, so it is all read off the words as a card is
drawn (`linksIn`, `postLinks`), no migration, and every link anyone ever pasted
wears it. **Every link gets a tile under the post, up to four** (`LINKS_MAX`,
`linkTileHtml`), the tags over them: a circle's card, a Tria post (the quote's
tile) or person, a song's row, a YouTube player, the picture itself, else the
page's own title, words and picture (`.card-page`), else a row naming the domain.
**Apple Music, Spotify and YouTube Music links draw as the Music post's row**
(`songRowHtml`, opened in the reader's own service by `songLink`,
`data-out="system"` so it reaches the app), but the post stays a note, in feeds.
music.youtube.com is a song, not a video. A link that ENDS the words comes out of
them (`noteWithoutTail`); one mid-sentence stays, short and tappable
(`linkAnchorHtml` through `richText`, so comments and messages have live links
too). A comment wears its first link's tile, a message the same. The composer
shows the tile under the box as you paste (`wireLinkPreview`, inert). A circle
carried from its Invite sheet is `pubCarried`, added to the note as Share is
pressed. Tiles are stand-ins filled in a microtask after `cardSig`
(`wireLinkTiles`, `data-tile`) and `keepTiles` carries them over a rebuild.
**Only the app can read a page** (`TriaSettings.pageHead`,
`TriaPageReader` in TriaSettingsPlugin.swift: no server, no secret, no cookies,
stops at `</head>` or 1MB, 10s, never the phone's own network, kept per device in
`tria:links`), **so the website and an older binary draw the domain row.** Reading
happens on each reader's phone, so a linked site sees that phone's IP, as it does
for the tile's picture.

## Comments and likes are sheets over a feed (2026-10-29)

**On a phone, a feed card's comment glyph raises the thread as a sheet** (Zoe,
a Threads/Instagram comments sheet as the reference: "without people having to
go back and forth between pages"), and **the author's heart raises Likes**
(`openThreadSheet`, `openLikesSheet`). It is `openSheet`, taller and fixed in
height (`.sheet-scrim--thread`), and its composer is THE COMMENT BAR mounted
for the sheet's length (`mountPostBar`'s `thread`), native in the app: the one
overlay `pushPostBar` keeps (`body.thread-live`), taken down in `openSheet`'s
synchronous `onClose`. The list's foot is padded by `--native-postbar-lift`
(app) or `--kb-lift` (web), and `setKbInset` never scrolls the page under it.
**Your own comment has no trash: hold it** (450ms, or a right click) and it
lifts onto a soft fill with Edit and Delete as equal, centred halves under the
row, opening on a grid-rows tween, in place in the sheet AND on the post page
(`wireCommentHold`, delegated once per thread root, Zoe 2026-10-29). The click
that ends a hold is swallowed only in a 350ms window after the lift: iOS often
sends none after a long press, and a flag waiting for it ate the next tap
("I have to press it twice"). **An activity's headcount in a feed raises Who's
going** (the host's Guest list) the same way (`openGoingSheet`), its answers
shared with the page through `goingBodyHtml` and `wireRsvp`, which lights the
tapped answer before the write lands. `openSheet` runs `wire` last and inside a
try, so a throwing sheet can never leave `sheetOpen` stuck and every menu dead. Edit puts
the words in the comment bar under an "Editing your comment" chip
(`postBarEdit`) and the send saves them. Edit is through
`supabase/comment-edit.sql` (**confirmed run** 2026-10-29: anon
`edit_comment` answers its own 28000 "You need to be signed in."); were it
ever missing again, the hold offers Delete alone (`Store.commentEditReady`). Comment hearts are 22px (were
18). The sheet is `min(66dvh, 640px)` tall and keeps the 6px inset every sheet
has. **A tap on a card's headline or words raises the sheet too** (Zoe,
2026-11-04: "tap title or content", `wireComments` clicks the glyph; a link,
mention or the quoted tile keeps its own tap). **A tap anywhere on the panel closes it, the comments themselves included** (Zoe, 2026-11-04 for the empty space, 2026-11-06 for the rows: "tap the background of comments to close the comments too"), except on something with a tap of its own (`SHEET_KEEPS`: a name, a mention, a heart, a photo, a link's tile, a held comment's pills), and not one that only lets go of a held comment; with the keys up the first tap only lowers them. **The post page stays** for Read
more, Updates rows and links; a desktop (wider than 680px, not native) keeps
the glyph a link, so the words lead there.

## A new account has a first run (2026-10-28)

**Sign up, make it yours, find your circles, then home** (Zoe). `#/welcome`
is Edit profile's form in a welcome mode (`renderEditProfile({ welcome })`:
titled Create your profile: photo, Theme, name, pronouns, bio, a Next at its foot, no Charms while every one is locked, no lede; the settings and
account rows stay in the DOM, hidden) and `#/welcome/circles`
(`renderWelcomeCircles`) is Discover's circle cards with a Join that toggles to
Joined in place (`communityCardHtml`'s `pick`), then Done or Not now. The tab
bar is put away on both (`body.welcome-live`, also read by `NativeChrome.sync`).
**Who is new is read off the world** (`needsWelcome`): an account under three
days old (`users.created_at`, mapped as `joined`) with no friend, circle or
post, not yet marked `tria:welcomed:<user>` on this device, so every way in
reaches it with no flag at sign-up. `route()` sends `#/` there once a session,
and baselines charms empty so a first circle is an unlock.
**Signup asks for the @handle only** (Zoe, 2026-10-29: the name is step
one's), the handle and the email ONE combo box over the labelled password: `Store.signup` saves the handle as the name (`users.name` is not
null), and step one shows that as an empty Display name field, an empty one
keeping the handle. The Apple/Google claim screen is handle only too, a
provider's name kept as the display name.

## The app icon comes in every accent (2026-10-27)

**Edit profile's App icon color row** (Zoe, under Open songs in, the app only)
switches the home screen icon between Tria's own, the nine accents and None, picked
in the Theme sheet's swatches (`swatchHtml`): the source row is Tria, **My
theme** and **None**. My theme (its disc the early quartet, 1.3's lavender, blue, green and orange band, as four soft corner blooms over an oklch conic, `themeWheel`; a rainbow band was "nyancat") follows the profile's theme on this device
(`tria:icon-theme`, `themeIconKey`: a photo takes the nearest accent by hue),
re-iconing after a theme change saves (`applyAccent`). None is the black and
white icon, `--mono-band`'s ends, white on the dark icon (an appearance
specialization in its icon.json). Amber (gold), lime, jade and cyan are DEEPER on the icon than in the
palette, so they read on white (`DEEPER` in the script, `ICON_DEEPER` in
app.js, kept equal by hand). **My theme is the default until you pick another
(Zoe, 2026-11-01, `syncThemeIcon`, `'0'` in `tria:icon-theme` means a pick; an alternate icon already on with nothing stored counts as one).** iOS can
only switch to icons built into the binary, so each is an Icon Composer file,
`ios/App/TriaAppIcon-<key>.icon`, made by **`node gen-alt-icons.js`** from
TriaAppIcon.icon with its two fills swapped (the wordmark a 15 degree ramp
around the accent, the rings the accent). **Redraw the icon, rerun it.** The
project lists them in `ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES`;
`TriaSettings.appIcon`/`setAppIcon` do the switch. iOS shows its own "You have
changed the icon" alert on every switch, and no public API holds it back, so following by
default means that alert once when the icon first changes, and again after a theme changes elsewhere.

## 2.0's charms (2026-10-24)

**Six little firsts**, worn on the rim of your photo (Zoe's sketch): First
word (a post, a cute spiral since 2026-10-25, Zoe: "instead of quotes", then
"deeper tighter", three even turns; it was an outlined round quote read as "66"),
Mutuals (Tria shared off the app, a completed share sheet or a copied link,
`noteShared`; it was a first friend until Zoe: "we need more new users", and
kept its name and two stars, a touch bigger since 2026-10-25), In the ring (join a circle), Founder (start
one), Sunny (the daily), On repeat (a song). `CHARMS` in app.js. **Since 2026-11-12 they are SOLID and in a heart's colour, the wearer's on a face (see "Charms: solid, in a heart's colour" above); what follows was true until then.** **Outlined, in the icon set's line** (the circle triad,
daily and music are ICONS'; the spiral, stars and sprout are drawn to match)
with the SAME four trims, a sparkle with a dot and a speck with a star, in
opposite corners and close in (on Sunny's diagonal, top-right and
bottom-left), each pair nudged in per charm (a `translate` on the
trim): two units in on most, one on Mutuals, whose bigger stars need the room. Sunny is a five point star and On repeat a single eighth note (Zoe,
2026-10-24). In plain ink, `--text` via `--charm-ink`, the device's
opposite: black on paper, white on ink, never `--heart`. This is 523aa77's art, restored on 2026-10-24 (Zoe: "go back to
the second outline tria style icons") after a solid pass in plain ink, a
simpler one with fewer trims, and Susan Kare style pixel art (all in git:
dee25a8, 9615480, d9727e0). **Earned is never stored**, it is read off the cache
(`charmsEarned`). **Sticker charms** (2026-10-25, Zoe: iMessage photo stickers): no app can read the sticker library, so in the app the picker's **New charm** tile ("Add an emoji or sticker.") opens a NATIVE sheet (`TriaStickerPlugin.swift`, `TriaSticker.pick`) that raises the emoji keys (a `textInputMode` override), takes the first sticker tapped (an `NSAdaptiveImageGlyph` on 18, an attachment on 17) or emoji (drawn big and trimmed to its ink, `emojiImage`, then the same PNG path), pops it into a well and closes itself; its From a photo button cuts a picture out with Vision's foreground mask (iOS 17). The web takes a picture file (a hidden rich field raised the letter keyboard over the picker). The PNG is uploaded (`Store.uploadSticker`) and worn as `'i:'` plus its path in the wearer's OWN media folder, never a URL (`isSticker` in store.js, `charms_valid(charms, id)` in `supabase/sticker-charms.sql`, **confirmed run** 2026-10-25: anon `rpc/charms_valid` answered PGRST202 before it and `true` after, and a sticker is worn live; were it ever missing again, the live check refuses a sticker with "Couldn't save your charms."). **Up to fifty are held** (Zoe, 2026-11-11, `STICKER_MAX`; ten from 2026-10-25): your sticker charms ARE the sticker files in your own media folder (`Store.myStickers`, a Storage list), so they follow you to every device with no column; the device keeps the last list (`tria:stickers:<id>`) only to paint at once. At fifty, New charm says "You have fifty. Hold one to delete it." A new one is worn like any charm (a third replaces the oldest). The sheet says "Added!" as one lands. **No charm the sheet makes wears a white edge** (Zoe, 2026-10-25: "remove the white outline"; every one had the photo cut-out's, `edged`, that morning, so stickers added before then keep it baked into their PNG), and a worn sticker charm drops the paper halo the line charms keep (`.charm--sticker`). **Holding one deletes it** (Zoe, 2026-10-25), in place since sheets don't stack: a red x takes its check's corner (no wiggle, Zoe), the x takes it off your photo and deletes its file (`Store.dropSticker`), a tap anywhere else puts it back; a right click is the hold on a desktop. The sheet's title is the italic Instrument Serif from `css/fonts/instrument-serif-400i-latin.ttf`, converted from the woff2: **replace the web font and convert this TTF too**. The ghost left for it, the bat stays. Only what you WEAR is a column, `users.charms` (at most two,
`supabase/add-charms.sql`, **confirmed run** 2026-10-25: anon
`GET /rest/v1/users?select=charms` answers rows, some wearing `["bat"]`, where it
answered 42703 on 2026-10-24; were the column ever missing again,
`Store.charmsReady` is false and nothing of charms shows). Celebrated unlocks
live on the device (`tria:charms-seen:<user>`). **An existing account gets ONE
welcome sheet** ("you've already earned these"), never an unlock per old
post: the first look on a device baselines, and only after the real world has
landed (`charmsLive`, off `whenFresh`). An unlock is `openSheet` with the charm
big, `celebrateFace`'s stars and twinkle, and Add to my photo or Not now (with
two on, "Wear it instead of …"). **Edit profile is photo left, three quiet
pills right** (New photo, Theme, Charms; Color until Zoe renamed it Theme, 2026-10-27); the camera and colour badges left
the rim. The design canvas: https://claude.ai/artifact/12LLXUDDJ6UjcaErigtTDf

**A profile's wash blooms from the TOP-RIGHT corner** (Zoe, 2026-10-24, so the
photo and its charms sit on clear paper; `--wash-at`, both the accent and the
house-ramp copies) and an accent's wash is its SPECTRUM, three stops 18 degrees
of hue apart (`stopsAround`, `WASH_ARC`, `--wash-a/b/c`, each tinted on its
own), like a daily tag's band but wider.

## One gutter, and a carousel that sits like a photo (2026-10-25)

**Every page on a phone has the same 14px side inset** (Zoe: "all pages /feeds
should have the same padding"), one token, `--gutter` on `.view` in the phone
block; every break-out (`.feed`, the lists, the rails) and the padding that pays
it back reads it, and the top bar's `--toolbar-pad` and `.auth-topbar` are the
same 14px. Don't reintroduce a per-page gutter. **A carousel is centred like
any Frame**: the photos stand in a row a gap apart, clipped to the box's rounded
corners, and slide, with "1/4" in the photo's bottom left corner at the tags'
size, white on a small dark blurred pill, so the reaction bar stays clean (dots
were tried under the photo and on it the same day). It is a position, not a
tally, so the no-count rule doesn't reach it. The hand-of-cards peek is
gone. See docs/data.md under the carousel.

## Discover's search has a filter (2026-10-25)

**While search is open, a filter slides in on the field's right** (Zoe): the
sliders disc in a slot that widens on the signature ease while the disc springs
in (`.discover-filter-slot`, `syncOpen` in `renderDiscover`). Its sheet is All,
**People**, then the post types without Music (`discoverType`). People is
everyone who matches; a type is its posts only; with nothing typed, either is
everything of its kind. A pick keeps the search open, washes the reader's band
into the disc, and the placeholder says "Search frames". The chevron or Escape
clears the words and the filter together.

## A YouTube link plays in its card (2026-10-25)

**A link to a YouTube video wears a tile** (Zoe: "embed them so
that thumbnails and everything show"): the song's and the quote's material,
the video's still on top (16:9; a `/shorts/` link 4:5), the Frame clip's glass
play disc, then the video's title and channel (`youTubeTileHtml`,
`wireYouTube`, `.card-yt`). **It is read off the URL at render, nothing is
stored**, so every Find ever posted has it. Title and channel are YouTube's
oEmbed, kept per device (`tria:yt`); a 401/403 there makes the tile a link out
(`data-out="system"`), and a video with no still is dropped back to the plain
Find. The player loads only on a tap, one at a time, and `keepTiles` carries
a live one across a card rebuild. **In the app the player is
`embed/youtube.html` on triaonline.com** (`ytPlayerSrc`): YouTube answers
"Error 153" to an embed with no Referer, and WebKit never sends
`capacitor://localhost` as one. That page is web-only (not bundled), so it
must stay live on the site; the web embeds youtube-nocookie directly.

## A circle can be posted to your circle (2026-10-25)

**A circle's Invite sheet leads with Post to your circle** (Zoe, not "feed": "posted as a
card"), above the friend picker (`openSheet`'s `rowsFirst`). It opens the
composer holding the circle (`pendingCircleShare`), and **any link to a circle
draws as Discover's card for it** (`circleOfLink`, `circleTileHtml`,
`.card-circle`), Join pill and all, read off the URL like the YouTube tile. In the
composer it is the inert card with an x on its top right corner that takes it off
(`wireCarriedCircle`, `.compose-circle`). **The circle a post
carries is never offered as its audience** (Zoe: no sharing a circle with
itself): the audience sheet leaves it off (`except` on `wireAudienceLock`,
`attachedCircle`), and a post already aimed at it falls back to the default
as its card goes on.

## A note is standard; the quill makes it a poem (2026-11-07)

**A Return is a new paragraph by default** (Zoe: "keep it standard and then
lets add a 'p' next to bold and italic ... so people can still make poetry on
tria. thats important"), and a second Return on the empty line is held
(`beforeinput` in `wireRichEditor`), so the field never shows a blank line
that posts as nothing. **The quill after B and I (`ICONS.quill`, a lowercase p
until Zoe swapped it the same day: no app has a standard poem mark, and a p
reads as "paragraph") is the whole note's poem switch** (`.is-poem` on the field, `serializeNote` passes `asLines`): on,
the rule below holds. Nothing stored knows the mode; an edit reopens as a
poem when a paragraph holds a `<br>` (`isPoemNote`). WebKit leaves the first
line as bare words on the root, so the input handler gives it its `<div>`.
**Bullets** sit after the quill: `insertUnorderedList`, stored as `<ul><li>`
(`{ tag: 'ul' }` in `richItems`, `.card-list`, a soft `--muted` dot), read
even when WebKit nests the list in a line's div. A note that opens on a list
leads with an empty `<p>` so older builds still take it for rich (they draw
the list as lines). The push function's `plain()` learned `</li>`, so it
needs a redeploy.

## A poem is paragraphs of lines (2026-10-26)

**A Return is a line, a blank line ends a paragraph** (a poem's stanza), in
the editor (with the quill on, since 2026-11-07), the feed and the story card alike (`richItems`, `noteParas`). A
note stores a stanza as ONE `<p>` with `<br>`s; every Return used to become its
own `<p>` and blank lines were dropped, so a poem's stanzas posted as evenly
spaced lines. The editor reads a block as a line (`asLines`), storage reads it
as a paragraph, so old notes keep their gaps and older builds draw a `<br>` as
a paragraph break. **One spacing scale** ("A note's rhythm" in app.css, mirrored
by `.rich-note` and `FLOW` in storycard.js): 1rem between paragraphs, 1.6rem
over an H1 and 1.35rem over an H2, 0.4rem under a heading, top margins only.
The editor marks a blank line `.is-blank` and draws it at that 1rem. A line
keeps its indent (`.card-note` is pre-wrap). The push function's `plain()`
learned `<br>` too, so it needs a redeploy.

## Repost inherits, quote chooses (2026-10-26)

**The repost sheet is two rows, Repost (or Undo repost) and Quote** (Zoe: "use
the quote post menu to add the audience feature"). A **bare repost wears its
original's audience exactly, EXCEPT a circle's post, which goes OUT to your
friends** (2026-11-10, Zoe: "circle posts should only be repostable OUT of that
feed. Otherwise we get duplicate posts in the same feed"; `bareRepostPlace`,
no membership needed). A quote never goes back into its own circle either (the
audience sheet's `except`, coerced in `createRepost`). Bare reposts already
made inside their own circle are hidden everywhere (`repostInPlace`, in
`posts()` and `myBare`); quotes there have words and stay. A
**quote** has the composer's audience field, ALL of it, whatever the original
was (Zoe: "I should be able to choose the audience on quotes"): Anyone, My
circle, Choose people, any circle you're in. So a quote is how a post goes into
a circle or out of one. The read gate (`can_view_original`) still holds a quote
to the people who can read its original, so over a friends-only or
invite-only-circle post a line under the field says who that is
(`quoteReachHint`: "Only your friends will see it.", "Only people in c/x will
see it."). A quote starts with your friends over a friends-only post or an
invite-only circle's, never in the post's own circle. **Someone else's friends-only post has no
repost glyph** (Zoe, 2026-10-26, `repostable`): it could only reach the author's
own friends, so a private circle is never widened and the glyph would promise
what it can't do. Your own still reposts. The Repost to a circle row and its picker
are gone. The rules are
`supabase/repost-audience.sql` (**NOT run** as of 2026-10-26; it replaces
repost-to-circle.sql, whose REVERTED version the live DB had run). Until it
runs (`Store.repostRulesReady`, a once-a-session ask of
`repost_insert_ok(<public post>, 'list')`) a circle's post has no repost glyph
and a quote's field is fixed to its original's audience. **The push function changed too**
(`canRead`: a quote's push only reaches the original's author when the quote
does, and a mention in a quote only someone who can read both), so it needs a
redeploy. See docs/data.md under reposts.

## 2.0's polish pass: one button, one share, a first run (2026-10-22)

**THE BUTTON.** Every button in a page is one material at two weights (Zoe:
"every button in every page should have this new style"), declared once early
in app.css: **`.publish-fill`** is a commit (glass fill, one hairline
`--pill-edge`, the reader's band washed under the words at `--pill-wash` 0.3,
page ink) and **`.pill-quiet`** is every other button (same glass and hairline,
no band; `.is-on` takes the wash for a chosen RSVP or card background).
Components own geometry only; page-wide pills are 52px; both weights press
through PRESS_TARGETS. `.is-solid`, the ring mode, the tinted-glass list, the
dead phone FAB and speed dial, the dead `.modal` system and the native
page-button bridge are deleted. The native bar's commits wear the same wash
(`washFill` → `spec.wash` in `TriaBand.apply`). See docs/design.md's top.

**Share profile is a QR sheet** (Zoe, 2026-10-24: "add QR sharing instead of
the apple share sheet"; it was the system sheet from 2.0's "remove all the qr
code bullshit", which took out the story-card profile card and its four
backgrounds). `shareProfile` opens one `openSheet`: the code with NO plate
behind it, in the page's ink (Zoe: "bright, without a second background"), so
dark on paper and light on ink, then the name and @handle, then Share link (the
system sheet, through `handOver`) and Copy link. Level M, a four-module quiet
zone inside the SVG, whole device pixels to a module (`qrSvg`,
`sizeProfileCode`), and no logo or tint: it was read back with Vision in both
themes. **The modules are GOOEY** (Zoe, 2026-10-24): a lone module is a dot, a
run a pill, inner corners filleted so neighbours melt, and the three eyes are
soft squares; read back with Vision again, versions 3 to 6, both themes. `js/vendor/qr.js` is back, untouched from its checked version. Own-POST
story cards stay, and are simpler (Zoe, 2026-10-24): **no colour options**,
the card is the device's light or dark (`StoryCard.deviceScheme`, pinned as
the sheet opens), the post set straight on the page's paper with **no card,
no hairline, no shadow**, the app's type (serif headline, Oxygen Light note),
the teal wordmark at the foot, and the photo full column width with a soft
corner. The sheet is titled Share post and is two rows, **Save image and Copy
link: Share to Instagram is gone** (its Swift methods, Info.plist scheme and
`metaAppId` are left with no caller). A Frame's card draws its poster, not
the clip, and a song goes out as a link (it had no words, so its card was
blank). **An essay is set as an essay**: the note crosses as its h1/h2/p
blocks (`cardBlocks`, `FLOW` in storycard.js), shrinks only to a readable
floor (`bodyMin`), and past it fades out under the feed's Read more curve and
ends on a whole line with an ellipsis. **In the app the system sheet is UIKit's** (`TriaShare.shareLink`, which
`shareOrCopy` tries first in the native shell): WKWebView's `navigator.share`
opened nothing from a menu row, so it is only the web's now.

**First run.** Signup's @handle fills itself from the display name until you
type in it, cleans what you type, and says "taken" as it settles
(`wireHandle`, `Store.usernameFree`), on the claim screen too. An empty My
Circle offers Find people and circles and Invite a friend (your own profile
link, "Add me on Tria"); an account with no friends and no songs gets no On
repeat rail; empty Chats offers Start a chat; your own empty profile offers
Write your first post and, while bare, Add a photo and bio.

## 2.0's second pass: invite-only circles, the circle form, the profile (2026-10-23)

**A circle can be INVITE ONLY** (Zoe: "add privacy options like profile
settings ... invite only circles should be a thing"), `supabase/circle-privacy.sql`,
**confirmed run** 2026-10-23. `communities.invite_only`, a `community_invites` table, and the
rule as a BEFORE INSERT trigger on `community_members` (`community_invite_gate`),
so neither `join_community` nor `create_community` is restated and the two
unrun circle files can go either side of it. The host picks it on New circle
and Edit circle in a **Who can join** field shaped like the composer's audience
field (Public or Invite only, a sheet, `communityJoinInner`), above the handle; a new one is
created then switched (`Store.createCommunity`'s `inviteOnly`). Any member's
Invite records the invite (`invite_to_community`, friends only) before the DM;
the join uses it up. An invite-only circle is still on Discover with a padlock
on its handle ("Invited" or "Invite only" after it, no Join pill unless you
hold an invite), and a stranger's pill on its page says "Invite only" with no
tap. **A public circle's posts are readable by anyone** (Zoe: "if a circle is
public posts should be visible"), signed in or out, through
`supabase/circle-public-posts.sql` (**confirmed run** 2026-10-26: anon reads
`audience=eq.community` rows from public circles), which widens
`community_reads_post` and leaves `can_view_post` alone. An invite-only
circle's stay with its members. RSVPs are still for members (and the author's
friends); likes and comments opened to anyone on 2026-11-05 (`Store.canReact`).

**New circle is the composer's page**: the serif nameplate kept on the page,
the circle's face where the type mark sits (76px, the camera on its rim; with a
photo on, a tap asks Choose another or Remove photo), a full-width Start circle
(Save in the editor) at the foot, no bar check, no lede, no caret on arrival on
touch.

**Your own profile wears Edit profile and Share profile** as two quiet pills
under the identity; the ••• keeps Connect to calendar and About. **Pronouns
live in Edit profile's combo box** (`.combo-sub`), between name and bio.
**A plan needs a date** (the time stays optional), in the composer and the
editor. **Publishing twinkles** (`hapticTwinkle`, was one SUCCESS). Music's
page has no "Song" label and its pick wears the feed's 128px sleeve. Discover's
people cards have 80px faces, 1rem padding and are 216px wide to keep 4:5 (the
bio clamps to two lines), and its search rows 56px.

## 2.0 is circles (2026-10-22)

**A circle is a space for an interest** (in copy a circle is a circle, a place or a space, never a room: Zoe, 2026-11-08) that anyone can start and anyone can
join, at `#/c/<slug>` (clean link `/c/<slug>`, the way reddit has `/r/`). Zoe:
"use existing audience and group chat features", so it is NOT a third kind of
thing. Its posts are an **audience** (`posts.audience = 'community'` plus
`posts.community_id`; the composer's lock lists your circles under the people
picker, and a circle's Post button opens the composer aimed at it). **A circle
is just a feed: it has NO chat** (Zoe, 2026-10-23: "the chat is nice for
activities when people need to actually coordinate but I don't see a use here
when people can comment on posts"). It had a group chat (`chats.kind =
'community'`, its roster kept equal to the circle's by trigger); the client
drops those as it reads them (`Store.applyChats`), and
`supabase/drop-circle-chats.sql` (**NOT run** as of 2026-10-23) stops making
them and deletes the old ones with their messages. A member's two pills are
Post and **Invite**. Its head says the name, and its `c/<slug>` follows a profile's
@handle: hidden at phone width, where the bar's title says it
(`.account-handle--bare`), shown on a desktop. **Signed out, a circle still
shows its size** ("N members" on its page and its Discover card, no faces, no
roster sheet): rosters are `authenticated`-only, so anon reads a count-only
definer function, `community_sizes()` (`supabase/public-circle-counts.sql`,
`Store.communitySize`), never the names. A non-member's feed of an
INVITE-ONLY circle says "What's said here is for this circle."; a public one
is simply read.  **The host hears every join**: a
row in Updates (`circlejoin`) and a push (`supabase/circle-join-news.sql`).
The host can rename it, edit its about, give it a photo (cropped like a
profile face, `setCommunityPhoto`), take people out, and **delete it**
(`deleteCommunity`, which takes its posts with it); the slug never
changes. When the host leaves, the longest-standing member inherits; when the
last member leaves, the circle closes the same way a delete does. Ten circles
held per person. A circle post is reposted inside its circle and quoted
anywhere (see Repost inherits, quote chooses); it can be pinned to its author's
profile (2026-11-11, Zoe; a reader who can't read the circle doesn't get
that pin, `pinsFor`).
**Starting one is celebrated** (Zoe, 2026-10-23): the new circle's page opens
with the brand's stars bursting off its face (`celebrateFace`, cyan and green
alternating) and a twinkle haptic in step with them (`hapticTwinkle`, the app's
one multi-beat buzz), and **so does every new face** (Zoe, 2026-10-23): your
own photo from Edit profile and a circle's from its editor (`celebrateArrival`);
your own photo's stars are your `--heart`, a circle's stay the brand's.
**A song you share lands the same stars** on your On repeat square, in your
`--heart` (Zoe, 2026-10-24; `paintOnRepeat` takes `justPostedId`, stars only,
since publishing already twinkled).
The burst waits for the face to decode, and a face just uploaded keeps drawing
its own crop for the session (`Store.localFace`, read by `sizedSrc`), so it
never loads twice, and an empty circle offers its first post in Discover's
dashed card with a quiet pill (`.community-first`). It can take its photo
from the start: New circle carries the editor's photo and crop, sent behind the
navigation once the circle exists. Joining says "You've joined c/<slug>."
**An invite is a DM** (Zoe:
"without bloating the app"): the circle page's Invite pill
(`openCommunityInvite`, the chat roster's picker; since 2026-10-26 a tap only
ticks a friend and the dock turns from Done into Send invites, its words rolling
over and the band washing in, then sends them in one go), which sends
your friend "Join me in c/<slug> on Tria." with the link, and a thread draws any
circle link as the circle under the words (`circleInMessage`, `.msg-circle`).
No table and no new update kind; a friend whose DM already holds your link for
it shows as invited.
A plan posted in a circle can be answered by its members (`canJoin`), and only
the members who answered are reminded.

**NAMING: in code a circle is a `community`** (table `communities`,
`Store.communities()`, `post.communityId`, `renderCommunity`, `.community-*` in
CSS), because `circle` already means your mutual friends (the `'circle'`
audience, My Circle). Every word on screen says circle and `c/<slug>`. Do not
rename either side.

**Where a circle's posts are read:** its page, their own post page, **the
author's profile** (`Store.postsBy`) and **My Circle when you or a friend wrote
them** (`Store.feed`) (Zoe, 2026-10-23; a top-of-feed "new in your circles" card
was built and taken out the same day in favour of this). My Circle shows them
only for circles you share, said in `Store.feed` since public circles opened
their posts to RLS; a stranger's circle post stays in the circle. A card says which circle it was
said in above its byline in the repost line's style, "Posted in **c/slug**" with
the circle's mark (`communityTagHtml`, hidden on the circle's page).

**Discover IS circles** (Zoe: "remove the posts from the Discover feed. THIS is
the new way to discover."). It shows NO posts: today's daily, then **Circles**
(a dashed Start a circle card, gone for good on its fifth X and always also a Circle row in the New sheet, then yours, then the rest, by last sign of life,
`Store.communityPulse`), then Share Tria. **People, under the circles** (Zoe, 2026-10-23, `after` in `communitiesSectionHtml`; it sat over them that morning): a sideways rail
of 200px 4:5 cards (`peopleForRail`, `.person-card`), strangers only (no
friend, follow or request of yours; someone who added you first stays), most
friends in common first, then newest account; face, name, "Friends with Ana and
Ben" (names, never a number) or the @handle, their bio (Zoe: "not recent posts. just
bios"; none says "Private account" on a locked one), and the
row's own tie (`tieHtml`). A card answered this visit keeps its place
(`railKept`). Signed in only, gone while searching. Every circle is drawn as **the daily's
own card** (the same `.daily-card` classes, Zoe: "style circles like the daily
cards"): handle as kicker, name as the serif headline, about as the hint,
members' faces and count in the foot, the daily's pill as Join (which joins and
walks you in), and the circle's photo at 90px on the card's left with its handle and name on its right and the about full width below (2026-11-01; it was 52px in the top corner). No eyebrows: no
"Circles" caption, no kicker on the Start card. **Every card's pill is full
width and 52px tall** (`.daily-card .daily-answer`, Share Tria too, which is
painted CSS now and no longer a native page button), worn as hairline glass
with a thin wash of the band, the daily tag's look (Zoe), and the
page runs on ONE GAP, ~15px, from the search field down through every card
(Zoe: "even the spacing between search and cards"). No hairline over Share Tria
on Discover. Search runs **people, then circles, then posts** (Zoe, 2026-10-22, reversing
"never posts"; circles moved up to second on 2026-11-07): people as compact
rows, the best four and a More people under them (a person matches on name,
then on what they've said), then circles, then every post you can read that
says the words (never a repost, a circle's or a song). While the field holds the caret or a query, the bar's + is a back
chevron that empties it; the field has no focus ring. The masonry wall and the trending tags are gone from it. **On repeat
moved to My Circle** (Zoe: "add on repeat to circle feed"), over the feed and
the week-of cards (`paintOnRepeat`), with no "On repeat" eyebrow, and it is
your people's songs: you and your friends, never a circle's post
(`songPostsOnRepeat`). **It is a WEEK** (Zoe: "the on repeat section at the
top should be a weekly thing, posts for music aren't needed"): each person's
newest Music post from the last seven days. **A Music post is in no feed**
(`isSongPost` in store.js: not My Circle, not a profile, not a circle, and it
can't be reposted or aimed at a circle), so On repeat is the only place a song
is read. A square opens the song itself, and a friend's square carries the
post's own like, given by a double tap: no coloured corner heart and nothing
to tap there (Zoe, 2026-10-26: "no colored corner icon"), only the small white
heart a like glides into, so a double tap only adds. **A friend's cover is gestures** (Zoe, 2026-10-26: "double tap
to like a song and hold down to reply"; the speech bubble is gone): a tap plays
it once the 280ms double tap window passes, a double tap likes it (only adds)
with a big white heart springing up on the cover and the like's sparkles
bursting off it in white, then shrinking with the glide into the bottom right
corner overlapping it (separate `scale` and `translate` tracks, each eased),
staying there small (16px, white, `.np-liked`, worn as `is-liked` so a like
never rebuilds the rail mid-glide; `popSongHeart`), and a hold (380ms, the sleeve sinking as it charges; a finger still past 140ms is a hold, so its first wander is spent and nothing scrolls under it) opens your DM
with the song on the bar, a clear `.hold-shield` taking the finger until it
lifts so the thread inherits nothing (`wireSongGestures`, `replyToSong`; a
right click on a desktop). **The keys wait for the lift** (`songHoldLift`,
read by `setChatSong`): raised under the finger, the lift landed in the web
view as a tap and took them straight back down. **The gestures are told once** (Zoe: "a quiet
soft cta"): a week card under the rail, its title in the page's weight, gone
for good on its x or the first double tap or hold
(`tria:song-hint-seen:v4:<user>`, `.np-hint`, `dismissSongHint`). The anchor wears `data-taps`, which the outbound handler leaves alone
until the cover clicks itself with `data-go`. **The reply chip over a chat's bar
is the bar's own size** (full width, as tall, its corner and type). The
listening status (`freshSong`) still has no week, so a song
pin doesn't blank.

**Album art is rounder** (Zoe: "round the edges much more of all album art,
that'd be cuter", then "a bit less rounding"): `--radius-art` is 20% of the square (`--art-round`), on every
song sleeve (`.song-art`, `.np-art`, a song pin's `.pin-art`), and a music
post's sleeve is **128px in the feed** (was 76, Zoe: "1.5x2x bigger"), and the boxes that hold one
at a known size and pad (`.card-song`, `.song-now`, `.pin--song`) stay concentric
by reading `--art-round`. Photos keep `--radius-img`. **Every flat card in a
page wears the soft corner, `--radius-soft` (24px)** (Zoe: "unify everything
with the more rounded edges ... so everything has that cutesy roundedness"):
the daily and circle cards, a quoted post, the Updates push ask, a profile's
pins (their art concentric inside), the week-of cards, a chat request. Floating
glass (menus, sheets) keeps its own ladder.

**A like is a heart and nothing else** (Zoe: "remove the other types of
reactions other than liking"). The fan, its four marks, its tick and its CSS
are deleted; `likes.reaction` is left in the database, never read or written,
so an old thumbs up reads as a like. My Circle's tab was a house for an afternoon and went back to the ring with
a centre (Zoe). **The + sheet is titled
New** (was Create, then Share), and a song wears a music note (`ICONS.music`), not the
speaker, which is a video's sound again.

Every rule is in `supabase/add-circles.sql`, `supabase/circle-photo-delete.sql`
`supabase/circle-join-news.sql` (**NOT run** as of 2026-10-23: until it is,
the host gets no push, though Updates shows joins) and
`supabase/drop-circle-chats.sql` (**NOT run**, see above);
the reasoning is in
[docs/data.md](docs/data.md) under "Circles". **The push function changed too**
(a mention in a circle only reaches members, and circle plans remind only
members who answered; it can still name a circle's chat in a message push,
which is dead once drop-circle-chats.sql has run).

## 1.8 is the nav going all the way native (2026-10-21)

**The bottom bar is a real `UITabBar` now**, in a real `UITabBarController`
that is a CHILD of the bridge controller (`TriaChromeBar` in
TriaChromePlugin.swift). The four tabs are empty clear pages and the web view
is never moved into one; `TriaTabShell` passes every touch that isn't on the bar
through to the page. That buys the system's Liquid Glass capsule, the lens, the
labels, Dynamic Type, and `tabBarMinimizeBehavior = .onScrollDown` (the bar
folds while you read down), with the same `setTabs`/`selectTab`/`setDots`/
`setChrome` contract as 1.4. The reserve only grows (a folded bar must not move
the foot of a page mid-scroll).

**The + left the tab bar for My Circle's top bar** (and your own profile's, 2026-10-23; Discover's; Chats', 2026-11-01; Updates' while it was a tab), Instagram-style: the
compose mark (a sheet and pencil, `ICONS.compose`), until 2026-11-05, when the +
went to the tab bar's centre (see "The + is the tab bar's centre"). The compose mark raises the CREATE sheet (`openComposeDial`, titled New since 2026-10-24, Share before it: a circle is created, not shared): Note (the pencil), Activity (Frame left it 2026-10-23, Zoe; a photo is the composer's attach bar),
and Daily (a sun, straight to its composer, there only while you haven't
answered) (Zoe, 2026-10-22; it listed every type and Music,
which was the attach bar again). Activity presses the composer's calendar button on
mount (`pendingAttach`); a post's type is still inferred. **My
Circle lost its filter** (an Instagram style dial on the wordmark was tried and removed, 2026-11-01); profiles, Discover and Updates keep theirs. On the
web the phone nav simply drops its round +.

**Updates left the chat list.** The Chats tab's dot is chats only; Updates has
its own, on its own tab since 2026-11-01.

**Discover had no title; its search field WAS the header** (until 2026-11-06,
when the field moved into the page, see "Discover's bar is every tab's bar").
Discover's filter dial is gone too, so it is always the gallery with every type
(`discoverFilter`/`discoverView` are constants, a stored `tria:discoverView` is
ignored).

**The top bar, cleaned up (2026-10-22).** No painted header: the native header
was the system's bar material (`TriaToolbarMaterial`, `.systemChromeMaterial`,
clean bottom edge, nothing hand-shaped; the CSS band since 2026-11-06), and the CSS band is a blur with a
whisper of paper. A faded edge (a gradient mask) was tried and removed: a masked
blur reads as fog, not as iOS's progressive soft edge, which a Capacitor web
view cannot reach. Plain glyph buttons are BARE at the
top of a page (just icons) and wear their glass once content scrolls under
(`syncBare` natively, `.topbar--bare .toolbar-btn` in CSS); tinted commits keep
their fill. **My Circle has no nameplate**: the italic Instrument "tria"
wordmark is centred on its bar (`mountToolbar({ mark: true })`, `#toolbar-mark`,
drawn natively from `icons/wordmark.svg` via `markSpec`), in the page's ink,
leaving with the header on a read down.

**One header on every page** (Zoe: unify every page header). Under a bar, no
page draws a big serif nameplate (`mastheadEl` still emits it as the visually
hidden `<h1>`, phone width only, `.masthead--keep` for the daily's prompt,
which is content). The page's name is the bar's centred title, up from the
first frame (`syncToolbarTitle`'s `past` is always true; natively the title
follows the wordmark's rule, `atTop || headerUp`). A profile's bar says the
`@handle`, the card says the name. The header leaves on a read down and is back
on a scroll up on EVERY route, and **the bar's buttons go with it** (Zoe,
2026-10-22; `.topbar--reading` on the two control slots in CSS,
`TriaToolbar.syncAway` natively, each disc faded on its own): dailies no longer hold theirs (profiles
do again since 2026-11-06). My Circle wears the wordmark and Discover the
search field in that same centred slot.

**Every secondary menu is one sheet in iOS's share-sheet shape**: openSheet's
panel and openBarMenu's card alike sit 6px in from the sides and from the
bottom of the SCREEN (not above the home indicator; the panel's foot clears it
inside), rounded 32px up top with a foot concentric with the display's corner,
and are ONE SURFACE: solid `--surface` and one hairline, no blur since 2026-10-23 (it loaded late), with
the rows straight on it, no fill of their own, each row inset 8px from the
panel's sides with a 24px soft corner on its pressed or chosen fill (Zoe,
2026-10-23: "round and pad this"). A card inside the panel was tried and removed
(Zoe: padding in padding). **The block must stay BELOW the sheet's older rules
in app.css**: it once sat above them and their `.sheet-items` glass won by
source order. Grab handle, a centred italic Instrument Serif title (2026-10-23), NO
Cancel (a tap outside, Escape, or a pull down: `dragToClose`). A `dock`
("Done") is a soft pill at the panel's foot. A radio set shows a check, not a
fade. The Create picker is that sheet's list.

**The CSS glass is SIMPLIFIED** (tokens.css, the `--glass-*` block): a thin
fill, the blur, one hairline, and nothing else. No specular rim, no drop
shadows, no saturate(). **Keep the blur**: a fully flat pass was tried the same
day and Zoe asked for the blur back. The token names stayed so every rule
simplified untouched.

**Music is a sixth post type, `song`** (`supabase/add-song-posts.sql`, a
`posts.song` jsonb in the listening status's shape, minus `at`). **Posting a song
IS having it on repeat** (Zoe, 2026-10-22): the New sheet's Music row is its door
(Zoe, 2026-10-23), and Music is its OWN publish page, like the Daily's: the composer's `song` family (`fieldsFor('song')`), just the song search and Share, no headline, note, tags, attach bar or audience (always your circle), posting no longer auto-pins it, every way in (Discover's +, a profile's song pin) opens the composer's song
search (`goListening`), Share also sets the listening status (not for a
hand-picked audience), and Discover's On repeat rail is each person's newest
Music post (no week limit since 2.0), opening the post (`songPostsOnRepeat`).
`#/listening` survives only as the fallback without the column. The composer's speaker button opens a
song search (`lookUpSongs`, shared with `#/listening`), the card draws the track
as a row linking out (`songTileHtml`), and its hue is butter (`--type-song`).
Everything Music is hidden until `Store.songsReady` sees the column.

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

## Launch and load (2026-09-25)

Three measured changes, all in [docs/views.md](docs/views.md) and
[docs/data.md](docs/data.md): every picture is fetched at the size it is drawn
from Supabase's image renderer (`sizedSrc`; the plan's cap falls back to
originals), a feed builds its first screen first (`buildInSlices`) and dates
reuse one formatter (`dayMT`), a long feed (Circle, a profile) is **only built
as far as it is read**, two screens ahead of the reader (`lazy`; a whole
circle's history on the page froze the app on every like, because each
animation made WebKit walk every card's layers), and the App Store build paints a returning
reader's last world at once from IndexedDB while the real one loads
(`Store.init({ keep })`, deleted on sign-out). **Bump `KEEP_V` in store.js when
`state` changes shape.**

## Holding the heart (2026-09-25, removed 2026-10-22)

Holding a friend's heart used to fan out four more marks (thumbs up, thumbs
down, ha ha, whoa). Zoe took them out in 2.0: a like is a heart. The history
of the fan's tuning is in git (`Fan`, `react_*` before commit 3f713d4's
successor) if it is ever re-argued.

## 1.4 is the chrome going native

The nav — tab bar, compose **+**, the top bar's buttons — becomes real UIKit in
the system's Liquid Glass, around the webview that still draws every page. The
web keeps its CSS glass unchanged. Plan, contract and traps:
[docs/native-chrome.md](docs/native-chrome.md).

**All three stages have landed** (`ios/App/App/TriaChromePlugin.swift`,
`NativeChrome` in app.js, the gate at the end of app.css): the tab bar, the +,
and the top bar's controls. **The menus they drop are the web's own card again
since 1.8** (`openBarMenu`; controlSpec sends `menu: false`), and Edit profile's
music pick is its sheet in every shell: Zoe's call, so the secondary surfaces
aren't all the system's glass. The `UIMenu` path (`describeMenu`,
`presentMenu`, `attachMenu`) is still in the tree with no caller.
**The post card's •••, the repost circle beside it (2026-08-30) and the
profile's colour ring (2026-09-10) went back to the web sheet** in the app as
well (`openPostMenu`, `openRepostMenu`, `openAccentSheet` in app.js) — they no
longer try a native menu at all; the colour ring because the sheet shows the
colours off and a menu row can't. See "A menu the page asks for" in
[docs/native-chrome.md](docs/native-chrome.md).

The page's own primary acts were native too (`PAGE_SEL`, `TriaPageButton`),
one by one, until **2.0 painted every page button in CSS** (THE BUTTON, below)
and the whole bridge was deleted. Not native, ever: anything in a page.

**The band crosses as one of three things**, sorted off the stops themselves
(`bandFill`): a reader's accent is one colour and tints the glass, Tria's own
ramp is two (peach to rose) and stays a thinned gradient UNDER the material, "no colour" sends
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
BAR and (until 1.8 made it a web bar) the one in DISCOVER'S SEARCH were real, and every keystroke is written
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
- **Every field is 16px or more**, a field you add at runtime too: iOS zooms the
  whole page into any input, textarea or contenteditable set smaller (the
  composer's tag box did at 0.86rem, 2026-10-23). Check computed sizes in WebKit.
- **Never read `Notification.permission` in app.js** — it throws in the app. Go
  through `Store.pushPermission()`.
- **No COUNT, anywhere** — not in `aps`, not on the nav, not on a native tab.
  What the rule refuses is a NUMBER: something that climbs while you are away
  and asks to be driven back to zero. A DOT is allowed, in two places since 1.8:
  the Chats tab (chats) and the Updates tab, and each is one: it cannot climb, there is nothing to be behind on, and it clears
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
  `supabase/OAUTH-SETUP.md`. **`public-friend-counts.sql` is confirmed run**
  (2026-10-25): anon `GET /rest/v1/friends?select=a&limit=2` answered `[]` on
  2026-09-22 and rows now. Were the policy ever missing again, every friend
  count on the web reads 0; the app is unaffected (it reads as
  `authenticated`). **`add-comment-likes.sql` is confirmed run** (2026-09-23):
  anon `GET /rest/v1/comment_likes?select=comment_id&limit=1` answered PGRST205
  before it and `[]` after. Were the table ever missing again, the comment
  hearts draw nothing, on purpose (`Store.commentLikesReady`). **`add-reactions.sql` is confirmed run**
  (2026-09-25), and its column has been unused since reactions came out in 2.0;
  the client no longer probes for it.
  **`add-song-posts.sql` is confirmed run** (2026-10-22): anon
  `GET /rest/v1/posts?select=song&limit=1` answered 42703 before it and
  `[{"song":null}]` after. Were the column ever missing again,
  `Store.songsReady` is false, no Music row or song button shows, and
  Discover's On repeat falls back to the old listening status.
  **`add-circles.sql` is confirmed run** (2026-10-22): anon
  `GET /rest/v1/communities?select=slug&limit=1` answered PGRST205 before it and
  `[{"slug":"dnd"}]` after. Were the table ever missing again,
  `Store.communitiesReady` is false and nothing of circles shows anywhere. **Not
  confirmed: that the push function was redeployed after it** (it learned circles
  in the same commit and reads `community_members`); REST can't tell.
  **`public-circle-counts.sql` is confirmed run** (2026-10-23): anon
  `POST /rest/v1/rpc/community_sizes` with `{}` answers
  `[{"community_id":…,"members":2}]` (it was a 404 minutes before), while anon
  `community_members` still answers `[]`. Were it ever missing again, a
  signed-out circle simply shows no count. **`drop-circle-chats.sql` can't be
  verified over REST** (anon reads no chats, and `create_community` keeps its
  signature); the client hides circle chats either way.
  **`circle-photo-delete.sql` is confirmed run** (2026-10-23): anon
  `GET /rest/v1/communities?select=avatar&limit=1` answered 42703 on 2026-10-22
  and `[{"avatar":null}]` now, and `set_community_photo` answers its own 42501
  "Only the circle's host can do that." where it answered PGRST202. Were the
  column ever missing again, `Store.communityToolsReady` is false: no photo on
  New circle or in the editor, and no Delete circle in the host's menu.
  **`circle-privacy.sql` is confirmed run** (2026-10-23): anon
  `GET /rest/v1/community_invites?select=user_id&limit=1` answered PGRST205
  before it and `[]` after, `communities.invite_only` answers
  `[{"invite_only":false}]`, and `set_community_privacy` answers its own 42501
  "Only the circle's host can do that.". Were the table ever missing again,
  `Store.communityPrivacyReady` is false: no Who can join field anywhere.

## Copy style

User-facing copy uses commas and periods, **no em dashes** (code comments are
exempt). Voice is playful but not trying-too-hard. **A circle is a circle,
a place or a space, never a room** (Zoe, 2026-11-08). The tagline is "No
algorithm, ad-free social."

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
