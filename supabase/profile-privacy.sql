-- ============================================================================
-- Tria — profile privacy (private accounts)
--
-- Goal: a person can fence their posts to friends. When PRIVATE, only mutual
-- friends (and themselves) can see their notes / finds / photos / activities.
-- When PUBLIC, notes / finds / photos are world-readable again (activities stay
-- friends-only, unchanged — that gate lives in the app, matching today).
--
-- All CURRENT users are set private by the backfill below, per the product ask;
-- new signups inherit the column default (private), so the app opens closed.
--
-- Layered on top of the audience-targeting work (activity-audience.sql): the
-- read policy already resolves 'list' posts through can_see_post(). This adds a
-- second gate — the author's privacy — in a wrapper, can_view_post(), so the
-- two rules compose. Same SECURITY DEFINER trick to dodge the posts ⇄ policy
-- recursion (the definer runs as owner and bypasses RLS on its inner reads).
--
-- Additive + idempotent. Safe to run on production. Run PART 1; reload the app.
-- PART 2 is an optional verify that persists nothing (it rolls back).
-- ============================================================================


-- ── PART 1 · MIGRATION ──────────────────────────────────────────────────────

-- 1a. The flag. Default true so a brand-new account is private out of the gate.
alter table public.users
  add column if not exists private boolean not null default true;

-- 1b. Backfill: every existing account becomes private (explicit, though the
--     default above already covers rows added by this ALTER).
update public.users set private = true;

-- 1c. Visibility wrapper: the audience rule (can_see_post) AND the privacy rule.
--     Visible when the audience check passes and the author is public, is you, or
--     is a mutual friend. Reads users + friends as the definer, so it never
--     re-enters the posts read policy → no recursion. auth.uid() still resolves to
--     the real caller under SECURITY DEFINER (it reads the request JWT).
create or replace function public.can_view_post(p_audience text, p_author uuid, p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_see_post(p_audience, p_author, p_id)
     and (
       p_author = auth.uid()
       or (select not private from public.users where id = p_author)
       or exists (
         select 1
           from public.friends f1
           join public.friends f2 on f2.a = f1.b and f2.b = f1.a
          where f1.a = auth.uid() and f1.b = p_author
       )
     );
$$;
-- No `to` clause on the policy below (it must serve anon like the old
-- "posts read all"), so anon must be able to run the function too. For anon,
-- auth.uid() is null → private authors' posts fall away, public ones stay.
grant execute on function public.can_view_post(text, uuid, uuid) to anon, authenticated;

-- 1d. Swap the read policy to the privacy-aware wrapper.
drop policy if exists "posts read all"     on public.posts;
drop policy if exists "posts read visible" on public.posts;
create policy "posts read visible" on public.posts
  for select using ( public.can_view_post(audience, author, id) );

-- Quick sanity: column, function, and policy all present (expect ok = 1 each).
select 'users.private'    as check, count(*) as ok
  from information_schema.columns
  where table_name = 'users' and column_name = 'private'
union all
select 'can_view_post fn', count(*) from pg_proc where proname = 'can_view_post'
union all
select 'read policy',      count(*) from pg_policies
  where tablename = 'posts' and policyname = 'posts read visible';


-- ── PART 2 · VERIFY ─────────────────────────────────────────────────────────
-- Proves a PRIVATE author's post is hidden from a non-friend but visible to a
-- mutual friend and to the author. The SQL editor runs as a superuser that
-- BYPASSES RLS, so we impersonate each user with set_config + set local role.
-- The block ENDS IN ROLLBACK — nothing here persists.
--
-- Fill in three real ids from your users list, then select the whole
-- begin; … rollback; block and Run.

begin;
  -- ┌─────────────── the three players (edit the ids) ─────────────────────────┐
  select set_config('t.author', '00000000-0000-0000-0000-000000000000', true);  -- private; owns the post
  select set_config('t.friend', '00000000-0000-0000-0000-000000000000', true);  -- mutual friend → SEES it
  select set_config('t.stranger','00000000-0000-0000-0000-000000000000', true); -- not a friend → does NOT
  -- └──────────────────────────────────────────────────────────────────────────┘

  -- Make the author private and wire up the mutual friendship (both directions).
  update public.users set private = true where id = current_setting('t.author')::uuid;
  insert into public.friends (a, b) values
    (current_setting('t.author')::uuid, current_setting('t.friend')::uuid),
    (current_setting('t.friend')::uuid, current_setting('t.author')::uuid)
  on conflict do nothing;

  -- A throwaway note by the private author.
  insert into public.posts (author, type, title, note, audience)
  values (current_setting('t.author')::uuid, 'note', 'Privacy test note', 'friends only', 'circle');

  -- As the STRANGER → want 0.
  select set_config('request.jwt.claims', json_build_object(
    'sub', current_setting('t.stranger'), 'role', 'authenticated')::text, true);
  set local role authenticated;
  select set_config('t.n_stranger',
    (select count(*) from public.posts where title = 'Privacy test note')::text, true);
  reset role;

  -- As the FRIEND → want 1.
  select set_config('request.jwt.claims', json_build_object(
    'sub', current_setting('t.friend'), 'role', 'authenticated')::text, true);
  set local role authenticated;
  select set_config('t.n_friend',
    (select count(*) from public.posts where title = 'Privacy test note')::text, true);
  reset role;

  -- As the AUTHOR → want 1.
  select set_config('request.jwt.claims', json_build_object(
    'sub', current_setting('t.author'), 'role', 'authenticated')::text, true);
  set local role authenticated;
  select set_config('t.n_author',
    (select count(*) from public.posts where title = 'Privacy test note')::text, true);
  reset role;

  select current_setting('t.n_stranger') as "stranger (want 0)",
         current_setting('t.n_friend')   as "friend (want 1)",
         current_setting('t.n_author')   as "author (want 1)";
rollback;
