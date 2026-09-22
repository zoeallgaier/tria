# Sign in with Apple / Google — setup (owner only)

The app side ships in the repo: the two buttons on the gate, the native Apple
sheet (`ios/App/App/TriaAuthPlugin.swift`), the browser sheet Google comes back
through, and the handle screen that follows a first sign-in. These are the
**dashboard and developer-portal steps only the project owner can do**, plus the
one SQL file. Do them in order; the buttons are dead until all of them are done,
and each one fails in a different place.

> **Status (2026-09-22): none of this has been done yet.** The code is written
> and the build carries it. Until step 1 runs, the first person to tap either
> button gets "Tria can’t finish setting up new accounts right now" and no
> account is created (the trigger rolls the auth row back with it, so there is
> nothing to clean up). Until steps 2–4, the tap gets "That way in isn’t
> switched on yet."

**Apple and Google are a package, not a menu.** App Store guideline **4.8** says
an app offering a third-party sign-in must also offer one that limits data
collection to name and email, lets the person keep the email private, and does
no advertising tracking. Sign in with Apple is that option. So Google may not
ship without Apple, and if Apple ever has to come out, Google comes out with it.

## 1. The database
SQL Editor → run [`oauth-signin.sql`](oauth-signin.sql).

Two things: `handle_new_user` stops trying to invent a username for a sign-in
that carries none, and `claim_profile` appears, which is how the handle screen
writes the profile row. Read that file's header for why there is no provisional
handle.

Check it took, from anywhere with the publishable key:

```
curl -s -X POST "$SUPABASE_URL/rest/v1/rpc/claim_profile" \
  -H "apikey: $PUBLISHABLE_KEY" -H "Content-Type: application/json" \
  -d '{"p_username":"x","p_name":"x"}'
```

`{"code":"28000", ... "You need to be signed in."}` means it is installed (an
anon caller has no `auth.uid()`). `PGRST202` means it is not. Note the argument
names: a wrong signature answers `PGRST202` whether or not the function exists.

## 2. Google
Nothing about this app goes to Google. **Supabase is the OAuth client**, so
Google never sees `tria://`, and the app needs no client id, no SDK and nothing
in `package.json`.

1. Google Cloud Console → APIs & Services → Credentials → **Create OAuth client
   ID** → **Web application**.
2. Authorised redirect URI: `https://autjondbgcjctezbxliv.supabase.co/auth/v1/callback`
   — the Supabase callback, not Tria's.
3. OAuth consent screen: External, app name **Tria**, support email, the
   `email` and `profile` scopes (the defaults). Publish it, or only test users
   can sign in.
4. Supabase → Authentication → Providers → **Google** → on, paste the client ID
   and secret.

## 3. Apple
Apple is two registrations, because the app and the website are two clients and
Tria uses both: the native sheet presents the **bundle ID** as its audience, and
the web gate presents a **Services ID**.

In the Apple Developer portal:

1. **Certificates, Identifiers & Profiles → Identifiers → App IDs →
   `com.triaonline.tria`** → tick **Sign in with Apple** → Save.
   The entitlement in `App.entitlements` is already in the repo, but automatic
   signing can only put a capability in the *profile*; it cannot put it on the
   App ID. Skip this and the build still succeeds, the button still appears, and
   the tap does nothing.
2. **Identifiers → Services IDs → new**, e.g. `com.triaonline.tria.web`. Enable
   Sign in with Apple, Configure:
   - Primary App ID: `com.triaonline.tria`
   - Domains: `triaonline.com` (whatever GitHub Pages serves)
   - Return URLs: `https://autjondbgcjctezbxliv.supabase.co/auth/v1/callback`
3. **Keys → new key**, tick Sign in with Apple, pick the App ID, download the
   `.p8`. **It downloads once.** Note the Key ID and the Team ID (`8L793UU9T2`).
4. Supabase → Authentication → Providers → **Apple** → on:
   - Client IDs: **`com.triaonline.tria.web,com.triaonline.tria`** — the Services
     ID *and* the bundle ID, comma-separated. The bundle ID is the one the native
     token's `aud` carries, and leaving it out is the failure that looks like
     everything is configured: the browser flow works, the phone says the token
     is for the wrong audience.
   - Secret Key, Key ID, Team ID from step 3.

## 4. Redirect URLs
Supabase → Authentication → URL Configuration → Redirect URLs. Add both:

| URL | Used by |
|---|---|
| `tria://auth-callback` | Google in the iOS app (`NATIVE_REDIRECT` in js/store.js) |
| `https://triaonline.com/` | both providers on the web |

A redirect that is not on this list is dropped, and the app's sheet then sits
open with nothing in it and no error anywhere. The scheme half is declared in
`ios/App/App/Info.plist` (`CFBundleURLTypes`); the two have to agree.

## 5. Linking, and the person who already has a password
Supabase links a provider identity to an existing user when the provider's email
matches an existing **confirmed** email. So somebody who joined with
`you@gmail.com` and a password, then taps Continue with Google, lands in their
own account rather than a second empty one. It is on by default; it is worth
confirming under Authentication → Providers that nothing has turned it off.

**Hide My Email makes a new account, and that is correct.** Apple's relay
address is a different email, so it is a different person as far as matching
goes. There is no way around that and no way to guess around it.

## What each failure looks like

| What you see | Where to look |
|---|---|
| "Tria can’t finish setting up new accounts right now" | step 1 |
| "That way in isn’t switched on yet" | the provider is off (2 or 3), or the redirect URL is not allow-listed (4) |
| Apple sheet never appears, no error | Sign in with Apple is not on the **App ID** (3.1) |
| Google's sheet opens and then hangs on the last redirect | `tria://auth-callback` missing from step 4 |
| Web works, phone says the audience is wrong | the bundle ID is missing from Apple's Client IDs (3.4) |
