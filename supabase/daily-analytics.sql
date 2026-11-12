-- ── Daily analytics ─────────────────────────────────────────────────────────
-- READ-ONLY. Nothing here touches an app table: it creates a `metrics` schema
-- of views over posts/comments/likes/users, so the questions below are one
-- SELECT each instead of a page of CTEs pasted every time.
--
-- Run it in the Supabase SQL editor (the editor runs as an owner, which is the
-- only way these numbers exist at all: the likes SELECT policy hands a signed-in
-- client its OWN like rows and nothing else, so like counts are unreachable from
-- the app by design and this file is the only place they're readable).
--
-- WHY `metrics` AND NOT `public`: a view in `public` is exposed by PostgREST and
-- runs as its owner, which would put every like count one anon request away.
-- `metrics` is not in Supabase's exposed-schema list, and the grants below are
-- revoked besides. Do not move these into `public`.
--
-- THE JOIN IS THE TAG. An answer is an ordinary post carrying `daily-<slug>`
-- (see DAILY_TAG_RE in app.js) and it belongs to the occurrence it was posted
-- INSIDE — a 24h window, not "the last time that prompt ran". These views
-- reproduce that: an answer is dated to its local day, and matched to the
-- occurrence of its own slug on that day.
--
-- TIMEZONE IS A CHOICE AND IT IS LOAD-BEARING. The app opens and closes a daily
-- at the READER'S local midnight, so there is no single true window; a phone in
-- Auckland and one in Los Angeles are answering different 24-hour spans of the
-- same prompt. `metrics.daily_config.tz` picks one reporting zone and every
-- number below is stated in it. Edit it once, here. Answers that land outside
-- their scheduled day in that zone are not lost — they show up in the last
-- query, which is what that query is for.

create schema if not exists metrics;
revoke all on schema metrics from anon, authenticated;
grant usage on schema metrics to postgres;

-- ── The knobs ───────────────────────────────────────────────────────────────
-- The epoch and the rotation length must match DAILY_EPOCH and DAILIES.length
-- in app.js. If the array grows, `cycle_days` grows with it (keep it a multiple
-- of 7 — see the rotation notes in app.js) and every past occurrence still maps
-- correctly, because the schedule below is generated forward from the epoch and
-- answers are matched by slug, never by day % length.
create or replace view metrics.daily_config as
select
  date '2026-07-28'      as epoch,       -- DAILY_EPOCH
  70                     as cycle_days,  -- DAILIES.length
  'America/New_York'     as tz,          -- the reporting zone. Change this one.
  28                     as active_days; -- trailing window that defines "active"

-- ── The rotation, lifted from DAILIES ───────────────────────────────────────
-- Regenerate this block if the array changes; it is a copy, and a copy that has
-- drifted quietly reports on prompts nobody was shown.
create or replace view metrics.daily_prompts (idx, slug, type, kind, prompt) as
values
  (0, 'meme', 'photo', 'retrieval', 'Post your favorite meme.'),
  (1, 'stuck', 'note', 'report', 'What song is stuck in your head?'),
  (2, 'must-watch', 'find', 'errand', 'Share a video you’ve made someone watch.'),
  (3, 'laughed', 'note', 'report', 'What actually made you laugh this week?'),
  (4, 'ate', 'photo', 'errand', 'Show the best thing you ate this week.'),
  (5, 'small-good', 'note', 'report', 'What’s the smallest good thing that happened this week?'),
  (6, 'last-photo', 'photo', 'retrieval', 'Show the last photo in your camera roll.'),
  (7, 'npc', 'note', 'report', 'What’s the most NPC thing you did today?'),
  (8, 'on-repeat', 'photo', 'retrieval', 'Screenshot what you’ve had on repeat.'),
  (9, 'come-back', 'find', 'errand', 'Share something you keep coming back to.'),
  (10, 'hot-take', 'note', 'report', 'What’s a hot take you’d defend in court?'),
  (11, 'made', 'photo', 'errand', 'Post something you made this week.'),
  (12, 'miss', 'note', 'report', 'What do you miss that you didn’t expect to?'),
  (13, 'desk', 'photo', 'retrieval', 'Show us your desk, no tidying.'),
  (14, 'overthink', 'note', 'report', 'What are you overthinking right now?'),
  (15, 'kept', 'photo', 'retrieval', 'Show us something you’ve kept for years.'),
  (16, 'one-song', 'find', 'errand', 'Share one song the room needs to hear.'),
  (17, 'petty', 'note', 'report', 'What’s the pettiest hill you’re dying on?'),
  (18, 'never-delete', 'photo', 'retrieval', 'Show us a photo you’d never delete.'),
  (19, 'flowers', 'note', 'report', 'Who deserves their flowers today?'),
  (20, 'title', 'note', 'report', 'Give today a title.'),
  (21, 'cursed', 'photo', 'retrieval', 'Post a cursed photo.'),
  (22, 'search', 'note', 'report', 'What’s the last thing you searched that you’d rather not explain?'),
  (23, 'scream', 'find', 'errand', 'Share a perfectly cut scream.'),
  (24, 'overrated', 'note', 'report', 'What’s overrated, and you’re tired of pretending otherwise?'),
  (25, 'outside', 'photo', 'retrieval', 'Show us where you ended up today.'),
  (26, 'took', 'note', 'report', 'What are you taking with you from this week?'),
  (27, 'ninth', 'photo', 'retrieval', 'Show us the ninth photo in your camera roll.'),
  (28, 'replay', 'note', 'report', 'What sentence keeps replaying in your head?'),
  (29, 'group-chat', 'photo', 'retrieval', 'Screenshot one line from a group chat, no context.'),
  (30, 'cry-laugh', 'find', 'errand', 'Share the video that makes you cry laugh every time.'),
  (31, 'wrong-about', 'note', 'report', 'What is everyone wrong about?'),
  (32, 'bought', 'photo', 'retrieval', 'Show us the last thing you bought.'),
  (33, 'unnoticed', 'note', 'report', 'What did you do this week that nobody noticed?'),
  (34, 'window', 'photo', 'retrieval', 'Show us the weather out your window.'),
  (35, 'shower', 'note', 'report', 'What argument did you win in the shower?'),
  (36, 'almost-posted', 'photo', 'retrieval', 'Show us the photo you almost posted and didn’t.'),
  (37, 'rabbit-hole', 'find', 'errand', 'Share the rabbit hole you fell down this week.'),
  (38, 'food-take', 'note', 'report', 'What food opinion gets you in trouble?'),
  (39, 'sign', 'photo', 'retrieval', 'Show us a sign that made you look twice.'),
  (40, 'kind', 'note', 'report', 'What’s the kindest thing someone did for you lately?'),
  (41, 'bag', 'photo', 'retrieval', 'Show us what’s in your bag.'),
  (42, 'excuse', 'note', 'report', 'What’s the best excuse you’ve used this week?'),
  (43, 'reaction', 'photo', 'retrieval', 'Show us the reaction image you use most.'),
  (44, 'last-link', 'find', 'retrieval', 'Share the last link you sent someone.'),
  (45, 'ban', 'note', 'report', 'What would you ban if nobody could argue back?'),
  (46, 'out-of-place', 'photo', 'retrieval', 'Show us something that shouldn’t be there.'),
  (47, 'again', 'note', 'report', 'What would you happily do again tomorrow?'),
  (48, 'screenshot', 'photo', 'retrieval', 'Show us your most recent screenshot.'),
  (49, 'convinced', 'note', 'report', 'What are you weirdly convinced of?'),
  (50, 'walls', 'photo', 'retrieval', 'Show us what’s on your walls.'),
  (51, 'rewatch', 'find', 'errand', 'Share something you watched twice in a row.'),
  (52, 'worst-take', 'note', 'report', 'What’s the worst take you’ve ever had?'),
  (53, 'animal', 'photo', 'retrieval', 'Show us an animal you met.'),
  (54, 'forward', 'note', 'report', 'What are you quietly looking forward to?'),
  (55, 'rate-week', 'note', 'report', 'Rate the week out of ten, no explaining.'),
  (56, 'reflex', 'photo', 'retrieval', 'Show us the app you open without thinking.'),
  (57, 'avoiding', 'note', 'report', 'What are you avoiding right now?'),
  (58, 'keep-meaning', 'find', 'errand', 'Share something you keep meaning to show someone.'),
  (59, 'rule', 'note', 'report', 'What rule do you break on principle?'),
  (60, 'mess', 'photo', 'retrieval', 'Show us the mess you’re not dealing with.'),
  (61, 'said', 'note', 'report', 'What did someone say to you that stuck?'),
  (62, 'old-tab', 'photo', 'retrieval', 'Show us the tab you’ve had open for weeks.'),
  (63, 'nemesis', 'note', 'report', 'Who or what is your nemesis this week?'),
  (64, 'photographed-twice', 'photo', 'retrieval', 'Show us something you’ve photographed more than once.'),
  (65, 'bookmarked', 'find', 'retrieval', 'Share the oldest thing in your bookmarks.'),
  (66, 'stop', 'note', 'report', 'What should everyone stop doing immediately?'),
  (67, 'visiting', 'photo', 'retrieval', 'Show us where you’d take someone visiting.'),
  (68, 'ended-well', 'note', 'report', 'What ended better than you expected?'),
  (69, 'vibe-check', 'note', 'report', 'What’s the vibe today, in five words or fewer?')
;

-- ── The season, lifted from SEASON ──────────────────────────────────────────
-- 1.6's hand-written run of days (SEASON and SEASON_FIRST_DAY in app.js), which
-- the app consults BEFORE the rotation (dailyOn). It started on day 48, Mon
-- 2026-09-14, and runs 109 days to 2026-12-31; on those days the rotation's
-- prompt was never shown. Until 2026-11-11 this file knew only the rotation, so
-- every season day was matched to a prompt nobody saw and the Dailies page read
-- zero (Zoe: "its all 0s rn"). Like the rotation above, this is a COPY: if
-- SEASON changes, regenerate it (the values were written out of app.js by a
-- script, not by hand). `idx` is 1000 + the season index, so it never meets a
-- rotation idx.
create or replace view metrics.daily_season_config as
select 48 as first_day;                                -- SEASON_FIRST_DAY

create or replace view metrics.daily_season (i, slug, type, kind, prompt) as
values
  (0, 'screenshot', 'photo', 'retrieval', 'Show us your most recent screenshot.'),
  (1, 'almost-said', 'note', 'report', 'What did you almost say today?'),
  (2, 'carry', 'photo', 'retrieval', 'Show us the thing you carry everywhere.'),
  (3, 'bookmarked', 'find', 'retrieval', 'Share the oldest thing in your bookmarks.'),
  (4, 'stop', 'note', 'report', 'What should everyone stop doing immediately?'),
  (5, 'gift-kept', 'photo', 'retrieval', 'Show us something someone gave you that you still use.'),
  (6, 'checked-on', 'note', 'report', 'Who checked on you when they didn’t have to?'),
  (7, 'meme-sent', 'photo', 'retrieval', 'Show us the meme you’ve sent the most.'),
  (8, 'summer-over', 'note', 'report', 'Summer’s over. What are you not going to miss?'),
  (9, 'worn-out', 'photo', 'retrieval', 'Show us the thing you’ve worn out.'),
  (10, 'sent-twice', 'find', 'retrieval', 'Share the link you’ve sent to more than one person.'),
  (11, 'rule', 'note', 'report', 'What rule do you break on principle?'),
  (12, 'two-years', 'photo', 'retrieval', 'Show us a photo from exactly two years ago.'),
  (13, 'owed', 'note', 'report', 'Who do you owe a text?'),
  (14, 'favorites', 'photo', 'retrieval', 'Show us something you put in your Favorites.'),
  (15, 'avoiding', 'note', 'report', 'What are you avoiding right now?'),
  (16, 'old-tab', 'photo', 'retrieval', 'Show us the tab you’ve had open for weeks.'),
  (17, 'sent-me', 'find', 'retrieval', 'Share the last thing someone sent you that you actually opened.'),
  (18, 'convinced', 'note', 'report', 'What are you weirdly convinced of?'),
  (19, 'photographed-twice', 'photo', 'retrieval', 'Show us something you’ve photographed more than once.'),
  (20, 'said', 'note', 'report', 'What did someone say to you that stuck?'),
  (21, 'most-photos', 'photo', 'retrieval', 'Show us who or what has the most photos in your camera roll.'),
  (22, 'free-crime', 'note', 'report', 'You get one free crime, no consequences. What is it?'),
  (23, 'note-app', 'photo', 'retrieval', 'Screenshot one line from your notes app.'),
  (24, 'still-thinking', 'find', 'retrieval', 'Share something you watched that you’re still thinking about.'),
  (25, 'worst-take', 'note', 'report', 'What’s the worst take you’ve ever had?'),
  (26, 'handwriting', 'photo', 'retrieval', 'Show us something in someone else’s handwriting.'),
  (27, 'easier', 'note', 'report', 'What got easier this year without you noticing?'),
  (28, 'funniest', 'photo', 'retrieval', 'Show us the funniest thing on your phone.'),
  (29, 'nemesis', 'note', 'report', 'Who or what is your nemesis?'),
  (30, 'reflex', 'photo', 'retrieval', 'Show us the app you open without thinking.'),
  (31, 'recommended', 'find', 'retrieval', 'Share the last thing someone recommended that you actually liked.'),
  (32, 'no-reason', 'note', 'report', 'What’s a rule everyone follows for no reason?'),
  (33, 'oldest-thing', 'photo', 'retrieval', 'Show us the oldest thing you own.'),
  (34, 'forward', 'note', 'report', 'What are you quietly looking forward to?'),
  (35, 'year-ago', 'photo', 'retrieval', 'Show us the photo you took a year ago today.'),
  (36, 'irrational-fear', 'note', 'report', 'What are you irrationally scared of?'),
  (37, 'screenshot-kept', 'photo', 'retrieval', 'Show us a screenshot you’ve kept for months.'),
  (38, 'horror', 'find', 'retrieval', 'Share the scariest thing you’ve ever watched.'),
  (39, 'halloween-take', 'note', 'report', 'What’s the worst Halloween candy, and you’re right?'),
  (40, 'costume-old', 'photo', 'retrieval', 'Show us a photo of you in an old Halloween costume.'),
  (41, 'comfort-watch', 'note', 'report', 'What do you put on when you don’t want to think?'),
  (42, 'group-chat-meme', 'photo', 'retrieval', 'Show us the last meme someone sent you.'),
  (43, 'haunted', 'note', 'report', 'What’s the closest you’ve come to believing in a ghost?'),
  (44, 'decoration-old', 'photo', 'retrieval', 'Show us the Halloween decoration you put up every year.'),
  (45, 'every-october', 'find', 'retrieval', 'Share the thing you watch every October.'),
  (46, 'overrated-scary', 'note', 'report', 'What horror movie is overrated, and you’ll say it?'),
  (47, 'halloween', 'photo', 'retrieval', 'Halloween. Show us yours.'),
  (48, 'extra-hour', 'note', 'report', 'You got an hour back. What did you do with it?'),
  (49, 'last-night', 'photo', 'retrieval', 'Show us the last photo you took last night.'),
  (50, 'boring', 'note', 'report', 'What’s the most boring thing you did today?'),
  (51, 'last-search', 'note', 'report', 'What’s the last thing you searched?'),
  (52, 'sent-group', 'find', 'retrieval', 'Share the last thing you sent the group chat.'),
  (53, 'food-scam', 'note', 'report', 'What food is a scam?'),
  (54, 'cant-explain', 'photo', 'retrieval', 'Show us a photo in your camera roll you can’t explain.'),
  (55, 'ended-well', 'note', 'report', 'What ended better than you expected?'),
  (56, 'screenshot-argument', 'photo', 'retrieval', 'Show us a screenshot you took to prove a point.'),
  (57, 'bees', 'note', 'report', 'Would you rather have 25 bees in your mouth or one bee in your ear forever?'),
  (58, 'warmest', 'photo', 'retrieval', 'Show us the warmest thing you own.'),
  (59, 'dark-at-five', 'find', 'retrieval', 'Share what you put on when it’s dark at five.'),
  (60, 'fight-animals', 'note', 'report', 'You have to fight every animal you’ve seen in person this year. How does it go?'),
  (61, 'worn-most', 'photo', 'retrieval', 'Show us the thing in your closet you actually wear.'),
  (62, 'small-win', 'note', 'report', 'What’s the smallest thing that went right this week?'),
  (63, 'worst-photo', 'photo', 'retrieval', 'Show us the worst photo ever taken of you.'),
  (64, 'dreading', 'note', 'report', 'What are you quietly dreading?'),
  (65, 'family-dish', 'photo', 'retrieval', 'Show us the food only your family makes.'),
  (66, 'saved-recipe', 'find', 'retrieval', 'Share a recipe you actually make.'),
  (67, 'side-dish', 'note', 'report', 'What’s the most overrated Thanksgiving dish?'),
  (68, 'table-old', 'photo', 'retrieval', 'Show us a photo from a holiday table you miss.'),
  (69, 'glad-didnt', 'note', 'report', 'What are you glad you didn’t do?'),
  (70, 'travel-photo', 'photo', 'retrieval', 'Show us the last photo you took away from home.'),
  (71, 'assigned', 'note', 'report', 'What are you in charge of bringing?'),
  (72, 'food-photo', 'photo', 'retrieval', 'Show us the last food photo in your camera roll.'),
  (73, 'thankful', 'note', 'report', 'What are you thankful for?'),
  (74, 'leftover-take', 'note', 'report', 'What’s the correct leftover sandwich, and you’re right?'),
  (75, 'the-table', 'photo', 'retrieval', 'Show us the table.'),
  (76, 'not-the-food', 'note', 'report', 'What was the best part, and it wasn’t the food?'),
  (77, 'of-you', 'photo', 'retrieval', 'Show us a photo someone else took of you.'),
  (78, 'not-this-year', 'note', 'report', 'It’s December. What are you not doing this year?'),
  (79, 'ornament', 'photo', 'retrieval', 'Show us the ornament with a story.'),
  (80, 'wishlist-link', 'find', 'retrieval', 'Share something on your list.'),
  (81, 'too-early', 'note', 'report', 'Is it too early for Christmas music? Defend yourself.'),
  (82, 'candles', 'photo', 'retrieval', 'Show us the light in your house tonight.'),
  (83, 'winter-ritual', 'note', 'report', 'What’s the one thing that makes winter bearable?'),
  (84, 'holiday-meme', 'photo', 'retrieval', 'Show us the meme that is December.'),
  (85, 'list-left', 'note', 'report', 'What’s still on your list?'),
  (86, 'decorations', 'photo', 'retrieval', 'Show us the first decoration that went up.'),
  (87, 'holiday-song', 'find', 'retrieval', 'Share the holiday song you’ll defend.'),
  (88, 'christmas-movie', 'note', 'report', 'What’s the best Christmas movie, and it’s not close?'),
  (89, 'card', 'photo', 'retrieval', 'Show us a card someone sent you.'),
  (90, 'small-win-year', 'note', 'report', 'What’s the smallest thing that went right this year?'),
  (91, 'first-of-year', 'photo', 'retrieval', 'Show us the first photo you took this year.'),
  (92, 'teeth', 'note', 'report', 'Would you rather have fingers for teeth or teeth for fingers?'),
  (93, 'played-most', 'photo', 'retrieval', 'Screenshot your most played song of the year.'),
  (94, 'watched-year', 'find', 'retrieval', 'Share the best thing you watched this year.'),
  (95, 'leave-behind', 'note', 'report', 'What trend do you want left in this year?'),
  (96, 'photo-of-year', 'photo', 'retrieval', 'Show us your photo of the year.'),
  (97, 'carried', 'note', 'report', 'Who got you through this year?'),
  (98, 'last-daylight', 'photo', 'retrieval', 'Show us the last photo you took in daylight.'),
  (99, 'spending-it', 'note', 'report', 'Where are you spending it?'),
  (100, 'the-tree', 'photo', 'retrieval', 'Show us the tree, or whatever you’ve got instead.'),
  (101, 'playing-tonight', 'find', 'retrieval', 'Share what’s playing tonight.'),
  (102, 'christmas', 'photo', 'retrieval', 'Merry Christmas. Show us one photo from today.'),
  (103, 'what-you-got', 'photo', 'retrieval', 'Show us the best thing you got.'),
  (104, 'what-day', 'note', 'report', 'What day is it? What are you doing?'),
  (105, 'ninth-from-end', 'photo', 'retrieval', 'Show us the ninth photo from the end of your camera roll.'),
  (106, 'overrated-year', 'note', 'report', 'What was overrated this year?'),
  (107, 'never-posted', 'photo', 'retrieval', 'Show us the photo from this year you never posted.'),
  (108, 'song-of-year', 'find', 'retrieval', 'Share the song that was your year.')
;

-- ── Every occurrence that has happened ──────────────────────────────────────
-- One row per prompt per day it ran, epoch → today, in the reporting zone: the
-- season's prompt where the season has one, else the rotation's. `run_no` is
-- which time this prompt was SHOWN (the season skips rotation days, so it is
-- counted, not worked out from the cycle), the column that answers "does a
-- prompt thin out the second time?".
create or replace view metrics.daily_occurrences as
select
  o.day_number,
  (row_number() over (partition by o.slug order by o.on_date))::int as run_no,
  o.on_date, o.weekday, o.idx, o.slug, o.type, o.kind, o.prompt, o.opens, o.closes
from (
  select
    g.day_number,
    g.on_date,
    to_char(g.on_date, 'Dy')                              as weekday,
    coalesce(1000 + s.i, p.idx)                           as idx,
    coalesce(s.slug, p.slug)                              as slug,
    coalesce(s.type, p.type)                              as type,
    case when s.slug is not null then s.kind else p.kind end as kind,
    coalesce(s.prompt, p.prompt)                          as prompt,
    (g.on_date::timestamp) at time zone c.tz              as opens,
    ((g.on_date + 1)::timestamp) at time zone c.tz        as closes
  from metrics.daily_config c
  cross join metrics.daily_season_config sc
  cross join lateral (
    select
      s.ts::date                                          as on_date,
      (s.ts::date - c.epoch)                              as day_number
    from generate_series(
           c.epoch::timestamp,
           (now() at time zone c.tz)::date::timestamp,
           interval '1 day') as s(ts)
  ) g
  join metrics.daily_prompts p on p.idx = g.day_number % c.cycle_days
  left join metrics.daily_season s on s.i = g.day_number - sc.first_day
) o;

-- ── Answers ─────────────────────────────────────────────────────────────────
-- A post carrying exactly one `daily-` tag, dated to the local day it was made.
-- Reposts and activities are excluded the way the app excludes them: an
-- activity can never answer a prompt (dailyAccepts) and a repost is not a
-- compose. `occurrence_day` is null when a post's slug did not run on the day
-- it was posted in the reporting zone — see the timezone note up top, and the
-- last query, which counts those.
create or replace view metrics.daily_answer_posts as
select
  p.id, p.author, p.type, p.audience, p.created_at,
  substring(t from 7)                                     as slug,
  ((p.created_at at time zone c.tz)::date)                as local_date,
  o.day_number                                            as occurrence_day,
  o.run_no
from public.posts p
cross join metrics.daily_config c
cross join lateral (
  select t from unnest(p.tags) t where t like 'daily-%' limit 1
) tag(t)
left join metrics.daily_occurrences o
  on o.slug = substring(t from 7)
 and o.on_date = (p.created_at at time zone c.tz)::date
where p.type not in ('repost', 'activity');

-- ── What the room said back ─────────────────────────────────────────────────
-- Per answer. The author's own comment on their own answer is not the room
-- replying, so it is counted apart. Likes are the private signal (see the likes
-- table): a count here is analysis, and must never reach a client.
create or replace view metrics.daily_answer_response as
select
  a.id, a.author, a.slug, a.occurrence_day, a.run_no, a.type, a.audience,
  coalesce(cm.comments, 0)          as comments,
  coalesce(cm.repliers, 0)          as repliers,
  coalesce(cm.self_comments, 0)     as self_comments,
  coalesce(lk.likes, 0)             as likes
from metrics.daily_answer_posts a
left join lateral (
  select count(*) filter (where c.author <> a.author)                as comments,
         count(distinct c.author) filter (where c.author <> a.author) as repliers,
         count(*) filter (where c.author =  a.author)                as self_comments
  from public.comments c where c.post_id = a.id
) cm on true
left join lateral (
  select count(*) filter (where l.user_id <> a.author) as likes
  from public.likes l where l.post_id = a.id
) lk on true;

-- ── Who was even around ─────────────────────────────────────────────────────
-- There is no session table, so "active" is the honest proxy the data supports:
-- posted anything at all (answers, reposts, everything) inside the trailing
-- window ending on that day. `roster` is every account that existed by then —
-- the ceiling, not the denominator, because a dormant account was never going
-- to answer and dividing by it just makes every prompt look bad equally.
create or replace view metrics.daily_population as
select
  o.on_date,
  (select count(*) from public.users u
    where (u.created_at at time zone c.tz)::date <= o.on_date)        as roster,
  (select count(distinct p.author) from public.posts p
    where (p.created_at at time zone c.tz)::date <= o.on_date
      and (p.created_at at time zone c.tz)::date >  o.on_date - c.active_days) as active
from (select distinct on_date from metrics.daily_occurrences) o
cross join metrics.daily_config c;

-- ── One row per run of one prompt ───────────────────────────────────────────
-- The table everything else is a slice of. POST RATE is answerers over active
-- accounts: what share of the people who were using Tria that fortnight
-- answered this question. RESPONSE RATE is the share of answers that got
-- anything back — a comment from someone else, or a like. They are different
-- failures: a low post rate is a question nobody can answer, a low response
-- rate is a question nobody can reply to.
create or replace view metrics.daily_occurrence_stats as
select
  o.day_number, o.run_no, o.on_date, o.weekday,
  o.idx, o.slug, o.type, o.kind, o.prompt,
  pop.roster, pop.active,
  count(r.id)                                             as answers,
  count(distinct r.author)                                as answerers,
  round(count(distinct r.author)::numeric
        / nullif(pop.active, 0), 3)                       as post_rate,
  count(*) filter (where r.comments > 0 or r.likes > 0)   as answers_with_response,
  round(count(*) filter (where r.comments > 0 or r.likes > 0)::numeric
        / nullif(count(r.id), 0), 3)                      as response_rate,
  count(*) filter (where r.comments > 0)                  as answers_with_comment,
  count(*) filter (where r.likes > 0)                     as answers_with_like,
  sum(r.comments)                                         as comments,
  sum(r.likes)                                            as likes,
  round(sum(r.comments)::numeric / nullif(count(r.id), 0), 2) as comments_per_answer,
  round(sum(r.likes)::numeric    / nullif(count(r.id), 0), 2) as likes_per_answer,
  count(*) filter (where r.audience = 'public')           as public_answers,
  count(*) filter (where r.type = 'photo')                as photo_answers,
  count(*) filter (where r.type = 'note')                 as note_answers,
  count(*) filter (where r.type = 'find')                 as find_answers,
  count(*) filter (where r.type = 'poll')                 as poll_answers
from metrics.daily_occurrences o
join metrics.daily_population pop on pop.on_date = o.on_date
left join metrics.daily_answer_response r on r.occurrence_day = o.day_number
group by o.day_number, o.run_no, o.on_date, o.weekday,
         o.idx, o.slug, o.type, o.kind, o.prompt, pop.roster, pop.active;

-- ── One row per prompt, across every run ────────────────────────────────────
create or replace view metrics.daily_prompt_stats as
select
  s.idx, s.slug, s.type, s.kind, s.prompt,
  max(s.weekday)                                  as weekday,
  count(*)                                        as runs,
  sum(s.answers)                                  as answers,
  round(avg(s.answers), 1)                        as answers_avg,
  round(avg(s.post_rate), 3)                      as post_rate_avg,
  round(sum(s.answers_with_response)::numeric
        / nullif(sum(s.answers), 0), 3)           as response_rate,
  round(sum(s.comments)::numeric
        / nullif(sum(s.answers), 0), 2)           as comments_per_answer,
  round(sum(s.likes)::numeric
        / nullif(sum(s.answers), 0), 2)           as likes_per_answer,
  min(s.on_date)                                  as first_run,
  max(s.on_date)                                  as last_run
from metrics.daily_occurrence_stats s
group by s.idx, s.slug, s.type, s.kind, s.prompt;


-- ════════════════════════════════════════════════════════════════════════════
-- THE QUESTIONS. Everything above is scaffolding; run these.
-- ════════════════════════════════════════════════════════════════════════════

-- Q1 · The scoreboard. Every prompt, worst first. This is the cut list: the
--      rows at the top are the ones the 1.6 overhaul should replace, and the
--      `kind` column beside them is usually the reason (see the errand note in
--      app.js — an errand cost roughly half the room across the first 21 days).
select slug, kind, type, weekday, runs, answers, answers_avg,
       post_rate_avg, response_rate, comments_per_answer, likes_per_answer
from metrics.daily_prompt_stats
order by answers_avg asc, response_rate asc;

-- Q2 · Does a prompt survive the loop? One row per prompt per run. A prompt
--      that drops hard from run 1 to run 2 is not re-answerable, which is the
--      thing the rotation is built on and the thing that is hardest to guess at
--      write time. Only prompts with more than one run appear.
select slug, kind, run_no, on_date, answers, post_rate, response_rate
from metrics.daily_occurrence_stats
where slug in (select slug from metrics.daily_prompt_stats where runs > 1)
order by slug, run_no;

-- Q3 · Kind is the pacing unit, so price it. retrieval / report / errand.
select kind,
       count(*)                                        as occurrences,
       round(avg(answers), 1)                          as answers_avg,
       round(avg(post_rate), 3)                        as post_rate_avg,
       round(sum(answers_with_response)::numeric
             / nullif(sum(answers), 0), 3)             as response_rate,
       round(sum(comments)::numeric
             / nullif(sum(answers), 0), 2)             as comments_per_answer
from metrics.daily_occurrence_stats
group by kind order by answers_avg desc;

-- Q4 · Weekday, which is the other axis the rotation pins (Thursday is the
--      link day, Monday is cheap, Sunday is the soft landing). If Monday is not
--      actually the low day, the Monday rule is folklore and can be spent.
select weekday,
       round(avg(answers), 1)      as answers_avg,
       round(avg(post_rate), 3)    as post_rate_avg,
       round(avg(response_rate), 3) as response_rate_avg,
       count(*)                    as occurrences
from metrics.daily_occurrence_stats
group by weekday
order by min(day_number % 7);

-- Q5 · Filing: what people actually answer WITH, versus what the prompt asked
--      for. `type` stopped being a requirement (dailyAccepts) — this says
--      whether anyone noticed, and whether photo prompts get answered in words.
select type as asked_for,
       sum(photo_answers) as answered_photo,
       sum(note_answers)  as answered_note,
       sum(find_answers)  as answered_find,
       sum(poll_answers)  as answered_poll,
       sum(answers)       as answers
from metrics.daily_occurrence_stats
group by type order by answers desc;

-- Q6 · The daily as a whole, over time. Two weeks a row, so the seasonal shape
--      is legible and one dead Tuesday does not read as a trend. This is the
--      one to watch across the holiday stretch.
select date_trunc('week', on_date)::date            as week,
       sum(answers)                                 as answers,
       round(avg(active), 1)                        as active_avg,
       round(sum(answers)::numeric / nullif(sum(active), 0), 3) as answers_per_active,
       round(sum(answers_with_response)::numeric
             / nullif(sum(answers), 0), 3)          as response_rate
from metrics.daily_occurrence_stats
group by 1 order by 1;

-- Q7 · Participation, per person. Who the daily is actually for. If the same
--      four people answer everything, the fix is not a better prompt.
select u.username,
       count(*)                                       as answers,
       count(distinct a.slug)                         as prompts_answered,
       round(count(*)::numeric
             / nullif((select count(*) from metrics.daily_occurrences
                        where on_date >= (u.created_at at time zone
                          (select tz from metrics.daily_config))::date), 0), 3)
                                                      as answer_rate,
       min(a.local_date)                              as first_answer,
       max(a.local_date)                              as last_answer
from metrics.daily_answer_posts a
join public.users u on u.id = a.author
group by u.id, u.username, u.created_at
order by answers desc;

-- Q8 · The room, not the poster: who REPLIES to answers. A daily page with
--      twelve answers and no comments is a wall of monologues, and that is a
--      different problem from a quiet prompt.
select u.username,
       count(*)                          as replies_left,
       count(distinct r.author)          as people_replied_to,
       count(distinct r.slug)            as prompts_touched
from public.comments c
join metrics.daily_answer_posts r on r.id = c.post_id
join public.users u on u.id = c.author
where c.author <> r.author
group by u.id, u.username
order by replies_left desc;

-- Q9 · Sanity check, and the one number to read before trusting any of the
--      above. An answer lands here when its slug did not run on the day it was
--      posted IN THE REPORTING ZONE — almost always a phone whose local day is
--      a day off from `daily_config.tz`, occasionally a post that arrived
--      minutes after its window closed. A handful is normal. A pile means the
--      zone is set to the wrong side of the room.
select slug, local_date, count(*) as stranded
from metrics.daily_answer_posts
where occurrence_day is null
group by slug, local_date
order by local_date desc;

-- Q10 · Coverage: how much of the loop has any data at all. The array is 70
--       long and the first epoch-to-today stretch does not cover it twice, so a
--       prompt with one run and three answers is a sample, not a verdict.
-- `never_run` is a subtraction on purpose: a prompt that has not come round
--       yet has no occurrence row and so is absent from daily_prompt_stats
--       entirely, not present with runs = 0.
select (select count(*) from metrics.daily_prompts) as prompts,
       (select count(*) from metrics.daily_prompts)
         - count(*)                               as never_run,
       count(*) filter (where runs = 1)           as run_once,
       count(*) filter (where answers = 0)        as zero_answers,
       sum(answers)                               as answers_all_time
from metrics.daily_prompt_stats;

-- Q11 · THE OVERHAUL BRIEF. One statement, one row per occurrence that has
--       actually happened, ordered by the fair comparator. Written for the 1.6
--       cut: 40 of the 70 have run and every one of them has run exactly once,
--       so `answers` is the whole sample and `answers_avg` means nothing yet.
--
--       READ post_rate, NOT answers. The room grew across the first six weeks,
--       so a prompt on day 38 is fishing in a bigger pond than one on day 3;
--       raw counts flatter whatever ran late. post_rate divides that out.
--
--       AND READ IT IN GROUPS. At ~4.6 answers a day, one prompt beating
--       another by two answers is noise. The signal is in the bands — kind,
--       weekday, the top and bottom thirds — which is what a per-row dump is
--       for, so the grouping can happen after the fact instead of being baked
--       into an aggregate that hides the spread.
select o.idx, o.on_date, o.weekday, o.slug, o.kind, o.type,
       o.active, o.answers, o.answerers, o.post_rate,
       o.answers_with_response, o.response_rate,
       o.comments, o.likes, o.public_answers,
       o.photo_answers, o.note_answers, o.find_answers
from metrics.daily_occurrence_stats o
order by o.post_rate desc nulls last, o.answers desc;

-- ── Cadence: is a daily too often? ──────────────────────────────────────────
-- Q12 and Q13 exist to answer one question the per-prompt tables cannot: is
-- participation limited by APPETITE (a person has about one answer in them per
-- stretch of days, and the cadence only decides where it lands) or by
-- OPPORTUNITY (people answer when a prompt happens to hit, so more prompts
-- means more answers)? Weekly wins under the first and loses under the second,
-- and nothing in the per-prompt data distinguishes them.

-- Q12 · Per-person cadence. `answers_per_week` is the number to read: if the
--       typical answerer is near 1.0, the room is already answering weekly and
--       a daily is just seven doors into the same room.
with a as (
  select author, occurrence_day as d
  from metrics.daily_answer_posts
  where occurrence_day is not null
  group by author, occurrence_day
),
g as (
  select author, d,
         d - lag(d) over (partition by author order by d) as gap
  from a
)
select u.username,
       count(*)                                          as answers,
       min(g.d)                                          as first_day,
       max(g.d)                                          as last_day,
       max(g.d) - min(g.d) + 1                           as span_days,
       round(count(*)::numeric * 7
             / nullif(max(g.d) - min(g.d) + 1, 0), 2)    as answers_per_week,
       round(avg(g.gap), 2)                              as mean_gap_days,
       max(g.gap)                                        as longest_gap
from g
join public.users u on u.id = g.author
group by u.id, u.username
order by answers desc;

-- Q13 · THE APPETITE TEST, and the one number that decides daily vs weekly.
--       For every day inside a person's own active span, did they answer the
--       NEXT day — split by whether they answered today.
--
--         p_next_after_answering  <  p_next_after_skipping  → appetite-limited.
--           Answering today uses something up. Seven prompts a week are
--           competing for one person's single answer, and weekly loses nothing
--           by asking once.
--
--         p_next_after_answering  >  p_next_after_skipping  → habit-limited.
--           Answering begets answering, the daily is building a rhythm, and
--           dropping to weekly would break the thing that is working.
--
--       The span is per-person (first answer → last answer) so someone who
--       joined late or drifted off is not counted as skipping months.
with a as (
  select author, occurrence_day as d
  from metrics.daily_answer_posts
  where occurrence_day is not null
  group by author, occurrence_day
),
span as (
  select author, min(d) as first_d, max(d) as last_d
  from a group by author having count(*) > 1
),
pairs as (
  select s.author, gs.d,
         exists (select 1 from a where a.author = s.author and a.d = gs.d)     as answered,
         exists (select 1 from a where a.author = s.author and a.d = gs.d + 1) as answered_next
  from span s
  cross join lateral generate_series(s.first_d, s.last_d - 1) gs(d)
)
select
  count(*) filter (where answered)                                   as days_they_answered,
  round(avg(answered_next::int) filter (where answered), 3)          as p_next_after_answering,
  count(*) filter (where not answered)                               as days_they_skipped,
  round(avg(answered_next::int) filter (where not answered), 3)      as p_next_after_skipping,
  round(avg(answered_next::int), 3)                                  as p_next_overall
from pairs;
