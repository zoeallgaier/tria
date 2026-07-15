# Delete account — Supabase setup (owner only)

App Store Guideline 5.1.1(v): if an app supports account creation, it must also
offer account deletion, in-app. The "Delete account" button (Edit profile, right
under Log out) ships in the repo. This is the **one dashboard/CLI step only the
project owner can do** (the service key was rotated, so Claude can't deploy
Edge Functions).

## Deploy the Edge Function
The function is at [`functions/delete-account/index.ts`](functions/delete-account/index.ts).

```bash
supabase functions deploy delete-account
```
No `--no-verify-jwt` this time (that's only for the push function, which is
called by a Database Webhook, not a signed-in user). Leaving JWT verification on
means Supabase rejects a missing or expired token before the function even
runs — the first check against deleting someone else's account. (Or paste the
file into Dashboard → Edge Functions → new function named `delete-account`.)

No secrets to add — `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected
automatically, same as the push function.

## What it does
On tap, after the "are you sure" sheet: clears the caller's `media/{uid}/`
Storage folder (avatars + post photos aren't covered by a foreign key, so they
don't cascade), then deletes their `auth.users` row via the admin API. That
cascades through `public.users` to every post, comment, like, headcount row,
friend edge, block, and push subscription — see the `on delete cascade` chain
in `schema.sql`. Nothing of theirs is left behind.

## Test
Sign in on a throwaway account, add a post or two, upload an avatar, then
Edit profile → Delete account → confirm. You should land back on the signed-out
gate with a toast, and the account (rows + Storage files) should be gone from
the dashboard.
