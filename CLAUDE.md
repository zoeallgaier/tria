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

## 2.0's brand: cyan to green (2026-10-22)

**Tria's colour is one ramp, `--brand-start` #00c9ce to `--brand-end`
#00cc9e** (Zoe: "these are the new ACTUAL tria brand colors", the app icon's
Icon Composer gradient; it was peach #ffac68 to rose #ff0049 that morning, and
the tokens were `--brand-peach`/`--brand-rose`). **Post types carry no
colour**: a glyph names a type. **`--danger` is its own red** (#d1003c /
#ff0049), never the brand. `--brand-ink` is the green deepened to #00735c for
words on paper and Tria's own heart there. **Tria's ramp is recognised by its
stops (`isBrand` in app.js), not by hue spread**: its ends are 15 degrees apart,
narrower than an accent. The logo SVGs, storycard.js, gen-icons.js, the
splash's `@property` values and the refresh glow (`TriaEdgeGlow`, as its
fallback) hold the two hexes by hand. See the top of [docs/design.md](docs/design.md).

## 2.0's refresh is the screen's edge (2026-10-22, trial)

In the app, pull to refresh draws a thin line of the reader's own band round the
display's rounded edge instead of the dot ring (`TriaEdgeGlow`, `setGlow`,
`NativeChrome.glowColors`), with feathered tips that reach halfway down at the
threshold, and a haptic ratchet of detents into a click there. The web keeps the ring. See the
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
where you are, and **Share** at the foot, ruled off (`.nav-foot`). **One
Share per shell:** the sidebar's Share opens the Share sheet
(`openComposeDial`, the old "+ Post" linked straight to the composer), and My
Circle's compose mark is hidden at desktop width outside the native shell. **Updates is a sidebar row on
desktop** (Zoe), after Chats, with the bell's dot (NAV's `rail` entry: hidden
on the phone capsule, never sent to the native tab bar), and the bar's bell is
hidden at desktop width the same way. On `#/updates` the sidebar lights that
row; a phone lights My Circle (`.nav-link--under`) and native still gets `#/`. The
native shell never draws the CSS nav, so none of this reaches the iOS build.

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

**Share profile is the system share sheet**, on your own profile too (Zoe:
"remove all the qr code bullshit"). The profile card, its QR, `js/vendor/qr.js`
and `profileCardSpec` are gone; own-POST story cards stay.

**First run.** Signup's @handle fills itself from the display name until you
type in it, cleans what you type, and says "taken" as it settles
(`wireHandle`, `Store.usernameFree`), on the claim screen too. An empty My
Circle offers Find people and circles and Invite a friend (your own profile
link, "Add me on Tria"); an account with no friends and no songs gets no On
repeat rail; empty Chats offers Start a chat; your own empty profile offers
Write your first post and, while bare, Add a photo and bio.

## 2.0 is circles (2026-10-22)

**A circle is a room for an interest** that anyone can start and anyone can
join, at `#/c/<slug>` (clean link `/c/<slug>`, the way reddit has `/r/`). Zoe:
"use existing audience and group chat features", so it is NOT a third kind of
thing. Its posts are an **audience** (`posts.audience = 'community'` plus
`posts.community_id`; the composer's lock lists your circles under the people
picker, and a circle's Post button opens the composer aimed at it), and its talk
is a **group chat** (`chats.kind = 'community'`) whose roster the database keeps
equal to the circle's by trigger. Joining seats you in the chat MUTED (Claude's
call: a room of strangers should not buzz). Leaving the chat IS leaving the
circle. The host can rename it, edit its about, give it a photo (cropped like a
profile face, `setCommunityPhoto`), take people out, and **delete it**
(`deleteCommunity`, which takes its posts and chat with it); the slug never
changes. When the host leaves, the longest-standing member inherits; when the
last member leaves, the circle closes the same way a delete does. Ten circles
held per person. A circle post cannot be reposted or pinned to a profile.
A plan posted in a circle can be answered by its members (`canJoin`), and only
the members who answered are reminded.

**NAMING: in code a circle is a `community`** (table `communities`,
`Store.communities()`, `post.communityId`, `renderCommunity`, `.community-*` in
CSS), because `circle` already means your mutual friends (the `'circle'`
audience, My Circle). Every word on screen says circle and `c/<slug>`. Do not
rename either side.

**Where a circle's posts are read:** its page and their own post page. They are
dropped from My Circle (`Store.feed`) and from profiles (`Store.postsBy`). A card says which circle
it was said in above its byline (`communityTagHtml`, hidden on the circle's page).

**Discover IS circles** (Zoe: "remove the posts from the Discover feed. THIS is
the new way to discover."). It shows NO posts: today's daily, then **Circles**
(a dashed Start a circle card, then yours, then the rest, by last sign of life,
`Store.communityPulse`), then Share Tria. Every circle is drawn as **the daily's
own card** (the same `.daily-card` classes, Zoe: "style circles like the daily
cards"): handle as kicker, name as the serif headline, about as the hint,
members' faces and count in the foot, the daily's pill as Join (which joins and
walks you in), and the circle's photo in the top corner. No eyebrows: no
"Circles" caption, no kicker on the Start card. **Every card's pill is full
width and 52px tall** (`.daily-card .daily-answer`, Share Tria too, which is
painted CSS now and no longer a native page button), worn as hairline glass
with a thin wash of the band, the daily tag's look (Zoe), and the
page runs on ONE GAP, ~15px, from the search field down through every card
(Zoe: "even the spacing between search and cards"). No hairline over Share Tria
on Discover. Search runs **people, then posts, then circles** (Zoe, 2026-10-22, reversing
"never posts"): people as compact rows, the best four and a More people under
them (a person matches on name, then on what they've said), then every post you
can read that says the words (never a repost, a circle's or a song), then
circles. While the field holds the caret or a query, the bar's + is a back
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
post's own like as a heart on a glass disc in the cover's corner (`.np-like`,
`wireLikes`). The listening status (`freshSong`) still has no week, so a song
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
Share** (was Create), and a song wears a music note (`ICONS.music`), not the
speaker, which is a video's sound again.

Every rule is in `supabase/add-circles.sql` and `supabase/circle-photo-delete.sql`;
the reasoning is in
[docs/data.md](docs/data.md) under "Circles". **The push function changed too**
(a circle's chat is named in a message push, a mention in a circle only reaches
members, and circle plans remind only members who answered).

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

**The + left the tab bar for My Circle's top bar**, Instagram-style: the
compose mark (a sheet and pencil, `ICONS.compose`) leading, the Updates bell
trailing. The compose mark raises the CREATE sheet (`openComposeDial`, titled Share since 2.0): Post (the Note's pencil), Activity,
and Daily (a sun, straight to its composer, there only while you haven't
answered) (Zoe, 2026-10-22; it listed every type and Music,
which was the attach bar again). Activity presses the composer's calendar button on
mount (`pendingAttach`); a post's type is still inferred. **My
Circle lost its filter**; profiles, Discover and Updates keep theirs. On the
web the phone nav simply drops its round +.

**Updates left the chat list.** The Chats tab's dot is chats only; Updates has
its own dot on the bell (`.toolbar-dot`, crossed to native as a control's `dot`).
`#/updates` lights My Circle and its back chevron goes there.

**Discover has no title; its search field IS the header.** One web field,
always open, no X (`mountToolbar({ field })`, `#toolbar-field`,
`.discover-search`), at full content width. It leaves with the header on a read
down and comes back on a scroll up, except while it holds the caret. On that one
route the web draws the whole bar in every shell: `body.toolbar-field` sends the
native toolbar off duty and re-enables the CSS material under the native gate,
because native glass would blur a web field beneath it. Discover's filter dial
is gone too, so it is always the gallery with every type
(`discoverFilter`/`discoverView` are constants, a stored `tria:discoverView` is
ignored). `TriaSearchField`/`searchSpec` have no caller now.

**The top bar, cleaned up (2026-10-22).** No painted header: the native header
is the system's bar material (`TriaToolbarMaterial`, `.systemChromeMaterial`,
clean bottom edge, nothing hand-shaped), and the CSS band is a blur with a
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
`TriaToolbar.syncAway` natively, each disc faded on its own): `holdsHeader()` returns false, so profiles and
dailies no longer hold theirs. My Circle wears the wordmark and Discover the
search field in that same centred slot.

**Every secondary menu is one sheet in iOS's share-sheet shape**: openSheet's
panel and openBarMenu's card alike sit 6px in from the sides and from the
bottom of the SCREEN (not above the home indicator; the panel's foot clears it
inside), rounded 32px up top with a foot concentric with the display's corner,
and are ONE SURFACE: the CSS glass (thin fill, panel blur, one hairline) with
the rows straight on it, edge to edge, no fill of their own, and a pressed row
clipped by the panel's corners. A card inside the panel was tried and removed
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
IS having it on repeat** (Zoe, 2026-10-22): the Create sheet's Music row is gone
(Zoe, 2026-10-23; the composer's song button stays), posting no longer auto-pins it, every way in (Discover's +, a profile's song pin) opens the composer's song
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
- **Never read `Notification.permission` in app.js** — it throws in the app. Go
  through `Store.pushPermission()`.
- **No COUNT, anywhere** — not in `aps`, not on the nav, not on a native tab.
  What the rule refuses is a NUMBER: something that climbs while you are away
  and asks to be driven back to zero. A DOT is allowed, in two places since 1.8:
  the Chats tab (chats) and the Updates bell on My Circle's bar, and each is one: it cannot climb, there is nothing to be behind on, and it clears
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
  **`circle-photo-delete.sql` is NOT run** (re-probed 2026-10-22 after Zoe said
  everything was in: `communities.avatar` still 42703, and `delete_community` /
  `set_community_photo` answer PGRST202 called with their real signatures, the
  same as a bogus control, while `update_community` from add-circles.sql answers
  its own 42501): anon
  `GET /rest/v1/communities?select=avatar&limit=1` answers 42703 until it is
  (a 400 in a boot pass's console, the one the probe makes). Until then
  `Store.communityToolsReady` is false: no photo in the circle editor and no
  Delete circle in the host's menu.

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
