-- Tria — additive migration: friendships must be mutual
-- Safe to run on a live database. Converts `friends` from the old instant-mutual
-- model (one undirected a<b row meant "friends") to directed adds: each row now
-- means "a has added b", and you're friends only when BOTH directions exist.
--
-- Existing rows are kept exactly as they are — each simply becomes the adder's
-- one-way request. Whoever clicked "Add" is the `a` side; the other person never
-- actually added back, so they stop counting as a friend until they do. That's
-- the whole point of this change: no more being friended without adding back.
-- (No rows are duplicated to force old links mutual — that would re-create the
-- non-consensual friendships we're removing.)

-- 1. Drop the old canonical-ordering CHECK (a < b) — adds are directional now,
--    so reverse rows (b, a) must be allowed. Dropped by discovery so it works
--    whatever Postgres auto-named the inline constraint.
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.friends'::regclass and contype = 'c'
  loop
    execute format('alter table public.friends drop constraint %I', c);
  end loop;
end $$;
alter table public.friends add constraint friends_no_self check (a <> b);

-- 2. Record when each add happened (harmless default now() for existing rows).
alter table public.friends add column if not exists created_at timestamptz not null default now();

-- 3. Tighten writes to one-way: you may only create or remove your OWN (a-side)
--    add. You can't add someone on their behalf, nor tear down their half.
drop policy if exists "friends insert own" on public.friends;
drop policy if exists "friends delete own" on public.friends;
create policy "friends insert own" on public.friends for insert to authenticated with check (auth.uid() = a);
create policy "friends delete own" on public.friends for delete to authenticated using (auth.uid() = a);
