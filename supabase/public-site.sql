-- 1.7 stage 3 · The public site
--
-- A signed-out visitor on the web can browse Discover, open a public post and
-- open a public profile. Posts already serve anon (can_view_post passes only
-- 'public' when auth.uid() is null). What they could not see was WHO wrote
-- them or what anyone said underneath, because users and comments were
-- `to authenticated` only, so every public post arrived authorless and the app
-- had nothing to draw.
--
-- Nothing here is writable by anon, and nothing a signed-in reader sees changes.
-- Idempotent: safe to run twice.

-- ── Comments ────────────────────────────────────────────────────────────────
-- The comments on any post anon can already read. The subquery runs under the
-- caller's RLS, so for anon it only finds public posts: the fence is the posts
-- policy itself, not a second copy of it.
drop policy if exists "comments read public" on public.comments;
create policy "comments read public" on public.comments
  for select to anon
  using (exists (select 1 from public.posts p where p.id = comments.post_id));

-- ── People ──────────────────────────────────────────────────────────────────
-- A public account, or anyone anon can already see speaking: the author of a
-- post it can read, or of a comment it can read. A private account that never
-- floated anything out stays invisible. Both subqueries are RLS-scoped for
-- anon, as above (comments → posts → can_view_post, which is security definer,
-- so nothing loops back into users).
drop policy if exists "users read public" on public.users;
create policy "users read public" on public.users
  for select to anon
  using (
    private = false
    or exists (select 1 from public.posts p where p.author = users.id)
    or exists (select 1 from public.comments c where c.author = users.id)
  );

-- ── Check (read-only, run as anon over PostgREST) ───────────────────────────
--   GET /rest/v1/users?select=username&limit=3     → rows, not []
--   GET /rest/v1/comments?select=id&limit=3        → rows, not []
