-- c/tria: Tria's own circle, held by @zoe. Run once in the SQL editor.
--
-- 'tria' is one of the handles kept back (add-circles.sql), refused twice: by
-- create_community and by the communities_slug_kept check on the table. The
-- RPC keeps refusing it, so nobody can claim the word from the app; only the
-- table's check lets it go, and this script is the one thing that uses that.
--
-- No circle chat is made: a circle is just a feed (drop-circle-chats.sql), and
-- the join trigger seats nobody when there is no chat to seat them in.
-- Safe to run twice.

alter table public.communities drop constraint if exists communities_slug_kept;
alter table public.communities add constraint communities_slug_kept check (slug not in
  ('new', 'edit', 'admin', 'help', 'about', 'settings', 'support', 'official'));

insert into public.communities (slug, name, about, owner)
select 'tria', 'Tria', 'News from the people making Tria, and the place to tell us what you think.', u.id
  from public.users u
 where u.username = 'zoe'
on conflict (slug) do nothing;

insert into public.community_members (community_id, user_id)
select c.id, c.owner from public.communities c
 where c.slug = 'tria' and c.owner is not null
on conflict (community_id, user_id) do nothing;

-- Check: one row, owner is @zoe, members = 1.
select c.slug, c.name, u.username as host,
       (select count(*) from public.community_members m where m.community_id = c.id) as members
  from public.communities c left join public.users u on u.id = c.owner
 where c.slug = 'tria';
