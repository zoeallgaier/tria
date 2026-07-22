-- ============================================================================
-- Tria — restore the comments READ policy
--
-- SYMPTOM: comments can be written but never come back. You post one and it
-- shows (the client adds it to its own cache optimistically), then it vanishes
-- the moment the world is re-pulled. Push notifications still fire, because the
-- push trigger runs server-side on the inserted row and never asks RLS anything.
--
-- WHAT THAT MEANS: this is a READ fence, not data loss. RLS hides rows, it never
-- deletes them. Every comment is still in public.comments and comes straight
-- back the moment the select policy is in place. Nothing needs recovering.
--
-- CAUSE: with RLS enabled and no SELECT policy, Postgres returns ZERO ROWS AND
-- NO ERROR. The client can't tell that apart from "nobody has commented", so it
-- renders an empty thread. (loadWorld in store.js reads `data || []` per table,
-- so a silently-empty read empties the cache.)
--
-- Additive + idempotent. Safe to run on production, and safe to run twice.
-- Run PART 0 first to see what's actually there; PART 1 is the fix.
-- ============================================================================


-- ── PART 0 · DIAGNOSE (read-only, changes nothing) ──────────────────────────
-- Run this ALONE first. It answers the one question that matters: does a SELECT
-- policy exist on comments, and who is it for?
--
-- HEALTHY looks like exactly one SELECT row:
--   comments read all | SELECT | {authenticated} | true
-- BROKEN is: no SELECT row at all (only insert/delete) → that's the bug, run
-- PART 1. Or a SELECT row whose `qual` is something other than `true` → someone
-- replaced it with a narrower rule; PART 1 puts the open one back.

select policyname, cmd, roles, qual, with_check
  from pg_policies
 where schemaname = 'public' and tablename = 'comments'
 order by cmd, policyname;

-- And confirm the rows are all still there (this counts PAST RLS, as owner):
select count(*) as comments_still_in_the_table from public.comments;


-- ── PART 1 · FIX ────────────────────────────────────────────────────────────
-- Comments are readable by any signed-in account, exactly as schema.sql has
-- always had it. The fence that matters is on the POST: if can_view_post won't
-- hand you the post, its thread never reaches your screen anyway, so there's
-- nothing for a second fence here to protect. Restated in full (not layered on
-- an older copy) per the house rule for policy rewrites.

alter table public.comments enable row level security;

drop policy if exists "comments read all" on public.comments;
create policy "comments read all" on public.comments
  for select to authenticated using (true);

-- The write side, re-asserted so this file stands alone on a fresh DB. You may
-- only sign your own comments, and you may only delete your own.
drop policy if exists "comments insert own" on public.comments;
create policy "comments insert own" on public.comments
  for insert to authenticated with check (author = auth.uid());

drop policy if exists "comments delete own" on public.comments;
create policy "comments delete own" on public.comments
  for delete to authenticated using (author = auth.uid());


-- ── PART 2 · VERIFY ─────────────────────────────────────────────────────────
-- Proves the fix from a real signed-in account's point of view, then rolls back.
-- Paste any user's id below (Authentication → Users) and run the whole block.
-- Want: a count matching what PART 0 reported.

begin;
  -- ┌─────────────── whose eyes to look through (edit the id) ────────────────┐
  select set_config('t.viewer', '00000000-0000-0000-0000-000000000000', true);
  -- └─────────────────────────────────────────────────────────────────────────┘

  select set_config('request.jwt.claims', json_build_object(
    'sub', current_setting('t.viewer'), 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) as comments_this_account_can_read from public.comments;

  reset role;
rollback;
