-- Pronouns ──────────────────────────────────────────────────────────────────
-- Shows on the identity card, behind the handle: "@zoe · she/her". Freeform
-- text, not an enum — a dropdown fights the app's "quiet" framing and Tria's
-- copy voice doesn't do bureaucratic-picklist UI anywhere else.
--
-- Nullable, default null. Empty/null means nothing renders (no "pronouns not
-- set" placeholder), the same silence-is-fine rule the rest of the profile
-- already follows for an empty bio.
--
-- No new policy. "users update self" already scopes writes to your own row,
-- and "users read all" already hands every column to any signed-in reader,
-- which is right: your pronouns are as public as your name.

alter table public.users add column if not exists pronouns text;
