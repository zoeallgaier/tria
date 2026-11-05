-- Tria — Moments (2.1)
-- Run once in the Supabase dashboard → SQL Editor. Additive + idempotent, so a
-- re-run is harmless. schema.sql already folds this in for fresh installs.
--
-- A Moment is an ordinary post that lasts a day (Zoe, 2026-11-04): a note, a
-- photo, a link or a poll, never an activity, a song or a repost. It is read
-- on the rail over My Circle beside the songs on repeat and in no feed, and
-- it goes to your friends or to people you pick, never to Anyone or a circle.
--
-- It is a FLAG on the row, not a seventh type, because the type is still what
-- the post is (the composer infers it from what's attached) and the flag is
-- only how long it stays.

alter table public.posts add column if not exists moment boolean not null default false;

alter table public.posts drop constraint if exists posts_moment_shape;
alter table public.posts add constraint posts_moment_shape check (
  not moment
  or (type in ('note','find','photo','poll') and audience in ('circle','list'))
);

-- A day after it was said, a Moment is gone for everyone but its author.
-- RESTRICTIVE, so it is ANDed onto "posts read visible" without restating it,
-- and no `to` clause, so it holds for anon too. The author keeps theirs (the
-- app lets go of it at a day all the same), so an archive stays possible.
drop policy if exists "posts moments fade" on public.posts;
create policy "posts moments fade" on public.posts
  as restrictive for select using (
    not moment
    or author = auth.uid()
    or created_at > now() - interval '24 hours'
  );

-- The client probes for the column (Store.momentsReady) and keeps the New
-- sheet's Music row until it answers, so nothing ships in lockstep with this
-- file. To check it ran, read-only: anon GET /rest/v1/posts?select=moment&limit=1
-- answers 42703 "column posts.moment does not exist" before it and rows after.
