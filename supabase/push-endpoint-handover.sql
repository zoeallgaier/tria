-- Tria — hand a device's push address over to whoever is signed in now.
-- Run once in the dashboard → SQL Editor.
--
-- THE BUG THIS FIXES: a phone could not change accounts. `push_subscriptions`
-- is keyed on `endpoint` (the APNs token or the Web Push URL — the device's
-- mailbox, unique across the table), and the client saved with an upsert on
-- that key. But the UPDATE policy in push-subscriptions.sql is
-- `using (auth.uid() = user_id)`, and on an INSERT ... ON CONFLICT DO UPDATE
-- Postgres checks that USING clause against the EXISTING row. So when the row
-- for this device still belonged to the previous account, the update path was
-- rejected outright.
--
-- It failed the way this project's worst bugs always do — quietly. The client
-- logged one warning and said "Couldn't save your notification settings", the
-- old row survived, and the DELETE policy is gated the same way, so the new
-- signed-in user could not clear it either. Net effect on a device that had
-- ever switched accounts: notifications kept arriving for the account that had
-- SIGNED OUT, on a phone now being used by someone else, and the current user
-- could never register no matter how many times they tapped the switch. Only
-- the original owner signing back in could undo it.
--
-- The privilege has to come from somewhere, so it comes from Postgres rather
-- than from loosening the table's policies: one SECURITY DEFINER function that
-- does exactly one thing — drop whatever row holds this endpoint, then insert
-- it against the caller. `user_id` is taken from auth.uid() and is not an
-- argument, so there is no id to pass and therefore no id to tamper with.
--
-- What knowing an endpoint buys an attacker: they could point a device they
-- already know the token of at their OWN user_id, which sends their own
-- notifications to that device and stops the rightful owner receiving theirs.
-- That is a nuisance, not a disclosure — nothing about the previous owner is
-- returned, and endpoints are neither guessable (a 64-hex APNs token) nor
-- readable across users (the SELECT policy is own-rows-only). Handover has to
-- be possible for a shared or resold phone to work at all; this is the smallest
-- door that makes it so.
create or replace function public.claim_push_endpoint(
  p_endpoint text,
  p_p256dh   text default '',
  p_auth     text default ''
)
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
  if p_endpoint is null or length(p_endpoint) = 0 then
    raise exception 'No endpoint.' using errcode = '22023';
  end if;

  -- Unconditional, and that IS the point: the row may belong to the account
  -- that just signed out, which is precisely the case RLS was blocking.
  delete from public.push_subscriptions where endpoint = p_endpoint;

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
  values (uid, p_endpoint, coalesce(p_p256dh, ''), coalesce(p_auth, ''));
end;
$$;

-- Signed-in callers only. anon has no auth.uid() and could only ever reach the
-- raise above, but there's no reason to hand it the entry point.
revoke all on function public.claim_push_endpoint(text, text, text) from public, anon;
grant execute on function public.claim_push_endpoint(text, text, text) to authenticated;

-- The other half of the same problem: signing out must be able to drop this
-- device's row. That one is already the caller's own row, so the plain DELETE
-- policy covers it and no function is needed — see releaseEndpoint() in
-- js/store.js. Left as a note so the asymmetry doesn't read as an oversight.
