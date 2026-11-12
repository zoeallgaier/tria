-- ── The admin dashboard's Dailies page ──────────────────────────────────────
-- Run in the Supabase SQL editor AFTER daily-analytics.sql (its rotation,
-- metrics.daily_occurrences, is how a day knows its prompt) and
-- admin-dashboard.sql. Read only, safe to re-run.
--
-- Zoe, 2026-11-11: "daily stats should also be its own page". No new
-- tracking: an answer is a post with its day's `daily-<slug>` tag, matched to
-- the occurrence of that slug on its local day (daily-analytics.sql's rule).
-- Admins are left out (metrics.posts). Likes are NOT read here: they are the
-- private signal and never leave the database (see daily-analytics.sql); a
-- "reply" is a comment from someone other than the answer's author.
--
--   days      the last 28 days: prompt, answers, people, answers that got a
--             reply, and `around`, the people alive in the 7 days to that
--             day (opened or did something), the fair denominator.
--   prompts   every prompt that has run, with its runs and people per run.
--   types     what answers were made of, 28 days.
--   answerers, regulars   people who answered in 28 days, and on 4 days or more.
create or replace function public.admin_dailies() returns jsonb
language plpgsql stable security definer set search_path = public, metrics as $$
declare
  today date := (now() at time zone metrics.tz())::date;
  res jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only Tria''s team can see that.' using errcode = '42501';
  end if;

  with ans as (
    select p.id, p.author, p.type, substr(tg.t, 7) as slug,
           (p.created_at at time zone metrics.tz())::date as d,
           exists (select 1 from public.comments c where c.post_id = p.id and c.author <> p.author) as replied
      from metrics.posts p
      cross join lateral (select t from unnest(p.tags) t where t like 'daily-%' limit 1) tg(t)
     where p.type not in ('repost', 'activity') and not p.moment
  ), runs as (
    select o.on_date, o.slug, o.prompt, o.type, o.run_no,
           count(a.id) as answers, count(distinct a.author) as people,
           count(a.id) filter (where a.replied) as replied
      from metrics.daily_occurrences o
      left join ans a on a.slug = o.slug and a.d = o.on_date
     group by o.on_date, o.slug, o.prompt, o.type, o.run_no
  )
  select jsonb_build_object(
    'asOf', now(),
    'tz', metrics.tz(),
    'days', (select coalesce(jsonb_agg(jsonb_build_object(
                'day', r.on_date, 'slug', r.slug, 'prompt', r.prompt, 'type', r.type, 'run', r.run_no,
                'answers', r.answers, 'people', r.people, 'replied', r.replied,
                'around', (select count(distinct a.user_id) from metrics.alive_days a
                            where a.day between r.on_date - 6 and r.on_date)
              ) order by r.on_date desc), '[]')
               from runs r where r.on_date > today - 28),
    'prompts', (select coalesce(jsonb_agg(jsonb_build_object(
                   'slug', slug, 'prompt', prompt, 'type', type, 'runs', n,
                   'answers', answers, 'avgPeople', avg_people)), '[]') from (
                  select slug, min(prompt) as prompt, min(type) as type, count(*) as n,
                         sum(answers) as answers, round(avg(people), 1) as avg_people
                    from runs where on_date < today group by slug) s),
    'types', (select coalesce(jsonb_object_agg(type, n), '{}') from (
                select type, count(*) as n from ans where d > today - 28 group by type) s),
    'answerers', (select count(distinct author) from ans where d > today - 28),
    'regulars', (select count(*) from (
                   select author from ans where d > today - 28
                    group by author having count(distinct d) >= 4) s)
  ) into res;
  return res;
end $$;

revoke all on function public.admin_dailies() from public;
grant execute on function public.admin_dailies() to authenticated;

select 'admin_dailies' as check, count(*) as ok from pg_proc where proname = 'admin_dailies';
