-- ============================================================================
-- Tria — the chat roster: bring a friend, take someone out, and the allowlist
-- stops being a mode (1.8)
--
-- Three changes, and the first one is the reason for the other two.
--
--   1. post_audience becomes a FLOOR rather than a MODE. Until now a row in it
--      was read only when the post's audience was 'list'; from here a row is an
--      extra grant on ANY audience. "On the list" now always means "can read
--      it", and the three old answers are otherwise untouched.
--
--   2. A guest may bring a friend into a plan's chat. Adding was host-only, so
--      the only people who could ever join were the host's own friends — who
--      could already read the plan. A guest's friend can't necessarily, which
--      is exactly what 1 fixes: being brought writes the allowlist row, and the
--      row is what lets them open the activity for the details.
--
--   3. A group chat's members can be removed. remove_chat_member was
--      activity-host-only and RLS lets you delete only your own row, so
--      "leave" was the only way out of a group. A group has no host, so it is
--      FLAT, matching the add rule it has always had: anyone in it may add
--      anyone, so anyone in it may remove anyone. An activity keeps its host.
--
-- Layers on post-audience-public.sql + restore-block-gate.sql (can_view_post)
-- and add-activity-chats.sql (the two RPCs). Additive + idempotent. Safe to run
-- on production. Run PART 1; reload the app. PART 2 is an optional verify that
-- persists nothing (it rolls back).
--
-- ⚠️  THE PUSH EDGE FUNCTION CARRIES ITS OWN COPY of the audience rule, twice
--     (`invited` and `canSee` in supabase/functions/push/index.ts). Both were
--     updated in the same commit. Deploy the function after running this, or
--     the people a reminder wakes up and the people the app's guest list names
--     are different sets and one of them is lying to the host.
-- ============================================================================


-- ── PART 1 · MIGRATION ──────────────────────────────────────────────────────

-- 1a. The allowlist as a floor.
--
--     READ THIS BEFORE EDITING IT. This function is this schema's worst
--     regression site: restore-block-gate.sql exists because a `create or
--     replace` of it once dropped the is_blocked_pair clause and silently
--     disabled blocking at the database. Every clause below is load-bearing:
--
--       · not is_blocked_pair(...)  — the block gate, outside the OR and first
--       · public                    — everyone
--       · author                    — yourself
--       · post_audience            — ON THE LIST (this is the one that moved:
--                                     it used to sit inside `when audience =
--                                     'list'`, so it answered for one audience;
--                                     now it answers for all of them)
--       · circle                    — the author's mutual friends
--
--     A 'list' post is unchanged: the allowlist was already its only key, and
--     it is still the only clause that can pass for it. A 'circle' post gains
--     readers only where a row exists, and rows only exist on one because
--     somebody was brought into its chat. Nothing had to be backfilled: before
--     today no code path wrote a row for any audience but 'list'.
--
--     can_see_post already reads the allowlist unconditionally, so this makes
--     the pair agree rather than making them differ.
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
     );
$$;
grant execute on function public.can_view_post(text, uuid, uuid) to anon, authenticated;


-- 1b. Anyone in the chat may bring a friend — into a group, and now into a
--     plan. Three guards, and the third is new:
--
--       · you must be in the chat, and it must not be a direct one
--       · you may only bring YOUR OWN friends (are_mutual with the CALLER, so
--           "bring a friend" means yours, not the host's)
--       · on a plan, nobody the HOST has blocked. The friends check above
--           cannot see that — it asks about you and them — and without this a
--           guest bringing a friend is a way around the host's block.
--
--     On a plan, BEING BROUGHT IS BEING INVITED: the allowlist row goes in
--     whatever the audience, because after 1a that row is what lets them open
--     the activity for the details. It used to be written only for a 'list'
--     plan, which was correct while the only adder was the host.
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


-- 1c. Taking someone out, now from a group as well as a plan.
--
--     A PLAN HAS A HOST AND A GROUP DOES NOT, and that is the whole difference:
--     the guest list belongs to whoever is throwing the thing, so an activity
--     stays host-only, while a group is flat — anyone in it may remove anyone,
--     which is the same shape as the add rule it has always had.
--
--     Yourself is never a removal: that is Leave, which is your own row and
--     needs no function (see "chat members delete own"). The host is never
--     removable from their own plan.
--
--     The post_audience delete is what revokes the reading, and on a group it
--     is a no-op: post_id is null, so it matches nothing.
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


-- Quick sanity: the three functions are present and can_view_post still carries
-- its block gate (ok = 1 each; the second is the clause restore-block-gate.sql
-- exists to protect).
select 'can_view_post fn' as check, count(*) as ok
  from pg_proc where proname = 'can_view_post'
union all
select 'can_view_post keeps is_blocked_pair', count(*)
  from pg_proc where proname = 'can_view_post'
   and pg_get_functiondef(oid) like '%is_blocked_pair%'
union all
select 'can_view_post reads post_audience outside the list arm', count(*)
  from pg_proc where proname = 'can_view_post'
   and pg_get_functiondef(oid) not like '%when p_audience = ''list''%'
union all
select 'add_chat_members fn', count(*) from pg_proc where proname = 'add_chat_members'
union all
select 'remove_chat_member fn', count(*) from pg_proc where proname = 'remove_chat_member';


-- ── PART 2 · VERIFY ─────────────────────────────────────────────────────────
-- Proves the floor: a stranger with an allowlist row can read a CIRCLE post,
-- which before today only a mutual friend could, while a stranger without one
-- still cannot. The SQL editor runs as a superuser that BYPASSES RLS, so each
-- user is impersonated with set_config + set local role. Ends in ROLLBACK — the
-- throwaway post and its row never persist.
--
-- Fill in two real ids from your users list, then select the whole
-- begin; … rollback; block and Run.

begin;
  -- ┌─────────────── the players (edit the ids) ───────────────────────────────┐
  select set_config('t.author',   '00000000-0000-0000-0000-000000000000', true);  -- owns the post
  select set_config('t.stranger', '00000000-0000-0000-0000-000000000000', true);  -- NOT a friend of the author
  -- └──────────────────────────────────────────────────────────────────────────┘

  insert into public.posts (author, type, title, note, audience) values
    (current_setting('t.author')::uuid, 'note', 'Floor test', 'circle post', 'circle');

  -- As the STRANGER, with no row: hidden (want 0).
  select set_config('request.jwt.claims', json_build_object(
    'sub', current_setting('t.stranger'), 'role', 'authenticated')::text, true);
  set local role authenticated;
  select set_config('t.before',
    (select count(*) from public.posts where title = 'Floor test')::text, true);
  reset role;

  -- Put them on the list, the way being brought into the chat does.
  insert into public.post_audience (post_id, user_id)
    select id, current_setting('t.stranger')::uuid
      from public.posts where title = 'Floor test';

  -- As the STRANGER again, now on the list: visible (want 1).
  select set_config('request.jwt.claims', json_build_object(
    'sub', current_setting('t.stranger'), 'role', 'authenticated')::text, true);
  set local role authenticated;
  select set_config('t.after',
    (select count(*) from public.posts where title = 'Floor test')::text, true);
  reset role;

  select current_setting('t.before') as "stranger, no row (want 0)",
         current_setting('t.after')  as "stranger, on the list (want 1)";
rollback;
