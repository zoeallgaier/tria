-- Four pins on a profile, not three (Zoe, 2026-11-04: "allow up to 4 pins").
-- The pins are a two column grid now, so four is two even pairs. Only the
-- cap moves; the shape check is otherwise add-pins.sql's. Safe to run twice.

alter table public.users drop constraint if exists users_pinned_shape;
alter table public.users add constraint users_pinned_shape check (
  pinned is null or (
    jsonb_typeof(pinned) = 'array' and jsonb_array_length(pinned) <= 4
  )
);
