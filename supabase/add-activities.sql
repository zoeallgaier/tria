-- Tria — additive migration: activities
-- Safe to run on a live database. Lets posts carry type 'activity' (+ a
-- location), and adds the `headcount` table: friends raising a hand to say
-- "I'm in" on an activity. Touches no existing data.

-- Posts: allow the new type + a where-it's-happening field.
alter table public.posts add column if not exists location text;
alter table public.posts drop constraint if exists posts_type_check;
alter table public.posts add constraint posts_type_check
  check (type in ('post','find','photo','activity'));

-- ── Headcount ────────────────────────────────────────────────────────────────
-- One row per (activity, person going). Unlike likes — which are a private nod
-- only the author can count — a headcount is the POINT of an activity: everyone
-- who can see the post should see who's in. So reads are open to any signed-in
-- user (matching posts/comments), and you can only add or remove yourself.
create table if not exists public.headcount (
  post_id    uuid not null references public.posts(id) on delete cascade,
  user_id    uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

alter table public.headcount enable row level security;

create policy "headcount read all"   on public.headcount for select to authenticated using (true);
create policy "headcount insert own" on public.headcount for insert to authenticated with check (user_id = auth.uid());
create policy "headcount delete own" on public.headcount for delete to authenticated using (user_id = auth.uid());
