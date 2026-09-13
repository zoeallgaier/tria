-- Tria — a photo or GIF on a comment
-- Run once in the Supabase dashboard → SQL Editor. Additive + idempotent, so a
-- re-run is harmless. schema.sql already folds this in for fresh installs.
--
-- A comment can carry one picture now: a photo (re-encoded to a JPEG on the
-- device, like a post's) or a GIF (its original bytes, so it still moves). The
-- file lives in the public `media` bucket under the commenter's own folder, the
-- same `{uid}/…` rule storage.sql already enforces, and this column holds its
-- URL — the pixel size is stamped into the filename (…-WxH.jpg) the way a post
-- photo's is, so the thread reserves the picture's space before it loads.
--
-- Until this runs, text comments carry on exactly as before: the app only sends
-- `image` when there is one, so the missing column costs a picture comment and
-- nothing else.

alter table public.comments add column if not exists image text;

-- The words are optional now that a picture can say it, but a comment still has
-- to be SOMETHING. `body` stays not-null (an image-only comment writes '') so
-- nothing that reads it has to learn about null. NOT VALID: this guards every
-- insert from here on without re-checking the rows already in the table.
alter table public.comments drop constraint if exists comments_not_empty;
alter table public.comments add constraint comments_not_empty
  check (btrim(body) <> '' or image is not null) not valid;

-- VERIFY: one row back, `image | text`.
select column_name, data_type
  from information_schema.columns
 where table_schema = 'public' and table_name = 'comments' and column_name = 'image';
