-- Tria — Supabase schema (Path B, the real shared backend)
-- Run this once in the Supabase dashboard → SQL Editor.
--
-- ⚠️  This DROPS and recreates every table. Only run it while they are empty
--     step-1 scaffolding (no real data yet). Children are dropped first so the
--     foreign keys unwind cleanly.
--
-- CANONICAL: this file folds in every migration in this directory, so a fresh
-- install needs only this plus storage.sql (buckets) and push-subscriptions.sql
-- (push, optional). The dated migrations stay on disk as the record of what was
-- run against the live DB — don't run them after this one.
--
-- Folded in: rename-post-to-note · add-activities · add-activity-when ·
-- add-likes · add-polls · add-frame-video · swap-photo-blur-for-tint ·
-- friend-requests · activity-audience · profile-privacy · blocks ·
-- post-audience-public · restore-block-gate.

drop table if exists public.blocks   cascade;
drop table if exists public.post_audience cascade;
drop table if exists public.poll_votes cascade;
drop table if exists public.headcount cascade;
drop table if exists public.likes    cascade;
drop table if exists public.comments cascade;
drop table if exists public.friends  cascade;
drop table if exists public.posts    cascade;
drop table if exists public.users    cascade;

-- ── Profiles ────────────────────────────────────────────────────────────────
-- One row per auth user; `id` is shared with auth.users so a profile is just
-- the public face of a login. Email + password live in auth.users (managed by
-- Supabase); this table holds everything the UI shows.
create table public.users (
  id         uuid primary key references auth.users(id) on delete cascade,
  username   text unique not null,
  name       text not null,
  bio        text not null default '',
  avatar     text,                          -- Storage URL later; null = initial tile
  private    boolean not null default true, -- posts fenced to friends (see profile-privacy.sql)
  created_at timestamptz not null default now()
);

-- ── Posts ───────────────────────────────────────────────────────────────────
create table public.posts (
  id         uuid primary key default gen_random_uuid(),
  author     uuid not null references public.users(id) on delete cascade,
  type       text not null check (type in ('note','find','photo','activity','poll')),
  title      text,
  url        text,
  note       text,
  image      text,                          -- Storage URL later (photo/video posts; video clip URL for Frames)
  tint       text,                          -- photo/poster's average colour (#rrggbb) for the colour-up settle
  poster     text,                          -- first-frame still for a video Frame (image posts leave this null)
  location   text,                          -- where it's happening (activities)
  poll       jsonb,                          -- { q, options[] } for poll posts; expires 24h after created_at
  event_date date,                          -- the day an activity happens (sorts + retires past plans)
  event_time text,                          -- optional 'HH:MM' straight from <input type="time">
  -- Who can see this post, authoritatively — the account's `private` flag does
  -- NOT gate reads (it only picks the composer's default). 'circle' means
  -- mutual-friends-only for every account, public ones included.
  audience   text not null default 'circle' check (audience in ('public', 'circle', 'list')),
  tags       text[] not null default '{}',
  created_at timestamptz not null default now()
);

-- ── Post audience allowlist ─────────────────────────────────────────────────
-- Who may see a 'list' post. The author is always implicitly allowed (handled in
-- can_view_post below), so they never need a row here.
create table public.post_audience (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  primary key (post_id, user_id)
);

-- ── Comments ────────────────────────────────────────────────────────────────
create table public.comments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts(id) on delete cascade,
  author     uuid not null references public.users(id) on delete cascade,
  body       text not null,
  created_at timestamptz not null default now()
);

-- ── Likes ───────────────────────────────────────────────────────────────────
-- A quiet, private signal to the author. One row per (post, liker). The catch
-- lives entirely in the SELECT policy below: only the post's author can read the
-- full set (and so see the count / who liked). Everyone else can read only their
-- OWN like row — enough to render their heart's filled state, never a total.
create table public.likes (
  post_id    uuid not null references public.posts(id) on delete cascade,
  user_id    uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

-- ── Headcount ───────────────────────────────────────────────────────────────
-- One row per (activity, person going). Unlike likes, a headcount is the POINT
-- of an activity — everyone who can see the post sees who's in — so reads are
-- open to any signed-in user; you can only add or remove yourself.
create table public.headcount (
  post_id    uuid not null references public.posts(id) on delete cascade,
  user_id    uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

-- ── Poll votes ───────────────────────────────────────────────────────────────
-- One row per (poll, voter); `choice` indexes into posts.poll->'options'. Like
-- headcount, votes are PUBLIC (who voted for what is the point). Single-select:
-- the primary key caps it at one vote per person; changing your mind is an UPDATE.
-- The 24h expiry is enforced in the write policies (see below), not just the UI.
create table public.poll_votes (
  post_id    uuid not null references public.posts(id) on delete cascade,
  user_id    uuid not null references public.users(id) on delete cascade,
  choice     smallint not null,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

-- ── Friends ─────────────────────────────────────────────────────────────────
-- Directed "add" edges: a row (a, b) means a has ADDED b. A single edge is a
-- pending friend request; the friendship is mutual (and only then do the two
-- appear in each other's feeds) once BOTH directions exist. Accepting a request
-- is simply adding back the person who added you.
create table public.friends (
  a uuid not null references public.users(id) on delete cascade,   -- who added
  b uuid not null references public.users(id) on delete cascade,   -- who they added
  primary key (a, b)
);

-- ── Blocks ──────────────────────────────────────────────────────────────────
-- One row per (blocker, blocked). One-directional in intent (I block you) but
-- enforced BOTH ways for content: once either party has blocked the other,
-- neither sees the other's posts at the data layer. This is the App Store 1.2
-- "block abusive users" requirement, made real at the DB and not only in the
-- client — which matters because a client only ever learns about blocks IT made
-- (see the "blocks read own" policy), so the other direction has nowhere else
-- to live. Blocking also severs any friendship (the app does that on block).
create table public.blocks (
  blocker    uuid not null references public.users(id) on delete cascade,
  blocked    uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked),
  check (blocker <> blocked)
);

-- ── Auto-create a profile on signup ──────────────────────────────────────────
-- When Supabase Auth inserts a new auth.users row, mirror it into public.users,
-- reading the username + name we pass as signup metadata (options.data). Runs as
-- SECURITY DEFINER so it can write the profile regardless of RLS.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, username, name)
  values (
    new.id,
    lower(new.raw_user_meta_data->>'username'),
    coalesce(nullif(trim(new.raw_user_meta_data->>'name'), ''), 'Someone')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── Visibility helpers ──────────────────────────────────────────────────────
-- These must exist BEFORE the posts read policy below, which calls into them.
--
-- All SECURITY DEFINER, and that's the load-bearing part: they read friends /
-- post_audience / blocks as the table owner, so the posts policy never re-enters
-- another table's RLS — which is what would otherwise deadlock posts ⇄
-- post_audience. `auth.uid()` still returns the real caller either way (it reads
-- the request JWT, which SECURITY DEFINER does not change).

-- Is there a block in EITHER direction between two people? Definer so it can see
-- the row where the OTHER person blocked ME, which the "blocks read own" policy
-- hides from my own view.
create or replace function public.is_blocked_pair(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.blocks
     where (blocker = p_a and blocked = p_b)
        or (blocker = p_b and blocked = p_a)
  );
$$;
grant execute on function public.is_blocked_pair(uuid, uuid) to anon, authenticated;

-- The one authoritative answer to "may this caller read this post?".
-- Block gate first (a block beats every audience level, 'public' included), then
-- the post's own audience tag decides:
--   public → everyone · author → self · list → allowlist · circle → mutual friend
-- The author's `users.private` flag is deliberately NOT consulted: audience is
-- per-post authoritative, and `private` only drives the composer default and the
-- profile nudge in the UI.
-- For anon (auth.uid() is null) only 'public' passes, which is what lets the
-- signed-out feed render at all.
create or replace function public.can_view_post(p_audience text, p_author uuid, p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not public.is_blocked_pair(auth.uid(), p_author)
     and case
       when p_audience = 'public'   then true
       when p_author   = auth.uid() then true
       when p_audience = 'list' then exists (
         select 1 from public.post_audience
         where post_id = p_id and user_id = auth.uid()
       )
       when p_audience = 'circle' then exists (
         select 1
           from public.friends f1
           join public.friends f2 on f2.a = f1.b and f2.b = f1.a
          where f1.a = auth.uid() and f1.b = p_author
       )
       else false
     end;
$$;
grant execute on function public.can_view_post(text, uuid, uuid) to anon, authenticated;

-- Kept for anything still calling it directly. can_view_post above is what the
-- read policy actually uses; this is the older, looser audience-only check.
create or replace function public.can_see_post(p_audience text, p_author uuid, p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_audience in ('public', 'circle')
      or p_author = auth.uid()
      or exists (
        select 1 from public.post_audience
        where post_id = p_id and user_id = auth.uid()
      );
$$;
grant execute on function public.can_see_post(text, uuid, uuid) to anon, authenticated;

-- ── Row Level Security ────────────────────────────────────────────────────────
-- Small friends app: any signed-in user can READ the whole world; WRITES are
-- restricted to your own rows. (Profile INSERT happens via the trigger above,
-- which bypasses RLS, so no insert policy is needed on users.)
alter table public.users    enable row level security;
alter table public.posts    enable row level security;
alter table public.post_audience enable row level security;
alter table public.comments enable row level security;
alter table public.likes    enable row level security;
alter table public.headcount enable row level security;
alter table public.poll_votes enable row level security;
alter table public.friends  enable row level security;
alter table public.blocks   enable row level security;

create policy "users read all"    on public.users    for select to authenticated using (true);
create policy "users update self" on public.users    for update to authenticated using (id = auth.uid());

-- Posts are read through can_view_post (defined below, after the helpers it
-- needs). NO `to` clause on purpose — it must serve `anon`, which is how the app
-- reads the feed, or the feed goes dark.
create policy "posts read visible" on public.posts
  for select using ( public.can_view_post(audience, author, id) );
create policy "posts insert own"  on public.posts    for insert to authenticated with check (author = auth.uid());
create policy "posts update own"  on public.posts    for update to authenticated using (author = auth.uid());
create policy "posts delete own"  on public.posts    for delete to authenticated using (author = auth.uid());

create policy "comments read all"   on public.comments for select to authenticated using (true);
create policy "comments insert own" on public.comments for insert to authenticated with check (author = auth.uid());
create policy "comments delete own" on public.comments for delete to authenticated using (author = auth.uid());

-- Likes: read your OWN like on any post, plus EVERY like on a post you authored.
-- This is the whole dignity mechanic — a friend's client is never sent the rows
-- it would need to count, so "only the owner sees the count" is enforced in the
-- database, not the UI. You can add/remove only your own like.
create policy "likes read own-or-owner" on public.likes for select to authenticated
  using (
    user_id = auth.uid()
    or exists (select 1 from public.posts p where p.id = post_id and p.author = auth.uid())
  );
create policy "likes insert own" on public.likes for insert to authenticated with check (user_id = auth.uid());
create policy "likes delete own" on public.likes for delete to authenticated using (user_id = auth.uid());

create policy "headcount read all"   on public.headcount for select to authenticated using (true);
create policy "headcount insert own" on public.headcount for insert to authenticated with check (user_id = auth.uid());
create policy "headcount delete own" on public.headcount for delete to authenticated using (user_id = auth.uid());

-- Poll votes: public reads (who voted for what), write only your own row, and
-- only while the poll is open (now < created_at + 24h — enforced here, so a
-- closed poll is closed at the database, not merely greyed out in the UI). You
-- may retract your vote (delete) any time.
create policy "poll_votes read all" on public.poll_votes for select to authenticated using (true);
create policy "poll_votes insert own" on public.poll_votes for insert to authenticated with check (
  user_id = auth.uid()
  and exists (select 1 from public.posts p
              where p.id = post_id and p.type = 'poll' and now() < p.created_at + interval '24 hours')
);
create policy "poll_votes update own" on public.poll_votes for update to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.posts p
                where p.id = post_id and p.type = 'poll' and now() < p.created_at + interval '24 hours')
  );
create policy "poll_votes delete own" on public.poll_votes for delete to authenticated using (user_id = auth.uid());

-- Read every edge (so a client can tell mutual friends from pending requests).
-- You may only create YOUR OWN outgoing edge (a = you); either party can delete
-- an edge — so you can cancel a request you sent, decline one sent to you, or
-- unfriend (which clears both directions).
create policy "friends read all"    on public.friends for select to authenticated using (true);
create policy "friends insert own"  on public.friends for insert to authenticated with check (a = auth.uid());
create policy "friends delete mine" on public.friends for delete to authenticated using (auth.uid() in (a, b));

-- The 'list' allowlist: read a row if it's about you, or you authored the post
-- (so the editor can load an existing audience). Only the author may add/remove.
create policy "post_audience read own-or-author" on public.post_audience
  for select to authenticated using (
    user_id = auth.uid()
    or exists (select 1 from public.posts p where p.id = post_id and p.author = auth.uid())
  );
create policy "post_audience insert by author" on public.post_audience
  for insert to authenticated with check (
    exists (select 1 from public.posts p where p.id = post_id and p.author = auth.uid())
  );
create policy "post_audience delete by author" on public.post_audience
  for delete to authenticated using (
    exists (select 1 from public.posts p where p.id = post_id and p.author = auth.uid())
  );

-- Blocks: you only ever see, create, or remove YOUR OWN rows. Nobody can read
-- who blocked THEM (a block is quiet by design), and nobody can forge one on
-- someone else's behalf. The both-ways enforcement lives in is_blocked_pair.
create policy "blocks read own" on public.blocks
  for select using ( blocker = auth.uid() );
create policy "blocks insert own" on public.blocks
  for insert with check ( blocker = auth.uid() );
create policy "blocks delete own" on public.blocks
  for delete using ( blocker = auth.uid() );

-- ── Username availability (anon-callable) ─────────────────────────────────────
-- Signup runs before you have a session, so it can't read the RLS-protected
-- users table to tell you a handle is taken. This SECURITY DEFINER function
-- answers just that one yes/no question, safely, for anon callers.
create or replace function public.username_available(u text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select not exists (select 1 from public.users where username = lower(u));
$$;
grant execute on function public.username_available(text) to anon, authenticated;
