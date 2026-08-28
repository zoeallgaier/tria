-- ============================================================================
-- Tria — Reposts. Passing a post along, without ever widening its audience.
--
-- A repost IS a post row. That is the whole design: it inherits the feed, the
-- profile column, the edit path, the delete path, the cache, the boot read and
-- the push trigger for free, and needs no table of its own. One new column
-- (repost_of) and one new value in the type check is the entire schema change.
--
-- 1. posts.repost_of — the pointer, cascading. Deleting the original takes its
--    reposts with it, quotes included. A quote in Tria is a sentence ABOUT one
--    specific post rather than a post that stands alone, so an absence reads
--    better than a tombstone card saying the thing you came for is gone.
--
-- 2. 'repost' joins the type check. It is deliberately NOT a sixth member of
--    the app's pastel quintet — no hue, no heart, no pull-ring dot (see the
--    design note in CLAUDE.md). In SQL it is just a sixth filing.
--
-- 3. A shape check, so a repost row cannot also be a post. It carries a pointer
--    and the words of the quote (a title and a note, like any other post), and
--    never a payload of its own — no media, no poll, no place, no time.
--
-- 4. THE DOUBLE GATE, which is the point of the whole file. A repost is
--    readable only if you can read the repost AND the post it points at. That
--    is what makes "inherit, never widen" true in the database rather than in
--    the client's good intentions, and it is why a circle post reposted by a
--    friend reaches only the people who were already allowed to see it.
--
--    can_view_post is NOT rewritten here, on purpose. It is this schema's worst
--    regression site — restore-block-gate.sql exists only because a `create or
--    replace` silently dropped its is_blocked_pair clause. So the new condition
--    goes in a SEPARATE function and the POLICY is replaced instead. Blocking
--    then falls out for free: can_view_original calls can_view_post, which
--    still checks is_blocked_pair against the ORIGINAL's author.
--
-- Additive + idempotent. Safe to run on production, and safe to run BEFORE the
-- matching app deploy — a client that has never heard of repost_of selects it
-- as one more column it ignores.
--
-- NOTE it is NOT safe to run AFTER the app deploy without noticing: the repost
-- glyph is a visible control, and until this file has run every tap on it fails
-- with 42703 and toasts "Couldn't repost, try again." Run this first.
--
-- HOW TO RUN IT: select the whole file and Run. That is now safe, and it was not
-- on the first attempt — the PART 2 verify block at the bottom ended in
-- `rollback;`, the SQL Editor runs a submitted script as ONE transaction, and so
-- the rollback discarded every statement above it. The editor reported success,
-- the sanity SELECT never got to run, and nothing was created. PART 2 is
-- commented out now; see the note above it before uncommenting.
--
-- HOW TO CHECK IT LANDED, without DB access: the select list is validated
-- against the schema BEFORE RLS, so a missing column is a 400/42703 and a
-- present one is a clean 200 even with no rows visible.
--   curl -s "$SUPABASE_URL/rest/v1/posts?select=id,repost_of&limit=1" \
--     -H "apikey: $PUBLISHABLE_KEY" -H "Authorization: Bearer $PUBLISHABLE_KEY"
-- 200 means the column exists. Probe a nonsense column alongside as a control.
-- ============================================================================


-- 1. The pointer. Cascade, so a deleted original takes its reposts with it, and
--    an index because "the reposts of this post" is a lookup the client makes
--    on every card it draws.
alter table public.posts add column if not exists repost_of uuid
  references public.posts(id) on delete cascade;

create index if not exists posts_repost_of_idx on public.posts (repost_of);


-- 2. Let 'repost' join the five. The inline CHECK on posts.type is auto-named
--    posts_type_check; drop and re-add it with the sixth value (same move
--    add-polls.sql and add-activities.sql already made).
alter table public.posts drop constraint if exists posts_type_check;
alter table public.posts add constraint posts_type_check
  check (type in ('note','find','photo','activity','poll','repost'));


-- 3. A repost row is coherent or it isn't one. Two directions, both enforced:
--    a repost points at something and carries only the words of the quote (a
--    title and a note, like any other post), and anything that is NOT a repost
--    carries no pointer. What a repost may never carry is a payload of its own —
--    media, a poll, a place, a time — because those are things you MAKE, and the
--    thing this row is about was made by somebody else.
--    Existing rows all have repost_of null, so they pass the second arm and this
--    needs no backfill.
alter table public.posts drop constraint if exists posts_repost_shape;
alter table public.posts add constraint posts_repost_shape check (
  (type = 'repost'
     and repost_of is not null
     and url is null and image is null and poster is null
     and poll is null and location is null
     and event_date is null and event_time is null)
  or
  (type <> 'repost' and repost_of is null)
);


-- 4. One BARE repost per person per post, so the glyph is an honest toggle.
--    Quotes are exempt by the predicate: bare means no words of your own at all,
--    so a person may quote the same post twice and say something different each
--    time. Both columns are in the predicate because a quote may carry a title
--    and no note.
create unique index if not exists posts_one_bare_repost
  on public.posts (author, repost_of)
  where type = 'repost' and coalesce(note, '') = '' and coalesce(title, '') = '';


-- 5. THE DOUBLE GATE — read side.
--    security definer for the same reason can_view_post is: it reads posts as
--    the table owner, so the policy never re-enters posts' own RLS, which would
--    otherwise recurse the moment a repost pointed at a post.
--    A null pointer answers true, so every ordinary post is unaffected.
create or replace function public.can_view_original(p_repost_of uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_repost_of is null or exists (
    select 1
      from public.posts o
     where o.id = p_repost_of
       and public.can_view_post(o.audience, o.author, o.id)
  );
$$;

grant execute on function public.can_view_original(uuid) to anon, authenticated;

-- Idempotent restate of the read policy with the second gate ANDed on. NO `to`
-- clause on purpose — it must serve anon, which is how the app reads the feed,
-- or the feed goes dark.
drop policy if exists "posts read visible" on public.posts;
create policy "posts read visible" on public.posts
  for select using (
    public.can_view_post(audience, author, id)
    and public.can_view_original(repost_of)
  );


-- 6. THE DOUBLE GATE — write side. Three conditions on a repost, and none of
--    them on an ordinary post (repost_of is null makes every arm vacuous):
--      · you can see what you are pointing at;
--      · your repost wears the ORIGINAL's audience, exactly, so it cannot be
--        tagged wider than its subject;
--      · you cannot repost a hand-addressed post (its allowlist belongs to its
--        author and is not yours to reproduce), and you cannot repost a repost
--        (the client collapses a chain to its first original, and this is what
--        makes that true rather than merely intended).
--
--    The test lives in a FUNCTION rather than inline in the policy, for two
--    reasons and the second one is the serious one.
--
--    · Scope. Inline, the subquery would alias the original as `o`, and `o` has
--      a repost_of and an audience of its own — so a bare `repost_of` inside it
--      binds to the ORIGINAL and the check quietly compares a row against
--      itself. Passing the values as parameters removes the ambiguity instead of
--      working around it with `posts.<col>` qualifications.
--
--    · RLS re-entry. An inline `exists (select … from public.posts)` in a policy
--      runs under the CALLER's RLS, so it would re-enter the posts SELECT policy
--      — which now calls can_view_original, which reads posts. security definer
--      reads as the table owner and cuts that off, exactly as can_view_post has
--      always had to. This is the same trap schema.sql already documents.
create or replace function public.repost_insert_ok(p_repost_of uuid, p_audience text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_repost_of is null or exists (
    select 1
      from public.posts o
     where o.id = p_repost_of
       and o.audience = p_audience       -- wears the original's audience exactly
       and o.audience <> 'list'          -- a hand-addressed post isn't yours to re-send
       and o.type <> 'repost'            -- a chain collapses to its first original
  );
$$;

grant execute on function public.repost_insert_ok(uuid, text) to anon, authenticated;

drop policy if exists "posts insert own" on public.posts;
create policy "posts insert own" on public.posts
  for insert to authenticated with check (
    author = auth.uid()
    and public.can_view_original(repost_of)
    and public.repost_insert_ok(repost_of, audience)
  );


-- Quick sanity: six values in the type check, the column, both indexes, the new
-- function, and both policies (ok = 1 each).
select 'type check admits repost' as check, count(*) as ok
  from pg_constraint
  where conname = 'posts_type_check'
    and pg_get_constraintdef(oid) like '%repost%'
union all
select 'repost_of column', count(*) from information_schema.columns
  where table_schema = 'public' and table_name = 'posts' and column_name = 'repost_of'
union all
select 'shape check', count(*) from pg_constraint where conname = 'posts_repost_shape'
union all
select 'one-bare index', count(*) from pg_indexes
  where schemaname = 'public' and indexname = 'posts_one_bare_repost'
union all
select 'lookup index', count(*) from pg_indexes
  where schemaname = 'public' and indexname = 'posts_repost_of_idx'
union all
select 'can_view_original fn', count(*) from pg_proc where proname = 'can_view_original'
union all
select 'repost_insert_ok fn', count(*) from pg_proc where proname = 'repost_insert_ok'
union all
select 'read policy', count(*) from pg_policies
  where tablename = 'posts' and policyname = 'posts read visible'
union all
select 'insert policy', count(*) from pg_policies
  where tablename = 'posts' and policyname = 'posts insert own';


-- ── PART 2 · VERIFY — COMMENTED OUT ON PURPOSE ──────────────────────────────
--
-- READ THIS BEFORE UNCOMMENTING. The Supabase SQL Editor runs whatever you
-- submit as ONE transaction. An explicit `begin;` inside that is a no-op with a
-- warning, and the `rollback;` at the end of this block then discards the OUTER
-- transaction — i.e. every statement above it. Run this file with the block
-- live and the migration silently undoes itself: no error, a screen full of
-- "ok = 1", and not one object actually created. That is exactly what happened
-- the first time, which is why it now ships commented.
--
-- To run it: paste the block below into a SEPARATE query tab, on its own, after
-- PART 1 has been run and committed. Fill in three real user ids first — A and B
-- mutual friends, B and C mutual friends, A and C strangers to each other. The
-- placeholder ids below are not real rows and will fail the author foreign key.
--
-- What it proves is the thing with no symptom when it is wrong: that a repost
-- cannot carry a post to somebody who could not already see it.
--
--   A posts to 'circle'  →  B (mutual with A) reposts it  →  C must see NOTHING,
--   even though C is mutual with B and the repost row is B's own.
--
-- The editor runs as a superuser that BYPASSES RLS, so each user is impersonated
-- with set_config + set local role. It ends in ROLLBACK — nothing persists.
--
/*
begin;
  -- ┌─────────────── the players (edit the ids) ───────────────────────────────┐
  create temp table players (a uuid, b uuid, c uuid) on commit drop;
  insert into players values (
    '00000000-0000-0000-0000-00000000000A',   -- A: the author
    '00000000-0000-0000-0000-00000000000B',   -- B: mutual with A, reposts
    '00000000-0000-0000-0000-00000000000C'    -- C: mutual with B, stranger to A
  );
  -- └──────────────────────────────────────────────────────────────────────────┘

  create temp table ids (orig uuid, rp uuid) on commit drop;

  -- A writes a circle post.
  with p as (
    insert into public.posts (author, type, note, audience)
    select a, 'note', 'circle only', 'circle' from players
    returning id
  ) insert into ids (orig) select id from p;

  -- B reposts it, inheriting 'circle'.
  with r as (
    insert into public.posts (author, type, repost_of, audience)
    select players.b, 'repost', ids.orig, 'circle' from players, ids
    returning id
  ) update ids set rp = (select id from r);

  -- B sees both rows.
  set local role authenticated;
  select set_config('request.jwt.claims',
    json_build_object('sub', (select b from players))::text, true);
  select 'B sees the original' as check,
         count(*) as got, 1 as want
    from public.posts where id = (select orig from ids)
  union all
  select 'B sees the repost', count(*), 1
    from public.posts where id = (select rp from ids);

  -- C sees NEITHER. This is the whole test.
  select set_config('request.jwt.claims',
    json_build_object('sub', (select c from players))::text, true);
  select 'C cannot see the original' as check,
         count(*) as got, 0 as want
    from public.posts where id = (select orig from ids)
  union all
  select 'C cannot see the repost', count(*), 0
    from public.posts where id = (select rp from ids);

  reset role;
rollback;
*/
