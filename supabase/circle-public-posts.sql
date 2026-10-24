-- Tria — a public circle's posts are readable by anyone (2.0)
-- Run once in the Supabase dashboard → SQL Editor, AFTER add-circles.sql and
-- circle-privacy.sql (it reads communities.invite_only). Idempotent.
--
-- Zoe, 2026-10-23: "if a circle is public posts should be visible." Until now
-- every circle's posts were for its members only. Now a PUBLIC circle (not
-- invite only) is read by anyone, signed in or out, the way a public post is;
-- an invite-only circle's stay with its members. Taking part is unchanged: the
-- app offers likes, comments and RSVPs on a circle post to its members (and
-- the author's friends), so a reader joins to say something.
--
-- ONE HELPER CHANGES, NOT can_view_post. can_view_post's circle arm is
-- `p_audience = 'community' and community_reads_post(p_id)`, so widening the
-- helper is the whole change, and the function this schema guards most
-- carefully (the block gate, restore-block-gate.sql) is not restated at all.
-- The block gate still runs first, outside the OR, for these posts as for
-- every other.
--
-- Switching a circle to invite only puts its posts back behind its members on
-- the next read; switching it back opens them again.

create or replace function public.community_reads_post(p_post uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
      from public.posts p
      join public.communities c on c.id = p.community_id
     where p.id = p_post
       and (not c.invite_only
            or exists (select 1 from public.community_members m
                        where m.community_id = c.id and m.user_id = auth.uid()))
  );
$$;
grant execute on function public.community_reads_post(uuid) to anon, authenticated;


-- Quick sanity (ok = 1 each).
select 'community_reads_post reads invite_only' as check, count(*) as ok
  from pg_proc where proname = 'community_reads_post'
   and pg_get_functiondef(oid) like '%invite_only%'
union all
select 'can_view_post keeps is_blocked_pair', count(*)
  from pg_proc where proname = 'can_view_post'
   and pg_get_functiondef(oid) like '%is_blocked_pair%';

-- To check it ran, read-only from outside: anon
--   GET /rest/v1/posts?select=id&audience=eq.community&limit=1
-- answers [] before it and a row after, once any public circle has a post.
