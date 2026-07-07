-- Tria — additive migration: an activity's "when"
-- Safe to run on a live database. Lets an activity carry an event date (the
-- day it happens, used for sorting and for retiring past plans) and an
-- optional start time (an 'HH:MM' string straight from <input type="time">).
-- Touches no existing data.

alter table public.posts add column if not exists event_date date;
alter table public.posts add column if not exists event_time text;
