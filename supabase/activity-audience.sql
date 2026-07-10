-- ============================================================================
-- Tria — activity audience targeting (v2, feed-safe)
--
-- Goal: an activity is visible to EVERYONE in the author's circle (default,
-- exactly like today) OR only to a hand-picked list of users.
--
-- What changed from v1 (the version that darkened the feed):
--   1. The read policy is NO LONGER scoped `to authenticated`. The app reads the
--      feed with the anon publishable key, so an authenticated-only read policy
--      hid every post from the anon reader → dark feed. This policy is
--      role-agnostic (applies to `public`), so `circle` posts stay readable just
--      like the old "posts read all". Since every existing post is `circle`, the
--      feed CANNOT go dark from running PART 1.
--   2. The visibility check moved into a SECURITY DEFINER function. Without it,
--      the posts policy reads post_audience and post_audience's policy reads
--      posts → Postgres throws "infinite recursion detected in policy" the first
--      time a `list` post is queried. The definer function bypasses that.
--
-- Run PART 1 (safe on the live DB), reload the app to confirm the feed is fine,
-- then run PART 2 to verify targeting. PART 2 persists NOTHING (it rolls back).
-- ============================================================================


-- ── PART 1 · MIGRATION ──────────────────────────────────────────────────────
-- Additive + idempotent. Safe to run on production.

-- 1a. Audience mode on posts. 'circle' = visible like today; 'list' = only the
--     author + rows in post_audience below. Existing rows backfill to 'circle'.
alter table public.posts
  add column if not exists audience text not null default 'circle';

alter table public.posts
  drop constraint if exists posts_audience_check;
alter table public.posts
  add constraint posts_audience_check check (audience in ('circle', 'list'));

-- 1b. The allowlist: who may see a 'list' post. The author is always implicitly
--     allowed (handled in the visibility function), so they never need a row.
create table if not exists public.post_audience (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  primary key (post_id, user_id)
);
alter table public.post_audience enable row level security;

-- 1c. RLS on the allowlist.
--     Read a row if it's about you, or you authored the post (so a future editor
--     can load an existing audience). Only the author may add/remove rows.
drop policy if exists "post_audience read own-or-author" on public.post_audience;
create policy "post_audience read own-or-author" on public.post_audience
  for select to authenticated using (
    user_id = auth.uid()
    or exists (select 1 from public.posts p where p.id = post_id and p.author = auth.uid())
  );
drop policy if exists "post_audience insert by author" on public.post_audience;
create policy "post_audience insert by author" on public.post_audience
  for insert to authenticated with check (
    exists (select 1 from public.posts p where p.id = post_id and p.author = auth.uid())
  );
drop policy if exists "post_audience delete by author" on public.post_audience;
create policy "post_audience delete by author" on public.post_audience
  for delete to authenticated using (
    exists (select 1 from public.posts p where p.id = post_id and p.author = auth.uid())
  );

-- 1d. Visibility helper. SECURITY DEFINER so it runs as the owner and reads
--     post_audience WITHOUT re-entering that table's RLS — which is what breaks
--     the posts ⇄ post_audience recursion. `auth.uid()` still returns the real
--     caller (it reads the request JWT, which SECURITY DEFINER does not change).
create or replace function public.can_see_post(p_audience text, p_author uuid, p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_audience = 'circle'
      or p_author = auth.uid()
      or exists (
        select 1 from public.post_audience
        where post_id = p_id and user_id = auth.uid()
      );
$$;
grant execute on function public.can_see_post(text, uuid, uuid) to anon, authenticated;

-- 1e. Swap the blanket read policy for the audience-aware one. NO `to` clause on
--     purpose — it must apply to `anon` (how the app reads the feed) exactly like
--     the old "posts read all" did, or the feed goes dark again. 'circle' posts
--     stay world-readable; 'list' posts resolve through the function above.
drop policy if exists "posts read all"     on public.posts;
drop policy if exists "posts read visible" on public.posts;
create policy "posts read visible" on public.posts
  for select using ( public.can_see_post(audience, author, id) );

-- Quick sanity: column, policy, and function all exist (expect ok = 1 on each).
select 'posts.audience'   as check, count(*) as ok
  from information_schema.columns
  where table_name = 'posts' and column_name = 'audience'
union all
select 'read policy', count(*) from pg_policies
  where tablename = 'posts' and policyname = 'posts read visible'
union all
select 'can_see_post fn', count(*) from pg_proc where proname = 'can_see_post';


-- ── PART 2 · VERIFY ─────────────────────────────────────────────────────────
-- Proves a 'list' activity is hidden from a non-invited friend but visible to
-- the invited one and the author. The SQL editor runs as a superuser that
-- BYPASSES RLS, so we impersonate each user with set_config + set local role.
--
-- No temp tables (the editor drops them between statements). We stash the three
-- ids and the three counts in transaction-local settings instead. The block
-- ENDS IN ROLLBACK — the throwaway post never persists, nothing to clean up.
--
-- The three ids below are already filled in from your users list. To use
-- different people, paste another `id` into any of the first three lines.
-- Then select this ENTIRE block (begin; … rollback;) and Run.

begin;
  -- ┌─────────────── the three players (edit the ids if you like) ─────────────┐
  select set_config('t.author',   '7175bb93-1361-43bb-b92d-172adcdf5467', true);  -- throws it
  select set_config('t.invited',  '81ea3b32-14f0-4c09-857a-b86b3f4644a7', true);  -- should SEE it
  select set_config('t.outsider', '80a6df8d-31ed-4646-8c25-2d773d1e4439', true);  -- should NOT
  -- └──────────────────────────────────────────────────────────────────────────┘

  -- Admin (bypasses RLS) plants a throwaway 'list' activity + one invite.
  insert into public.posts (author, type, title, note, location, audience)
  values (current_setting('t.author')::uuid,
          'activity', 'RLS test activity', 'invite-only', 'Somewhere', 'list');
  insert into public.post_audience (post_id, user_id)
  select id, current_setting('t.invited')::uuid
    from public.posts where title = 'RLS test activity';

  -- As the OUTSIDER (not invited) → want 0.
  select set_config('request.jwt.claims', json_build_object(
    'sub', current_setting('t.outsider'), 'role', 'authenticated')::text, true);
  set local role authenticated;
  select set_config('t.n_outsider',
    (select count(*) from public.posts where title = 'RLS test activity')::text, true);
  reset role;

  -- As the INVITED user → want 1.
  select set_config('request.jwt.claims', json_build_object(
    'sub', current_setting('t.invited'), 'role', 'authenticated')::text, true);
  set local role authenticated;
  select set_config('t.n_invited',
    (select count(*) from public.posts where title = 'RLS test activity')::text, true);
  reset role;

  -- As the AUTHOR → want 1.
  select set_config('request.jwt.claims', json_build_object(
    'sub', current_setting('t.author'), 'role', 'authenticated')::text, true);
  set local role authenticated;
  select set_config('t.n_author',
    (select count(*) from public.posts where title = 'RLS test activity')::text, true);
  reset role;

  -- One tidy result row.
  select current_setting('t.n_outsider') as "outsider (want 0)",
         current_setting('t.n_invited')  as "invited (want 1)",
         current_setting('t.n_author')   as "author (want 1)";
rollback;
