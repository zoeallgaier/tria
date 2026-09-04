# Data, posts and pages

Backend is **Supabase** (Auth + Postgres + Storage). `js/store.js` is an
in-memory cache of the whole world: sync reads, async writes.


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

**Re-probed 2026-09-03: two migrations written since that sweep, and both have
been run.** `users.pronouns` and `users.listening_to` each answer `200 []`
against a bogus-column control returning `400 42703`, so `add-pronouns.sql` and
`add-listening-to.sql` are both live.

**`supabase/add-pins.sql` IS PENDING** (probed 2026-09-03: `users.pinned` answers
`400 42703`, the missing-column code, against the same controls). It is the one
migration in the tree that has not been run, and pinned profile cards are inert
without it in the exact way this section warns about: nothing errors on READ (a
missing column is simply absent, so nobody has any pins), and the first thing
that goes wrong is a save, which says "Pinned cards aren't set up on this server
yet" rather than a generic failure. Run it and the feature is live with no
deploy. **So the outstanding list is two: the `.p8` key and this.**

The client stays tolerant of a database without `listening_to` anyway, and it's
worth knowing what that looks like so it isn't mistaken for a bug on a fresh
install: PostgREST omits a column that doesn't exist, so `mapUser` finds no song,
the listening rail shows only its empty own-slot, and `setListeningTo` reports
"Listening to isn't set up on this server yet" rather than a generic failure.

It has no client-side fix and Claude cannot do it; if a report looks like
"notifications are broken", check this before reading code. (The other recurring
not-a-bug is the one-shot iOS permission prompt — see the push notes in [ios-shell.md](ios-shell.md).)

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

  **THE COMPOSER IS THE BOTTOM CHROME, and on phones it replaces the nav.**
  `mountPostBar` fills `#postbar` — a fixed glass pill carrying your avatar, the
  field, and a send disc — and `body.postbar-live` takes the four destinations
  and the + off the screen for the length of the route. The way out is the
  toolbar's back chevron, which is where a pushed page's exit already was.

  It led the thread until then: top of the list, above the replies, on the
  argument that this is a page you navigated to in order to say something and the
  box should be in the same place whether a post has two comments or two hundred.
  Both halves of that survive and the bar keeps them better — a box at the top of
  a scrolling list is in "the same place" right up until you read three replies,
  at which point the thing you came for is off the top of the screen and the
  bottom of it is offering you four tabs to somewhere else. Retired with the
  move: the in-thread `<form>`, and the rule that the empty state
  ("No comments yet.") had to sit UNDER the composer rather than over it. That
  rule was about not saying the same thing twice before the reader could answer;
  on separate layers the two are never stacked and there is nothing to order.

  Five things about it are load-bearing:

  - **IT LIVES OUTSIDE THE PAGE**, as a sibling of the nav in `index.html`. A
    `position: fixed` page child is the thing this app spent two versions
    removing (see the Updates dock in [design.md](design.md)), because any ancestor that grows a transform
    or containment becomes its containing block and the bar quietly starts
    scrolling. `renderPage` calls `resetPostBar()` beside `resetToolbar()`, so no
    page inherits the last one's.
  - **IT IS THE ONLY COMPOSER.** No second box in the thread — the same one-door
    settlement the feed card's comment glyph got when it became a link.
  - **THE SEND DISC IS THE FAB'S JOB ON THIS ROUTE**, so it is a member of the
    `.publish-fill.is-solid` set: same tinted glass, same corner, 44px and the
    disc IS the target. That is why a comment's send earns the brand band when
    the old in-thread `Post` (bare type) never did. `--idle` until there are
    words, the profile editor's own trick.
  - **THE KEYBOARD ARRIVES BY TWO ROUTES AND ONLY ONE NEEDS ANYTHING FROM US**
    (`trackKeyboard`). **The App Store build RESIZES the webview** — WKWebView
    shrinks to the unobscured rect, `window.innerHeight` comes down with the
    keyboard, and a bottom-fixed bar is already above the keys with nothing to
    lift. A browser tab and a home-screen PWA do **not**: the layout viewport is
    unchanged, the bar stays put, the keyboard covers it, and there the lift is
    the whole fix. `visualViewport` alone cannot tell those apart, so measure
    both halves — `shrunk` (what the native layer already did) and `covered`
    (what is left) — call the keyboard up on their SUM, and lift by `covered`
    alone. Neither shell double-compensates.

    The first version read only the visual viewport, on the theory that
    `innerHeight - vv.height` is self-cancelling. It is, for the TRANSFORM, and
    it is useless for the QUESTION: the App Store build kept its 34pt safe-area
    reserve while the keyboard was up — a hole between the field and the keys —
    because the only thing saying "a keyboard is up" was a lift that correctly
    never happened. `body.postbar-kb` is what drops that padding and it is
    driven by the sum for exactly this reason.

    Two more: the listeners are attached on FOCUS and dropped on BLUR, which is
    what keeps this from being the per-frame scroll handler this file refuses
    elsewhere; and `KB_FLOOR` (90px) throws away anything too small to be a
    keyboard, because Safari's URL bar moves the visual viewport by tens of
    pixels with no keyboard anywhere.
  - **AND THE DOCUMENT MUST NOT MOVE.** WKWebView scrolls the page to bring a
    focused field into view, and it does that even for a field inside a
    `position: fixed` bar — an element that is in view by definition and cannot
    be scrolled to. It scrolls against the LAYOUT viewport, where `main` is
    `min-height: 100dvh` plus the bar's reserve and `dvh` does **not** shrink for
    a keyboard, so there is a viewport of overhang below the content and WebKit
    runs the scroll all the way to the end of it: tap the comment box and the
    post you were reading leaves the screen, replaced by empty reserve. Reported
    as *"the keyboard pushes ALL the page content up"*.

    **PREVENTED, NOT UNDONE, and the difference is visible.** Undoing it was the
    first attempt — `park()`, restoring the scroll over the following frames —
    and it is the wrong shape: the reveal lands on the compositor and paints
    before any JS runs, so the page jumped and snapped back, and a reader
    looking at one particular comment watched it leave and return. A correction
    you can see is a second event, and this interaction is meant to have none.
    So the tap never reaches the native focus: `mousedown` + `preventDefault`
    suppresses it *and the reveal with it*, then `focus({ preventScroll: true })`
    asks for the same thing minus the scrolling, synchronously inside the
    gesture so iOS still raises the keyboard. Guarded on the field not already
    holding focus — a native tap places the caret where you tapped and `focus()`
    puts it at the end, so this only intercepts the tap that has nothing to
    place (the first one, into an empty box). `park()` stays as the NET, for a
    focus we did not open (a hardware Tab, a shell that ignores `preventScroll`);
    it writes only when the scroll actually moved, so normally it costs a
    comparison per frame for a third of a second and changes nothing.
  - **THE SEND DISC MUST NOT TAKE FOCUS.** `mousedown` + `preventDefault`, the
    same trick the mentions picker uses. Without it a tap blurs the textarea
    first, the keyboard starts dismissing, the bar drops the ~300px it was lifted
    by, and the `click` resolves against wherever the disc has landed — not under
    the finger. The comment is silently not posted. `mousedown` and not
    `touchstart`: preventing that one cancels the click along with the focus.

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
    feed) and `.card-social > span` (a static count) carry the same geometry,
    named by class in the same rules — a second set of measurements would drift
    the first time one of them moved.
  - **THE COMMENT GLYPH LIGHTS ONLY WHERE THE ROW IS A SWITCHER**, and it has
    three drawings, not two. The lit glyph says which of the three sections is
    showing, which means nothing when there is only one — who-liked is drawn for
    the AUTHOR alone and who's-going needs an activity you can JOIN, so on
    somebody else's note the thread is the only pane the card has and the glyph
    was arriving permanently accent-lit: a switch with one position, inviting a
    tap that could only ever be a no-op. So: a **link** in a feed, a **button**
    that lights on a page whose row switches, and a **span** (`role="img"`, no
    tab stop, `--muted`) where it doesn't. `setPostPane` writes `aria-expanded`
    only on a node that ALREADY has one — without that guard, opening
    `#/p/<id>?pane=likers` on somebody else's post falls back to comments through
    there and stamps the attribute onto the span, which is exactly what
    `.card-comment`'s accent rule matches.
  - **`wireComments` wires the THREAD, not a composer.** It guards on the panel
    and binds the delete rows and the pane switch; the box is the bar
    (`wirePostBar`). It binds `button.card-comment`, not `.card-comment`, so it
    doesn't hang a handler on the span that can never be tapped.
  - **The post page delegates its tag chips from the section**, not per chip:
    posting a comment runs `rebuildPostCard`, which swaps in a fresh `makeCard`,
    and `makeCard` cannot wire a chip's destination because that is the caller's
    decision. Bound directly, the chips die on the first comment.
  - **`rebuildPostCard` re-reads the row from the DOM, and takes no post.** It
    was a closure (`apply`) over the post `wireComments` was handed — which on a
    repost is the ORIGINAL, not the row. So posting a comment from a quote's page
    rebuilt the card as the original's own card, dropping the quoter's byline and
    note, and from a bare repost's page it dropped the "X reposted" line. Reading
    `data-id` off the live card gets the row back in both cases, which is what
    `passedCard`/`quoteCard` have to be handed to draw the same thing twice.
  - **`mountToolbar`'s title is assigned with `textContent`.** Don't `esc()` it —
    an apostrophe in a name prints the entity. `toolbarBackEl` escapes its own
    label, which is the opposite convention two lines away.

  **THE BAR'S GEOMETRY IS DERIVED, and three of the derivations are worth not
  re-deriving by hand.** All four numbers live as custom properties on
  `.postbar-form`:

  - **The corner is FIXED, not `--radius-pill`.** 999px on a box that grows is a
    stadium: one line in, it is the nav pill it stands in for; four lines in, it
    is a lozenge with 68px semicircles on its ends and the avatar and disc
    floating inside the curve. The object changes character while you type. So
    the radius is stated as *the disc's own radius plus the padding around it* —
    the concentric-corners rule — which lands on exactly half the resting height,
    because the 44px disc is what sets that height. Two derivations, one number.
  - **The field is exactly as tall as the disc at one line**
    (`--postbar-field-pad`). The row is `align-items: flex-end` so the tallest
    child sets the height and the rest drop to the bottom of it — with a shorter
    field, the disc pushed it down and left the avatar (aligned to the top, where
    the first line normally is) 6px above the line it was introducing. Sized this
    way there is no taller child at rest, so the field starts at the form's
    content top in *both* states and one nudge works for both.
  - **The avatar and the words are centred on DIFFERENT data, and one formula
    cannot do both.** A line box and the ink inside it do not share a midpoint:
    Oxygen reports a full-em ascent, so in a 22.4px line the baseline sits at
    19.2 — 19.2px above it, 3.2 below. A solid disc centred on the box's midpoint
    lands 2.2px above the centre of the type beside it, which reads as the avatar
    sitting high while every number says centred. `--postbar-face-y` is that
    offset, measured against the real face at the real size. It is OPTICAL and
    does not follow from the geometry, so it is the one number to move if the
    face ever reads high or low again.
  - **The vertical padding is the WRAPPER'S, never the textarea's.** A scroll
    container clips at its padding box, so a textarea carrying `padding-block`
    under a `max-height` paints its overflowing next line *into* the bottom
    padding — four clean lines and then the top half of a fifth, sitting there
    permanently at scroll top. On a non-scrolling wrapper the same measurement
    clips exactly where the text ends. (The scrollbar is off for the same reason
    it was noise: 3px of chrome between the last word and the send disc.)

  Retired with it: `openLikers`, `openGoing`, `openReadMore`, `collapsePanel` and
  its three wrappers, `wireCardCollapse`, `wireReadMore`, `onDoubleTap`,
  `scrollCardIntoView`, `scrollCardToTop`, and `wireNotif`. `spotlightPost` and
  `parkCard` outlived that list by one release, on the argument that the edit
  flow was still a position in a column — and in 1.4 the editor moved onto the
  post's page too, so both are **gone** (see the next note).

- **EDITING A POST HAPPENS ON THE POST'S PAGE**, `#/p/<id>?edit=1`
  (`renderPostEdit`), reached from the ••• wherever the card is drawn. The route
  is the point: an editor that is a real history entry is cancelled by the back
  gesture like any other page, a reload lands back in it rather than nowhere, and
  the post is edited where it lives.

  It used to be an **inline form on your profile**, which took three pieces of
  state to arrange: `pendingEditId` carried the id across the navigation from
  whichever ••• was tapped, `editingId` told the profile column which one of its
  cards to build as a form, and `spotlightPost` parked the window on that card so
  you could see what you had asked for. None of that was about editing. It was
  about addressing a post on the one surface that could only address a post by
  its position, which stopped being the only surface in 1.3. All three are
  retired, with `parkCard` and the router's empty-settle branch behind them.

  **The two answers are the toolbar's**, exactly as the profile editor's are: a
  back chevron that becomes an X once a word has changed, a check that fades in
  to meet it, both read off one `dirty()` predicate so the bar can never offer a
  save with nothing to save. That is also what keeps `PAGE_SEL` at four
  selectors — the old Cancel/Save pair sat at the foot of a *scrolling* form,
  which is the shape that needs a native page button, and the honest fix was that
  an editor's answers belong on the bar (see
  [native-chrome.md](native-chrome.md)). The fields themselves are unchanged and
  still mirror the composer's (`editFieldsFor`), the form wears `.composer` to
  say so, and **Delete is still one row down in the post's •••**, where it can't
  be reached by aiming at Save.

  `submitEdit` takes the editor's own way out as a callback, so a save leaves
  exactly the way a cancel does (popping the pushed entry where there is one).
  And `refreshPostViews` learned the third surface: given the id of a post that
  has just been deleted, a page whose subject that was hands the reader back to
  wherever its chevron points, while anything else that happens up there (a
  repost, an undo) repaints the page in place rather than through the router.

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

  **YOU MAY REPOST AND QUOTE YOUR OWN POSTS**, as of 1.4. `Store.repostable` had
  copied `toggleLike`'s no-self rule on the reading that passing your own thing
  along is talking to yourself; that is wrong about what a repost is for here,
  because a circle post reaches the intersection of two circles and bringing an
  old one back up is the one move that reaches whoever joined since. A quote of
  your own post is the same act with a sentence on it. Nothing downstream needed
  loosening, which is the sign it was only ever a client opinion: `reposts.sql`
  never had a no-self arm (the insert policy checks the audience, the allowlist
  and the chain, not the author), `notifications()` already skips
  `p.author !== me`, and the push function already refuses to buzz you about
  yourself (`orig.author !== rec.author`). **No migration.** Two things follow in
  the drawing: the pass-along line says **"You reposted"** rather than your name,
  because it sits directly above a byline that already says it and the line is
  addressed to the reader rather than about the author (the app's only such
  swap); and the original stays where it was in the feed while the repost lands
  at the top, which is the same doubling anyone else's repost produces and is the
  point of the gesture rather than a thing to dedupe.

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

- **THE HEADCOUNT IS THE GUEST LIST WHEN YOU ARE THE HOST**, and that is one
  control doing two readings rather than a second control. A guest taps it and
  sees who's going, exactly as before. The host taps it and sees the same list
  CONTINUED: everyone who said yes, each tagged `Going`, then everyone else who
  was invited and hasn't answered, alphabetically. So the glyph never stops
  meaning what it meant (the people coming are still the top of the list) and
  the host gets the half only they can act on, which is who is still to answer.

  Two shapes were built first and both came out, which is worth knowing before
  re-proposing either. A **••• row opening a modal** made a question the host
  asks constantly cost a menu, and put a roster in a popover when the page
  already has a place for rosters. A **fourth pane with its own glyph** in the
  action row was worse: two person-glyphs side by side, each with its own count,
  where the difference between "invited" and "going" had to be read off two
  similar drawings. The list itself is the cheaper place to say it.

  `Store.audienceOf(postId)` is who was invited, and it is deliberately the
  reminder sweep's rule copied into the client (see `activity-reminders.sql`):
  the allowlist for `list`, the host's mutual friends for `circle` **and for
  `public`**. If those two ever disagree, the people a reminder wakes up and the
  people this list names are different sets and one of them is lying to the
  host. It is **author-only**, and that is a data fact rather than a courtesy —
  RLS hands you the `post_audience` rows for posts you wrote plus your own
  membership rows and nothing else, so on somebody else's `list` post it could
  only ever answer with the fragment the cache happens to hold.

  Five things that aren't guessable:

  - **The `Going` tag wears `--going-ink`, and the headcount glyph deliberately
    does not.** The tag is the reader's own accent where they picked one in Edit
    profile and the activity green where they didn't — the same rule the liked
    heart follows, answered once in `tokens.css` so no dark-mode copy is needed.
    It used to be flat `--type-activity-ink`, on the stated argument that the
    tag and the glyph that opened the list had to be one colour. **They never
    were, and can't be:** `.card-attendees.going` is a GUEST's raised hand, tags
    are drawn for the HOST alone (a guest's who's-going list carries none), and
    a host is never `rsvpable` — so the glyph above a tagged list has always
    been plain ink. `.card-attendees.going` keeps its green.

    It borrows the HEART's weight rather than an `-ink` twin's, because an
    accent has exactly one mark weight per scheme and a second would be a third
    perceptual number to keep in step for one pill. The cost is measured and
    named in the token: green ink is **4.62** on paper, an accent at
    `HEART_LSTAR_LT` (53) is **~3.46–3.50**, so under a picked colour this word
    sits below AA for small text. Accepted because the label is redundant — the
    host's list is ordered, everyone tagged first — and **not** a licence to put
    `--user-heart-lt` on body copy anywhere else.
  - **`likerItemHtml` must never be passed point-free to `map`.** `list.map(likerItemHtml)`
    hands `map`'s INDEX in as `tag`, so index 0 is falsy and the first row looks
    correct while every row after it wears the tag pill counting 1, 2, 3 down
    the list. It shipped that way on the **likers** panel, where it read as a
    green like count on your own post's page — a tally nobody asked for, in the
    colour reserved for who is coming to a plan. Every call site that means "no
    tag" says so with an arrow.
  - **The two halves are CONCATENATED, not one list with a lookup for the tag.**
    A name can be going without being invited: `audienceOf` reads your circle as
    it stands *now*, so unfriending somebody who had already raised a hand drops
    them from it while their headcount row survives. They are still coming, so
    they are still on the list.
  - **Only `public` gets a line above the list.** On a circle or hand-picked
    activity the names ARE the answer, and "everyone in your circle" over a list
    of your circle is the fact told twice. Public misreads without it: its
    audience is technically the whole room, but `canJoin` is friends-only, so
    what the host sees is their circle with nothing saying why.
  - **The count on the glyph stays the headcount for everybody.** A number that
    quietly meant "going" for a guest and "invited" for the host would be the one
    control on the card saying two things. Only the label changes (`Guest list`).
  - **Blocked names are dropped from both halves and that is TRUE, not polite** —
    `can_view_post` opens with `not is_blocked_pair(...)`, so they cannot see it.
    The gap is unreachable from a client on purpose: someone who blocked YOU is
    invisible to your cache, since you only ever learn about blocks you made.

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
  you tap once.

  **Format is universal as of 1.4, People included.** The switch used to be
  absent under People (not disabled — a dead row is worse than no row) on the
  argument that a directory of portraits had no column form, and portrait tiles
  were **dropped** in list mode on the argument that a tile with no post has
  nothing for a card to be. The second one was true and the conclusion was wrong:
  the answer isn't a card, it's a **row**, and the app already had one. So a
  portrait tile draws as `friendRowHtml` — the friends page's directory row,
  reused rather than copied, which is what makes the **Add** on it the same tie
  with the same five states. Two things it takes that a friends row doesn't, both
  via `opts`, both because they were already ON the tile it replaces and a format
  switch must not lose them: the `.ptile-lock` padlock (same class, no
  `.name-fence` — a row has a whole line and nothing to orphan the mark onto) and
  a clamped line of **bio**. That also fixes the case the old rule quietly broke:
  a name search under All in list mode used to discard the very person you
  searched for.

  **The column is drawn as RUNS, not as one flat list.** A run of posts is a
  `.feed`; a run of people is a `.friends-list`, whose opening rule is on the
  CONTAINER — so alternating one node at a time would draw a hairline above every
  single person. Grouping costs nothing in order (consecutive tiles of a kind
  stay consecutive), so the column reads in exactly the sequence the grid would
  have dealt, ranked search included. Each run staggers from its own start,
  because `syncCards` staggers a container's cards from the index inside that
  container and a people run counting on from the posts above it would be the
  only block on the page not doing that.

  Three more: **`discoverView` is in the paint signature** and has to be — the
  tiles are identical either way, so without it the early return would swallow
  the repaint the tap asked for; in list mode it also pulls each person's
  `friendStatus` into the signature, because a row carries a tie and a request
  accepted between two pulls has to be able to move the button (the tap's own
  answer doesn't come through there — `wireTieList` swaps the slot in place).
  **List reuses `makeCard`**, not a second design of one, so a stranger's post
  reads exactly as a friend's does at home and `canSocial` / `canJoin` keep
  meaning what they already mean. **`wireTieList` binds to the BODY, once** —
  Discover repaints its rows on every keystroke, and a listener per paint would
  pile up; the `dataset.tieWired` guard is what makes it safe to call from inside
  the paint.
- **A profile carries the same dial, and Frames is a wall.** The dial is in the
  **toolbar** with the page's other controls, rightmost, after the identity
  button — one control, one treatment, one place, the same as every other page.
  It used to live in a `.profile-shelf` between the identity header and the
  posts: a tracked micro-caps caption naming the pane, with the dial at its
  right. Both halves came out in 1.3. The caption was a third telling of
  something the button's own lit hue and the dial's checkmark already say, and
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
  (see the glass note in [design.md](design.md)). The page it opens now
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

- **`users.listening_to`** is a self-reported song and the app's FIRST piece of
  content that is not audience-gated. It sits on `users`, so `can_view_post` and
  the private-account fence don't reach it: any signed-in reader sees it, the
  same way a name and a bio are already public to the room. That is a deliberate
  trade for a song and it should not be quietly generalised — anything with more
  in it than a track title belongs on `posts`, behind the gates that already
  exist. Shape is `{title, artist?, art?, apple?, spotify?, at}`, one jsonb
  because nothing queries inside it; `artist` is optional because Spotify's
  oEmbed (the paste path) returns a title and no artist.
- **A link PER SERVICE, because the reader who taps is not the reader who set
  it.** Usually only one of `apple`/`spotify` is known — search finds Apple's
  copy, a paste keeps whichever was pasted — and `songLink` in app.js picks the
  one the *reader's* device wants, falling back to a search URL in that service.
  Rows written the day the feature shipped carry a single `url` instead;
  `freshSong` folds it into the service its hostname names, on the read. **That
  fold is deliberately not a migration**: jsonb tolerates both shapes, and a
  column whose every row expires within a week is not worth an ALTER.
- **A song expires on the READ, not on a schedule.** `freshSong` (store.js) drops
  anything whose `at` is more than seven days old before it ever reaches
  `.listening`, so the expiry rule lives in exactly one place and no render site
  can forget it. A cron sweep was the obvious alternative and it's the wrong
  shape: it would still leave a stale song on screen for up to a day, and the
  whole point of the clock is that a status stops claiming to be true. A row with
  no `at` is dropped too — every write stamps one, so its absence means malformed,
  and showing a song that can't be dated is the one thing this must not do.
- **Nothing connects to Spotify or Apple Music.** Both would need OAuth, a stored
  refresh token and a poller, and the failure mode of all of it is a stale answer
  indistinguishable from "not listening to anything". Metadata comes from two
  keyless, CORS-open endpoints the webview calls directly — Apple's iTunes Search
  API (search, artist, artwork, and an Apple Music link) and Spotify's oEmbed
  (title and artwork for a pasted Spotify link, the only part of Spotify's API
  needing no token). Artwork is **hotlinked, never re-hosted**: Apple's terms
  cover displaying it beside a link to the store, which is not permission to copy
  it into our bucket. Full reasoning, including what a real Spotify search would
  cost, is in [1.5.md](1.5.md).

- **`users.pinned`** is up to three cards a person holds above their own wall: a
  post of theirs, or a song. An ORDERED JSONB ARRAY, and the order is the array
  — `[{k:'post',id} | {k:'song',title,artist?,art?,apple?,spotify?}]`, capped at
  three by a check constraint. A `pinned_items` table was the first proposal
  (see [1.5.md](1.5.md)) and lost on the reorder: a `position` column wants
  `unique(user_id, position)`, and swapping two rows under that needs deferred
  constraints or a three-step shuffle, where an array has no such thing as two
  things in slot 1 and a drag is one write of the whole list. It also costs no
  read — `readWorld` pulls table by table, and a new table is a round trip on
  every load for at most three rows a person.
- **A song pin is `listening_to`'s object minus `at`**, and that absence is the
  difference between the two features: a status is a claim about right now and
  has to be able to stop being true (`freshSong`), a pin is a choice and stands
  until it is changed. Both go through `cleanSong` in store.js, so the https-only
  rule on `art` and the two service links is written once.
- **A post pin is a POINTER and cannot widen an audience.** No fk, no copy of the
  text: every reader resolves the id against their own cache, which only holds
  what RLS handed them, so a pin at a friends-only post draws nothing for a
  stranger rather than leaking it. `pinsFor` (app.js) runs the same tests the
  wall runs — subject, block, activity courtesy, a locked profile's public-only
  fence — and DROPS what it can't draw, which is why each entry carries its slot
  index: the third card on screen can be the fourth thing in the row, and every
  write names the slot rather than the card.
- **`Store.setPins` writes the whole list, every time** — pin, unpin, reorder,
  swap — because half a reorder is a worse state than none of it. It validates
  per entry and silently: a post that isn't yours, isn't there, or is already
  pinned is dropped and the rest is saved, so a reorder doesn't fail outright
  because one pinned post was deleted this morning. `Store.deletePost` prunes a
  pin at the post it just deleted, so a spent slot with nothing in it is the
  fallback rather than the normal path.
