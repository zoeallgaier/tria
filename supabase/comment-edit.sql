-- Tria — additive migration: edit your own comment
-- Safe to run on a live database, and safe to run twice. Adds ONE function and
-- touches no table, no policy and no row.
--
-- Holding your own comment offers Edit and Delete (2026-10-29, Zoe). Delete
-- already had its policy ("comments delete own"); there has never been an
-- UPDATE policy on comments, so an edit goes through this definer function
-- rather than a new policy. That way the only thing that can change is the
-- WORDS: not the post a comment hangs on, not its author, not its photo, not
-- its date. A comment with a photo may be edited down to no words at all,
-- which comments_not_empty already allows; one without a photo may not.
--
-- Not wired to push: an edit is a correction, not a new comment, so nobody is
-- told twice, and a name added in an edit is not a fresh mention.
--
-- CHECK IT RAN: anon `POST /rest/v1/rpc/edit_comment` with
-- `{"p_comment":"00000000-0000-0000-0000-000000000000","p_body":"x"}` answers
-- PGRST202 before this, and its own 28000 "You need to be signed in." after.
-- Until it runs the app shows Delete alone (Store.commentEditReady).

create or replace function public.edit_comment(p_comment uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me  uuid := auth.uid();
  c   public.comments%rowtype;
  words text := btrim(coalesce(p_body, ''));
begin
  if me is null then
    raise exception 'You need to be signed in.' using errcode = '28000';
  end if;
  select * into c from public.comments where id = p_comment;
  if not found or c.author <> me then
    raise exception 'That comment isn’t yours to edit.' using errcode = '42501';
  end if;
  if length(words) > 300 then
    raise exception 'That’s a little long for a comment.' using errcode = '22001';
  end if;
  if words = '' and c.image is null then
    raise exception 'Say something first.' using errcode = '22023';
  end if;
  update public.comments set body = words where id = p_comment;
end;
$$;

revoke all on function public.edit_comment(uuid, text) from public;
grant execute on function public.edit_comment(uuid, text) to anon, authenticated;
