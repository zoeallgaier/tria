-- Activity reminders — the journal, and the clock that drives them.
--
-- Three nudges per activity, to its AUDIENCE rather than to its RSVP list: a
-- week out, two days out, and the morning of. Sending to the audience is the
-- point rather than an accident — the week-out reminder exists precisely to
-- reach someone who hasn't answered yet, so keying it on `headcount` would drop
-- the only people it was written for. Who counts as invited is the post's own
-- audience: the allowlist for a 'list' activity, the host's mutual friends for
-- 'circle' AND for 'public' (canJoin is friends-only, so a stranger who can read
-- a public activity still can't answer it).
--
-- All the copy and the audience resolution live in the Edge Function
-- (supabase/functions/push/index.ts, the `activity-reminders` branch). This file
-- is only the two pieces that have to be state in the database: somewhere to
-- record what has already been sent, and something to call the function.
--
-- Run once in the SQL editor, and note it does NOT need a client bump — nothing
-- in css/js/html changes, and reminders are push-only (they are the app talking,
-- not a person, so they deliberately don't file a row in the Updates ledger).

-- ── 1. The sent-journal ─────────────────────────────────────────────────────
-- One row per (activity, person, stage): "this person has been told this once."
-- This is what makes the hourly sweep idempotent, and it is what lets the sweep
-- be a RETRY rather than a repeat — if the 9am pass dies, 10am finishes the job
-- and nobody hears about the same plan twice.
--
-- Cascades on both sides, so a deleted activity or a deleted account takes its
-- bookkeeping with it.
--
-- Note the deliberate consequence: an activity whose date is MOVED does not
-- re-arm a stage it has already sent. Nudging a plan a day later is not worth a
-- second "two days away" to everyone who already got one.
create table if not exists public.activity_reminders (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  stage   text not null check (stage in ('week', 'two', 'day')),
  sent_at timestamptz not null default now(),
  primary key (post_id, user_id, stage)
);

-- RLS on with NO policies, on purpose. This is the sender's own bookkeeping and
-- there is nothing in it for a client to read — the service role bypasses RLS,
-- so the Edge Function still sees it and everybody else sees an empty table.
alter table public.activity_reminders enable row level security;

-- ── 2. The clock ────────────────────────────────────────────────────────────
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Hourly, off the top of the hour so it isn't queued behind everything else in
-- the minute. The function ignores every call outside 09:00–21:00 US Mountain
-- (the app's own timezone — see dayMT in store.js), and the journal above makes
-- the remaining passes free: the first one inside the window does the work and
-- the rest find their rows already written.
--
-- Hourly rather than a single daily run at 9am for two reasons: pg_cron
-- schedules in UTC, so a fixed daily hour drifts an hour twice a year across
-- DST, and one shot a day means one cold-start failure costs a whole day of
-- reminders with nothing to catch it.
do $$
begin
  perform cron.unschedule('tria-activity-reminders')
    from cron.job where jobname = 'tria-activity-reminders';
end
$$;

select cron.schedule(
  'tria-activity-reminders',
  '7 * * * *',
  $$
  select net.http_post(
    -- Same function and same URL as the webhooks in push-webhooks.sql (Supabase
    -- auto-named the slug "swift-processor" at creation and it can't be renamed);
    -- only the body says which caller this is.
    url     := 'https://autjondbgcjctezbxliv.supabase.co/functions/v1/swift-processor',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'sb_publishable_HybWJd3J_dDESzb5-OGAbg_9ksocyyQ'
    ),
    body    := jsonb_build_object('kind', 'activity-reminders')
  );
  $$
);

-- To check on it later:
--   select * from cron.job where jobname = 'tria-activity-reminders';
--   select * from cron.job_run_details order by start_time desc limit 20;
--   select * from public.activity_reminders order by sent_at desc limit 50;
-- To stop it:
--   select cron.unschedule('tria-activity-reminders');
