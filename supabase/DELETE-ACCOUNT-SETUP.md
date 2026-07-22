# Delete account — Supabase setup (owner only)

App Store Guideline 5.1.1(v): if an app supports account creation, it must also
offer account deletion, in-app. The "Delete account" button (Edit profile, right
under Log out) ships in the repo. It needs **one SQL statement run once** — the
same dashboard step as every other migration here.

## Run the migration
Paste [`delete-account-rpc.sql`](delete-account-rpc.sql) into Dashboard → SQL
Editor → Run. That's the whole setup: no Edge Function, no CLI, no secrets.
(It's folded into `schema.sql` too, for fresh installs.)

This used to be an Edge Function. Deploying one is the single step only the
project owner can do, it never got done, and so every "Delete account" tap hit a
404 and showed "Try again in a moment" — people were stuck in accounts they'd
asked to leave. A SECURITY DEFINER function needs no deploy, so it can't rot the
same way.

## What it does
On tap, after the "are you sure" sheet, `deleteAccount()` in `js/store.js`:

1. Clears the caller's `media/{uid}/` Storage folder (avatars, post photos, and
   videos aren't covered by a foreign key, so they don't cascade). This goes
   first — `storage.objects` points back at the owner, so a leftover file can
   block the row delete.
2. Calls `delete_account()`, which deletes the caller's `auth.users` row. The
   function takes no arguments and reads `auth.uid()` itself, so there's no id to
   pass and no id to tamper with — you can only ever delete yourself.

The row delete cascades through `public.users` to every post, comment, like,
headcount row, poll vote, friend edge, block, and push subscription — see the
`on delete cascade` chain in `schema.sql`. Nothing of theirs is left behind.

## Test
Sign in on a throwaway account, add a post or two, upload an avatar, then
Edit profile → Delete account → confirm. You should land back on the signed-out
gate with a toast, and the account (rows + Storage files) should be gone from
the dashboard.
