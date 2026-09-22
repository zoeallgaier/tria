# Sign in with Apple / Google — setup (owner only)

The app side ships in the repo: the two buttons on the gate, the native Apple
sheet (`ios/App/App/TriaAuthPlugin.swift`), the browser sheet Google comes back
through, and the handle screen that follows a first sign-in. These are the
**dashboard and developer-portal steps only the project owner can do**, plus the
one SQL file. Do them in order; the buttons are dead until all of them are done,
and each one fails in a different place.

> **Status (2026-09-22): step 1 is done. Steps 2 to 4 are not.** The code is
> written, the build carries it, and the database has `claim_profile` — live, it
> answers `28000 "You need to be signed in."` to an anon caller, which is a
> sentence that exists only in `oauth-signin.sql`. What is left is all dashboard
> and developer-portal state, and until it is there a tap on either button gets
> "That way in isn’t switched on yet." Nothing half-lands on the way.

**Apple and Google are a package, not a menu.** App Store guideline **4.8** says
an app offering a third-party sign-in must also offer one that limits data
collection to name and email, lets the person keep the email private, and does
no advertising tracking. Sign in with Apple is that option. So Google may not
ship without Apple, and if Apple ever has to come out, Google comes out with it.

## 1. The database — DONE (2026-09-22)
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

At <https://console.cloud.google.com>. **The project is `tria-509420`** (name
Tria, number 763070720120, no organisation), made 2026-09-22. **The consent
screen has to come first** — the Create Client button is refused without it.

The console is mid-rename and the menus move, so go straight in. These carry the
project, which is the other thing that is easy to get wrong here — Google is
happy to let you configure the wrong one:

| | |
|---|---|
| Branding (consent screen) | <https://console.cloud.google.com/auth/branding?project=tria-509420> |
| Audience (External + publish) | <https://console.cloud.google.com/auth/audience?project=tria-509420> |
| Clients (make the web client) | <https://console.cloud.google.com/auth/clients?project=tria-509420> |

On an older console those three are one page at
`/apis/credentials/consent` plus `/apis/credentials`.

1. **APIs & Services → OAuth consent screen.** Newer consoles have renamed this
   to **Google Auth Platform**, where the same thing is split across *Branding*,
   *Audience* and *Clients*; both layouts are in the wild, so go by the words
   rather than the path.
   - User type / Audience: **External**
   - App name **Tria**, a user support email, a developer contact email
   - Scopes: leave the defaults (`openid`, `email`, `profile`). Tria asks for
     nothing beyond a name and an address, which is also what keeps it out of
     Google's verification queue.
2. **Publish it.** An app left in *Testing* only admits accounts added by hand
   to the test-user list, capped at 100, and hands out refresh tokens that
   expire in 7 days. Publishing status → **Publish app** / **Go to production**.
   This is the step that makes Google sign-in work for a stranger and not just
   for you, and it does not announce itself when skipped.
3. **Credentials → Create credentials → OAuth client ID → Web application.**
   NOT iOS. Supabase is the OAuth client, so Google is talking to
   `supabase.co` and has no idea this app exists; an iOS client here issues no
   secret and Supabase's form has nowhere to put it.
   - Name: anything, e.g. `Tria via Supabase`
   - **Authorised redirect URIs:**
     `https://autjondbgcjctezbxliv.supabase.co/auth/v1/callback`
     Supabase prints this on its own Google provider page — copy it from there
     rather than retyping it.
   - Authorised JavaScript origins: leave empty. Nothing in this flow runs
     Google's JS on Tria's own page.
4. **Create.** The modal that appears carries the **Client ID** and **Client
   secret**. The secret is shown once and is re-downloadable from the client's
   row afterwards.
5. Supabase → Authentication → Sign In / Providers → **Google** → on, paste
   both, Save.

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

**Site URL, on the same screen, is not decoration.** It is where GoTrue sends
anything whose `redirect_to` does NOT match the list above, and it is the
fallback baked into `{{ .ConfirmationURL }}` in the password-reset email
(`supabase/email-templates/`). It read `http://127.0.0.1:5500` on 2026-09-22 —
a dev leftover — which means a reset link built while `https://triaonline.com/`
was missing from the allow list pointed at a port on the reader's own machine.
It should be `https://triaonline.com`. Nothing about provider sign-in depends on
it, because js/store.js always passes an explicit `redirectTo`; the reset email
is what it reaches.

## 5. Linking, and the person who already has a password
Supabase links a provider identity to an existing user when the provider's email
matches an existing **confirmed** email. So somebody who joined with
`you@gmail.com` and a password, then taps Continue with Google, lands in their
own account rather than a second empty one. It is on by default; it is worth
confirming under Authentication → Providers that nothing has turned it off.

**Hide My Email makes a new account, and that is correct.** Apple's relay
address is a different email, so it is a different person as far as matching
goes. There is no way around that and no way to guess around it.

## Checking the dashboard half without the dashboard

**`/auth/v1/settings` is public and authoritative**, which makes the provider
toggles one of the few pieces of dashboard state that is verifiable read-only —
a better answer than "it should be on by now":

```
curl -s https://autjondbgcjctezbxliv.supabase.co/auth/v1/settings \
  -H "apikey: $PUBLISHABLE_KEY" | python3 -m json.tool
```

`external.apple` and `external.google` are the two to read, and they are the
project's own state rather than a guess from a failed sign-in. `/auth/v1/authorize`
seconds it with the message the app would show:

```
curl -s "https://autjondbgcjctezbxliv.supabase.co/auth/v1/authorize?provider=google&redirect_to=tria%3A%2F%2Fauth-callback"
```

A provider that is off answers `400 validation_failed`, "Unsupported provider:
provider is not enabled" — which is exactly the string `providerError` in
js/store.js turns into "That way in isn't switched on yet."

What neither reaches: whether the **client id and secret are the right ones**,
whether the Services ID and bundle ID are **both** in Apple's Client IDs, and
whether the redirect URLs are allow-listed. A provider reading `true` means it
was switched on, not that it was switched on correctly.

**Seen in the wild, 2026-09-22:** `external.apple` read `true` while
`/authorize` answered `400 validation_failed`, "Unsupported provider: missing
OAuth secret" — the toggle flipped and saved with the Secret Key field empty.
Two things follow. The settings probe alone would have called that done, so read
BOTH. And it does not mean Apple is dead on the phone: `signInWithIdToken`
verifies the identity token against Apple's public keys and checks its `aud`
against the Client IDs list, and never touches the OAuth secret, which exists
for the authorization-code exchange the WEB flow does. So the same half-finished
provider can work in the app and fail in a browser, which is not a shape most
misconfigurations have.

## What each failure looks like

| What you see | Where to look |
|---|---|
| "Tria can’t finish setting up new accounts right now" | step 1 |
| "That way in isn’t switched on yet" | the provider is off (2 or 3), or the redirect URL is not allow-listed (4). `/auth/v1/settings` above says which. |
| `settings` says `true`, `/authorize` says "missing OAuth secret" | the toggle is on and the Secret Key field is empty. Apple: the `.p8` contents from step 3.3. Google: the client secret from step 2.4. |
| Apple sheet never appears, no error | Sign in with Apple is not on the **App ID** (3.1) |
| Google's sheet opens and then hangs on the last redirect | `tria://auth-callback` missing from step 4 |
| Web works, phone says the audience is wrong | the bundle ID is missing from Apple's Client IDs (3.4) |
