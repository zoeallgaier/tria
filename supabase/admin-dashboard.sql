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
--   4 Connected          the first mutual friend, or first circle joined
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

-- Accounts that are not people using Tria, left out the same way (Zoe,
-- 2026-11-11: "remove activity from tria reviewer as well, I use that to
-- test"): the App Review account she tests with. Seeded by anything that says
-- "review" in its handle, name or email; the check at the foot lists who is
-- left out, so a wrong match shows. Add one by hand:
--   insert into public.metrics_ignore (user_id) select id from public.users where username = '...';
create table if not exists public.metrics_ignore (
  user_id    uuid primary key references public.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.metrics_ignore enable row level security;
revoke all on public.metrics_ignore from anon, authenticated;

insert into public.metrics_ignore (user_id)
select u.id from public.users u left join auth.users a on a.id = u.id
 where u.username ilike '%review%' or u.name ilike '%review%' or a.email ilike '%review%'
on conflict do nothing;

create or replace view metrics.skip as
  select user_id from public.admins where not in_metrics
  union
  select user_id from public.metrics_ignore;

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
  -- Each side at the moment THEY acted (the ask, or the yes), once the tie is
  -- mutual. Until 2026-11-11 both sides were stamped at the yes, so being
  -- accepted counted as "active" (and "came back") for someone who did nothing.
  select f.a, f.created_at, 'friend', 'connect'
    from public.friends f
   where exists (select 1 from public.friends r where r.a = f.b and r.b = f.a)
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
  -- Connected: a MUTUAL friend (when it became mutual) or a circle joined. Until
  -- 2026-11-11 any friend row they made counted, so a follow or an unanswered
  -- request read as connected.
  left join lateral (
    select min(x) as at from (
      select min(greatest(f.created_at, r.created_at)) as x
        from public.friends f join public.friends r on r.a = f.b and r.b = f.a
       where f.a = u.id
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
  ), allev as (
    -- Every day anyone did something, ever: the All time chart.
    select distinct user_id, (at at time zone metrics.tz())::date as day from metrics.meaningful_events
  ), hist as (
    select generate_series(0, least(260, greatest(0, (today - coalesce((select min(day) from allev), today)) / 7))) as w
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
    -- The 30 days before those: Monthly active's "on last month".
    'mauPrev', (select count(distinct user_id) from ev where day > today - 60 and day <= today - 30),
    -- A point a week since the first sign of life: weekly and monthly active
    -- as each stood that week's end (Zoe, 2026-11-11: "all time active graph").
    'history', (select jsonb_agg(jsonb_build_object(
                  'week', today - (w * 7 + 6),
                  'weekly', (select count(distinct user_id) from allev
                              where day between today - (w * 7 + 6) and today - w * 7),
                  'monthly', (select count(distinct user_id) from allev
                               where day between today - (w * 7 + 29) and today - w * 7)
                ) order by w desc) from hist),
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
                  -- Monthly active as it stood at this week's end: the 30 days
                  -- ending that day (Zoe, 2026-11-11: "add monthly active card
                  -- and graph"). ev reaches 120 days back, past 11 weeks plus 30.
                  'monthly', (select count(distinct user_id) from ev
                               where day between today - (w * 7 + 29) and today - w * 7),
                  'monthlyOpened', (select count(distinct user_id) from metrics.days
                               where day between today - (w * 7 + 29) and today - w * 7),
                  'joined', (select count(*) from metrics.people
                              where (created_at at time zone metrics.tz())::date
                                    between today - (w * 7 + 6) and today - w * 7)
                ) order by w desc) from weeks)
  ) into res;
  return res;
end $$;

-- The Activity page (Zoe, 2026-11-11: Made, Done and Opened on "should be its
-- own page and I want to see more data"). Everything over a window of p_days
-- ending today (0 = since the first account), each count beside the same
-- window before it, so a change can be read. No new tracking: posts, comments,
-- messages, RSVPs, votes, friendships, circle joins and the open ping, admins
-- left out. Likes are not read.
--   kinds, types     what was done and made: count, people, the window before.
--                    types leaves out bare reposts (a quote is 'quote'), so it
--                    sums to kinds' post + moment + daily; a friendship is
--                    counted once, the day it became mutual (audited 2026-11-11)
--   active, makers   people who did anything, people who made a post
--   audiences        where posts went: Anyone, My circle, chosen people, a circle
--   conversation     posts (not Moments or bare reposts): how many got a
--                    comment from someone else, how fast, comments per post
--   chats            messages by kind of chat: messages, chats, people
--   series           a point a day (a week past 120 days): events, people, posts
--   circles          the busiest circles: posts, people posting, joins
--   opened, platforms, os, versions   people who opened Tria, and on what
--                    (people, not devices; signed-out visitors left out)
create or replace function public.admin_activity(p_days int) returns jsonb
language plpgsql stable security definer set search_path = public, metrics as $$
declare
  today date := (now() at time zone metrics.tz())::date;
  d int := greatest(coalesce(p_days, 0), 0);
  t0 date;        -- this window: t0 .. today
  p0 date;        -- the one before: p0 .. t0 - 1 (none for all time)
  by_week boolean;
  res jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only Tria''s team can see that.' using errcode = '42501';
  end if;
  if d > 0 then
    t0 := today - d + 1; p0 := t0 - d;
  else
    select coalesce(min((created_at at time zone metrics.tz())::date), today) into t0 from metrics.people;
  end if;
  by_week := today - t0 > 120;

  with ev as (
    select user_id, kind, (at at time zone metrics.tz())::date as day
      from metrics.meaningful_events
     where at >= (coalesce(p0, t0)::timestamp at time zone metrics.tz())
  ), ps as (
    select p.id, p.author, p.audience, p.community_id, p.created_at,
           (p.created_at at time zone metrics.tz())::date as day,
           case when p.moment then 'moment'
                when exists (select 1 from unnest(p.tags) x where x like 'daily-%') then 'daily'
                when p.type = 'repost' then 'quote'   -- a bare one is left out below
                else p.type end as t,
           p.type = 'repost' and coalesce(p.note, '') = '' and coalesce(p.title, '') = '' as bare
      from metrics.posts p
     where p.created_at >= (coalesce(p0, t0)::timestamp at time zone metrics.tz())
  ), conv as (
    select p.id,
           (select count(*) from public.comments c where c.post_id = p.id
               and not exists (select 1 from metrics.skip k where k.user_id = c.author)) as comments,
           (select min(c.created_at) from public.comments c
             where c.post_id = p.id and c.author <> p.author
               and not exists (select 1 from metrics.skip k where k.user_id = c.author)) - p.created_at as first_reply
      from ps p where p.day >= t0 and p.t <> 'moment' and not p.bare
  ), fr as (
    -- Each friendship ONCE, on the day it became mutual. meaningful_events
    -- stamps each side when they acted, which is right for "active" but
    -- counted every friendship twice, a side of it maybe in another window.
    select f.a, f.b, (greatest(f.created_at, r.created_at) at time zone metrics.tz())::date as day
      from public.friends f join public.friends r on r.a = f.b and r.b = f.a
     where f.a < f.b
       and greatest(f.created_at, r.created_at) >= (coalesce(p0, t0)::timestamp at time zone metrics.tz())
       and not exists (select 1 from metrics.skip k where k.user_id in (f.a, f.b))
  ), dev as (
    -- People by the devices they opened Tria on in the window. user_days keeps
    -- only a day's FIRST platform, so the app and the web on one day read as
    -- one; a device's last_seen knows each. Signed-out visitors aren't people.
    select distinct user_id, platform, os, coalesce(app_version, 'unknown') as v
      from metrics.devices
     where user_id is not null and last_seen >= (t0::timestamp at time zone metrics.tz())
  ), msg as (
    select m.author, m.chat_id, ch.kind, (m.created_at at time zone metrics.tz())::date as day
      from public.messages m join public.chats ch on ch.id = m.chat_id
     where m.created_at >= (t0::timestamp at time zone metrics.tz())
       and not exists (select 1 from metrics.skip k where k.user_id = m.author)
  ), buckets as (
    select g::date as at from generate_series(
      case when by_week then date_trunc('week', t0)::date else t0 end, today,
      case when by_week then interval '7 days' else interval '1 day' end) g
  )
  select jsonb_build_object(
    'days', d, 'from', t0, 'to', today, 'prevFrom', p0, 'byWeek', by_week,
    'active', (select count(distinct user_id) from ev where day >= t0),
    'activePrev', case when p0 is null then null else (select count(distinct user_id) from ev where day < t0) end,
    'makers', (select count(distinct author) from ps where day >= t0 and not bare),
    'makersPrev', case when p0 is null then null else (select count(distinct author) from ps where day < t0 and not bare) end,
    'kinds', (select coalesce(jsonb_object_agg(kind, jsonb_build_object('n', n, 'people', people, 'prev', prev)), '{}') from (
                select kind, count(*) filter (where day >= t0) as n,
                       count(distinct user_id) filter (where day >= t0) as people,
                       case when p0 is null then null else count(*) filter (where day < t0) end as prev
                  from ev where kind <> 'friend' group by kind
                union all
                select 'friend', count(*) filter (where day >= t0),
                       (select count(distinct x) from fr, unnest(array[fr.a, fr.b]) x where fr.day >= t0),
                       case when p0 is null then null else count(*) filter (where day < t0) end
                  from fr) s where n > 0 or prev > 0),
    'types', (select coalesce(jsonb_object_agg(t, jsonb_build_object('n', n, 'people', people, 'prev', prev)), '{}') from (
                select t, count(*) filter (where day >= t0) as n,
                       count(distinct author) filter (where day >= t0) as people,
                       case when p0 is null then null else count(*) filter (where day < t0) end as prev
                  from ps where not bare group by t) s where n > 0 or prev > 0),
    'audiences', (select coalesce(jsonb_object_agg(audience, n), '{}') from (
                    select audience, count(*) as n from ps
                     where day >= t0 and t <> 'moment' and not bare group by audience) s),
    'conversation', (select jsonb_build_object(
                       'posts', count(*),
                       'replied', count(*) filter (where first_reply is not null),
                       'comments', coalesce(sum(comments), 0),
                       'firstReplyH', round((extract(epoch from percentile_cont(0.5) within group (order by first_reply)) / 3600)::numeric, 1))
                     from conv),
    'chats', (select coalesce(jsonb_object_agg(kind, jsonb_build_object('messages', n, 'chats', chats, 'people', people)), '{}') from (
                select kind, count(*) as n, count(distinct chat_id) as chats, count(distinct author) as people
                  from msg group by kind) s),
    'series', (select jsonb_agg(jsonb_build_object(
                  'at', b.at,
                  'events', (select count(*) from ev where ev.kind <> 'friend' and ev.day between b.at and b.at + case when by_week then 6 else 0 end)
                          + (select count(*) from fr where fr.day between b.at and b.at + case when by_week then 6 else 0 end),
                  'people', (select count(distinct user_id) from ev where ev.day between b.at and b.at + case when by_week then 6 else 0 end),
                  'posts', (select count(*) from ps where not ps.bare and ps.day between b.at and b.at + case when by_week then 6 else 0 end)
                ) order by b.at) from buckets b),
    'circles', (select coalesce(jsonb_agg(c order by (c->>'posts')::int desc, (c->>'joins')::int desc), '[]') from (
                 select c from (
                  select jsonb_build_object('name', cm.name, 'slug', cm.slug,
                           'posts', (select count(*) from ps where ps.community_id = cm.id and ps.day >= t0 and not ps.bare),
                           'people', (select count(distinct author) from ps where ps.community_id = cm.id and ps.day >= t0 and not ps.bare),
                           'joins', (select count(*) from public.community_members mm
                                      where mm.community_id = cm.id
                                        and mm.joined_at >= (t0::timestamp at time zone metrics.tz())
                                        and not exists (select 1 from metrics.skip k where k.user_id = mm.user_id))) as c
                    from public.communities cm) x
                 where (c->>'posts')::int > 0 or (c->>'joins')::int > 0
                 order by (c->>'posts')::int desc, (c->>'joins')::int desc
                 limit 8) s),
    -- All three in PEOPLE, out of 'opened': someone on two counts in both.
    'opened', (select count(distinct user_id) from dev),
    'platforms', (select coalesce(jsonb_object_agg(platform, n), '{}') from (
                    select platform, count(distinct user_id) as n from dev group by platform) s),
    'os', (select coalesce(jsonb_object_agg(os, n), '{}') from (
             select os, count(distinct user_id) as n from dev group by os) s),
    'versions', (select coalesce(jsonb_agg(jsonb_build_object('v', v, 'n', n) order by n desc), '[]') from (
                   select v, count(distinct user_id) as n from dev
                    where platform = 'ios' group by v order by 2 desc limit 6) s)
  ) into res;
  return res;
end $$;
revoke all on function public.admin_activity(int) from public;
grant execute on function public.admin_activity(int) to authenticated;

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

-- Settling in (Zoe, 2026-11-11: the funnel was "painful to look at or
-- understand"; Activated and settled in "can be folded"). One question: of the
-- people who joined, what did they do in their FIRST WEEK? Each step counted on
-- its own (no "in order"), and only accounts at least 7 days old, so nobody is
-- counted as not doing something they still have days left to do.
--   profile    a photo or bio (accounts from before profile_done existed are
--              backfilled at their account's time, so they count as week one)
--   connected  a mutual friend or a circle joined
--   shared     a post, Moment, daily, comment, message, RSVP or vote
--   back       opened or did something on another day in the week
--   settled    connected AND shared, both in week one (was "Activated")
-- p_days: accounts that joined in the p_days before the last 7; 0 = all.
create or replace function public.admin_settling(p_days int) returns jsonb
language plpgsql stable security definer set search_path = public, metrics as $$
declare res jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only Tria''s team can see that.' using errcode = '42501';
  end if;

  with j as (
    select j.*, j.account_at + interval '7 days' as wk
      from metrics.journeys j
     where coalesce(p_days, 0) = 0 or j.account_at > now() - make_interval(days => p_days + 7)
  ), ripe as (
    select *,
      profile_at   <= wk as p,
      connected_at <= wk as c,
      action_at    <= wk as s,
      returned_day is not null as b
      from j where account_at <= now() - interval '7 days'
  )
  select jsonb_build_object(
    'days', p_days,
    'pingSince', (select min(day) from metrics.days),
    'people', (select count(*) from ripe),
    'young', (select count(*) from j where account_at > now() - interval '7 days'),
    'profile', (select count(*) from ripe where p),
    'connected', (select count(*) from ripe where c),
    'shared', (select count(*) from ripe where s),
    'back', (select count(*) from ripe where b),
    'settled', (select count(*) from ripe where c and s),
    'medianH', (select round((extract(epoch from percentile_cont(0.5) within group
                  (order by greatest(connected_at, action_at) - account_at)) / 3600)::numeric, 1)
                  from ripe where c and s)
  ) into res;
  return res;
end $$;
revoke all on function public.admin_settling(int) from public;
grant execute on function public.admin_settling(int) to authenticated;

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
union all select 'left out: ' || coalesce(string_agg('@' || u.username, ', '), 'nobody'), count(*)
  from metrics.skip k join public.users u on u.id = k.user_id
union all select 'profile_done backfilled', count(*) from public.profile_done
union all select 'functions', count(*) from pg_proc
 where proname in ('note_open', 'admin_overview', 'admin_activity', 'admin_funnel', 'admin_settling', 'admin_retention', 'is_admin');
