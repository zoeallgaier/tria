-- Tria — a circle's photo, and its host deleting it (1.9)
-- Run once in the Supabase dashboard → SQL Editor, AFTER add-circles.sql.
-- Additive + idempotent, so a re-run is harmless.
--
-- Two things the host of a circle (`communities.owner`) could not do in the
-- first cut, both asked for by Zoe on 2026-10-22:
--
--   · GIVE IT A PHOTO. A circle wore Discover's woven triad and nothing else.
--     Now it can wear a picture, the way a profile does: a square crop the app
--     uploads to the host's own folder in `media` (storage.sql's "media upload
--     own" already allows it), and a URL here. Null is the triad.
--   · DELETE IT. add-circles.sql had no Delete: a host who wanted a circle gone
--     left last. Now the host can close it outright, and it goes the way a
--     circle whose last member left goes: its posts and its chat with it (the
--     on-delete cascades on posts.community_id and chats.community_id), its
--     roster too. community_member_left fires for each removed member and finds
--     the circle already gone, so it does nothing.
--
-- Both are RPCs that check the caller is the host, for the reason every circle
-- write is one: the rule lives here, not in the client's good intentions.


-- ── PART 1 · MIGRATION ──────────────────────────────────────────────────────

alter table public.communities add column if not exists avatar text;
alter table public.communities drop constraint if exists communities_avatar_shape;
alter table public.communities add constraint communities_avatar_shape
  check (avatar is null or (avatar ~ '^https://' and char_length(avatar) <= 600));

create or replace function public.set_community_photo(p_community uuid, p_avatar text)
returns void
language plpgsql security definer set search_path = public
as $$
declare a text := nullif(btrim(coalesce(p_avatar, '')), '');
begin
  if not exists (select 1 from public.communities where id = p_community and owner = auth.uid()) then
    raise exception 'Only the circle’s host can do that.' using errcode = '42501';
  end if;
  if a is not null and (a !~ '^https://' or char_length(a) > 600) then
    raise exception 'That photo didn’t upload properly, try another one.' using errcode = '22023';
  end if;
  update public.communities set avatar = a where id = p_community;
end;
$$;
grant execute on function public.set_community_photo(uuid, text) to authenticated;

create or replace function public.delete_community(p_community uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.communities where id = p_community and owner = auth.uid()) then
    raise exception 'Only the circle’s host can do that.' using errcode = '42501';
  end if;
  delete from public.communities where id = p_community;
end;
$$;
grant execute on function public.delete_community(uuid) to authenticated;


-- Quick sanity (ok = 1 each).
select 'communities.avatar' as check, count(*) as ok
  from information_schema.columns
 where table_schema = 'public' and table_name = 'communities' and column_name = 'avatar'
union all
select 'set_community_photo fn', count(*) from pg_proc where proname = 'set_community_photo'
union all
select 'delete_community fn', count(*) from pg_proc where proname = 'delete_community';

-- To check it ran, read-only from outside: anon
--   GET /rest/v1/communities?select=avatar&limit=1
-- answers 42703 "column communities.avatar does not exist" before it and [] (or
-- rows) after. The client asks the same question (Store.communityToolsReady)
-- and offers no photo and no Delete until it answers.
