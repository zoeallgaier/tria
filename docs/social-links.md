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

**This stage is one unverified fact away from being impossible, and the test is
cheap, so run the test first.** Apple wants
`/.well-known/apple-app-site-association` served as `application/json`. Pages
will serve it as `application/octet-stream` (measured, above) and there is no way
to set a header on a static host. Reports differ on how strict Apple's ingester
still is about this.

**The test, before writing a line of Swift:** commit the file, push, wait, then

```
curl -s https://app-site-association.cdn-apple.com/a/v1/triaonline.com
```

Apple's CDN is what devices actually read. If that returns the JSON, Apple
ingested it and the stage is alive. If it 404s, the content type was refused,
and Universal Links are off the table while the site is on Pages. That same
request also settles whether Pages serves a `.well-known/` directory at all,
which is the other thing nobody should assume.

If it lives, the rest is ordinary:

- `applinks:triaonline.com` in [`App.entitlements`](../ios/App/App/App.entitlements).
- The AASA's `appID` is `<TeamID>.com.triaonline.tria`. Team ID needed.
- **Associated Domains has to be on the App ID itself**, in the developer portal.
  Automatic signing will add the capability to the *profile* and not to the App
  ID, and the failure is silent. This is exactly the shape of the push
  entitlement note in [ios-shell.md](ios-shell.md).
- `@capacitor/app` installed, to catch the URL and hand it to the router.

**If it dies, nothing else does.** A link without Universal Links opens Safari,
Safari serves `404.html`, and the app boots on the web at the right page with a
Smart App Banner offering the app. That is a worse experience, not a broken one.

**Gate:** the curl above. Then the binary gate: a plugin in `package.json` is not
a plugin in the app, [`ios/App/verify-plugins.sh`](../ios/App/verify-plugins.sh)
is what proves it, and the answer when it fires is DerivedData, not the Swift.
See [ios-shell.md](ios-shell.md#L176).

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

The two problems that killed earlier canvas attempts are both addressable here:

- **Fonts.** Oxygen is same-origin on the web and bundled in the app. Load it
  through `FontFace` and `await document.fonts.ready` before the first draw, or
  the first card renders in the fallback face and looks wrong exactly once.
- **CORS.** Avatars and photos come from Supabase Storage, which sends CORS
  headers, but the app's origin is `capacitor://localhost` and that has to be
  allowed or every canvas with a photo in it taints and `toBlob` throws.
  **Verify this before designing the templates**, not after.

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

Everywhere else is the ordinary share sheet: the image file plus the link, via
`navigator.share` with files on the web, falling back to a download.

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
