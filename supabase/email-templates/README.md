# Tria auth emails

Two branded HTML templates for Supabase's transactional auth mail, plus the
dashboard/DNS steps that make them send from a Tria address (only Zoe has
Supabase admin, so these are done by hand in the dashboard).

## The templates
- `confirm-signup.html` — paste into **Authentication → Email Templates →
  "Confirm signup"**. Lavender accent (the "note" post type).
- `reset-password.html` — paste into **Authentication → Email Templates →
  "Reset password"**. Coral accent (the "find" post type).

Both use the `{{ .ConfirmationURL }}` merge tag Supabase fills at send time.
Table-based layout (that part still has to survive everywhere), with a
`<link>` to the same Google Fonts URL the app uses (Instrument Serif +
Oxygen) so clients that render web fonts in mail (Apple/iOS Mail, most
others) show the real typefaces. Clients that strip `<style>`/`<link>`
(Gmail, Outlook.com) fall through to the Georgia/system-sans stack, which is
tuned to sit close to it.

## Turning the flows on (Zoe, in the dashboard)
1. **Confirm email:** Authentication → Settings → turn **"Confirm email" ON**.
   That's the switch that starts sending the confirm-signup mail and gates login
   until a new account clicks the link. The app already handles the gated state
   (a soft "check your inbox" screen with a resend, and a resend on login too).
2. **Reset password** needs no toggle — the "Forgot password?" link in the app
   already calls it; it just needs the SMTP + template below to look like Tria.

## Sending from a Tria address (Zoe — Resend + GoDaddy + Supabase SMTP)
**You do NOT need to buy an email plan/mailbox from GoDaddy (that's the expensive
part, and it's for reading mail at an address — Tria doesn't need it). Sending
these emails only needs a sending service + proof you own the domain, both free.**

Out of the box Supabase sends these from its own generic address. To send from
`@triaonline.com`:
1. **Resend** (already signed up): add the domain `triaonline.com` (or a
   subdomain like `mail.triaonline.com`) and copy the DKIM/SPF/DMARC records it
   shows.
2. **GoDaddy DNS:** add those TXT/CNAME records to the `triaonline.com` zone and
   wait for Resend to verify the domain.
3. **Supabase → Authentication → Settings → SMTP:** enable custom SMTP, plug in
   Resend's SMTP host/port/credentials, and set the sender to something like
   `Tria <hello@triaonline.com>`.

**Replies:** nothing receives mail at that address on this setup, so a friend
hitting reply would bounce. Either send from `no-reply@triaonline.com` (these are
transactional, replies aren't expected) or set up Cloudflare Email Routing (free)
to forward `hello@triaonline.com` to your Gmail. A forwarder is not a mailbox and
is still free.

**Test-first shortcut:** the branded templates below work with Supabase's built-in
mailer too — you don't need Resend or DNS to see them. Paste the templates + turn
on Confirm-email and the emails already look like Tria; only the *from* address
stays a generic Supabase one until you add Resend. Fine for testing the flow now,
add Resend before launch to fix the sender + deliverability.

## Redirect URLs (Zoe — one dashboard field)
Authentication → URL Configuration:
- **Site URL:** the app's live origin (the GitHub Pages URL).
- **Redirect URLs:** add the same origin so the reset link is allowed to bounce
  back into the app. The app asks Supabase to redirect to the bare origin (no
  hash) on purpose — supabase-js appends the recovery token as its own `#`
  fragment, and a second `#` would collide with Tria's hash router and hide the
  token. The app then shows "Set a new password" off the recovery event, not the
  URL.

## What can only be verified live (Zoe)
The end-to-end round trip — does the Resend mail land, does the reset link route
back in and let you set a new password, does confirming flip the account — can
only be checked after the three dashboard/DNS steps above. The app-side UI and
routing are verified headless; the delivery half is yours to smoke-test.
