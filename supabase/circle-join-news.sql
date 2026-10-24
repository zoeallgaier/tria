-- Tria — a circle's host hears who joins, and nobody joins muted (2.0)
-- Run once in the Supabase dashboard → SQL Editor, AFTER add-circles.sql and
-- push-webhooks.sql. Additive + idempotent, so a re-run is harmless. Then
-- redeploy the push function (`supabase functions deploy swift-processor`),
-- which learned the community_members row in the same commit.
--
-- Two calls of Zoe's, 2026-10-23:
--
--   · THE HOST GETS A PUSH when somebody joins. The app's Updates already reads
--     it off the roster (Store.notifications, kind 'circlejoin'); this is the
--     buzz, one more AFTER INSERT trigger on the same tria_push_notify. The
--     host's own row (create_community seats them) is skipped by the function.
--   · JOINING NO LONGER MUTES THE CHAT ("to simplify"). add-circles.sql seated
--     every member, the host of a brand new circle included, muted. Now a seat
--     is a seat, the column's default. Anyone already muted stays muted: that
--     row may be a choice, and the chat's ••• still unmutes it.


-- ── 1. A seat in the chat, unmuted ─────────────────────────────────────────
-- Both restated in full from add-circles.sql, with `muted` left to its default.
create or replace function public.community_member_joined()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.chat_members (chat_id, user_id)
    select c.id, new.user_id from public.chats c
     where c.community_id = new.community_id and c.kind = 'community'
  on conflict (chat_id, user_id) do nothing;
  return new;
end;
$$;

create or replace function public.join_community(p_community uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  o uuid;
begin
  if me is null then raise exception 'You need to be signed in.' using errcode = '28000'; end if;
  select owner into o from public.communities where id = p_community;
  if not found then raise exception 'That circle has closed.' using errcode = '22023'; end if;
  if o is not null and public.is_blocked_pair(me, o) then
    raise exception 'You can’t join this circle.' using errcode = '42501';
  end if;
  insert into public.community_members (community_id, user_id) values (p_community, me)
  on conflict do nothing;
  insert into public.chat_members (chat_id, user_id)
    select c.id, me from public.chats c
     where c.community_id = p_community and c.kind = 'community'
  on conflict (chat_id, user_id) do nothing;
end;
$$;
grant execute on function public.join_community(uuid) to authenticated;


-- ── 2. The push ─────────────────────────────────────────────────────────────
drop trigger if exists tria_push_community_members on public.community_members;
create trigger tria_push_community_members after insert on public.community_members
  for each row execute function public.tria_push_notify();
