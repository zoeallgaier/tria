-- Rename the 'post' type to 'note'. Safe to run on a live database.
-- "Post" stays the umbrella word for every entry; "note" is the plain-text
-- type (the one that was confusingly also called 'post').

alter table public.posts drop constraint if exists posts_type_check;
update public.posts set type = 'note' where type = 'post';
alter table public.posts add constraint posts_type_check
  check (type in ('note','find','photo','activity'));
