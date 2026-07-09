# Push notifications — Supabase setup (owner only)

The web app side (service worker, subscribe flow, pre-prompt card, profile toggle)
ships in the repo. These are the **dashboard steps only the project owner can do**
(the admin/service key was rotated, so Claude can't run these). Do them in order.

## 1. Create the subscriptions table
SQL Editor → run [`push-subscriptions.sql`](push-subscriptions.sql).

## 2. Set the function secrets
Project Settings → Edge Functions → Secrets (or `supabase secrets set NAME=…`):

| Secret | Value |
|---|---|
| `VAPID_PUBLIC_KEY` | the public key already in `js/config.js` (`BCVwE8VZ…`) |
| `VAPID_PRIVATE_KEY` | **the private key Claude sends you in chat — never commit it** |
| `VAPID_SUBJECT` | `mailto:zoeallgaier@gmail.com` |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically — don't add them.

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

## 5. Test
Sign in on two accounts (one on a home-screen-installed iOS device), turn on
notifications via the Updates card or profile toggle, then have the other account
comment / RSVP / send a request. A notification should arrive within a second.

---

### Note on the sender library
`functions/push/index.ts` uses `npm:web-push`. It's the most documented path and
works in Supabase's Deno runtime, but if delivery ever fails there, the fallback
is a Web-Crypto VAPID signer (e.g. `@negrel/webpush`) — same table, same webhooks,
only the function body changes.

### iOS reality (already handled, just so you know)
Web push on iOS works **only** for the home-screen install (not a Safari tab),
needs iOS 16.4+, and the permission prompt only fires from a tap — which is why
the "Turn on" button exists. A declined prompt is permanent on iOS.
