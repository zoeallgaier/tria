-- Tria — additive migration: reactions on a post's like
-- Safe to run on a live database, and safe to run twice. Adds ONE column to
-- `likes` and ONE policy; every existing like keeps working and reads as a heart.
-- (The same column lives in schema.sql now, for a clean-slate setup — but do NOT
-- re-run schema.sql, it drops your real rows.)
--
-- A tap on the heart is still a like. HOLDING it fans out four more marks, in
-- iMessage's order: heart, thumbs up, thumbs down, ha ha, whoa. A reaction is
-- not a second kind of row. It is the same private nod to the author, one row
-- per (post, person), and the column only says WHICH nod it was. So every rule a
-- like has, a reaction has: the author reads all of them, everybody else reads
-- only their own, nothing is counted in public, nothing is pushed.
--
-- The keys are short and stable because they are data, not copy. What the app
-- draws for each one lives in app.js (REACTIONS), and the names are only ever
-- read aloud by VoiceOver.
--
-- The UPDATE policy is the new fence. Changing your mind from a heart to a thumbs
-- up rewrites your own row in place rather than deleting and inserting, so the
-- like keeps its created_at and the author's Updates ledger does not see a second
-- arrival for the same person.
--
-- CHECK IT RAN: `GET /rest/v1/likes?select=reaction&limit=1` answers 42703
-- "column likes.reaction does not exist" before this, and `[]` after it (anon
-- reads no like rows, which is the point; what matters is that the column exists).
-- Until it runs the app draws the heart exactly as before and holding it does
-- nothing (Store.reactionsReady).

alter table public.likes
  add column if not exists reaction text not null default 'heart';

alter table public.likes drop constraint if exists likes_reaction_check;
alter table public.likes add constraint likes_reaction_check
  check (reaction in ('heart', 'up', 'down', 'ha', 'wow'));

-- Only your own row, and it stays yours: the check stops an update from handing
-- the row to somebody else.
drop policy if exists "likes update own" on public.likes;
create policy "likes update own" on public.likes
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
