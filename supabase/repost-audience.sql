-- Tria — reposts and quotes, one rule (2.0)
-- Run once in the Supabase dashboard → SQL Editor, AFTER reposts.sql,
-- add-circles.sql, circle-privacy.sql and circle-public-posts.sql. Additive +
-- idempotent, so a re-run is harmless. It REPLACES repost-to-circle.sql (gone
-- from the tree, in git), and it is safe on top of either version of that file:
-- the live DB had run the one that was reverted (5233b57), which let a public
-- circle's post out as 'public' and refused every repost INSIDE a circle.
--
-- Zoe, 2026-10-26: "tap repost, menu with repost & quote options, and let's use
-- the quote post menu to add the audience feature for posting, that way reposts
-- work within or out of circles and users have control over the audience."
--
-- THE RULE, in two lines:
--
--   · a BARE repost wears its original's audience exactly, circle and all. A
--     friends-only post goes to your friends, a public one to anyone, a post in
--     a circle stays in that circle (it bumps it there, and reaches My Circle
--     for the friends who share it). The client never offers it a choice.
--   · a QUOTE picks its audience in the composer, any of them (Zoe, 2026-10-26:
--     "I should be able to choose the audience on quotes"): Anyone, your circle,
--     people you pick, or any circle you're in, whatever the original was.
--
-- WHY ANY AUDIENCE IS SAFE. The read gate (can_view_original, reposts.sql) is
-- what keeps "never widen" true: a reader sees a repost only if they can see
-- its original too. So a friends-only post quoted to Anyone reaches only the
-- people who were already the author's friends, and an invite-only circle's
-- post quoted to Anyone reaches only that circle's members. The audience you
-- pick narrows who reads your words; it never opens the original. The composer
-- says so under the field when the original is the narrower of the two.
--
-- Unchanged: a hand-addressed ('list') post is never passed along (its list is
-- its author's), a chain collapses to its first original, and you can only post
-- into a circle you are in.
--
-- Three pieces:
--   1. repost_insert_ok (the insert policy's write gate, same signature) stops
--      requiring the original's audience: only the list and chain rules remain.
--   2. posts_community_guard (the circle trigger) stops refusing a repost in a
--      circle; its membership check is all that's left.
--   3. posts_one_bare_repost stays per person, per post, per place, so rows
--      made by the short-lived Repost to a circle row today remain valid. The
--      client's Undo takes back every bare row of yours for the post.
--
-- VERIFY over REST, read-only, with any public post's id (anon
-- GET /rest/v1/posts?select=id&audience=eq.public&type=neq.repost&community_id=is.null&limit=1):
--   curl -s -X POST "$SUPABASE_URL/rest/v1/rpc/repost_insert_ok" \
--     -H "apikey: $ANON" -H "Content-Type: application/json" \
--     -d '{"p_repost_of":"<that id>","p_audience":"list"}'
-- answers false before this file and true after. The app asks the same
-- question once a session (Store.repostRulesReady); until it hears true, quotes
-- wear their original's audience and a circle's post isn't offered at all.


-- The helper an earlier draft of this file defined. Never run, but drop it in
-- case: nothing calls it.
drop function if exists public.post_open_to_all(uuid);


-- 1. The write gate. Same signature as reposts.sql's, so the policy that calls
--    it ("posts insert own") is untouched. can_view_original, beside it in
--    that policy, still makes you able to see what you point at.
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
       and o.audience <> 'list'          -- a hand-addressed post isn't yours to re-send
       and o.type <> 'repost'            -- a chain collapses to its first original
  );
$$;
grant execute on function public.repost_insert_ok(uuid, text) to anon, authenticated;


-- 2. The circle trigger. Restated in full from add-circles.sql, minus its
--    repost arm: a repost lands in any circle you're in, and the read gate
--    decides who there can read it.
create or replace function public.posts_community_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.community_id is null then return new; end if;
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
select 'repost_insert_ok keeps only list and chain' as check, count(*) as ok
  from pg_proc where proname = 'repost_insert_ok'
   and pg_get_functiondef(oid) not like '%o.audience = p_audience%'
   and pg_get_functiondef(oid) like '%<> ''list''%'
union all
select 'guard has no repost arm', count(*)
  from pg_proc where proname = 'posts_community_guard'
   and pg_get_functiondef(oid) not like '%repost_of%'
union all
select 'bare index is per place', count(*)
  from pg_indexes where schemaname = 'public' and indexname = 'posts_one_bare_repost'
   and indexdef like '%community_id%'
union all
select 'read policy keeps the double gate', count(*)
  from pg_policies where tablename = 'posts' and policyname = 'posts read visible'
   and qual like '%can_view_original%'
union all
select 'can_view_post keeps is_blocked_pair', count(*)
  from pg_proc where proname = 'can_view_post'
   and pg_get_functiondef(oid) like '%is_blocked_pair%';
