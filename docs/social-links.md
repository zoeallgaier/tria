# Social links

Getting a Tria link to behave like a link from a real social app: open the app
when it's installed, look like something when it's pasted, and carry an invite
that turns a stranger into a friend.

Scoped 2026-09-22 from Zoe's spec. The spec assumed a Cloudflare Worker in front
of GitHub Pages. **Zoe ruled out the DNS change**, so this document is the same
goals rebuilt on a static host with no server anywhere in the path. Most of it
survives. One thing does not, and it is written down in "The fork" at the foot,
because it is the kind of call that deserves to stay revisitable.

## What we are actually standing on

Checked 2026-09-22, not assumed:

- `triaonline.com` resolves to `185.199.108.153` and its three siblings: GitHub
  Pages, served direct. Nameservers are `domaincontrol.com` (GoDaddy).
- Pages serves an unmatched path as **404 with `text/html`**, GitHub's own error
  page. There is no `404.html` in this repo, so that hook is free.
- Pages serves an extensionless file as **`application/octet-stream`**. Measured
  against `/CNAME`, which is the same shape as an `apple-app-site-association`.
  This is the one fact the Universal Links stage turns on.
- Anon reads already work. [`supabase/public-site.sql`](../supabase/public-site.sql)
  gives `anon` the `users` and `comments` it needs, and `can_view_post` passes
  only `public` when `auth.uid()` is null. **A signed-out landing page can draw
  itself from the database and cannot leak a private account.** That property is
  what makes the invite landing page possible without a server.
- App Store: Apple ID **6796104809**, bundle `com.triaonline.tria`.
- `@capacitor/app` is not installed. [`package.json`](../package.json) has
  browser, core, haptics, ios, push-notifications.
- Links are built in exactly two places, `profileLink` ([app.js:9197](../js/app.js#L9197))
  and `postLink` ([app.js:9506](../js/app.js#L9506)), both already falling back
  to `https://triaonline.com/` off-web. Clean URLs are a two-function change.
- Nothing named "invite" exists in the code. Greenfield.

## Zoe's answers (2026-09-22)

Settled, so build to these:

- **No DNS change.** The nameservers stay at GoDaddy and the site stays on
  GitHub Pages. No Cloudflare, no Worker, no second host.
- **The invite link only travels through private channels.** Messages, a QR code
  in person. Public surfaces get the profile link, where adding someone is still
  a request, and stories cards follow the same rule.
- **Only posts and activities set to Anyone can become cards.** Your own profile
  always can. A daily answer follows its post's audience.
- Each user gets one short typeable code. Resetting it kills the old one.
- The inviter gets a push when someone joins. The new user's first screen is the
  inviter's posts.

## Calls made here that Zoe did not (veto any of them)

- **`404.html` is a generated copy of `index.html`**, not a redirect stub, so a
  clean URL costs no second page load. See "Real URLs" below.
- **The generic preview card gets upgraded even though it stays generic.** It is
  the cheapest visible thing in this whole document.
- **Invite redemption is gated on email confirmation**, which the spec's version
  was not. See trap 1.
- **Stories cards render client-side**, in one function shared by app and web,
  because the Worker that was going to render them server-side is gone.
- **The Invite page shows a list of names and never a number**, per the no-COUNT
  rule in [CLAUDE.md](../CLAUDE.md).

---

## Stage 1 · Real URLs

`#/p/<id>` becomes `/p/<id>`. Four paths: `/p/<id>`, `/u/<name>`,
`/daily/<slug>`, `/i/<code>`.

**The mechanism is `404.html`.** Pages serves it for every path that isn't a real
file, which is every one of those four. The trick is that `404.html` is not a
redirect page, it is **a copy of `index.html`** carrying one extra inline script
in `<head>` and a `<base href="/">`. So the 404 response body *is* the app: it
boots once, at the clean URL, with no second request and no flash. The script
turns `/p/<id>?s=story` into the hash route and `history.replaceState`s to
`/#/p/<id>?s=story` before the router reads anything.

**`<base href="/">` is load-bearing and is not optional.** Every asset line in
`index.html` is relative (`js/app.js?v=N`). Served at `/p/<id>`, those resolve to
`/p/js/app.js` and 404. `replaceState` running first is not a fix you can rely
on: the `<script>` tags are fetched as the document streams, and resolving them
against a URL that a script mutated mid-parse is not something to bet the boot on.
The `<base>` is declarative and settles it before the parser reaches an asset.

**`404.html` is generated, never hand-edited.** It drifts from `index.html` the
first time someone bumps a `?v=` stamp otherwise, and a drifted copy means the
clean-URL path boots a stale build while the root boots a fresh one. Extend
[`bump.sh`](../bump.sh) to emit it: it already owns the stamps, so it is the
natural place. Add it to the "never edit, generated" list beside `www/`.

Also in this stage, because they are free and need nothing:

- **Smart App Banner.** `<meta name="apple-itunes-app" content="app-id=6796104809">`.
- **The generic card, made good.** Every Tria link currently unfurls as
  `summary` + the 512 app icon, which reads as a favicon in a box. Move to
  `twitter:card = summary_large_image` and a designed 1200×630 committed at
  `icons/card.png`. Every link stays the *same* card, but it stops looking like
  a broken one. This is the single highest ratio of visible improvement to work
  in this document.
- **Source tags.** `?s=story` and friends survive the rewrite because the script
  carries `location.search` across.

**Gate:** none. No DNS, no migration, no App Store. Ships on a push.

## Stage 2 · Universal Links

A shared link opens the app instead of Safari.

**SETTLED 2026-09-22: this works, and it was the one thing that might not have.**

The risk was real. Apple documents
`/.well-known/apple-app-site-association` as `application/json`, GitHub Pages
types an extensionless file as `application/octet-stream` (measured against
`/CNAME`), and a static host gives you no way to set a header. Two unknowns sat
on top of each other: whether Pages would serve a dotted directory at all, and
whether Apple's ingester still enforces the content type.

Both answered by shipping the file and asking Apple's own CDN, which is what
devices actually read:

```
curl -s https://app-site-association.cdn-apple.com/a/v1/triaonline.com
```

It returns the file. **Pages serves `.well-known/` (HTTP 200), and Apple ingests
`application/octet-stream` without complaint.** So Universal Links need no
server, no DNS change and no paid anything, and everything left in this stage is
ordinary app work. Re-run that curl if the file is ever edited; Apple caches it,
and the CDN is the only honest read of what phones will see.

The rest:

- `applinks:triaonline.com` in [`App.entitlements`](../ios/App/App/App.entitlements).
- The AASA's `appID` is `<TeamID>.com.triaonline.tria`. Team ID needed.
- **Associated Domains has to be on the App ID itself**, in the developer portal.
  Automatic signing will add the capability to the *profile* and not to the App
  ID, and the failure is silent. This is exactly the shape of the push
  entitlement note in [ios-shell.md](ios-shell.md).
- `@capacitor/app` installed, to catch the URL and hand it to the router.

**And the fallback stays good regardless.** A link that doesn't hand over to the
app opens Safari, Safari serves `404.html`, the app boots on the web at the right
page, and the Smart App Banner offers the app. Worth remembering when the
entitlement is mid-flight or a reader is on Android.

**Gate:** the binary gate. A plugin in `package.json` is not a plugin in the app,
[`ios/App/verify-plugins.sh`](../ios/App/verify-plugins.sh) is what proves it,
and the answer when it fires is DerivedData, not the Swift. See
[ios-shell.md](ios-shell.md#L176).

## Stage 3 · Invites

**Entirely unaffected by the DNS decision.** It is Supabase and app code, and it
is the stage that actually changes whether anyone new shows up.

**Database.** A new migration, `supabase/add-invites.sql`:

- `invite_codes` (`user_id`, `code` unique, `created_at`). One live code per
  user. Reset deletes and reissues, which is what kills the old one.
- Codes are typeable: `ZOE-4K2` shape, the handle plus three characters from an
  alphabet with no `O`/`0`/`I`/`1`. Case-insensitive on redemption.
- `resolve_invite(code)`, SECURITY DEFINER, anon-callable, returning **only**
  the public profile fields the landing page draws: name, handle, avatar,
  accent. Not the user id, not anything a private account hasn't already made
  public. It is the one function anon can call, so it is the one that has to be
  boring.
- `invite_redemptions` (`code`, `inviter`, `joiner`, `redeemed_at`, `source`) —
  the Invite page's list, and the analytics join.

**Redemption is confirm-gated. This is trap 1 and it is the one real bug in the
original spec.** `handle_new_user` is `after insert on auth.users`
([schema.sql:240](../supabase/schema.sql#L240)), and with Confirm email on, that
row is inserted at `signUp`, unconfirmed. Writing the friends edges there means
anyone holding a code becomes a real friend from an address they have not proven
they own. So:

- `handle_new_user` **stores** `raw_user_meta_data->>'invite'` onto the new
  profile row as `pending_invite`. Nothing else changes about it.
- A second trigger, on `update of email_confirmed_at on auth.users` firing when
  it goes from null to not-null, **redeems**: checks the guardrails, writes both
  friends edges, clears `pending_invite`, and rows the redemption.

This keeps the property Zoe wanted the metadata for: the code survives confirming
on a different device, because it is in the database row, not the session.

**Guardrails, in the redeeming trigger:**

- Either side blocked the other → refused outright, silently.
- The joiner previously declined the inviter (`friend_declines` exists) → drops
  to an ordinary friend request, not a tie.
- Self-redemption, unknown code, already-friends → no-ops, not errors.

**Client.**

- `#/i/<code>` at `/i/<code>`. Signed out: the warm landing page, drawn from
  `resolve_invite` — avatar, accent, name, public pins, "Zoe invited you to
  Tria." Primary button joins, secondaries are log in and the App Store.
- Signed in and not already friends: the same page collapses to one **Add Zoe**
  tap, same instant tie, same guardrails.
- The app's signup form gains an optional **Invite code** field, because
  installing from the App Store drops the link and every fix for that is a paid
  service or a clipboard hack. This is why the code has to be typeable.
- `#/invite`: the Invite page. Copy, Share, QR, Reset, and the list of who came
  in through your link.
- **Share Tria at the foot of Discover shares your invite link**, not the bare
  homepage ([app.js:12353](../js/app.js#L12353) today sends
  `https://triaonline.com`).

**QR needs an encoder and there is no build step.** [`js/vendor/`](../js/vendor/)
holds exactly one file today. Either it gains a small QR library the same way, or
we draw one by hand. Vendoring is the honest option; a QR encoder is more finicky
than it looks and this is not where to spend invention.

**The payoff, which is the actual point of the stage:**

- The inviter gets a push: "Sam joined from your invite. You're friends now."
  The push function already exists; this is a new branch and a redeploy.
- The new user's first screen is the inviter's posts, not an empty circle.

**No numbers.** The Invite page lists names. It does not say how many, and it
does not put a dot on the nav. Per the no-COUNT rule: the thing that rule refuses
is a number that climbs while you are away and asks to be driven back to zero.
A retrospective list of people is not that, but a tally beside it would be.

**Gate:** Zoe runs `add-invites.sql`, then `supabase functions deploy
swift-processor` for the push branch. Note the standing warning in
[CLAUDE.md](../CLAUDE.md): the folder is `push`, the deployed slug is
`swift-processor`, and a GET on it says `ok` regardless of which revision is live.

## Stage 4 · Stories cards

One renderer, three sizes: 1200×630, 1080×1920, 1080×1080. The Worker that was
going to run Satori is gone, so this renders **client-side on canvas**, in one
function that app and web both call, so the two cannot drift.

**THE RENDERER IS BUILT (2026-09-22):** [`js/storycard.js`](../js/storycard.js),
with a bench at [`tools/storycards.html`](../tools/storycards.html) that draws
every card at every size against every background. Nothing in app.js calls it
yet, and no route reaches the bench — it is deliberately unwired, so the design
can be reviewed on the real code before any of the share plumbing exists.

What the build settled that the design could not:

- **The card is measured, not positioned.** The artboards carried a hand-tuned
  `top` per card. In code the card is laid out as a column, measured, and
  centred in what Instagram leaves free, so a long post SHRINKS its own type
  (76px down to a 40px floor, then an ellipsis) rather than pushing the address
  under the reply bar. The photo plate is the one flexible block and takes
  whatever the caption did not.
- **The palette is frozen in the file**, copied from `css/tokens.css` rather
  than read from it. A card is Tria's paper, not the sender's device: someone
  with their phone in dark mode still sends a light card unless they pick Dark.
  `bandStops()` carries the `--band-deepen` arithmetic so the ramp can be
  checked against tokens.css by eye.
- **The QR is not done and is drawn as a labelled placeholder.** It needs a
  vendored encoder, it is shared with Stage 3's invites, and it has to be
  checked against a phone camera rather than against my own eyes. A decorative
  QR that does not scan is worse than no QR. `StoryCard.useEncoder()` is the
  seam it drops into.
- **The bench is publicly downloadable once pushed** (`triaonline.com/tools/`),
  the same way `bump.sh` and `gen-icons.js` already are. Nothing on it is
  private and nothing links to it.

The two problems that killed earlier canvas attempts are both addressable here:

- **Fonts.** Oxygen is same-origin on the web and bundled in the app. Load it
  through `FontFace` and `await document.fonts.ready` before the first draw, or
  the first card renders in the fallback face and looks wrong exactly once.
- **CORS. SETTLED 2026-09-22, and it is fine.** Avatars and photos come from
  Supabase Storage, and the app's origin is `capacitor://localhost`, which had
  to be allowed or every canvas with a photo in it taints and `toBlob` throws
  rather than returning anything. Checked against the live project:

  ```
  curl -sI -H "Origin: capacitor://localhost" \
    https://autjondbgcjctezbxliv.supabase.co/storage/v1/object/public/media/x.png
  ```

  Both the GET and the OPTIONS preflight answer `access-control-allow-origin:
  *`. A wildcard covers a custom scheme the way it covers anything else, so
  there is nothing to configure and nothing to keep configured. `loadImage()`
  in storycard.js still asks for `crossOrigin` and still degrades to the empty
  plate if a bucket ever stops saying this, because the failure is otherwise a
  thrown SecurityError at the moment someone taps Share.

Hard limits on the story size, from the spec and not negotiable:

- Keep roughly the top 250px and bottom 340px clear. Instagram's own UI covers
  them.
- Every card carries the handle and the URL as readable text, because many
  people never add the link sticker.

**Instagram** takes `instagram-stories://share` through a small Swift plugin,
needs a free Meta App ID, and needs the scheme in `LSApplicationQueriesSchemes`
(which already holds `spotify` and `youtubemusic`, so the shape exists). The card
goes as a sticker and the accent gradient as the background colors, which is the
Spotify approach and the reason it feels like the sender's own. No third-party
app may attach the link sticker, so Tria copies the link at the same moment and
toasts: "Link copied. Add it with the link sticker."

Read against Meta's own docs, 2026-09-22, and two details bite:

- **The App ID is mandatory and it is a hard gate**, not a nicety: since January
  2023 the scheme takes `?source_application=<FB App ID>` and does nothing
  without one. It is free and needs no app review, but it belongs to a Meta
  developer account, so it is ZOE'S to create and the one thing here that
  cannot be built around. The ID is not a secret and can sit in `js/config.js`
  beside the Supabase keys.
- **The background is TWO colours, not four.** The pasteboard takes
  `com.instagram.sharedSticker.backgroundTopColor` and `...BottomColor` and
  interpolates between them. Tria's brand ramp has four stops, so it cannot go
  across as itself — something has to choose two. This is the same question as
  the gradient-default one below, arriving from the other side: a reader with
  an accent has an obvious two (the band either side of their hex, which is
  what `bandAround` in app.js already computes), and a reader on the brand ramp
  does not.

The sticker key is `com.instagram.sharedSticker.stickerImage`, and all three go
on the pasteboard in one item with an expiry before the scheme is opened.

**The rest of the sheet is two rows, not a tray.** *Save image* puts the picture
on the device — the camera roll through `saveToPhotos` in the app, a download in
a browser, one label either way because the sentence a reader is thinking does
not change. *Copy link* copies the address and says so. Neither one opens
`navigator.share`, and that is deliberate: a sheet whose last row opens another
sheet is not a simplification, and the system tray is still one tap inside the
saved picture. The tray has one home now, the ••• row itself, for the things
that have no card to draw.

**One row in, three rows out.** Every ••• in the app offers exactly one way to
hand a thing over and it is spelled *Share* (a post) or *Share profile* (a
profile) every time. Menus name intents; this sheet names acts. Where there is
no card — somebody else's post, an activity, a poll, somebody else's profile —
the row keeps the same word and goes straight to the system tray instead.

**Scope rules** are the ones in Zoe's answers. Worth noting they mostly enforce
themselves: a card is drawn from what the client can already read, and a client
that cannot see a private post cannot draw one of it.

**Analytics.** Redemptions and card shares carry a `source`, and the reporting is
a `metrics` view following [`daily-analytics.sql`](../supabase/daily-analytics.sql)
exactly, for the reason that file gives at length: a view in `public` is exposed
by PostgREST and runs as its owner. `metrics` is not exposed. Do not move it.

---

## The fork

**The one thing the no-DNS decision costs is the per-link preview card**, and it
is worth being precise about the loss rather than vague. Every Tria link pasted
anywhere unfurls as the same card: the Tria card, not Zoe's post. Stage 1 makes
that card good, but it cannot make it specific, because specific means a server
reading the database at the moment a bot asks, and there is no server.

Everything else in the original spec survived. Clean URLs survived. Universal
Links probably survived (stage 2's curl decides). Invites survived whole.

**If per-link previews ever become worth it, these are the two cheapest routes,
in order:**

1. **One CNAME on a subdomain.** `link.triaonline.com` pointed at any function
   host — a Supabase Edge Function, which this project already deploys and
   already has the anon key for. This is a single record added in the GoDaddy
   panel. It does **not** move the nameservers, does not touch the apex, and does
   not touch email. Shared links become `link.triaonline.com/p/<id>`, which is a
   slightly longer URL and a real preview card. If the objection to Cloudflare was
   the nameserver move rather than the added service, this is the same outcome for
   a much smaller act, and it is the first thing to reconsider.
2. **Prerender on a schedule.** A GitHub Action, which is a server we already
   have, reading Supabase with the anon key every N minutes and committing a real
   `/p/<id>/index.html` per public post. No DNS at all, previews are real, and the
   costs are honest: a lag between posting and the card existing, and a repo that
   grows a file per public post forever.

Neither is scoped here. Both are written down so the decision can be remade on
what it actually costs.

### Cloudflare was tried and taken out (2026-09-22)

Worth recording properly, because on paper it looked free and obvious and it is
the thing someone will suggest again.

The plan was the original one: move the nameservers to Cloudflare, run a Worker
on four routes. The money question checked out — the free tier is 100,000
requests a day and 10ms of CPU per request, which is far more than Tria needs
and far more than string-substituting meta tags into a page costs. Zoe added the
domain, left every record grey, and got as far as the nameserver screen.

**What stopped it was the DNS audit.** GoDaddy's zone for `triaonline.com` holds
**21 records**, and Cloudflare's import scan silently missed three of them:
`bounces.cloud.em`, `bounces.cloud2.em`, and `sable.cloud._domainkey`. All three
belong to GoDaddy's email system, and the third is the DKIM key.

That last one is the trap. The zone also carries a DMARC record set to
`p=quarantine`, which instructs every receiving mail server to spam-file anything
from the domain that fails its signature check. Moving without the DKIM record
would have satisfied the instruction and deleted the thing that answers it:
outgoing mail would have looked fine from this end and quietly landed in
people's junk folders, with nothing in the app or the site to indicate why.

**And it was not findable by the checks we were running.** DNS answers "do you
have a record named X?" and never "list everything." The pre-flight check here
verified eight records by guessing their names, found them all identical, and
reported the zone as clean. It was not clean. What surfaced it was Zoe reading
the GoDaddy table by eye and asking about two CNAMEs that looked odd.

So the decision is not "Cloudflare is bad." It is that **the per-link preview
card is one feature, and the thing standing between here and it is a hand-audit
of a 21-record zone where the failure mode is invisible, delayed, and lands on
email rather than on the app.** That is a bad trade for one card. Everything
else on this list was already free of it.

**This also re-prices option 1 above.** A CNAME on a subdomain is a smaller act
than a nameserver move, but it is an act on the same zone, and it would want the
same audit done first. Whoever picks this up again should start by exporting the
full GoDaddy zone file rather than probing for record names, and should treat the
email records as the load-bearing half of the job.
