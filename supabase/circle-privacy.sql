-- Tria — invite-only circles (2.0)
-- Run once in the Supabase dashboard → SQL Editor, AFTER add-circles.sql.
-- Additive + idempotent, so a re-run is harmless. Order against the two
-- circle files that may not have run yet (drop-circle-chats.sql,
-- circle-join-news.sql) does not matter: this restates none of their
-- functions, which is why the rule is a trigger and not a new join_community.
--
-- Zoe, 2026-10-23: "add privacy options like profile settings ... invite only
-- circles should be a thing." A circle was open to anyone signed in. Now its
-- host can make it INVITE ONLY, the way a profile can be private:
--
--   · an open circle is as before: on Discover, and anyone may join.
--   · an invite-only circle can be joined only by someone a member invited.
--     The app keeps it off Discover for everyone else; its page still opens
--     from a link (name, about, size), the way a private profile still shows
--     its card. Its posts were already for members only (can_view_post).
--
-- AN INVITE IS STILL A DM. The circle page's Invite pill sends a friend the
-- link (openCommunityInvite); in an invite-only circle it first records the
-- invite here, because a DM is words and a join needs a fact the database can
-- check. Any member may invite, as any member may already send the link. An
-- invite is used up by the join it allows, so someone the host takes out
-- needs a new one to come back.
--
-- THE GATE IS A TRIGGER on community_members rather than a rewrite of
-- join_community, so every way in meets it (the RPC, and anything later), and
-- so circle-join-news.sql's restatement of join_community can run before or
-- after this without undoing it.


-- ── 1. The switch ───────────────────────────────────────────────────────────
alter table public.communities add column if not exists invite_only boolean not null default false;


-- ── 2. Invites ──────────────────────────────────────────────────────────────
create table if not exists public.community_invites (
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id      uuid not null references public.users(id) on delete cascade,
  invited_by   uuid references public.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  primary key (community_id, user_id)
);
create index if not exists community_invites_user_idx on public.community_invites (user_id);

-- Your own invites, and the invites of a circle you are in (so the Invite
-- sheet can say who already has one). Anon is granted the read so a signed-out
-- page asks cleanly and gets nothing (auth.uid() is null), rather than a 401.
-- Writes go through invite_to_community and the join trigger only.
alter table public.community_invites enable row level security;
drop policy if exists "community invites read" on public.community_invites;
create policy "community invites read" on public.community_invites
  for select to anon, authenticated
  using (user_id = auth.uid() or public.in_community(community_id));
grant select on public.community_invites to anon, authenticated;


-- ── 3. The gate ─────────────────────────────────────────────────────────────
-- Before a seat: an invite-only circle lets in its host and anyone holding an
-- invite. A row that is already there passes, so join_community's ON CONFLICT
-- DO NOTHING (its repair path) still answers a member quietly.
create or replace function public.community_invite_gate()
returns trigger language plpgsql security definer set search_path = public as $$
declare c record;
begin
  select invite_only, owner into c from public.communities where id = new.community_id;
  if not found or not c.invite_only or c.owner = new.user_id then return new; end if;
  if exists (select 1 from public.community_members
              where community_id = new.community_id and user_id = new.user_id) then
    return new;
  end if;
  if not exists (select 1 from public.community_invites
                  where community_id = new.community_id and user_id = new.user_id) then
    raise exception 'This circle is invite only. Ask someone in it to invite you.' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists community_invite_gate on public.community_members;
create trigger community_invite_gate before insert on public.community_members
  for each row execute function public.community_invite_gate();

-- After a seat: the invite is used up.
create or replace function public.community_invite_used()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.community_invites
   where community_id = new.community_id and user_id = new.user_id;
  return new;
end;
$$;
drop trigger if exists community_invite_used on public.community_members;
create trigger community_invite_used after insert on public.community_members
  for each row execute function public.community_invite_used();


-- ── 4. RPCs ─────────────────────────────────────────────────────────────────
-- The host's switch. create_community keeps its signature (a fourth argument
-- would leave an overload for drop-circle-chats.sql to collide with), so a new
-- invite-only circle is created and then switched, in the same tap.
create or replace function public.set_community_privacy(p_community uuid, p_invite_only boolean)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.communities where id = p_community and owner = auth.uid()) then
    raise exception 'Only the circle’s host can do that.' using errcode = '42501';
  end if;
  update public.communities set invite_only = coalesce(p_invite_only, false) where id = p_community;
end;
$$;
grant execute on function public.set_community_privacy(uuid, boolean) to authenticated;

-- A member inviting a friend. Friends only, as the Invite sheet lists, and
-- never across a block with the inviter or the host.
create or replace function public.invite_to_community(p_community uuid, p_user uuid)
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
  if not exists (select 1 from public.community_members
                  where community_id = p_community and user_id = me) then
    raise exception 'Join the circle to invite people to it.' using errcode = '42501';
  end if;
  if not public.are_mutual(me, p_user) or public.is_blocked_pair(me, p_user)
     or (o is not null and public.is_blocked_pair(o, p_user)) then
    raise exception 'You can only invite your friends.' using errcode = '42501';
  end if;
  if exists (select 1 from public.community_members
              where community_id = p_community and user_id = p_user) then
    return;                                       -- already in it
  end if;
  insert into public.community_invites (community_id, user_id, invited_by)
    values (p_community, p_user, me)
  on conflict (community_id, user_id) do nothing;
end;
$$;
grant execute on function public.invite_to_community(uuid, uuid) to authenticated;


-- Quick sanity (ok = 1 each).
select 'communities.invite_only' as check, count(*) as ok
  from information_schema.columns
 where table_schema = 'public' and table_name = 'communities' and column_name = 'invite_only'
union all
select 'community_invites table', count(*)
  from information_schema.tables where table_schema = 'public' and table_name = 'community_invites'
union all
select 'invite gate trigger', count(*) from pg_trigger where tgname = 'community_invite_gate'
union all
select 'set_community_privacy fn', count(*) from pg_proc where proname = 'set_community_privacy'
union all
select 'invite_to_community fn', count(*) from pg_proc where proname = 'invite_to_community';

-- To check it ran, read-only from outside: anon
--   GET /rest/v1/community_invites?select=user_id&limit=1
-- answers PGRST205 before it and [] after. The client asks the same question
-- (Store.communityPrivacyReady) and offers no Invite only switch until it
-- answers.
