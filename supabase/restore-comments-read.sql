-- ============================================================================
-- Tria — restore the comments READ policy
--
-- ⚠ THIS WAS NOT THE BUG in July 2026, and running it changed nothing. The real
-- cause was PostgREST's 1000-row response cap: `comments` crossed 1000 rows, the
-- client asked for them oldest-first, and every comment past the cap silently
-- stopped arriving. The policy here was fine the whole time. Fixed in store.js
-- (`readAll` pages past the cap) — check that FIRST if content goes missing
-- again, because a capped read and a fenced read look identical from the app: a
-- clean 200 with rows quietly absent. This file remains valid for the case it
-- actually describes.
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
-- CAUSE: a read fence returns nothing. The usual suspect is a missing SELECT
-- policy — with RLS on and no policy, Postgres returns ZERO ROWS AND NO ERROR,
-- which the client can't tell apart from "nobody has commented". But that is not
-- the only way to get an empty thread, and PART 1 below only fixes that one. If
-- PART 1 has already been run and comments are STILL missing, work PART 0's
-- checks in order — one of them will name the real fence.
--
-- Additive + idempotent. Safe to run on production, and safe to run twice.
-- Run PART 0 first to see what's actually there; PART 1 is the fix.
-- ============================================================================


-- ── PART 0 · DIAGNOSE (read-only, changes nothing) ──────────────────────────
-- Four checks, each ruling out one way a comment can exist and still never
-- reach a screen. Run them together and read them in order.

-- 0a · Every policy on the table, permissive AND restrictive.
-- HEALTHY: exactly one SELECT row — comments read all | SELECT | PERMISSIVE |
--   {authenticated} | true
-- BROKEN: no SELECT row at all → PART 1 is your fix. A SELECT row whose `qual`
--   is narrower than `true` → someone replaced it; PART 1 puts the open one
--   back. Or — the case PART 1 CANNOT fix — a second SELECT row marked
--   RESTRICTIVE: those AND with the permissive one, so a restrictive `false`
--   (or a stale rule referencing friendship) zeroes the read no matter what
--   PART 1 creates. Drop it by name.
select policyname, cmd, permissive, roles, qual, with_check
  from pg_policies
 where schemaname = 'public' and tablename = 'comments'
 order by cmd, permissive, policyname;

-- 0b · Table grants. RLS is only half the fence: PostgREST reads as the
-- `authenticated` role, and if that role has no SELECT privilege the read fails
-- with 42501 "permission denied" no matter how open the policy is.
-- HEALTHY: `authenticated` appears with SELECT, INSERT and DELETE.
select grantee, privilege_type
  from information_schema.role_table_grants
 where table_schema = 'public' and table_name = 'comments'
   and grantee in ('anon', 'authenticated', 'service_role')
 order by grantee, privilege_type;

-- 0c · Are the rows there, and do they still point at something? This counts
-- PAST RLS (you run as owner). `orphaned` = the post was deleted out from under
-- the comment; `ghost_author` = the author has no public.users row. Either one
-- makes a comment invisible in the app even with a perfect read policy — the
-- client matches comments to posts by id and looks the author up by id.
select count(*) as total,
       count(*) filter (
         where not exists (select 1 from public.posts p where p.id = c.post_id)) as orphaned,
       count(*) filter (
         where not exists (select 1 from public.users u where u.id = c.author))  as ghost_author
  from public.comments c;

-- 0d · The six you're missing, by name. If they're listed here, nothing is lost:
-- this is a read fence, and everything comes back the moment it's down.
select c.created_at, u.username as wrote_it, left(c.body, 48) as says,
       coalesce(p.title, left(p.note, 24)) as on_post, p.audience
  from public.comments c
  left join public.users u on u.id = c.author
  left join public.posts p on p.id = c.post_id
 order by c.created_at desc
 limit 10;


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
