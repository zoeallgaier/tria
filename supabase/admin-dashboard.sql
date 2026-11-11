-- ── The admin dashboard (triaonline.com/admin) ──────────────────────────────
-- Run in the Supabase SQL editor. ADDITIVE and SAFE TO RE-RUN: every statement
-- is `if not exists`, `or replace`, or a drop-if-exists ahead of its create.
-- Nothing here rewrites a row anyone wrote.
--
-- WHAT IT ADDS
--   1. Who may read the dashboard: `admins`, `is_admin()`.
--   2. The open ping, Tria's ONLY usage tracking: one `devices` row per install
--      and one `user_days` row per person per day the app was opened, both
--      written by `note_open` and nothing else. First party, no SDK, no event
--      stream. No select policy on either table: nobody reads them over REST,
--      only the admin functions below.
--   3. `user_origin`: the device (platform, source) an account was first seen
--      on, so the funnel can split accounts by where they came from.
--   4. `profile_done`: when a profile first had a photo or a bio. Its own table
--      rather than a column on `users`, which every signed-in client reads.
--   5. `metrics` views (the schema daily-analytics.sql made, never exposed by
--      PostgREST) and four admin RPCs, each refusing anyone not in `admins`.
--
-- THE TIME ZONE is America/New_York, as daily-analytics.sql's. A "day" below is
-- a day there. Change `metrics.tz()` once to move every number.
--
-- MEANINGFUL (Zoe, 2026-11-11: "create or connect"): a post (not a bare
-- repost), a Moment, a daily answer, a comment, a message, an RSVP, a poll
-- vote, a friendship made, a circle joined. A like is not.
--
-- THE FUNNEL, one stage each:
--   1 Install            devices.first_seen (the app or a home screen shortcut;
--                        a browser visit is not an install)
--   2 Account            users.created_at
--   3 Profile complete   profile_done.at (a photo or a bio)
--   4 Connected          the first friend row they made, or first circle joined
--   5 First action       the first CREATE event (post, Moment, daily, comment,
--                        message, RSVP, vote)
--   6 Returned           opened again (or, before the ping, did something) on
--                        any of the 7 days after the account's day
--   Activated            connected AND a first action, both within 7 days of
--                        the account. Time to activation is the later of the two.

create schema if not exists metrics;
revoke all on schema metrics from anon, authenticated;

create or replace function metrics.tz() returns text
language sql immutable as $$ select 'America/New_York' $$;

-- ── 1. Admins ───────────────────────────────────────────────────────────────
create table if not exists public.admins (
  user_id    uuid primary key references public.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;
revoke all on public.admins from anon, authenticated;

-- An admin is LEFT OUT of every number unless `in_metrics` (Zoe, 2026-11-11:
-- "exclude my metrics? I post a lot and probably skew data"). Their posts,
-- opens, friendships and account count nowhere; `metrics.skip` is the list.
alter table public.admins add column if not exists in_metrics boolean not null default false;

insert into public.admins (user_id)
select id from public.users where username = 'zoe'
on conflict do nothing;

create or replace view metrics.skip as
  select user_id from public.admins where not in_metrics;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid())
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- ── 2. The open ping ────────────────────────────────────────────────────────
create table if not exists public.devices (
  id          uuid primary key,                -- made on the device, kept in tria:device
  platform    text not null check (platform in ('ios', 'pwa', 'web')),
  os          text not null default 'other' check (os in ('ios', 'android', 'mac', 'windows', 'other')),
  app_version text,
  source      text not null default 'direct'
              check (source in ('invite', 'circle', 'profile', 'post', 'daily', 'referral', 'direct')),
  source_ref  text,                            -- a code, slug, handle or referrer host; never a URL
  user_id     uuid references public.users(id) on delete set null,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now()
);
create index if not exists devices_user_idx on public.devices (user_id);
create index if not exists devices_first_idx on public.devices (first_seen);
alter table public.devices enable row level security;
revoke all on public.devices from anon, authenticated;

create table if not exists public.user_days (
  user_id  uuid not null references public.users(id) on delete cascade,
  day      date not null,
  platform text not null,
  primary key (user_id, day)
);
create index if not exists user_days_day_idx on public.user_days (day);
alter table public.user_days enable row level security;
revoke all on public.user_days from anon, authenticated;

-- ── 3. Where an account came from ───────────────────────────────────────────
create table if not exists public.user_origin (
  user_id           uuid primary key references public.users(id) on delete cascade,
  device_id         uuid,
  platform          text,
  os                text,
  source            text,
  source_ref        text,
  device_first_seen timestamptz,
  at                timestamptz not null default now()
);
alter table public.user_origin enable row level security;
revoke all on public.user_origin from anon, authenticated;

-- One call per open, at most once a day per device and person (the client
-- holds itself to that; the table holds itself to it anyway). Anyone may call
-- it, signed in or not, because an install happens before an account.
create or replace function public.note_open(
  p_device uuid, p_platform text, p_os text, p_version text, p_source text, p_ref text
) returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  me    uuid := auth.uid();
  v_os  text := case when p_os in ('ios', 'android', 'mac', 'windows') then p_os else 'other' end;
  v_src text := case when p_source in ('invite', 'circle', 'profile', 'post', 'daily', 'referral')
                     then p_source else 'direct' end;
  v_ref text := nullif(left(btrim(coalesce(p_ref, '')), 80), '');
begin
  if p_device is null or p_platform not in ('ios', 'pwa', 'web') then return; end if;
  if v_src = 'direct' then v_ref := null; end if;

  insert into public.devices (id, platform, os, app_version, source, source_ref, user_id)
  values (p_device, p_platform, v_os, left(p_version, 32), v_src, v_ref,
          case when exists (select 1 from public.users where id = me) then me end)
  on conflict (id) do update set
    last_seen   = now(),
    platform    = excluded.platform,
    os          = excluded.os,
    app_version = excluded.app_version,
    user_id     = coalesce(excluded.user_id, devices.user_id),
    -- A cold launch's link can arrive a beat after the first ping: a direct
    -- first hour takes the first real source it hears, and nothing after.
    source      = case when devices.source = 'direct' and excluded.source <> 'direct'
                        and devices.first_seen > now() - interval '1 hour'
                       then excluded.source else devices.source end,
    source_ref  = case when devices.source = 'direct' and excluded.source <> 'direct'
                        and devices.first_seen > now() - interval '1 hour'
                       then excluded.source_ref else devices.source_ref end;

  -- Signed out, or signed in with no profile yet (a provider sign-in before
  -- its handle): an install, nothing more.
  if me is null or not exists (select 1 from public.users where id = me) then return; end if;

  insert into public.user_origin (user_id, device_id, platform, os, source, source_ref, device_first_seen)
  select me, d.id, d.platform, d.os, d.source, d.source_ref, d.first_seen
    from public.devices d where d.id = p_device
  on conflict (user_id) do nothing;

  insert into public.user_days (user_id, day, platform)
  values (me, (now() at time zone metrics.tz())::date, p_platform)
  on conflict do nothing;
end $$;
revoke all on function public.note_open(uuid, text, text, text, text, text) from public;
grant execute on function public.note_open(uuid, text, text, text, text, text) to anon, authenticated;

-- ── 4. A profile made ───────────────────────────────────────────────────────
create table if not exists public.profile_done (
  user_id uuid primary key references public.users(id) on delete cascade,
  at      timestamptz not null default now(),
  known   boolean not null default true          -- false: backfilled, the real time is lost
);
alter table public.profile_done enable row level security;
revoke all on public.profile_done from anon, authenticated;

create or replace function public.note_profile_done() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.avatar is not null or btrim(coalesce(new.bio, '')) <> '' then
    insert into public.profile_done (user_id) values (new.id) on conflict do nothing;
  end if;
  return new;
end $$;

drop trigger if exists users_profile_done on public.users;
create trigger users_profile_done
  after insert or update of avatar, bio on public.users
  for each row execute function public.note_profile_done();

insert into public.profile_done (user_id, at, known)
select id, created_at, false from public.users
 where avatar is not null or btrim(coalesce(bio, '')) <> ''
on conflict do nothing;

-- ── 5. The views ────────────────────────────────────────────────────────────
create or replace view metrics.meaningful_events as
select e.* from (
  select p.author as user_id, p.created_at as at,
         case when p.moment then 'moment'
              when exists (select 1 from unnest(p.tags) t where t like 'daily-%') then 'daily'
              else 'post' end as kind,
         'create' as family
    from public.posts p
   where p.type <> 'repost' or coalesce(p.note, '') <> '' or coalesce(p.title, '') <> ''
  union all
  select author, created_at, 'comment', 'create' from public.comments
  union all
  select author, created_at, 'message', 'create' from public.messages
  union all
  select user_id, created_at, 'rsvp', 'create' from public.headcount
  union all
  select user_id, created_at, 'vote', 'create' from public.poll_votes
  union all
  select f.a, greatest(f.created_at, r.created_at), 'friend', 'connect'
    from public.friends f join public.friends r on r.a = f.b and r.b = f.a
  union all
  select user_id, joined_at, 'circle', 'connect' from public.community_members
) e
where not exists (select 1 from metrics.skip k where k.user_id = e.user_id);

-- A person's days with any sign of life: opened (the ping) or did something.
create or replace view metrics.alive_days as
  select d.user_id, d.day from public.user_days d
   where not exists (select 1 from metrics.skip k where k.user_id = d.user_id)
  union
  select user_id, (at at time zone metrics.tz())::date from metrics.meaningful_events;

create or replace view metrics.journeys as
select u.id as user_id,
       u.created_at as account_at,
       (u.created_at at time zone metrics.tz())::date as account_day,
       pd.at as profile_at,
       conn.at as connected_at,
       act.at as action_at,
       ret.day as returned_day,
       case when exists (select 1 from public.invite_redemptions ir where ir.joined = u.id)
            then 'invite' else coalesce(o.source, 'unknown') end as source,
       coalesce(o.platform, 'unknown') as platform,
       o.device_id,
       o.device_first_seen
  from public.users u
  left join public.profile_done pd on pd.user_id = u.id
  left join public.user_origin o on o.user_id = u.id
  left join lateral (
    select min(x) as at from (
      select min(f.created_at) as x from public.friends f where f.a = u.id
      union all
      select min(m.joined_at) from public.community_members m where m.user_id = u.id
    ) s
  ) conn on true
  left join lateral (
    select min(e.at) as at from metrics.meaningful_events e
     where e.user_id = u.id and e.family = 'create'
  ) act on true
  left join lateral (
    select min(a.day) as day from metrics.alive_days a
     where a.user_id = u.id
       and a.day >  (u.created_at at time zone metrics.tz())::date
       and a.day <= (u.created_at at time zone metrics.tz())::date + 7
  ) ret on true
 where not exists (select 1 from metrics.skip k where k.user_id = u.id);

-- The people the numbers are about: everyone but metrics.skip.
create or replace view metrics.people as
  select u.* from public.users u
   where not exists (select 1 from metrics.skip k where k.user_id = u.id);

-- user_days, and posts, without the skipped.
create or replace view metrics.days as
  select d.* from public.user_days d
   where not exists (select 1 from metrics.skip k where k.user_id = d.user_id);
create or replace view metrics.posts as
  select p.* from public.posts p
   where not exists (select 1 from metrics.skip k where k.user_id = p.author);
create or replace view metrics.devices as
  select d.* from public.devices d
   where d.user_id is null or not exists (select 1 from metrics.skip k where k.user_id = d.user_id);

-- ── 6. The admin RPCs ───────────────────────────────────────────────────────
create or replace function public.admin_overview() returns jsonb
language plpgsql stable security definer set search_path = public, metrics as $$
declare
  today date := (now() at time zone metrics.tz())::date;
  res jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only Tria''s team can see that.' using errcode = '42501';
  end if;

  with ev as (
    select user_id, at, kind, (at at time zone metrics.tz())::date as day
      from metrics.meaningful_events where at > now() - interval '120 days'
  ), weeks as (
    select generate_series(0, 11) as w
  )
  select jsonb_build_object(
    'asOf', now(),
    'tz', metrics.tz(),
    'pingSince', (select min(day) from metrics.days),
    'users', (select count(*) from metrics.people),
    'new7', (select count(*) from metrics.people where created_at > now() - interval '7 days'),
    'new30', (select count(*) from metrics.people where created_at > now() - interval '30 days'),
    'dau', (select count(distinct user_id) from ev where day = today),
    'wau', (select count(distinct user_id) from ev where day > today - 7),
    'mau', (select count(distinct user_id) from ev where day > today - 30),
    'avgDau28', (select round(avg(n)::numeric, 1) from (
                   select d::date, (select count(distinct user_id) from ev where ev.day = d::date) as n
                     from generate_series(today - 27, today, interval '1 day') g(d)) s),
    'mau28', (select count(distinct user_id) from ev where day > today - 28),
    'openedDau', (select count(*) from metrics.days where day = today),
    'openedWau', (select count(distinct user_id) from metrics.days where day > today - 7),
    'openedMau', (select count(distinct user_id) from metrics.days where day > today - 30),
    'webVisitors7', (select count(*) from metrics.devices
                      where platform = 'web' and user_id is null and last_seen > now() - interval '7 days'),
    'installs7', (select count(*) from metrics.devices
                   where platform <> 'web' and first_seen > now() - interval '7 days'),
    'friendships', (select count(*) / 2 from public.friends f
                     where exists (select 1 from public.friends r where r.a = f.b and r.b = f.a)
                       and not exists (select 1 from metrics.skip k where k.user_id in (f.a, f.b))),
    'circles', (select count(*) from public.communities),
    'momentsLive', (select count(*) from metrics.posts where moment and created_at > now() - interval '24 hours'),
    'kinds7', (select coalesce(jsonb_object_agg(kind, n), '{}') from (
                 select kind, count(*) as n from ev where day > today - 7 group by kind) s),
    'types7', (select coalesce(jsonb_object_agg(t, n), '{}') from (
                 select case when moment then 'moment'
                             when exists (select 1 from unnest(tags) x where x like 'daily-%') then 'daily'
                             else type end as t, count(*) as n
                   from metrics.posts where created_at > now() - interval '7 days' group by 1) s),
    'platforms7', (select coalesce(jsonb_object_agg(platform, n), '{}') from (
                     select platform, count(distinct user_id) as n
                       from metrics.days where day > today - 7 group by platform) s),
    'series', (select jsonb_agg(jsonb_build_object(
                  'week', today - (w * 7 + 6),
                  'active', (select count(distinct user_id) from ev
                              where day between today - (w * 7 + 6) and today - w * 7),
                  'opened', (select count(distinct user_id) from metrics.days
                              where day between today - (w * 7 + 6) and today - w * 7),
                  'joined', (select count(*) from metrics.people
                              where (created_at at time zone metrics.tz())::date
                                    between today - (w * 7 + 6) and today - w * 7)
                ) order by w desc) from weeks)
  ) into res;
  return res;
end $$;

-- p_days: the window of accounts (or installs) by when they started; 0 = all.
-- p_basis: 'account' (every account, from stage 2) or 'install' (installs since
--   the ping shipped, from stage 1; a device an older account turned up on is
--   not an install).
-- p_by: 'none' | 'cohort' (start week) | 'source' | 'platform'.
create or replace function public.admin_funnel(p_days int, p_basis text, p_by text) returns jsonb
language plpgsql stable security definer set search_path = public, metrics as $$
declare res jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only Tria''s team can see that.' using errcode = '42501';
  end if;

  with acc as (
    select j.*, null::timestamptz as start_at, true as installed
      from metrics.journeys j
     where p_basis <> 'install'
       and (coalesce(p_days, 0) = 0 or j.account_at > now() - make_interval(days => p_days))
  ), inst as (
    select d.id, d.first_seen, d.platform as d_platform, d.source as d_source,
           (select j from metrics.journeys j
             where j.device_id = d.id and j.account_at >= d.first_seen - interval '1 day'
             order by j.account_at limit 1) as j
      from metrics.devices d
     where p_basis = 'install'
       and d.platform <> 'web'
       and (coalesce(p_days, 0) = 0 or d.first_seen > now() - make_interval(days => p_days))
       and not exists (select 1 from public.users u
                        where u.id = d.user_id and u.created_at < d.first_seen - interval '1 day')
  ), rows as (
    select account_at, profile_at, connected_at, action_at, returned_day, source, platform,
           account_at as start_at, true as has_account
      from acc
    union all
    select (j).account_at, (j).profile_at, (j).connected_at, (j).action_at, (j).returned_day,
           coalesce((j).source, d_source), d_platform,
           first_seen, (j).account_at is not null
      from inst
  ), keyed as (
    select *,
      case p_by
        when 'cohort'   then to_char(date_trunc('week', start_at at time zone metrics.tz()), 'YYYY-MM-DD')
        when 'source'   then source
        when 'platform' then platform
        else 'all' end as k,
      has_account and profile_at is not null as r3,
      has_account and connected_at is not null as r4,
      has_account and action_at is not null as r5,
      has_account and returned_day is not null as r6,
      has_account and connected_at <= account_at + interval '7 days'
                  and action_at    <= account_at + interval '7 days' as activated,
      greatest(connected_at, action_at) - account_at as to_act
    from rows
  )
  select jsonb_build_object(
    'basis', p_basis, 'by', p_by, 'days', p_days,
    'groups', coalesce(jsonb_agg(g order by g->>'key'), '[]'))
    into res
    from (
      select jsonb_build_object(
        'key', k,
        'n', count(*),
        'seq', jsonb_build_array(
                 count(*),
                 count(*) filter (where has_account),
                 count(*) filter (where r3),
                 count(*) filter (where r3 and r4),
                 count(*) filter (where r3 and r4 and r5),
                 count(*) filter (where r3 and r4 and r5 and r6)),
        'any', jsonb_build_array(
                 count(*),
                 count(*) filter (where has_account),
                 count(*) filter (where r3),
                 count(*) filter (where r4),
                 count(*) filter (where r5),
                 count(*) filter (where r6)),
        'young', count(*) filter (where has_account and account_at > now() - interval '7 days'),
        'activated', count(*) filter (where activated),
        'actMedianH', round((extract(epoch from percentile_cont(0.5) within group (order by to_act)
                              filter (where activated)) / 3600)::numeric, 1),
        'actP75H', round((extract(epoch from percentile_cont(0.75) within group (order by to_act)
                              filter (where activated)) / 3600)::numeric, 1)
      ) as g
      from keyed group by k
    ) s;
  return res;
end $$;

-- Weekly cohorts by account week, the last 12; week k is days 7k to 7k+6
-- after the account's day, and a person counts when they were alive on any.
create or replace function public.admin_retention() returns jsonb
language plpgsql stable security definer set search_path = public, metrics as $$
declare
  today date := (now() at time zone metrics.tz())::date;
  res jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only Tria''s team can see that.' using errcode = '42501';
  end if;

  with c as (
    select u.id, (u.created_at at time zone metrics.tz())::date as d0,
           date_trunc('week', u.created_at at time zone metrics.tz())::date as wk
      from metrics.people u
     where u.created_at > now() - interval '12 weeks'
  ), cell as (
    select c.wk, w.k,
           count(distinct c.id) filter (where c.d0 + w.k * 7 <= today) as eligible,
           count(distinct c.id) filter (where exists (
             select 1 from metrics.alive_days a
              where a.user_id = c.id and a.day between c.d0 + w.k * 7 and c.d0 + w.k * 7 + 6)
             and c.d0 + w.k * 7 <= today) as alive
      from c cross join generate_series(1, 8) w(k)
     group by c.wk, w.k
  )
  select jsonb_build_object('cohorts', coalesce(jsonb_agg(r order by r->>'week'), '[]'))
    into res
    from (
      select jsonb_build_object(
        'week', c.wk,
        'size', (select count(*) from c c2 where c2.wk = c.wk),
        'weeks', (select jsonb_agg(jsonb_build_object('k', k, 'eligible', eligible, 'alive', alive) order by k)
                    from cell where cell.wk = c.wk)
      ) as r
      from (select distinct wk from c) c
    ) s;
  return res;
end $$;

revoke all on function public.admin_overview() from public;
revoke all on function public.admin_funnel(int, text, text) from public;
revoke all on function public.admin_retention() from public;
grant execute on function public.admin_overview() to authenticated;
grant execute on function public.admin_funnel(int, text, text) to authenticated;
grant execute on function public.admin_retention() to authenticated;

-- ── Checks ──────────────────────────────────────────────────────────────────
select 'admins' as check, count(*) as rows from public.admins
union all select 'profile_done backfilled', count(*) from public.profile_done
union all select 'functions', count(*) from pg_proc
 where proname in ('note_open', 'admin_overview', 'admin_funnel', 'admin_retention', 'is_admin');
