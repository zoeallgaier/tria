-- Drafts ───────────────────────────────────────────────────────────────────────
-- The composer keeps what you write as you write it (Zoe, 2026-11-11: "I want
-- people to be able to come back to thoughts or not worry about losing one").
-- Every draft lands on the device first (localStorage, tria:drafts:<me>); this
-- table is what makes one follow you to your other devices, as Substack's
-- drafts do. Until it runs, Store.draftsReady is false and drafts stay on the
-- device that wrote them. Run in the Supabase dashboard → SQL Editor. Safe to
-- run twice. schema.sql folds it in for fresh installs.
--
-- A row is the composer's own snapshot (app.js's draftOf), opaque here. The
-- id is made by the client, so a draft written offline keeps its id when it
-- reaches the account. Readable and writable by its owner alone: a draft is
-- unsaid, and nobody else may read it, admins included (no admin function
-- reads this table, and no count of drafts is ever taken).
--
-- An account's delete takes its drafts with it (cascade).

create table if not exists public.drafts (
  id         uuid primary key,
  user_id    uuid not null references public.users(id) on delete cascade,
  body       jsonb not null,
  updated_at timestamptz not null default now(),
  -- A note runs to 15,000 characters; the rest of a draft is small. This
  -- only stops a runaway row.
  constraint drafts_body_size check (octet_length(body::text) <= 200000)
);

create index if not exists drafts_user_idx on public.drafts (user_id);

alter table public.drafts enable row level security;

drop policy if exists "drafts read self" on public.drafts;
create policy "drafts read self" on public.drafts
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "drafts insert self" on public.drafts;
create policy "drafts insert self" on public.drafts
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "drafts update self" on public.drafts;
create policy "drafts update self" on public.drafts
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "drafts delete self" on public.drafts;
create policy "drafts delete self" on public.drafts
  for delete to authenticated using (user_id = auth.uid());

grant select, insert, update, delete on public.drafts to authenticated;

-- VERIFY: as anon, GET /rest/v1/drafts?select=id&limit=1 answers [] (it
-- answered PGRST205 before this file). Signed in, you read your own rows only.
