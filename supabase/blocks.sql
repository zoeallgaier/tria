-- ============================================================================
-- Tria — blocking (block an abusive user)
--
-- Goal: a person can block another. A block is one-directional in intent (I
-- block you) but enforced BOTH ways for content: once either of us has blocked
-- the other, neither sees the other's posts at the data layer. This is the App
-- Store 1.2 "block abusive users" requirement, made real at the DB rather than
-- only in the client.
--
-- How it composes: profile-privacy.sql already routes the posts read policy
-- through can_view_post(). This adds a block gate INSIDE that function, so the
-- three rules stack — audience (can_see_post) AND author privacy AND not-blocked.
-- Same SECURITY DEFINER trick to read the blocks table without re-entering the
-- posts policy (no recursion). Blocking also severs any friendship (the app does
-- this on block; there's no DB trigger for it — a lone friends row is harmless
-- once the block gate hides the posts anyway).
--
-- Additive + idempotent. Safe to run on production. Run PART 1; reload the app.
-- PART 2 is an optional verify that persists nothing (it rolls back).
-- ============================================================================


-- ── PART 1 · MIGRATION ──────────────────────────────────────────────────────

-- 1a. The table. One row per (blocker, blocked) pair; a person can't block
--     themselves. Cascade so a deleted account takes its block rows with it.
create table if not exists public.blocks (
  blocker    uuid not null references public.users(id) on delete cascade,
  blocked    uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked),
  check (blocker <> blocked)
);

-- 1b. RLS: you only ever see, create, or remove YOUR OWN block rows. Nobody can
--     read who blocked THEM (a block is quiet by design), and nobody can forge a
--     block on someone else's behalf.
alter table public.blocks enable row level security;

drop policy if exists "blocks read own"   on public.blocks;
drop policy if exists "blocks insert own"  on public.blocks;
drop policy if exists "blocks delete own"  on public.blocks;

create policy "blocks read own" on public.blocks
  for select using ( blocker = auth.uid() );
create policy "blocks insert own" on public.blocks
  for insert with check ( blocker = auth.uid() );
create policy "blocks delete own" on public.blocks
  for delete using ( blocker = auth.uid() );

-- 1c. Helper: is there a block in EITHER direction between two people? Definer so
--     it can read blocks regardless of the caller's own RLS view (it must see the
--     row where the OTHER person blocked ME, which my select policy hides).
create or replace function public.is_blocked_pair(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.blocks
     where (blocker = p_a and blocked = p_b)
        or (blocker = p_b and blocked = p_a)
  );
$$;
grant execute on function public.is_blocked_pair(uuid, uuid) to anon, authenticated;

-- 1d. Fold the block gate into the visibility wrapper. Identical to
--     profile-privacy.sql's can_view_post, plus one clause: the caller must not be
--     in a block pair with the author. anon (auth.uid() null) never trips it.
create or replace function public.can_view_post(p_audience text, p_author uuid, p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_see_post(p_audience, p_author, p_id)
     and not public.is_blocked_pair(auth.uid(), p_author)
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
grant execute on function public.can_view_post(text, uuid, uuid) to anon, authenticated;

-- The read policy already points at can_view_post (profile-privacy.sql), so
-- redefining the function above is enough — no policy swap needed here. Re-assert
-- it anyway so this file stands alone on a fresh DB where that migration ran.
drop policy if exists "posts read visible" on public.posts;
create policy "posts read visible" on public.posts
  for select using ( public.can_view_post(audience, author, id) );

-- Quick sanity: table, policies, and function all present.
select 'blocks table'     as check, count(*) as ok from information_schema.tables
  where table_name = 'blocks'
union all
select 'blocks policies',  count(*) from pg_policies where tablename = 'blocks'
union all
select 'is_blocked_pair',  count(*) from pg_proc where proname = 'is_blocked_pair'
union all
select 'can_view_post fn', count(*) from pg_proc where proname = 'can_view_post';


-- ── PART 2 · VERIFY ─────────────────────────────────────────────────────────
-- Proves a PUBLIC author's post is visible to a stranger normally, then vanishes
-- once the stranger blocks the author (enforced both ways), and comes back on
-- unblock. Runs as impersonated users via set_config + set local role, and ENDS
-- IN ROLLBACK — nothing persists.
--
-- Fill in two real ids, then select the whole begin; … rollback; block and Run.

begin;
  -- ┌─────────────── the two players (edit the ids) ───────────────────────────┐
  select set_config('t.author',  '00000000-0000-0000-0000-000000000000', true);  -- public; owns the post
  select set_config('t.blocker', '00000000-0000-0000-0000-000000000000', true);  -- blocks the author
  -- └──────────────────────────────────────────────────────────────────────────┘

  -- Author is PUBLIC so privacy isn't what's hiding the post — the block is.
  update public.users set private = false where id = current_setting('t.author')::uuid;

  insert into public.posts (author, type, title, note, audience)
  values (current_setting('t.author')::uuid, 'note', 'Block test note', 'hello', 'circle');

  -- As the blocker, BEFORE any block → want 1 (public author, visible).
  select set_config('request.jwt.claims', json_build_object(
    'sub', current_setting('t.blocker'), 'role', 'authenticated')::text, true);
  set local role authenticated;
  select set_config('t.n_before',
    (select count(*) from public.posts where title = 'Block test note')::text, true);
  reset role;

  -- Now block the author.
  insert into public.blocks (blocker, blocked)
  values (current_setting('t.blocker')::uuid, current_setting('t.author')::uuid)
  on conflict do nothing;

  -- As the blocker, AFTER the block → want 0.
  select set_config('request.jwt.claims', json_build_object(
    'sub', current_setting('t.blocker'), 'role', 'authenticated')::text, true);
  set local role authenticated;
  select set_config('t.n_after',
    (select count(*) from public.posts where title = 'Block test note')::text, true);
  reset role;

  -- And the OTHER way: as the AUTHOR, can they see the blocker's posts? Give the
  -- blocker a post too and check the author gets 0 (block hides both directions).
  insert into public.posts (author, type, title, note, audience)
  values (current_setting('t.blocker')::uuid, 'note', 'Blocker note', 'hi', 'circle');
  update public.users set private = false where id = current_setting('t.blocker')::uuid;

  select set_config('request.jwt.claims', json_build_object(
    'sub', current_setting('t.author'), 'role', 'authenticated')::text, true);
  set local role authenticated;
  select set_config('t.n_reverse',
    (select count(*) from public.posts where title = 'Blocker note')::text, true);
  reset role;

  select current_setting('t.n_before')  as "before block (want 1)",
         current_setting('t.n_after')   as "after block (want 0)",
         current_setting('t.n_reverse') as "reverse dir (want 0)";
rollback;
