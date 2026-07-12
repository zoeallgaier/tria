-- Blur-up placeholders for photo posts.
--
-- Adds one column: a tiny inline JPEG thumbnail (a data: URI, ~1KB of text)
-- generated in the browser when a photo is posted. The feed paints it instantly,
-- upscaled soft, so the full-size photo sharpens into focus over its own colours
-- instead of over a flat grey box — buttery on iOS, where the decoded full image
-- often gets evicted from memory mid-session.
--
-- Nullable and additive: photos posted before this stay null and keep the
-- neutral-box behaviour. No storage bucket, no RLS change (posts are read-all;
-- inserts already gate on author = auth.uid(), and blur just rides along in the
-- same row). Safe to run once in the Supabase SQL editor.

alter table public.posts add column if not exists blur text;
