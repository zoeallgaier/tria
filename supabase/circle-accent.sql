-- Tria — a circle's theme (2.5)
-- Run once in the Supabase dashboard → SQL Editor, AFTER add-circles.sql.
-- Additive + idempotent, so a re-run is harmless.
--
-- Zoe, 2026-11-07: "make sure hosts can customize circles color the same way
-- pfps are". A circle's host picks its theme in the same sheet a profile's
-- Theme opens, and the circle's page wears it as a profile's page wears its
-- owner's: the wash off the top-right corner.
--
-- THE VALUES ARE users.accent's, exactly, so the app reads both through one
-- rule:
--   null       its photo's colour (sampled on each phone), else Tria's ramp
--   'default'  Tria's own ramp, whatever the photo
--   'none'     no colour
--   a key      one of the nine palette colours (ruby, rose, coral, amber,
--              lime, jade, cyan, ocean, lavender). KEYS DON'T MOVE: a label
--              can change in the app, the key stored here never does.
-- The check holds only the SHAPE (a short lowercase word), as users.accent's
-- does, so a palette colour added later needs no migration; an older client
-- meeting a key it doesn't know falls back to the photo.
--
-- An RPC that checks the caller is the host, for the reason every circle
-- write is one (circle-photo-delete.sql): the rule lives here.


alter table public.communities add column if not exists accent text;
alter table public.communities drop constraint if exists communities_accent_shape;
alter table public.communities add constraint communities_accent_shape
  check (accent is null or accent ~ '^[a-z]{2,16}$');

create or replace function public.set_community_accent(p_community uuid, p_accent text)
returns void
language plpgsql security definer set search_path = public
as $$
declare a text := nullif(btrim(coalesce(p_accent, '')), '');
begin
  if not exists (select 1 from public.communities where id = p_community and owner = auth.uid()) then
    raise exception 'Only the circle’s host can do that.' using errcode = '42501';
  end if;
  if a is not null and a !~ '^[a-z]{2,16}$' then
    raise exception 'That theme isn’t one Tria knows.' using errcode = '22023';
  end if;
  update public.communities set accent = a where id = p_community;
end;
$$;
grant execute on function public.set_community_accent(uuid, text) to authenticated;


-- Quick sanity (ok = 1 each).
select 'communities.accent' as check, count(*) as ok
  from information_schema.columns
 where table_schema = 'public' and table_name = 'communities' and column_name = 'accent'
union all
select 'set_community_accent fn', count(*) from pg_proc where proname = 'set_community_accent';

-- To check it ran, read-only from outside: anon
--   GET /rest/v1/communities?select=accent&limit=1
-- answers 42703 "column communities.accent does not exist" before it and rows
-- after, and anon POST /rest/v1/rpc/set_community_accent with
--   {"p_community":"00000000-0000-0000-0000-000000000000","p_accent":null}
-- answers its own 42501 "Only the circle’s host can do that." where it
-- answered PGRST202. The client asks the first question
-- (Store.communityAccentReady) and offers no Theme until it answers.
