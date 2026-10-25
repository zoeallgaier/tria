-- Charms ────────────────────────────────────────────────────────────────────
-- Six little firsts (2.0, 2026-10-24): your first post, sharing Tria with a
-- friend off the app, joining a circle, starting one, answering the daily,
-- sharing a song. Each is earned once, by doing the thing, and up to two are
-- worn on the rim of your photo.
--
-- Only what you WEAR is stored. What you have EARNED is never a row: it is read
-- straight off what you have done (your posts and circles, which the client
-- already holds; a share off the app is a mark on the device), so there is
-- nothing to backfill, nothing to drift from the truth, and no count anywhere
-- (Tria's no-COUNT rule). Which unlocks have been celebrated lives on the
-- device.
--
-- An ordered array, at most two, of known keys. The keys are the client's
-- (CHARMS in js/app.js) and never move, the same rule as users.accent: a new
-- label is free, a renamed key strands everyone wearing the old one. A new
-- charm means widening this check.
--
-- Not checked here: that you have earned what you wear. Wearing one you haven't
-- earned takes editing a request by hand and harms no one, and the check would
-- restate half the app's rules in SQL.
--
-- No new policy. "users update self" scopes the write to your own row, and
-- "users read all" hands it to every signed-in reader, which is right: a charm
-- is worn to be seen.

alter table public.users add column if not exists charms text[] not null default '{}';

alter table public.users drop constraint if exists users_charms_valid;
alter table public.users add constraint users_charms_valid check (
  cardinality(charms) <= 2
  and charms <@ array['word', 'mutual', 'joined', 'founder', 'sunny', 'repeat']::text[]
);
