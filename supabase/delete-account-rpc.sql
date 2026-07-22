-- Tria — Delete account, without an Edge Function.
-- Run once in the dashboard → SQL Editor.
--
-- Deleting your own account has to reach auth.users, which no signed-in client
-- may touch directly. The first shot at this was an Edge Function running with
-- the service role — but Edge Functions have to be *deployed*, that step never
-- happened, and every "Delete account" tap 404'd into a generic error. So the
-- privilege comes from Postgres instead: one SECURITY DEFINER function that
-- deletes exactly one row, the caller's own, and takes no arguments — there is
-- no id to pass and therefore no id to tamper with.
--
-- Deleting the auth.users row cascades through public.users to every post,
-- comment, like, headcount row, poll vote, friend edge, block, and push
-- subscription (see the `on delete cascade` chain in schema.sql). Storage files
-- (avatars, post photos, videos at media/{uid}/…) sit outside that graph, so
-- the client clears them first under the "media delete own" policy — see
-- deleteAccount() in js/store.js.
create or replace function public.delete_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not signed in.' using errcode = '28000';
  end if;
  delete from auth.users where id = uid;
end;
$$;

-- Signed-in callers only. anon has no auth.uid(), so it could only ever hit the
-- raise above, but there's no reason to hand it the entry point.
revoke all on function public.delete_account() from public, anon;
grant execute on function public.delete_account() to authenticated;
