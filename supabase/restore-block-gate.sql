-- ============================================================================
-- Tria — restore the block gate on top of per-post audience
--
-- REGRESSION FIX. post-audience-public.sql step 1c rewrote can_view_post() to be
-- per-post authoritative, but its new body dropped the is_blocked_pair() clause
-- that blocks.sql had folded in. `create or replace` overwrote it silently, so
-- blocking stopped being enforced at the database.
--
-- Why that direction matters: the "blocks read own" policy means a client only
-- ever learns about blocks IT created. The DB function is the only thing that
-- enforced the other direction — someone blocking YOU. Without it, Postgres
-- hands their rows to your client and nothing client-side filters them, because
-- your cache has no row for a block you didn't make.
--
-- This restores that one clause. Audience semantics are unchanged: the case
-- expression below is byte-for-byte the one from post-audience-public.sql.
--
-- Additive + idempotent. Safe to run on production. Run PART 1; reload the app.
-- PART 2 is an optional verify that persists nothing (it rolls back).
-- ============================================================================


-- ── PART 1 · MIGRATION ──────────────────────────────────────────────────────

-- Block gate FIRST, then the per-post audience decision. A block beats every
-- audience level, 'public' included: a blocked pair sees nothing of each other,
-- however the post is tagged.
--
-- anon (auth.uid() is null) is unaffected: is_blocked_pair(null, author) finds
-- no row and returns false, so `not false` passes and only 'public' clears the
-- case below, exactly as before.
create or replace function public.can_view_post(p_audience text, p_author uuid, p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not public.is_blocked_pair(auth.uid(), p_author)
     and case
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

-- The read policy already points at can_view_post, so replacing the function is
-- enough. Re-asserted so this file stands alone on a fresh DB.
drop policy if exists "posts read visible" on public.posts;
create policy "posts read visible" on public.posts
  for select using ( public.can_view_post(audience, author, id) );

-- Quick sanity: the function body mentions is_blocked_pair again (ok = 1).
select 'block gate present' as check, count(*) as ok
  from pg_proc
  where proname = 'can_view_post'
    and prosrc like '%is_blocked_pair%'
union all
select 'read policy', count(*) from pg_policies
  where tablename = 'posts' and policyname = 'posts read visible';


-- ── PART 2 · VERIFY ─────────────────────────────────────────────────────────
-- Proves the direction that broke: an author's PUBLIC post is visible to a
-- stranger, then vanishes once THAT STRANGER blocks the author (the blocked
-- party's own client could never have filtered this). Ends in ROLLBACK.
--
-- Fill in two real ids, then select the whole begin; … rollback; block and Run.

begin;
  -- ┌─────────────── the two players (edit the ids) ───────────────────────────┐
  select set_config('t.author',  '00000000-0000-0000-0000-000000000000', true);  -- owns the post
  select set_config('t.blocker', '00000000-0000-0000-0000-000000000000', true);  -- blocks the author
  -- └──────────────────────────────────────────────────────────────────────────┘

  insert into public.posts (author, type, title, note, audience)
  values (current_setting('t.author')::uuid, 'note', 'Block gate test', 'hello', 'public');

  -- As the blocker, BEFORE the block → want 1 (a public post, plainly visible).
  select set_config('request.jwt.claims', json_build_object(
    'sub', current_setting('t.blocker'), 'role', 'authenticated')::text, true);
  set local role authenticated;
  select set_config('t.n_before',
    (select count(*) from public.posts where title = 'Block gate test')::text, true);
  reset role;

  insert into public.blocks (blocker, blocked)
  values (current_setting('t.blocker')::uuid, current_setting('t.author')::uuid)
  on conflict do nothing;

  -- As the blocker, AFTER the block → want 0.
  select set_config('request.jwt.claims', json_build_object(
    'sub', current_setting('t.blocker'), 'role', 'authenticated')::text, true);
  set local role authenticated;
  select set_config('t.n_after',
    (select count(*) from public.posts where title = 'Block gate test')::text, true);
  reset role;

  -- The direction the client CANNOT cover: as the AUTHOR (who never blocked
  -- anyone and has no block row in their cache), the blocker's post → want 0.
  insert into public.posts (author, type, title, note, audience)
  values (current_setting('t.blocker')::uuid, 'note', 'Blocker public note', 'hi', 'public');

  select set_config('request.jwt.claims', json_build_object(
    'sub', current_setting('t.author'), 'role', 'authenticated')::text, true);
  set local role authenticated;
  select set_config('t.n_reverse',
    (select count(*) from public.posts where title = 'Blocker public note')::text, true);
  reset role;

  select current_setting('t.n_before')  as "before block (want 1)",
         current_setting('t.n_after')   as "after block (want 0)",
         current_setting('t.n_reverse') as "reverse dir (want 0)";
rollback;
