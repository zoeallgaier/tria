# The weekly poll — parked, needs more thought

Status: **design only, nothing built.** Zoe parked it on 2026-09-20 ("this needs
much more thought") after one session of scoping. Pick up from here; don't
re-derive what's below.

Mockup (private artifact, Tria's own tokens, interactive):
https://claude.ai/artifact/YQxDJabRkbYjr3LiykNwtR — Discover at phone width with
the three placements, both example questions, a live vote, and the poll's own
page with comments and the report flag. It reflects Zoe's rules below (count
only, no one's pick, flag on others' comments).

## The ask

A feature "akin to the dailies, but weekly": instead of a post prompt, a single
poll the whole room votes on and comments on. Also a way to let users steer
Tria itself ("Should Tria get stories?") alongside silly ones ("Would you rather
fight 25 squirrels or 1 kangaroo?").

## Zoe's calls (settled, don't reopen)

- **No Tria house account.** A weekly poll has no author. It is built like a
  daily: a scheduled entry in app.js with its own page, and the poll machinery
  underneath. "An author issue doesn't make sense" — the poll isn't a post.
- **Votes are private; only the count shows.** Showing that people voted (the
  total, the percentages) is good. Showing WHO voted or WHAT anyone picked is
  not. This differs from ordinary polls, where `poll_votes` is read-all.
- **Comments get reported, not removed by an owner.** A report glyph sits where
  the trash can sits on your own comment (the trash on yours, the flag on
  others'). There is no owner to moderate, and today nobody can delete someone
  else's comment anywhere (`comments delete own` RLS; `deleteComment` in
  store.js checks author).
- **Placement: a second card on Discover.** Zoe's pick of the three.

## The conflict the second card walks into

The note above `lastDailyFor` in app.js says **Discover gets ONE scheduled
card**. Manifest Monday was a weekly prompt drawn as a second, smaller card; it
was built and taken out on 2026-09-03 because two cards plus the rails push the
grid off the first screen on a phone ("a prompt nobody scrolls past is not a
prompt"). `dailyCardEl` lost its `kicker` / `compact` params with it.

Zoe chose the second card knowing this (the mockup's "Second card" note names
Manifest Monday). When building: the app.js note, the `.daily-card` CSS
comments and data.md all state the one-card rule, so they must be rewritten to
record the new decision and its reasoning, not left contradicting the code. The
other two options, for the record: a quiet line folded into the daily card's
foot (recommended at the time, ~50px), or the poll as the grid's lead tile.

## Architecture sketch (not final)

- **Schedule**: a `WEEKLIES` array beside `DAILIES`, same shape of thinking:
  `{ slug, q, options[] }`, resolved by slug, never by index math (see
  `dailyForPost` for why). Page at `#/weekly/<slug>`, modelled on `renderDaily`.
  An occurrence key carries its opening date, e.g. `<slug>@2026-09-21`, so a
  rerun opens empty and the DB can check the window from the key alone.
- **Votes**: new table (e.g. `weekly_votes(key, user_id, choice)`), one row per
  person per week, upsert to change. RLS: read your OWN row only; insert/update
  own, only while `now()` is inside the week parsed from the key, choice 0..3.
  Counts come from a security-definer RPC returning per-choice totals. Reuse the
  poll widget's look (`pollWidgetHtml`: hidden until you vote, fill bars, the
  gradient flourish) but it reads counts, not rows.
- **Comments**: the one real workaround. `comments.post_id` is required today.
  Options: add a nullable `weekly` key with a check that exactly one of
  `post_id`/`weekly` is set (keeps the comment bar, mentions, delete-own), or a
  separate table. Undecided. No post owner means no Updates entry for weekly
  comments, which matches "no push for the daily".
- **Reports**: new `comment_reports` table (reporter, comment, created_at),
  read in the Supabase dashboard. Undecided whether the flag goes on every
  comment in the app or only the weekly page (leaned everywhere, since the
  can't-remove gap is app-wide). Undecided whether a report hides anything.
- **Close time**: dailies are local time with no server. A weekly vote is
  checked server-side, so decide the timezone of "Sunday" (or allow slack).
- One migration for all of the above, run before the app build that uses it
  (see the "verify before repeating that a migration is pending" rule).

## Open issues still flagged

- **Old app builds** never see the card; harmless, but the page link won't
  resolve on them.
- **Private accounts' comments** on the weekly page are readable by the whole
  room. Same as any public post today, but this makes it routine. Consider a
  line in the comment bar, or accept it.
- **The vote total is a number on Discover.** The daily card's answer count is
  documented as the only one besides Trending. It doesn't climb toward a zero
  you're asked to reach, so it passes the no-count rule, but record the call.
- **Tria questions are advisory.** Small, self-selected sample. Only ask what
  Zoe would act on either way; close the loop afterwards. "Stories" and
  "posts that expire" are the two most likely to come back against the ethos.
- **Never add** (inherited from the daily): push for a new poll, streaks, a
  missed-week nudge, a leaderboard.
- Copy: commas and periods, no em dashes. 2–4 choices, ≤60 chars each (the
  composer's limits).

## Draft schedule to review (Mon–Sun weeks, through Jan 3)

Roughly every other week is about Tria. Checked against the season dailies:
Halloween candy (Oct 23), overrated Thanksgiving dish (Nov 20) and leftover
sandwich (Nov 27) are already dailies, so those weeks ask something else. The
Nov 10 daily ("25 bees in your mouth") echoes the squirrels; consider a swap.
Sep 21 has already passed by the time this is built, so the dates will shift.

| Week of | Question | Choices | Kind |
|---|---|---|---|
| Sep 21 | Would you rather fight 25 squirrels or 1 kangaroo? | 25 squirrels · 1 kangaroo | Fun |
| Sep 28 | Should Tria get stories? | Yes, bring them · No, keep it slow · Only if they don’t disappear | Tria |
| Oct 5 | Is a hot dog a sandwich? | Yes · No · It’s its own thing | Fun |
| Oct 12 | How often should the daily land? | Every day · Weekdays only · A few times a week | Tria |
| Oct 19 | Would you rather always be 10 minutes early or 20 minutes late? | 10 early · 20 late | Fun |
| Oct 26 | Would you rather live in a haunted house for free or pay full rent somewhere normal? | Haunted, free · Normal, full rent | Fun (Halloween) |
| Nov 2 | What should Tria add next? | Voice notes in chats · Shared photo albums · Nothing, it’s good as is | Tria |
| Nov 9 | Would you rather give up music or movies for a year? | Music · Movies | Fun |
| Nov 16 | Should posts be able to expire? | Yes, let me set a timer · No, keep everything · Only activities | Tria |
| Nov 23 | Would you rather host Thanksgiving or do all the dishes? | Host it · Do the dishes | Fun (Thanksgiving) |
| Nov 30 | Should Tria make you a year in review? | Yes, I’d love it · Only if it’s just for me · No, skip it | Tria |
| Dec 7 | Would you rather go a month without your phone or your car? | Phone · Car | Fun |
| Dec 14 | Should the app icon change with the seasons? | Yes, dress it up · No, leave it alone | Tria |
| Dec 21 | When do you open presents? | Christmas Eve · Christmas morning · Whenever I’m handed one · We don’t do presents | Fun (Christmas) |
| Dec 28 | Resolutions this year? | Making some · Not this year · I don’t do those | Fun (New Year) |

## Where to look in the code

- Dailies: `DAILIES`, `DAILY_EPOCH`, `SEASON`, `dailyOn`, `lastDailyFor`,
  `dailyCardEl`, `renderDaily` (app.js ~9830–10700); data.md "A daily is a
  question".
- Discover assembly: `renderDiscover` (app.js ~11876), body built as
  `tagRail + dailyCardEl + np + grid`.
- Polls: `pollWidgetHtml` / `pollTimeLabel` (app.js ~3410), `votePoll` and
  `POLL_MS` (store.js ~1726), `supabase/add-polls.sql` (24h RLS window).
- CSS: `.daily-card` (app.css ~5963), `.poll` (~4730).
