-- ============================================================================
-- Tria — per-post PUBLIC audience (Discover, Stage 2)
--
-- Goal: the audience control graduates from Activities-only to EVERY post, with
-- a third level. A post is now one of:
--   'public'  → anyone can see it (this is what feeds Discover)
--   'circle'  → only the author's mutual friends
--   'list'    → only the author + the hand-picked people in post_audience
--
-- The important semantic change: 'circle' now ALWAYS means friends-only, even
-- for a public account. Until today a public account's 'circle' posts were
-- world-readable (that's how Discover was seeded in Stage 1). The backfill below
-- retags those as 'public' so they STAY world-readable, and from here on a fresh
-- 'circle' post is friends-only no matter how the account is set. `users.private`
-- now only drives the composer DEFAULT and the profile nudge, not visibility.
--
-- ⚠️  1c below overwrites can_view_post WITHOUT the is_blocked_pair() clause that
--     blocks.sql folded in, which silently disables blocking at the DB. Run
--     restore-block-gate.sql immediately after this file — it re-adds that one
--     clause and keeps everything else here intact.
--
-- Layers on activity-audience.sql (audience column + post_audience + the
-- SECURITY DEFINER visibility helpers) and profile-privacy.sql (can_view_post).
-- Same recursion-dodging trick: the read policy resolves through a definer
-- function so posts ⇄ post_audience never re-enters its own RLS.
--
-- Additive + idempotent. Safe to run on production. Run PART 1; reload the app.
-- PART 2 is an optional verify that persists nothing (it rolls back).
-- ============================================================================


-- ── PART 1 · MIGRATION ──────────────────────────────────────────────────────

-- 1a. Widen the audience domain to include 'public'. (Constraint first, so the
--     backfill in 1b can write the new value without tripping the old check.)
alter table public.posts
  drop constraint if exists posts_audience_check;
alter table public.posts
  add constraint posts_audience_check check (audience in ('public', 'circle', 'list'));

-- 1b. Backfill: preserve today's visibility exactly. A public account's 'circle'
--     posts are world-readable right now, so retag them 'public' — they keep the
--     same reach, now authoritatively tagged, and Discover stays populated.
--     (Private accounts' posts stay 'circle'; 'list' posts are untouched.)
update public.posts
   set audience = 'public'
 where audience = 'circle'
   and author in (select id from public.users where not private);

-- 1c. Per-post authoritative visibility. This REPLACES the compose-of-two-rules
--     wrapper from profile-privacy.sql: the account's `private` flag no longer
--     gates reads, the post's own audience does. Reads friends/post_audience as
--     the definer (owner), so it never re-enters the posts read policy.
--       public → everyone · author → self · list → allowlist · circle → mutual friend
--     For anon (auth.uid() is null) only 'public' passes, exactly as before.
create or replace function public.can_view_post(p_audience text, p_author uuid, p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_audience = 'public'   then true
    when p_author   = auth.uid() then true
    when p_audience = 'list' then exists (
      select 1 from public.post_audience
      where post_id = p_id and user_id = auth.uid()
    )
    when p_audience = 'circle' then exists (
      select 1
        from public.friends f1
        join public.friends f2 on f2.a = f1.b and f2.b = f1.a
       where f1.a = auth.uid() and f1.b = p_author
    )
    else false
  end;
$$;
grant execute on function public.can_view_post(text, uuid, uuid) to anon, authenticated;

-- Keep can_see_post coherent for anything that still calls it directly (the read
-- policy uses can_view_post above): 'public' is visible to all, like 'circle' was.
create or replace function public.can_see_post(p_audience text, p_author uuid, p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_audience in ('public', 'circle')
      or p_author = auth.uid()
      or exists (
        select 1 from public.post_audience
        where post_id = p_id and user_id = auth.uid()
      );
$$;
grant execute on function public.can_see_post(text, uuid, uuid) to anon, authenticated;

-- 1d. Re-assert the read policy on the authoritative wrapper. NO `to` clause on
--     purpose — it must serve anon (how the app reads the feed) like the old
--     "posts read all", or the feed goes dark. Idempotent restate.
drop policy if exists "posts read all"     on public.posts;
drop policy if exists "posts read visible" on public.posts;
create policy "posts read visible" on public.posts
  for select using ( public.can_view_post(audience, author, id) );

-- Quick sanity: constraint admits 'public', function + policy present (ok = 1 each).
select 'audience allows public' as check, count(*) as ok
  from pg_constraint
  where conname = 'posts_audience_check'
    and pg_get_constraintdef(oid) like '%public%'
union all
select 'can_view_post fn', count(*) from pg_proc where proname = 'can_view_post'
union all
select 'read policy', count(*) from pg_policies
  where tablename = 'posts' and policyname = 'posts read visible';


-- ── PART 2 · VERIFY ─────────────────────────────────────────────────────────
-- Proves the three-way gate, including the flip: a public account's 'circle'
-- post is now hidden from a non-friend, while a 'public' post is visible to a
-- total stranger. The SQL editor runs as a superuser that BYPASSES RLS, so we
-- impersonate each user with set_config + set local role. Ends in ROLLBACK —
-- the throwaway posts never persist.
--
-- Fill in three real ids from your users list, then select the whole
-- begin; … rollback; block and Run.

begin;
  -- ┌─────────────── the players (edit the ids) ───────────────────────────────┐
  select set_config('t.author',   '00000000-0000-0000-0000-000000000000', true);  -- owns the posts
  select set_config('t.stranger', '00000000-0000-0000-0000-000000000000', true);  -- no friendship to author
  -- └──────────────────────────────────────────────────────────────────────────┘

  -- Two throwaway posts by the author: one public, one circle. No friendship
  -- between author and stranger is created, so 'circle' must stay hidden.
  insert into public.posts (author, type, title, note, audience) values
    (current_setting('t.author')::uuid, 'note', 'Audience test public', 'hello world', 'public'),
    (current_setting('t.author')::uuid, 'note', 'Audience test circle', 'friends only', 'circle');

  -- As the STRANGER: sees the public one (want 1), not the circle one (want 0).
  select set_config('request.jwt.claims', json_build_object(
    'sub', current_setting('t.stranger'), 'role', 'authenticated')::text, true);
  set local role authenticated;
  select set_config('t.n_public',
    (select count(*) from public.posts where title = 'Audience test public')::text, true);
  select set_config('t.n_circle',
    (select count(*) from public.posts where title = 'Audience test circle')::text, true);
  reset role;

  -- As the AUTHOR: sees both of their own (want 1 and 1).
  select set_config('request.jwt.claims', json_build_object(
    'sub', current_setting('t.author'), 'role', 'authenticated')::text, true);
  set local role authenticated;
  select set_config('t.n_author_public',
    (select count(*) from public.posts where title = 'Audience test public')::text, true);
  select set_config('t.n_author_circle',
    (select count(*) from public.posts where title = 'Audience test circle')::text, true);
  reset role;

  select current_setting('t.n_public')        as "stranger sees public (want 1)",
         current_setting('t.n_circle')        as "stranger sees circle (want 0)",
         current_setting('t.n_author_public') as "author sees public (want 1)",
         current_setting('t.n_author_circle') as "author sees circle (want 1)";
rollback;
