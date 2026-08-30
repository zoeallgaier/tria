# Navigation, motion and scroll

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

**Re-tapping the tab you are on is one gesture with three parts** (`reclick`):
scroll to the top, clear Home's filter and tag, and re-pull the world with
`refreshWorld(path, { force: true, hold: false })` — `force` skips the 4s spam
guard because a tap that visibly does nothing reads as a broken tap, and `hold`
is false because we are already taking the reader to the top and `keepPlace`
would only fight the scroll. It ignores every path but Circle, Discover and
Updates, so a re-tap on Profile is still only a scroll.

The re-pull was **taken out once and is back on a condition.** The objection was
never that a tab shouldn't refresh; it was that this one did it *invisibly*, a
second refresh sitting silently beside the pull, so the app appeared to reload at
moments the reader hadn't connected to anything they did. What answers that is
the ring, which did not exist on this path then: `showWorld` borrows the pull's
own indicator for any repaint the reader didn't gesture for, so the tap now says
what it did in the one vocabulary the app has for "the world is being re-pulled".
A pull that finds nothing new still shows nothing, and shouldn't — the scroll to
the top is the answer to the tap; the ring is the answer to rows arriving.

**In the app that tap arrives somewhere else entirely.** The CSS nav's `reclick`
hangs off a click listener on `#nav`, and `html[data-chrome="native"]` hides that
element — so every native re-tap fell through to `go()`, which sees an unchanged
hash and re-runs `route()`: a full re-render that restores the scroll it just came
from, i.e. a tab that visibly did nothing. The `chromeTap` handler compares the
route against the live path and calls the same `reclick` (see
[native-chrome.md](native-chrome.md) — native is a renderer, and this is one more
fact the web half owns).

Two guards, because a held scroll outliving its account is the failure here.
`rememberScroll` **never files from the gate** — the signed-out branch returns
before it advances `lastPath`, so on a dropped session `lastPath` still names the
authed page while the scroll on screen belongs to the login form. And logging out
**clears both maps**, or the next person to sign in opens someone else's feed
part-way down.

**A jump is not a scroll gesture, and the bar no longer has to care.** The topbar
read the scroll's DIRECTION through 1.3 and tucked away on a thumb going down,
which meant a guard against the router's own teleports (to a spotlight, to a
remembered position, back to the top): a thousand-pixel jump read as "scrolling
down fast", so landing on a post also slid the bar away — a second move stapled
onto a navigation meant to have none. The gesture is gone in 1.4 (see
[native-chrome.md](native-chrome.md)): the controls are up on every route and
only the bar's material and its small title answer to the scroll, both of them
POSITION rather than direction, so a teleport has nothing to be mistaken for.
What survives is the other half of the rule — the router states both after it
places a scroll (`syncTopbar`), instantly, because a jump may fire no scroll
event at all and a route change is not a thing to narrate.

**A spotlight has no travel and no wash — and there is only ONE left.** Discover,
Updates and the frame wall all open `#/p/<id>` now (see the post-page note in [data.md](data.md)), so the only thing still setting `spotlightPost` is the edit flow,
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
arrives instantly *nothing* moved. The dock came out after (see the seg-tabs note in [design.md](design.md)), and in 1.3 All / Mentions became a toolbar filter like every other
page's, so on Updates there is nothing left here to sequence at all — and with
the composer's Post / Activity gone the same way, the control itself is deleted.
(The arriving
page's glass has stayed live since the one-fade change, for
the neighbouring reason: `backdrop-filter: none` applied to a promoted fading
layer, and the destination is neither, so a page used to land wearing flat glass
and frost up on cleanup — a little pop of the material switching on at the end of
every navigation.)
