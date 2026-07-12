-- Retire the two-layer blur-up; adopt the one-layer colour-up settle.
--
-- The blur-up stored a ~1KB inline JPEG thumbnail and painted it as a second,
-- filtered layer behind the photo. That extra layer is what dragged Safari into
-- its compositing-and-rounded-corners bug (a filtered/composited sibling won't
-- clip to a border-radius cleanly). We drop it entirely.
--
-- In its place: `tint`, the photo's average colour as one #rrggbb string (~7
-- bytes), computed in the browser at post time. The feed paints the reserved box
-- in the photo's own colour and the full image fades in over it — a single layer
-- (just the img's background-color), so the corner clip is trivial again.
--
-- Additive + destructive-of-one-unused-column, no RLS change (posts are read-all;
-- inserts already gate on author = auth.uid(), tint just rides along in the row).
-- Photos posted before this stay null and fall back to the neutral box. Safe to
-- run once in the Supabase SQL editor.

alter table public.posts drop column if exists blur;
alter table public.posts add column if not exists tint text;
