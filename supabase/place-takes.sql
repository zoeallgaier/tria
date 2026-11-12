-- A TAKE ON A PLACE (2026-11-12, Zoe: "allow for takes on places and stuff,
-- built into maps"). A fifth kind of Take beside film, show, book and podcast:
-- a café, a park, a bookshop, a city, picked from Apple Maps' own search in
-- the app (TriaPlacesPlugin.swift) and rated with the same half stars.
--
-- No new column. The place rides in `posts.take` like every other subject:
--
--   { kind: 'place', title, by?, cat?, lat, lng, src: 'apple', id?, rating? }
--
--   title  the place's name as Apple Maps has it, copied in at Share.
--   by     where it is, short: "Mission, San Francisco".
--   cat    what it is, a word: "Café", "Park". Optional.
--   lat,   where it is, so a take still draws its map and opens in Maps if
--   lng    Apple ever forgets the id. Required: a place without a point is a
--          name, and a name is a note.
--   id     Apple's Place ID (MKMapItem.identifier, iOS 18), stable and made
--          to be stored. Absent from a phone on iOS 17 or older.
--
-- The rest of add-takes.sql's shape is restated whole.
--
-- `take_kinds()` is how the app knows this ran: Store.probeTakeKinds asks it
-- once a session, and until it answers with 'place' (PGRST202 before this
-- file) the composer's search finds no places, so Share is never refused.
--
-- Run in the Supabase dashboard → SQL Editor. Safe to run twice. schema.sql
-- folds it in for fresh installs.

alter table public.posts drop constraint if exists posts_take_shape;
alter table public.posts add constraint posts_take_shape check (
  (type = 'take' and take is not null
     and jsonb_typeof(take) = 'object'
     and take ? 'title'
     and take->>'kind' in ('film','show','book','podcast','place')
     and (take->>'kind' <> 'place'
          or (jsonb_typeof(take->'lat') = 'number' and jsonb_typeof(take->'lng') = 'number'
              and (take->>'lat')::numeric between -90 and 90
              and (take->>'lng')::numeric between -180 and 180))
     and (not take ? 'rating'
          or (jsonb_typeof(take->'rating') = 'number'
              and (take->>'rating')::numeric in (1,2,3,4,5,6,7,8,9,10))))
  or (type <> 'take' and take is null)
);

create or replace function public.take_kinds()
returns text[] language sql immutable as $$ select array['film','show','book','podcast','place'] $$;

grant execute on function public.take_kinds() to anon, authenticated;

-- VERIFY: one row, the five kinds.
select public.take_kinds();
