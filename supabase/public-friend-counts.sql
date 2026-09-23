-- 1.7 stage 3 · Friend counts on the public site
--
-- A profile's "N friends" is the one piece of a circle that is public: the same
-- number on your own card and on a stranger's, and the roster behind it opens
-- only for you and for a friend. Signed out it was zero for everybody, because
-- `friends` served `authenticated` only (schema.sql) and a missing SELECT policy
-- answers a clean 200 with no rows. So every public profile on the web said the
-- person had nobody, which is both false and the worst possible first look at an
-- app about having a few people.
--
-- What this hands anon is a table of ID PAIRS, and that is the whole reason it
-- can be this simple. Who those ids ARE is still fenced by the users policy in
-- public-site.sql, which is deliberately NOT widened here: a private account
-- that never floated anything out stays unnamed and unopenable, and the client
-- drops every edge it can't name out of the adjacency map it draws rosters from
-- (readWorld in js/store.js). It counts the mutual pairs on the raw ids first,
-- which is how the number stays honest without the names leaking.
--
-- The exposure this adds, stated plainly: an anon reader can see the shape of
-- the graph in uuids, including that two visible people share an invisible
-- friend. Any signed-in reader already gets that graph WITH the names on it
-- ("friends read all", schema.sql) and an account is free, so the gap this
-- closes is smaller than the gap it leaves open.
--
-- Nothing here is writable by anon. Idempotent: safe to run twice.

drop policy if exists "friends read public" on public.friends;
create policy "friends read public" on public.friends
  for select to anon
  using (true);

-- ── Check (read-only, run as anon over PostgREST) ───────────────────────────
--   GET /rest/v1/friends?select=a,b&limit=3        → rows, not []
-- and the fence this does NOT move, on the same anon key: the id on either side
-- of one of those rows still has to be looked up through the users policy, so a
-- private account that has never posted or commented in public answers nothing.
--   GET /rest/v1/users?select=username&id=eq.<an id only seen in friends> → []
