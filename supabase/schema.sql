-- Tria — Supabase schema (Path B, the real shared backend)
-- Run this once in the Supabase dashboard → SQL Editor.
--
-- ⚠️  This DROPS and recreates the four tables. Only run it while they are
--     empty step-1 scaffolding (no real data yet). Children are dropped first
--     so the foreign keys unwind cleanly.

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
  created_at timestamptz not null default now()
);

-- ── Posts ───────────────────────────────────────────────────────────────────
create table public.posts (
  id         uuid primary key default gen_random_uuid(),
  author     uuid not null references public.users(id) on delete cascade,
  type       text not null check (type in ('post','find','photo')),
  title      text,
  url        text,
  note       text,
  image      text,                          -- Storage URL later (photo posts)
  tags       text[] not null default '{}',
  created_at timestamptz not null default now()
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

-- ── Friends ─────────────────────────────────────────────────────────────────
-- Mutual friendship = one unordered row per pair (canonicalised a < b, so the
-- pair is stored once, not twice). If the row exists, you're friends. Either
-- party can create or remove it — matching the prototype's instant-mutual model.
create table public.friends (
  a uuid not null references public.users(id) on delete cascade,
  b uuid not null references public.users(id) on delete cascade,
  primary key (a, b),
  check (a < b)
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

-- ── Row Level Security ────────────────────────────────────────────────────────
-- Small friends app: any signed-in user can READ the whole world; WRITES are
-- restricted to your own rows. (Profile INSERT happens via the trigger above,
-- which bypasses RLS, so no insert policy is needed on users.)
alter table public.users    enable row level security;
alter table public.posts    enable row level security;
alter table public.comments enable row level security;
alter table public.likes    enable row level security;
alter table public.friends  enable row level security;

create policy "users read all"    on public.users    for select to authenticated using (true);
create policy "users update self" on public.users    for update to authenticated using (id = auth.uid());

create policy "posts read all"    on public.posts    for select to authenticated using (true);
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

create policy "friends read all"   on public.friends for select to authenticated using (true);
create policy "friends insert own" on public.friends for insert to authenticated with check (auth.uid() in (a, b));
create policy "friends delete own" on public.friends for delete to authenticated using (auth.uid() in (a, b));

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
