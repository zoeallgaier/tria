-- Ten photos in a carousel, not six (Zoe, 2026-11-11: "Allow up to 10
-- carousel slides"). Only the cap moves; the shape is otherwise
-- add-carousels.sql's. Run in the Supabase dashboard → SQL Editor. Safe to
-- run twice. schema.sql folds it in for fresh installs.
--
-- `carousel_max()` is how the app knows this ran: Store.probeCarouselMax asks
-- it once a session, and until it answers (PGRST202 before this file) the
-- composer keeps to six, so a seventh photo is never refused at Share.

alter table public.posts drop constraint if exists posts_images_shape;
alter table public.posts add constraint posts_images_shape check (
  images is null
  or (type = 'photo' and image is not null
      and cardinality(images) between 2 and 10
      and images[1] = image)
) not valid;

create or replace function public.carousel_max()
returns int language sql immutable as $$ select 10 $$;

grant execute on function public.carousel_max() to anon, authenticated;

-- VERIFY: one row, 10.
select public.carousel_max();
