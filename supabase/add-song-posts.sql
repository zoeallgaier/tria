-- Tria — Music posts (a sixth post type, 1.8)
-- Run once in the Supabase dashboard → SQL Editor. Additive + idempotent, so a
-- re-run is harmless. schema.sql already folds this in for fresh installs.
--
-- A music post is a song you share into the feed, with words of your own under
-- it if you want them: it takes a like, a comment, a repost and a place in the
-- feed like anything else you make. It is NOT the listening status
-- (add-listening-to.sql), which stays what it was, a property of the person
-- that expires after a week and never enters the feed. That file says a status
-- must not become a post because it would then want all three of those
-- things; this is the post that wants them, beside the status rather than
-- instead of it.
--
-- The track rides inline on the row as one jsonb, in exactly the shape a
-- listening status already uses, minus `at` (a post doesn't go stale):
--
--   { title, artist?, art?, apple?, spotify?, youtube?, kind? }
--
-- so the picker, `songLink` and `songSub` in app.js read both without knowing
-- which they were handed. See add-listening-to.sql for what each key means.

alter table public.posts add column if not exists song jsonb;

-- Let `song` join the five types and the repost filing. The inline CHECK on
-- posts.type is auto-named posts_type_check; drop and re-add it.
alter table public.posts drop constraint if exists posts_type_check;
alter table public.posts add constraint posts_type_check
  check (type in ('note','find','photo','activity','poll','song','repost'));

-- A song post carries a song, and nothing else carries one. A repost can't
-- either: it carries only the words of a quote (see posts_repost_shape).
alter table public.posts drop constraint if exists posts_song_shape;
alter table public.posts add constraint posts_song_shape check (
  (type = 'song' and song is not null and song ? 'title')
  or (type <> 'song' and song is null)
);

-- The client probes for the column (Store.songsReady) and offers no Music row
-- until it answers, so nothing has to ship in lockstep with this file. To
-- check it ran, read-only: anon GET /rest/v1/posts?select=song&limit=1 answers
-- 42703 "column posts.song does not exist" before it and [] (or rows) after.
