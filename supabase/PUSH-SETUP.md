# Push notifications — setup (owner only)

The app side (service worker, subscribe flow, pre-prompt card, profile toggle,
APNs registration) ships in the repo. These are the **dashboard steps only the
project owner can do** (the admin/service key was rotated, so Claude can't run
these). Do them in order.

> **Status (2026-07-30): step 5 is the one that's still open, and the app is now
> in App Store review.** The device side is finished and verified — the toggle
> turns on, APNs hands back a token, the row lands in `push_subscriptions`. What
> is missing is the `.p8` and its three secrets, so the sender has nothing to
> sign with and **every iOS notification is silent**. There is no error anywhere
> in that path: the phone looks like push is on. Do step 5 before anyone outside
> the circle installs the build.

**Two transports, one table.** A browser stores a Web Push subscription; the iOS
app stores an APNs device token, because a WKWebView has no Push API at all —
which is why push was silent in the App Store build. Both are rows in
`push_subscriptions` and the address says which is which: an APNs row is
`endpoint = 'apns:<hex token>'` with empty keys. **No migration is needed for
iOS** — the table below is unchanged.

## 1. Create the subscriptions table
SQL Editor → run [`push-subscriptions.sql`](push-subscriptions.sql).

## 2. Set the function secrets
Project Settings → Edge Functions → Secrets (or `supabase secrets set NAME=…`):

| Secret | Value |
|---|---|
| `VAPID_PUBLIC_KEY` | the public key already in `js/config.js` (`BCVwE8VZ…`) |
| `VAPID_PRIVATE_KEY` | **the private key Claude sends you in chat — never commit it** |
| `VAPID_SUBJECT` | `mailto:zoeallgaier@gmail.com` |
| `APNS_KEY_ID` | the 10-char Key ID of the .p8 (see the iOS section below) |
| `APNS_TEAM_ID` | `8L793UU9T2` |
| `APNS_PRIVATE_KEY` | **the whole .p8 file's contents**, `-----BEGIN PRIVATE KEY-----` line and all |
| `APNS_BUNDLE_ID` | optional; defaults to `com.triaonline.tria` |
| `APNS_ENV` | optional; leave unset — see "sandbox vs production" below |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically — don't add them.

Missing APNs secrets are **not fatal**: web push keeps working and iOS rows are
skipped with one log line, so a half-finished setup degrades rather than breaks.

## 3. Deploy the Edge Function
The function is at [`functions/push/index.ts`](functions/push/index.ts).

```bash
supabase functions deploy push --no-verify-jwt
```
`--no-verify-jwt` lets the Database Webhook call it. (Or paste the file into
Dashboard → Edge Functions → new function named `push`.)

## 4. Wire the triggers (webhooks)
Newer dashboards hide the Database Webhooks UI, so this is done in SQL instead —
same effect (AFTER INSERT triggers that POST the row to the `push` function via
pg_net). SQL Editor → run [`push-webhooks.sql`](push-webhooks.sql).

It covers `comments`, `posts`, `headcount`, and `friends`. **Not `likes`** —
likes stay a silent private nod, by design.

## 5. Apple side, for the iOS app (developer portal — also owner only)

Two things, and **both are required**; the entitlement alone doesn't work.

**a. Turn on the capability for the App ID — ✅ already done.** Verified from a
signed device build: the team provisioning profile Apple issued for
`com.triaonline.tria` already carries `aps-environment`, which it only does when
the App ID has Push Notifications ticked. Nothing to do.

*(If that ever changes — a new App ID, a reset profile — it's
developer.apple.com → Certificates, Identifiers & Profiles → Identifiers →
`com.triaonline.tria` → tick **Push Notifications** → Save. Automatic signing can
add the capability to a profile but never to the App ID, so it's by hand. Miss it
and `registerForRemoteNotifications()` fails with "no valid aps-environment
entitlement string found" — which, unusually for push, does show up in the Xcode
console.)*

**b. Make an APNs auth key.** Same site → **Keys** → ➕ → tick **Apple Push
Notifications service (APNs)** → Continue → Register → **Download**. You get
`AuthKey_XXXXXXXXXX.p8` and it can only be downloaded **once** — keep it
somewhere safe, out of the repo. The `XXXXXXXXXX` in the filename is the
`APNS_KEY_ID`. One key covers sandbox and production, and every app under the
team.

Then paste the .p8's contents into `APNS_PRIVATE_KEY` (step 2) and redeploy the
function.

### Sandbox vs production
A build installed from Xcode registers with APNs **sandbox**; TestFlight and the
App Store register with **production**. Both come off the same
`aps-environment: development` line in `App.entitlements` — codesign rewrites it
when the archive is signed for distribution.

Nothing in a device token says which one it came from, so with `APNS_ENV` unset
the sender tries production first and retries sandbox on `BadDeviceToken`. Leave
it unset unless you're chasing something; it means a phone running a debug build
and a phone running TestFlight both get notified from one deployment.

## 6. Test
Sign in on two accounts, turn on notifications via the Updates card or profile
toggle, then have the other account comment / RSVP / send a request. A
notification should arrive within a second.

For the iOS build specifically: it must be a **real device** (the simulator has
no APNs), and after tapping "Turn on" a row should appear in
`push_subscriptions` with an `apns:` endpoint. **No row means the token never
arrived** — check the App ID capability (5a) before anything else. The app is
deliberately silent while it's in the foreground (no banner over the app you're
already looking at), so background it before sending the test.

---

### Note on the sender library
`functions/push/index.ts` uses `npm:web-push` for the browser half. It's the most
documented path and works in Supabase's Deno runtime, but if delivery ever fails
there, the fallback is a Web-Crypto VAPID signer (e.g. `@negrel/webpush`) — same
table, same webhooks, only the function body changes. The APNs half has no
library: it's a Web-Crypto ES256 JWT and a `fetch`, about sixty lines.

### iOS reality (already handled, just so you know)
There are two iOS paths and they're unrelated. **Web push** works only for a
home-screen install of the *website* (not a Safari tab), needs iOS 16.4+, and is
what a friend who never downloads the app gets. **The App Store build** uses APNs
and none of that applies to it. On both, the permission prompt only fires from a
tap and a declined prompt is permanent — which is exactly what the soft "Turn on"
pre-prompt exists to protect.
