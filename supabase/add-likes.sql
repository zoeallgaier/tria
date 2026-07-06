-- Tria — additive migration: private likes
-- Safe to run on a live database. Adds ONLY the `likes` table + its policies;
-- touches no existing data. (The same table also lives in schema.sql now, for a
-- clean-slate setup — but do NOT re-run schema.sql, it drops your real rows.)

create table if not exists public.likes (
  post_id    uuid not null references public.posts(id) on delete cascade,
  user_id    uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

alter table public.likes enable row level security;

-- Read your OWN like on any post, plus EVERY like on a post you authored. A
-- friend's client is never sent the rows it would need to count, so "only the
-- owner sees the count" is enforced here, in the database — not in the UI.
create policy "likes read own-or-owner" on public.likes for select to authenticated
  using (
    user_id = auth.uid()
    or exists (select 1 from public.posts p where p.id = post_id and p.author = auth.uid())
  );
create policy "likes insert own" on public.likes for insert to authenticated with check (user_id = auth.uid());
create policy "likes delete own" on public.likes for delete to authenticated using (user_id = auth.uid());
