-- Tria — Supabase Storage (Path B, step 4: photos live in Storage, not the DB)
-- Run once in the dashboard → SQL Editor.
--
-- Before this, post images + avatars were base64 data-URIs stuffed into Postgres
-- text columns — fine for a demo, but it bloats every row and every feed load.
-- Now the cropped JPEG goes to a public Storage bucket and the column holds just
-- its URL. (RLS on storage.objects is already on by default in Supabase.)

-- A single public bucket. Files are namespaced per user: {uid}/photo-*.jpg etc.
insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do update set public = true;

-- Anyone may read (the bucket is public; this also permits API reads/listing).
drop policy if exists "media public read" on storage.objects;
create policy "media public read" on storage.objects
  for select using (bucket_id = 'media');

-- Signed-in users may upload only into a folder named after their own uid.
drop policy if exists "media upload own" on storage.objects;
create policy "media upload own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

-- …and delete only their own files.
drop policy if exists "media delete own" on storage.objects;
create policy "media delete own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
