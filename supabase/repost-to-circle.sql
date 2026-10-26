-- Tria — repost to a circle (2.0)
-- Run once in the Supabase dashboard → SQL Editor, AFTER reposts.sql and
-- add-circles.sql. Additive + idempotent, so a re-run is harmless.
--
-- Zoe, 2026-10-26: "build out repost to circle along with repost and quote".
-- The repost sheet gets a third row, Repost to a circle, and its pick passes
-- the post along INTO one of your circles: a repost row whose audience is
-- 'community' and whose community_id is the circle.
--
-- WHICH POSTS. Only a PUBLIC one. reposts.sql's rule is "inherit, never
-- widen": a repost wears its original's audience exactly. A circle is a
-- different audience from anyone's friends, so a 'circle' post reposted into
-- one would be a door out of the author's friends (and, through the read
-- gate, would reach only the members who are also their friends, which reads
-- as a broken card). A public post is already readable by every member of
-- every circle, so putting it in front of one widens nothing. A hand-addressed
-- post stays refused, a chain still collapses to its first original, and a
-- post that was SAID in a circle still stays in its circle.
--
-- Three pieces, each a restatement of something reposts.sql or
-- add-circles.sql already owns:
--
--   1. repost_insert_ok (the insert policy's write gate) admits audience
--      'community' over a public original. Same signature, so the policy that
--      calls it is untouched.
--   2. posts_community_guard (the circle trigger) stops refusing every repost
--      in a circle and refuses only one whose original isn't public and
--      outside a circle. The membership check is unchanged: you can only post
--      into a circle you are in.
--   3. posts_one_bare_repost becomes one bare repost per person per post PER
--      PLACE, so passing a post along to your friends and into a circle (or
--      two circles) are separate toggles. The client keys the same way
--      (myBare / myCircleRepost in js/store.js).
--
-- Until this runs the app offers no circle row at all: it asks
-- repost_insert_ok the question below once a session (circleRepostsReady).
--
-- VERIFY over REST, read-only, with any public post's id:
--   curl -s -X POST "$SUPABASE_URL/rest/v1/rpc/repost_insert_ok" \
--     -H "apikey: $ANON" -H "Content-Type: application/json" \
--     -d '{"p_repost_of":"<a public post id>","p_audience":"community"}'
-- answers false before this file and true after.


-- 1. The write gate. Copied from reposts.sql with the audience arm widened
--    and the circle arm added; every other line is unchanged.
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
       and (o.audience = p_audience      -- wears the original's audience exactly
            or (p_audience = 'community' and o.audience = 'public'))  -- or a circle, over a public post
       and o.audience <> 'list'          -- a hand-addressed post isn't yours to re-send
       and o.type <> 'repost'            -- a chain collapses to its first original
       and o.community_id is null        -- a circle's post stays in its circle
  );
$$;

grant execute on function public.repost_insert_ok(uuid, text) to anon, authenticated;


-- 2. The circle trigger. Copied from add-circles.sql; the repost arm used to
--    refuse outright and now refuses only what (1) would.
create or replace function public.posts_community_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.community_id is null then return new; end if;
  if new.repost_of is not null and not exists (
       select 1 from public.posts o
        where o.id = new.repost_of and o.audience = 'public' and o.community_id is null) then
    raise exception 'Only a public post can be reposted to a circle.' using errcode = '42501';
  end if;
  if (tg_op = 'INSERT' or new.community_id is distinct from old.community_id)
     and not exists (select 1 from public.community_members
                      where community_id = new.community_id and user_id = auth.uid()) then
    raise exception 'Join the circle to post in it.' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists posts_community_guard on public.posts;
create trigger posts_community_guard before insert or update of community_id, repost_of on public.posts
  for each row execute function public.posts_community_guard();


-- 3. One bare repost per person per post per place. A null community is your
--    own feed; coalesce gives it a value so it is one place, not many.
drop index if exists public.posts_one_bare_repost;
create unique index if not exists posts_one_bare_repost
  on public.posts (author, repost_of, coalesce(community_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where type = 'repost' and coalesce(note, '') = '' and coalesce(title, '') = '';


-- Quick sanity (ok = 1 each).
select 'repost_insert_ok admits a circle' as check, count(*) as ok
  from pg_proc where proname = 'repost_insert_ok'
   and pg_get_functiondef(oid) like '%p_audience = ''community''%'
union all
select 'guard admits a public repost', count(*)
  from pg_proc where proname = 'posts_community_guard'
   and pg_get_functiondef(oid) like '%Only a public post%'
union all
select 'bare index is per place', count(*)
  from pg_indexes where schemaname = 'public' and indexname = 'posts_one_bare_repost'
   and indexdef like '%community_id%';
