# Design system

**1.4 moves the nav chrome to UIKit** ([native-chrome.md](native-chrome.md)), so
read the toolbar, tab bar and FAB notes below as the description of the CSS
chrome — which the web keeps, and which the app falls back to on an older OS or
a plugin that didn't load. Everything else here (the quintet, the glass tiers,
accents, the wash, corners, targets, motion) is the app's own and is unaffected.

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
  receipt never folded. `.masthead-filter` wears the active type's own hue
  whenever a filter is on, so under a picked accent the row you tapped was ink
  and the mark it lit was lavender: the legend disagreeing with the thing it
  labels, in the one control where the two exist to teach each other. (That
  receipt was an 8px dot on the disc's corner until 1.4, when it became the
  glyph's own colour — a bead ringed in opaque paper reads as a paint fault on
  native Liquid Glass. The `-ink` half of the pair, since a 24px stroked mark
  needs the readable one; the dial's rows keep the raw pastel.) Fold both
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
outright (see Lit dome). In the app those buttons are native glass and the band
takes one of three forms there: a reader's accent (one hue) tints the material
itself, Tria's four-hue ramp sits under it as a thinned backdrop, and "no
colour" draws neither. Nothing is ever painted OVER the material — see "The + is
TINTED GLASS" in [native-chrome.md](native-chrome.md), which is also the note on
what that mistake looked like. Instrument Serif on titles only; Oxygen everywhere
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
  what the class still gates is the material and the reserves.
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

**The wordmark is signed-out, or it is the desktop rail's head.** `.brand` is
gone from `index.html` and no page's TOP BAR carries it: a bar names the page you
are on. It earns its space on `.auth-topbar` on the front door, where there is no
page identity to show instead (the reset and confirm cards carry it too, over
their headline, and so does the boot splash), and — since 2026-09-17 — at the top
of the **desktop sidebar**, which is a column with a head rather than a bar with
a title. `.nav-brand` is `display:none` under 681px: the phone's nav is a
floating pill and a round **+** over the content, with nowhere to put a name, and
the name is on the icon the reader tapped anyway. It is **decorative** (`role="img"`,
no `href`) because the wordmark's old job as the signed-in link to About is now a
row in the ••• sheet. Its width is aimed rather than chosen: 3.8rem makes the
mark 38px tall, which under the rail's 1.5rem head puts its centre on the
toolbar's own midline across the gap, the line the first destination used to
hold.

**The wordmark is the logo, drawn as a mask** (Zoe, 2026-09-16).
`icons/wordmark.svg` is `icons/TriaLogoOfficial.svg` cropped to its ink, and
`.wordmark` in app.css uses it as a `mask` with `--brand-band` painted through
it, rather than as an `<img>`. An image would bring its own baked colours; a mask
reads only the shape, so the letters wear the same four tokens every primary
button paints, and the splash can turn them. The file's own gradient ends on a
pink-red where the band ends on orange; the band wins. Callers set a **width**
only (a flex column stretches an auto cross size and ignores `aspect-ratio`),
and the element is empty, so every copy that is content carries `role="img"`
and `aria-label="Tria"`. A pending mask paints nothing in either engine, so
there is no flash of a gradient box while the file loads. It was also the only signed-in link to
About, so **About is a row in the ••• sheet on your own profile** — which matters
more than a colophon would, because the feedback form is there and it is the only
way to report a bug.

**Every BAKED mark is the splash, held still, and `gen-icons.js` is what keeps
it that way** (2026-09-17). The favicon, the three home-screen tiles, the
appiconset's fallback and the iOS launch screen are pixels, not a mask, because
every slot that takes them wants a bitmap — so they are the one place the logo
can quietly drift from the app drawing it. The script renders all of them from
`icons/wordmark.svg` in Chromium, with the same mask and the same band at rest,
on Tria's own paper: `node gen-icons.js`, and run it for the whole set rather
than one tile. Three of its numbers are decisions: **80%** of the tile is the
inset the icons have worn since v=289, **84%** for the 32px favicon because a
wordmark has more to lose to rounding than a disc did, and **66%** for the
Android maskable because it is a wordmark's DIAGONAL that has to clear the 80%
safe circle (66 × 1.178 = 78). The launch screen's **13%** is not an inset at
all; see [ios-shell.md](ios-shell.md). The band stops are written out in the
script, since baked pixels can't read a token — keep them in step with
`--band-*` in tokens.css, and note the ramp there is the SPLASH's (115deg,
plain sRGB), not `--brand-band`'s oklab, which is a visibly different middle.

The old icon was a pastel disc with the `t` knocked clean out of it, and the
knockout is why those tiles were opaque: a hole only reads as a letter against a
colour we control. **They stay opaque for a different reason** — iOS composites
`apple-touch-icon` transparency onto BLACK (tried in v=291, light mode got a
black tile), and the iOS 18 light/dark/tinted icon system is asset-catalog only,
so a scheme-aware web-app icon isn't reachable from a `link` or the manifest at
all. Paper is baked in.

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
- **The audience picker is a sheet, and it commits as you tap.** It was a centred
  `.modal` card — the profile editor's and the friends list's bug a third time: a
  fixed centred box with no `overflow`, holding a card with no `max-height`, over
  a body whose scroll is locked. It was left there on the argument that it is
  "short by construction", and it is not: it lists your whole circle, so past
  about a dozen friends the question went off the top of the screen and Done went
  off the bottom with nothing left to scroll. It is `openSheet` now (`head` +
  `wire`, the way the colour picker already used it), the checklist is the one
  thing on the panel that scrolls, and taking each tap as it lands is what makes
  every way out — the dock, Escape, the scrim, the back gesture — leave the same
  answer. The lock behind the sheet updates as you go, which is feedback the card
  never gave. The coercion is unchanged and still stated once: **Choose people**
  with nobody chosen is My circle, because an empty allowlist is a post nobody
  can read.
- **The same lock is the post editor's** (`editFieldsFor`, `lock: true`), at the
  foot of the same note box, opening the same sheet against the same
  `pubAudience`. The composer's foot bar therefore splits in two in the editor:
  the four attach TOOLS stay composer-only, because a post's media and its type
  are fixed once made and a button there would promise what the editor can't do,
  while the lock crosses because who can see it is fixed by nothing. A quote is
  the one editable family with neither: its audience is the original's. The lock is a
  `<button>`, so the editor's `dirty()` measures it as its own half of the
  predicate rather than through the form snapshot, and the sheet's per-tap commit
  is what re-asks the bar (see `onChange` on `wireAudienceLock`).
- **THE SAME CHECKLIST IS A CHAT'S ROSTER** (`openChatPeopleSheet`, 1.8), which
  is why `pickRowHtml` is a shared function rather than two copies of one row.
  Picking who can see a post and picking who is in its chat are the same act on
  the same people — and on a hand-picked plan they are not even two lists, since
  the invite list IS the chat. Two drawings would have been two faces on one
  fact. It replaced a text-only list of names whose rows opened a SECOND sheet to
  remove somebody, plus a whole separate PAGE to put somebody in.

  It commits as you tap like its twin, but here that is a WRITE per tap, since a
  roster has no Save to defer to: a row flips first and puts itself back if the
  write is refused, and each row guards itself rather than the sheet freezing.
  Rows that show a state and cannot be tapped — you, and a plan's host — are
  `<div>`s (`.aud-pick--fixed`), not disabled buttons: a disabled control reads as
  one that is broken, and openSheet's focus trap would have to be told to skip it.
  The "host" and "you" tags ride the handle line (`@ann · host`), which is how two
  more facts fit with no new CSS.
- **A sheet is not a history entry**, so `route()` sweeps one on its way in. The
  edge-swipe used to render the next page straight through an open sheet and
  leave a panel floating over a locked body with the native chrome still stood
  down. One line, for every sheet at once.
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
  reader find out at the foot of the form. The composer swaps it at runtime (the
  type flips under your hand, see `syncType`); the EDITOR knows what it is
  editing at mount and passes it once, as `richNoteField`'s `titlePh`.
- **EVERY EDITABLE TYPE IS THE RICH EDITOR, and the activity was the last to get
  there** (1.8). Its branch in `editFieldsFor` still built the pre-1.3 two-form
  composer's flat `combo()` box — a 180-char `<textarea>` — while the one form
  has written every plan's note as the rich HTML subset since "a plan is a note
  with a place and a time attached". So editing a plan showed the reader their
  own `<p>` tags in a plain box, invited them to break them, and refused to let a
  note already over 180 characters grow. `combo()` had no other caller and went
  with it. Anything that renders a stored note has to go through the rich path or
  `plain()`; a bare `esc()` of `post.note` is this bug.
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

**And as of 1.3 it is an EFFECT, not a permanent fill — and as of 1.4 the
reader's DIRECTION is half of when it draws.** At the top of a page nothing has
passed under the bar, so there is nothing to separate it from: the material is
simply absent, the page runs clean to the top edge, and the controls sit on it as
the glass objects they already are. Going DOWN a page it is absent for the same
reason in spirit — the reader is reading, not looking at chrome — and it comes
back when they reach up (`.topbar--reading`, driven by `syncToolbarReading`;
profiles and dailies hold theirs and never wear the class). It fades in the
moment content starts sliding underneath — `.topbar--bare`, driven by
`syncToolbarEdge`, the
same shape as the collapsing title (a boolean crossing with a 2px deadband for
iOS's rubber band, instant on navigation, never a per-frame value read off the
scroll). It lives on `.topbar::before` because it has to FADE and neither half
can do that in place: `background-image` doesn't interpolate between gradients at
all, and dropping the fill while the blur ramps is two events for one change. One
`opacity` transition on a layer carrying both does all of it. The status-bar
scrim goes to full strength wherever the material isn't drawn, which is two
states: the top of a page, and a reader going DOWN one.

**And the rules that take it there must restate the shell gate, or they
lose.** `.statusbar-scrim`'s baseline is `html[data-shell="installed"]
.statusbar-scrim` — an attribute plus a class, (0,2,1). A bare `.topbar--bare
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
to every button, or it stops meaning anything. That holds for the native lining
too: it is the same band on the same closed set of buttons, not a decoration
glass is now allowed to wear.

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

**The reaction fan is the third dial, and it is the + dial's kind** (2026-09-25):
five frosted discs you reach for, each blooming in a colour behind its glyph,
staggered a beat apart over a veil that is the only blur. Hold a friend's heart
and they appear on a quarter arc (184° to 88°, radius 116), because the heart
sits at a card's bottom right and a half ring would run off the screen; it turns
down under the toolbar and mirrors near a left edge. The angle picks, not the
distance, so every mark is the same short drag. No words on it at all, on Zoe's
call. **Nothing on it moves but the disc under the finger**, the third and
fourth passes on her phone. It
shipped lavish (a blurred veil, the discs fluttering out on a 0.4s spring with a
rotation) and read slow; a 100ms fade of the whole thing read like a pop-up;
the discs springing out quickly still read a little jumpy. Now every disc sits
where it lives and they fade in one at a time from the heart outward (0.14s
each, 40ms apart), the held heart no longer sinks, and it closes in a 120ms
fade that takes no taps. The one thing that moves is the lit disc: it steps
12px out along its own bearing (to radius 128, where the canvas drew it) and
grows a tenth, because a bloom under a fingertip can't be seen. Zoe asked for
it by name; it is one disc going a finger's width, following the finger.
The veil is a flat dim: a faded backdrop blur re-blurs the page every frame. The finger learns where it
is from a **tick** instead, the system picker haptic, once per mark reached.
And nothing on it is selectable: the fan opens under a finger that is still
down, and iOS's text long-press fires on whatever is under it a beat later. The colour is the post's
(`--heart-*`, so the reader's accent where they chose one): the lit disc blooms
in it, and your own mark sits filled in it, in the fan and on the card.

The five marks follow ONE rule: an outline at rest, filled when it is yours, the
way the liked heart always was, which is also what lets the ink flood work on
all of them (a mask per mark, `.card-like[data-rx]`). The grin's eyes stay
strokes (a filled chevron is a triangle) and the whoa's dots are solid in both
states. **They are optically centred on the heart inside their own drawings**:
each was rendered at 10x, its optical centre taken as the midpoint of its box
and its ink centroid, and a translate baked into the `react_*` path moves it
onto the heart's (thumbs up rides a unit high, down a unit low, both half a unit
right; the whoa sinks 0.7; the grin lifts a quarter). Measured after, all five
sit within 0.05 of a unit of the heart. So the disc centres a box and the card
row gives every mark the heart's own `--like-nudge`, and neither nudges any one
mark. Redraw one and you re-measure it.

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
the composer's audience lock, the notifications switch's route into iOS
Settings). And **the post card's own
•••**, which is the deliberate one — it is not a toolbar glyph, it rides a card
at an arbitrary scroll position, so a menu dropped from it would land anywhere
between mid-screen and the 40px gutter above the nav and the same tap would
produce a different-shaped thing every time.

**That last one holds for a card WE draw, and 1.4 found the edge of it.** In
the app the colour ring dropped a real `UIMenu` for a while, and the system
flips it, scrolls it and clips it to the safe area itself, so the "lands
anywhere" objection, which is an objection to our positioning code, was not
true of its own. It went back to the sheet anyway on 2026-09-10, for a
different reason: the sheet shows the colours off (big swatches wearing the
real band, the photo in its disc, the page repainting under a see-through
scrim), and a menu row is a flat 22pt disc that dismisses on the pick. The •••
and the repost circle tried the same move and went back earlier: as of 2026-08-30 `openPostMenu` and `openRepostMenu` build their array and
hand it straight to `openSheet`, same as the audience picker always has, with no
native branch. See "A menu the page asks for" in
[native-chrome.md](native-chrome.md), including why the colour picker came
back.

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
**Save** check, the daily's **Add yours** in both places it is drawn, and the
post page's comment **send disc** — are
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
- **`--pill-alpha` (0.85) is a CONTRAST FLOOR, not a style knob.** The ink
  rides this fill and translucency composites the button against the page. A
  reader's accent is the deepest thing it carries (the brand ramp is bright and
  measures 8.38 at its own worst). Since 2026-09-10 a palette pick is its own
  hex and its ink is measured per scheme against the hex thinned to **this**
  value (`accentInk` in app.js), so the two are one account: every accent clears
  4.5 at 0.85, tightest **ruby on paper 4.53** and **ocean on ink 4.55**.
  Thinner, and those two go first; a new hex gets measured at 0.85 too.
- **The FAB is the one OPAQUE member, deliberately — in CSS.** It takes the same
  edge, rim and float but not `--pill-alpha`. It floats over the feed itself
  rather than over a form, so thinning it would show live content sliding
  through the app's most permanent object, and the **+** sits on that fill at
  every moment of the app's life — an opaque band is the only version whose
  contrast doesn't depend on what happens to be scrolling underneath. Both of
  those are arguments about compositing against a *sharp* backdrop with no
  blur budget to soften it, so both dissolve on the native chrome, where the
  disc is real Liquid Glass and the system does the softening. The native + is
  translucent in all three of its band forms; the CSS one is opaque. See
  [native-chrome.md](native-chrome.md) — that is the one place the two chromes
  disagree on purpose.

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
order; only the travel between them changed. (The phone's + no longer wears
this band at all — it takes the neutral, for the reason set out under "The + does
not wear Tria's band" in native-chrome.md. The measurement stands: it was taken
on the worst case, and every capsule that still wears the ramp is an easier one.)
It sits behind
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
readers, nothing left to drift. The boot mark (and the wordmark) is the deliberate
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
  - **A reader's colour stamps TWO inks, `--user-ink-lt` and `--user-ink-dk`,**
    in the same call as `--user-band`, and `tokens.css` resolves `--user-ink`
    from whichever scheme is live (the same one-scheme-apart pair as the
    hearts). Unstamped, `--user-ink-lt` is undefined, which makes `--user-ink`
    invalid, so every `var(--user-ink, fallback)` falls back exactly as before.
    A light glyph arriving a frame after a light band is a **+** you cannot see,
    on every route, which is why they are stamped together.

- **A palette colour is ONE HEX, and everything reads straight off it.**
  (Zoe's call, 2026-09-10.) The glass on every capsule and the +, the lit tab,
  the band's middle stop, the hearts, the dot, Going, a tagged name and the
  profile's wash all wear the hex, in both schemes. `ACCENTS` in app.js is the
  list; an entry is `{ key, label, hex }` with an optional `ink`.
  - **What it replaced.** For a long stretch every accent was DERIVED: the band
    re-pinned to a shared `BAND_LSTAR` of 74, with ruby, rose and ocean
    declaring their own `band: {lstar, sat}` at 65 and 72, and the hearts
    re-pinned to L\* 53 on paper and 74 on ink. It levelled the set and fixed a
    real bug (a lime heart at 1.3 on paper, "picking Lime turned your likes
    off"), but it left the hex doing one job, the wash, so every swatch looked
    duller than the button it produced. And it flattened reds: at L\* 74 every
    red is a pink, so a ruby heart on dark paper was pink and the likes read as
    two colours across the schemes. The derivation is still there for **photo
    samples** (`bandFrom`, `heartsFrom`), because a sample is an average rather
    than a decision; see below.
  - **`ink` is the one exception, and it is the quintet's own shape.** A pastel
    is fine as a fill on either paper and as a mark on ink, but not as a mark
    on light paper. An accent may carry a deeper twin that its marks wear **on
    paper only**: hearts, the dot, Going, and the base a mention deepens from.
    Dark paper always wears the hex. Blush, amber, lime, jade and cyan carry
    one; ruby, coral, ocean and indigo don't. (This `ink` used to mean the
    button's glyph; that is `accentInk` now, measured, not declared.)
  - **Measured, and four are under.** Floors on `#edeef0`: 3 for a mark, 4.5
    for a mention (the mark deepened 20% toward `--text`).
    Marks on paper: ruby 3.96, blush 3.41, coral **2.24**, amber **2.05**, lime
    **2.60**, jade 3.33, cyan **2.85**, ocean 3.32, indigo 3.63.
    Mentions on paper: ruby 5.40, blush 4.73, coral **3.21**, amber **2.96**,
    lime **3.65**, jade 4.54, cyan **3.97**, ocean 4.53, indigo 4.88.
    Coral, amber, lime and cyan were tuned by eye below both. The twin that
    clears them is the same hue at about L\* 54 (coral `#e15519`, amber
    `#b07614`, lime `#608f14`, cyan `#128fa2`). On ink every hex is 4.14 (ruby)
    or better.
  - **The ink is per scheme, and the opaque FAB permits it.** The note that
    used to live here said the FAB forbade a glyph that flips by scheme, because
    at L\* 52 it measured 3.85 and 3.96 against the two inks. That held the + to
    **4.5, the floor for text**; the + is a glyph, and a glyph's floor is 3.
    `accentInk` picks near-black or near-white per scheme against the hex
    thinned over that paper, so capsules hold 4.5 everywhere and the opaque +
    is worst at **3.57** (ocean on ink). The measurement hands ruby, ocean and
    indigo white on ink, and **the app overrides it**: all three wear the
    near-black on both schemes (Zoe's call, 2026-09-23), because on the actual
    disc the near-white read as glare. Every other hex takes the measured
    answer, which is near-black in both. The override is in the accent branch
    of the band stamp in app.js, keyed off `accent.key` (`lavender` is Indigo).
  - **The wash was re-measured**, `--wash-ink-soft` at the bloom's peak, light
    / dark, the same method that reproduces the old ruby 4.36/6.10 and rose
    5.50/5.38 exactly: ruby 4.30/5.43, blush 6.04/5.19, coral 5.35/5.06, amber
    6.34/4.62, lime 7.08/4.31, jade 6.69/**4.15**, cyan 6.92/4.23, ocean
    5.17/5.93, indigo 5.10/6.35. The brighter hexes cost a little on dark,
    jade most. `--wash-keep` in the dark block is the lever if that matters.
  - **`BAND_ARC` is 11°**, down from 16, because a 32° sweep was wider than the
    palette's own spacing and neighbouring bands painted each other's colours.
    The tightest pair is coral→amber at **20.2°**, so their outer stops touch
    by about two degrees; the centres are what a reader tells apart. Ruby→blush
    used to be the tight pair, at one point 0.1° apart — one hue, two depths,
    bands fully overlapping. Blush has since moved off ruby's hue twice; the
    gap is **28.2°** now, past coral→amber, so that note no longer singles this
    pair out.
  - **Keys don't move.** `users.accent` stores the key, so a new label is free
    and a new key strands everyone who picked the old one (an older client
    meeting an unknown key falls back to the photo). That is why **Blush is
    still `'rose'`**, and why **Indigo (2026-09-23, was Lavender) is still
    `'lavender'`**.
  - **The swatch grid is ROYGBIV, 3×3**, sorted by hue from the red end, which
    deals warm / green / cool as the three rows. Ruby leads blush on hue (350°
    against 322°) and on depth. They shared a hue until **2026-09-22**, when
    blush moved off it twice in the same day: ten degrees toward magenta first
    (at 350° it was a light red wearing a pink's name), then another eighteen
    past Barbie pink's own hue (about 328°) toward blue-violet, on the call
    that Barbie pink still wasn't pink enough. `#ef6b81`→`#ef6b97`→`#ef6bbf`,
    twin `#eb4561`→`#ea4079`→`#e82ba3`, the twin re-deepened each time so the
    mention floor keeps clearing (4.51→4.55→4.73). **Nothing reads the array by
    index**, so the order is presentation only.
  - **A photo colour is still pinned**, and that is the only reason the Photo
    option can touch a button: `glowNorm` pins a sample to HSL 0.55, right
    behind a wash and wrong under text (a saturated blue measures **2.30**
    against `--on-type`), so `bandFrom` pins it to L\* 74 and `heartsFrom` to
    53/74. Ink stays `--on-type` in both schemes for a sample.

**The boot splash TURNS, and the mark is Tria's rather than the reader's.**
`.splash-ramp` walks the four brand stops one position along its 115deg gradient
every second, so the whole band passes through the logo inside the curtain's
own life. It is **two elements** because CSS filters an element before it masks
it: the rise's blur sits on the outer `.splash-t`, so it blurs the finished
letters, where on the masked element itself the mask would cut them crisp again.
Two halves of the turn are worth keeping:

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

It **is** the per-frame repaint of a masked gradient that the old 2s loop
was removed for, and the cost is real. What makes it affordable is that it is
bounded where that one wasn't: one mark, one element, about a second and a half
before `dismissSplash` removes the node. If boot ever needs those frames back,
drop `.splash-ramp`'s animation and the mark falls back to the band at rest.

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

## Pinned cards, and what an album cover is worth

Up to three things a person holds above their own wall, between the identity and
the posts: a post they wrote, or the song they're on — and the song card is a
window on the listening status rather than a copy of it, so it is the same song
Discover's rail is showing (see [data.md](data.md)). **The panel is the daily card's** — plain glass, `--glass-bg-panel`,
the same corner and the same lift — because the two are the same object in the
app's grammar: one thing the page wants you to read before it hands you the rest.
They are declared separately anyway, and that is the difference worth naming: the
daily is ONE headline on Discover and can afford a serif question at 1.95rem;
this is a STACK of up to three on a page that already opened with a photograph
and a name, so the voice steps down and the height is fixed.

**The fixed height is load-bearing twice.** It makes three cards read as a set
rather than three unrelated blocks, and it is what makes the drag exact — every
card displaces every other by one card plus one gap, so a reorder measures the
rects once at the lift and never guesses.

**The card's edge is the page's axis**, which is the daily card's arrangement and
not the account block's. It shipped with `--inset` of its own padding on top of
the view's, which set the stack a further 26px in on each side and made three
cards that are the page's headline the narrowest thing on it. The type inside a
card is inset by the card's own padding — that is what a card is for; the box is
not.

**The panel is flat, and it is the flat cards' material** — a `--surface` fill
and a `--rule` hairline, no blur, no rim, no lift, the same as `.week-card`,
`.daily-card` and a quote's nested tile. It was glass until 2026-09-18, which
by then made it the last card in the app still wearing the old vocabulary; one
page showing both read as two apps. The bill argues the same way the daily
card's did — a blur costs area × radius × moving frames, and three of these
scroll behind a wall of photographs.

**Three things did not go flat with it**, because each was doing a job rather
than being a finish: a song's bloom (`.pin-glow`, which paints between the fill
and the words and so needed no change at all), the square's drop shadow, and
the shadow a card throws while it is HELD (`.pin.is-lifted`) — that last one is
the whole feedback of the hold-to-move gesture, the card leaving the page.

**The held card's shadow is two layers, because a lift reads differently on
paper and on ink.** The drop does the whole job on light paper and almost none
of it on dark, a black shadow on a near-black page being a shadow nobody can
see — and taking the glass out took `--glass-rim` with it, which turns out to
have been the only thing saying "up" in dark mode. So a lit TOP EDGE rides in
front of the drop, and deliberately not the four-sided rim that went: it is
`.pin-cover`'s inset at `.pin-cover`'s value, already the app's way of drawing
an object lying ON something. One declaration, no `prefers-color-scheme` block,
invisible on paper where the drop is talking and legible on ink where it isn't.

**The panel carries no colour of its own.** A filled coloured panel is the app's
one filled-object vocabulary and means "press this to make something", so a
hue-filled pin would read as an enormous button that isn't one — the same rule
the daily card spent 1.3 learning. The type pastels survive only as the backstop
behind a photograph that hasn't decoded, and as the mark on the picker's rows.

**What a card DOESN'T carry, and it is most of what it started with.** No caption
over the stack, no type word over the title, no glyph tile for a post with no
picture, and no empty slot inviting a third pin:

- **A card is already a card.** "Pinned" above three cards was the page
  announcing its own furniture, which is the rule the caps subheadings died for.
- **The type word said Song / Note / Frame over a card that is visibly one**, and
  three of them stacked read as a form with three labelled fields. The one
  sub-line that survived — an artist, a domain, a date — says something the card
  doesn't already show, and sits UNDER the words where it annotates rather than
  announces.
- **A glyph on a pastel tile is a mark saying "this is a Note" beside a note.**
  A post with a picture shows the picture, at the size an album cover sits at; a
  post without one is its own words, across the whole card, with a third line of
  clamp because the words are all there is.
- **An empty slot is furniture standing where content isn't**, on the one page
  that is about a person rather than about the app. The way to fill one is a row
  in the profile's own ••• beside Edit profile — which is also the only place a
  SONG pin can be started, since a song has no ••• of its own the way a post
  does. The row is absent at three: swapping is a decision about a particular
  thing, and it is offered where that thing is.

**Every card is exactly one height, and it is derived rather than typed** — the
square, plus the padding either side, plus the hairline either side, with a
square-less card meeting the same number through its min-height. Nearly equal is
not equal: the drag displaces by one card plus one gap, so 2px of drift per card
is 2px the dropped card lands out by.

**Every image in a pin card is treated as an object, not as content** — a song's
art and a photo's alike get three things a thumbnail doesn't:

- **A drop shadow and a lit top edge**, no hairline. A border draws a picture
  printed into the card; a shadow draws it as a thing lying on it. Flattening
  the panel under it left this untouched on purpose — a `--surface` card is a
  cleaner ground for the drop than a blur was.
- **A sheen** — one soft diagonal highlight stopping at 58%, the light a glossy
  surface catches. It is a highlight, not a scrim: past 58% it would start
  greying the picture it is meant to flatter.
- **The picture's own colour, on the card**, by two different routes. A song's
  art is hotlinked from Apple's or Spotify's CDN, so CSS may blur it but canvas
  may not read it (touching the pixels taints the canvas) — a blown-up, blurred
  copy sits over the card's fill and is MASKED OUT before it reaches the words.
  The mask is not decoration — it is what lets the cover end of the card bloom
  while a serif title stays on a clean surface. A card paints its background
  first and its negative-z children straight after, so the bloom sits over an
  opaque `--surface` exactly as it sat over glass. A post's photo is our own upload, so
  blurring a full-size copy behind an 88px card is real work for a colour
  already known: it glows from its stored `tint` instead, one flat colour
  computed at publish time.

**AND THE BLOOM HAS TO CLIP ITSELF.** It runs 40px past the card on every side so
the blur's own soft edge falls outside, and `overflow: hidden` on the card does
NOT hold it: WebKit will not clip a composited child — this one has a filter —
against an ancestor's border-radius, so the bloom filled the square corners while
the card's rounded edge showed through it. Measured in the simulator and
reproduced in Playwright's WebKit, which is the fast way to see it. The fix is a
`clip-path` on the bloom itself, back to exactly the card's rounded rect, using
the same number the bleed uses. A `clip-path` on the CARD fixes it too and takes
the lift shadow with it, since clip-path clips everything an element paints.

**No grip mark, and nothing teaches the gesture.** A handle beside the ••• is two
controls on an 88px card doing one job each, and the caption that used to say
"hold to reorder" went with the rest of the furniture. What carries the fact is
the ••• itself: Move up / Move down sit in it, which is where somebody looking
for a way to reorder will open first, and is the only way to do it with a
keyboard. The drag is the shortcut for people who try it.


## Discover's first screen, and what a fixture costs

Discover opens with furniture above the grid, and the grid is the meeting. This
is the arithmetic of how much furniture, measured at 402×874 with a populated
room (the usable window between the bars is **741px**):

| | height | |
|---|---|---|
| masthead "Discover" | 59 + 37 in gaps | 60→156 |
| daily card | 146 + 32 | 156→334 |
| On repeat | 165 + 18 | 334→517 |
| the grid | whatever is left | 517→801 |

**Three fixtures was one too many, and the app's own notes had already said so.**
The rule above `lastDailyFor` in app.js — written when Manifest Monday came back
out — sets a budget of one scheduled card and warns that *"three of them push
that grid off the first screen entirely."* That was about a second CARD, but the
arithmetic never cared: the page shipped a daily card, a listening rail and a
trending strip, the grid opened at 601px, and it had **27% of the first screen**.
The [NN/g scrolling study](https://www.nngroup.com/articles/scrolling-and-attention/)
puts 42% of viewing time in the top 20% of a page; on this page that was three
pieces of app furniture and no room.

**The tags left because they are the only fixture that isn't content.** They are
an INDEX, and the act one performs is a search, so they went inside the open
search field — top of the body, above the results, absent until asked for. The
grid opens at 517px now, **38%**, which is two full tile rows instead of one and
a bit. Order was never the problem: the daily card was already first.

**The rail was the other half, and its defect was that its height wasn't its
own.** A song title clamped to two lines, so the strip stood 165px tall when
every title fit and 181 the moment any one wrapped — one long song title in your
circle moved where the page's contents began. Worse, a wrapped title pushed only
ITS name down, so the row of names stopped being a row (six squares up: five
names at y=478, one at 494). One line each, ellipsised. The square identifies the
record; the words underneath only name it.

**What was considered and not done.** Shrinking the art (80px is the documented
floor, and 76 buys 8px for a swatch); dropping the type entirely, which reaches
45% and looks superb, and turns the rail into a row of anonymous squares — the
one thing in it that is social is *who* is playing *what*. And putting the rail
above the card, which is the opposite of right: the card is the only thing on
this page with a deadline.

**The rail stays taller than the card (165 to 146) and that is fine.** Height is
a weak signal between objects of different material. The card is a floating glass
panel with the page's one serif headline and its one filled pill; the rail is
flat contents under a caption. What made the rail win the first glance was the
three together — bigger, the only saturated colour above the fold, and ragged.
Two of those are gone.
