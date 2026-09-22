-- ── Invites ─────────────────────────────────────────────────────────────────
-- Run in the Supabase SQL editor. Additive: it creates two tables and some
-- functions, and REPLACES handle_new_user and claim_profile (both from
-- oauth-signin.sql) to add one call each. Nothing here drops or rewrites data.
--
-- SAFE TO RE-RUN, and worth knowing because the grants at the bottom were wrong
-- the first time this was run against the live database (see the long note
-- beside redeem_invite's revoke). Every statement is `if not exists`, `or
-- replace`, or a `drop ... if exists` ahead of its create, so running the whole
-- file again is the correction — there is no separate patch to hunt for and no
-- state where half of it has landed.
--
-- A code is `zoe-4k2` and it lives at triaonline.com/i/zoe-4k2. Redeeming it
-- makes the two people friends outright, which is why ZOE'S RULE IS THE WHOLE
-- DESIGN: the invite link goes through private channels only, Messages and a QR
-- held up in person. Public surfaces get the PROFILE link, where adding someone
-- is still a request. Nothing in this file can enforce that — an unlimited link
-- that makes instant friends is exactly as dangerous as wherever it gets
-- pasted — so the enforcement is that the app never offers the invite link on a
-- public surface, and the guardrails below are what is left for when it leaks
-- anyway.
--
-- ── WHY REDEMPTION IS NOT JUST A LINE IN handle_new_user ────────────────────
-- The obvious build is "read the invite out of the signup metadata when the
-- profile row is made". That trigger is AFTER INSERT ON auth.users, and with
-- Confirm email ON it fires while the row is still UNCONFIRMED. So the obvious
-- build hands a stranger a real friendship with a real person by typing an
-- address they do not own, and never confirming it. The friendship is made
-- before the email is proven.
--
-- So redemption is gated on confirmation, and because confirmation happens in a
-- different place for each way in, there are THREE doors into one function:
--
--   email + Confirm on   → trigger 2, on email_confirmed_at going non-null
--   email + Confirm off  → handle_new_user, which sees it already confirmed
--   Apple / Google       → claim_profile, because a provider sign-in makes NO
--                          profile row (see oauth-signin.sql) and there is
--                          nobody to befriend until the handle is chosen
--
-- redeem_invite() is idempotent and no-ops when there is no profile yet, so all
-- three may fire for the same person and only one can win. The primary key on
-- invite_redemptions.joined is what makes that true rather than hoped for.
--
-- ── WHERE THE PENDING INVITE IS KEPT: NOWHERE ───────────────────────────────
-- The first draft parked the code on public.users until confirmation. Don't.
-- `users read public` (public-site.sql) hands ANON the whole row for anybody
-- with a post or a public profile, so a pending_invite column would publish who
-- invited whom to anyone with curl — on a feature whose entire point is that it
-- travels privately. auth.users.raw_user_meta_data already holds it, it is
-- already unreadable from the client, and the confirmation trigger has NEW
-- right there. No column, no side table, nothing to leak.

-- ── 1. The codes ────────────────────────────────────────────────────────────
-- One per person, not one per invite: an invite is a thing you hand out, and
-- handing out twenty is the same act as handing out one. Resetting replaces it,
-- which is the only revocation there is and the reason reset exists.
create table if not exists public.invite_codes (
  owner      uuid primary key references public.users(id) on delete cascade,
  code       text unique not null,
  created_at timestamptz not null default now()
);

alter table public.invite_codes enable row level security;

-- Your own row and nobody else's. Resolving someone ELSE'S code goes through
-- resolve_invite() below, which is SECURITY DEFINER and hands back four public
-- columns — so a code is never a way to enumerate this table.
drop policy if exists "invite_codes read own" on public.invite_codes;
create policy "invite_codes read own" on public.invite_codes
  for select to authenticated using (owner = auth.uid());

-- No insert or update policy on purpose. my_invite() and reset_invite() are the
-- only writers, and they are definer functions: a client that could write here
-- could mint itself a code that reads as somebody else's.

-- ── 2. Who joined through whom ──────────────────────────────────────────────
-- `joined` is the PRIMARY KEY, not just a column: a person is invited once,
-- ever. That is what makes every door above safe to fire twice, and it is also
-- the honest model — you cannot be introduced to Tria a second time.
create table if not exists public.invite_redemptions (
  joined     uuid primary key references public.users(id) on delete cascade,
  inviter    uuid not null references public.users(id) on delete cascade,
  code       text not null,
  -- Where the tap came from, for the `?s=` tag on shared links. Null when
  -- nobody said. Never a foreign key and never required.
  source     text,
  created_at timestamptz not null default now(),
  constraint invite_redemptions_not_self check (joined <> inviter)
);

create index if not exists invite_redemptions_inviter_idx
  on public.invite_redemptions (inviter, created_at desc);

alter table public.invite_redemptions enable row level security;

-- The inviter sees who came in, because that is the Invite page's list. The
-- person who joined sees their own row, because it is a fact about them.
-- NAMES, not a number: the app renders this list and must not count it (see the
-- no-COUNT rule in CLAUDE.md — a tally of people you have recruited is a score,
-- and it would be the one number in Tria that climbs).
drop policy if exists "invite_redemptions read mine" on public.invite_redemptions;
create policy "invite_redemptions read mine" on public.invite_redemptions
  for select to authenticated
  using (inviter = auth.uid() or joined = auth.uid());

-- ── 3. Minting a code ───────────────────────────────────────────────────────
-- The alphabet has no 0/O/1/I/L in it. These get read off a screen, typed by
-- someone else, and said out loud across a table, which is a different job from
-- being unguessable — and the handle is already sitting in front of the code, so
-- the three characters only have to separate one person's codes over time.
create or replace function public.mint_invite_code(p_owner uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  alphabet constant text := '23456789abcdefghjkmnpqrstuvwxyz';
  handle   text;
  prefix   text;
  candidate text;
  i        int;
begin
  select username into handle from public.users where id = p_owner;
  if handle is null then
    raise exception 'That account has no profile yet.' using errcode = 'P0002';
  end if;

  -- Letters and digits only, six at most. `_` is legal in a handle and reads
  -- as a gap when the code is spoken, so it comes out.
  prefix := left(regexp_replace(lower(handle), '[^a-z0-9]', '', 'g'), 6);
  if prefix = '' then prefix := 'tria'; end if;

  -- Two handles CAN share a prefix (zoealla and zoeallb both truncate to
  -- zoeall), so the unique index is the real gate and this retries into it.
  for i in 1..40 loop
    candidate := prefix || '-' ||
      substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1) ||
      substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1) ||
      substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    if not exists (select 1 from public.invite_codes where code = candidate) then
      return candidate;
    end if;
  end loop;

  raise exception 'Could not mint an invite code.' using errcode = 'P0003';
end;
$$;

revoke all on function public.mint_invite_code(uuid) from public, anon, authenticated;

-- Your code, made on first ask. The app calls this to render the Invite page,
-- so it must be safe to call on every visit.
create or replace function public.my_invite()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  uid  uuid := auth.uid();
  have text;
begin
  if uid is null then
    raise exception 'You need to be signed in.' using errcode = '28000';
  end if;

  select code into have from public.invite_codes where owner = uid;
  if have is not null then return have; end if;

  insert into public.invite_codes (owner, code)
  values (uid, public.mint_invite_code(uid))
  on conflict (owner) do nothing;

  select code into have from public.invite_codes where owner = uid;
  return have;
end;
$$;

revoke all on function public.my_invite() from public, anon, authenticated;
grant execute on function public.my_invite() to authenticated;

-- Reset is the only revocation. The old code stops resolving the moment this
-- returns, and every redemption made under it stays exactly where it is —
-- friendships are not undone by changing the doorbell.
create or replace function public.reset_invite()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  uid  uuid := auth.uid();
  v_code text;
begin
  if uid is null then
    raise exception 'You need to be signed in.' using errcode = '28000';
  end if;

  v_code := public.mint_invite_code(uid);
  insert into public.invite_codes (owner, code) values (uid, v_code)
  on conflict (owner) do update set code = excluded.code, created_at = now();
  return v_code;
end;
$$;

revoke all on function public.reset_invite() from public, anon, authenticated;
grant execute on function public.reset_invite() to authenticated;

-- ── 4. Reading a code, from the landing page ────────────────────────────────
-- ANON CALLS THIS. It is the warm "Zoe invited you" page at /i/zoe-4k2, which
-- by definition is read by someone who has no account yet.
--
-- It returns FOUR COLUMNS and they are chosen, not convenient: the same four a
-- public profile already shows. No id, because the landing page has no use for
-- one and a uuid is the thing you would need to start guessing at other tables.
-- No bio, no pronouns, no private flag. An unknown code returns NO ROWS and
-- says nothing about why, so this cannot be used to sweep for live codes with
-- any more signal than "that one wasn't".
create or replace function public.resolve_invite(p_code text)
returns table (username text, name text, avatar text, accent text)
language sql
stable
security definer
set search_path = public
as $$
  select u.username, u.name, u.avatar, u.accent
  from public.invite_codes c
  join public.users u on u.id = c.owner
  where c.code = lower(trim(coalesce(p_code, '')))
  limit 1;
$$;

revoke all on function public.resolve_invite(text) from public, anon, authenticated;
grant execute on function public.resolve_invite(text) to anon, authenticated;

-- ── 5. Redeeming ────────────────────────────────────────────────────────────
-- The one place a friendship is made. Never called from a client: no grant, and
-- the three doors below are all triggers or definer functions.
--
-- ── THE TWO GUARDRAILS ──────────────────────────────────────────────────────
-- A BLOCK, either direction, does nothing at all — no friendship, no request,
-- and NO REDEMPTION ROW. Silence is the point: a block that answers differently
-- from a dead code tells the blocked person they were blocked, and hands them a
-- way to check it whenever they like.
--
-- A PRIOR DECLINE, either direction, downgrades to a REQUEST: one edge instead
-- of two. Which edge is deliberate. It is (joined → inviter), the newcomer
-- adding the inviter, because that is the act that actually happened — they
-- followed a link the inviter gave them. The reverse edge would put the inviter
-- in front of someone who already said no to them, which is the one thing a
-- decline is for. If the inviter is the one who declined, the push function
-- already swallows the notification (see friend_declines in functions/push),
-- so the request lands silently and waits. Nobody is told no twice.
create or replace function public.redeem_invite(p_user uuid, p_code text, p_source text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
-- Every local is v_-prefixed, and that is not a style tic. plpgsql resolves an
-- unqualified name against BOTH the variables and the query's columns and
-- raises on a tie, so a variable called `blocked` beside public.blocks.blocked,
-- or `code` beside invite_codes.code, is a function that parses fine, deploys
-- fine, and throws the first time somebody redeems an invite.
declare
  v_code     text := lower(trim(coalesce(p_code, '')));
  v_owner    uuid;
  v_blocked  boolean;
  v_declined boolean;
begin
  if v_code = '' then return; end if;

  -- No profile row yet: a provider sign-in before claim_profile. Not an error,
  -- just not yet — claim_profile calls this again once there is somebody here.
  if not exists (select 1 from public.users where id = p_user) then return; end if;

  -- Already invited, by anyone, ever. This is what makes three doors safe.
  if exists (select 1 from public.invite_redemptions where joined = p_user) then return; end if;

  select c.owner into v_owner from public.invite_codes c where c.code = v_code;
  if v_owner is null or v_owner = p_user then return; end if;

  select exists (
    select 1 from public.blocks b
    where (b.blocker = v_owner and b.blocked = p_user)
       or (b.blocker = p_user and b.blocked = v_owner)
  ) into v_blocked;
  if v_blocked then return; end if;

  select exists (
    select 1 from public.friend_declines d
    where (d.decliner = v_owner and d.declined = p_user)
       or (d.decliner = p_user and d.declined = v_owner)
  ) into v_declined;

  insert into public.invite_redemptions (joined, inviter, code, source)
  values (p_user, v_owner, v_code, nullif(trim(coalesce(p_source, '')), ''))
  on conflict (joined) do nothing;

  if v_declined then
    -- A request, not a friendship.
    insert into public.friends (a, b) values (p_user, v_owner)
    on conflict (a, b) do nothing;
  else
    -- BOTH EDGES IN ONE STATEMENT, and that is load-bearing for the PUSH, not
    -- just for tidiness. public.friends already carries an AFTER INSERT push
    -- trigger (push-webhooks.sql) whose function returns early when the reverse
    -- edge exists, because that shape means "accepted", not "asked". pg_net
    -- sends after COMMIT, so by the time either webhook is read both rows are
    -- visible and both suppress themselves. Insert them in two statements and
    -- the result is the same, because it is the commit that matters — but write
    -- it as one so the next person can see that it was considered.
    --
    -- What that leaves is silence, which is correct: neither of these people
    -- wants "someone wants to be friends" for a thing they just did on purpose.
    -- The one notification worth sending is the inviter's payoff, and it is
    -- raised from invite_redemptions below so it can say what actually
    -- happened.
    insert into public.friends (a, b)
    values (p_user, v_owner), (v_owner, p_user)
    on conflict (a, b) do nothing;
  end if;
end;
$$;

-- ALL THREE NAMES, AND IT TAKES ALL THREE. This line was wrong twice, in
-- opposite directions, and the live database is what settled it.
--
-- Postgres grants EXECUTE on a new function to PUBLIC by itself, so naming only
-- anon and authenticated revokes a grant they never held and leaves them
-- executing through PUBLIC. That was the first version. Naming only PUBLIC
-- fixes that and is STILL not enough, because Supabase ships
--
--   alter default privileges in schema public
--     grant all on functions to anon, authenticated, service_role;
--
-- which hands every new function an EXPLICIT grant to those roles on top of the
-- PUBLIC one. Revoking PUBLIC leaves the explicit pair untouched.
--
-- Measured, not reasoned: with only PUBLIC revoked, an anon POST to
-- /rest/v1/rpc/redeem_invite answered 204 — it RAN — and mint_invite_code
-- answered 500 with this file's own error string. redeem_invite takes the user
-- id as an argument and `users read public` hands anon those ids, so that was a
-- stranger able to force a friendship onto somebody else's account with a
-- guessed code. Check the grant, do not derive it.
revoke all on function public.redeem_invite(uuid, text, text) from public, anon, authenticated;

-- An EXISTING account typing a code into the app, which is the other way in and
-- the one the guardrails were really written for. Someone who already has Tria
-- has a history: they may have declined this person, or blocked them.
create or replace function public.redeem_invite_code(p_code text, p_source text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'You need to be signed in.' using errcode = '28000';
  end if;

  perform public.redeem_invite(uid, p_code, p_source);

  -- Hand back the handle it resolved to, or null. The client needs it to land
  -- the new reader on the inviter's posts, which is their first screen.
  return (select u.username
          from public.invite_redemptions r
          join public.users u on u.id = r.inviter
          where r.joined = uid);
end;
$$;

revoke all on function public.redeem_invite_code(text, text) from public, anon, authenticated;
grant execute on function public.redeem_invite_code(text, text) to authenticated;

-- ── 6. The three doors ──────────────────────────────────────────────────────

-- Door one and two. This REPLACES the oauth-signin.sql version; the early
-- return for a provider sign-in is unchanged and still the whole reason
-- claim_profile exists.
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

  -- Only if the address is already proven. With Confirm email ON it is not, and
  -- this does nothing — trigger two picks it up. See the note at the top: this
  -- branch is the whole reason the invite is not redeemed here unconditionally.
  --
  -- SWALLOWED, AND THAT IS THE POINT. oauth-signin.sql spells out what a raise
  -- in an after-insert trigger on auth.users costs: it rolls the auth.users
  -- insert back with it and GoTrue answers "Database error saving new user",
  -- naming nothing. This project has already shipped that bug once, from a null
  -- username. An invite is a nicety on top of joining; joining is the thing. A
  -- mistyped code, a deleted inviter, a table this migration has not reached —
  -- none of them may stand between a person and their account, so every
  -- redemption from a trigger runs in its own block and is allowed to fail
  -- quietly. The redemption is simply not made, and nobody is locked out.
  if new.email_confirmed_at is not null then
    begin
      perform public.redeem_invite(
        new.id,
        new.raw_user_meta_data->>'invite',
        new.raw_user_meta_data->>'invite_source'
      );
    exception when others then
      raise warning 'invite redemption failed for %: %', new.id, sqlerrm;
    end;
  end if;

  return new;
end;
$$;

-- Door two proper: the address just got proven.
create or replace function public.handle_user_confirmed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Swallowed for the same reason as above, with one more on top: this one
  -- fires on the UPDATE that confirms an email address. A raise here would roll
  -- the confirmation back, and the person would click the link in their inbox,
  -- see an error, and still be unconfirmed — with a link that has now been used.
  begin
    perform public.redeem_invite(
      new.id,
      new.raw_user_meta_data->>'invite',
      new.raw_user_meta_data->>'invite_source'
    );
  exception when others then
    raise warning 'invite redemption failed for %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists on_auth_user_confirmed on auth.users;
create trigger on_auth_user_confirmed
  after update of email_confirmed_at on auth.users
  for each row
  when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function public.handle_user_confirmed();

-- Door three. REPLACES the oauth-signin.sql version: same function, same
-- errors, same early return for an already-claimed handle, plus the redemption
-- at the end. A provider account is confirmed from the moment it exists, so
-- there is nothing to gate on here — the gate was having a profile at all.
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
  meta jsonb;
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

  -- There is finally somebody to befriend. The invite rode in on the OAuth
  -- sign-in's metadata and has been sitting there unredeemed since.
  --
  -- In its own block, like the two triggers, and here the cost of not doing it
  -- is the worst of the three: a raise would roll back the profile insert above
  -- it, and this function is the ONLY way out of the third state (a session
  -- with nobody behind it). The person would be returned to "pick a username"
  -- with the handle they just picked now taken by their own failed attempt.
  select raw_user_meta_data into meta from auth.users where id = uid;
  begin
    perform public.redeem_invite(uid, meta->>'invite', meta->>'invite_source');
  exception when others then
    raise warning 'invite redemption failed for %: %', uid, sqlerrm;
  end;

  return u;
exception
  -- The unique index is the real gate; the `exists` above is only the fast,
  -- friendly one. Two people claiming the same handle in the same second get
  -- past it, and the loser should read the same sentence as everyone else.
  when unique_violation then
    raise exception 'That username is taken.' using errcode = '23505';
end;
$$;

-- ── 7. The payoff ───────────────────────────────────────────────────────────
-- The inviter's notification, raised from invite_redemptions rather than from
-- friends, because only this table knows the difference between "somebody added
-- you" and "somebody you invited is here". The friends inserts deliberately
-- push nothing (see redeem_invite).
--
-- SAFE TO CREATE BEFORE THE FUNCTION KNOWS ABOUT IT. tria_push_notify posts the
-- row and the Edge Function falls through every `if (table === ...)` it does not
-- recognise and returns, so until `swift-processor` is redeployed with an
-- invite_redemptions branch this trigger costs one ignored HTTP call and the
-- friendship still happens. It just lands quietly.
drop trigger if exists tria_push_invite_redemptions on public.invite_redemptions;
create trigger tria_push_invite_redemptions after insert on public.invite_redemptions
  for each row execute function public.tria_push_notify();

-- ── 8. Reporting ────────────────────────────────────────────────────────────
-- In `metrics`, never in `public`, for the reason daily-analytics.sql gives at
-- length: a view in public is exposed by PostgREST and runs as its owner, which
-- would put "who invited whom" one anon request away from anybody.
create schema if not exists metrics;
revoke all on schema metrics from anon, authenticated;
grant usage on schema metrics to postgres;

create or replace view metrics.invites as
select
  i.username           as inviter,
  j.username           as joined,
  r.code,
  coalesce(r.source, 'link') as source,
  r.created_at
from public.invite_redemptions r
join public.users i on i.id = r.inviter
join public.users j on j.id = r.joined
order by r.created_at desc;

revoke all on all tables in schema metrics from anon, authenticated;

-- ── Check ───────────────────────────────────────────────────────────────────
-- Run these after the script. The first two are the ones that matter.
--
--   -- an unknown code says nothing, and says it as anon:
--   select * from public.resolve_invite('nope-xyz');       → 0 rows
--
--   -- the invite path is not reachable from a client:
--   select public.redeem_invite('00000000-0000-0000-0000-000000000000','x');
--                                                          → permission denied
--
--   -- and from the app, signed in:
--   select public.my_invite();                             → e.g. zoe-4k2
--   select * from public.resolve_invite(public.my_invite());→ your own row
--   select * from metrics.invites;                         → [] until someone joins
--
-- AND THE GRANTS, WHICH ARE THE ONLY CHECK HERE THAT FOUND A BUG. Everything
-- else above confirms something works; this one confirms something CANNOT be
-- reached, which is the kind that fails quietly. Run it as anon (the
-- publishable key) and read the status code, not the body:
--
--   POST /rest/v1/rpc/redeem_invite   {"p_user":"<any uuid>","p_code":"x"}
--   POST /rest/v1/rpc/mint_invite_code {"p_owner":"<any uuid>"}
--        → both must be 404 PGRST202. A 204 or a 500 means they RAN.
--
--   POST /rest/v1/rpc/resolve_invite  {"p_code":"nope-xyz"}   → 200 []
--   POST /rest/v1/rpc/my_invite       {}                      → 404 PGRST202
--
-- PGRST202 is the right answer for a function anon may not execute: PostgREST
-- leaves it out of the schema cache entirely, so "you may not" and "there is no
-- such thing" are the same sentence. That is also why a bogus control name is
-- worth sending alongside — it proves PGRST202 is what missing looks like here
-- and not what a stale cache looks like.
--
-- PostgREST will not see the new functions until its schema cache reloads. It
-- does that on its own within a minute; `notify pgrst, 'reload schema';` is the
-- impatient version.
notify pgrst, 'reload schema';
