-- Fire the push Edge Function on the inserts that should notify someone.
--
-- This is exactly what a Supabase "Database Webhook" does under the hood — an
-- AFTER INSERT trigger that POSTs the new row to the function via pg_net — just
-- written as code so it needs no dashboard hunting. Run once in the SQL editor.
--
-- Sends a webhook-shaped payload ({ type, table, schema, record }) that the push
-- function already understands. Likes are intentionally NOT wired — silent nod.

-- 1. pg_net powers the outbound HTTP call. (Supabase ships it; this turns it on.)
create extension if not exists pg_net;

-- 2. The trigger function: POST the row to the push function. SECURITY DEFINER so
--    it runs as the owner (which can use net.http_post), not the inserting user.
create or replace function public.tria_push_notify()
returns trigger
language plpgsql
security definer
set search_path = public, net, extensions
as $$
begin
  perform net.http_post(
    url     := 'https://autjondbgcjctezbxliv.supabase.co/functions/v1/push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'sb_publishable_HybWJd3J_dDESzb5-OGAbg_9ksocyyQ'
    ),
    body    := jsonb_build_object(
      'type',   tg_op,
      'table',  tg_table_name,
      'schema', tg_table_schema,
      'record', to_jsonb(new)
    )
  );
  return new;
end;
$$;

-- 3. One AFTER INSERT trigger per table we push on.
drop trigger if exists tria_push_comments on public.comments;
create trigger tria_push_comments after insert on public.comments
  for each row execute function public.tria_push_notify();

drop trigger if exists tria_push_posts on public.posts;
create trigger tria_push_posts after insert on public.posts
  for each row execute function public.tria_push_notify();

drop trigger if exists tria_push_headcount on public.headcount;
create trigger tria_push_headcount after insert on public.headcount
  for each row execute function public.tria_push_notify();

drop trigger if exists tria_push_friends on public.friends;
create trigger tria_push_friends after insert on public.friends
  for each row execute function public.tria_push_notify();
