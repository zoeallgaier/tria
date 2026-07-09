-- Web Push subscriptions. One row per installed device/browser per user — the
-- endpoint IS the push mailbox (unique). RLS lets a person see and manage only
-- their own rows; the push Edge Function reads across users via the service role.
--
-- Run once in the Supabase SQL editor (only the project owner has DB admin).

create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions(user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists "read own subscriptions" on public.push_subscriptions;
create policy "read own subscriptions" on public.push_subscriptions
  for select using (auth.uid() = user_id);

drop policy if exists "insert own subscriptions" on public.push_subscriptions;
create policy "insert own subscriptions" on public.push_subscriptions
  for insert with check (auth.uid() = user_id);

drop policy if exists "update own subscriptions" on public.push_subscriptions;
create policy "update own subscriptions" on public.push_subscriptions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "delete own subscriptions" on public.push_subscriptions;
create policy "delete own subscriptions" on public.push_subscriptions
  for delete using (auth.uid() = user_id);
