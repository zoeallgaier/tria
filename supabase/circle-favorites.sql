-- Favorite circles ──────────────────────────────────────────────────────────
-- A bookmark on any circle you can open (2026-11-09). It lived per device in
-- localStorage (tria:fav-circles:<me>) for its first day; this makes it follow
-- the reader across devices (Zoe: "make sure favorite circles sync across
-- devices").
--
-- A table, not a column on users: "users read all" would hand everyone's
-- favorites to every signed-in reader, and a favorite is yours alone. So the
-- rows are readable and writable by their owner only. No count of a circle's
-- favorites is ever read (the no-COUNT rule).
--
-- A circle's delete takes its favorites with it (cascade); so does an account's.
-- Not checked here: that you can open the circle. A favorite of an invite-only
-- circle you've left draws nothing (the client leaves it out) and harms no one.

create table if not exists public.community_favorites (
  user_id      uuid not null references public.users(id) on delete cascade,
  community_id uuid not null references public.communities(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (user_id, community_id)
);

alter table public.community_favorites enable row level security;

drop policy if exists "community favorites read self" on public.community_favorites;
create policy "community favorites read self" on public.community_favorites
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "community favorites insert self" on public.community_favorites;
create policy "community favorites insert self" on public.community_favorites
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "community favorites delete self" on public.community_favorites;
create policy "community favorites delete self" on public.community_favorites
  for delete to authenticated using (user_id = auth.uid());

grant select, insert, delete on public.community_favorites to authenticated;
