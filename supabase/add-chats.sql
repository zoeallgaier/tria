-- Tria — additive migration: chats (1.7, stage 1)
-- Safe to run on a live database. Touches no existing data.
--
-- Direct messages and group chats. Four tables, a handful of security-definer
-- helpers in the shape of can_view_post, and RPCs for every act that has a rule
-- behind it (who you may message, who may be put in a group). Clients never
-- insert into chats or chat_members directly: the rules live here, not in the
-- client's good intentions.
--
-- WHO MAY MESSAGE WHOM
--   · mutual friends               → a chat, both sides members
--   · you follow a PUBLIC account  → a request: you are a member, they are
--                                    'request' until they accept or deny
--   · anyone else                  → refused
--   · a block in either direction  → refused, and no message may be sent into
--                                    a direct chat across one
-- A denial is quiet, like a declined friend request: the asker's row is
-- untouched and their messages still read as sent. Nothing tells them.
--
-- Activity chats (kind 'activity') are declared here so the shape is settled
-- once, but nothing creates them until add-activity-chats.sql (stage 2).

-- ── Tables ──────────────────────────────────────────────────────────────────
create table if not exists public.chats (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('direct', 'group', 'activity')),
  title      text,                                   -- groups only; direct and activity chats are named by who and what
  post_id    uuid references public.posts(id) on delete cascade,   -- the activity, for kind 'activity'
  -- The two member ids, sorted and joined with ':'. Unique, so a pair can only
  -- ever have one direct chat, and it names the other person even to someone
  -- whose view of the other member row is fenced (see the member read policy).
  direct_key text unique,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  last_at    timestamptz not null default now(),     -- newest message, for ordering the list
  constraint chats_shape check (
    (kind = 'direct'   and direct_key is not null and post_id is null and title is null) or
    (kind = 'group'    and direct_key is null     and post_id is null) or
    (kind = 'activity' and direct_key is null     and post_id is not null)
  ),
  constraint chats_title_len check (title is null or char_length(title) <= 60)
);
create unique index if not exists chats_one_per_activity on public.chats (post_id) where kind = 'activity';

create table if not exists public.chat_members (
  chat_id      uuid not null references public.chats(id) on delete cascade,
  user_id      uuid not null references public.users(id) on delete cascade,
  status       text not null default 'member' check (status in ('member', 'request', 'denied')),
  muted        boolean not null default false,
  last_read_at timestamptz not null default now(),   -- a chat is unread when a message from someone else is newer
  cleared_at   timestamptz,                          -- "Delete chat" on a direct chat: history before this is hidden for this member
  joined_at    timestamptz not null default now(),
  primary key (chat_id, user_id)
);
create index if not exists chat_members_user_idx on public.chat_members (user_id);

create table if not exists public.messages (
  id         uuid primary key default gen_random_uuid(),
  chat_id    uuid not null references public.chats(id) on delete cascade,
  author     uuid not null references public.users(id) on delete cascade,
  body       text not null default '',
  image      text,                                   -- a photo or GIF's Storage URL, same as comments.image
  reply_to   uuid references public.messages(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint messages_not_empty check (btrim(body) <> '' or image is not null),
  constraint messages_len check (char_length(body) <= 2000)
);
create index if not exists messages_chat_idx on public.messages (chat_id, created_at);

create table if not exists public.message_hearts (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id    uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

-- ── Helpers ─────────────────────────────────────────────────────────────────
-- SECURITY DEFINER for can_view_post's reason: they read chat_members as the
-- owner, so a policy on chat_members that asks "is the caller in this chat?"
-- does not re-enter chat_members' own RLS and recurse.

-- In the chat at all (a pending request counts, so it can be read before it is
-- answered; a denial does not).
create or replace function public.is_chat_member(p_chat uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.chat_members
     where chat_id = p_chat and user_id = auth.uid() and status <> 'denied'
  );
$$;
grant execute on function public.is_chat_member(uuid) to authenticated;

create or replace function public.are_mutual(p_a uuid, p_b uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.friends f1
      join public.friends f2 on f2.a = f1.b and f2.b = f1.a
     where f1.a = p_a and f1.b = p_b
  );
$$;
grant execute on function public.are_mutual(uuid, uuid) to authenticated;

-- May the caller write into this chat right now? A full member, not blocked
-- across a direct chat, and not an activity chat that has been archived (three
-- days after its day, in Tria's own clock — the same Mountain Time dayMT uses).
-- A requester IS a full member; it is the other side that is 'request'.
create or replace function public.can_send_message(p_chat uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
      from public.chats c
      join public.chat_members m on m.chat_id = c.id and m.user_id = auth.uid() and m.status = 'member'
      left join public.posts p on p.id = c.post_id
     where c.id = p_chat
       and not (c.kind = 'direct' and exists (
         select 1 from public.chat_members o
          where o.chat_id = c.id and o.user_id <> auth.uid()
            and public.is_blocked_pair(auth.uid(), o.user_id)))
       and not (c.kind = 'activity' and p.event_date is not null
                and p.event_date + 3 < (now() at time zone 'America/Denver')::date)
  );
$$;
grant execute on function public.can_send_message(uuid) to authenticated;

create or replace function public.message_chat(p_message uuid)
returns uuid
language sql stable security definer set search_path = public
as $$ select chat_id from public.messages where id = p_message; $$;
grant execute on function public.message_chat(uuid) to authenticated;

-- ── Row Level Security ──────────────────────────────────────────────────────
alter table public.chats          enable row level security;
alter table public.chat_members   enable row level security;
alter table public.messages       enable row level security;
alter table public.message_hearts enable row level security;

drop policy if exists "chats read member" on public.chats;
create policy "chats read member" on public.chats
  for select to authenticated using (public.is_chat_member(id));

-- Your own row always; everyone else's only once they are a full member. That
-- fence is what keeps a denial quiet: the asker never sees the other row flip
-- to 'denied', or sit at 'request' either.
drop policy if exists "chat members read" on public.chat_members;
create policy "chat members read" on public.chat_members
  for select to authenticated using (
    user_id = auth.uid()
    or (status = 'member' and public.is_chat_member(chat_id))
  );
-- Your own row: mark read, mute, answer a request, clear history. Identity
-- columns are pinned by the trigger below, which RLS alone cannot do (a check
-- sees only the new row, so it could not stop a row being moved into another
-- chat).
drop policy if exists "chat members update own" on public.chat_members;
create policy "chat members update own" on public.chat_members
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
-- Leaving a group or an activity chat. A direct chat is cleared, not left.
drop policy if exists "chat members delete own" on public.chat_members;
create policy "chat members delete own" on public.chat_members
  for delete to authenticated using (
    user_id = auth.uid()
    and exists (select 1 from public.chats c where c.id = chat_id and c.kind <> 'direct')
  );

drop policy if exists "messages read member" on public.messages;
create policy "messages read member" on public.messages
  for select to authenticated using (public.is_chat_member(chat_id));
drop policy if exists "messages insert own" on public.messages;
create policy "messages insert own" on public.messages
  for insert to authenticated with check (author = auth.uid() and public.can_send_message(chat_id));
drop policy if exists "messages delete own" on public.messages;
create policy "messages delete own" on public.messages
  for delete to authenticated using (author = auth.uid());

drop policy if exists "message hearts read member" on public.message_hearts;
create policy "message hearts read member" on public.message_hearts
  for select to authenticated using (public.is_chat_member(public.message_chat(message_id)));
drop policy if exists "message hearts insert own" on public.message_hearts;
create policy "message hearts insert own" on public.message_hearts
  for insert to authenticated with check (
    user_id = auth.uid() and public.is_chat_member(public.message_chat(message_id))
  );
drop policy if exists "message hearts delete own" on public.message_hearts;
create policy "message hearts delete own" on public.message_hearts
  for delete to authenticated using (user_id = auth.uid());

-- ── Triggers ────────────────────────────────────────────────────────────────
create or replace function public.chat_members_pin_identity()
returns trigger language plpgsql as $$
begin
  if new.chat_id <> old.chat_id or new.user_id <> old.user_id then
    raise exception 'A chat membership cannot be moved.' using errcode = '42501';
  end if;
  -- A request is answered once into member or denied; nobody promotes
  -- themselves back to 'request', and a member cannot fake a denial of a chat
  -- they are sending into.
  if new.status = 'request' and old.status <> 'request' then
    raise exception 'Not an answer to a request.' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists chat_members_pin_identity on public.chat_members;
create trigger chat_members_pin_identity before update on public.chat_members
  for each row execute function public.chat_members_pin_identity();

-- A message moves its chat up the list and counts as read by its author.
create or replace function public.messages_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.chats set last_at = new.created_at where id = new.chat_id and last_at < new.created_at;
  update public.chat_members set last_read_at = new.created_at
   where chat_id = new.chat_id and user_id = new.author and last_read_at < new.created_at;
  return new;
end;
$$;
drop trigger if exists messages_after_insert on public.messages;
create trigger messages_after_insert after insert on public.messages
  for each row execute function public.messages_after_insert();

-- ── RPCs ────────────────────────────────────────────────────────────────────

-- Open (or find) the direct chat with one person. Returns the chat id.
create or replace function public.start_direct_chat(p_other uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  k text;
  cid uuid;
  mutual boolean;
  follows_public boolean;
begin
  if me is null then raise exception 'Not signed in.' using errcode = '28000'; end if;
  if p_other is null or p_other = me then raise exception 'Pick someone else.' using errcode = '22023'; end if;
  if public.is_blocked_pair(me, p_other) then raise exception 'Not allowed.' using errcode = '42501'; end if;

  mutual := public.are_mutual(me, p_other);
  follows_public := exists (
    select 1 from public.friends f join public.users u on u.id = f.b
     where f.a = me and f.b = p_other and u.private = false
  );

  k := least(me::text, p_other::text) || ':' || greatest(me::text, p_other::text);
  select id into cid from public.chats where direct_key = k;

  if cid is not null then
    -- Reaching for a chat IS answering a request in it, and becoming friends
    -- promotes a pending one.
    update public.chat_members set status = 'member'
     where chat_id = cid and user_id = me and status <> 'member';
    if mutual then
      update public.chat_members set status = 'member'
       where chat_id = cid and user_id = p_other and status = 'request';
    end if;
    return cid;
  end if;

  if not mutual and not follows_public then
    raise exception 'You can message friends, or public accounts you follow.' using errcode = '42501';
  end if;

  insert into public.chats (kind, direct_key, created_by) values ('direct', k, me) returning id into cid;
  insert into public.chat_members (chat_id, user_id, status) values
    (cid, me, 'member'),
    (cid, p_other, case when mutual then 'member' else 'request' end);
  return cid;
end;
$$;
grant execute on function public.start_direct_chat(uuid) to authenticated;

-- Start a group with friends. Everyone named must be a mutual friend of the
-- person starting it, and there must be at least two of them (one is a direct
-- chat). Returns the chat id.
create or replace function public.start_group_chat(p_members uuid[], p_title text default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  others uuid[];
  cid uuid;
begin
  if me is null then raise exception 'Not signed in.' using errcode = '28000'; end if;
  select coalesce(array_agg(distinct x), '{}') into others from unnest(p_members) x where x <> me;
  if coalesce(array_length(others, 1), 0) < 2 then
    raise exception 'A group needs at least two friends.' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(others) x
              where not public.are_mutual(me, x) or public.is_blocked_pair(me, x)) then
    raise exception 'Everyone in a group has to be your friend.' using errcode = '42501';
  end if;
  insert into public.chats (kind, title, created_by)
    values ('group', nullif(btrim(coalesce(p_title, '')), ''), me) returning id into cid;
  insert into public.chat_members (chat_id, user_id) values (cid, me);
  insert into public.chat_members (chat_id, user_id) select cid, x from unnest(others) x;
  return cid;
end;
$$;
grant execute on function public.start_group_chat(uuid[], text) to authenticated;

-- Add friends to a group you are in.
create or replace function public.add_chat_members(p_chat uuid, p_members uuid[])
returns void
language plpgsql security definer set search_path = public
as $$
declare me uuid := auth.uid();
begin
  if not exists (select 1 from public.chats c
                   join public.chat_members m on m.chat_id = c.id and m.user_id = me and m.status = 'member'
                  where c.id = p_chat and c.kind = 'group') then
    raise exception 'Not a group you are in.' using errcode = '42501';
  end if;
  if exists (select 1 from unnest(p_members) x
              where x <> me and (not public.are_mutual(me, x) or public.is_blocked_pair(me, x))) then
    raise exception 'You can only add your friends.' using errcode = '42501';
  end if;
  insert into public.chat_members (chat_id, user_id)
    select p_chat, x from unnest(p_members) x where x <> me
  on conflict (chat_id, user_id) do nothing;
end;
$$;
grant execute on function public.add_chat_members(uuid, uuid[]) to authenticated;

-- Name or rename a group (empty clears it back to the members' names).
create or replace function public.rename_chat(p_chat uuid, p_title text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.chats c
                   join public.chat_members m on m.chat_id = c.id and m.user_id = auth.uid() and m.status = 'member'
                  where c.id = p_chat and c.kind = 'group') then
    raise exception 'Not a group you are in.' using errcode = '42501';
  end if;
  update public.chats set title = nullif(btrim(coalesce(p_title, '')), '') where id = p_chat;
end;
$$;
grant execute on function public.rename_chat(uuid, text) to authenticated;

-- ── Realtime ────────────────────────────────────────────────────────────────
-- Messages arrive live while a chat is open. Realtime applies the read
-- policies above to every change it forwards, so a subscriber only hears rows
-- it could have selected.
do $$
declare t text;
begin
  foreach t in array array['messages', 'chat_members', 'chats', 'message_hearts'] loop
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;

-- ── Push ────────────────────────────────────────────────────────────────────
-- The same webhook every other push rides (push-webhooks.sql). The function's
-- `messages` branch decides who hears it: full members, not the author, not
-- muted, not blocked with the author.
drop trigger if exists tria_push_messages on public.messages;
create trigger tria_push_messages after insert on public.messages
  for each row execute function public.tria_push_notify();
