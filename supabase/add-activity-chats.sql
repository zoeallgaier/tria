-- Tria — additive migration: activities overhaul (1.7, stage 2)
-- Safe to run on a live database. Needs add-chats.sql first.
--
--   1. An RSVP has a status: going, maybe or cant. Every existing row is going.
--   2. A new activity makes its own chat, and its members follow the plan:
--        · a hand-picked activity ('list'): everyone invited, from the moment
--          they are invited, whatever they answer
--        · a circle or public activity: whoever answers going or maybe
--      The host is always in. The host can invite friends and remove guests.
--      Activities posted before this migration get no chat.
--   3. A private calendar token per person, for the subscribable feed the push
--      function serves (GET …/swift-processor?calendar=<token>).

-- ── 1. RSVP status ──────────────────────────────────────────────────────────
alter table public.headcount add column if not exists status text not null default 'going';
alter table public.headcount drop constraint if exists headcount_status_check;
alter table public.headcount add constraint headcount_status_check
  check (status in ('going', 'maybe', 'cant'));
-- Changing your answer is an update of your own row.
drop policy if exists "headcount update own" on public.headcount;
create policy "headcount update own" on public.headcount
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── 2. Activity chats ───────────────────────────────────────────────────────
-- Internal helpers: called by the triggers below, never by a client.
create or replace function public.activity_chat_add(p_post uuid, p_user uuid)
returns void
language sql security definer set search_path = public
as $$
  insert into public.chat_members (chat_id, user_id)
  select c.id, p_user from public.chats c where c.post_id = p_post and c.kind = 'activity'
  on conflict (chat_id, user_id) do nothing;
$$;
revoke all on function public.activity_chat_add(uuid, uuid) from public, anon, authenticated;

-- The host is never removed from their own activity's chat.
create or replace function public.activity_chat_remove(p_post uuid, p_user uuid)
returns void
language sql security definer set search_path = public
as $$
  delete from public.chat_members m
   using public.chats c, public.posts p
   where m.chat_id = c.id and c.post_id = p_post and c.kind = 'activity'
     and p.id = p_post and p.author <> p_user and m.user_id = p_user;
$$;
revoke all on function public.activity_chat_remove(uuid, uuid) from public, anon, authenticated;

create or replace function public.activity_chat_on_post()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.type = 'activity' then
    insert into public.chats (kind, post_id, created_by)
      values ('activity', new.id, new.author)
      on conflict do nothing;
    perform public.activity_chat_add(new.id, new.author);
  end if;
  return new;
end;
$$;
drop trigger if exists activity_chat_on_post on public.posts;
create trigger activity_chat_on_post after insert on public.posts
  for each row execute function public.activity_chat_on_post();

-- A hand-picked activity's invite list IS its chat.
create or replace function public.activity_chat_on_audience()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.activity_chat_add(new.post_id, new.user_id);
    return new;
  end if;
  perform public.activity_chat_remove(old.post_id, old.user_id);
  return old;
end;
$$;
drop trigger if exists activity_chat_on_audience on public.post_audience;
create trigger activity_chat_on_audience after insert or delete on public.post_audience
  for each row execute function public.activity_chat_on_audience();

-- On a circle or public activity the answer decides. A hand-picked guest stays
-- in the chat whatever they answer; they were invited to it.
create or replace function public.activity_chat_on_rsvp()
returns trigger language plpgsql security definer set search_path = public as $$
declare aud text;
begin
  if tg_op = 'DELETE' then
    select audience into aud from public.posts where id = old.post_id;
    if coalesce(aud, 'circle') <> 'list' then
      perform public.activity_chat_remove(old.post_id, old.user_id);
    end if;
    return old;
  end if;
  select audience into aud from public.posts where id = new.post_id;
  if new.status in ('going', 'maybe') then
    perform public.activity_chat_add(new.post_id, new.user_id);
  elsif coalesce(aud, 'circle') <> 'list' then
    perform public.activity_chat_remove(new.post_id, new.user_id);
  end if;
  return new;
end;
$$;
drop trigger if exists activity_chat_on_rsvp on public.headcount;
create trigger activity_chat_on_rsvp after insert or update of status or delete on public.headcount
  for each row execute function public.activity_chat_on_rsvp();

-- Adding people, now for an activity's host as well as a group's members. On a
-- hand-picked activity the friends are put on the invite list too, which is what
-- lets them see the activity at all.
create or replace function public.add_chat_members(p_chat uuid, p_members uuid[])
returns void
language plpgsql security definer set search_path = public
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
  if c.kind = 'activity' and c.author <> me then
    raise exception 'Only the host can invite people.' using errcode = '42501';
  end if;
  if exists (select 1 from unnest(p_members) x
              where x <> me and (not public.are_mutual(me, x) or public.is_blocked_pair(me, x))) then
    raise exception 'You can only add your friends.' using errcode = '42501';
  end if;
  if c.kind = 'activity' and c.audience = 'list' then
    insert into public.post_audience (post_id, user_id)
      select c.post_id, x from unnest(p_members) x where x <> me
    on conflict do nothing;
  end if;
  insert into public.chat_members (chat_id, user_id)
    select p_chat, x from unnest(p_members) x where x <> me
  on conflict (chat_id, user_id) do nothing;
end;
$$;
grant execute on function public.add_chat_members(uuid, uuid[]) to authenticated;

-- The host taking someone off their activity: out of the chat and, on a
-- hand-picked one, off the invite list.
create or replace function public.remove_chat_member(p_chat uuid, p_user uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  c record;
begin
  select ch.kind, ch.post_id, p.author into c
    from public.chats ch join public.posts p on p.id = ch.post_id
   where ch.id = p_chat;
  if c.kind is distinct from 'activity' or c.author <> me then
    raise exception 'Only the host can do that.' using errcode = '42501';
  end if;
  if p_user = me then
    raise exception 'The host stays in their own chat.' using errcode = '22023';
  end if;
  delete from public.post_audience where post_id = c.post_id and user_id = p_user;
  delete from public.chat_members where chat_id = p_chat and user_id = p_user;
end;
$$;
grant execute on function public.remove_chat_member(uuid, uuid) to authenticated;

-- ── 3. Calendar tokens ──────────────────────────────────────────────────────
-- Its own table rather than a column on users, because every signed-in account
-- can read users and a token anyone can read is not a secret.
create table if not exists public.calendar_tokens (
  user_id    uuid primary key references public.users(id) on delete cascade,
  token      uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now()
);
alter table public.calendar_tokens enable row level security;
drop policy if exists "calendar tokens read own" on public.calendar_tokens;
create policy "calendar tokens read own" on public.calendar_tokens
  for select to authenticated using (user_id = auth.uid());

-- Your token, made on first ask. p_reset swaps it, which unsubscribes every
-- calendar holding the old link.
create or replace function public.calendar_token(p_reset boolean default false)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Not signed in.' using errcode = '28000'; end if;
  if p_reset then delete from public.calendar_tokens where user_id = me; end if;
  insert into public.calendar_tokens (user_id) values (me) on conflict (user_id) do nothing;
  return (select token from public.calendar_tokens where user_id = me);
end;
$$;
grant execute on function public.calendar_token(boolean) to authenticated;
