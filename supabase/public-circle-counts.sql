-- Tria — how many are in a circle, for a reader who is signed out (2.0)
-- Run once in the Supabase dashboard → SQL Editor, AFTER add-circles.sql.
-- Additive + idempotent, so a re-run is harmless.
--
-- Zoe, 2026-10-23: "show circle member count on signed out users". A circle's
-- page and its Discover card say "N members", and signed out they said nothing,
-- because "community members read" (add-circles.sql) serves rosters to
-- `authenticated` only: anon has no rows to count.
--
-- Opening the roster to anon would publish who is in which circle to anyone
-- with curl, which is more than a size. So this hands over the NUMBER and
-- nothing else, through a definer function, the way a friend count is a number
-- (public-friend-counts.sql) and not a list. The app reads it only while
-- signed out (Store.communitySize / readCommunitySizes); a signed-in reader
-- counts the roster it already holds. Until this is run the call answers
-- PGRST202 and signed-out pages show no count, exactly as before.

create or replace function public.community_sizes()
returns table (community_id uuid, members integer)
language sql stable security definer set search_path = public
as $$
  select m.community_id, count(*)::integer
    from public.community_members m
   group by m.community_id
$$;
grant execute on function public.community_sizes() to anon, authenticated;


-- Quick sanity (ok = 1).
select 'community_sizes fn' as check, count(*) as ok
  from pg_proc where proname = 'community_sizes';
