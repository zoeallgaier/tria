-- ============================================================================
-- Tria — a follow that ages, and a decline that sticks.
--
-- Two problems, one root: a directed friends edge carried no time and no memory
-- of being answered, so the Updates page could only ever render it as a standing
-- fact. "X started following you" therefore sat pinned above the ledger with an
-- Add-back button on it forever, and Ignore deleted the row so cleanly that the
-- same person re-adding you put it straight back.
--
-- 1. friends.created_at — an edge is an EVENT, so it gets a time and can be
--    filed in the ledger with the likes and comments, ageing down the list.
--    Deliberately NOT backfilled: `add column` with a default would stamp every
--    friendship you already have with the moment this migration ran and dump the
--    lot at the top of everybody's Updates. Existing rows stay null and the app
--    skips them (see notifications() in store.js) — history nobody was notified
--    about at the time stays quiet. The default applies from here on.
--
-- 2. friend_declines — a request you turned down, remembered. Deleting the edge
--    (which is still what Ignore does) is not an answer, because nothing stops
--    the same person asking again tomorrow; this row is what makes "no" durable.
--    It suppresses the pinned request AND its push, silently — a decline is
--    quiet by design, exactly like a block, and for the same reason: the person
--    turned down learns nothing.
--
-- Additive + idempotent. Safe to run on production, and safe to run BEFORE the
-- matching app deploy — the app tolerates both the missing column and the
-- missing table (falls back to a per-device localStorage mirror for declines,
-- the same way blocking worked before blocks.sql).
-- ============================================================================


-- 1. Stamp new edges. Two statements on purpose: `add column ... default now()`
--    would backfill every existing row (see above), so the column arrives empty
--    and only then learns its default.
alter table public.friends add column if not exists created_at timestamptz;
alter table public.friends alter column created_at set default now();


-- 2. One row per (decliner, declined): "I turned this person down." Cascade so a
--    deleted account takes its rows with it. You can't decline yourself.
create table if not exists public.friend_declines (
  decliner   uuid not null references public.users(id) on delete cascade,
  declined   uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (decliner, declined),
  check (decliner <> declined)
);

-- RLS mirrors blocks exactly: you see, create and clear only your own rows, and
-- nobody can read that they were declined. Reading the other direction is the
-- one thing this table must never allow — the whole point is that the answer is
-- private. (The push function reads it with the service key, which bypasses RLS.)
alter table public.friend_declines enable row level security;

drop policy if exists "declines read own"   on public.friend_declines;
drop policy if exists "declines insert own" on public.friend_declines;
drop policy if exists "declines delete own" on public.friend_declines;

create policy "declines read own" on public.friend_declines
  for select to authenticated using ( decliner = auth.uid() );
create policy "declines insert own" on public.friend_declines
  for insert to authenticated with check ( decliner = auth.uid() );
create policy "declines delete own" on public.friend_declines
  for delete to authenticated using ( decliner = auth.uid() );
