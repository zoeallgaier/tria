-- Tria — a Moment can be a song (2026-11-04)
-- Run once in the Supabase dashboard → SQL Editor, after add-moments.sql.
-- Idempotent, so a re-run is harmless. schema.sql already folds this in.
--
-- The composer's Music button is back (Zoe, 2026-11-04), on a Moment too, so
-- a Moment may be a song for a day as well as a note, photo, link or poll. Its
-- row is an ordinary song post (posts_song_shape still holds) with the flag on;
-- On repeat's week leaves it out and it is read on the rail as a Moment.

alter table public.posts drop constraint if exists posts_moment_shape;
alter table public.posts add constraint posts_moment_shape check (
  not moment
  or (type in ('note','find','photo','poll','song') and audience in ('circle','list'))
);

-- Not checkable over REST (a constraint is invisible to anon). Before it, a
-- song Moment is refused with 23514 and the composer says so.
