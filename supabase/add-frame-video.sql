-- Photos become Frames: a "photo" post can now hold a still OR a short video.
--
-- The internal `posts.type` value stays 'photo' (no CHECK/RLS churn, no live-data
-- migration) — Frame is a UI relabel. A video Frame is detected client-side by the
-- file extension on `image` (the clip URL). This adds only the first-frame poster
-- still; `tint` already exists and keeps driving the colour-up placeholder, now
-- computed from the poster image instead of the photo itself.
--
-- Additive only. Safe to run once in the Supabase SQL editor. Existing photo posts
-- are unaffected (poster stays null and is simply unused for them).

alter table public.posts add column if not exists poster text;
