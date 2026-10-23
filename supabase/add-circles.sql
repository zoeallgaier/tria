-- Tria — circles (2.0)
-- Run once in the Supabase dashboard → SQL Editor. Additive + idempotent, so a
-- re-run is harmless. Then deploy the push function (see the foot of this
-- file): it carries its own copy of the audience rule.
--
-- A CIRCLE IS A ROOM FOR AN INTEREST that anyone can start and anyone can
-- join, at /c/<slug> the way a subreddit lives at /r/<name>. It is built out
-- of two things Tria already has rather than a third:
--
--   · an AUDIENCE. A post can be addressed to a circle the way it is addressed
--     to your friends or to a hand-picked list: posts.audience = 'community'
--     and posts.community_id names which one. Its members can read it, nobody
--     else can, and can_view_post is where that is decided, as for every
--     other audience.
--   · a GROUP CHAT. Every circle has one (chats.kind = 'community'), and its
--     roster IS the circle's: joining seats you in it and leaving takes you
--     out, both by trigger, so the two lists cannot drift.
--
-- NAMING. In the app a circle is a circle. In the SCHEMA it is a "community",
-- because "circle" already means something here: posts.audience = 'circle' is
-- your mutual friends, and My Circle is their feed. Calling the table
-- `circles` would put `audience = 'circle'` (friends) beside `circle_id`
-- (a room) on the same row, which is a bug waiting for a tired reader.
--
-- WHAT IS OPEN AND WHAT IS NOT:
--   · anyone signed in may start one (up to ten each) and join any of them;
--     signed out, the web can read the circle itself (name, about) and no more
--   · posts in it are for its members, and leaving takes the reading with you
--     (your own posts stay yours: the author clause in can_view_post)
--   · the founder (`owner`) may rename it, rewrite its about, and take a member
--     out. The slug never changes, because it is the link.
--   · when the owner leaves, the longest-standing member inherits it, and when
--     the last member leaves the circle closes and takes its posts and chat
--     with it. There is no Delete button: an owner who wants it gone leaves
--     last.
--   · a circle post cannot be reposted (the room is the audience, and a repost
--     would be a door out of it).
--
-- Layers on chat-roster.sql (can_view_post, add_chat_members,
-- remove_chat_member) and add-chats.sql (chats). Each of those three is
-- restated IN FULL below, with one new arm each, per the house rule for
-- rewrites of a function this schema depends on.


-- ── PART 1 · MIGRATION ──────────────────────────────────────────────────────

-- 1a. The circle and who is in it.
create table if not exists public.communities (
  id         uuid primary key default gen_random_uuid(),
  -- The /c/<slug>. Lowercase letters, digits and underscores, 3 to 24, never
  -- starting with an underscore. A handful of words are kept back because the
  -- app routes them (#/c/new) or because they would read as Tria's own.
  slug       text not null unique,
  name       text not null,
  about      text not null default '',
  owner      uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint communities_slug_shape check (slug ~ '^[a-z0-9][a-z0-9_]{2,23}$'),
  constraint communities_slug_kept check (slug not in
    ('new', 'edit', 'tria', 'admin', 'help', 'about', 'settings', 'support', 'official')),
  constraint communities_name_len check (char_length(btrim(name)) between 1 and 40),
  constraint communities_about_len check (char_length(about) <= 280)
);

create table if not exists public.community_members (
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id      uuid not null references public.users(id) on delete cascade,
  joined_at    timestamptz not null default now(),
  primary key (community_id, user_id)
);
create index if not exists community_members_user_idx on public.community_members (user_id);

-- 1b. A post addressed to a circle. The pair moves together or not at all:
--     a 'community' post names its circle, and nothing else names one.
alter table public.posts add column if not exists community_id uuid
  references public.communities(id) on delete cascade;
create index if not exists posts_community_idx on public.posts (community_id)
  where community_id is not null;

alter table public.posts drop constraint if exists posts_audience_check;
alter table public.posts add constraint posts_audience_check
  check (audience in ('public', 'circle', 'list', 'community'));
alter table public.posts drop constraint if exists posts_community_shape;
alter table public.posts add constraint posts_community_shape
  check ((audience = 'community') = (community_id is not null));

-- 1c. The circle's chat. One per circle, named by the circle.
alter table public.chats add column if not exists community_id uuid
  references public.communities(id) on delete cascade;
alter table public.chats drop constraint if exists chats_kind_check;
alter table public.chats add constraint chats_kind_check
  check (kind in ('direct', 'group', 'activity', 'community'));
alter table public.chats drop constraint if exists chats_shape;
alter table public.chats add constraint chats_shape check (
  (kind = 'direct'    and direct_key is not null and post_id is null     and title is null and community_id is null) or
  (kind = 'group'     and direct_key is null     and post_id is null     and community_id is null) or
  (kind = 'activity'  and direct_key is null     and post_id is not null and community_id is null) or
  (kind = 'community' and direct_key is null     and post_id is null     and community_id is not null)
);
create unique index if not exists chats_one_per_community on public.chats (community_id)
  where kind = 'community';


-- ── 2. Helpers ──────────────────────────────────────────────────────────────
-- SECURITY DEFINER for can_view_post's reason: they read community_members and
-- posts as the owner, so a policy that asks never re-enters another table's RLS.

create or replace function public.in_community(p_community uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.community_members
     where community_id = p_community and user_id = auth.uid()
  );
$$;
grant execute on function public.in_community(uuid) to anon, authenticated;

-- Is the caller in the circle this post is addressed to? Takes the POST, so
-- can_view_post keeps its three-argument signature (the policies, the repost
-- gate and can_view_original all call it by that shape).
create or replace function public.community_reads_post(p_post uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
      from public.posts p
      join public.community_members m on m.community_id = p.community_id
     where p.id = p_post and m.user_id = auth.uid()
  );
$$;
grant execute on function public.community_reads_post(uuid) to anon, authenticated;


-- ── 3. can_view_post, with a fifth arm ──────────────────────────────────────
--     READ THIS BEFORE EDITING IT. This function is this schema's worst
--     regression site: restore-block-gate.sql exists because a `create or
--     replace` of it once dropped the is_blocked_pair clause and silently
--     disabled blocking at the database. Every clause below is load-bearing:
--
--       · not is_blocked_pair(...)  — the block gate, outside the OR and first
--       · public                    — everyone
--       · author                    — yourself
--       · post_audience             — ON THE LIST, for every audience (a floor)
--       · circle                    — the author's mutual friends
--       · community                 — NEW: the members of the post's circle
--
--     Copied from chat-roster.sql with exactly one arm added at the end.
create or replace function public.can_view_post(p_audience text, p_author uuid, p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not public.is_blocked_pair(auth.uid(), p_author)
     and (
          p_audience = 'public'
       or p_author   = auth.uid()
       or exists (
            select 1 from public.post_audience
            where post_id = p_id and user_id = auth.uid()
          )
       or (p_audience = 'circle' and exists (
            select 1
              from public.friends f1
              join public.friends f2 on f2.a = f1.b and f2.b = f1.a
             where f1.a = auth.uid() and f1.b = p_author
          ))
       or (p_audience = 'community' and public.community_reads_post(p_id))
     );
$$;
grant execute on function public.can_view_post(text, uuid, uuid) to anon, authenticated;


-- ── 4. Who may address a post to a circle ───────────────────────────────────
-- A trigger rather than a rewrite of "posts insert own" (reposts.sql, which is
-- careful for reasons of its own) or "posts update own" (whose missing `with
-- check` the audience editor relies on). Two rules:
--
--   · you may only put a post INTO a circle you are in. Checked when the
--     circle is set or changed, never when it stays the same, so a member who
--     has left can still fix a typo in what they wrote there.
--   · a circle post is not reposted. posts_community_shape already makes a
--     repost of one carry a circle; this refuses it outright.
create or replace function public.posts_community_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.community_id is null then return new; end if;
  if new.repost_of is not null then
    raise exception 'Posts in a circle stay in their circle.' using errcode = '42501';
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


-- ── 5. One roster for the circle and its chat ───────────────────────────────
-- Joining seats you in the chat, MUTED: a circle can be a room of strangers
-- with a hobby in common, and a buzz per message from forty of them is the
-- opposite of what Tria is for. Unmute is in the chat's •••. Leaving takes you
-- out, and settles who holds the circle after you.
create or replace function public.community_member_joined()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.chat_members (chat_id, user_id, muted)
    select c.id, new.user_id, true from public.chats c
     where c.community_id = new.community_id and c.kind = 'community'
  on conflict (chat_id, user_id) do nothing;
  return new;
end;
$$;
drop trigger if exists community_member_joined on public.community_members;
create trigger community_member_joined after insert on public.community_members
  for each row execute function public.community_member_joined();

-- Runs for a Leave, for the owner taking someone out, and for an account being
-- deleted (the user_id cascade), so all three settle the same way. During a
-- circle's own deletion the circle row is already gone and every statement
-- here matches nothing.
create or replace function public.community_member_left()
returns trigger language plpgsql security definer set search_path = public as $$
declare heir uuid;
begin
  delete from public.chat_members m
   using public.chats c
   where m.chat_id = c.id and c.community_id = old.community_id and c.kind = 'community'
     and m.user_id = old.user_id;
  select user_id into heir from public.community_members
   where community_id = old.community_id
   order by joined_at, user_id limit 1;
  if heir is null then
    -- Last one out: the circle closes, and its posts and chat go with it.
    delete from public.communities where id = old.community_id;
  else
    update public.communities set owner = heir
     where id = old.community_id and (owner is null or owner = old.user_id);
  end if;
  return old;
end;
$$;
drop trigger if exists community_member_left on public.community_members;
create trigger community_member_left after delete on public.community_members
  for each row execute function public.community_member_left();


-- ── 6. Row Level Security ───────────────────────────────────────────────────
-- Writes go through the RPCs below. Reads are open: a circle is something you
-- find, and who is in one is as public inside Tria as a friends list is.
alter table public.communities       enable row level security;
alter table public.community_members enable row level security;

drop policy if exists "communities read all" on public.communities;
create policy "communities read all" on public.communities
  for select using (true);                        -- anon too: a /c/ link on the web

drop policy if exists "community members read" on public.community_members;
create policy "community members read" on public.community_members
  for select to authenticated using (true);

-- A circle's chat is left by leaving the circle (leave_community), never on
-- its own, or the two rosters part. Restated from add-chats.sql with one kind
-- added to the exclusion.
drop policy if exists "chat members delete own" on public.chat_members;
create policy "chat members delete own" on public.chat_members
  for delete to authenticated using (
    user_id = auth.uid()
    and exists (select 1 from public.chats c where c.id = chat_id
                 and c.kind not in ('direct', 'community'))
  );


-- ── 7. RPCs ─────────────────────────────────────────────────────────────────
-- The words raised here are written for people; the client shows them as-is.

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
  insert into public.chats (kind, community_id, title, created_by) values ('community', cid, n, me);
  -- After the chat, so the join trigger has a chat to seat them in.
  insert into public.community_members (community_id, user_id) values (cid, me);
  return cid;
end;
$$;
grant execute on function public.create_community(text, text, text) to authenticated;

create or replace function public.update_community(p_community uuid, p_name text, p_about text default '')
returns void
language plpgsql security definer set search_path = public
as $$
declare
  n text := btrim(coalesce(p_name, ''));
  a text := btrim(coalesce(p_about, ''));
begin
  if not exists (select 1 from public.communities where id = p_community and owner = auth.uid()) then
    raise exception 'Only the circle’s owner can do that.' using errcode = '42501';
  end if;
  if n = '' or char_length(n) > 40 then
    raise exception 'Give it a name, up to 40 characters.' using errcode = '22023';
  end if;
  if char_length(a) > 280 then
    raise exception 'Keep the about to 280 characters.' using errcode = '22023';
  end if;
  update public.communities set name = n, about = a where id = p_community;
  update public.chats set title = n where community_id = p_community and kind = 'community';
end;
$$;
grant execute on function public.update_community(uuid, text, text) to authenticated;

-- Open to anyone signed in, except across a block with the circle's owner.
-- Re-seats a member whose chat row has gone missing, so it is also the repair.
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
  insert into public.chat_members (chat_id, user_id, muted)
    select c.id, me, true from public.chats c
     where c.community_id = p_community and c.kind = 'community'
  on conflict (chat_id, user_id) do nothing;
end;
$$;
grant execute on function public.join_community(uuid) to authenticated;

create or replace function public.leave_community(p_community uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  delete from public.community_members
   where community_id = p_community and user_id = auth.uid();
end;
$$;
grant execute on function public.leave_community(uuid) to authenticated;

create or replace function public.remove_community_member(p_community uuid, p_user uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.communities where id = p_community and owner = auth.uid()) then
    raise exception 'Only the circle’s owner can do that.' using errcode = '42501';
  end if;
  if p_user = auth.uid() then
    raise exception 'Leave the circle instead.' using errcode = '22023';
  end if;
  delete from public.community_members where community_id = p_community and user_id = p_user;
end;
$$;
grant execute on function public.remove_community_member(uuid, uuid) to authenticated;


-- ── 8. The chat roster RPCs, refusing a circle's chat ───────────────────────
-- Both are restated IN FULL from chat-roster.sql with one guard each. Without
-- them a circle's chat would read as a group, where anyone may add their
-- friends to it (into the chat and not the circle) and anyone may take anyone
-- out. The circle's own page is where its roster moves.
create or replace function public.add_chat_members(p_chat uuid, p_members uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  c record;
begin
  select ch.id, ch.kind, ch.post_id, p.author, p.audience into c
    from public.chats ch left join public.posts p on p.id = ch.post_id
   where ch.id = p_chat;
  if c.id is null or not exists (
       select 1 from public.chat_members m
        where m.chat_id = p_chat and m.user_id = me and m.status = 'member') then
    raise exception 'Not a chat you are in.' using errcode = '42501';
  end if;
  if c.kind = 'direct' then
    raise exception 'Start a group to add more people.' using errcode = '42501';
  end if;
  if c.kind = 'community' then
    raise exception 'Anyone can join a circle from its page. Share it with them.' using errcode = '42501';
  end if;
  if exists (select 1 from unnest(p_members) x
              where x <> me and (not public.are_mutual(me, x) or public.is_blocked_pair(me, x))) then
    raise exception 'You can only add your friends.' using errcode = '42501';
  end if;
  if c.kind = 'activity' and exists (
       select 1 from unnest(p_members) x where public.is_blocked_pair(c.author, x)) then
    raise exception 'You can’t add them to this plan.' using errcode = '42501';
  end if;
  if c.kind = 'activity' then
    insert into public.post_audience (post_id, user_id)
      select c.post_id, x from unnest(p_members) x where x <> c.author
    on conflict do nothing;
  end if;
  insert into public.chat_members (chat_id, user_id)
    select p_chat, x from unnest(p_members) x where x <> me
  on conflict (chat_id, user_id) do nothing;
end;
$$;
grant execute on function public.add_chat_members(uuid, uuid[]) to authenticated;

create or replace function public.remove_chat_member(p_chat uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  c record;
begin
  select ch.kind, ch.post_id, p.author into c
    from public.chats ch left join public.posts p on p.id = ch.post_id
   where ch.id = p_chat;
  if c.kind is null or c.kind = 'direct' then
    raise exception 'That chat has no guest list.' using errcode = '42501';
  end if;
  if c.kind = 'community' then
    raise exception 'Take them out from the circle’s page.' using errcode = '42501';
  end if;
  if not exists (
       select 1 from public.chat_members m
        where m.chat_id = p_chat and m.user_id = me and m.status = 'member') then
    raise exception 'Not a chat you are in.' using errcode = '42501';
  end if;
  if c.kind = 'activity' and c.author is distinct from me then
    raise exception 'Only the host can do that.' using errcode = '42501';
  end if;
  if p_user = me then
    raise exception 'Leave the chat instead.' using errcode = '22023';
  end if;
  if c.kind = 'activity' and p_user = c.author then
    raise exception 'The host stays in their own chat.' using errcode = '22023';
  end if;
  delete from public.post_audience where post_id = c.post_id and user_id = p_user;
  delete from public.chat_members where chat_id = p_chat and user_id = p_user;
end;
$$;
grant execute on function public.remove_chat_member(uuid, uuid) to authenticated;


-- Quick sanity (ok = 1 each). The second is the clause restore-block-gate.sql
-- exists to protect; the third proves the new arm landed.
select 'communities table' as check, count(*) as ok
  from information_schema.tables where table_schema = 'public' and table_name = 'communities'
union all
select 'can_view_post keeps is_blocked_pair', count(*)
  from pg_proc where proname = 'can_view_post'
   and pg_get_functiondef(oid) like '%is_blocked_pair%'
union all
select 'can_view_post reads circles', count(*)
  from pg_proc where proname = 'can_view_post'
   and pg_get_functiondef(oid) like '%community_reads_post%'
union all
select 'create_community fn', count(*) from pg_proc where proname = 'create_community'
union all
select 'join trigger', count(*) from pg_trigger where tgname = 'community_member_joined'
union all
select 'leave trigger', count(*) from pg_trigger where tgname = 'community_member_left';

-- To check it ran, read-only from outside: anon
--   GET /rest/v1/communities?select=slug&limit=1
-- answers PGRST205 before it and [] (or rows) after. The client asks the same
-- question (Store.circlesReady) and shows nothing of circles until it answers.
--
-- THEN DEPLOY THE PUSH FUNCTION (`supabase functions deploy swift-processor`,
-- from the `push` folder). It names a circle's chat in a message push, and its
-- two copies of the audience rule (reminders and the calendar feed) learned
-- what a circle activity is in the same commit as this file.
