-- Tria — carousels: a Frame that carries more than one photo
-- Run once in the Supabase dashboard → SQL Editor. Additive + idempotent, so a
-- re-run is harmless. schema.sql already folds this in for fresh installs.
--
-- A carousel is still a 'photo' post with `image` set, and `image` is still its
-- FIRST photo: every reader that only knows one picture (the profile's masonry,
-- a pin's face, a quoted tile, the image warmers) keeps working untouched and
-- simply shows the cover. `images` is the whole ordered set, cover included, and
-- is only written when there are two or more; `tints` runs beside it, one average
-- colour per photo, so each card in the deck settles over its own colour.
--
-- Photos only, never a clip: the feed can decode one video at a time, and a deck
-- of them is a deck of decoders. Six at most, which is a handful of moments and
-- not an album.
--
-- Until this runs, a single-photo Frame posts exactly as before: the app only
-- sends `images` when there is a set, and says so plainly if the column is missing.

alter table public.posts add column if not exists images text[];
alter table public.posts add column if not exists tints  text[];

alter table public.posts drop constraint if exists posts_images_shape;
alter table public.posts add constraint posts_images_shape check (
  images is null
  or (type = 'photo' and image is not null
      and cardinality(images) between 2 and 6
      and images[1] = image)
) not valid;

-- A repost carries no payload of its own (see posts_repost_shape in schema.sql),
-- and a photo set is a payload. Re-state the rule with `images` in it.
alter table public.posts drop constraint if exists posts_repost_shape;
alter table public.posts add constraint posts_repost_shape check (
  (type = 'repost'
     and repost_of is not null
     and url is null and image is null and images is null and poster is null
     and poll is null and location is null
     and event_date is null and event_time is null)
  or
  (type <> 'repost' and repost_of is null)
) not valid;

-- VERIFY: two rows back, `images | ARRAY` and `tints | ARRAY`.
select column_name, data_type
  from information_schema.columns
 where table_schema = 'public' and table_name = 'posts' and column_name in ('images', 'tints');
