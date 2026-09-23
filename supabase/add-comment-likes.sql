-- Tria — additive migration: likes on comments
-- Safe to run on a live database, and safe to run twice. Adds ONLY the
-- `comment_likes` table + its policies; touches no existing data. (The same
-- table also lives in schema.sql now, for a clean-slate setup — but do NOT
-- re-run schema.sql, it drops your real rows.)
--
-- A comment like is a post like, one level down, and it keeps every rule a post
-- like has. It is a quiet, private nod to the person who WROTE THE COMMENT: they
-- can read every like on their own comments (the count, and who, in Updates);
-- everybody else can read only their own row, which is enough to fill their own
-- heart and never enough to count. Not the post's author — a reply belongs to
-- whoever wrote it, and so does what people thought of it.
--
-- Not wired to push, for the reason post likes aren't (see the note at the top
-- of supabase/functions/push/index.ts): a like stays a silent nod. It lands in
-- the Updates ledger and nowhere louder.
--
-- Deleting the comment takes its likes with it (the cascade), and so does
-- deleting the post under it (posts → comments → comment_likes), and so does
-- deleting an account (users → comment_likes, and users → comments).
--
-- CHECK IT RAN: `GET /rest/v1/comment_likes?select=comment_id&limit=1` answers
-- PGRST205 "Could not find the table" before this, and `[]` after it.

create table if not exists public.comment_likes (
  comment_id uuid not null references public.comments(id) on delete cascade,
  user_id    uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

alter table public.comment_likes enable row level security;

-- Read your OWN like on any comment, plus EVERY like on a comment you wrote. The
-- subquery reads comments under the caller's own RLS, which is "comments read
-- all" for a signed-in account, so it can always see the comment it asks about.
drop policy if exists "comment likes read own-or-author" on public.comment_likes;
create policy "comment likes read own-or-author" on public.comment_likes
  for select to authenticated using (
    user_id = auth.uid()
    or exists (select 1 from public.comments c
               where c.id = comment_id and c.author = auth.uid())
  );

-- Only your own like, and never on your own comment. Post likes leave the
-- no-self rule to the app; this one states it here too, because it costs one
-- line and the app is a courtesy where this is the fence.
drop policy if exists "comment likes insert own" on public.comment_likes;
create policy "comment likes insert own" on public.comment_likes
  for insert to authenticated with check (
    user_id = auth.uid()
    and exists (select 1 from public.comments c
                where c.id = comment_id and c.author <> auth.uid())
  );

drop policy if exists "comment likes delete own" on public.comment_likes;
create policy "comment likes delete own" on public.comment_likes
  for delete to authenticated using (user_id = auth.uid());
