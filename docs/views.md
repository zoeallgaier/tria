# Refresh, feeds and photos

**Pull down is the only refresh.** Five dots, one per post type in `FILTERS`
order, arranged on a **ring**, riding the iOS rubber band: JS reads the negative
`window.scrollY` and drives `--ptr-y`/`--ptr-p`, CSS turns progress into
**radius** — the five sit stacked at 2px at rest, reading as one small object,
and the ring opens out of that point to 12px as you pull, so a fully open ring
*is* the "let go now" signal rather than a separate pop. Then the whole ring
turns while the re-pull goes out. It was a horizontal row doing a stagger wave
first, and the wave was wrong for the job: five dots counting left to right is a
*progress bar's* gesture and this is an indefinite wait, which every platform
draws as something going round. The ring reads as an ordinary spinner at a glance
and is still unmistakably the quintet up close. Spin `linear`, never `--ease` (an
eased spinner lurches once per turn and the lurch reads as a stall). The drop and
the turn live on **two elements** (`.ptr` and `.ptr-ring`) because an animation on
`.ptr` would beat the transition that settles it into place, snapping the drop.
Flat pastel, not the lit dome (that's reserved for the FAB and the Post pill, and
at 7px a specular hotspot is mud). Re-tapping the nav tab you're already on used
to refresh too; it now only scrolls to top and clears a filter. Two refreshes was
one too many, and the hidden one was doing the damage — nothing on screen says a
tab is also a reload button, so the app seemed to reload at moments the user
couldn't connect to anything they'd done.

**The ring is the app's only word for "the world is being re-pulled", so the
silent refresh borrows it rather than inventing a second one.** Pulling is the
only refresh *gesture*, but it isn't the only refresh: coming back to a
foregrounded app re-pulls too, and that path used to splice new rows in with
nothing on screen to account for them. Unexplained movement is indistinguishable
from a glitch — the ring is the whole difference between the app updating and the
app twitching. `refreshRing.on()/off()` (exposed by the pull module, driven by
`refreshWorld`) shows the same quintet with no finger involved: it lands first,
the page changes under it, it stays a beat, so the whole thing reads as one event.
Two guards keep it from becoming noise — a real pull always wins (`on()` declines
while one is in flight), and it only fires when the pull actually **changed**
something, so a resume that finds nothing new is completely silent, which is most
of them. `.ptr--spin` therefore has to remain a *complete* state on its own
(opacity, the 44px drop and the open 12px radius all on that one class); it used
to only ever be added on top of `.ptr--show`. And `on()` forces a style flush
before adding it, because the first show also creates the node and doing both in
one task gives the browser nothing to transition from — the ring would appear
instead of dropping in.

**A row waits for its photo before it is spliced in.** `readyImages` decodes the
photos belonging to the posts a refresh is about to add, and only then does
`showWorld` paint — so a post ARRIVES rather than arriving and then developing.
Under the ring the first 200ms of that wait is free, since the ring needs that
long to drop in regardless, so the two run together and the paint waits for
whichever finishes last. Home only: Discover rebuilds its grid whole and guards
itself with a signature, and an Updates row carries an avatar, which the roster
warm already covers.

Both bounds on it are safety, not tuning, and neither should be relaxed without a
reason. `READY_CAP` (700ms) is what stops a slow bucket turning a refresh into
something that looks stuck — whatever hasn't decoded by then just fades in the old
way, which is the behaviour that shipped through 1.1. `READY_MAX` (6) is because a
resume after a week finds hundreds of new posts and only the first screen of them
is about to be looked at. And the `live()` gate is **re-checked after the wait**,
because the wait is a real gap the reader can navigate or start typing inside.

