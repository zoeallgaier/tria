# 1.4 — the chrome goes native

**The subject of 1.4: Tria's navigation stops being CSS pretending to be Apple's
and becomes Apple's.** The bottom tab bar, the top bar's buttons and the compose
**+** are drawn by UIKit, in the system's own material, around the webview that
still draws every page. So are the three pieces of chrome that hold a caret: the
bottom bar in both of its jobs — a post page's comment bar and a circle's find
bar — and Discover's search. The web keeps the CSS chrome it has
([shipping.md](shipping.md)), unchanged.

## Why native rather than a better CSS skin

`backdrop-filter` is a blur. Liquid Glass is refraction, a specular response that
tracks the content moving underneath, and a set of morph animations the system
runs when a bar changes state. A CSS bar can be thinner or deeper or better
tuned; it cannot bend what is behind it, and it cannot animate the way the system
does. It also cannot *keep up* — the material tracks OS releases, Dynamic Type,
Reduce Transparency and Increase Contrast on its own, and every one of those is a
thing our CSS has to be told about by hand.

There is a second, cheaper reason: a real `UITabBar` is the control readers
already know. The gestures, the accessibility tree, the VoiceOver rotor, the
"tap the tab you're on" convention and the Dynamic Type behaviour all arrive
free and correct.

## What goes native, and what must not

**Native:** the bottom tab bar (the four destinations), the compose **+**, the
top bar's leading/trailing controls, the bottom bar in both of its jobs (a post
page's comment bar and a circle's find bar), and Discover's search field.

**Also native, and this moved the line below:** the page's own PRIMARY ACTS —
the auth gate's submit and **Share Tria** at the foot of Discover. The
composer's **Share** pill and the daily card's **Add yours** were in this set
too until 2026-09-19 and are painted CSS again, because both sit ON glass and a
lens over a lens flattens. See "The page's own primary acts" near the end of
this file for the whole argument, including what made a native control in
SCROLLING content possible when it wasn't before.

**Not native, ever:** content. Cards, the feed, the composer form's FIELDS, the
post page, and the sheets that belong to a *page* rather than to a control — a
confirmation, a list of report reasons. Tria is a web app in a webview and 1.4
does not change that — it changes who draws the frame around it.

That rule used to say "the composer form" whole, and the buttons above are
the correction rather than an exception to it. The rule was always about what a
reader READS — cards, prose, fields. It was never about the one button on a page
that COMMITS, and the post card's ••• had crossed the same line for the same
reason for a while (see "A menu the page asks for" for where it stands now).
**The set is closed:** `PAGE_SEL` in app.js is a list of selectors, not a rule
about buttons — and it only ever gets shorter.

It has already been tested once and held. Editing a post moved onto the post's
own page in 1.4, and the old inline form's Cancel/Save pair was exactly the shape
this list exists for — a painted commit at the foot of a form that SCROLLS. It is
not another selector, because an editor's two answers belong on the BAR, where
they hold still over a scrolling form and where they are native by the toolbar's
own path: a back chevron that becomes an X once a word has changed, and a check
that fades in to meet it, which is the arrangement the profile editor has worn
since 1.3. A page with one act gets a page button; a page with an act and a way
to abandon it gets a bar.

A MENU IS NOT CONTENT, wherever the control that drops one happens to sit. That
line moved once, deliberately, for three page controls: the post card's •••,
the repost circle and the profile's colour ring. All three went back to the
sheet, the same one every other page-owned control (with no bar to belong to)
has always raised: the ••• and the repost circle on 2026-08-30, the colour ring
on 2026-09-10. Edit profile's music pick is the page control that still drops a
native menu, for the reason in "A menu the page asks for" below.

THE COMMENT BAR IS CHROME AND IS ALSO THE ONE EXCEPTION TO "native wears the web
control's face". Everything else here works by drawing over an element that is
still the implementation of itself: a tap crosses back and clicks it. A field
cannot be borrowed that way — a hidden element is not focusable, so there is
nothing to click, and the keyboard an iOS webview raises for a web field is
positioned against the webview while this bar's whole job is to sit on the keys.
So the field is real UIKit. The MODEL is still the web's, in the strongest sense
available: every keystroke is written back into the textarea that is still in the
DOM, which fires its own `input`, and the mention picker, the send disc's idle
state, the 300 cap, `Store.addComment` and every error path run unchanged. See
"The comment bar" below.

**Discover's search is the same exception for the same reason.** So is the find
bar, which is the comment bar's own class doing its other job — see "The find
bar, which was left out and should not have been" below. All three also had to be
given something every web field gets for free: a way DOWN off the keyboard. See
`TriaKeyboardDismisser`.

**Staged, in this order**, because the bridge traffic grows steeply:

1. **The tab bar.** Four fixed destinations, one selected index. Almost no state.
   **Landed.**
2. **The FAB.** One button, one action, plus the speed dial — which may stay web
   (a veil over a frozen page is a page thing) with only the button native. The
   dial is retired anyway (the composer surfaces every type on one form), so the
   + is a plain route and this was one button. **Landed, with 1.**
3. **The top bar last.** It carries the most per-page state in the app: a
   collapsing title measured against the page's own `<h1>`, a search field that
   grows out of a button, the filter dial, the editor's conditional commit check.
   Every one of those is a contract, and each is cheaper to get right once the
   two below are proven. **Landed, as the CONTROLS and their menus.** The bar
   itself is still CSS and that is a decision, not a remainder — see "What the
   top bar kept" below. `--native-chrome-top` is therefore unstamped and unneeded:
   the web still draws a bar of exactly the height it always reserved.

## The plugin

A Tria-owned Swift plugin, in the **app target** — `ios/App/App/`, beside
`TriaSettingsPlugin.swift` — not a node module. `CapApp-SPM/Package.swift` is
CLI-managed ("DO NOT MODIFY — managed by Capacitor CLI commands") and
`capacitor.config.json`'s `packageClassList` is regenerated by `ios-sync.sh`, so
an entry added to either is overwritten on the next sync. Register it by hand
from `TriaViewController.capacitorDidLoad`, the way `TriaSettings` already is.

**And note what that costs: `verify-plugins.sh` cannot see it.** That script
reads `packageClassList`, so it covers every CLI-installed plugin and none of
ours. An app-target plugin that fails to compile in is exactly the missing-push
failure — no build error, no crash, one line in the device log at the moment
somebody taps — except this time the thing that is missing is the app's
navigation. Hence the fallback rule below, which is not defensive tidiness but
the whole safety net.

## The contract

**Native is a RENDERER, not a second model.** `js/app.js` stays the single source
of truth for what page you are on and what the bar carries. Native is told; it
never decides. Two things disagreeing about where the reader is, one of them
holding the history and the other holding the highlighted tab, is the bug this
rule exists to make impossible.

The vocabulary is the router's own — routes in, taps out. Native must never
learn what a "Discover filter" or a "daily" is.

- **JS → native:** `setTabs({ tabs: [{route, label, icon}], fab })` — which also
  mounts the bars on its first call and resolves with the geometry below;
  `selectTab({route})`; `setFab({fab})`, for when the reader's accent changes;
  `setDots({dots})`, a map of route to resolved colour where an EMPTY colour is
  "no dot" and a route left unnamed keeps whatever it had (see "The dot");
  `setChrome({visible, fab})`, where `visible` takes the whole chrome away (the
  post page, the way `body.postbar-live` already does) and `fab` alone tucks the
  + (the composer, `.nav--compose`). `setToolbar({bar})` states the top bar
  whole: `{live, holdHeader, height, title, controls, search}` — `holdHeader`
  says whether this route keeps its header once you are off the top or hands it
  back only on a scroll up (see "What the top bar kept"); `height` sizes the
  material and `title` is the collapsing small title, drawn natively since the
  material went glass (see "What the top bar kept"). Whether the material is
  PAINTED does not cross: native reads the scroll itself., each control
  `{id, kind…, x, y, w, h, glyph, ink, colors, tint, text, after, hidden, menu,
  label}` — a band arrives as EITHER `tint` (one colour, for the material's own
  `tintColor`) or `colors` (every stop, for a gradient under it) or neither, and
  never as both; see "The + is TINTED GLASS" for which band gets which,
  and `search` Discover's field: `{live, focus, x, y, w, h, closedX, closedY,
  closedW, closedH, fieldLeft, fieldRight, closeSize, closeRight, text,
  placeholder, label, closeLabel, closeGlyph, ink, caret, muted}` — two boxes,
  shut and open, because native animates between them on its own clock (see
  "Discover's search"). `menuReady({token, items})` answers a menu the system is already
  presenting; `presentMenu({label, rect, items})` asks for one the page has
  already built, and resolves with the token its pick will carry. `dismissMenu({})` takes an anchored menu down because the card
  it hangs off has moved out from under it, and is a no-op on a menu that has
  already gone.
  `setPostBar({bar})` states the bottom bar whole, in whichever of its two jobs
  it is doing —
  `{live, kind, width, float, floatKeyboard, pad, fieldPad, line, maxLines,
  radius, faceLeft, faceTop, faceSize, textLeft, textWidth, discSize, discRight,
  discBottom, text, placeholder, label, maxLength, sendLabel, ink, caret, muted,
  returnKey, caps, correct, spell, colors, tintAlpha, edge, edgeWidth, glyph,
  glyphSize, discInk, faceGlyph, faceLabel, leadGlyph, initials, avatarBg,
  avatarInk, photo}` — where `kind` is `comment` or `find` and is the only branch
  on this bridge that is not a measurement, and `live: false` is what takes the
  bar, and the keyboard, away on a navigation.
  `setPostBarText({text, selection, focus})` writes back into a field the web
  does not draw.
- **Native → JS:** the `chromeTap` event carries the route and JS calls the same
  **two** things the CSS nav calls: `go('#/…')` for a different destination, and
  `reclick` for the tab you are already on. Both, not just the first — `reclick`
  hangs off a click listener on `#nav`, which this shell hides, so a native re-tap
  used to fall through to `go()`, see an unchanged hash, re-run `route()` and
  restore the scroll it had just come from. A tab that visibly did nothing. (See
  [navigation.md](navigation.md) for what the gesture is.) No second navigation
  path either way, and native does not move its own highlight — that comes back
  around through `selectTab` once the router has landed. `chromeMetrics` carries a new measurement. `toolbarTap`
  carries a control's id, and JS clicks the web element it stands for — so the
  page's own handler is still the only implementation of what that button does.
  `toolbarMenu {id, token}` is a menu asking what is in it; `toolbarPick
  {id, index}` is the row that was chosen. `menuPick {token, index}` is the same
  answer for a menu the page asked for. The comment bar's five: `postBarText
  {text, selection}` on every keystroke and every caret move, `postBarSend {}`,
  `postBarFocus {focused}`, `postBarDiscard {}` — the face tapped, the words
  already gone over there — and `postBarLift {lift}`, the window bottom to the
  top of the pill, which is the only figure that is right while a keyboard is
  animating under it. Discover's search adds three of the same shape:
  `searchText {text}`, `searchClose {}` (the X), and `searchBlur {}` (the caret
  put down some other way, which the web answers by folding an empty search and
  leaving a full one open).

`icon` and `glyph` are SVG MARKUP — the drawing itself, the same one the web
puts in the DOM. Markup is presentation, which is the only kind of app
vocabulary allowed across this bridge: native can draw a triad of circles
without ever learning it means Discover. A control's `id` is the web element's
own id and is equally opaque; it goes out on a tap and app.js decides what it
meant.

`mountToolbar` and the nav render keep their signatures; the native calls hang
off them rather than replacing them.

## Geometry

The two bars answer this from opposite ends, and the split is worth stating
because it looks inconsistent until you see what each one is standing in for.

**The bottom bar replaces a bar, so it measures and the web reserves.** Native
measures its own glass and hands the number back as a CSS custom property
stamped on `<html>` (`--native-chrome-bottom`); CSS reads the property and never
a hardcoded height.
**The top bar replaces the CONTROLS ON a bar that stays, so the web measures and
native follows.** app.js reads each control's `getBoundingClientRect()` and sends
it; native puts glass at that rect and owns no layout at all. A CSS pixel is a
point and the web view fills the host view, so a rect crosses unconverted. What
that buys is everything the top bar's stylesheet does that a Swift copy would
have to chase: two breakpoints, `env(safe-area-inset-top)`, a pill that gives up
padding at 360px, and a web font that changes that pill's width when it lands.
Nothing is stamped back, because the bar's height never changed.

Gate the web chrome off with an attribute — `html[data-chrome="native"]`, the
same shape `data-shell` already uses — so the CSS bars are *hidden*, not deleted.

Restate the gate on any override, for the reason
[design.md](design.md) records about the status-bar scrim: an attribute selector
carries specificity, and a bare class rule written later will quietly lose to
the baseline it was meant to beat.

## Availability, and the fallback that makes it safe

`IPHONEOS_DEPLOYMENT_TARGET` is **15.0**. The Liquid Glass material is iOS 26.
Building against the iOS 26 SDK is what gets a standard `UITabBar` /
`UINavigationBar` the new material without asking for it; a *custom* floating
control like the FAB needs `UIGlassEffect` in a `UIVisualEffectView`, which is
iOS 26 only. So:

- Runtime-gate with `if #available(iOS 26, *)`, never a deployment-target bump
  that drops readers.
- **Default is the CSS chrome. Native switches on only after the plugin has
  answered.** `data-chrome` starts unset; the plugin's first successful call
  sets it. A plugin that isn't in the binary, or an OS that is too old, leaves an
  app that navigates exactly as 1.3 did.
- Verify the material on a **device**, not the simulator, and against a
  **Release** build — the debug bridge replaces `window.console` and logs every
  call, so an Xcode build is measurably slower than what ships.

## What shipped, and what it is made of

`ios/App/App/TriaChromePlugin.swift`, registered by hand from
`TriaViewController.capacitorDidLoad` beside `TriaSettings`. `js/app.js`'s
`NativeChrome` module is the whole web side; `css/app.css` ends with the gate.

**It is not a `UITabBar`, and that is a decision rather than an oversight.**
Tria's bar has not been a full-width tab bar since the July 2026 nav overhaul: it
is a detached capsule of four icons with a round Post button breaking out beside
it. Adopting `UITabBar` would have meant adopting a different design, and 1.4 is
about handing the *material* to the system, not the layout. So the bar is a
`UIGlassContainerEffect` view spanning the bottom with two `UIGlassEffect`
elements nested in its `contentView` — the configuration the header calls for,
and what makes the pair render as one glass system rather than two unrelated
blurs that happen to be adjacent. Both elements are `isInteractive`, which is
where the press response comes from and why no touch handler adds one.

What that costs, stated plainly, because it is the case the doc argued the other
way above: the accessibility tree is built by hand (`.tabBar` on the capsule,
`.button` + `.selected` per disc, `accessibilityLabel` off the route's own name,
since icon-only tabs have no visible label), and the icons do not scale with
Dynamic Type. That second one is parity rather than a regression — `.nav-ico` is
a fixed 28px on the web too — but it is the thing a real `UITabBar` would have
given free, and it is what to reach for if this ever needs revisiting.

**The glyphs are drawn, not imported.** `TriaSVG` renders the same markup
`ICONS` holds in app.js — see the renderer's own section below. SF Symbols were
cheaper and wrong: the material is what goes to the system, not the identity,
and Tria's Discover mark is a triad of circles that no symbol in the library
says.

**The + is TINTED GLASS, and it is the one place the native chrome departs from
the web on purpose.** On the web this disc is the one OPAQUE member of the
primary-act set, and both reasons for that are CSS reasons that dissolve here
rather than being overruled: a translucent fill in CSS composites against a
*sharp* backdrop, so thinning it would show live content sliding through the
app's most permanent object — and the `backdrop-filter` that would soften it is a
per-frame bill on a control that is up on every route over a scrolling feed,
which is the cost floor CLAUDE.md refuses everywhere. Liquid Glass answers both.
The material refracts and diffuses what is behind it, and the system draws it
rather than us.

**The band has THREE forms and the material takes a different one of each.**
`bandFill` in app.js sorts them, off the resolved stops rather than off which
accent is live, and sends the answer as a shape: a `tint`, a `colors` array, or
neither. `TriaBand.apply` in the plugin is the whole of what Swift does with it.

**`fab` also carries `tabTint`**, which is the LIT TAB's colour and is not the
same key as the +'s own `tint`. They were one key while the + still had a bare
state; they parted when it stopped having one. See "The + does not wear Tria's
band".

1. **A reader's ACCENT is one colour**, three stops eleven degrees apart around
   its hex (`bandAround`), and the middle stop, the one that crosses, is the hex
   itself. So it goes to `UIGlassEffect.tintColor` and the system
   tints its own material — refraction, specular response, Reduce Transparency,
   Increase Contrast, all of it already answered and none of it ours. Nothing is
   lost, because the band was one colour before it crossed. Measured across all
   nine accents: hue spread 21.6 to 22.9 degrees, channel chroma 55 to 173.
2. **"No colour" is `--mono-band`, three greys** (chroma 3 to 12 across both
   schemes). A grey laid under glass is a smudge on a surface whose whole job is
   to be colourless, so it crosses as nothing at all and the button is plain
   glass. It also sends **no ink** — `--pill-ink` under this band is
   `--mono-ink`, a near-white built to ride a near-black fill, and there is no
   fill left to ride. Empty is what native reads as `.label`. **The + is the
   exception and takes this as a TINT**, which is the next section: what is a
   smudge here is three mid greys spread across a gradient, and a single strong
   neutral is not that.
3. **Tria's own ramp is four hues** (spread ~179 degrees) and no single colour
   states it. That one, and only that one, stays a gradient UNDER the material:
   a `CAGradientLayer`-backed view (`TriaBandRamp`) the control's exact size and
   shape, sitting as a *sibling below* the glass, thinned so the system still
   has the page behind it to bend. Every button that wears it is a CAPSULE. The
   round one turns it down and takes form 2 instead, which is the next section.

The thresholds are `BAND_GREY` (20 of 255) and `BAND_ONE_HUE` (40 degrees) in
app.js, and both sit at better than 2x margin against every real band.

Being a sibling is the ramp's one liability: nothing that moves the button
moves it. **Every button that wears the ramp inherits that**, and each pays it
in the one place it moves — `TriaToolbarButton` mirrors the frame in `update`
and the alpha and transform inside the idle animation's own block;
`TriaPageButton` mirrors the frame and the hidden flag on every scroll tick;
both override `removeFromSuperview` so a dropped control cannot leave a coloured
capsule behind on the bar. `hasRamp` exists so those paths never un-hide a
sibling that has no ramp to show.

### The + does not wear Tria's band

**It wears THE NEUTRAL instead: `--mono-band` tinting the glass, `--mono-ink`
riding it, the same + a reader who picked "no colour" gets.** Those two are
ink-side on paper and paper-side on ink, so one code path with no scheme test in
it draws a black + with a white glyph in light mode and a white + with a black
one in dark. An accent still tints it, because that is the case where one colour
has something to say and the material can say it. `bandFill` reports a `ramp`
flag beside the shape and `fabSpec` substitutes the neutral when it is set — the
flag rather than the stops, because Reduce Transparency has already collapsed
the ramp to a tint by then and that tint is Tria's middle stop rather than
anybody's pick.

**It used to send nothing at all** — plain glass, `.label` ink. That was right
about the ramp and wrong about the button: the one control that is up on every
route came out as the quietest thing on the screen, and the CSS fallback was
painting the neutral for the same reader on the same build, so one + had two
answers depending on which chrome you got. The web is in step now
(`.nav-publish` overrides `--pill-band` / `--pill-ink` in app.css's mobile
block, phone only — the sidebar's Post is a capsule and keeps the ramp), and
the inks (`--user-ink-lt` / `--user-ink-dk`, resolved into `--user-ink` per
scheme by tokens.css) are stamped on every branch of `paintBrandBand` rather
than only the monochrome one, so that override can tell "no band of their own" from "no ink of
their own" and never hands a picked accent the neutral's near-white glyph.

**And this is why `tabTint` is its own key.** The lit tab used to read the +'s
`tint`: an accent lit the tab, everything else sent nothing and the tab fell
back to `liveInk`. `tint` now says "neutral" where it used to say "nothing", and
a tab row inked with the neutral is a row inked with the paper's opposite —
which is what `liveInk` already is, said twice and free to drift. Only an accent
crosses as `tabTint`.

Verified on the simulator in both schemes, on real `UIGlassEffect`: the system
renders a near-black tint as a genuinely dark disc and a near-white one as a
genuinely light disc. It does not wash a neutral out the way the "a tint comes
out LIGHT in both schemes" measurement on lime might suggest — that figure is
about where an accent's own lightness lands, not about the material lifting
what it is handed.

**The reason is the shape, not the band.** A capsule is wide enough to travel
across: a linear gradient holds its first colour everywhere before its start
point and its last everywhere after its end point, so the two ends of the band
land on the wide flat ends of the pill and all four hues are on the button. That
is why the composer's Share pill reads, and it is unchanged. A 56pt disc has
nowhere to put the same four hues. On the phone it read as a smudge.

**Two fixes were built for it and both worked, and the button was still worse
than plain glass.** They are written down here because they are the obvious
things to try again:

1. *The circle only ever showed the MIDDLE of the ramp* — clipped to a disc,
   both endpoints fall in the corners the clipping removes, leaving the stretch
   between the second and third stop, which is where a four-hue band's hues sit
   closest together. Pulling both points to 0.39 of the radius from the centre
   (`(0.15, 0.33) → (0.85, 0.67)`, against the capsule's
   `(0.05, 0.28) → (0.95, 0.72)`) put the whole band on the disc. It was then a
   correctly drawn smudge.
2. *Held down, it came apart.* The ramp is a sibling below the glass, and
   pressing interactive glass lifts and deforms the MATERIAL while the effect
   view's own layer stays where it is — so a hard-clipped edge underneath has
   nothing to track, and the +'s colour sat still inside a disc that was moving
   over it. That was "holding it breaks the Tria option". A radial mask fixed
   it: opaque out to 0.86 of the radius, then to nothing at the rim, so there is
   no line for the glass to move away from. **That was the only available
   answer** — the deformation is drawn inside the effect and cannot be followed
   from outside it.

Both are out with the round path. The + is one button, up on every route over
everything the app draws, and it does not have to be the loudest thing on the
screen to say what it does. What it costs is a reader who picks Tria getting a
colourless + over colourful page acts, which is the one place this bridge draws
one band two ways, and it is a deliberate trade rather than the repaint bug
below. **If it ever goes back, it needs both fixes above and neither is
optional.**

**And the ramp is THINNED, which is what makes it read as glass rather than as
paint.** Painted opaque it is a wall: the material samples it, finds nothing
else behind it, and has nothing to refract or displace, so what shipped was a
flat coloured disc with a specular rim drawn round it — the tint doing all the
work and the glass doing none. That is the CSS failure mode arriving from the
opposite side, and it is not the same fault as attempt 1 below: there the
thinned layer was *above* the material and hid it, here the opaque one was
*below* it and starved it.

**The number is `TriaBand.rampAlpha` (0.55) and it is NOT `--pill-alpha`.** That
token is a contrast floor for a fill the *web* paints against the page; there is
no painted fill here, the material supplies the contrast and the system answers
the accessibility settings itself. What `rampAlpha` decides is only how much
page the glass has left to bend, which is a rendering decision about the
material and therefore lives beside it. It is the one knob to turn if the ramp
starts reading as paint again. (`--pill-alpha` still crosses for the comment
bar's send disc, which is deliberately not glass and does paint its band.)

**Measured in both schemes, on plain paper.** The figures were taken on the +
while it still carried the band — the roundest and hardest case — and what they
govern now is the capsules that still wear it: the Share pill, the gate's
submit, Share Tria, Add yours, the toolbar's CTA. Three of those five have TEXT
for a face, so 4.5:1 is the bar, not 3:1.

Light: the fill runs 0.49 to 0.73 relative luminance and the near-black
`--on-type` ink on it clears 9:1. Dark: the band arrives undeepened (the pastels
ARE their own `-ink` twins on dark paper, see tokens.css) and the material
darkens what it samples, so at `rampAlpha` 0.55 it landed at 0.155 to 0.207,
where that same near-black measures **3.5 to 4.4:1** — under the bar, and white
against it was no better at 4.08 to 5.12.

**Both halves moved, and this is the ADA fix.** app.js sends no ink for a ramp
(only a tint carries its own), so the label is `.label` and goes white on dark
paper by itself; and `rampAlpha` drops to **0.42** on dark paper, which takes
the fill to 0.100 to 0.131 and white on it to **5.80 to 7.02:1** — AA cleared,
AAA at the darker end. On light paper the band composites over near-white and
sits at 0.49 to 0.73 whatever the alpha is, so nothing there moved. An ACCENT is
untouched by both: the system draws a tint LIGHT in either scheme (0.638 to
0.644 measured on lime in dark mode), so it keeps `--pill-ink`, and a blanket
"white on dark" would have erased every accent's glyph.

**Reduce Transparency is answered in `bandFill`, not in Swift.** The system
draws glass SOLID under that setting, and a backdrop under a solid material is a
backdrop nobody sees — the ramp would simply vanish and every button wearing
Tria's band would go colourless on the one setting that cannot be previewed from
here. So under `(prefers-reduced-transparency: reduce)` even the four-hue band
crosses as its middle stop, which the material still draws. The sweep is what is
lost, and a sweep is the right thing to lose to an accessibility setting.

`NativeChrome` listens to that query, to `(prefers-contrast: more)`, and to
**`(prefers-color-scheme: dark)`**, which is the one that is not an accessibility
setting: the scheme changes the band's stops outright, native holds resolved
numbers, and `paintBrandBand` is memoised on the reader's identity, which sunset
does not change. Until the scheme was listed, a phone set to Automatic kept the
other scheme's colours on the native chrome until the next colour pick. The two
button caches key on the interface style for the same reason — `.label` is what
an empty ink MEANS, and it is two colours, so a cache that keyed only on the
(empty) string kept a black glyph after dark.

**WHAT WENT AWAY, AND DO NOT PUT IT BACK.** There was a `TriaBandRim`: the same
stops laid back ABOVE the glass as a 1.6pt lining at full strength, on the
argument that the material mutes what it samples. It does mute it. The lining
was still wrong, for a reason that outranks the observation — **a colour drawn
on top of Liquid Glass sits above the specular layer the material draws last**,
which is the one thing the material asks you not to do. What shipped was a
sticker with a rainbow outline, most obviously on the wide pills (Zoe's word for
the Send feedback button was that it looked like a swatch). The muting is
answered instead by not handing the material four hues when the band only has
one: an accent tints the glass and comes out at full strength on its own.

**Three things were tried before that and all three are worth not repeating.**

1. *A thinned band laid over the glass*, at `--pill-alpha`: an opaque-ish layer
   in the `contentView` hides the material entirely, so what you get is a
   slightly see-through disc with page text ghosting through it — the CSS
   failure mode wearing the native button's clothes.
2. *`UIGlassEffect.tintColor` for EVERY band*, which shipped for a while. It is
   one colour, so Tria's four-hue ramp arrived as the hue at its centre. Note
   what the answer above is and is not: the tint came back for the bands that
   ARE one colour, and the ramp stayed for the one that is not. The mistake was
   never the tint, it was paying its price on a band that could not afford it.
3. *A multiply blend* — `compositingFilter = "multiplyBlendMode"` on a layer
   inside `fab.contentView`. **It renders nothing, silently.** Not because
   `compositingFilter` is macOS-only (the CAFilter names do composite on iOS);
   because a `UIVisualEffectView` composites its `contentView` as an isolated
   group, so the blend has no backdrop to multiply against, and multiplying
   against nothing is nothing. No ordering inside the effect view fixes it.
   `UIGlassEffect(style: .clear)` underneath it was worse in a more instructive
   way: clear glass is transparent enough that the disc took its value from
   whatever photograph happened to be behind it and went near-black over a dark
   one. The + is up on every route over a scrolling feed and cannot be allowed
   to read the page for its colour.

app.js resolves the band to real numbers and sends them (the canvas is the
parser; see the note there), because the band is the reader's own accent as
often as it is Tria's ramp, and a Swift copy of `paintBrandBand`'s derivation
would be a second place for it to drift. `NativeChrome.repaint()` hangs off the
same `stamp()` call that sets `--user-band`, so the tint and everything else
wearing that colour can never land a frame apart.

**AND `repaint()` HAS TO PUSH ALL FOUR FAMILIES, which it did not.** It called
`setFab` and nothing else. The toolbar's CTA, the page's own primary acts and
the comment bar's send disc are each cached on the payload they last sent
(`toldBar`, `toldPage`, `toldPostBar`); a colour pick changes nothing else about
any of them, and `paintBrandBand` is memoised on the reader's identity, so the
only thing that ever corrected them was the next navigation happening to rebuild
the page. The accent is stamped once auth resolves, which is AFTER the first
route has drawn its buttons — so on every cold start the + wore the reader's
colour and every other primary act wore Tria's ramp. An amber + over a rainbow
Share pill, two halves of one fill a page apart. `repaint()` now calls
`scheduleToolbar`, `schedulePage` and `pushPostBar` beside `setFab`.

**AND `stamp(null)` HAS TO REPAINT TOO**, which is the same split arriving from
the other side. Picking Tria's own ramp is expressed by REMOVING `--user-band`
and its four companions, and that branch returned before it reached
`NativeChrome.repaint()`. The web needs no telling — the fallback in
`--pill-band` is the default, so every CSS reader is already correct — but
native holds resolved numbers and has to be told every time, including the time
the answer is "back to the brand band". Everything else wearing the band
happened to right itself anyway, because picking a colour rebuilds the page
under it and the toolbar and the page's own acts are re-measured when it does.
The + is not on the page. This call is the only thing that reaches it, so
choosing Tria left an accent + over a brand-ramp everything-else until the next
navigation. It is also what makes the +'s deliberate abstention above LOOK
deliberate: colourless the moment you pick Tria, not colourless one navigation
later.

**Reassign the effect, don't just mutate it.** A `UIVisualEffectView` caches the
effect it was handed, so `(view.effect as? UIGlassEffect)?.tintColor = …` alone
does not reach the material — the button would hold whatever colour it was built
with for the rest of the session and a colour pick would look like it did
nothing. `TriaBand.apply` builds a fresh `UIGlassEffect` every time and assigns
it, which is also where `isInteractive` is set for these three families.

### The dot

**One mark, on Updates, and it is not a badge.** The app's standing rule is no
COUNT anywhere — not in `aps`, not on the nav, not on a native tab — and what
that rule refuses is a number: something that climbs while you are away and asks
to be driven back to zero. A dot cannot climb, there is nothing to be behind on,
and it clears by looking. Zoe's call, and CLAUDE.md now says so in those terms.

`setDots({ dots: { "<route>": "<colour>" } })`, empty colour meaning no dot, so
one call carries both the news and the ink. Two payloads can land a frame apart
and on the one mark whose whole job is to appear that reads as a flicker rather
than as news. The colour is resolved in `fabSpec`'s neighbourhood from `--dot`,
like every other paint that crosses here; Swift is handed a number.

Three things about the drawing:

- **It is a sibling of the button's image, not part of the glyph.** `select`
  inks the three tabs you are NOT on down to `idleInk`, and those are precisely
  the three a dot can ever have anything to say about — the one you are looking
  at is the one whose news you have already spent. The web hit the same wall
  from the other side: `.nav-pill .nav-link { opacity: 0.4 }` composites the
  whole subtree, so the dim moved down onto `.nav-pill .nav-ico`.
- **`dots` is held, not applied and forgotten.** `setTabs` throws the row away
  and builds every button again, and the two calls arrive in either order, so
  whichever lands second has to find the other waiting. `paintDots` runs at the
  end of the tabs branch for that reason; the dot view itself is found by tag
  rather than tracked in a parallel array, so the view IS the record.
- **6.5pt, 11pt in from the tab's top and trailing edges**, off the same 50pt
  square `.nav-pill .nav-dot` measures off in CSS. The glyph is 28 centred, so
  its own edge is 14 out from the middle and its diagonal corner nearer 10 —
  which is why the mark clears every drawing in the row.

The state itself is `updatesAreNew` in app.js: the newest ledger row's `_ts`
against the same `tria:updates-seen:` stamp the ledger's own rows compare
themselves to, so the tab and the list can never disagree about what is new.
Reading the top row rather than counting fresh ones is not an optimisation — a
count is the thing being refused, and the cheapest way not to show one is not to
have one.

## What the top bar kept, and why

The bar itself is still `.topbar` in CSS. Two things live on it and both stay:

**The material WENT NATIVE, and this is the paragraph that was wrong.** It said:
outside a `UINavigationController` there is no system version of the scroll edge
effect to adopt, and the CSS one is already right, so a native bar here would be
a second copy of a good effect drawn worse. That held for as long as the bar was
STILL. It broke the moment the bar had to animate, in three ways, and the third
is the one that made it a bug rather than a preference:

1. It is HALF A BAR. The controls are real glass and the material was web, so
   "the header and the buttons don't match" was never a tuning problem — they
   were two objects with two animations and no way to agree.
2. Fading an element that carries `backdrop-filter` recomposites the blur every
   frame, on the most-scrolled surface in the app. That is the cost floor
   CLAUDE.md refuses everywhere else.
3. And the two fades RACED. `.topbar--bare` came off at the same instant
   `.topbar--hidden` went on, so one scroll started the material fading IN and
   the bar fading OUT, nested, in opposite directions. No amount of tuning fixed
   that while they were separate elements. Hide-on-scroll has since gone
   entirely (see below), which retires the race but not the first two reasons.

The first attempt at drawing it natively was a Swift COPY of that gradient — a
masked blur under the stylesheet's own `--bg` ramp. It shipped for one build and
it looked, in Zoe's words, like dogshit, for a reason that had nothing to do
with the stops: `.statusbar-scrim` is a second hand-painted `--bg` band over
`env(safe-area-inset-top)` at z-index 102, so over a photograph the notch strip
was carrying two paper washes at once and the result was fog. Painting a scrim
to imitate a material is a losing game however carefully the stops are tuned.

**THE SYSTEM'S OWN SCROLL EDGE EFFECT CANNOT BE REACHED FROM A CAPACITOR
WEBVIEW.** This is the paragraph to read before trying it a third time, because
the API exists, compiles, accepts everything you hand it and draws nothing.
`UIScrollEdgeElementContainerInteraction` (iOS 26) puts a real edge effect
behind floating chrome: you give it a scroll view and an edge, add it to the
container your chrome lives in, and the system shapes the effect around the
elements inside. It draws in the band the scroll view reserves at its top — its
adjusted content inset — by sampling that scroll view's own content. Capacitor
pins the webview's `contentInsetAdjustmentBehavior` to `.never`
(`CAPInstanceDescriptor.m`) and is right to: the page lays out its own safe area
with `viewport-fit=cover` and `env()`, and an inset would shift every page down
by the notch and break pull-to-refresh, which reads a negative `scrollY`. Zero
inset is a band of no height. Handing it a PROXY scroll view carrying the inset
was the obvious next move and fails on the second half of the same sentence: an
empty scroll view has no content to sample. Both were built, installed and
screenshotted, and both put a page title straight through the clock.

So the material is `UIGlassEffect` — one pane the height of the bar, the same
material as the discs riding on it. No gradient, no mask, no blur view, no
`--bg` stops to keep in step with a stylesheet, and it refracts what passes
under it instead of veiling it. Three details are load-bearing:

- **Three of its four rims are pushed off-screen.** Glass draws a specular edge
  on every side it has, which is right for a disc you can pick out with a finger
  and wrong for the top of a screen: the first build was a lit rectangle with
  bevelled corners sitting on the page. The frame is inset by `rimSlack` past
  the left, right and top edges, so the only rim left is the bottom one, which
  is the edge a bar is supposed to have.
- **It answers to the scroll, and so does the title, and they answer TOGETHER.**
  `headerUp` is one property both read: `!atTop && (holdHeader || !reading)`.
  Neither the offset nor the direction crosses the bridge — `bare` used to, on
  every push; native reads both off the webview's scroll view itself
  (`TriaScrollWatch`, KVO rather than the scroll delegate, which belongs to
  WebKit). What the web still owns is `holdHeader`, which is a fact about the
  ROUTE. At the top of a page there is nothing under the bar to separate it
  from, so there is no material and the page runs clean to the edge.
- **It FADES, it does not travel or collapse.** There was a build that kept
  `safeAreaInsets.top` behind as a glass tab in the notch, and one where the
  pane collapsed into that strip rather than fading; both read as the bar
  folding up while the discs on it dissolved in place, which is two animations
  for one change. Alpha is safe on this view — a plain `UIVisualEffectView`, not
  the glass container that refuses it. iOS resolves the status bar against the
  page perfectly well without a tab under it, as it does in every app that
  scrolls content under the clock, and `.statusbar-scrim` stays `display: none`
  under the gate: its second copy over the bar's own material was half of what
  made the first build fog.

**THE BAR NO LONGER HIDES ON A SCROLL DOWN. ITS HEADER DOES.** This replaces the
paragraph that used to say hide-on-scroll was a FADE in the app and a SLIDE on
the web; it was both, and the bar-shaped version of it is gone at either width.
The split is the whole idea:

- **The CONTROLS never leave.** They are the PAGE'S OWN — back, the filter dial,
  Save, •••, search — and a control worth putting on screen is not worth making
  the reader scroll up to fetch. The old gesture bought back a 60px strip of a
  feed that had already reserved room for it, and charged the page's own
  controls for it.
- **The HEADER — the material and the small title — keeps the gesture.** It
  stands aside while the reader goes DOWN a page and comes back the moment they
  reach up. That is the half the gesture was always really about: paper and blur
  between the reader and what they are reading.

**TWO KINDS OF PAGE, and the split is whether the title is telling you anything.**
`#/`, `#/discover` and `#/updates` are named by the tab you pressed to reach
them, so their header is decoration while you read and comes back only when
asked. A profile (`#/u/…` and `#/profile`) and a daily (`#/daily/…`) HOLD theirs:
the small title there is a person's name or the day's prompt — whose posts are
these, which question is this — and on a long page that is worth keeping
overhead. `#/profile` is in the holding half even though it sits on the nav,
because it is the same page as `#/u/<you>` through the same render function, and
a bar that behaved differently on the two would read as a bug rather than a
decision. `holdsHeader()` in app.js is the whole predicate, one line, and
`holdHeader` is what crosses.

**THE DIRECTION IS READ TWICE AND SHARED NEVER**, which is safe here for a reason
worth writing down. `syncToolbarReading` keeps the web's copy
(`.topbar--reading`) and `TriaScrollWatch` keeps native's, off the same scroll
view, with the same deadband and the same guard against the router's teleports.
They never both draw: under the gate the web's material is `content: none` and
its title `visibility: hidden`, so the class is inert in the app and native's
answer is inert off it. Two readers of one scroll view beats a per-frame flag on
the bridge, which is what the direction would have to be if the web owned it for
both.

The DEADBANDS ARE ONE NUMBER on each side (`HEADER_SLACK` in app.js,
`TriaScrollWatch.slack` in Swift) and it is also the threshold for "off the top".
That is not tidiness: starting down from the top, the first offset that counts as
off-the-top has to already count as reading, or the material fades in for the one
frame in between and shimmers.

So `setShown` is gone from `TriaToolbar`, the `visible` flag is gone from the
toolbar payload (`live` was the only other answer it ever had), and
`.topbar--hidden` is gone from app.js and the stylesheet. Two facts it was built
on are kept in the comment where it stood, because the next animation on that
class will need them: **alpha on a UIVisualEffectView is unsupported, and on a
GLASS CONTAINER it is worse than unsupported** — the container renders its
nested glass in a pass of its own, so `contentView.alpha` leaves the discs at
partial strength and re-rendering every frame (`TriaChromeBar.syncVisibility`
says exactly this, about exactly this class of view, and it was once read as
being about the bottom bar). What DOES honour alpha is a nested glass ELEMENT,
which is the fact the composer's + is animated on and the way each disc was
faded here.

**One thing this makes more visible, and it is a live question rather than a
finding.** `.statusbar-scrim` is `display: none` under the gate on the reasoning
that the bar's material does its job, and the material is now absent for most of
a downward read — so the clock sits over feed content far more of the time than
it did. iOS resolves it the way it does in every app that scrolls content under
it, which was the original argument, and the scrim's own note explains why a
second wash over the bar's material read as fog. A scrim that appeared ONLY while
the header is down would not stack with anything. Nobody has decided that; it is
written here so the next person does not re-derive the trade from scratch.

**The collapsing title is DRAWN natively and DECIDED in the web**, and the split
is the whole point. It appears exactly when the page's own in-flow `<h1>` has
scrolled out from behind the bar. That is a measurement of the WEBVIEW's layout
taken every scroll, and moving the readout to Swift would mean shipping the
page's scroll position across the bridge at 60fps to decide whether a word is
visible. So `syncToolbarTitle` still decides, and `titleSpec` sends the string,
the measured box, the resolved ink and the answer.

It was meant to stay CSS entirely, and what forced the move was the material:
the native chrome is a layer over the WHOLE webview, so a glass pane across the
bar is above the page's name too, blurring it out. There is no z-order that
fixes that — every web pixel is under every native one. `.toolbar-title` goes
`visibility: hidden` under the gate rather than `display: none`, because its box
still has to be measurable: `max-width` is where the clearance for the busier
side's buttons is worked out, and app.js reads that box on every push.

**Which needed Oxygen in a format UIKit can open.** The stylesheet's face is a
`woff2` and CoreText will not register a web font container. `ios-sync.sh`
already copies the whole `css/fonts` folder into the bundle for the web half, so
a `ttf` converted from that exact file sits beside it and
`CTFontManagerRegisterFontsForURL` picks it up on first ask — no asset catalog
entry, no `UIAppFonts`, no `.pbxproj` edit, and no second copy of the typeface
in the repo. If the registration ever fails the label falls back to the system
font at the same size and weight, which is a visible change of typeface and not
a broken bar. **If the web font is ever replaced, convert the new one too** (the
one line of fontTools that made it is in the commit).

The web crossfades the title on opacity AND a 6px blur; only the opacity comes
over. A blur on a `UILabel` means rasterising it every frame of the ramp, which
is the cost this pass exists to stop paying.

So what went native is the part that IS a control, and it goes native the way
the tab bar did: a `UIGlassContainerEffect` spanning the host with one
`UIGlassEffect` capsule per button, at the rects app.js measured. `.toolbar-btn`
and `.toolbar-cta` go `visibility: hidden` under the gate, which is both halves
of what is needed — out of the tab order and out of the accessibility tree, so
there is one of each control for VoiceOver and it is the native one, but still
occupying its box, because the title's `--toolbar-side` reserve is a count of
the controls that are there, Discover's search shell is pinned by an arithmetic
that starts from the filter disc, and app.js measures these boxes. The search
shell (`.toolbar-search-shell`) is hidden the same way, in both of its states —
see "Discover's search".

**The web element is still the control.** A tap on native glass comes back as an
id and app.js calls `.click()` on the element the glass is standing in for. A
chevron's `href`, the editor's `<button type="submit" form="pf-form">`, the
daily's route into the composer: each keeps the one implementation it already
had, and no page had to be edited to hand its bar over.

**Which is also how the bar is READ.** Nothing passes a structured description
of a toolbar alongside the markup — that would be the markup written twice, and
the copy that drifted would be the one nobody looks at. app.js walks the bar
that is already there: the glyph is the `<svg>` in the button, the ink is the
colour the cascade landed on it (which is how a washed profile's `--toolbar-ink`
arrives for free, and now also how a LIT FILTER arrives), a menu is
`aria-haspopup="menu"` because the web card is a WAI-ARIA menu and has had to say
so since 1.3.

**The filter's hue dot is gone, and the glyph wears the hue instead.** There was
an 8px bead pinned at the disc's top-right in the active type's pastel, ringed in
2px of `--bg` so it would punch clear of the sliders strokes behind it, mirrored
here as a `UIView` on the button. Opaque paper is the right way to do that on a
PAGE and the wrong way on GLASS: a flat disc of solid colour sitting on a
refracting surface reads as a rendering fault rather than as a state.
`.masthead-filter[data-active="…"]` sets `color` now, in the `-ink` half of each
pair (a 24px stroked mark on glass needs the readable one where a 15px row on
paper wants the pastel; in dark mode the `-ink` tokens fold back to the pastels
anyway). It crosses the bridge as `ink`, which was already being sent, so the
renderer lost a field and gained nothing — `paper` went with it, having existed
only to draw that ring. One `MutationObserver` on the bar drives the whole
thing, which is the only version of this that cannot fall behind a page that
grows a new control.

## The menus, and why they arrive late

A toolbar glyph drops a real `UIMenu` now — the system's glass, the system's
morph out of the button, and `.destructive` doing the coral row's.

**The rows are built when the menu opens, not when the bar mounts, and they have
to be.** The profile's ••• fans a different list on your own page than on a
visitor's, Discover's dial drops its gallery/list row while you are looking at
People, and the filter dial marks whichever row is live right now. A snapshot
pushed at mount would be a second copy of a decision the web layer already makes
correctly. `UIDeferredMenuElement.uncached` is exactly the tool for that: the
system presents the menu and asks for its contents, the question crosses to
app.js, and `menuReady` fills it in.

And what app.js does with the question is run **the page's own click handler**.
`openBarMenu` is the single funnel every menu in the bar already goes through,
so it takes one fork: asked to describe rather than draw, it hands its rows over
and builds no card. `onRow` — the one place that knows what a row MEANS — is
untouched, and runs the same on either drawing. That is what makes this one hook
instead of six rewritten call sites.

Callers hand their rows in twice, as markup and as `items`. That is not the
decision duplicated: both are built in one pass from one array, a few lines
apart, in the function that made it.

**A completion that is never called leaves the system holding an open menu with
a spinner in it forever**, so the deferred element times out at 1.2s and
completes empty. That is not tidiness; it is the failure mode.

### A menu the page asks for

**As of 2026-08-30, the post card's ••• and the repost circle beside it went
back to being a sheet — `openPostMenu` and `openRepostMenu` call `openSheet`
directly now, the way the audience picker always has, and neither goes through
`openAnchoredMenu` (removed) or `NativeChrome.presentMenu` any more.** **The
profile's colour ring followed on 2026-09-10** (Zoe's call): a menu row is a
22pt flat disc, so a band lost its sweep and Photo became a glyph, and the menu
dismissed on the pick, so colours couldn't be tried on against the live page.
The sheet shows the colours off, which is the whole job of that picker, and
`discIcon` went with it. Edit profile's music pick is the caller left that drops
a menu this way, with its own `presentMenu` call inline. The rest of this
section describes the mechanism as it still serves that caller; the
paragraphs that talk about "the two on a card" (the lost titles, the dropped
Repost row, the double-tap ordering) describe behaviour that applied only to
the reverted post/repost menus and no longer runs, but are left as the record
of why they looked the way they did.

A toolbar glyph's menu is opened by the system and then asks what is in it. A
control on the page goes the other way: the finger lands on a **web** button,
the page runs its own handler and builds the list, and only then does anything
native happen. So the rows go out **with** the request —
`presentMenu({label, rect, items})` — and there is nothing to defer, no token
to wait on, and no 1.2s timeout to protect.

`TriaAnchoredMenu` is the whole native half: one invisible `UIButton` inside a
host view spanning the web view, moved to whichever rect app.js measured, with
`showsMenuAsPrimaryAction` and a `performPrimaryAction()` to open it. The button
is never touched by anybody — the host answers `false` to every hit test, so the
page underneath keeps every tap and scroll it had. Presentation does not need a
hit; UIKit puts the menu up in its own window, which is also the reason the
native chrome cannot draw over one of these the way it drew over the web's
sheets (see "The chrome stands down for a web overlay", which exists because of
that bug and still governs everything the web puts over the page).

**A MENU DOES NOT FOLLOW WHAT IT HANGS OFF, and on a card that is a bug.** A
`UIMenu` is placed once, against the rect it was handed, in a window of UIKit's
own above the web view. For the toolbar's menus that is the end of it: a native
control cannot move while its own menu is up. For these it is not, because the
thing they hang off is a card in live HTML. A photo further up the feed
resolving its height, or `refreshPostViews` repainting a row, moves every card
below it while the menu stays exactly where it was put, and what the reader gets
is a menu floating over an unrelated post with nothing pointing at it. Measured
on the simulator, and it is a real complaint before it is a measurement: present
from an on-screen glyph, scroll the page 400pt, and the menu is still at the old
coordinate over somebody else's photograph.

So the web WATCHES ITS OWN ANCHOR, because it is the only side that can, and
calls `dismissMenu` the moment the rect it sent stops being true. Native takes
the menu down through the button's own `UIContextMenuInteraction.dismissMenu()`
— reached out of `anchor.interactions` rather than through an interaction of
ours, because becoming the delegate would mean taking over a presentation the
button is already doing correctly.

**IT ARMS ONLY ONCE THE MENU IS UP, and the slack is sixteen points.** Both of
those were wrong in the first cut and the result was worse than the bug being
fixed: a tap that undid itself. The frames right after a tap are the busiest a
feed ever has — a rubber band still settling hands back fractional offsets, a
photo lands, the row repaints — and a one-pixel threshold is a threshold of
nothing (`syncToolbarEdge` had already written this down two hundred lines
earlier and it did not get read). Worse, watching from the moment the REQUEST
went out meant the watch could fire before the menu existed, dismiss nothing,
and leave the menu arriving with nothing left watching it. So the token coming
back is what arms the watch, because the token is the proof the menu exists; and
the threshold is a third of a row, because the failure being caught is a menu
with hundreds of points of nothing under it, not one a reader could not measure
with a ruler.

Two more details are load-bearing. The watch is EVENTS, NOT A FRAME LOOP — a `scroll`
listener and a `ResizeObserver` on `#view`, both free while nothing is happening
— because a menu is dismissed by tapping away as often as by picking a row, and
that is the one ending the web is never told about; anything polling would still
be polling tomorrow. And the guard is on the ANCHOR'S RECT, not on the event, so
a resize or a scroll that does not actually move the card dismisses nothing. A
point of slack, because a card can be re-laid-out to the same place and a menu
that flinched at sub-pixel noise would be worse than the bug.

**AND THE RECT IS CLAMPED TO THE BAND THE READER CAN SEE.** UIKit clips a menu
to the SAFE AREA, which is the only edge it knows about; it has never heard of
the two bars Tria floats over the web view, and both cover exactly where these
controls live. A post page puts the card's ••• and its repost circle a few
points above the comment bar — often UNDER it — and a feed card scrolled to the
bottom puts them under the tab bar. Hand UIKit the raw rect there and the menu
opens from a coordinate nobody can see, which is what "the position is out of
whack on post pages" was: the menu was exactly where it was asked to go, and
where it was asked to go was underneath something. `visibleBand()` measures the
bars off the same hidden-but-laid-out boxes every other measurement here reads,
the rect is squeezed into it, and the menu opens off the nearest edge that is
actually on screen — which is where the finger was.

`presentMenu` also refuses a rect outside the viewport now. UIKit takes whatever
it is given and then clamps the menu into the safe area, so an anchor below the
fold produces a menu pinned to the bottom of the screen with nothing beside it —
the same nonsense, arriving a frame earlier. A finger cannot cause it (you
cannot tap what you cannot see); a caller passing an anchor it kept from an
earlier menu can, and the sheet is the honest answer for one of those.

**WHERE THE MENU LANDS IS UIKIT'S, AND THE RECT IS THE ONLY THING IT LISTENS
TO.** There is no placement API on a `UIButton`'s menu, and no public way to
open a menu at a point — `UIContextMenuInteraction` has `dismissMenu()` and
nothing to match it. So the anchor's frame is the whole vocabulary, and what it
buys was measured on the simulator with the frame logged beside the result:

- THE VERTICAL IS RELIABLE. The menu's near edge comes to rest on the control's:
  a control in the upper part of the screen drops its menu DOWNWARD with the
  menu's top on the control's top, one low on the screen opens it UPWARD with the
  menu's bottom on the control's bottom. Either way the row on that edge covers
  the glyph that was tapped.
- THE HORIZONTAL IS NOT. Off the same 32pt-wide ••• rect, at y 235 the menu came
  up leading-aligned to it (anchor x 19.6, menu x 20.7) and at y 359 it came up
  at x 86.7 — the same fixed box near the middle of the screen that the upward
  case lands in, where two anchors 280pt apart put their menus 4pt apart. The
  repost circle rides the right end of the action row, so both answers put the
  menu's right edge on it and the corner lands either way. The ••• at the card's
  left inset gets whichever UIKit felt like, and no rect changes that.
- A TALL anchor — running the rect down to the bottom of the screen to leave no
  room below and force the flip — is worse than what it was trying to fix. UIKit
  does not flip, it CLAMPS: the menu ends up pinned to the safe area with nothing
  beside it. Tried, measured, taken back out. The rect stays the control's.

**AND THE TWO ON A CARD LOST THEIR TITLES.** A `UIMenu`'s title is a band at the
TOP of the card, and the top of the card is exactly where these land when they
open downward — so the thing under the finger is "Repost", the word, and the row
it names is 50pt further on. That is the second tap gone on the two menus built
to have one. It costs nothing: the titles were labelling two- and three-row menus
whose rows say the same words. The toolbar's menus keep theirs, because they hang
off a bar rather than off the reader's thumb.

**`preferredMenuElementOrder = .priority` is what makes the double tap work.**
The first row is the row the system puts nearest the control — the top row when
the menu opens down, the bottom row when it opens up — so Repost and Copy link
are one tap and then that same tap again. It is named rather than left
`.automatic` because these two menus depend on it now, and a default that happens
to agree is not a contract.

**The ••• lost its Repost row** in the same change. It was spliced in second from
back when both of these threw the same sheet up from the bottom of the screen and
neither one was near the finger, so a second way in cost nothing. It costs
something now that the circle is one tap from Repost and one more from having done
it: the row was a slower route to a menu whose door the reader is already looking
at, and it pushed Copy link off the end nearest the glyph.

**A pick comes back as an INDEX, and that is the whole answer.** The toolbar's
menus reply through a synthesised row the caller reads a `dataset` off, because
their callers are the web card's own row handlers and that is the vocabulary they
already speak. These two aren't: they built their list a few lines from where the
pick lands, so `presentMenu` takes an `onPick(index)` and hands it straight back
— no row to fabricate, no `data` to round-trip an integer through.

**A pick is checked against a TOKEN, not against the control's id.** These menus
hang off cards, and a card is a node a refresh can replace out from under an
open menu; an id would still match after that and run a row against the wrong
post. The token is minted on the main thread in the same hop that presents, and
comes back as the promise's value.

**THE SHEET WAS RIGHT, and the post card's ••• and the repost circle are back
on it.** All three of these threw an action sheet up from the bottom of the
screen, and `openRepostMenu` still carries the argument for it: these controls
ride a card at an arbitrary scroll position, so a *web* card dropped out of one
lands anywhere between mid-screen and the gutter above the nav, and the same
tap produces a different-shaped thing every time. A real `UIMenu` does not have
that problem — the system flips it, scrolls it and clips it to the safe area
itself — which is the argument the colour picker's own `presentMenu` call still
rests on. `openPostMenu` and `openRepostMenu` no longer make that call: as of
2026-08-30 they build their array and hand it straight to `openSheet`, the way
the audience picker always has, with no native branch to fall back from.

**What the colour picker gave up, on purpose.** Its sheet is deliberately
see-through, the pick paints synchronously, and the ring you opened it from
wears the live colour the whole time, because a colour is the one setting whose
value you cannot read off a control — you have to see it land. A `UIMenu`
dismisses on the pick, so trying colours on against the live page went with it.
The page under the menu still repaints in the same frame as the tap; you see the
answer, you just do not get to hold the picker open and compare.

**Twelve colours as twelve images.** A menu row takes an image, not a fill, so
each source has to arrive as a drawing — `NativeChrome.discIcon` resolves the
band through the layout engine (the same `probe` the + uses) and returns a disc
in its **middle** stop, which is the band's own weight: the two either side are
a point and a half up and three down from it. `TriaSVG` draws no gradients and
this is not the release that teaches it to; a 22pt disc has about six points of
arc to spend a ramp on.

Tria's own row is the exception and had to be. `--brand-band` is four different
hues, its middle stop is the green one, and a pale-green "Tria" swatch sat two
rows above "Lime" and measured within twenty points of it — a picker that cannot
tell you what you picked. So a polychrome band is cut into wedges, one per stop,
from twelve o'clock. Only the caller that knows its band is polychrome asks for
that: the nine accents are three stops around one hex (`bandAround`), a
sheen rather than a ramp, and wedging them would draw seams nobody can see
through a disc that is honestly one colour.

Photo and None have no colour to draw at all, so they take marks: the picture
glyph, and an empty ring — which is what the web's None swatch already is.

### The pick is the row that didn't fade

There is no checkmark in a Tria menu, on either drawing. A tick can only say
"this one" — the reader has to sweep a column and find the row wearing it —
where a set with its un-picked members pulled back says "this one" and "not
these" in one glance, in the shape of the list itself, and it costs no column,
so the labels sit where they always did whichever row is live. The web card
fades the whole row to 0.48 and gates that on `role="menuitemradio"`, so the
action row above the ladder (Discover's gallery/list switch) never fades: it is
a switch, not a candidate, and dimming it would say it had lost a vote it was
never in.

**Native reaches only as far as the MARK, and this is a real limit rather than a
choice.** A `UIMenu` row's title has no alpha, and `.disabled` — the one
attribute that dims a whole row — also stops it being tappable, which is the
opposite of what an un-picked filter is. So `elements(from:)` fades the un-picked
rows' glyphs to 0.55 and leaves their labels at full strength. In this menu the
mark is the hue and the hue is the subject, so the column of them carries it. In
a set whose rows have no marks it would carry nothing, and the honest answer
then is a set that isn't drawn as a menu.

`.singleSelection` went with the tick: it is the option that DRAWS one, and the
API does not offer the semantics without the drawing. `radio` and `checked` still
cross the bridge and still mean a set and its live member — they are spent on
the fade now.

### The chrome stands down for a web overlay

A sheet, a bar menu's card, a modal, the photo lightbox: each is a scrim at
z-index 250+ covering the whole viewport, the `.topbar` and the nav included,
which is the point of a scrim. **Native chrome is not in that stacking context**
— it is UIKit, above the entire web view — so every one of them used to leave
the tab pill, the + and the bar's discs lit and tappable on top of the thing
that had just taken the screen. On the post card's ••• sheet the + sat directly
over the sheet's own Cancel row. Measured on the simulator, both before and
after.

So `NativeChrome` reads one more fact: `body.style.overflow === 'hidden'`, which
every overlay in app.js sets to lock the page behind it, and which the
scroll-memory code has read to mean "a modal is up" since long before native
chrome existed. A second READER of an existing fact, not a second source of one
— which is why no overlay had to grow a class, and why an overlay written next
year is covered on the day it locks the page like the rest. body's `style` joins
`class` in the observer that watches for it.

It takes down all of the chrome, the top bar's controls included. The web's own
buttons are under the scrim being dimmed; ours have to be in the same state, or
the bar reads as one where half the controls went quiet and half didn't.

## The SVG renderer, and the copy it retired

`TriaSVG` parses the icon markup app.js sends and draws it. It replaced five
glyphs hand-translated into `UIBezierPath` calls, and the reason is the reason
the brand band is resolved to numbers in JS: a second copy of a drawing is a
place for it to drift. The tab bar needed five marks and that was arguable; the
toolbar and its menus need about twenty more, and twenty more copies is not a
thing to own.

The subset is what Tria's icons use and no more — `<svg>` for the viewBox and
the inherited paint, `<circle>`, `<rect>`, `<path>` with M/L/H/V/C/S/Q/T/A/Z in
both cases. **S and T mirror the previous curve's control point, and only when
the previous command actually was one** — every other command clears the
reflection. The first version cleared it in some cases and not others, and the
bell paid for it: `…H4.3 S6 13.8 6 9.2z` mirrored the control point of the flare
on the right, so the left flare came out as a ramp reaching past the rim it
starts on. It is the one glyph in the set with a smooth curve after a straight
line, so it was the only one that showed. Arcs become cubics through the standard 4/3·tan(θ/4) construction
rather than a `UIBezierPath` arc, because an arc has to be built as its own
subpath and appended, which breaks the current point and with it every closed
outline that has an arc in the middle (the bell, the heart, the map pin). The
endpoint-to-centre conversion is F.6.5 of the SVG spec verbatim and needs no
adjustment: the spec's coordinate system already runs y down, which is the image
context's too, so `sweep` means the same direction on both sides.

**Template or baked is decided by the DRAWING, not by the caller.** A mark that
names no colour of its own is a template and something else tints it — the tab
bar's live/idle ink, a destructive row's red, a menu's own. A mark that carries
colours is baked. That distinction is load-bearing rather than tidy: the filter
dial's All row is the quintet, five hues in one mark, and the first version of
this decided on "was an ink sent?" and flattened it to black.

## What is still the web's, on purpose

**The mention picker**, for the reason under "The comment bar" below: a list of
friends is app vocabulary, and this bridge does not carry any. That is the whole
list now — the find bar was on it and came off (see below).

`transitionend` on the top bar is a push trigger alongside the mutations, for
the same reason a mutation is: a mutation says a change started, a transition
says one finished, and a rect or a colour read on the frame a class flipped is a
value still in flight.

## Discover's search

**Discover's search field went native second, and it is a change of mind.**

It shipped split. At rest the glass there is the SHELL, not the button
(`.toolbar-search-btn` is deliberately chromeless — the disc you see IS the
shell), so the shell gave its dress up and native drew the disc. But OPEN, the
shell has grown into a search bar with the X riding ON it, and a glass disc of
ours over a glass shell of theirs is the one stack "never glass on glass" has
never allowed. So the whole control went back to the web for that state.

That fixed the stack by giving up the material, on the single control in this
app whose entire gesture IS glass stretching: you tapped real Liquid Glass and
watched it become a CSS impression of itself. Native draws both halves now, and
the X inside the capsule is a bare mark on the capsule's own surface — which is
exactly what the web already does for both of the clears it draws
(`.postbar-clear`, `.toolbar-search-btn`). The stack is fixed rather than dodged.

**The field is real, for the comment bar's reason.** It holds a caret, so it
cannot be a face over a hidden input. `#discover-search` is still the MODEL:
every keystroke is written into it and it fires its own `input`, so the
`SEARCH_BEAT` debounce, the widened rebuild, `tileScore`, the tag rail's pressed
state and every read of `discoverQuery` are the code that already shipped.

**The geometry crosses as TWO BOXES, shut and open, and native animates between
them itself.** That is only possible because the gate turns the shell's width
transition OFF under native chrome (`html[data-chrome="native"]
.toolbar-search-shell { visibility: hidden; transition: none; }`), so the rect
read on the frame the class flips is already the final one. Following the web's
own animation instead would have meant a resize per rAF and a stutter to show
for it. Both halves of that rule are load-bearing, and `visibility` rather than
`display` for the toolbar's three reasons exactly — the shell is still the ruler
the capsule is laid against.

**The morph is a morph rather than a swap** because the capsule lives in
`TriaToolbar`'s own `UIGlassContainerEffect`, beside the buttons. It appears at
exactly the disc's rect on the frame app.js stops sending that control, so the
two overlap and the container merges them the way it merges any two pieces of
glass that meet.

**`focus` is opt-OUT, and the caller is the tag rail.** Tapping a tag runs its
query and should show you the answer, not raise a keyboard over it. It is read
only on the frame the capsule opens, so a later push cannot take back a caret
the reader put down.

Three things stayed the web's, and each is a call rather than a restatement: the
X calls `closeSearch`, a blur calls `foldIfEmpty` (an empty search folds, a full
one stays open), and both are the page's own rules running in the page.

**The glyph is read by name, not by opacity.** The magnifier is picked out of the
closed disc by `liveGlyph`, which reads whichever `.msb-ico` is showing; the open
capsule's X cannot be, because at that moment the mark is on a control app.js has
already stopped sending. `searchSpec` names `.msb-ico--close` directly. The
cross-fade between the two is switched off entirely under the gate — the button
is hidden in both states now, so the quarter second is a mark nobody can see, and
it used to leave an X on the native disc after a close because `liveGlyph`
measured a fade that had barely started.

### The faces, shipped twice on purpose

The daily's "Add yours" is set in **Oxygen Bold at 14.4pt**, which is the same
face at the same size as the web's own `.toolbar-cta` (0.9rem is 14.4px is 14.4
points). It gets there through `ios/App/App/Oxygen-Bold.ttf`, declared in
`UIAppFonts` — CoreText cannot register a woff2, which is the form every face in
`css/fonts` ships as for the web, so the alternative was a system font tuned to
look near it, and "near" is what a reader sees as a mistake.

The file is that same latin subset with its flavour changed and nothing else:
same outlines, same metrics, same 217 glyphs, 18KB. (`fontTools`, `flavor =
None`. The face is TrueType-outlined, so `.ttf` is the honest extension for it;
OpenType covers both and iOS does not care which.) Two copies of a FILE is not
two copies of a decision — nothing about the drawing of the letters is restated
anywhere. `TriaToolbarButton.pill` falls back to the system face at the same
size and weight if the file ever fails to copy in, which is exactly what the
pill did before it existed.

**Oxygen 400 shipped the same way** the moment a second native control set type:
the comment bar's field is Oxygen 400 at 16pt (the iOS auto-zoom floor the web
pins itself to), so `Oxygen-Regular.ttf` sits beside the Bold, 18KB, same latin
subset, same conversion. Still only the weights that are actually set — two of
the family's five — and still one fallback each.

## The comment bar

A post page's bottom chrome. The pill, the avatar, the field and the send disc
are `TriaPostBar` / `TriaPostBarPill`; the mention picker is not, and that is a
line rather than an omission — it is a filtered list of the reader's FRIENDS, and
drawing it over there would mean telling native what a friend is, which is
exactly the app vocabulary this bridge exists to keep out.

**The field is real, and it is the only thing in 1.4 that is.** See the note in
"What goes native" above for why a hidden textarea cannot be borrowed. What keeps
this from becoming a second model is the write-back: `postBarText` on every
keystroke and every caret move sets `input.value`, sets the selection, and
dispatches `input` — so `wireMentions.update`, `syncSend`, `autoGrow`, the
Return semantics and the submit are all still the one implementation of
themselves. A `mirroring` flag stops the echo (the write dispatches `input`, and
the listener that answers `input` by pushing text back would send it straight
home again with a caret that has since moved). The traffic the other way is one
thing only: a friend picked out of the web popover, and the empty string after a
comment posts.

`wireMentions` now fires `input` for BOTH kinds of field. `setRangeText` raises
no event of its own and the rich-editor branch had always had to dispatch one by
hand; moving it out is what lets the native mirror hear a pick, and it also
closes a latent gap — `autoGrow` and the send disc's sync had never run after a
mention was picked.

**The keyboard is `keyboardLayoutGuide` and no arithmetic.** The guide's top is
the keyboard while one is up and the bottom of the safe area while one isn't,
which is exactly the two states `--postbar-lift` and `body.postbar-kb` describe
between them on the web — except it is the value the system is already
animating, so the bar rides the keyboard instead of chasing it a resize step at
a time. `trackKeyboard` still ships and is still correct; it is what the three
web shells use, and under the native gate it simply never fires, because the
textarea it listens to never takes focus.

**Every number crosses as a BOX, not as a rule.** Reading the custom properties
back does not work — an unregistered one computes to its own token stream, so
`--postbar-field-pad` comes back as the literal `calc(…)` — and re-deriving them
in Swift would be a second place for a shape that derives from itself to drift.
So app.js measures the laid-out (hidden) form and sends where each child landed.
The only sum left in Swift is the growth, and every term in it was measured over
here.

Three things that were wrong first, all of them found on the simulator:

- **The send disc must not be glass.** It was a tinted `UIGlassEffect` and read
  as a soft blue halo, because it sat inside the pill's glass — the "never glass
  on glass" stack the stylesheet has always refused. On the web it is
  `.publish-fill.is-solid` thinned to `--pill-alpha` over the page, so it is now
  the band at that same alpha — a `TriaBandRamp` inside the disc, all four stops
  of it — with `--glass-edge`'s hairline. It is the ONE caller that still paints
  an accent through that view, and the one that still takes `--pill-alpha` over
  the bridge; it takes none of `TriaBand`'s three answers, because it is not
  glass. It took no lining either: a lining
  answers a material that mutes the fill, and this disc has none. Both the alpha
  and the edge are read off the web disc rather than quoted, and the edge is read
  through a canvas that keeps its ALPHA (`toRgba`) — `toRgb` reports three
  channels, which turns a 10% hairline into an opaque ring.
- **The disc is the one child measured without its rect.** `.postbar-send.is-idle`
  is `transform: scale(0.7)`, and mounting is the only moment this is read, so
  `getBoundingClientRect` reported 30.8 and native drew a disc a third too small.
  The used width is untransformed, and where it sits follows from the layout: it
  is the last item in a `flex-end` row, so its end is the form's own padding.
- **The host must not be a `UIVisualEffectView`.** It was a glass container, which
  puts its children in `contentView` — so when the keyboard moved the pill it was
  `contentView` that laid out, `layoutSubviews` on the host never ran, and the
  lift the mention list hangs off stayed at a figure from before the keyboard.
  The list opened behind the keys. A container was buying nothing anyway: it held
  one glass element, the disc having stopped being one.

### The find bar, which was left out and should not have been

**A circle's find bar is this bar too, and that is a change of mind.** It shipped
web on the argument that it is the same pill doing a different job — a magnifier,
one line, a clear — with no mention picker, no growth and no send, so there was
nothing here it would gain.

That looked at the wrong half of the bar. **What makes this class necessary is
not what the bar grows into, it is that the bar sits ON the keys.** A keyboard
raised for a web field in a Capacitor webview is positioned against the *web
view*, which is why the CSS bar has to chase it a `visualViewport` resize at a
time (`trackKeyboard`) while this one rides `keyboardLayoutGuide` and arrives
with it. Every argument that made the comment bar native was already an argument
for the find bar. And the omission cost something on its own: a reader walking
from a post page to a circle watched the same pill stop being glass.

**It is one class and one spec, because it is one bar.** `TriaPostBarPill` takes
`kind`, and `find` swaps the two ends: the leading avatar becomes the magnifier
— on the avatar's own box and datum, which is the stylesheet's own rule and the
reason the two bars sit on one axis, so it borrows the face's image view rather
than adding a second — and the send disc becomes the clear. Neither end is
branched in Swift. The clear carries no `.publish-fill`, so `bandOf` finds no
gradient and no fill is drawn; it carries `border: none`, so the hairline comes
back 0 wide; its mark's size and colour are measured off the web element the same
way every other number here is. A `size: 22` constant would have drawn the clear
a fifth too big, which is what the measurement is for.

**The one real difference is the field, and it is a second control.** A comment
grows to four lines and a search does not grow at all: on the web that is a
`<textarea>` and an `<input>`, and here it is a `UITextView` and a
`UITextField`. The pill holds both and shows one. A text view pinned to a single
line either wraps a long query out of sight or has to be taught to scroll
sideways under the caret, which is the one thing a text field already is. Every
read goes through `body` rather than reaching for `field`, which is what stops a
stale read surviving in the growth sum or the idle flip.

**Return means something different on each.** On a comment it is a real newline
(see the Return note in `wirePostBar`); on a search there is nothing to submit,
because the list has been filtering the whole way — so the key puts the keyboard
away, which is exactly what the web form's submit handler does with it. That and
`autocapitalize` / `autocorrect` / `spellcheck` cross as the attributes the web
field already carries, not as a `kind` branch, so a field that changes its mind
in the markup changes it here for free.

**The leading mark has to be put back at rest on the swap.** `setTyping` guards
on a *change*, which is right while a caret moves in and out of one bar and wrong
at the moment the pill changes which bar it is — the mark is being replaced, and
a bar the reader left with a keyboard up is mid-morph. Without `resetFace` a find
bar inherits a magnifier lying on its side at zero alpha, and a comment bar
inherits a discard X standing over a resting thread.

`pushPostBar`'s selector sends both now and the CSS gate hides both, and those
two still have to agree — the `:not(.postbar-form--find)` came out of each of
them in the same pass.

**The face crosses as pixels.** The avatar is already in the page, already
fetched with CORS (`avatarEl` sets `crossorigin` so the ambient wash can sample
it) and already read through a canvas by that sampler, so there is a decoded copy
right here — no reason for Swift to open a second connection for a file the web
view has got. Empty until the image lands; the push asks again on its `load`, and
the monogram draws in the meantime, which is what the web row does too.

### Getting off the keyboard

**The bar shipped with no way down that was not posting the comment**, and that
is the defect the discard mark and `TriaKeyboardDismisser` between them close.
It follows straight from what makes the bar work: the caret is in a UITextView
floating OVER the web view, so `point(inside:)` hands every touch outside the
pill to the page, the page has no focus to lose, and a tap that would have
blurred a web field does nothing at all. Three ways out now, and they mean three
different things:

- **Tap the page, or drag it.** The keyboard goes; the words stay. Both are
  borrowed from the web view's OWN scroller rather than built over the top of it,
  which is what keeps a drag a drag and leaves a tap the page cares about
  deliverable. `.interactive` is the Messages gesture — pull the page down and
  the keyboard follows the finger, with the pill riding it. The tap DOES swallow
  its touch, deliberately: a tap meant to put a keyboard away should not also
  open whatever it landed on. Armed only while a field holds the caret.
- **The face.** At rest it is the avatar and nothing else — whose thread is this
  — and it is `disabled`, so it cannot be tapped at all. With the caret in the
  field it turns into a close mark, and one tap empties the bar and drops the
  keyboard. It is at the LEADING end and that is the whole reason it can be
  there: the far end means COMMIT (the send disc, in the primary act's own
  band), so a dismissal beside it would read as its equal. The near end holds
  the identity, which is the thing you stop needing the moment you start typing.
- **The send disc**, which is not a way out so much as the way through.

**The face ships on both sides**, so this is not a native-only control:
`.postbar-face` is a real button in the web bar with the same morph
(`.msb-ico`'s cross-fade and quarter turn), the same `is-typing` rule, and the
same three flags flipping together that the send disc keeps — `disabled`,
`aria-hidden`, and the mark's own visibility, so a face that can throw a comment
away is always a face you can see. The 26px stays 26px and the 44pt target is a
pseudo-element on the web and an inset frame in Swift, so the box app.js measures
for the avatar is unchanged. Native flips the state itself rather than being
told, because it owns the caret and therefore already knows; the two rules are
one rule written once on each side.

**What has not been exercised by a real finger:** the send disc's tap, and the
tap-away and drag-away dismissals. There is no way to synthesise a touch into the
Simulator from a shell (System Events needs assistive access this environment
does not have). The face and the search X were fired through their real
target/action from a temporary probe, which is the whole closure; the send disc
was not, because firing it would post a real comment to a real thread, and
everything downstream of `UIButton → onSend` is the submit handler that already
shipped. The two gestures are `UIScrollView.keyboardDismissMode` and a
`UITapGestureRecognizer`, and they want a device.

### What the keyboard stands on (2026-09-18)

**The bar rode the keys and the page did not**, and that was only ever half the
interaction. A keyboard covers the bottom third of the screen; the layout
viewport is the same height either way in every shell Tria ships to; so the last
screenful of every route is simply not scrollable to while one is up. On the two
routes where the thing you are answering is the thing at the bottom — a post's
comment thread, a chat — that is the whole bug, reported as *"comments and chats
on the bottom half get covered when I try to respond."* You tapped the bar and
the conversation you were replying to went behind the keys, with no way to bring
it back.

**In this shell the web view is never told.** Off the app, `visualViewport` at
least says a keyboard is there and app.js does the arithmetic (`trackKeyboard`).
Here the fields that raise it are NATIVE, the keyboard is positioned against the
window rather than against the web view, and WebKit never hears about it:
`visualViewport` reports a viewport of exactly the same height with the keys up
as with them down. So the measurement has to come from over here.

**One observer, on the plugin, not on the bars.** `TriaChromePlugin.load()`
watches `keyboardWillChangeFrame` / `WillShow` / `WillHide`, converts the
notification's SCREEN rect into the web view's own coordinates (which is what
keeps it honest on an iPad, in a split view and under a floating keyboard), and
emits `keyboardInset` — guarded on a real change, so a notification that says
nothing costs a compare. Every keyboard in the app is the same fact about the
page whoever raised it: our comment bar, our find bar, Discover's search capsule,
or a web field in the composer. Putting it on `TriaPostBar` would have meant two
copies of it and would still have missed the other two.

**What is reported is the reach BEYOND the safe area**, because the foot of every
page already reserves that: the home indicator's strip is under the keys and has
nothing left to be kept clear of. Measured on an iPhone 17 Pro: web view 874pt
tall, `safeAreaInsets.bottom` 34 — so a 336pt keyboard reports 302.

**The page's answer is two things, and they are deliberately different sizes.**
Both live in `setKbInset` in app.js, and the web shells feed the same function
from `trackKeyboard`.

- **The reserve** (`--kb-inset`, read by `#view`) makes covered content
  REACHABLE. That is the accessibility half and it applies on every route, in
  every shell, whatever raised the keyboard — the guarantee is not about our bar.
  It sits on `#view` rather than on `main` because `main`'s foot is written five
  times over (desktop, phone, the post bar's reserve at both widths, and this
  file's own restatement of all of them) and because `main` is `min-height:
  100dvh` with border-box, so padding added THERE is swallowed on exactly the
  short pages that would be embarrassed by phantom scroll.
- **The shift** makes it VISIBLE, by scrolling the page up by what the keyboard
  just took. It is narrower on purpose: only while one of Tria's own bottom bars
  holds the caret (`kbFollow`, set by `postBarFocus` so both bars get it). A web
  field raises its own keyboard AND gets WebKit's caret reveal for free, and a
  second scroll on top of that puts the caret off the top.

**And the shift is clamped to what is actually covered**, which is what keeps it
from being the bug [Three traps](#three-traps-all-of-them-measured) and
`trackKeyboard`'s own `park()` exist to refuse — *"the keyboard pushes ALL the
page content up"*, a scroll into the overhang under a `min-height: 100dvh` page
with the post the reader was on driven off the top. The room is measured off the
END OF THE REAL CONTENT against the top of the reserve, so: a page whose content
already stops above the keys does not move at all; a thread scrolled to its foot
moves exactly far enough to put its last line back where it was, with the same
clearance over the bar it had at rest; and a long page read from the top moves by
the keyboard and no further, so every pixel that was readable still is. Measured
in a real chat on the simulator: at the foot, `y=173 max=173 foot=736` before,
`y=475 max=475 foot=434` after — the page grew by exactly 302 and the reader
stayed at the foot.

**The reserve is the DIFFERENCE, not the sum (2026-09-19).** The first version
reserved the keyboard's whole reach, and Zoe's read was immediate: the thread sat
too high. It was right about reachability and wrong about arithmetic. The page is
not bare under its last line — `body.postbar-live main` already holds `6.5rem +
env(safe-area-inset-bottom)` for the bar — so adding the full reach underneath
that stacks two clearances, and the last message floats about 53pt over the bar
where at rest it sits at half that. `setKbInset` takes `KB_TRIM` (32px) off the
figure before setting the property, and `room` is measured against the trimmed
reserve so the shift can never disagree with it.

A FLAT number is correct on every device, which is worth keeping because it looks
like it should not be. The part of `main`'s reserve that goes dead while a
keyboard is up is exactly the safe-area inset (the home indicator is under the
keys — the same fact `body.postbar-kb` acts on), and the plugin has already taken
that same inset off the figure it reports. The two move together, so they cancel,
and all that is left to trim is the difference between a bar standing on the
bottom of the screen and a bar riding the keys.

**`park()` had to learn the difference.** It spends 24 frames snapping the
document back to where focus found it, which is right for the scroll WebKit
INVENTS and wrong for the one we ask for. So it holds `kbPark` rather than a
local, and the deliberate shift moves the mark.

**A chat's `onFocus` stopped being smooth** for the same reason: the reserve
lands a beat after it, and a tween still in flight when that arrives is two
scrolls arguing, with the one going to the newest message losing. It costs
nothing to look at — the page opens at the foot, so it is a no-op unless the
reader walked back through the history first.

**What is NOT covered, on purpose:** the signed-out gate. `keyboardInset` is
registered inside `start()`'s success path, so the listener exists only where
native chrome does — which is what keeps the two sources from flapping against
each other on an iOS 25 device, where the CSS bar and `visualViewport` are
already the answer. Under `body.gate` nothing native has been asked for yet, so
the gate's two fields get WebKit's caret reveal and nothing else.

### The photo button, and the picture it leaves in a tray

**A comment can carry a photo or a GIF** (2026-09-13), and the bar gained one
control for it: `.postbar-pick`, a bare image mark between the field and the
send disc, drawn natively as the pill's `pick` button. It wears the find bar's
clear material for the clear's reason: picking a picture is not the commit.

**It stands in the disc's slot while the disc is idle** and steps aside once
there is something to send. On the web that is a `transform` on
`.postbar-form.is-empty`, not a margin, so the field is ONE width in both states
and `textWidth` stays a single measurement. Native plays the same move from two
numbers, `pickLeft` (the untransformed box, the rect with the transform's own
`m41` taken back off, because `offsetLeft` rounds a 53.6 step to 53) and
`pickShift` (the disc's width plus the row's gap).

**The tap crosses, and the picker is the system's (2026-09-14).** It used to
be the web's: `postBarPick` clicked `.postbar-pick`, which clicked the hidden
`<input type="file">`. On iOS that input always drops WebKit's own Photo
Library / Take Photo / Choose File menu, and WebKit anchors it to the input's
element, which under the native gate is the `visibility: hidden` web bar that
doesn't ride the keyboard. So the menu grew out of the wrong place, in the wrong
shape (a big glass circle morphing into the menu), and the page can neither move
it nor skip it. Now `postBarHooks.pick` checks `pick.disabled` and calls
`TriaChrome.pickPhoto`, which presents `PHPickerViewController` straight away,
with no menu in front of it and no library permission. It resolves `{data, type}`
as base64: a GIF as its own bytes, anything else drawn upright into a JPEG at
most 1600pt on its long edge, which is what `readCommentPhoto` would have made of
it anyway. The web builds a `File` and hands it to `takePhoto`, the file input's
own path, so the checks and the tray are still one implementation. `{}` is a
cancel, `{error}` is a toast, and a binary without the method rejects and gets
the old click. No camera: comments pick from the roll. The composer and edit
profile still use their file inputs, whose menu anchors on a visible web button.

**The chosen picture waits in a web tray** (`.postbar-attach`), hung above the
pill off `--native-postbar-lift` exactly as the mention list is. A thumbnail is
content, and content stays web. Native only needs to know THAT one is waiting,
because a picture with no words still lights the disc: that is `attached` on the
spec, and every change to the tray calls `NativeChrome.sync()` to send it.

## Three traps, all of them measured

**`alpha` on the glass container does nothing you want.** Hiding the chrome for
the post page by setting the container's `alpha` to 0 left the pill and the +
drawn at partial strength *on top of* the comment bar — the container renders its
nested glass in a pass of its own and its alpha is not applied to it. `isHidden`
is the fix, and it is also the right answer: on the web these go with `display:
none` and no transition (`body.postbar-live .nav`), for the reason
[navigation.md](navigation.md) gives about page changes. The + itself is a nested
*element* and does honour alpha, so the composer's tuck keeps its fade.

**The keyboard is geometry the web layer cannot see.** Capacitor's webview does
not resize when the keyboard comes up, so a CSS `position: fixed` bar simply ends
up behind it and out of sight — which is what 1.3 does, and it is fine. A native
bar has no such luck and would float on top of the keyboard, over the compose
form's own controls. So the bar answers `keyboardWillShow`/`Hide` itself. That is
the one thing native decides, it is geometry rather than navigation, and the
state the router named is restored the moment the keyboard goes down.

**A stored property cannot be `@available`.** `TriaChromeBar` is iOS 26 only, so
naming it as the plugin's `bar` property makes the whole plugin unavailable below
26 — which is exactly the OS that has to load the class and reject politely. The
`TriaChromeControl` protocol exists for that and for nothing else, and
`TriaToolbarControl` exists for it again a bar later.

**Bump and sync BEFORE the Xcode build, not after.** Obvious written down and
easy to get wrong in the moment: the copy-resources phase takes `App/public` as
it stands at build time, so a build that ran before `ios-sync.sh` ships the
previous bundle. It cost a confusing half-hour here — the new Swift read the old
JS's glyph KEYS as SVG markup, found no shapes, and drew a tab bar of four empty
boxes, which looks exactly like a renderer bug and is a build-order one.

## Things that will look like obvious improvements

- **A badge on the tab bar.** No. `aps` carries no badge, Updates has no count on
  the nav and no dot on the tab, and a number on a native tab is that badge by
  another route. Deliberate, and the one omission most likely to be "completed"
  by accident.
- **A native page transition.** No. Page changes have no transition, on purpose,
  and the reasoning is in [navigation.md](navigation.md). A native container that
  animates between tabs reintroduces exactly what was removed.
- **A native large-title bar.** Tria's big title is an in-flow `<h1>` that scrolls
  away under a small one. A UIKit large title would be a second copy of the same
  name, in a different type, above the one the page already draws.
- **Extra haptics.** System controls buzz themselves. Don't add bridge calls
  beside them — and the shared-world rule in [ios-shell.md](ios-shell.md) still
  governs everything the web layer fires.

## The page's own primary acts

Two buttons that are not on a bar: the auth gate's submit and **Share Tria** at
the foot of Discover. On the web they are `.publish-fill.is-solid` — the brand band
behind a hairline and a rim, which is a very good impression of Liquid Glass and
is not the material. In the app they are `UIGlassEffect` wearing all three forms of the band —
tinted for an accent, a `TriaBandRamp` under the glass for Tria's ramp, plain
for "no colour". These are the buttons the ramp exists for: they are capsules,
and a capsule is wide enough to carry it. The + is the one control that takes
Tria's band as no colour at all; see "The + does not wear Tria's band".

**Why a rect was not enough here.** A control on a bar cannot move. These sit in
content that scrolls, and a native view parked at a web rect does not follow it
— measured in this repo at "the anchor scrolled 400pt out from under a menu that
never moved" (`watchAnchor` in app.js). A *menu* can answer that by dismissing
itself. A *button* cannot, so the choice was to track or to stay painted.

**What made tracking work.** Each control crosses with `docY` — its position in
the DOCUMENT, not on the screen — and `TriaPageControls` subtracts the scroller's
own offset on every change of it. The offset comes from KVO on
`webView.scrollView.contentOffset`, the same signal `TriaScrollWatch` already
reads for the toolbar's material, which fires on the main thread on the turn
UIKit moved the content. The button is moved by the runloop turn that moved the
words, momentum included. A `scroll` event bounced out of the web view arrives
late and coalesced and would have swum.

**The band is the clip, and it is the whole answer to z-order.** Every native
pixel is above every web pixel. The container is clipped to the strip between
the two bars, so a CTA scrolled under the tab bar is cut off by the same edge
the reader sees the content cut off by — nothing faded, nothing special-cased.

**And the band's bottom is NOT `visibleBand()`'s.** That function measures the
bottom bar off `#nav`, and under native chrome `#nav` is `display: none`, so
there is no box to read and it reports the whole window. `pageBand()` takes the
bottom from `--native-chrome-bottom` instead — the plugin's own measurement. It
is deliberately a little larger than the glass (it carries the clearance a feed's
last card wants), so the clip lands a few points ABOVE the bar. That is the right
direction to be wrong in: a button that vanishes a moment early is invisible, and
one that vanishes a moment late is drawn on top of the navigation.

**What it cost, and what paid it.** `UIGlassEffect.tintColor` is ONE colour, so
for a while these sent the band's MIDDLE STOP and the four-stop brand sweep did
not survive — the same trade `.toolbar-commit` and `.toolbar-cta` made, and far
more visible on a full-width pill than on a 44pt disc. Then every band became a
ramp with a full-strength lining over it, which cost the material instead: a
full-width pill with a rainbow outline reads as a sticker, not as glass. The
settled answer is `bandFill` — the tint for the bands that are one colour, the
ramp for the one that is four, and nothing for the one that is grey — and all
three families draw it the way the + does.

**The two that went back to CSS (2026-09-19).** The composer's **Share** pill
and the daily card's **Add yours** were in this set from the start, and the
tracking held for them. The MATERIAL did not. `UIGlassEffect` is a lens on what
is behind it, and behind those two is glass already — the composer's own pane,
the daily card. Two lenses in a line do not read as one deeper piece of glass:
the second samples a backdrop the first has already flattened, so the pill lands
as a flat patch on a surface that is doing the blurring for it. The painted
`.publish-fill` is IN the card, shares the card's blur and comes out ahead of a
real lens that cannot borrow it. The gate's submit sits on the page's own paper
and Share Tria ends a masonry grid of photographs; both still have something to
look through, so both stay native. `MONO_SEL` narrowed to `.toolbar-cta` with
them — the CSS wears the neutral itself.

**The gate's own submit is matched and never reached.** `data-chrome` goes up on
a resolved `setTabs`, which `renderNav` asks for, and `renderNav` does not run
while `body.gate` is up. So signed out these stay painted and the riskiest screen
in the app keeps the path that has always worked. The selector reaches the
`.auth-submit`s that appear AFTER sign-in — Send feedback, and the password
change.

**Still unverified on a device:** the scroll tracking itself. The bridge, the
placement, the tint, the tap crossing back and a layout shift moving the button
were all confirmed on the simulator; an actual scroll under one of these was
not reached there. It is the first thing to look at on a phone.
