-- A TAKE (2026-11-07, Zoe): a post about a film, a show, a book or a podcast,
-- Letterboxd's way. The words are an ordinary note (title and rich body, both
-- optional), and the thing it is about rides in `posts.take`:
--
--   { kind: 'film'|'show'|'book'|'podcast', title, year?, by?, art?, link?,
--     src?: 'tmdb'|'apple', id?, rating? }
--
-- `rating` is HALF STARS as a whole number, 1 to 10 (7 is three and a half
-- stars), so nothing ever compares a float. Absent is a take with no score,
-- which Letterboxd allows too. The title is copied in when the post is shared,
-- so a take never depends on TMDB or Apple still answering later.
--
-- The type list is restated whole, as add-song-posts.sql did. A Take is not a
-- Moment (posts_moment_shape names its types and leaves this one out), and a
-- repost carries no take (the shape below: a repost is not type 'take').
--
-- Safe to run twice.

alter table public.posts add column if not exists take jsonb;

alter table public.posts drop constraint if exists posts_type_check;
alter table public.posts add constraint posts_type_check
  check (type in ('note','find','photo','activity','poll','song','take','repost'));

alter table public.posts drop constraint if exists posts_take_shape;
alter table public.posts add constraint posts_take_shape check (
  (type = 'take' and take is not null
     and jsonb_typeof(take) = 'object'
     and take ? 'title'
     and take->>'kind' in ('film','show','book','podcast')
     and (not take ? 'rating'
          or (jsonb_typeof(take->'rating') = 'number'
              and (take->>'rating')::numeric in (1,2,3,4,5,6,7,8,9,10))))
  or (type <> 'take' and take is null)
);
