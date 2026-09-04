/* ── Store ─────────────────────────────────────────────────────────────────
   The single source of truth at runtime, now backed by Supabase.

   The whole shared world is loaded once at boot (Store.init → loadWorld) into
   an in-memory cache shaped exactly like the old localStorage state, so every
   READ stays synchronous and the views don't change. WRITES became async
   network calls that update the cache on success. This object is still the seam
   the views talk to — they just no longer know (or care) where the data lives.
   Schema + security rules: see supabase/schema.sql. */

// The app's "now" — shared by niceDate's relative-date baseline. Real posts
// carry real timestamps from the server; every timestamp resolves to a calendar
// day in US Mountain time, so "today" flips at midnight in Denver, not UTC.
const dayMT = (t) =>
  new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/Denver' });
const TODAY = dayMT(Date.now());

// Password-recovery landing, captured before anything else touches the URL.
// createClient() below (detectSessionInUrl, on by default) consumes the token
// from the hash and strips it *synchronously*, as part of construction — so this
// has to run before that call, not after, or the hash is already gone by the time
// we look. See the longer comment at `recovering` inside Store for why this can't
// just be an event listener either.
const cameFromRecoveryLink = /type=recovery/.test(location.hash);

const Store = (() => {
  const { url, key } = window.TRIA_CONFIG;
  const sb = window.supabase.createClient(url, key);

  // Password-recovery landing. When someone clicks the reset link in their email,
  // supabase-js consumes the token from the URL (above) and, a beat later, fires
  // PASSWORD_RECOVERY async. That's too late to gate init()'s first hydrate on —
  // init() calls getSession() and would see the recovery session as a normal login
  // before the event ever fires, dropping them straight into the app. So we gate on
  // cameFromRecoveryLink (captured synchronously above) instead; the PASSWORD_RECOVERY
  // event below just re-confirms it and re-triggers the route.
  let recovering = cameFromRecoveryLink;
  const recoveryHandlers = [];
  sb.auth.onAuthStateChange((event) => {
    if (event !== 'PASSWORD_RECOVERY') return;
    recovering = true;
    recoveryHandlers.forEach(fn => { try { fn(); } catch { /* view will re-route */ } });
  });
  const isRecovering = () => recovering;
  const onRecovery = (fn) => { recoveryHandlers.push(fn); };

  // In-memory mirror of the shared world, shaped like the old save file:
  //   users: [{id, username, name, bio, avatar?, accent?, pronouns?}]
  //   posts: [{id, author(username), type, date, tags, title?, url?, note?, image?, _ts}]
  //   comments: [{id, postId, author(username), text, date}]
  //   friends: symmetric adjacency map keyed by username
  //   edgeTs: when each directed edge was made, keyed "adder\nadded" (see below)
  //   declines: usernames whose request I turned down (durably — see declineRequest)
  //   session: the signed-in username, or null
  const empty = () => ({ session: null, users: [], posts: [], comments: [], likes: [], headcount: [], pollVotes: [], friends: {}, edgeTs: {}, declines: [], audience: [], blocks: [] });
  let state = empty();

  /* ── A write that lands mid-load ────────────────────────────────────────────
     loadWorld REPLACES every table wholesale, with rows from reads that were
     issued before it resolved. So a write made while a pull is in the air is
     overwritten by data that predates it: you comment, the comment saves, the
     refresh that was already in flight lands, and your comment is gone from the
     cache while sitting safely in the database. Nothing errors, and refresh()
     compares the world to how it looked BEFORE both, so it reports "nothing
     changed" and nothing repaints either — the comment stays on screen until
     something else rebuilds that card, and then it quietly isn't there. Same
     for a new post, a like, an RSVP, a vote, a name change. It is intermittent
     because it needs a load in flight, and loads are silent: the app pulls the
     world every time it comes back to the foreground, which is exactly what
     picking a photo, answering a push or taking a call does.

     So every cache write goes through `write()`, which records what it did for
     as long as any load is in flight, and loadWorld REPLAYS those writes on top
     of the world it just fetched — anything written while we were waiting is
     newer than anything we read. Replay is safe because every write is
     idempotent: removals are filters, and additions go through `upsert`, which
     replaces the row of the same identity rather than appending a second. That
     matters because the read may or may not have caught the new row (its
     snapshot is taken when the statement starts, not when the request was made),
     and both outcomes have to end the same way.

         EVERY CACHE WRITE GOES THROUGH write(). Assign to state.<table>
         directly only inside loadWorld, which IS the load.

     `worldGen` is the other half: signing out replaces the whole world, so a
     load still in the air has to be dropped on arrival rather than repopulating
     the app of someone who just left. */
  let loadsInFlight = 0;
  let worldGen = 0;
  let pendingWrites = [];
  function write(key, fn) {
    state[key] = fn(state[key]);
    if (loadsInFlight) pendingWrites.push([key, fn]);
  }
  // The add half of every write: replace the row with this identity, or append.
  const upsert = (rows, row, same) => {
    const i = rows.findIndex(same);
    if (i < 0) return rows.concat([row]);
    const out = rows.slice();
    out[i] = row;
    return out;
  };
  // Throw the world away (sign-out, account deletion). Any load in flight is
  // answering a question that no longer has an asker.
  function clearWorld() {
    worldGen++;
    pendingWrites = [];
    state = empty();
  }

  // ── Row → view-shape mappers ───────────────────────────────────────────────
  const dateOf = (ts) => (ts ? dayMT(ts) : TODAY);
  const idOf = (username) => (state.users.find(u => u.username === username) || {}).id || null;

  // The profile colour, mirrored per-device so a pick sticks on a DB that hasn't
  // run profile-accent.sql yet — same belt-and-braces as declines and blocks. It
  // carries its OWN owner id rather than being keyed by the session, because
  // mapUser runs inside loadWorld and `state.session` isn't set until that
  // resolves; an id in the payload needs no ordering to be correct.
  let accentMirror;                                  // undefined = not read yet
  function localAccent() {
    if (accentMirror === undefined) {
      try { accentMirror = JSON.parse(localStorage.getItem('tria:accent') || 'null'); }
      catch { accentMirror = null; }
    }
    return accentMirror;
  }
  function setLocalAccent(id, accent) {
    accentMirror = accent ? { id, accent } : null;
    try {
      if (accentMirror) localStorage.setItem('tria:accent', JSON.stringify(accentMirror));
      else localStorage.removeItem('tria:accent');
    } catch { /* private mode */ }
  }

  /* A self-reported status stops being true, and this is where it stops. Seven
     days is long enough that a song set on Monday is still up on Friday, and
     short enough that a rail of them describes this week rather than last year
     — a wall of songs from March says the room is dead more loudly than an
     empty wall would. See add-listening-to.sql.

     Applied HERE, in the mapper, rather than at each render site: `.listening`
     then means "what to show", not "what's in the row", and no future caller
     can forget the rule. A row with no `at` is dropped rather than trusted —
     every write stamps one, so its absence means malformed, and the one thing
     this feature must never do is show a song it can't date. */
  const LISTENING_TTL_MS = 7 * 86400000;
  /* A song can carry a link PER SERVICE (`apple`, `spotify`), because the reader
     who taps it is not the reader who set it and they may not be on the same
     one. Rows written on the day the feature shipped carry a single `url`
     instead, so it is sorted into the service it belongs to on the way past and
     every reader downstream sees one shape. Nothing is rewritten in the
     database for this: a jsonb column tolerates both, and a read-time fold is
     cheaper and safer than a migration over a column that expires anyway. */
  function freshSong(v) {
    if (!v || typeof v !== 'object' || !v.title) return null;
    const at = Date.parse(v.at || '');
    if (!Number.isFinite(at) || Date.now() - at > LISTENING_TTL_MS) return null;
    if (v.url && !v.apple && !v.spotify) {
      const key = /^https:\/\/music\.apple\.com\//i.test(v.url) ? 'apple'
        : /^https:\/\/open\.spotify\.com\//i.test(v.url) ? 'spotify' : '';
      if (key) return { ...v, [key]: v.url };
    }
    return v;
  }

  /* ── Pins ───────────────────────────────────────────────────────────────────
     Up to three cards a person holds above their own wall: a post they wrote,
     or a song. Read whole, written whole, ordered by the array itself (see
     add-pins.sql for why this is a column and not a table).

     VALIDATED ON THE WAY IN, because a jsonb column takes whatever was last
     written to it and the readers downstream index into it without asking
     twice. A malformed entry is DROPPED rather than repaired: a pin that can't
     say what it points at isn't a pin, and the owner's next write cleans the
     row. The cap is applied here as well as in the database, so a row written
     before the check constraint existed still draws three.

     A song pin carries no `at`, and that absence is the difference between the
     two features: `listening_to` is a claim about right now and expires
     (freshSong above), a pin is a choice and stands until it's changed. */
  const PIN_MAX = 3;
  function pinsFrom(v) {
    if (!Array.isArray(v)) return [];
    const out = [];
    for (const e of v) {
      if (!e || typeof e !== 'object') continue;
      if (e.k === 'post' && typeof e.id === 'string' && e.id) out.push({ k: 'post', id: e.id });
      else if (e.k === 'song' && typeof e.title === 'string' && e.title) {
        const o = { k: 'song', title: e.title };
        for (const key of ['artist', 'art', 'apple', 'spotify'])
          if (typeof e[key] === 'string' && e[key]) o[key] = e[key];
        out.push(o);
      }
      if (out.length === PIN_MAX) break;
    }
    return out;
  }

  function mapUser(u) {
    // `private` gates whether outsiders (non-friends) can see this person's posts.
    // Defaults true where the column isn't there yet (pre-migration DB) so a fresh
    // deploy errs toward closed, not open.
    const o = { id: u.id, username: u.username, name: u.name, bio: u.bio || '',
                private: u.private !== false };
    if (u.avatar) o.avatar = u.avatar;
    if (u.pronouns) o.pronouns = u.pronouns;
    // The song, if it's still true. Absent on a DB that hasn't run
    // add-listening-to.sql — PostgREST omits a column that doesn't exist, so
    // the whole feature simply isn't there rather than erroring.
    const song = freshSong(u.listening_to);
    if (song) o.listening = song;
    // Pinned cards, in order. Absent on a DB that hasn't run add-pins.sql —
    // PostgREST omits a column that doesn't exist, so `pinned` is undefined,
    // pinsFrom answers [] and the whole feature simply isn't there.
    const pins = pinsFrom(u.pinned);
    if (pins.length) o.pins = pins;
    // Accent: the slug of a chosen palette colour, 'default' for Tria's own
    // brand ramp, 'none' for deliberately off (monochrome), or absent for
    // "sample it from my photo", which is still what a new account gets.
    //
    // The column is plain text with no check constraint, which is why adding
    // 'default' needed no migration — a value the DB has never seen writes and
    // reads like any other, and an older client meeting one falls through to
    // the photo, i.e. to the same brand ramp 'default' asks for.
    //
    // The test is `in`, not truthiness, and the difference is the whole fallback.
    // PostgREST returns an existing-but-null column as a null KEY and omits a
    // column that doesn't exist at all, so `'accent' in u` is exactly "has this
    // DB run the migration?". Consulting the device mirror on a null would make
    // "from my photo" unpickable on a migrated DB: clearing the choice writes
    // null, and the mirror would keep handing the old colour straight back.
    if ('accent' in u) { if (u.accent) o.accent = u.accent; }
    else {
      const mine = localAccent();
      if (mine && mine.id === u.id) o.accent = mine.accent;
    }
    return o;
  }
  function mapPost(p, nameById) {
    const o = {
      id: p.id, author: nameById.get(p.author), type: p.type,
      date: dateOf(p.created_at), _ts: p.created_at, tags: p.tags || [],
    };
    if (p.title)    o.title = p.title;
    if (p.url)      o.url = p.url;
    if (p.note)     o.note = p.note;
    if (p.image)    o.image = p.image;
    if (p.tint)     o.tint = p.tint;   // photo/poster's average colour → colour-up in the feed
    if (p.poster)   o.poster = p.poster;   // first-frame still for a video Frame
    if (p.location) o.location = p.location;
    if (p.poll)     o.poll = p.poll;   // { q, options[] } for poll posts
    if (p.event_date) o.eventDate = p.event_date;
    if (p.event_time) o.eventTime = p.event_time;
    // A repost points at the post it passes along. Absent on every other row, and
    // absent on ALL rows until reposts.sql has run — the client tolerates that the
    // same way it tolerates every other pending migration.
    if (p.repost_of) o.repostOf = p.repost_of;
    o.audience = p.audience || 'circle';   // 'circle' (all) or 'list' (hand-picked)
    return o;
  }
  const nameMap = () => new Map(state.users.map(u => [u.id, u.username]));

  // ── Boot ───────────────────────────────────────────────────────────────────
  // Resolve any persisted session, then (if signed in) pull the whole world into
  // the cache. Called once before the first render. supabase-js persists the
  // session in localStorage, so a returning visitor stays logged in.
  async function init() {
    // The OS permission read rides ALONGSIDE the world load, and boot waits for
    // it. It's a local bridge lookup with no network in it, so it costs nothing
    // next to loadWorld — and the first route paints the push UI synchronously,
    // which until now happened while the cache still said null. Null reads as
    // 'default', 'default' means "we have never asked", so a fully subscribed
    // reader got the "Stay in the loop" pre-prompt on Updates every single cold
    // launch, and nothing re-rendered when the real answer arrived behind it.
    const primed = pushPrime();
    try {
      const { data: { session } } = await sb.auth.getSession();
      // A recovery session getSession picked up from the reset link isn't a login —
      // hold it at the gate (set-new-password) instead of hydrating the world.
      if (!recovering) await hydrate(session);
    } finally { await primed; }
  }

  // Set state.session from an auth session and load (or clear) the world.
  async function hydrate(session) {
    if (!session) { clearWorld(); return; }
    await loadWorld();
    const me = state.users.find(u => u.id === session.user.id);
    state.session = me ? me.username : null;
  }

  // Read a whole table, however big it is.
  //
  // PostgREST answers with at most the project's "max rows" (1000 out of the
  // box) and says NOTHING about the cut — no error, no flag, just a short array.
  // Asking in ascending order, as these reads do, that means you get the OLDEST
  // 1000 rows and the table appears to stop growing: every new comment lands in
  // the database, fires its push notification, and is never seen again. That is
  // exactly how comments vanished the day that table crossed 1000 rows, with no
  // deploy to blame — so no read here may assume one request is the whole table.
  //
  // So ask the count along with the first page: `count: 'exact'` is the total
  // past RLS, which makes "have we got it all?" a fact instead of a guess. A
  // short page can't answer it — a table of 300 and a cap of 300 look identical
  // — and guessing wrong truncates in silence, which is the whole bug. A table
  // under the cap still costs exactly one request; only a full one pays for more.
  //
  // The count is not free — PostgREST spells it `COUNT(*) OVER()` in the same
  // statement, so Postgres evaluates the RLS predicate against every row rather
  // than stopping when the page fills — and dropping it was tried, by paging
  // until a page came back short. Don't: without a total, "did the page fill?"
  // can only be answered by asking for another one, so EVERY table paid a second
  // round trip on every load. On a phone the round trip is the expensive part
  // and the count is not; the version that looked cheaper on the database made
  // the app slower to open. Keep the count.
  //
  // Paging is sound only under a TOTAL order: two rows tied on a timestamp could
  // otherwise straddle a page boundary, repeating one and losing the other. So
  // every table sorts by its key, not just by date.
  const PAGE = 1000;
  async function readAll(table, order) {
    const page = (from, size) =>
      order.reduce((q, col) => q.order(col, { ascending: true }),
                   sb.from(table).select('*', { count: 'exact' }))
           .range(from, from + size - 1);

    const first = await page(0, PAGE);
    if (first.error) return first;
    const rows = first.data || [];
    const total = first.count ?? rows.length;    // everything I'm allowed to see
    const size = rows.length;                    // what this project actually serves
    while (size && rows.length < total) {
      const next = await page(rows.length, size);
      if (next.error) return next;               // partial read → caller keeps its cache
      const got = next.data || [];
      if (!got.length) break;                    // count and rows disagree — don't spin
      rows.push(...got);
    }
    return { data: rows, error: null };
  }

  // Pull every profile / post / comment / friendship into the cache. Reads are
  // RLS-gated to signed-in users, so this only returns data once authenticated.
  async function loadWorld() {
    // Where this load stands relative to everything else (see write() above):
    // which world it was asked for, and where the journal was when it started.
    const gen = worldGen;
    const mark = pendingWrites.length;
    loadsInFlight++;
    try { await readWorld(gen, mark); }
    finally {
      loadsInFlight--;
      // A journal entry is only ever wanted by a load that's still waiting.
      if (!loadsInFlight) pendingWrites = [];
    }
  }

  async function readWorld(gen, mark) {
    const read = await Promise.all([
      readAll('users', ['created_at', 'id']),
      readAll('posts', ['created_at', 'id']),
      readAll('comments', ['created_at', 'id']),
      // RLS only hands back the like rows we're allowed to see: our own, plus
      // every like on our own posts. So the cache literally can't compute a count
      // for someone else's post — the rows aren't here.
      readAll('likes', ['created_at', 'post_id', 'user_id']),
      // Headcount is the opposite: who's in IS the point of an activity, so the
      // rows are readable by everyone (the table may not exist yet on an old DB —
      // loadWorld tolerates the error and leaves the list empty).
      readAll('headcount', ['created_at', 'post_id', 'user_id']),
      // Poll votes are public like headcount (who voted for what is the point),
      // one row per voter. Tolerates a pre-migration DB (no table yet → []).
      readAll('poll_votes', ['created_at', 'post_id', 'user_id']),
      readAll('friends', ['a', 'b']),
      // Requests I've turned down. RLS scopes these to me (nobody may learn they
      // were declined), so every row here is one I wrote. Tolerates a
      // pre-migration DB (no table → error, data null → []); app.js keeps a
      // localStorage mirror so a decline still sticks on this device meanwhile.
      readAll('friend_declines', ['decliner', 'declined']),
      // Audience allowlist for 'list' posts. RLS hands back only the rows we may
      // see: our own memberships + every row on posts we authored (enough to show
      // the author a "shared with N" count). Tolerates a pre-migration DB (→ []).
      readAll('post_audience', ['post_id', 'user_id']),
      // People I've blocked. RLS hands back only my own block rows (blocker =
      // me), so every row here is someone I blocked. Tolerates a pre-migration DB
      // (no blocks table yet → error, data null → []); the app keeps a localStorage
      // mirror so blocking still works before this migration is run.
      readAll('blocks', ['blocker', 'blocked']),
    ]);
    // Signed out while this was in the air: the world it answers no longer has
    // an owner, so none of it may be written anywhere.
    if (gen !== worldGen) return;
    const [u, p, c, l, h, pv, f, fd, pa, bl] = read;
    // A read that FAILED must not read as "there's nothing there". This whole
    // load is a full replace, so one erroring table used to blank that table's
    // content everywhere — a live comment thread turning into an empty box, with
    // nothing said anywhere about why. Keep the last good copy instead, and put
    // the reason in the console.
    //
    // Note what this can and can't catch: a real error (offline, a dropped
    // table, a 400) arrives as `error` and is caught here. RLS refusing you is
    // NOT an error — Postgres answers a missing SELECT policy with zero rows and
    // a clean 200, which is indistinguishable from an empty table. Neither is a
    // truncated read: PostgREST's row cap also returns a clean 200, just with the
    // tail missing (readAll above pages past it). If content vanishes with no
    // warning below, suspect the fences and the ceiling, not the network.
    const core = (res, label, map, prev) => {
      if (!res.error) return (res.data || []).map(map);
      console.warn(`[tria] could not read ${label}, keeping the last good copy:`,
        res.error.message || res.error);
      return prev;
    };
    state.users = core(u, 'users', mapUser, state.users);
    const nameById = nameMap();
    state.posts = core(p, 'posts', row => mapPost(row, nameById), state.posts);
    state.comments = core(c, 'comments', row => ({
      id: row.id, postId: row.post_id, author: nameById.get(row.author),
      text: row.body, date: dateOf(row.created_at), _ts: row.created_at,
    }), state.comments);
    state.likes = core(l, 'likes', row => ({ postId: row.post_id, user: nameById.get(row.user_id), _ts: row.created_at }), state.likes);
    // Guarded like the four above, and for the same reason: these tables exist
    // now, so an errored read here is a blip, not a pre-migration DB, and
    // blanking them empties every RSVP, every vote and every "shared with N" in
    // the app at once. On a DB that genuinely hasn't got the table the last good
    // copy is [] anyway, so tolerating the error still costs nothing.
    state.headcount = core(h, 'headcount', row => ({ postId: row.post_id, user: nameById.get(row.user_id), _ts: row.created_at }), state.headcount);
    state.pollVotes = core(pv, 'poll votes', row => ({ postId: row.post_id, user: nameById.get(row.user_id), choice: row.choice, _ts: row.created_at }), state.pollVotes);
    state.audience = core(pa, 'post audience', row => ({ postId: row.post_id, userId: row.user_id }), state.audience);
    // Directed "add" edges: a row (a, b) means a has added b. A friendship is
    // mutual only when both directions exist; a lone edge is a pending request.
    // The map keys each user to the people THEY have added (out-edges only).
    // Guarded like the rest: a failed edge read would otherwise empty everyone's
    // circle at once, which reads as "all my friends are gone" rather than as a
    // network blip.
    if (f.error) {
      console.warn('[tria] could not read friends, keeping the last good copy:',
        f.error.message || f.error);
    } else {
      const fr = {};
      const ts = {};
      const link = (a, b) => { (fr[a] || (fr[a] = [])).includes(b) || fr[a].push(b); };
      for (const row of f.data || []) {
        const a = nameById.get(row.a), b = nameById.get(row.b);
        if (!a || !b) continue;
        link(a, b);
        // An edge's stamp is what turns "they added you" into an event that can
        // be filed and aged (see notifications). Undefined on a pre-migration DB,
        // and null on rows that predate friend-declines.sql — both read as "no
        // time", and an untimed edge is never announced.
        if (row.created_at) ts[edgeKey(a, b)] = row.created_at;
      }
      for (const x of state.users) fr[x.username] || (fr[x.username] = []);
      state.friends = fr;
      state.edgeTs = ts;
    }
    // People I turned down. Read-failure and empty are the same thing here (a
    // pre-migration DB has no table), and app.js's localStorage mirror is folded
    // in on top by declined() so the answer sticks either way.
    state.declines = (fd.data || []).map(row => nameById.get(row.declined)).filter(Boolean);
    // Usernames I've blocked (RLS already scoped these rows to me). Empty on a
    // pre-migration DB — the localStorage mirror in app.js covers that gap.
    state.blocks = (bl.data || []).map(row => nameById.get(row.blocked)).filter(Boolean);

    // Everything written while we were waiting is newer than everything we just
    // read, so it goes back on top (see write()).
    for (const [key, fn] of pendingWrites.slice(mark)) state[key] = fn(state[key]);
  }

  // Re-pull the whole world on demand (nav re-taps, the app foregrounding).
  // Resolves true only when something actually changed, so callers can skip a
  // pointless re-render (and the animation replay that comes with it).
  const worldPrint = () => {
    const { session, ...world } = state;
    return JSON.stringify(world);
  };
  async function refresh() {
    if (!state.session) return false;
    const gen = worldGen;
    const before = worldPrint();
    try { await loadWorld(); } catch { return false; }   // offline — keep the cache
    // Signed out while we were pulling: the world emptying isn't a change worth
    // repainting a page that's already on its way to the gate.
    if (gen !== worldGen) return false;
    return worldPrint() !== before;
  }

  /* ── Derived indexes ────────────────────────────────────────────────────────
     Everything hanging off a post — comments, likes, hands-up, votes, audience —
     lives in one flat array per kind, and the obvious read is a filter. That is
     one scan of the whole table per post per render, so a screen of 40 cards
     walked the comments table 40 times; the cost is posts x comments and it goes
     up as the square as Tria fills in, which is exactly the shape of an app that
     was fine in testing and treacle a year later.

     So group each table by post once, and hand every reader the same Map. The
     cache is a WeakMap keyed on the ARRAY ITSELF, which makes it self-clearing:
     a new array is a new key, and the old index is garbage the moment the old
     array is. That works only under one rule, and it is load-bearing:

        EVERY WRITE REPLACES THE ARRAY IT TOUCHES. Nothing here mutates a state
        array in place — no push, no splice, no element assignment.

     The rule is grep-able and the alternative — an explicit invalidate call at
     every write site — fails silently the first time someone forgets one, and a
     stale like count is worse than a slow one.

     Since the write journal (top of the file) it is also the *same* rule as the
     one that keeps a mid-load write alive, and both are enforced in one place:
     every array here is replaced by a `write()` callback, and a callback that
     replaces rather than mutates is exactly a callback that can be replayed over
     the world a load just fetched. That extends the rule to row objects too —
     changing someone's poll choice regroups nothing, but a row mutated in place
     is a change with nothing to replay, so votes go through `upsert` now.

     Readers get the grouped array directly, not a copy: every caller filters or
     counts, none of them mutate what they're handed. Keep it that way. */
  const groups = new WeakMap();
  const NO_ROWS = Object.freeze([]);
  function byPost(rows) {
    let m = groups.get(rows);
    if (!m) {
      m = new Map();
      for (const r of rows) {
        const list = m.get(r.postId);
        if (list) list.push(r); else m.set(r.postId, [r]);
      }
      groups.set(rows, m);
    }
    return m;
  }
  const rowsFor = (rows, postId) => byPost(rows).get(postId) || NO_ROWS;
  const mineIn = (rows, postId) =>
    rowsFor(rows, postId).find(x => x.user === state.session) || null;

  // ── Reads (synchronous, off the cache) ─────────────────────────────────────
  const users = () => state.users;
  const user  = (username) => state.users.find(u => u.username === username) || null;
  const session = () => state.session;
  const isAuthed = () => !!state.session;
  const currentUser = () => user(state.session);

  // Is this person private — posts fenced to their friends? Unknown user → treat
  // as private (fail closed). Drives the profile's "add them to see posts" gate.
  const isPrivate = (username) => (user(username) || { private: true }).private !== false;

  // Any user's friends — mutual only: people they've added who've added them
  // back. A one-sided edge is a pending request, not a friendship.
  function friendsOf(username) {
    const theirs = state.friends[username] || [];
    return theirs.filter(u => (state.friends[u] || []).includes(username));
  }

  // The current user's friends (shorthand for friendsOf on the session).
  function friends() {
    return friendsOf(state.session);
  }

  // One-way edges I've made: people I've added who haven't added me back. The
  // SAME row means two different things depending on who it points AT, so every
  // caller below splits this list on the target's privacy:
  //   → a PUBLIC account: a follow. Nothing is pending, it already took effect.
  //   → a PRIVATE account: a request, waiting on them.
  function outgoingEdges() {
    const me = state.session;
    return (state.friends[me] || []).filter(u => !(state.friends[u] || []).includes(me));
  }
  // When a directed edge was made, keyed "adder\nadded". Newline because a
  // username can't contain one. '' when the edge doesn't exist OR predates
  // friend-declines.sql (those rows carry no stamp on purpose — see the
  // migration), and an untimed edge is one nothing may be announced about.
  const edgeKey = (a, b) => a + '\n' + b;
  const edgeTs = (a, b) => state.edgeTs[edgeKey(a, b)] || '';

  // ── Declined requests ───────────────────────────────────────────────────────
  // People whose request I turned down. Server rows (RLS-scoped to me) plus a
  // per-device localStorage mirror, so a decline sticks even on a DB that hasn't
  // run friend-declines.sql — same belt-and-braces as blocking.
  const declineKey = () => `tria:declines:${state.session}`;
  // Read once per session rather than per call. friendStatus consults this and
  // is asked per TILE on Discover and on a daily page — a JSON.parse of
  // localStorage behind the app's hottest paint is exactly the kind of cost that
  // doesn't show up until the grid is full.
  let mirror = null, mirrorFor = null;
  function localDeclines() {
    if (!state.session) return [];
    if (mirrorFor !== state.session) {
      mirrorFor = state.session;
      try { mirror = JSON.parse(localStorage.getItem(declineKey()) || '[]'); } catch { mirror = []; }
      if (!Array.isArray(mirror)) mirror = [];
    }
    return mirror;
  }
  function setLocalDeclines(list) {
    if (!state.session) return;
    mirrorFor = state.session; mirror = list;
    try { localStorage.setItem(declineKey(), JSON.stringify(list)); } catch { /* private mode */ }
  }
  const declined = () => [...new Set([...state.declines, ...localDeclines()])];
  const isDeclined = (username) =>
    state.declines.includes(username) || localDeclines().includes(username);

  // One-way edges pointing AT me: people who've added me, whom I haven't added
  // back. Same split, but on MY privacy — if my account is public they're
  // followers (nothing to approve); if it's private they're requests.
  function incomingEdges() {
    const me = state.session;
    return state.users
      .map(u => u.username)
      .filter(u => u !== me &&
        (state.friends[u] || []).includes(me) &&
        !(state.friends[me] || []).includes(u));
  }

  // Public accounts I follow. A follow is immediate and one-way — no approval —
  // and what it BUYS is their public posts in my feed (see feed() below).
  const following = () => outgoingEdges().filter(u => !isPrivate(u));
  // People following me. Only meaningful while I'm public; a private account's
  // incoming edges are requests, not follows. Note what this is NOT: the Updates
  // page used to render this list as standing rows above the ledger, which meant
  // every follower you didn't add back sat there with a button on them forever.
  // A follow is an event now (notifications(), kind 'follow') and this is just
  // the roster.
  const followers = () => isPrivate(state.session) ? [] : incomingEdges();

  // Requests I've sent that haven't been answered. Follows are NOT requests, so
  // a public target's edge doesn't belong here — it isn't pending on anyone.
  const requestsSent = () => outgoingEdges().filter(u => isPrivate(u));
  // Requests waiting on ME — answer by adding them back (→ mutual) or declining
  // (declineRequest). A public account has none: nobody needs its permission.
  // Someone I've already declined never appears again, however many times they
  // re-add me; that's what makes the answer an answer rather than a delay.
  const requestsReceived = () =>
    isPrivate(state.session) ? incomingEdges().filter(u => !isDeclined(u)) : [];

  // My relationship to `username`, as one word — drives the profile button and
  // the directory rows:
  //   'self' | 'friends' | 'following' | 'sent' | 'follower' | 'incoming' | 'none'
  // 'following'/'sent' are the same edge seen against a public/private target;
  // 'follower'/'incoming' are the same edge pointing at a public/private ME.
  function friendStatus(username) {
    const me = state.session;
    if (!me || username === me) return 'self';
    const iAdded = (state.friends[me] || []).includes(username);
    const theyAdded = (state.friends[username] || []).includes(me);
    if (iAdded && theyAdded) return 'friends';
    if (iAdded) return isPrivate(username) ? 'sent' : 'following';
    // A person I declined is a stranger to me again, even if they've re-added
    // me since: their profile offers "Add friend", not "Accept request". Tapping
    // it clears the decline and, because their edge is still there, makes us
    // mutual on the spot — which is right, both of us have now asked.
    if (theyAdded) return isDeclined(username) ? 'none'
      : (isPrivate(me) ? 'incoming' : 'follower');
    return 'none';
  }

  // Home feed: your mutual friends' posts, plus your own, plus the PUBLIC posts
  // of the public accounts you follow — newest first. Following is the one way
  // into this feed that doesn't need consent on both sides, so it's deliberately
  // narrow: only their public posts ride along. Their circle posts stay circle
  // business until you're actually mutual (the DB agrees — can_view_post's
  // circle branch needs both edges, so those rows never reach this cache).
  //
  // A repost enters this filter with no special case, because it IS a post row
  // authored by the person who passed it along. What it does need is the second
  // half of its gate: `visibleRepost` drops any repost whose original isn't in
  // the cache. RLS already refuses to hand over a repost you can't see through
  // (can_view_original), so a missing original means the row shouldn't be drawn —
  // and it's also the honest answer for the window between a delete landing and
  // the next pull, when the cascade has taken the original but not yet this.
  function feed() {
    const circle = new Set([state.session, ...friends()]);
    const followed = new Set(following());
    return posts().filter(p =>
      visibleRepost(p) && (
        circle.has(p.author) ||
        (followed.has(p.author) && p.audience === 'public')));
  }

  // ── Reposts ─────────────────────────────────────────────────────────────────
  // A repost is a post row carrying `repostOf` and, if it's a quote, a note. It
  // is NOT a sixth member of the pastel quintet — no hue, no heart, no ring dot;
  // in the cache it's just a sixth `type`.
  //
  // The original always resolves to the FIRST original: reposting a repost points
  // at what that one points at, so a chain collapses instead of nesting. The DB
  // agrees (the insert policy refuses an original whose type is 'repost'), which
  // is what makes this a fact rather than a convention.
  // Two indexes, same WeakMap-on-the-array rule as byPost above: keyed on the
  // posts ARRAY, so replacing state.posts (which every write does) drops them
  // and they cannot go stale. They exist because cardActionsHtml runs these two
  // lookups for every card in a paint — a plain .find() per card is O(n²) over
  // the whole table, on the feed's hot path.
  const postIndex = new WeakMap();
  function byId(rows) {
    let m = postIndex.get(rows);
    if (!m) { m = new Map(rows.map(p => [p.id, p])); postIndex.set(rows, m); }
    return m;
  }
  // My BARE reposts, keyed by what they point at. A quote carries a note and is
  // a separate post you delete from its own menu, so it is deliberately not here.
  // Safe to bake state.session into the index because the two can't part: signing
  // in or out goes through loadWorld / clearWorld, and both replace state.posts.
  const bareIndex = new WeakMap();
  function myBare(rows) {
    let m = bareIndex.get(rows);
    if (!m) {
      m = new Map();
      // Bare means NO WORDS OF YOUR OWN — neither a note nor a title. A quote
      // that carries only a headline is still a quote, and must not be mistaken
      // for the toggle's row or "Undo repost" would offer to delete it.
      for (const p of rows)
        if (p.repostOf && !p.note && !p.title && p.author === state.session) m.set(p.repostOf, p);
      bareIndex.set(rows, m);
    }
    return m;
  }

  const originalOf = (post) =>
    (post && post.repostOf) ? (byId(state.posts).get(post.repostOf) || null) : null;
  // A repost with no original in the cache is a repost we can't see through.
  const visibleRepost = (p) => !p.repostOf || !!originalOf(p);

  // Can I pass this along? Two rules, and there used to be three. Not
  // hand-addressed (that allowlist belongs to its author and isn't mine to
  // reproduce), and there has to be something there to point at.
  //
  // YOUR OWN POSTS ARE REPOSTABLE. The no-self rule toggleLike has was copied
  // here on the reading that passing your own thing along is talking to
  // yourself, and that reading was wrong about what a repost is FOR here: a
  // circle post reaches the intersection of two circles, so bringing one of your
  // own back up is the one move that reaches the people who joined since. A
  // quote of your own post is the same act with a sentence on it — the thought
  // you had about the thing you wrote a month ago — and there was never an
  // argument for allowing that and refusing the bare form.
  //
  // Nothing downstream needed loosening to allow it, which is the sign it was
  // only ever a client opinion: reposts.sql never had a no-self arm (the insert
  // policy checks the audience, the allowlist and the chain, not the author),
  // the derived ledger already skips `p.author !== me`, and the push function
  // already refuses to buzz you about yourself (`orig.author !== rec.author`).
  function repostable(post) {
    if (!post || !state.session) return false;
    const target = originalOf(post) || post;
    return (target.audience || 'circle') !== 'list';
  }
  function myRepostOf(postId) {
    const seed = byId(state.posts).get(postId);
    return myBare(state.posts).get((seed && seed.repostOf) || postId) || null;
  }
  const repostedByMe = (postId) => !!myRepostOf(postId);

  // Discover: everything on Tria you're allowed to see that isn't yours, newest
  // first. This used to mean "public posts only", which was the right shape
  // while Discover was strictly a stranger-meeting page. It's now the whole room
  // in one grid (see renderDiscover), so a friend's circle post belongs here
  // too: you can already read it in your feed, and browsing your own people in
  // that format is half of why the page stays worth opening once your circle
  // fills in.
  //
  // This widens NOTHING about who may see what. The cache only ever holds rows
  // RLS handed over, so a stranger still contributes public posts and nothing
  // else, and audience stays per-post authoritative — a private account's one
  // public thought is here, a public account's circle post is not (unless we're
  // mutual, in which case it was always mine to read).
  //
  // `addressed` folds in 'list' posts, the ones hand-sent to named people. They
  // stay out of the browse grid, because a letter shouldn't be re-shelved as
  // something to browse, and they come back for SEARCH on the same principle
  // that lifts the per-person cap there: never hide the thing someone is
  // actively looking for. Your own posts are out either way (you aren't
  // discovering yourself), and blocked authors are filtered in the view.
  //
  // The audience test mirrors can_view_post's rather than trusting the cache to
  // have been filtered: RLS is the real gate, but a browse surface that shows
  // everything it happens to be holding is one stale row away from showing it to
  // the wrong person, and the client already knows enough to check. Missing
  // audience reads as 'circle', which is the column's default.
  //
  // Reposts are out entirely, and that's editorial rather than technical.
  // Discover is the room's own work, chronological and capped per person; a wall
  // of passed-along posts is the infinite feed this app is built against. A
  // masonry tile also has nowhere to carry a byline that isn't the tile's.
  function discover({ addressed = false } = {}) {
    const circle = new Set(friends());
    return posts().filter(p => {
      if (p.author === state.session) return false;
      if (p.repostOf) return false;
      const aud = p.audience || 'circle';
      if (aud === 'public') return true;
      if (aud === 'list') return addressed;
      return circle.has(p.author);
    });
  }

  // All posts, newest first, by real server timestamp (stable). Sorted once per
  // version of the array rather than once per caller — feed(), discover(),
  // postsBy() and half a dozen lookups in app.js all come through here, and a
  // single paint used to re-sort the whole table for each of them. Same WeakMap
  // rule as the indexes above: replace state.posts, never mutate it, and this
  // can't go stale.
  const sorted = new WeakMap();
  function posts() {
    let list = sorted.get(state.posts);
    if (!list) {
      list = [...state.posts].sort((a, b) => (a._ts < b._ts ? 1 : a._ts > b._ts ? -1 : 0));
      sorted.set(state.posts, list);
    }
    return list;
  }
  const postsBy = (username) => posts().filter(p => p.author === username);

  // How many people a targeted post is shared with. Accurate for posts you
  // authored (RLS gives you all their allowlist rows); 0 for others' posts.
  const audienceCount = (postId) => rowsFor(state.audience, postId).length;

  // WHO a post is addressed to, by username. audienceCount above answers "how
  // many" off the allowlist alone; this answers "which people", and for the two
  // audiences that name no rows at all it has to derive the set.
  //
  // The rule is COPIED from the reminder sweep (supabase/activity-reminders.sql),
  // deliberately and not by coincidence: the people a reminder wakes up and the
  // people this list names have to be the same set, or one of the two is lying to
  // the host. So 'list' is the hand-picked allowlist, and 'circle' AND 'public'
  // are both the author's mutual friends. Public is the case worth understanding:
  // its audience is technically every account on Tria, but canJoin is friends-only,
  // so anyone outside the circle would be reading about a plan the app will not let
  // them answer. Same friends-only line, one more place.
  //
  // AUTHOR-ONLY, and that is a data fact rather than a courtesy. RLS hands you the
  // post_audience rows for posts you wrote plus your own membership rows and
  // nothing else, so on somebody else's 'list' post this could only ever answer
  // with the fragment it happens to be holding. A partial guest list is worse than
  // no guest list, so it refuses instead.
  function audienceOf(postId) {
    const post = byId(state.posts).get(postId);
    if (!post || post.author !== state.session) return [];
    if ((post.audience || 'circle') !== 'list') return friendsOf(post.author);
    const names = nameMap();
    return rowsFor(state.audience, postId).map(r => names.get(r.userId)).filter(Boolean);
  }

  // ── Auth (async writes) ────────────────────────────────────────────────────
  // Create an account: Supabase Auth owns the email + password; the username and
  // name ride along as metadata, and a DB trigger turns them into a public
  // profile row (see schema.sql). With "Confirm email" on, signUp returns NO
  // session until the link is clicked (see the !data.session branch below); with
  // it off, signUp hands back a live session and we're straight in.
  async function signup({ name, username, email, password }) {
    name = String(name || '').trim();
    username = String(username || '').trim().toLowerCase();
    email = String(email || '').trim();
    if (!name) return { ok: false, error: 'Add a display name.' };
    if (!/^[a-z0-9_]{2,20}$/.test(username))
      return { ok: false, error: 'Username: 2–20 letters, numbers or _.' };
    if (!/^\S+@\S+\.\S+$/.test(email))
      return { ok: false, error: 'Enter a valid email address.' };
    if (String(password || '').length < 6)
      return { ok: false, error: 'Password needs at least 6 characters.' };

    // Friendly "taken" check *before* creating the login. Uses an anon-callable
    // RPC (anon can't read the users table directly); if it isn't installed yet,
    // fall through and let the unique constraint be the backstop.
    try {
      const { data: free, error } = await sb.rpc('username_available', { u: username });
      if (!error && free === false) return { ok: false, error: 'That username is taken.' };
    } catch { /* RPC absent — rely on the DB constraint below */ }

    const { data, error } = await sb.auth.signUp({
      email, password, options: { data: { username, name } },
    });
    if (error) {
      const m = /already|registered/i.test(error.message) ? 'That email already has an account.'
        : /duplicate|unique|username|database error/i.test(error.message) ? 'That username is taken.'
        : error.message;
      return { ok: false, error: m };
    }
    // Confirm-email on: no session yet. Signal the view to show a positive "check
    // your inbox" screen (with resend), not a red error — the account was created.
    if (!data.session) return { ok: false, pending: true, email };
    await hydrate(data.session);
    return { ok: true };
  }

  async function login(email, password) {
    email = String(email || '').trim();
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
      // Confirm-email gate: the credentials are right, they just haven't clicked
      // the link yet. Flag it so the view can offer a friendly resend instead of
      // the generic "wrong email or password" (which would be misleading here).
      if (/confirm/i.test(error.message))
        return { ok: false, error: 'Confirm your email to log in. Check your inbox for the link.', needsConfirm: true };
      return { ok: false, error: 'Wrong email or password.' };
    }
    await hydrate(data.session);
    return { ok: true };
  }

  // Signing out hands this device's push address back FIRST, while the session
  // is still live enough for RLS to allow the delete. The row is the only thing
  // the sender consults, so leaving it behind meant the account that had just
  // signed out went on having its comments and requests read out on the lock
  // screen of a phone somebody else was now using. The OS permission and the
  // local "push is on" marker both stay — whoever signs in next inherits a
  // device that is willing, and pushResume claims it for them.
  async function logout() {
    await releaseEndpoint();
    await sb.auth.signOut();
    recovering = false;
    clearWorld();
  }

  async function requestPasswordReset(email) {
    email = String(email || '').trim();
    if (!/^\S+@\S+\.\S+$/.test(email))
      return { ok: false, error: 'Enter a valid email address.' };
    // No app hash on redirectTo: supabase-js appends the recovery token as its OWN
    // hash fragment, and a second '#' would collide with our hash router and hide
    // the token. We land on the bare origin, the client fires PASSWORD_RECOVERY,
    // and route() shows set-new-password off the `recovering` flag (not the URL).
    const { error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: `${location.origin}${location.pathname}`,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  async function updatePassword(password) {
    if (String(password || '').length < 6)
      return { ok: false, error: 'Password needs at least 6 characters.' };
    const { data, error } = await sb.auth.updateUser({ password });
    if (error) return { ok: false, error: error.message };
    // Password set: the recovery session is now a normal login. Clear the flag and
    // hydrate the world so we can drop them straight into the app, signed in.
    recovering = false;
    const { data: { session } } = await sb.auth.getSession();
    await hydrate(session || (data && data.user ? { user: data.user } : null));
    return { ok: true };
  }

  async function resendConfirmation(email) {
    email = String(email || '').trim();
    const { error } = await sb.auth.resend({ type: 'signup', email });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  // Permanently deletes the signed-in user's account: their Storage folder
  // (avatars + post photos + videos, which sit outside the DB) and their
  // auth.users row, which cascades through public.users to every post, comment,
  // like, headcount row, poll vote, friend edge, block, and push subscription
  // (see schema.sql's `on delete cascade` chain).
  //
  // Storage goes FIRST, and not just for tidiness: those files are the one thing
  // the cascade can't reach, and storage.objects carries its own reference back
  // to the owner, so a leftover file can refuse the row delete outright. The row
  // itself goes through the delete_account() RPC — a SECURITY DEFINER function
  // that deletes the caller's own row and nobody else's (supabase/delete-account-rpc.sql).
  // This used to be an Edge Function; that needed a deploy step that never
  // happened, so every tap 404'd. Postgres needs no deploy.
  async function deleteAccount() {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return { ok: false, error: 'You need to be signed in.' };

    // Best effort — a file we can't clear shouldn't strand someone in an account
    // they've asked to leave. `list` pages at 100, so keep asking until it runs dry.
    try {
      for (;;) {
        const { data: files, error } = await sb.storage.from('media')
          .list(user.id, { limit: 100 });
        if (error || !files || !files.length) break;
        const { error: rmErr } = await sb.storage.from('media')
          .remove(files.map((f) => `${user.id}/${f.name}`));
        if (rmErr) break;
        if (files.length < 100) break;
      }
    } catch { /* fall through to the row delete */ }

    const { error } = await sb.rpc('delete_account');
    if (error) {
      console.error('delete_account failed', error);
      return { ok: false, error: 'Couldn’t delete your account. Try again in a moment.' };
    }

    // Local scope only: the account this session belonged to no longer exists, so
    // asking the server to revoke its token would just 403 on the way out.
    await sb.auth.signOut({ scope: 'local' }).catch(() => {});
    recovering = false;
    clearWorld();
    return { ok: true };
  }

  // ── Friends (async writes) ──────────────────────────────────────────────────
  const isFriend = (username) => friends().includes(username);

  // Whether two users are (mutual) friends — used to validate @mentions at
  // render time: a tag only counts if the tagged person was the author's friend.
  const areFriends = (a, b) =>
    (state.friends[a] || []).includes(b) && (state.friends[b] || []).includes(a);

  const linkCache = (a, b) => write('friends', fr => {
    const l = fr[a] || (fr[a] = []);
    if (!l.includes(b)) l.push(b);
    return fr;
  });
  const unlinkCache = (a, b) => {
    write('edgeTs', ts => { delete ts[edgeKey(a, b)]; return ts; });
    write('friends', fr => {
      const l = fr[a];
      if (l) { const i = l.indexOf(b); if (i > -1) l.splice(i, 1); }
      return fr;
    });
  };

  // Add someone: create MY directed edge (me → them). If they'd already added
  // me this second edge makes us mutual; otherwise it stands as a pending
  // request until they add me back. Accepting a request I received is the very
  // same write — I add the person who added me. Stored as one directed row.
  async function addFriend(username) {
    const me = state.session;
    if (!me || username === me) return;
    const mine = idOf(me), theirs = idOf(username);
    if (!mine || !theirs) return;
    const { error } = await sb.from('friends').insert({ a: mine, b: theirs });
    if (error && !/duplicate|unique/i.test(error.message)) return;  // already added → fine
    linkCache(me, username);
    const stamp = new Date().toISOString();
    write('edgeTs', ts => { ts[edgeKey(me, username)] = stamp; return ts; });
    // Reaching out to someone I once declined withdraws the decline — otherwise
    // a change of heart leaves them permanently muted on a tie I just made.
    if (isDeclined(username)) await undecline(username);
  }

  // Turn down a request. The edge goes (removeFriend, same as cancelling or
  // unfriending) AND the answer is remembered, which is the half that was
  // missing: a deleted edge stops nothing, so the same person re-adding you put
  // the request straight back at the top of Updates. With the row here they can
  // add you as often as they like and you never hear about it again — no row, no
  // push, nothing on their profile. Silent on their end by design: being
  // declined is not news anyone is owed, exactly like a block.
  async function declineRequest(username) {
    const me = state.session;
    if (!me || username === me) return;
    await removeFriend(username);
    write('declines', d => (d.includes(username) ? d : d.concat([username])));
    // The mirror is written FIRST and unconditionally: it's what carries the
    // decline on a DB that hasn't run friend-declines.sql, and it costs nothing
    // when the insert below does work.
    setLocalDeclines([...new Set([...localDeclines(), username])]);
    const mine = idOf(me), theirs = idOf(username);
    if (!mine || !theirs) return;
    await sb.from('friend_declines').insert({ decliner: mine, declined: theirs });
  }

  // Withdraw a decline (I've added them after all, or cleared it by hand).
  async function undecline(username) {
    const me = state.session;
    if (!me) return;
    write('declines', d => d.filter(u => u !== username));
    setLocalDeclines(localDeclines().filter(u => u !== username));
    const mine = idOf(me), theirs = idOf(username);
    if (!mine || !theirs) return;
    await sb.from('friend_declines').delete().eq('decliner', mine).eq('declined', theirs);
  }

  // Remove the tie in BOTH directions — one call covers cancelling a request I
  // sent, declining one sent to me, and unfriending a mutual friend. RLS lets me
  // delete any row I'm part of, so the filtered delete clears whichever edges
  // exist. (`accept` above and this are the only two friend writes the UI needs.)
  async function removeFriend(username) {
    const me = state.session;
    if (!me) return;
    const mine = idOf(me), theirs = idOf(username);
    if (!mine || !theirs) return;
    const { error } = await sb.from('friends').delete()
      .or(`and(a.eq.${mine},b.eq.${theirs}),and(a.eq.${theirs},b.eq.${mine})`);
    if (error) return;
    unlinkCache(me, username); unlinkCache(username, me);
  }

  // ── Blocking ────────────────────────────────────────────────────────────────
  // Server-backed once blocks.sql is run: the row hides posts BOTH ways at the
  // data layer (can_view_post excludes blocked pairs), so a stale client mirror
  // can't leak content. Before the migration, these writes no-op on the missing
  // table and app.js's localStorage mirror carries the block on its own.
  const isBlocked = (username) => state.blocks.includes(username);

  async function block(username) {
    const me = state.session;
    if (!me || username === me) return;
    const mine = idOf(me), theirs = idOf(username);
    if (!mine || !theirs) return;
    // Blocking a friend severs the tie too, so RLS stops handing them your posts.
    await removeFriend(username);
    const { error } = await sb.from('blocks').insert({ blocker: mine, blocked: theirs });
    if (error && !/duplicate|unique/i.test(error.message)) return;  // table missing / already blocked → localStorage covers it
    write('blocks', b => (b.includes(username) ? b : b.concat([username])));
  }

  async function unblock(username) {
    const me = state.session;
    if (!me) return;
    const mine = idOf(me), theirs = idOf(username);
    if (mine && theirs) await sb.from('blocks').delete().eq('blocker', mine).eq('blocked', theirs);
    write('blocks', b => b.filter(u => u !== username));
  }

  // ── Compose (async writes) ──────────────────────────────────────────────────
  // Upload a data: URI or a Blob/File (native video capture hands back a Blob —
  // it must never be inflated to a base64 data-URI first) into the public 'media'
  // bucket under the user's own {uid}/ folder, and hand back its public URL. This
  // is why photos/videos no longer bloat the database — the column just stores
  // the URL. `contentType`/`ext` come from the caller (the recorder's mimeType on
  // web, the native file's type on device) — never assumed to be JPEG.
  async function uploadMedia(source, kind, { contentType, ext, dims, clip, onProgress } = {}) {
    const me = currentUser();
    if (!me) throw new Error('Not signed in.');
    let blob, type = contentType, extension = ext;
    if (typeof source === 'string') {
      if (!/^data:/.test(source)) return source;      // already a URL → pass through
      blob = await (await fetch(source)).blob();
      type = type || blob.type || 'image/jpeg';
      extension = extension || 'jpg';
    } else {
      blob = source;
      type = type || blob.type || 'application/octet-stream';
      extension = extension || (type.split('/')[1] || 'bin').split(';')[0];
    }
    // Stamp the pixel size into the filename (…-WxH.ext) so the feed can reserve
    // the photo/video's space before it loads (see imageDimsFromUrl) — no extra
    // column, no metadata round-trip. Avatars (fixed-size tiles) skip this.
    const dim = dims && dims.w && dims.h ? `-${dims.w}x${dims.h}` : '';
    // A trimmed clip carries its play-window (start/end, in ms) stamped the same
    // way — before the -WxH segment so imageDimsFromUrl still matches at the end.
    // The feed/lightbox loop just this window (clipWindowFromUrl); no DB column.
    const win = clip && clip.end > clip.start
      ? `-t${Math.round(clip.start * 1000)}-${Math.round(clip.end * 1000)}` : '';
    const path = `${me.id}/${kind}-${Date.now()}${win}${dim}.${extension}`;
    // Real byte-level progress (videos are the big upload) needs XHR — supabase-js's
    // .upload() runs on fetch with no progress events. We POST straight to the same
    // Storage REST endpoint it would hit, streaming xhr.upload.onprogress to the
    // caller, and fall back to sb.storage.upload() if anything about XHR fails.
    if (onProgress) {
      try {
        await xhrUpload(path, blob, type, onProgress);
        return sb.storage.from('media').getPublicUrl(path).data.publicUrl;
      } catch (e) {
        if (e && e._httpStatus) throw e;   // a real server rejection — don't mask it
        // XHR plumbing failed (offline shim, blocked, etc.) → fall through to fetch.
      }
    }
    const { error } = await sb.storage.from('media')
      // Filenames are versioned (a fresh timestamp each save), so the bytes at a
      // URL never change — cache them for a year to make repeat loads instant.
      .upload(path, blob, { contentType: type, upsert: false, cacheControl: '31536000' });
    if (error) throw error;
    return sb.storage.from('media').getPublicUrl(path).data.publicUrl;
  }

  // POST a blob to Storage with progress. Mirrors supabase-js's own upload request
  // (bucket 'media', the user's bearer token + publishable apikey) so RLS applies
  // identically; the only reason we hand-roll it is xhr.upload.onprogress.
  async function xhrUpload(path, blob, type, onProgress) {
    const { data } = await sb.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) throw new Error('No session for upload.');
    const endpoint = `${url}/storage/v1/object/media/${path.split('/').map(encodeURIComponent).join('/')}`;
    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', endpoint);
      xhr.setRequestHeader('authorization', `Bearer ${token}`);
      xhr.setRequestHeader('apikey', key);
      xhr.setRequestHeader('cache-control', 'max-age=31536000');
      xhr.setRequestHeader('x-upsert', 'false');
      if (type) xhr.setRequestHeader('content-type', type);
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable) onProgress(ev.loaded / ev.total);
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) { onProgress(1); resolve(); }
        else { const err = new Error(`Upload failed (${xhr.status}).`); err._httpStatus = xhr.status; reject(err); }
      };
      xhr.onerror = () => reject(new Error('Upload network error.'));
      xhr.onabort = () => reject(new Error('Upload aborted.'));
      xhr.send(blob);
    });
  }
  function uploadImage(dataURI, kind, dims) {
    // Cropped/re-encoded photos, posters, and avatars are always canvas JPEGs —
    // but a Frame GIF rides through untouched (see initPhotoPreview), so read
    // its real MIME off the data URI rather than assuming JPEG.
    const m = /^data:([^;]+);/.exec(dataURI);
    const type = m ? m[1] : 'image/jpeg';
    const ext = type === 'image/gif' ? 'gif' : 'jpg';
    return uploadMedia(dataURI, kind, { contentType: type, ext, dims });
  }

  async function createPost(data, { onProgress } = {}) {
    const me = state.session;
    if (!me) return { ok: false, error: 'You need to be signed in.' };
    const row = { author: idOf(me), type: data.type, tags: data.tags || [] };
    // Three audience levels: 'public' (Anyone, discoverable), 'list' (hand-picked
    // people via post_audience), or 'circle' (mutual friends, the default).
    // Targeted only when the composer picked 'list' AND named at least one person;
    // "choose people" with nobody picked falls back to the whole circle.
    const targetIds = (data.audience === 'list' ? (data.audienceUsers || []) : [])
      .map(idOf).filter(Boolean);
    row.audience = data.audience === 'public'
      ? 'public'
      : (targetIds.length ? 'list' : 'circle');
    if (data.title)    row.title = data.title;
    if (data.url)      row.url = data.url;
    if (data.note)     row.note = data.note;
    if (data.location) row.location = data.location;
    if (data.poll)     row.poll = data.poll;   // { q, options[] }
    if (data.eventDate) row.event_date = data.eventDate;
    if (data.eventTime) row.event_time = data.eventTime;
    if (data.video) {
      try {
        const vExt = /mp4/i.test(data.video.type) ? 'mp4' : /webm/i.test(data.video.type) ? 'webm' : 'mov';
        row.image = await uploadMedia(data.video, 'video', { contentType: data.video.type || 'video/mp4', ext: vExt, dims: data.imageDims, clip: data.clip, onProgress });
        // Best-effort: the feed's #t=0.001 fragment self-paints a first frame even
        // without a stored poster, so a failed/skipped poster upload isn't fatal.
        if (data.poster) row.poster = await uploadImage(data.poster, 'poster', data.imageDims);
      } catch { return { ok: false, error: 'Couldn’t upload the video, try again.' }; }
      // The poster's average colour rides along in the row (no upload) so the feed
      // settles it over its own colour. Best-effort: without it, the neutral box.
      if (data.imageTint) row.tint = data.imageTint;
    } else if (data.image) {
      try { row.image = await uploadImage(data.image, 'photo', data.imageDims); }
      catch { return { ok: false, error: 'Couldn’t upload the photo, try again.' }; }
      // The photo's average colour rides along in the row (no upload) so the feed
      // settles it over its own colour. Best-effort: without it, the neutral box.
      if (data.imageTint) row.tint = data.imageTint;
    }

    const { data: inserted, error } = await sb.from('posts').insert(row).select().single();
    if (error) return { ok: false, error: 'Couldn’t publish, try again.' };

    // Lock down the audience for a targeted post. If this write fails we undo the
    // post rather than leave it half-shared (a 'list' post with no allowlist would
    // be visible to the author only, which is confusing, not private-as-intended).
    if (targetIds.length) {
      const { error: aerr } = await sb.from('post_audience')
        .insert(targetIds.map(uid => ({ post_id: inserted.id, user_id: uid })));
      if (aerr) {
        await sb.from('posts').delete().eq('id', inserted.id);
        return { ok: false, error: 'Couldn’t set who can see it, try again.' };
      }
      const rows = targetIds.map(uid => ({ postId: inserted.id, userId: uid }));
      write('audience', a => a.filter(x => x.postId !== inserted.id).concat(rows));
    }

    const post = mapPost(inserted, nameMap());
    write('posts', ps => upsert(ps, post, x => x.id === post.id));
    return { ok: true, post };
  }

  // Pass a post along. `note` empty is a bare repost, `note` set is a quote.
  //
  // The audience is COPIED from the original and never chosen: that is the whole
  // "inherit, never widen" rule, and the insert policy enforces the same equality
  // server-side, so a hand-rolled request can't do better. One consequence worth
  // understanding before reading a bug report about it: reposting a 'circle' post
  // reaches only the INTERSECTION of your circle and theirs, because the reader
  // still has to pass can_view_original on the original. That can be nobody. It
  // is the correct answer rather than something to route around.
  async function createRepost(postId, { note, title } = {}) {
    const me = state.session;
    if (!me) return { ok: false, error: 'Sign in first.' };
    const seed = byId(state.posts).get(postId);
    const target = originalOf(seed) || seed;      // a chain collapses to its first
    if (!target) return { ok: false, error: 'That post isn’t here any more.' };
    if (!repostable(target)) return { ok: false, error: 'That post can’t be reposted.' };

    const body = String(note || '').trim();
    const head = String(title || '').trim();
    const row = {
      author: idOf(me),
      type: 'repost',
      repost_of: target.id,
      audience: target.audience || 'circle',
      tags: [],
    };
    if (body) row.note = body;
    if (head) row.title = head;

    const { data: inserted, error } = await sb.from('posts').insert(row).select().single();
    if (error) {
      // The unique index on (author, repost_of) for bare rows: a double tap, or
      // two devices. Not a failure — the repost they wanted already exists.
      if (!body && !head && /duplicate|unique/i.test(error.message || ''))
        return { ok: true, post: null };
      // The toast can only say "try again", which is the right words for a reader
      // and useless for anyone debugging. The real Postgres message is the whole
      // diagnosis — 42703 means reposts.sql hasn't run, a policy violation means
      // it has but the audience or the target is wrong — so log it, the same way
      // core() logs a failed read rather than swallowing it.
      console.warn('[tria] repost failed:', error.code || '', error.message || error);
      return { ok: false, error: 'Couldn’t repost, try again.' };
    }
    const post = mapPost(inserted, nameMap());
    write('posts', ps => upsert(ps, post, x => x.id === post.id));
    return { ok: true, post };
  }

  // Take back a BARE repost. A quote is an ordinary post of yours and comes out
  // through deletePost, from its own ••• menu, like anything else you wrote.
  async function undoRepost(postId) {
    const mine = myRepostOf(postId);
    if (!mine) return { ok: true };
    const { error } = await sb.from('posts').delete().eq('id', mine.id);
    if (error) return { ok: false, error: 'Couldn’t undo that, try again.' };
    write('posts', ps => ps.filter(p => p.id !== mine.id));
    return { ok: true };
  }

  async function deletePost(id) {
    const me = state.session;
    const i = state.posts.findIndex(p => p.id === id);
    if (i < 0 || state.posts[i].author !== me)
      return { ok: false, error: 'That post isn’t yours to delete.' };
    const { error } = await sb.from('posts').delete().eq('id', id);
    if (error) return { ok: false, error: 'Couldn’t delete, try again.' };
    // The reposts of this post go too. The DB does this itself (repost_of
    // cascades), so this is the cache catching up rather than a second policy —
    // but without it the world holds reposts pointing at nothing until the next
    // pull, and `visibleRepost` would be the only thing hiding them.
    write('posts', ps => ps.filter(p => p.repostOf !== id));
    write('posts', ps => ps.filter(p => p.id !== id));
    write('comments', cs => cs.filter(c => c.postId !== id));
    write('likes', xs => xs.filter(x => x.postId !== id));
    write('headcount', xs => xs.filter(x => x.postId !== id));
    write('pollVotes', xs => xs.filter(x => x.postId !== id));
    write('audience', xs => xs.filter(x => x.postId !== id));
    // And the pin, if this post was one. A pin at a post that no longer exists
    // draws nothing (the readers drop what they can't resolve), but leaving it
    // in the row silently spends a slot: you'd be at three pins with two cards
    // showing and no way to see which one is the ghost. Only your own posts
    // reach this function, so the pin being pruned is always your own.
    const mine = currentUser();
    if (mine && (mine.pins || []).some(e => e.k === 'post' && e.id === id))
      await setPins(mine.pins.filter(e => !(e.k === 'post' && e.id === id)));
    return { ok: true };
  }

  // Edit the TEXT of one of your own posts (title / url / note / tags). Type and
  // image are fixed. An empty value clears the field; an omitted field is left.
  async function updatePost(id, data) {
    const me = state.session;
    const i = state.posts.findIndex(p => p.id === id);
    if (i < 0 || state.posts[i].author !== me)
      return { ok: false, error: 'That post isn’t yours to edit.' };
    const patch = {};
    const COLS = { title: 'title', url: 'url', note: 'note', location: 'location',
                   eventDate: 'event_date', eventTime: 'event_time' };
    for (const k of Object.keys(COLS)) {
      if (k in data) patch[COLS[k]] = data[k] || null;
    }
    if ('tags' in data) patch.tags = data.tags || [];

    const { data: updated, error } = await sb.from('posts').update(patch).eq('id', id).select().single();
    if (error) return { ok: false, error: 'Couldn’t save, try again.' };
    const fresh = mapPost(updated, nameMap());
    // map, not upsert: if the post isn't in the world we just read it was
    // deleted somewhere else, and an edit shouldn't resurrect it.
    write('posts', ps => ps.map(p => (p.id === id ? fresh : p)));
    return { ok: true, post: fresh };
  }

  // ── Comments (async writes) ─────────────────────────────────────────────────
  const commentsFor = (postId) => rowsFor(state.comments, postId);

  async function addComment(postId, text) {
    const me = state.session;
    if (!me) return { ok: false, error: 'You need to be signed in.' };
    text = String(text || '').trim();
    if (!text) return { ok: false, error: 'Say something first.' };
    const post = state.posts.find(p => p.id === postId);
    if (!post) return { ok: false, error: 'That post no longer exists.' };
    // Comments open on a PUBLIC post to anyone who can see it — Discover only
    // builds relationships if strangers can say something. Circle/list posts stay
    // friends-only. (RLS permits the insert either way; this is the product rule.)
    if (post.author !== me && !isFriend(post.author) && post.audience !== 'public')
      return { ok: false, error: 'You can only comment on friends’ posts.' };

    const { data: c, error } = await sb.from('comments')
      .insert({ post_id: postId, author: idOf(me), body: text }).select().single();
    if (error) return { ok: false, error: 'Couldn’t post your comment, try again.' };
    const added = { id: c.id, postId, author: me, text, date: dateOf(c.created_at), _ts: c.created_at };
    write('comments', cs => upsert(cs, added, x => x.id === added.id));
    return { ok: true, comment: added };
  }

  async function deleteComment(id) {
    const me = state.session;
    const i = state.comments.findIndex(c => c.id === id);
    if (i < 0 || state.comments[i].author !== me)
      return { ok: false, error: 'That comment isn’t yours to delete.' };
    const { error } = await sb.from('comments').delete().eq('id', id);
    if (error) return { ok: false, error: 'Couldn’t delete, try again.' };
    write('comments', cs => cs.filter(c => c.id !== id));
    return { ok: true };
  }

  // ── Likes (a private signal to the author) ──────────────────────────────────
  // likesFor only ever returns what the cache holds, which RLS has already
  // filtered: for your own post that's the full set (count + who); for anyone
  // else's it's at most your own row. So likeCountFor is meaningful only to the
  // author — exactly the point.
  const likesFor = (postId) => rowsFor(state.likes, postId);
  const likeCountFor = (postId) => likesFor(postId).length;
  const likedByMe = (postId) => !!mineIn(state.likes, postId);

  // Toggle my like. You can't like your own post (the heart is the author's
  // window onto who liked, not a self-like). Open on a friend's post AND on any
  // public post — a like leaks nothing to the room either way, since RLS shows
  // the count only to the author.
  async function toggleLike(postId) {
    const me = state.session;
    if (!me) return { ok: false };
    const post = state.posts.find(p => p.id === postId);
    if (!post || post.author === me) return { ok: false };
    if (!isFriend(post.author) && post.audience !== 'public') return { ok: false };
    const mine = idOf(me);
    const has = likedByMe(postId);
    if (has) {
      const { error } = await sb.from('likes').delete().eq('post_id', postId).eq('user_id', mine);
      if (error) return { ok: false };
      write('likes', xs => xs.filter(x => !(x.postId === postId && x.user === me)));
    } else {
      const { error } = await sb.from('likes').insert({ post_id: postId, user_id: mine });
      if (error && !/duplicate|unique/i.test(error.message)) return { ok: false };
      const row = { postId, user: me, _ts: new Date().toISOString() };
      write('likes', xs => upsert(xs, row, x => x.postId === postId && x.user === me));
    }
    return { ok: true, liked: !has };
  }

  // ── Headcount (who's in, on an activity) ────────────────────────────────────
  // The public counterpart to likes: every row is readable, so anyone who can
  // see the activity sees the count and the names. You can raise or lower only
  // your own hand, and — like commenting — it's a friends-only gesture. The
  // author hosts rather than RSVPs, so their own hand stays out of the list.
  const headcountFor = (postId) => rowsFor(state.headcount, postId);
  const goingByMe = (postId) => !!mineIn(state.headcount, postId);

  // The one gesture deliberately NOT opened to public posts (likes, comments and
  // poll votes all were): a public activity carries a place and a time, and
  // joining it is a real-world act, not a signal. Anyone may SEE a public
  // activity; only the circle shows up to it.
  async function toggleGoing(postId) {
    const me = state.session;
    if (!me) return { ok: false };
    const post = state.posts.find(p => p.id === postId);
    if (!post || post.author === me || !isFriend(post.author)) return { ok: false };
    const mine = idOf(me);
    const has = goingByMe(postId);
    if (has) {
      const { error } = await sb.from('headcount').delete().eq('post_id', postId).eq('user_id', mine);
      if (error) return { ok: false };
      write('headcount', xs => xs.filter(x => !(x.postId === postId && x.user === me)));
    } else {
      const { error } = await sb.from('headcount').insert({ post_id: postId, user_id: mine });
      if (error && !/duplicate|unique/i.test(error.message)) return { ok: false };
      const row = { postId, user: me, _ts: new Date().toISOString() };
      write('headcount', xs => upsert(xs, row, x => x.postId === postId && x.user === me));
    }
    return { ok: true, going: !has };
  }

  // ── Polls ────────────────────────────────────────────────────────────────────
  // A poll's choices live on the post (post.poll = { q, options[] }); the votes
  // live in state.pollVotes, public like headcount. A poll closes 24h after it's
  // posted — closedAt is the single source of truth, mirrored by the RLS write
  // guard so a closed poll rejects votes at the database too.
  const POLL_MS = 24 * 60 * 60 * 1000;
  const pollClosesAt = (post) => new Date(new Date(post._ts).getTime() + POLL_MS);
  const pollClosed = (post) => Date.now() >= pollClosesAt(post).getTime();
  const pollVotesFor = (postId) => rowsFor(state.pollVotes, postId);
  // My choice on a poll, or null if I haven't voted.
  function myPollVote(postId) {
    const v = mineIn(state.pollVotes, postId);
    return v ? v.choice : null;
  }

  // Cast or change my vote. Single-select: upsert on (post_id, user_id) so a
  // second pick overwrites the first. Blocked once the poll has closed (the RLS
  // guard is the real fence; this is the fast local one). Unlike RSVPs, the
  // author may vote in their own poll.
  async function votePoll(postId, choice) {
    const me = state.session;
    if (!me) return { ok: false };
    const post = state.posts.find(p => p.id === postId);
    if (!post || post.type !== 'poll') return { ok: false };
    // Voting sits with likes and comments, not with RSVPs: a poll made public is
    // asking the wider room, so anyone who can see it can answer it. A circle
    // poll stays friends-only. Unlike an RSVP, the author may vote in their own.
    if (post.author !== me && !isFriend(post.author) && post.audience !== 'public')
      return { ok: false };
    const n = (post.poll && post.poll.options || []).length;
    if (!(choice >= 0 && choice < n)) return { ok: false };
    if (pollClosed(post)) return { ok: false, error: 'This poll has closed.' };
    const mine = idOf(me);
    const { error } = await sb.from('poll_votes')
      .upsert({ post_id: postId, user_id: mine, choice }, { onConflict: 'post_id,user_id' });
    if (error) return { ok: false };
    // One row per voter, so changing a vote and casting one are the same write.
    const row = { postId, user: me, choice, _ts: new Date().toISOString() };
    write('pollVotes', xs => upsert(xs, row, x => x.postId === postId && x.user === me));
    return { ok: true };
  }

  // ── Notifications (derived, no table) ───────────────────────────────────────
  // Everything notification-worthy is already in the cache: comments, likes and
  // hands-up on MY posts (RLS hands the author every like row on their own
  // posts, and the rest is world-readable). So the tab is a pure read — newest
  // first — with no extra storage and nothing to mark, sync or badge.
  function notifications() {
    const me = state.session;
    if (!me) return [];
    const mine = new Set(state.posts.filter(p => p.author === me).map(p => p.id));
    const evts = [];
    // "@me" in someone's text counts as a mention only when it would render as
    // one (same rule as the app's richText: the author must be my friend).
    const mentionRe = new RegExp(`(^|[^\\w@])@${me}\\b`);
    const mentionsMe = (text, author) =>
      author !== me && mentionRe.test(text || '') && areFriends(author, me);
    for (const c of state.comments) {
      if (mine.has(c.postId) && c.author !== me)
        evts.push({ kind: 'comment', postId: c.postId, user: c.author, text: c.text, _ts: c._ts || '' });
      else if (mentionsMe(c.text, c.author))
        evts.push({ kind: 'mention', postId: c.postId, user: c.author, text: c.text, _ts: c._ts || '' });
    }
    for (const p of state.posts)
      if (mentionsMe(p.note, p.author))
        evts.push({ kind: 'mention', postId: p.id, user: p.author, text: p.note, _ts: p._ts || '' });
    for (const l of state.likes)
      if (mine.has(l.postId) && l.user !== me)
        evts.push({ kind: 'like', postId: l.postId, user: l.user, _ts: l._ts || '' });
    for (const h of state.headcount)
      if (mine.has(h.postId) && h.user !== me)
        evts.push({ kind: 'going', postId: h.postId, user: h.user, _ts: h._ts || '' });
    // Poll votes on MY polls (public like headcount). Updates-only, no push —
    // a vote is quieter than a comment, so it lands in the ledger but never
    // buzzes a device.
    for (const v of state.pollVotes)
      if (mine.has(v.postId) && v.user !== me)
        evts.push({ kind: 'vote', postId: v.postId, user: v.user, _ts: v._ts || '' });
    // Someone passed one of my posts along. The event is filed against the
    // ORIGINAL, not against their repost row, so tapping it spotlights my own
    // post on my own profile the way a like or a comment does. A quote reads the
    // same in the ledger and carries its sentence, the way a comment does.
    for (const p of state.posts)
      if (p.repostOf && mine.has(p.repostOf) && p.author !== me)
        evts.push({ kind: 'repost', postId: p.repostOf, user: p.author,
                    text: p.note || '', _ts: p._ts || '' });
    // Someone adding you is news, and news belongs in the ledger — dated, ageing
    // down the list like everything else here. It used to be drawn as a standing
    // row pinned above this list with an "Add back" button on it, which never
    // left: on a public account, where nothing is pending and there is nothing to
    // answer, that put a permanent chore on the page for the crime of being
    // followed. Three things stay out:
    //   · a PENDING request (private account, waiting on my answer) — it's still
    //     pinned above with Accept / Ignore, and one event mustn't sit in two
    //     places at once. It files itself here once it's settled.
    //   · anyone I've DECLINED, forever, however often they re-add me.
    //   · an edge with no stamp — every row that predates friend-declines.sql.
    //     Announcing history nobody was told about at the time would dump your
    //     whole circle at the top of Updates the day the migration ran.
    // Adding someone back does NOT retract their row: a ledger is a record, and a
    // line that deletes itself the moment you answer it is the pinned-forever bug
    // wearing the opposite coat.
    const pending = new Set(requestsReceived());
    const turnedDown = new Set(declined());
    for (const u of Object.keys(state.friends)) {
      if (u === me || pending.has(u) || turnedDown.has(u)) continue;
      const theirs = edgeTs(u, me);
      if (!theirs) continue;
      // `back` when THEY were the one answering — their edge is the later of the
      // pair. It is only a wording difference, so it rides on the event rather
      // than being re-derived in the view.
      const ours = edgeTs(me, u);
      evts.push({ kind: 'follow', user: u, back: !!ours && theirs > ours, _ts: theirs });
    }
    return evts.sort((a, b) => (a._ts < b._ts ? 1 : a._ts > b._ts ? -1 : 0));
  }

  // ── Profile (async writes) ──────────────────────────────────────────────────
  // Edit my row in the cache. Goes through write() like every other cache change
  // (see the top of the file), so an edit made while a load is in flight isn't
  // overwritten by the version of me that load started out reading. A key set to
  // null is removed, because that's how the mappers spell "no avatar".
  const patchUser = (id, patch) => write('users', us => us.map(x => {
    if (x.id !== id) return x;
    const o = Object.assign({}, x, patch);
    for (const k of Object.keys(patch)) if (o[k] == null) delete o[k];
    return o;
  }));

  // Set (or clear) the signed-in user's avatar — a cropped square that gets
  // uploaded to Storage (see uploadImage), or null to fall back to the initial tile.
  // Optimistic: the cache is updated to the local crop synchronously (before the
  // first await), so a caller can re-render and show the new photo instantly while
  // the upload + save happen in the background. On any failure we revert the cache.
  async function updateAvatar(dataURI) {
    const u = currentUser();
    if (!u) return { ok: false, error: 'You need to be signed in.' };
    const id = u.id;
    const prev = u.avatar || null;
    patchUser(id, { avatar: dataURI || null });               // optimistic, synchronous
    const revert = () => patchUser(id, { avatar: prev });

    let url = null;
    if (dataURI) {
      try { url = await uploadImage(dataURI, 'avatar'); }
      catch { revert(); return { ok: false, error: 'Couldn’t upload, try again.' }; }
    }
    const { error } = await sb.from('users').update({ avatar: url }).eq('id', id);
    if (error) { revert(); return { ok: false, error: 'Couldn’t save your photo.' }; }
    patchUser(id, { avatar: url });
    return { ok: true };
  }

  // The profile's colour: a palette slug, 'default' for the brand ramp, 'none'
  // for deliberately off, or null for "sample it from my photo". Optimistic and synchronous before the first
  // await, like updateAvatar, so the card can repaint under the picker while the
  // save goes out — the whole point of the picker is watching the colour land.
  //
  // A missing column is NOT an error here. Until profile-accent.sql is run the
  // choice lives only in the device mirror, which means you see your own colour
  // and nobody else does; that is a thinner feature, not a broken one, and it
  // must not surface as "couldn't save". Every other failure reverts both.
  async function updateAccent(accent) {
    const u = currentUser();
    if (!u) return { ok: false, error: 'You need to be signed in.' };
    const id = u.id;
    const prev = u.accent || null;
    accent = accent || null;
    patchUser(id, { accent });                            // optimistic, synchronous
    setLocalAccent(id, accent);

    const { error } = await sb.from('users').update({ accent }).eq('id', id);
    if (!error) return { ok: true };
    if (/accent|column|schema/i.test(error.message || '')) return { ok: true, local: true };
    patchUser(id, { accent: prev });
    setLocalAccent(id, prev);
    return { ok: false, error: 'Couldn\u2019t save your colour.' };
  }

  /* Set (or clear, with null) the signed-in user's song. Optimistic and
     synchronous before the first await, like updateAvatar and updateAccent, so
     the rail repaints under the sheet while the save goes out.

     Everything is normalized rather than trusted. Most of the time these keys
     come straight off a search result, but the paste path is a person typing
     into a box, and this is the LAST place a URL is ours before it becomes
     something every other reader's page loads (`art`) and opens (`url`). So
     both are https-only: that rules out `javascript:` and `data:` in one test
     rather than blacklisting schemes one at a time, and http would be a mixed-
     content image that silently fails to load anyway. */
  const clip = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
  const httpsOnly = (v) => (/^https:\/\//i.test(v || '') ? String(v).slice(0, 500) : '');

  /* One song, cleaned. Shared by the status (`listening_to`) and by a song PIN,
     which store the same object for the same reason: both are metadata that
     arrived from a search result or from a person pasting a link into a box,
     and both end up as an image every other reader's page loads (`art`) and a
     URL every other reader opens. So both links are https-only, which rules out
     `javascript:` and `data:` in one test rather than blacklisting schemes one
     at a time — and http would be a mixed-content image that silently fails to
     load anyway.

     Keys are added only when they have something in them, so the stored object
     never carries an empty string the readers would have to retest. Null when
     there is no title, because a song with no name is not a song. */
  function cleanSong(song) {
    if (!song) return null;
    const title = clip(song.title, 120);
    if (!title) return null;
    const o = { title };
    const artist = clip(song.artist, 120);
    const art = httpsOnly(song.art);
    // One key per service rather than one `url`, so a reader on the other one
    // can be sent somewhere useful. Usually only one of the two is known: a
    // search knows Apple's copy, a pasted link knows whichever was pasted.
    const apple = httpsOnly(song.apple);
    const spotify = httpsOnly(song.spotify);
    if (artist) o.artist = artist;
    if (art) o.art = art;
    if (apple) o.apple = apple;
    if (spotify) o.spotify = spotify;
    return o;
  }

  async function setListeningTo(song) {
    const u = currentUser();
    if (!u) return { ok: false, error: 'You need to be signed in.' };
    const id = u.id;
    const prev = u.listening || null;
    const clean = cleanSong(song);
    if (song && !clean) return { ok: false, error: 'That song needs a name.' };
    // `at` is the status's own key and a pin never carries one: this is a claim
    // about right now, and it has to be able to stop being true (freshSong).
    const value = clean ? { ...clean, at: new Date().toISOString() } : null;

    patchUser(id, { listening: value });                  // optimistic, synchronous
    const { error } = await sb.from('users').update({ listening_to: value }).eq('id', id);
    if (error) {
      patchUser(id, { listening: prev });
      // A DB that hasn't run add-listening-to.sql says so in its own words —
      // "couldn't save" would send someone looking at their network instead.
      return { ok: false, error: /listening|column|schema/i.test(error.message || '')
        ? 'Listening to isn’t set up on this server yet.'
        : 'Couldn’t save that, try again.' };
    }
    return { ok: true };
  }

  /* Replace the whole pin list, in order. One write for every act the feature
     has — pin, unpin, reorder, swap — because the list IS the order and half of
     a reorder is a worse state than none of it. Optimistic and synchronous
     before the first await, like every other profile writer here, so the cards
     move under your finger while the save goes out.

     WHAT IT WILL NOT STORE: a post that isn't yours (a pin is a thing you do
     with your own work, and RLS would let you point at anything readable), a
     post that isn't in the world any more, the same post twice (three slots
     holding one card is a bug the reader can't undo without help), and anything
     past the third slot. A song is cleaned by cleanSong above, exactly as the
     listening status is.

     The validation is per-entry and SILENT: a bad one is dropped and the rest
     are saved. The alternative — refusing the whole list because one id went
     stale — would mean a reorder failing outright because a post you pinned
     last week was deleted this morning. */
  async function setPins(list) {
    const u = currentUser();
    if (!u) return { ok: false, error: 'You need to be signed in.' };
    const id = u.id;
    const prev = u.pins || null;
    const clean = [];
    for (const e of (Array.isArray(list) ? list : [])) {
      if (!e) continue;
      if (e.k === 'post') {
        const post = state.posts.find(p => p.id === e.id);
        if (!post || post.author !== state.session) continue;
        if (clean.some(x => x.k === 'post' && x.id === e.id)) continue;
        clean.push({ k: 'post', id: String(e.id) });
      } else if (e.k === 'song') {
        const song = cleanSong(e);
        if (song) clean.push({ k: 'song', ...song });
      }
      if (clean.length === PIN_MAX) break;
    }
    // An empty list is null and not [], so "no pins" is one value in the column
    // rather than two the readers would both have to know about.
    const value = clean.length ? clean : null;

    patchUser(id, { pins: value });                       // optimistic, synchronous
    const { error } = await sb.from('users').update({ pinned: value }).eq('id', id);
    if (error) {
      patchUser(id, { pins: prev });
      // A DB that hasn't run add-pins.sql says so in its own words, the same way
      // the listening status does — "couldn't save" would send someone looking
      // at their network instead of at their migrations.
      return { ok: false, error: /pinned|column|schema/i.test(error.message || '')
        ? 'Pinned cards aren\u2019t set up on this server yet.'
        : 'Couldn\u2019t save that, try again.' };
    }
    return { ok: true };
  }

  async function updateProfile({ name, bio, pronouns, isPrivate } = {}) {
    const u = currentUser();
    if (!u) return { ok: false, error: 'You need to be signed in.' };
    name = (name || '').trim();
    bio = (bio || '').trim();
    pronouns = (pronouns || '').trim();
    if (!name) return { ok: false, error: 'Add a display name.' };
    if (name.length > 40) return { ok: false, error: 'Name: keep it under 40 characters.' };
    if (bio.length > 160) return { ok: false, error: 'Bio: keep it under 160 characters.' };
    // Empty means "nothing shown", which is null, not '' — matches the column's
    // own default and mapUser's `if (u.pronouns)` read.
    const patch = { name, bio, pronouns: pronouns || null };
    if (typeof isPrivate === 'boolean') patch.private = isPrivate;
    let { error } = await sb.from('users').update(patch).eq('id', u.id);
    // Tolerate a DB that hasn't run the privacy/pronouns migrations yet: those
    // columns may not exist, so retry the rest of the save without them rather
    // than failing the whole edit. (The UI still reflects the change until reload.)
    if (error && 'private' in patch && /private|column|schema/i.test(error.message || '')) {
      delete patch.private;
      ({ error } = await sb.from('users').update(patch).eq('id', u.id));
    }
    if (error && 'pronouns' in patch && /pronouns|column|schema/i.test(error.message || '')) {
      delete patch.pronouns;
      ({ error } = await sb.from('users').update(patch).eq('id', u.id));
    }
    if (error) return { ok: false, error: 'Couldn’t save your changes.' };
    patchUser(u.id, patch);
    return { ok: true };
  }

  // ── Push notifications ───────────────────────────────────────────────────────
  // TWO TRANSPORTS, ONE SWITCH. The web subscribes through a service worker with
  // the VAPID key (Web Push); the App Store build registers with APNs instead,
  // because a WKWebView has no PushManager at all — the Push API on iOS is
  // Safari-and-home-screen-only, so in the app the web path isn't degraded, it
  // is simply absent. That's the whole reason push went quiet in the app: nothing
  // broke, `pushSupported()` just answered false and every piece of push UI
  // correctly hid itself.
  //
  // Only the ADDRESS differs. The pre-prompt card, the profile toggle, the
  // Edge Function's fan-out and the `push_subscriptions` table are all shared, and
  // an APNs row is an ordinary row: `endpoint = 'apns:<hex device token>'` with
  // empty keys. That prefix is doing the work a `platform` column would, which is
  // why this needed no migration — the sender branches on it and the RLS,
  // uniqueness and per-user index it already had all still mean the right thing.
  //
  // The permission prompt must come from a tap on both sides (iOS gives one shot
  // and a "no" is permanent), which is what the soft pre-prompt exists to protect.

  // The App Store build. Capacitor injects its bridge before any app JS runs, so
  // the bridge itself is the tell — same predicate as app.js's `nativeShell()`,
  // duplicated rather than shared because store.js loads first and knows nothing
  // about the view layer.
  const nativeShell = () => !!window.Capacitor?.toNative;
  // No build step, so no `registerPlugin` wrapper (it's an ES module) — the raw
  // bridge instead, exactly as app.js does for Haptics. Push needs answers back,
  // though, so it's `nativePromise` for calls and `nativeCallback` for events,
  // not the fire-and-forget `toNative`.
  const capPush = (method, options) =>
    window.Capacitor.nativePromise('PushNotifications', method, options || {});
  const onPush = (eventName, fn) => {
    try { window.Capacitor.nativeCallback('PushNotifications', 'addListener', { eventName }, fn); }
    catch { /* older bridge; the listener just never fires */ }
  };
  // EVERY await that crosses the bridge gets an end, and that rule is the whole
  // lesson of the "Turning on…" that never changed back. A native call which
  // simply never answers is indistinguishable from a slow one, and the push UI
  // is made of controls that have already relabelled or disabled themselves by
  // the time they start waiting. Bounding only the FIRST await was not enough —
  // it fell back to an unbounded read, which then hung in its place.
  const capPushIn = (method, ms) => Promise.race([
    capPush(method),
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)),
  ]);
  // The OS permission read, which every path here starts from. Short bound: it's
  // a local UNUserNotificationCenter lookup with no network in it, so anything
  // slower than this is wedged rather than busy.
  //
  // Two bounds, and the shorter one is the one that gates the SPLASH. pushPrime
  // is awaited by init, so on a wedged bridge its timeout is time the reader
  // spends looking at the boot screen — measured at 4.2s when both used the same
  // value, which is a hang by any other name. It can also afford to give up
  // soonest: its fallback ('prompt') is the correct assumption on a first launch
  // and the only cost of being wrong is one pre-prompt card. The interactive
  // reads happen behind a control that has already disabled itself, where
  // waiting is legible, so they keep the longer bound.
  const PERM_READ_WAIT = 4000;
  const PERM_PRIME_WAIT = 2000;
  async function readPerm(ms = PERM_READ_WAIT) {
    try { return (await capPushIn('checkPermissions', ms))?.receive || ''; }
    catch { return ''; }
  }

  // Last known OS permission in the native shell, primed at boot. The web reads
  // `Notification.permission` synchronously and the push UI is built
  // synchronously, so the native side has to keep a cached answer to match —
  // there is no sync read of UNUserNotificationCenter. Null means "not asked yet",
  // which reads as 'default' and is the truth on a first launch anyway.
  let nativePerm = null;
  // The APNs token this device last handed us, so `disablePush` knows which row
  // to drop and a re-launch can tell a rotated token from an unchanged one.
  const APNS_KEY = 'tria:apns-token';

  function pushSupported() {
    if (nativeShell()) return true;
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }

  // Is push actually ARMED on this device — permitted AND holding an address we
  // have saved? Synchronous, because both the pre-prompt card and the profile
  // switch render synchronously and a control that paints the wrong state and
  // corrects itself a moment later is its own bug report. Permission alone was
  // the old guess and it is not the same question: turning notifications off
  // leaves the OS permission granted on purpose (see disablePush), so a switch
  // reading permission painted itself back ON the moment you reopened the modal.
  //
  // The web can't answer the second half synchronously — a live PushManager
  // subscription is an async read — so it keeps a mirror of the same fact in the
  // same key, written wherever the subscription is written.
  function pushArmed() {
    return pushPermission() === 'granted' && !!localStorage.getItem(APNS_KEY);
  }

  // Read the OS permission into the cache the push UI renders from. Awaited by
  // init() BEFORE the first route, because until it lands `nativePerm` is null,
  // which reads as 'default', which is the one value that means "we have never
  // asked" — so a fully subscribed user got the "Stay in the loop" pre-prompt on
  // Updates, and nothing re-rendered when the real answer arrived, so it sat
  // there for the whole session. Bounded and swallowed: a boot must not wait on
  // the bridge, and 'prompt' is the right thing to assume if it won't answer.
  async function pushPrime() {
    if (!nativeShell()) return;
    nativePerm = (await readPerm(PERM_PRIME_WAIT)) || 'prompt';
  }

  // Everything Tria has already delivered, cleared out of Notification Center.
  // Called when Updates is opened: the ledger on screen is the same news, and a
  // shade still holding a week of read notifications is the badge this app
  // deliberately doesn't set, arriving by another route. Native-only and
  // failure-tolerant — the plugin rejects this until the APNs registration
  // callback has fired at least once, which is a normal state on a device that
  // has never turned push on.
  async function clearDelivered() {
    // Gated on pushArmed() rather than just the shell, and the gate is exact
    // rather than tidy: the plugin rejects this call until the APNs registration
    // callback has fired at least once in this launch, which happens in
    // pushResume — and pushResume runs on precisely the condition below. So off
    // that condition the call cannot succeed, and ungated it was one guaranteed
    // rejection (logged by Capacitor's own bridge, twice) on every single visit
    // to Updates by everyone who doesn't have push on.
    if (!nativeShell() || !pushArmed()) return;
    try { await capPushIn('removeAllDeliveredNotifications', 4000); } catch { /* nothing to clear */ }
  }

  // Hand the reader to Tria's own page in iOS Settings, resolving true only if
  // the OS actually took the hand-off. This is the escape hatch from the one
  // permanent push state: `requestAuthorization` is a ONE-SHOT per install, so a
  // "Don't Allow" (or a later switch-off in Settings) can never be undone from
  // inside the app — `requestPermissions` just resolves 'denied' with no prompt,
  // forever. Without a route out, the profile's Notifications switch is a
  // control that visibly does nothing, which is the same class of bug as the
  // inert `target="_blank"` link.
  //
  // Native only, and it has to be: `location.href = 'app-settings:'` is
  // completely inert in the webview and @capacitor/browser takes web URLs only.
  // `TriaSettings` is Tria's own one-method plugin, registered from
  // `TriaViewController.capacitorDidLoad`. False on the web, where a browser's
  // permission is re-askable from site settings the reader already knows.
  async function openAppSettings() {
    if (!nativeShell()) return false;
    try {
      await window.Capacitor.nativePromise('TriaSettings', 'openSettings', {});
      return true;
    } catch { return false; }
  }

  // Permission as the three words the web uses, whichever shell we're in. The
  // push UI is rendered synchronously and can't await, and reaching for
  // `Notification.permission` directly in the app would throw — there is no
  // `Notification` in a WKWebView.
  function pushPermission() {
    if (nativeShell()) return nativePerm === 'granted' ? 'granted'
      : nativePerm === 'denied' ? 'denied' : 'default';
    return typeof Notification !== 'undefined' ? Notification.permission : 'denied';
  }

  // Ask the OS for the token and resolve with it. `register()` resolves the
  // instant it has *asked*; the token arrives later on the `registration` event,
  // so the listener has to be in place before the call. A device with no network
  // can leave both events unfired, hence the timeout — a hung promise here would
  // hang the "Turning on…" button forever.
  //
  // The two events are wired ONCE, at module scope, and handed to whoever is
  // currently waiting. They used to be registered inside this function, which
  // meant a fresh pair of permanent bridge callbacks on every launch and every
  // tap of the switch: Capacitor keeps an `addListener` call alive for the life
  // of the webview and nothing here ever removed one, so the list only grew.
  let tokenWaiter = null;
  let pushWired = false;
  function wirePushEvents() {
    if (pushWired || !nativeShell()) return;
    pushWired = true;
    onPush('registration', (d) => {
      const w = tokenWaiter; tokenWaiter = null; w?.resolve(d && d.value);
    });
    onPush('registrationError', (d) => {
      console.warn('[tria push] APNs refused to register:', JSON.stringify(d || {}));
      const w = tokenWaiter; tokenWaiter = null; w?.reject(new Error('apns'));
    });
  }

  function apnsToken() {
    wirePushEvents();
    return new Promise((resolve, reject) => {
      let done = false;
      // Only ever clear the waiter if it's still OURS — a later call may have
      // installed its own before this one's timeout fires, and stealing that
      // slot would strand the request that is actually in flight.
      const mine = {};
      const settle = (fn, v) => {
        if (done) return;
        done = true;
        if (tokenWaiter === mine) tokenWaiter = null;
        fn(v);
      };
      mine.resolve = (v) => settle(resolve, v);
      mine.reject = (e) => settle(reject, e);
      tokenWaiter = mine;
      setTimeout(() => {
        if (!done) console.warn('[tria push] no APNs token after 12s');
        settle(reject, new Error('timeout'));
      }, 12000);
      capPush('register').catch(() => settle(reject, new Error('register')));
    });
  }

  // Ask the OS for permission, and always come back with an answer.
  //
  // `requestPermissions` resolves ONLY when the system alert is answered, so on
  // its own it is an unbounded await — the same hung promise `apnsToken` is
  // already guarded against, one step earlier in the same function, and the
  // guard was never carried back here. There are real states where the answer
  // never arrives: backgrounding the app while the alert is up leaves the
  // completion unfired, and every later request made while that first one is
  // still outstanding goes the same way. That is what strands the switch on
  // "Turning on…" with no toast, no sheet and no way back, and why the profile
  // toggle goes dead in the same session — it is issuing a second request behind
  // the first one's ghost.
  //
  // So bound the wait, then don't guess what happened: `checkPermissions` reads
  // the state the OS actually holds, which answers correctly even when the alert
  // WAS answered and only its callback went missing.
  //
  // TWO bounds, and the second one is the fix to the fix. The first version of
  // this bounded `requestPermissions` and then fell back to a BARE
  // `checkPermissions` — another unbounded bridge await, on the exact path taken
  // when the bridge has just proved it can leave a call unanswered. So the dead
  // end came straight back, 60 seconds later. The recovery read is bounded too
  // now (`readPerm`), and an empty answer from both is reported as "no answer"
  // rather than silently becoming a denial.
  //
  // 20s, not 60. While the alert is up the button underneath it is invisible, so
  // the bound only ever costs the width of a dead end — but a minute of a button
  // reading "Turning on…" is not a bound anyone experiences as one, and nobody
  // takes twenty seconds to answer an alert they are looking at.
  const PERM_WAIT = 20000;
  async function requestPerm() {
    let perm = '';
    try {
      perm = await Promise.race([
        capPush('requestPermissions').then((r) => r?.receive || ''),
        new Promise((res) => setTimeout(() => res(''), PERM_WAIT)),
      ]);
    } catch { perm = ''; }
    if (perm) return perm;
    console.warn('[tria push] the permission alert was never answered; reading the OS state instead');
    return await readPerm();
  }

  // The last place this path can hang. A bare network call has no timeout of its
  // own, and it is awaited by a button that has already relabelled itself, so
  // silence here reads exactly like the bug above. A rejection was always
  // handled; now the wait has an end too.
  const SAVE_WAIT = 15000;
  const withWait = (thenable, ms) => Promise.race([
    thenable,
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)),
  ]);

  // Save this device's address against the signed-in user, THROUGH AN RPC,
  // because a plain upsert could not move a device between accounts.
  //
  // `endpoint` is unique (it's the device's mailbox), so the second account to
  // sign in on one phone always collides. `upsert(onConflict: 'endpoint')` is an
  // INSERT ... ON CONFLICT DO UPDATE, and Postgres checks the UPDATE policy's
  // USING clause against the EXISTING row — which still said `user_id` = the
  // account that signed out. So the write was rejected, and the DELETE policy is
  // gated identically, so the new user couldn't clear the row either. The old
  // account went on receiving notifications on a phone that was no longer theirs
  // and the new one could never register, from a warning in a console nobody was
  // reading. `claim_push_endpoint` is SECURITY DEFINER and takes the user from
  // auth.uid(), so the handover is possible and is still only ever to yourself
  // (supabase/push-endpoint-handover.sql).
  //
  // Falls back to the old upsert if the function isn't there yet (PGRST202) —
  // same tolerance every other migration in this client gets, and on a database
  // that hasn't run it the upsert is exactly as good as it ever was: fine until
  // the day someone switches accounts.
  async function saveEndpoint(row) {
    try {
      const { error } = await withWait(
        sb.rpc('claim_push_endpoint', {
          p_endpoint: row.endpoint, p_p256dh: row.p256dh || '', p_auth: row.auth || '',
        }), SAVE_WAIT);
      if (error && error.code === 'PGRST202') {
        console.warn('[tria push] claim_push_endpoint is missing; falling back to upsert. Run supabase/push-endpoint-handover.sql.');
        const { error: upErr } = await withWait(
          sb.from('push_subscriptions').upsert(row, { onConflict: 'endpoint' }), SAVE_WAIT);
        if (upErr) console.warn('[tria push] the subscription did not save:', upErr.message || upErr);
        return !upErr;
      }
      if (error) console.warn('[tria push] the subscription did not save:', error.message || error);
      return !error;
    } catch {
      console.warn('[tria push] saving the subscription timed out');
      return false;
    }
  }

  // Give this device's address back — the row goes, the OS permission and the
  // local "push is on" marker stay. Signing out has to do this: the row is the
  // ONLY thing the sender consults, so leaving it behind means the account that
  // just signed out keeps getting its comments read out on a phone somebody else
  // is now holding. It runs while still authenticated, so the ordinary DELETE
  // policy covers it and no RPC is needed.
  async function releaseEndpoint() {
    if (!isAuthed()) return;
    const endpoint = nativeShell()
      ? (localStorage.getItem(APNS_KEY) ? 'apns:' + localStorage.getItem(APNS_KEY) : '')
      : await webEndpoint();
    if (!endpoint) return;
    try { await withWait(sb.from('push_subscriptions').delete().eq('endpoint', endpoint), SAVE_WAIT); }
    catch { /* the sender prunes an unreachable address on its next send */ }
  }

  // This browser's Web Push address, if it still holds a live subscription.
  async function webEndpoint() {
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      const sub = reg && await reg.pushManager.getSubscription();
      return sub ? sub.endpoint : '';
    } catch { return ''; }
  }

  // Boot work for the native shell: learn the permission state, and if push is
  // already on, re-register. APNs tokens ROTATE (a restore from backup, a
  // reinstall, occasionally an OS update), and a rotated token fails silently —
  // the old row stays, Apple returns Unregistered, and notifications just stop
  // with nothing anywhere to say why. So every launch re-reads the token and
  // re-upserts it, dropping the previous row if it changed.
  //
  // Called on every launch AND on every sign-in, which is the second half of the
  // same bug releaseEndpoint fixes. It used to run once, at boot, behind a
  // `currentUser()` check — so someone who signed in during a session never had
  // their device registered at all, and the row on that phone went on pointing
  // at whoever used it last until the next cold launch. Signing out now hands
  // the address back and signing in claims it, so the pair always names the
  // person actually holding the phone.
  async function pushResume() {
    const u = currentUser();
    if (!u) return;
    // Resume only what was already ON. Turning push off leaves the OS permission
    // granted (see disablePush) and only drops the row, so "granted" alone is not
    // consent — without this the next launch would quietly re-subscribe a device
    // whose owner had just switched it off.
    const had = localStorage.getItem(APNS_KEY) || '';
    if (!had) return;

    if (!nativeShell()) {
      // The web keeps its PushManager subscription across a sign-out; only the
      // row went. Re-point it at whoever is signed in now.
      if (pushPermission() !== 'granted') return;
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = reg && await reg.pushManager.getSubscription();
        if (!sub) return;
        const j = sub.toJSON();
        await saveEndpoint({ user_id: u.id, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth });
      } catch { /* the subscription is gone; the switch will say so */ }
      return;
    }

    if (nativePerm !== 'granted') return;
    try {
      const token = await apnsToken();
      if (!token) return;
      if (await saveEndpoint({ user_id: u.id, endpoint: 'apns:' + token, p256dh: '', auth: '' })) {
        localStorage.setItem(APNS_KEY, token);
        if (had && had !== token)
          await sb.from('push_subscriptions').delete().eq('endpoint', 'apns:' + had);
      }
    } catch { /* no token this launch; the stored row keeps working or gets pruned */ }
  }

  // VAPID public key is base64url; PushManager wants the raw bytes.
  function vapidKeyBytes(base64) {
    const pad = '='.repeat((4 - (base64.length % 4)) % 4);
    const b64 = (base64 + pad).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(b64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  async function swRegistration() {
    const existing = await navigator.serviceWorker.getRegistration();
    return existing || navigator.serviceWorker.register('sw.js');
  }

  // Is THIS device currently subscribed and still permitted?
  async function pushSubscribed() {
    if (!pushSupported()) return false;
    if (nativeShell()) {
      nativePerm = (await readPerm()) || nativePerm || 'prompt';
      return nativePerm === 'granted' && !!localStorage.getItem(APNS_KEY);
    }
    if (Notification.permission !== 'granted') return false;
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const on = !!(reg && await reg.pushManager.getSubscription());
      // Keep the sync mirror honest — pushArmed() renders off it.
      if (on) localStorage.setItem(APNS_KEY, 'web');
      else localStorage.removeItem(APNS_KEY);
      return on;
    } catch { return false; }
  }

  // Turn ON. Must be called from a user gesture — both platforms raise the OS
  // prompt only then, and on iOS a decline is permanent. Asks permission, gets
  // this device's address, stores it against the signed-in user.
  async function enablePush() {
    const u = currentUser();
    if (!u) return { ok: false, error: 'You need to be signed in.' };
    if (!pushSupported()) return { ok: false, error: 'This device can’t do notifications.' };

    if (nativeShell()) {
      const perm = await requestPerm();
      // An empty answer means the OS never told us, which is NOT a denial —
      // writing 'denied' into the cache there would hide the pre-prompt card for
      // good on a device that has simply not been asked yet.
      if (perm === 'granted' || perm === 'denied') nativePerm = perm;
      if (perm !== 'granted') {
        console.warn('[tria push] permission not granted:', perm || '(no answer)');
        return {
          ok: false,
          blocked: perm === 'denied',
          error: perm === 'denied'
            ? 'Notifications are off. You can turn them on in your settings.'
            : 'Notifications didn’t turn on. Try again in a moment.',
        };
      }

      let token;
      try { token = await apnsToken(); }
      catch { return { ok: false, error: 'Couldn’t set up notifications on this device.' }; }
      if (!token) return { ok: false, error: 'Couldn’t set up notifications on this device.' };

      if (!(await saveEndpoint({ user_id: u.id, endpoint: 'apns:' + token, p256dh: '', auth: '' })))
        return { ok: false, error: 'Couldn’t save your notification settings.' };
      localStorage.setItem(APNS_KEY, token);
      return { ok: true };
    }

    const key = (window.TRIA_CONFIG || {}).vapidPublicKey;
    if (!key) return { ok: false, error: 'Notifications aren’t set up yet.' };

    let perm;
    try { perm = await Notification.requestPermission(); }
    catch { return { ok: false, error: 'Couldn’t reach notification settings.' }; }
    if (perm !== 'granted')
      return { ok: false, error: 'Notifications are off. You can turn them on in your settings.', blocked: perm === 'denied' };

    let sub;
    try {
      const reg = await swRegistration();
      await navigator.serviceWorker.ready;
      sub = await reg.pushManager.getSubscription()
        || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKeyBytes(key) });
    } catch { return { ok: false, error: 'Couldn’t set up notifications on this device.' }; }

    const j = sub.toJSON();
    if (!(await saveEndpoint({ user_id: u.id, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth })))
      return { ok: false, error: 'Couldn’t save your notification settings.' };
    localStorage.setItem(APNS_KEY, 'web');   // the sync mirror pushArmed() reads
    return { ok: true };
  }

  // Turn OFF. Dropping the stored row IS the off switch on both sides — it's the
  // only thing the sender consults. The web also unsubscribes the device (there's
  // a live PushManager subscription to release); iOS keeps the OS permission,
  // since taking it back would mean re-spending the one prompt to turn push on
  // again, and the row being gone already means nothing is sent.
  async function disablePush() {
    if (nativeShell()) {
      const token = localStorage.getItem(APNS_KEY);
      localStorage.removeItem(APNS_KEY);
      try {
        await capPush('unregister');
        if (token) await sb.from('push_subscriptions').delete().eq('endpoint', 'apns:' + token);
      } catch { /* the sender prunes an unreachable token on its next send */ }
      return { ok: true };
    }
    localStorage.removeItem(APNS_KEY);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg && await reg.pushManager.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe();
        await sb.from('push_subscriptions').delete().eq('endpoint', endpoint);
      }
    } catch { /* leave the row; the sender prunes dead endpoints on 404/410 */ }
    return { ok: true };
  }

  return {
    init, refresh,
    users, user, currentUser, isPrivate, friends, friendsOf, feed, discover, posts, postsBy, audienceCount, audienceOf,
    // Auth
    session, isAuthed, signup, login, logout, deleteAccount,
    requestPasswordReset, updatePassword, resendConfirmation,
    isRecovering, onRecovery,
    // Friends
    isFriend, areFriends, addFriend, removeFriend, following, followers,
    requestsSent, requestsReceived, friendStatus,
    declineRequest, undecline, isDeclined, declined,
    // Blocking
    isBlocked, block, unblock,
    // Compose
    createPost, deletePost, updatePost,
    // Reposts
    createRepost, undoRepost, originalOf, repostable, repostedByMe, myRepostOf,
    // Comments
    commentsFor, addComment, deleteComment,
    // Likes
    likesFor, likeCountFor, likedByMe, toggleLike,
    // Headcount
    headcountFor, goingByMe, toggleGoing,
    // Polls
    pollVotesFor, myPollVote, votePoll, pollClosed, pollClosesAt,
    // Notifications
    notifications,
    // Push
    pushSupported, pushPermission, pushArmed, pushSubscribed, pushResume, enablePush, disablePush,
    clearDelivered, openAppSettings,
    // Profile
    updateAvatar, updateProfile, updateAccent, setListeningTo,
    // Pins
    setPins,
  };
})();

/* ── View helpers (pure, no state) ────────────────────────────────────────── */

// Initial for a pfp — first letter of the display name.
const initialOf = (name) => (name || '?').trim().charAt(0).toUpperCase();

// A friendly relative-ish date: "today", "yesterday", else "Jun 28".
function niceDate(iso) {
  const d = new Date(iso + 'T12:00:00');
  const now = new Date(TODAY + 'T12:00:00');  // app "now"
  const days = Math.round((now - d) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7)  return days + 'd ago';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// An activity's when-line: "Today · 6:30 PM", "Tomorrow", else "Sat, Jul 12".
// Forward-looking phrasing (vs niceDate's ago-phrasing) — plans point ahead.
function eventWhenLabel(dateStr, timeStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const days = Math.round((d - new Date(TODAY + 'T12:00:00')) / 86400000);
  const day =
    days === 0 ? 'Today' :
    days === 1 ? 'Tomorrow' :
    d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return day + (timeStr ? ` · ${niceTime(timeStr)}` : '');
}

// 'HH:MM' (24h, from <input type="time">) → "6:30 PM".
function niceTime(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return '';
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

const domainOf = (url) => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
};

// A calm, tonal stand-in for a photo. Deterministic from the id, drawn as an
// inline SVG data URI so it behaves like a normal <img>, lightbox included.
function placeholderPhoto(id, alt) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const l = 60 + (h % 14);
  const a = `hsl(40 7% ${l}%)`;
  const b = `hsl(40 9% ${l - 17}%)`;
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='800' height='800'>` +
      `<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>` +
        `<stop offset='0' stop-color='${a}'/><stop offset='1' stop-color='${b}'/>` +
      `</linearGradient></defs>` +
      `<rect width='800' height='800' fill='url(#g)'/>` +
      `<circle cx='620' cy='210' r='120' fill='rgba(255,255,255,0.10)'/>` +
    `</svg>`;
  return { src: 'data:image/svg+xml,' + encodeURIComponent(svg), alt: alt || 'Photo', w: 800, h: 800 };
}

// A post photo/video is uploaded as `…-WIDTHxHEIGHT.ext`, so its pixel size can be
// read straight from the URL — no extra column, no metadata fetch. The feed hands
// the <img>/<video> those width/height attributes so the browser reserves the
// exact space before the bytes arrive, and nothing reflows as media streams in.
// Legacy photos (uploaded before the stamp) and avatars return null and fall back
// gracefully.
function imageDimsFromUrl(url) {
  const m = /-(\d+)x(\d+)\.(?:jpe?g|gif|mp4|webm|mov)/i.exec(url || '');
  if (!m) return null;
  const w = +m[1], h = +m[2];
  return w && h ? { w, h } : null;
}

// A Frame's `image` column holds either a still or a short clip; tell them apart
// by extension so the feed can branch to a <video> instead of an <img>.
function isVideoUrl(url) {
  return /\.(mp4|webm|mov)$/i.test(url || '');
}

// A trimmed clip stamps its play-window into the filename (…-t<startMs>-<endMs>…),
// same trick as the -WxH dims. The feed + lightbox read it straight off the URL and
// loop just that window — no cut, no re-encode, no metadata round-trip. Whole clips
// (uploaded untrimmed) carry no stamp and return null (play the entire file).
function clipWindowFromUrl(url) {
  const m = /-t(\d+)-(\d+)(?:-\d+x\d+)?\.(?:mp4|webm|mov)(?:$|\?)/i.exec(url || '');
  if (!m) return null;
  const start = +m[1] / 1000, end = +m[2] / 1000;
  return end > start ? { start, end } : null;
}
