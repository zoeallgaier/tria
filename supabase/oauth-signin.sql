-- Tria — Sign in with Apple / Google, and the handle that has to come after.
-- Run once in the dashboard → SQL Editor. Until it runs, the two provider
-- buttons are DEAD, loudly: see the bottom of this file.
--
-- ── The problem an OAuth sign-in creates ────────────────────────────────────
-- Tria's identity is an @handle. `public.users.username` is `unique not null`,
-- and the only thing that has ever filled it is the signup form, which asks for
-- one and passes it as auth metadata for `handle_new_user` to mirror into the
-- profile row.
--
-- Apple and Google hand back an email, sometimes a name, and never a handle.
-- There is nothing to put in that column, and no way to invent one that isn't
-- either ugly ("user_8f31c2") or someone else's. So the person has to pick, and
-- picking takes a screen, and a screen takes TIME — during which the auth.users
-- row already exists and the profile row cannot.
--
-- The first shape tried was a provisional handle minted by the trigger plus a
-- flag saying "this one isn't real yet". Don't: a provisional row is a REAL row
-- to every reader, it has to be excluded from Discover, from search, from the
-- friend list and from `username_available`, and each of those is a place where
-- forgetting the flag shows a half-made stranger to everybody. Worse, the
-- provisional handle is itself taken, so a person who picks it back out of the
-- pool is refused their own name.
--
-- So: no row at all until the handle exists. An auth session with no profile is
-- the app's third state, in between signed out and signed in, and it has its own
-- screen (renderClaimHandle in js/app.js, Store.needsProfile). It is a state the
-- app could always have reached anyway — a trigger that failed halfway, a row
-- deleted by hand — and it was a white screen before this.

-- ── 1. The trigger stops guessing ───────────────────────────────────────────
-- Same function as schema.sql's, with one branch: a signup that carried no
-- username metadata (which is every OAuth sign-in, and nothing else) makes no
-- profile row and does not fail.
--
-- It MUST not fail. A raise in an `after insert` trigger on auth.users doesn't
-- just skip the profile — it rolls the auth.users insert back with it, and
-- GoTrue answers the client "Database error saving new user", a message that
-- names neither the column nor the trigger. That is exactly what a null username
-- against `not null` did before this line existed, and it is the whole reason
-- provider sign-in cannot work on an un-migrated database.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- No handle in the metadata: an Apple or Google sign-in. The app takes it from
  -- here and calls claim_profile below once the person has chosen one.
  if nullif(trim(coalesce(new.raw_user_meta_data->>'username', '')), '') is null then
    return new;
  end if;

  insert into public.users (id, username, name)
  values (
    new.id,
    lower(new.raw_user_meta_data->>'username'),
    coalesce(nullif(trim(new.raw_user_meta_data->>'name'), ''), 'Someone')
  );
  return new;
end;
$$;

-- ── 2. Claiming the handle ──────────────────────────────────────────────────
-- The insert `users` has no policy for, done as the caller and for the caller
-- only: there is no id argument, so there is no id to tamper with, the same
-- shape as delete_account().
--
-- Every rule the signup form states is re-stated here, because the form is a
-- courtesy and this is the fence. The shape check matches the client's
-- /^[a-z0-9_]{2,20}$/ exactly; keep them in step or one of them is a lie.
--
-- The messages are written to be READ: the client shows `error.message` on the
-- claim screen unchanged when it recognises the code, so a taken handle says so
-- in words a person can act on rather than in a Postgres constraint name.
create or replace function public.claim_profile(p_username text, p_name text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  uid  uuid := auth.uid();
  u    text := lower(trim(coalesce(p_username, '')));
  n    text := trim(coalesce(p_name, ''));
  have text;
begin
  if uid is null then
    raise exception 'You need to be signed in.' using errcode = '28000';
  end if;

  -- Already claimed. A double-submit and a second tab both land here, and
  -- neither is an error worth a red line: hand back the handle that exists and
  -- let the client hydrate into it. Renaming through this function is NOT
  -- offered — that is "users update self" and the profile editor's job.
  select username into have from public.users where id = uid;
  if have is not null then
    return have;
  end if;

  if u !~ '^[a-z0-9_]{2,20}$' then
    raise exception 'Username: 2–20 letters, numbers or _.' using errcode = '22023';
  end if;

  if exists (select 1 from public.users where username = u) then
    raise exception 'That username is taken.' using errcode = '23505';
  end if;

  insert into public.users (id, username, name)
  values (uid, u, coalesce(nullif(n, ''), 'Someone'));

  return u;
exception
  -- The unique index is the real gate; the `exists` above is only the fast,
  -- friendly one. Two people claiming the same handle in the same second get
  -- past it, and the loser should read the same sentence as everyone else.
  when unique_violation then
    raise exception 'That username is taken.' using errcode = '23505';
end;
$$;

-- `authenticated` only. An anon caller has no auth.uid() and nothing to claim,
-- and granting it would put a function that writes public.users in reach of a
-- session that has no user behind it.
revoke all on function public.claim_profile(text, text) from public;
grant execute on function public.claim_profile(text, text) to authenticated;

-- ── Before this runs ────────────────────────────────────────────────────────
-- Provider sign-in fails at the FIRST tap, on the very first person to try it,
-- with GoTrue's "Database error saving new user" — the trigger's null username
-- rolling back the auth.users insert. There is no partial state and nothing to
-- clean up afterwards, because the rollback takes the auth row with it.
--
-- There is also nothing to run this ahead of. The buttons only appear in a
-- build that carries them, and the providers themselves have to be switched on
-- in the dashboard besides. See supabase/OAUTH-SETUP.md for that half.
