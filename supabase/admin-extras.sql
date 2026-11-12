-- ── The admin dashboard's Community section ─────────────────────────────────
-- Run in the Supabase SQL editor AFTER admin-dashboard.sql. Read only, safe to
-- re-run: one function, `admin_extras()`, refusing anyone not in `admins`.
--
-- NO NEW TRACKING (Zoe, 2026-11-11: "include any other goodies (without adding
-- any tracking)"). Everything here is read off tables the app already keeps
-- for its own sake: friends, circles, posts' tags and audiences, profiles,
-- invites, push subscriptions, blocks. Nothing reads a post's or a message's
-- words, and counts are counts: no one's content leaves the database.
-- Admins are left out as everywhere (metrics.skip, admin-dashboard.sql), except
-- as an inviter: who brought people in is credit, not skew. A circle's member
-- count is its real size, the one the app shows.

create or replace function public.admin_extras() returns jsonb
language plpgsql stable security definer set search_path = public, metrics as $$
declare
  today date := (now() at time zone metrics.tz())::date;
  total int := (select count(*) from metrics.people);
  res jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only Tria''s team can see that.' using errcode = '42501';
  end if;

  with mutual as (
    select f.a as user_id, count(*) as n
      from public.friends f
      join public.friends r on r.a = f.b and r.b = f.a
     group by f.a
  ), per as (
    select u.id, coalesce(m.n, 0) as n from metrics.people u left join mutual m on m.user_id = u.id
  )
  select jsonb_build_object(
    'asOf', now(),
    'users', total,

    -- How connected people are: mutual friends each.
    'friends', jsonb_build_object(
      'median', (select percentile_cont(0.5) within group (order by n) from per),
      'buckets', (select jsonb_agg(jsonb_build_object('label', label, 'n', n) order by o) from (
          select o, label, (select count(*) from per where n between lo and hi) as n
            from (values (0, '0', 0, 0), (1, '1', 1, 1), (2, '2 to 4', 2, 4), (3, '5 to 9', 5, 9),
                         (4, '10 to 24', 10, 24), (5, '25 or more', 25, 1000000)) b(o, label, lo, hi)) s),
      'alone', (select count(*) from per p where p.n = 0
                  and not exists (select 1 from public.community_members cm where cm.user_id = p.id))
    ),

    -- The circles, by size, with this week's life.
    'circles', (select coalesce(jsonb_agg(c order by (c->>'members')::int desc, c->>'slug'), '[]') from (
        select jsonb_build_object(
          'slug', co.slug, 'name', co.name, 'inviteOnly', co.invite_only,
          'created', co.created_at,
          'members', (select count(*) from public.community_members m where m.community_id = co.id),
          'joins7', (select count(*) from public.community_members m
                      where m.community_id = co.id and m.joined_at > now() - interval '7 days'),
          'posts7', (select count(*) from metrics.posts p
                      where p.community_id = co.id and p.created_at > now() - interval '7 days')
        ) as c
        from public.communities co
      ) s),

    -- The last fortnight of dailies, by answers. A daily is its tag.
    'dailies', (select coalesce(jsonb_agg(d order by d->>'day' desc), '[]') from (
        select jsonb_build_object(
          'slug', substr(t, 7),
          'day', min((p.created_at at time zone metrics.tz())::date),
          'answers', count(*),
          'people', count(distinct p.author)) as d
          from metrics.posts p, unnest(p.tags) t
         where t like 'daily-%' and p.created_at > now() - interval '14 days'
         group by t
      ) s),

    -- When Tria is used: meaningful events over the last 28 days, by weekday
    -- (0 Sunday) and hour, in the reporting zone.
    'rhythm', (select coalesce(jsonb_agg(jsonb_build_array(dow, hr, n)), '[]') from (
        select extract(dow from at at time zone metrics.tz())::int as dow,
               extract(hour from at at time zone metrics.tz())::int as hr,
               count(*) as n
          from metrics.meaningful_events
         where at > now() - interval '28 days'
         group by 1, 2
      ) s),

    -- Who brings people in: invite links redeemed.
    'invites', jsonb_build_object(
      'total', (select count(*) from public.invite_redemptions),
      'last30', (select count(*) from public.invite_redemptions where created_at > now() - interval '30 days'),
      'top', (select coalesce(jsonb_agg(x order by (x->>'n')::int desc), '[]') from (
          select jsonb_build_object('name', u.name, 'handle', u.username, 'n', count(*)) as x
            from public.invite_redemptions r join public.users u on u.id = r.inviter
           group by u.id, u.name, u.username
           order by count(*) desc limit 5
        ) s)
    ),

    -- What people have set up, as shares of everyone. Not a bio or pronouns
    -- (Zoe, 2026-11-12: "bio doesn't need to be tracked, same for pronouns").
    'adoption', jsonb_build_object(
      'photo',    (select count(*) from metrics.people where avatar is not null),
      'private',  (select count(*) from metrics.people where private),
      'charms',   (select count(*) from metrics.people where cardinality(coalesce(charms, '{}')) > 0),
      'pins',     (select count(*) from metrics.people where pinned is not null and jsonb_array_length(pinned) > 0),
      'theme',    (select count(*) from metrics.people where accent is not null),
      'push',     (select count(distinct user_id) from public.push_subscriptions ps where not exists (select 1 from metrics.skip k where k.user_id = ps.user_id)),
      'posted',   (select count(distinct author) from metrics.posts),
      'moment',   (select count(distinct author) from metrics.posts where moment),
      'circle',   (select count(distinct user_id) from public.community_members cm where not exists (select 1 from metrics.skip k where k.user_id = cm.user_id)),
      'daily',    (select count(distinct p.author) from metrics.posts p
                    where exists (select 1 from unnest(p.tags) t where t like 'daily-%'))
    ),

    -- Colour picks: users.accent, null being "Photo" (sampled from the face).
    'themes', (select coalesce(jsonb_object_agg(k, n), '{}') from (
        select coalesce(accent, 'photo') as k, count(*) as n from metrics.people group by 1) s),

    -- Who posts reach, the last 30 days.
    'audiences', (select coalesce(jsonb_object_agg(audience, n), '{}') from (
        select audience, count(*) as n from metrics.posts
         where created_at > now() - interval '30 days' and not moment group by audience) s),

    -- The newest accounts and how far each has come.
    'newest', (select coalesce(jsonb_agg(x order by x->>'joined' desc), '[]') from (
        select jsonb_build_object(
          'name', u.name, 'handle', u.username, 'joined', u.created_at, 'photo', u.avatar is not null,
          'profile', j.profile_at is not null, 'connected', j.connected_at is not null,
          'acted', j.action_at is not null, 'returned', j.returned_day is not null,
          'source', j.source, 'platform', j.platform) as x
          from metrics.people u join metrics.journeys j on j.user_id = u.id
         order by u.created_at desc limit 15
      ) s),

    -- Safety: blocks, as a count.
    'blocks', jsonb_build_object(
      'total', (select count(*) from public.blocks b
                 where not exists (select 1 from metrics.skip k where k.user_id = b.blocker)),
      'last30', (select count(*) from public.blocks b where b.created_at > now() - interval '30 days'
                 and not exists (select 1 from metrics.skip k where k.user_id = b.blocker)))
  ) into res;
  return res;
end $$;

revoke all on function public.admin_extras() from public;
grant execute on function public.admin_extras() to authenticated;

select 'admin_extras' as check, count(*) as ok from pg_proc where proname = 'admin_extras';
