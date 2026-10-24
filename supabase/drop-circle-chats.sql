-- Tria — a circle is just a feed (2.0)
-- Run once in the Supabase dashboard → SQL Editor, AFTER add-circles.sql.
-- Idempotent, so a re-run is harmless. NOT additive: step 3 deletes every
-- circle's chat and every message in one, for good.
--
-- Zoe, 2026-10-23: "chats can be removed from circles all together ... it
-- should just be a feed. the chat is nice for activities when people need to
-- actually coordinate but I don't see a use here when people can comment on
-- posts." add-circles.sql gave every circle a group chat (chats.kind
-- 'community') whose roster a trigger kept equal to the circle's. This stops
-- making them and takes the old ones out.
--
-- THE APP NEEDS NONE OF THIS TO LOOK RIGHT. Since the same day the client drops
-- a 'community' chat as it reads (Store.applyChats), so no list, dot or thread
-- shows one whether or not this has run. What this buys is the backend: no new
-- chat per circle, nobody seated in one on joining, and no message pushes from
-- an older build that still has the circle page's Chat button.
--
-- WHAT IS LEFT ON PURPOSE, because each is a no-op once no 'community' chat
-- exists, and restating them is more surface than it is worth:
--   · join_community still seats you "in the circle's chat" (it finds none).
--     So does circle-join-news.sql's copy, if that is run after this.
--   · community_member_left still deletes your seat in it (it finds none).
--   · update_community still renames it (it finds none).
--   · add_chat_members / remove_chat_member still refuse a 'community' chat.
--   · chats_kind_check still allows the kind, and the push function still
--     knows how to name one.
--
-- Photos sent in those chats stay in the `media` bucket: deleting a message row
-- doesn't reach Storage. They are unreachable from the app either way.


-- ── 1. A new circle makes no chat ──────────────────────────────────────────
-- Restated IN FULL from add-circles.sql with the chats insert taken out.
create or replace function public.create_community(p_slug text, p_name text, p_about text default '')
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  s text := lower(btrim(coalesce(p_slug, '')));
  n text := btrim(coalesce(p_name, ''));
  a text := btrim(coalesce(p_about, ''));
  cid uuid;
begin
  if me is null then raise exception 'You need to be signed in.' using errcode = '28000'; end if;
  if s !~ '^[a-z0-9][a-z0-9_]{2,23}$' then
    raise exception 'A circle’s handle is 3 to 24 letters, numbers or underscores.' using errcode = '22023';
  end if;
  if n = '' or char_length(n) > 40 then
    raise exception 'Give it a name, up to 40 characters.' using errcode = '22023';
  end if;
  if char_length(a) > 280 then
    raise exception 'Keep the about to 280 characters.' using errcode = '22023';
  end if;
  if s in ('new', 'edit', 'tria', 'admin', 'help', 'about', 'settings', 'support', 'official')
     or exists (select 1 from public.communities where slug = s) then
    raise exception 'That handle is taken.' using errcode = '23505';
  end if;
  if (select count(*) from public.communities where owner = me) >= 10 then
    raise exception 'You can hold up to ten circles.' using errcode = '22023';
  end if;
  insert into public.communities (slug, name, about, owner) values (s, n, a, me) returning id into cid;
  insert into public.community_members (community_id, user_id) values (cid, me);
  return cid;
end;
$$;
grant execute on function public.create_community(text, text, text) to authenticated;


-- ── 2. Joining seats you in nothing ────────────────────────────────────────
drop trigger if exists community_member_joined on public.community_members;
drop function if exists public.community_member_joined();


-- ── 3. The old chats go, with their messages ───────────────────────────────
-- chat_members, messages and message_hearts all cascade (add-chats.sql).
delete from public.chats where kind = 'community';


-- Quick sanity (ok = 0 each).
select 'circle chats left' as check, count(*) as ok
  from public.chats where kind = 'community'
union all
select 'join trigger left', count(*)
  from pg_trigger where tgname = 'community_member_joined'
union all
select 'create_community still makes a chat', count(*)
  from pg_proc where proname = 'create_community'
   and pg_get_functiondef(oid) like '%insert into public.chats%';
