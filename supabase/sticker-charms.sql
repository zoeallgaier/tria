-- Tria — sticker charms (2.0)
-- Run once in the Supabase dashboard → SQL Editor, AFTER add-charms.sql.
-- Additive + idempotent, so a re-run is harmless.
--
-- Zoe, 2026-10-25: a charm can be one of your own iOS photo stickers. The app
-- uploads it as a PNG to your own media folder and wears it as 'i:' plus that
-- path, e.g. 'i:<your id>/sticker-1761400000000.png'. add-charms.sql's check
-- allows only the fixed keys, so until this runs, wearing a sticker answers
-- "Couldn't save your charms." and nothing else changes.
--
-- A PATH, never a URL, and only inside the wearer's OWN folder: a free URL
-- would let anyone have every viewer's device fetch from a host of their
-- choosing. The client checks the same (isSticker in js/store.js) and drops
-- anything else as it reads.
--
-- The ghost charm left for this (the bat stays), so its key goes from the
-- list. No one wore it when this was written; the update below takes it off
-- anyone who does, so the new check can't refuse their row.

update public.users set charms = array_remove(charms, 'ghost') where 'ghost' = any(charms);

create or replace function public.charms_valid(c text[], uid uuid) returns boolean
language sql immutable as $$
  select coalesce(bool_and(k = any(array['word', 'mutual', 'joined', 'founder', 'sunny', 'repeat', 'bat'])
                          or k ~ ('^i:' || uid::text || '/sticker-[0-9]+\.png$')), true)
  from unnest(c) k
$$;

alter table public.users drop constraint if exists users_charms_valid;
alter table public.users add constraint users_charms_valid check (
  cardinality(charms) <= 2
  and public.charms_valid(charms, id)
);
