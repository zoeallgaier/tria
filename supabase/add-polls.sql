-- Tria — Polls (a fifth post type)
-- Run once in the Supabase dashboard → SQL Editor. Additive + idempotent, so a
-- re-run is harmless. schema.sql already folds this in for fresh installs.
--
-- A poll is a Note that carries a small question + 2–4 choices, and expires 24h
-- after it's posted. The choices live inline on the post row (a `poll` jsonb);
-- the votes live in their own table, modeled on `headcount` — public tallies
-- (everyone who can see the poll sees who voted for what), one row per voter.

-- ── The poll payload on the post ─────────────────────────────────────────────
-- Shape: { "q": "the question", "options": ["A", "B", ...] }. Expiry is NOT
-- stored — it's always created_at + 24h, so there's one source of truth and no
-- clock to keep in sync (the RLS vote guard below computes it the same way).
alter table public.posts add column if not exists poll jsonb;

-- Let `poll` join the four existing types. The inline CHECK on posts.type is
-- auto-named posts_type_check; drop and re-add it with the fifth value.
alter table public.posts drop constraint if exists posts_type_check;
alter table public.posts add constraint posts_type_check
  check (type in ('note','find','photo','activity','poll'));

-- ── Votes ────────────────────────────────────────────────────────────────────
-- One row per (poll, voter). `choice` is the index into posts.poll->'options'.
-- Single-select: the primary key means one vote per person; changing your mind
-- is an UPDATE of `choice`, not a second row.
create table if not exists public.poll_votes (
  post_id    uuid not null references public.posts(id) on delete cascade,
  user_id    uuid not null references public.users(id) on delete cascade,
  choice     smallint not null,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

alter table public.poll_votes enable row level security;

-- Public like headcount: who voted is the point of a poll, so any signed-in user
-- may read every vote. You may only write your OWN vote, and only while the poll
-- is still open — the 24h expiry is enforced HERE, in the database, not just in
-- the UI, so a closed poll can't be voted on by a hand-rolled request.
drop policy if exists "poll_votes read all"    on public.poll_votes;
drop policy if exists "poll_votes insert own"  on public.poll_votes;
drop policy if exists "poll_votes update own"  on public.poll_votes;
drop policy if exists "poll_votes delete own"  on public.poll_votes;

create policy "poll_votes read all" on public.poll_votes
  for select to authenticated using (true);

create policy "poll_votes insert own" on public.poll_votes
  for insert to authenticated with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.posts p
      where p.id = post_id and p.type = 'poll'
        and now() < p.created_at + interval '24 hours'
    )
  );

create policy "poll_votes update own" on public.poll_votes
  for update to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.posts p
      where p.id = post_id and p.type = 'poll'
        and now() < p.created_at + interval '24 hours'
    )
  );

-- Retracting your vote is allowed any time (even after close, to withdraw).
create policy "poll_votes delete own" on public.poll_votes
  for delete to authenticated using (user_id = auth.uid());
