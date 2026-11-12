-- ── The admin dashboard's Nudge page ────────────────────────────────────────
-- Run in the Supabase SQL editor AFTER admin-dashboard.sql. Additive and safe
-- to re-run.
--
-- Zoe, 2026-11-11: "Can we do an email for users who haven't really been in
-- the funnel?" This is who to write to and what was sent. The sending itself
-- is the `nudge` Edge Function (supabase/functions/nudge, through Resend, the
-- service already behind the auth mail), or the admin's own Mail app.
--
--   nudges       one row per person per email sent: who, which step they were
--                stuck on, how (the function's 'email' or the admin's own
--                'mail'), by whom, when. So nobody is written to twice in a week.
--   nudge_stop   people who asked not to hear from us (a reply saying stop).
--                The function never writes to them, and the page hides them.
--
-- Neither table has a select policy: only the admin functions below read them.
-- admin_nudge() is the ONE place an email address leaves auth.users for the
-- dashboard, and only to someone in `admins`. Admins themselves are left out
-- (metrics.people).

create table if not exists public.nudges (
  id       bigint generated always as identity primary key,
  user_id  uuid not null references public.users(id) on delete cascade,
  step     text not null check (step in ('profile', 'connect', 'post', 'return', 'quiet', 'other')),
  via      text not null check (via in ('email', 'mail')),
  sent_by  uuid references public.users(id) on delete set null,
  sent_at  timestamptz not null default now()
);
create index if not exists nudges_user_idx on public.nudges (user_id, sent_at desc);
alter table public.nudges enable row level security;
revoke all on public.nudges from anon, authenticated;

create table if not exists public.nudge_stop (
  user_id uuid primary key references public.users(id) on delete cascade,
  at      timestamptz not null default now()
);
alter table public.nudge_stop enable row level security;
revoke all on public.nudge_stop from anon, authenticated;

-- Everyone who hasn't settled in, or has gone quiet, with where they stopped.
-- A step, in funnel order (the first one missing wins):
--   profile   no photo or bio
--   connect   no friend and no circle
--   post      never made anything
--   return    never back after their first day, a week old or more (Zoe,
--             2026-11-11: "should be after a week"; it was 2 days), so a
--             new account has its first week before it's nudged to return
--   quiet     settled once, no sign of life in 21 days
-- An account under a day old is left alone: give people a day.
create or replace function public.admin_nudge() returns jsonb
language plpgsql stable security definer set search_path = public, metrics as $$
declare
  today date := (now() at time zone metrics.tz())::date;
  res jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only Tria''s team can see that.' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(x order by x->>'joined' desc), '[]') into res from (
    select jsonb_build_object(
      'id', u.id, 'name', u.name, 'handle', u.username, 'email', au.email,
      'joined', u.created_at, 'lastSeen', la.day,
      'profile', j.profile_at is not null, 'connected', j.connected_at is not null,
      'acted', j.action_at is not null, 'returned', j.returned_day is not null,
      'source', j.source, 'platform', j.platform,
      'step', st.step,
      'nudged', n.last, 'nudges', coalesce(n.cnt, 0),
      'stopped', s.user_id is not null
    ) as x
      from metrics.people u
      join metrics.journeys j on j.user_id = u.id
      join auth.users au on au.id = u.id
      left join lateral (
        select max(a.day) as day from metrics.alive_days a where a.user_id = u.id
      ) la on true
      left join lateral (
        select max(sent_at) as last, count(*) as cnt from public.nudges where user_id = u.id
      ) n on true
      left join public.nudge_stop s on s.user_id = u.id
      cross join lateral (select case
        when j.profile_at is null then 'profile'
        when j.connected_at is null then 'connect'
        when j.action_at is null then 'post'
        when u.created_at < now() - interval '7 days'
             and j.returned_day is null and coalesce(la.day, j.account_day) <= j.account_day then 'return'
        when coalesce(la.day, j.account_day) < today - 21 then 'quiet'
      end as step) st
     where u.created_at < now() - interval '1 day'
       and st.step is not null
  ) s;
  return jsonb_build_object('asOf', now(), 'people', res);
end $$;

-- What was sent. The Edge Function writes its own rows with the service role;
-- this is for the admin's own Mail app, marked by hand once it's sent.
create or replace function public.admin_nudge_sent(p_ids uuid[], p_step text, p_via text) returns int
language plpgsql volatile security definer set search_path = public as $$
declare n int;
begin
  if not public.is_admin() then
    raise exception 'Only Tria''s team can do that.' using errcode = '42501';
  end if;
  insert into public.nudges (user_id, step, via, sent_by)
  select u.id,
         case when p_step in ('profile', 'connect', 'post', 'return', 'quiet') then p_step else 'other' end,
         case when p_via = 'email' then 'email' else 'mail' end,
         auth.uid()
    from public.users u where u.id = any(p_ids);
  get diagnostics n = row_count;
  return n;
end $$;

-- Someone asked not to hear from us (or changed their mind).
create or replace function public.admin_nudge_stop(p_id uuid, p_stop boolean) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Only Tria''s team can do that.' using errcode = '42501';
  end if;
  if p_stop then
    insert into public.nudge_stop (user_id) values (p_id) on conflict do nothing;
  else
    delete from public.nudge_stop where user_id = p_id;
  end if;
end $$;

revoke all on function public.admin_nudge() from public;
revoke all on function public.admin_nudge_sent(uuid[], text, text) from public;
revoke all on function public.admin_nudge_stop(uuid, boolean) from public;
grant execute on function public.admin_nudge() to authenticated;
grant execute on function public.admin_nudge_sent(uuid[], text, text) to authenticated;
grant execute on function public.admin_nudge_stop(uuid, boolean) to authenticated;

select 'admin_nudge' as check, count(*) as ok from pg_proc
 where proname in ('admin_nudge', 'admin_nudge_sent', 'admin_nudge_stop');
