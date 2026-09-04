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

**The wordmark is signed-out only.** `.brand` is gone from `index.html`; the one
place a wordmark still earns its space is `.auth-topbar` on the front door, where
there is no page identity to show instead. It was also the only signed-in link to
About, so **About is a row in the ••• sheet on your own profile** — which matters
more than a colophon would, because the feedback form is there and it is the only
way to report a bug.

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
  reader find out at the foot of the form.
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

**That last one holds for a card WE draw, and 1.4 found the edge of it — for one
of the three.** In the app the colour ring still drops a real `UIMenu`, and the
system flips it, scrolls it and clips it to the safe area itself, so the "lands
anywhere" objection, which is an objection to our positioning code, simply is
not true of its own. The ••• and the repost circle tried the same move and went
back: as of 2026-08-30 `openPostMenu` and `openRepostMenu` build their array and
hand it straight to `openSheet`, same as the audience picker always has, with no
native branch. See "A menu the page asks for" in
[native-chrome.md](native-chrome.md), including what the colour picker gave up
for it.

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
- **`--pill-alpha` (0.85) is a CONTRAST FLOOR, not a style knob.** `--on-type`
  rides this fill and translucency composites the button against the page, so
  dark paper is the hard case. Measured across the four brand stops and all
  eight palette accents: worst pair is **6.04** at 0.85, **5.45** at 0.80,
  **4.91** at 0.75. That worst pair is a **reader's accent**, not a brand stop —
  the brand ramp is bright and measures 8.38 at its own worst, while an accent
  is pinned to L* 74 and is the deepest thing this fill ever carries. The margin
  is **wider** than the 5.51/4.98/4.50 this note used to record, because accents
  are normalised to one weight now and the palest and deepest measure the same;
  0.85 stays for how solid a primary button reads, not because 0.75 fails.
  Deepening `BAND_LSTAR` is what would bring the cliff back — that number and
  this one draw on the same account.
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
order; only the travel between them changed. It sits behind
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
readers, nothing left to drift. The `.splash-t` boot mark is the deliberate
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
  - **`--user-ink` is stamped in the same call as `--user-band`** and is absent
    for every chromatic band, which is not an omission — an accent and the brand
    ramp both want the near-black `--pill-ink` already falls back to. A light
    glyph arriving a frame after a light band is a **+** you cannot see, on
    every route.

- **Three palette accents have moved OFF the quintet, and that decoupling is
  the point.** A palette's job is nine choices a reader can tell apart; the
  quintet's job is five type identities. Where those disagreed the palette lost:
  measured, cyan sat **20.8°** from ocean — closer than the band's own **32°**
  sweep, so their gradients overlapped and each ended partway through the other
  — and rose's red end came within **6.7°** of coral's pink end. Cyan
  `#9fd6e8`→`#88e4f2` (hue 194.8→188), ocean `#8fb4ea`→`#5f95f2` (215.6→218),
  rose `#ea86ae`→`#ea8696` (336→350; rose has since moved again, to `#ea7b8e`,
  and split off Ruby — see the declared-band note below). **`--type-photo` and
  `--type-poll` are untouched**: a Photo card is still cyan and a poll still
  rose.
  - **Ocean's hue is 218 and not 228, and that took two goes.** It first went to
    228 to buy clearance from cyan, and 228 plus the arc lands the last stop at
    **239** — where R catches G and the band turns violet, on lavender's
    doorstep. That check is that cheap: while **G leads R** the eye calls it
    blue, and it holds at every depth ocean has been drawn at (the +11 stop was
    `#9baaef`, G ahead by 15, at the old L\* 74; it is `#7990f4`, G ahead by 23,
    at today's L\* 65 — lavender correctly runs negative throughout). 8° of
    clearance from cyan is enough because two bands read from their centres, and
    those are a turquoise and a blue. **What this
    note used to say is that ocean's depth came from *saturation*,** which was
    making the best of a lever that doesn't reach: under the inherited recipe a
    hex's lightness is discarded and its saturation clamped, so ocean's deep hex
    bought a deeper profile *wash* and a button identical to everyone else's.
    It declares its own band now.
  - **`BAND_ARC` is 11°, down from 16.** Hue moves alone were not enough — the
    blue-green quarter holds four accents in 97°, and at ±16 they need 128. At
    a 22° span every neighbour clears, the tightest being coral→amber at 22.9
    and rose→coral at 24.7. Widening it re-opens both.
  - **A hex's LIGHTNESS now only decides the wash.** The band re-pins L\* and
    clamps saturation, so a brighter hex buys a brighter *profile page* and an
    identical button. That is what caps cyan: at HSL l 0.80 it was a lovely
    swatch and took `--wash-ink-soft` on a dark profile to **4.40**, under AA.
    0.74 measures 4.58, beside lime's 4.65. Re-measure that ink, both schemes,
    if a palette hex ever moves again.

- **A reader's accent is pinned to a perceptual weight, and that one change
  fixes the band AND the heart.** `BAND_LSTAR` = **74** (`bandFrom` in app.js).
  Both were pinned in **HSL lightness** before — 0.78 for the band, 0.52/0.78
  for the heart — and HSL lightness is not perceptual: the same 0.78 lands
  lavender at L\* 71.7 and lime at **L\* 89.0**, nearly white, because the eye
  reads green as far brighter than blue at equal HSL L. So the eight accents
  were spread over 17 points of real lightness on the buttons and **43** on the
  hearts. Pinning L\* levels them, and level is what lets the set move at all.
  - **74 is a settlement.** Two versions shipped for an afternoon each: the old
    pale 80.5 and a deep 68. 68 read as a different app's button rather than as
    Tria's in a colour. The floor is real but lower: measured across all eight
    accents and every hue on the wheel, `--on-type` gets **6.01** at L\* 74,
    **5.05** at 68, **4.62** at 65, **4.33 — a fail** at 63, with the binding
    surface the **thinned** one on dark paper (the FAB is opaque and never the
    hard case). Deeper than 68 needs a lighter ink, which is a second ink rule.
  - **The lime heart was invisible, and that is what "cohesive" was about.** At
    HSL 0.52 the accent hearts ran L\* 37.0 (lavender) to **80.2 (lime)**, and
    lime measured **1.3** against `#edeef0` — picking Lime turned your likes
    off. Pinned, every accent measures **3.46–3.50** on paper and **9.37–9.43**
    on ink, both inside the per-type hearts' own ranges (3.02–4.04 and
    7.73–12.63), so an accent heart sits where a type heart sits.
  - **In dark mode the heart IS the band's weight.** `HEART_LSTAR_DK` is
    `BAND_LSTAR` by reference, not by a copied number — measured, the dark heart
    and the band's mid stop land within **0.1 L\*** for every accent. Light
    can't join them (a mark at 74 vanishes into paper, which is the bug above),
    so it drops to `HEART_LSTAR_LT` = **53**, the per-type hearts' mean.
  - **THREE ACCENTS DECLARE THEIR OWN BAND, and 74 governs the other six.**
    The palette is **nine**, because rose split into **Ruby** (L\* 65) and
    **Rose** (L\* 72); **Ocean** joined them on 2026-08-24 at L\* 65. All three
    wear the **same near-black `+` as every other accent** — 65 is the floor
    where `--on-type` gives out, and both deep ones stop exactly there. Ruby
    spent a day at L\* 42/44 with a white `--user-ink` and came back up: one
    glyph colour across the whole palette is worth more than one deeper red.
    Rose is at 72 rather than 65 because the two hexes are **1.1° apart** and a
    band re-pins lightness *and* chroma, so at a shared 65 they painted
    `#f47ba5` and `#f47ba6` — the same colour twice. Depth is the only axis
    left to separate them on. An `ACCENTS` entry may carry
    `band: {lstar, sat}`, which
    **replaces** the derivation rather than capping it — the old `sat` clamp is
    a ceiling, so `min(0.85, a duller hex)` silently hands back the hex and
    paints the band you didn't ask for. Absent, which is the other six and
    every sampled photo colour, is exactly the behaviour above, so **moving 74
    still moves the palette.** Why it had to exist: at L\* 74 every red is a
    pink, and that is a *lightness* fact — at 74, saturation .72 → 1.0 moves
    OKLCH chroma .096 → .125 and still paints `#ff98aa`. **65 is the bottom of
    the palette**, and going under it means leaving the set — see below.
  - **A declared band has TWO landing zones and nothing between them, and the
    OPAQUE FAB is what makes the gap uncrossable.** The near-black ink is
    bounded from below by the thinned fill on **dark** paper; a white ink is
    bounded from above by the FAB, which has no scheme to vary with. Measured at
    ocean's hue: near-black holds to L\* **65** (4.68) and fails at 64 (4.48);
    white doesn't clear the FAB until **48** and the light thinned fill until
    44. So an accent is a deepened pastel at ~65 or a gem at ~44, and **nothing
    lives in the lower zone today** — `--user-ink` stays wired end to end
    (`ACCENTS` `ink` → `paintBrandBand` → `--pill-ink`) because it is the only
    thing that makes that zone reachable, but no accent sets it. **And there is
    no per-scheme ink to bridge it** — the natural answer in the gap is
    near-black on light paper and white on dark, but at L\* 52 the FAB measures
    3.85 against the near-black and 3.96 against the white, so a glyph that
    flipped by scheme would fail on that button in *both*. One ink per accent is
    what the FAB permits, not a shortcut. Final: ruby 4.65 / 6.90 / 6.06, ocean
    4.68 / 7.08 / 6.09, rose 5.69 / 8.39 / 7.55 (thin-on-dark, thin-on-light,
    opaque FAB).
  - **The hex and the band have fully parted, and the hex is now tuned for the
    WASH.** A declared band takes lightness and chroma from the recipe, so rose
    `#ea7b8e`, ruby `#c32842` and ocean `#5f95f2` exist only for `.ambient`
    (which paints them straight) and `heartsFrom`. They look duller than the
    bands they produce, and that is correct — don't "fix" a hex to match its
    button. **Ocean's hex deliberately did not move** when its band deepened,
    so its profile page stays the blue it has been and its wash figures are the
    ones already measured. Two costs, both
    accepted: **a deep band no longer matches its own heart on dark paper**
    (`HEART_LSTAR_DK` stays 74 and a band at 65 is nine points off it — a heart
    that followed a band down is the lime-heart bug in red, which is the worse
    failure), and **`app.css`'s 5.89 wash-ink figure was measured
    over eight accents** — ruby is the deepest hex the wash has ever carried
    (L\* 43.5 against a previous floor of ocean's 61.9) and is **not**
    re-measured there; the note beside it says so and names the lever.
    Ruby's key is new, so an older client falls through to the brand ramp;
    **rose keeps the key `'rose'`** so everyone who already picked it lands on
    the rose above rather than on nothing, and ocean keeps `'ocean'` so an older
    client just paints the light blue it already knows.
  - **The swatch grid is ROYGBIV, 3×3.** `ACCENTS` is sorted by hue from the red
    end — 350 · 15 · 40 · 83 · 158 · 188 · 218 · 255 — which deals warm / green
    / cool as the three rows. Ruby and rose are 1.1° apart, so depth breaks that
    tie and the true red leads the pink. **Nothing reads the array by index**
    (the picker maps it; everything else goes through `accentOf` on the stored
    key), so the order is presentation only and free to change.
  - **It is also the only reason the Photo option can touch a button.**
    `glowNorm` pins a sample to HSL 0.55 — right behind a wash, wrong under
    text, where a saturated blue measures **2.30** against that ink. Neither
    source is trusted; both are pinned here.

**The boot splash TURNS, and the mark is Tria's rather than the reader's.**
`.splash-t` walks the four brand stops one position along its 115deg gradient
every second, so the whole band passes through the glyph inside the curtain's
own life. Two halves of that are worth keeping:

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

It **is** the per-frame repaint of a text-clipped gradient that the old 2s loop
was removed for, and the cost is real. What makes it affordable is that it is
bounded where that one wasn't: one glyph, one element, about a second and a half
before `dismissSplash` removes the node. If boot ever needs those frames back,
drop the second animation and the mark falls back to the band at rest.

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
the posts. **The panel is the daily card's** — plain glass, `--glass-bg-panel`,
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

**The panel stays plain glass and the hue lives in the square.** Each pin's
leading 88px square wears its type's pastel with the type's own glyph in the ink
twin; the card behind it does not. That is the same rule the daily card spent 1.3
learning: a filled coloured panel is the app's one filled-object vocabulary and
means "press this to make something", so a hue-filled pin would read as an
enormous button that isn't one. A song has no type colour at all, because the
album cover is the colour.

**The album cover gets three things a thumbnail doesn't**, and this is the one
place in the app where an image is treated as an object rather than as content:

- **A drop shadow and a lit top edge**, no hairline. A border draws a picture
  printed into the glass; a shadow draws a sleeve lying on it.
- **A sheen** — one soft diagonal highlight stopping at 58%, the light a record
  sleeve catches. It is a highlight, not a scrim: past 58% it would start
  greying the artwork it is meant to flatter.
- **The record's own colour, on the card.** A blown-up, blurred copy of the same
  artwork sits over the card's glass and is MASKED OUT before it reaches the
  words. The mask is not decoration — it is what lets the cover end of the card
  bloom while a serif title stays on clean glass. And the blur is the whole
  trick: the artwork is hotlinked from Apple's or Spotify's CDN, so CSS may blur
  it but canvas may not read it (touching the pixels taints the canvas), which
  means this needs no colour column, no sampler and no second request. A photo
  post gets the same bloom from its stored `tint` instead — one flat colour we
  already computed at publish time, rather than blurring a full-size upload
  behind a 110px card for a colour we know.

**No grip mark, and the kicker teaches the gesture instead.** A handle beside the
••• is two controls on a 110px card doing one job each. Your own stack's caption
reads "Pinned · hold to reorder" while there is more than one card, and the •••
carries Move up / Move down for anyone who never tries the gesture — which is
also the only way to reorder with a keyboard.

