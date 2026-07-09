-- Tria — migrate friends from mutual pairs to directed request edges.
-- Run this once in the Supabase dashboard → SQL Editor on an existing DB that
-- was built from schema.sql's original friends table (canonical a < b pairs).
--
-- Before: one unordered row per friendship (a < b), meaning "instantly mutual".
-- After:  directed "add" edges — a row (a, b) means a added b. A lone edge is a
--         pending request; a friendship is mutual only when both edges exist.
--
-- IMPORTANT: this PRESERVES every existing friendship. The new code reads each
-- old single row directionally (as "a added b"), which is why, before running
-- this, established friends suddenly look like one-sided pending requests. Step 2
-- writes the missing reverse edge for every pair, so everyone stays mutual and
-- nobody has to re-add anyone.

-- 1. Drop the old a < b ordering constraint first — the reverse rows we add
--    below would violate it. (Auto-named, so discover and drop whatever's there.)
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

-- 2. Backfill the reverse direction for every existing pair, so old friendships
--    stay mutual under the new two-edge model. (Idempotent — safe to re-run.)
insert into public.friends (a, b)
  select b, a from public.friends
  on conflict do nothing;

-- 3. Tighten INSERT: you may only create your OWN outgoing edge (a = you).
--    (DELETE stays "either party", so cancel / decline / unfriend all work.)
drop policy if exists "friends insert own" on public.friends;
create policy "friends insert own" on public.friends
  for insert to authenticated with check (a = auth.uid());


-- ─────────────────────────────────────────────────────────────────────────────
-- OPTIONAL — belt-and-braces "everyone is friends".
-- Steps 1–3 already keep every real friendship intact. Only run the block below
-- if you'd rather that ALL current users simply be mutual friends with each
-- other (a small, everyone-knows-everyone circle) — e.g. to sweep away any
-- stray one-sided edges left over from testing. It wires a mutual edge between
-- every distinct pair of existing users. Remove the /* */ to run it.
/*
insert into public.friends (a, b)
  select u1.id, u2.id
  from public.users u1
  cross join public.users u2
  where u1.id <> u2.id
  on conflict do nothing;
*/
