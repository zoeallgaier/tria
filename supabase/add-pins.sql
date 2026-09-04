-- Pinned profile cards ───────────────────────────────────────────────────────
-- Up to three things a person chooses to hold above their own wall: a post they
-- wrote, or a song. Same panel treatment as the Daily card on Discover, on the
-- one page in the app that is about a person rather than about the room.
--
-- AN ORDERED JSONB ARRAY ON `users`, not a `pinned_items` table. The table was
-- the first proposal (docs/1.5.md), on the argument that ordering and the
-- three-slot cap belong in SQL rather than in JS convention. Building the
-- reorder turned that around:
--
--   * ORDER IS THE ARRAY. A table needs a `position` column with
--     unique(user_id, position), and swapping two rows under a unique
--     constraint needs deferred constraints or a three-step shuffle through a
--     temporary value. An array has no such thing as two items in slot 1, and a
--     drag-reorder is ONE write of the whole list rather than three updates
--     that must not half-fail.
--   * THE CAP IS STILL IN SQL, below, and it is stronger than a table's would
--     be: a check on the array's own length can't be raced by two inserts.
--   * IT COSTS NO READ. The world is pulled table by table (readWorld in
--     store.js); a new table is a new round trip on every load, for at most
--     three rows per person. A column on `users` arrives with the person, and
--     the profile that draws it already has them in the cache.
--
-- Shape: an array, in display order, of
--
--   { "k": "post", "id": "<posts.id>" }
--   { "k": "song", "title": …, "artist"?: …, "art"?: …, "apple"?: …, "spotify"?: … }
--
-- A SONG PIN IS THE SAME OBJECT `listening_to` HOLDS, minus `at` — self-reported
-- metadata off the iTunes Search API or a pasted link, with a link per service
-- picked at the reading end (see add-listening-to.sql, which explains the two
-- keys). It carries no `at` because a pin does not expire: a status is a claim
-- about right now and goes stale, a pin is a choice and stands until it's
-- changed. That difference is the whole reason this isn't the same column.
--
-- A POST PIN IS A POINTER, never a copy. No fk: `posts.id` is a uuid in a jsonb
-- value, so a deleted post leaves a dangling id, and the readers drop a pin they
-- can't resolve rather than drawing a hole (pinsFor in app.js). Store.deletePost
-- prunes your own pins on the way past, so the dangle is a fallback and not the
-- normal path. It is deliberately NOT a copy of the post's text: an edited post
-- would otherwise say one thing at the top of the profile and another below it.
--
-- IT WIDENS NOTHING. A pin names a post; it does not carry it. Every reader
-- resolves the id against their own cache, which only ever holds what RLS
-- handed them, so pinning a friends-only post does not show it to a stranger —
-- their copy of the pin simply has nothing to draw and is dropped. Activities
-- are pinnable (Zoe's call) and meet the same friends-only courtesy on the way
-- out that the profile's own wall applies to them.
--
-- No new policy. "users update self" already scopes writes to your own row and
-- "users read all" already hands every column to any signed-in reader — which
-- is right: a pin is the most public thing a person can do with a post, and the
-- gate that matters is on the post, not on the pointer.

alter table public.users add column if not exists pinned jsonb;

-- Three slots, and an array is the only shape allowed in the column. The cap
-- lives here rather than only in the client because it is a rule about the
-- feature and not about one screen: three cards is what fits above a wall
-- without becoming the wall.
do $$
begin
  alter table public.users add constraint users_pinned_shape check (
    pinned is null or (
      jsonb_typeof(pinned) = 'array' and jsonb_array_length(pinned) <= 3
    )
  );
exception
  when duplicate_object then null;   -- already run
end $$;
