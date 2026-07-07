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

const Store = (() => {
  const { url, key } = window.TRIA_CONFIG;
  const sb = window.supabase.createClient(url, key);

  // In-memory mirror of the shared world, shaped like the old save file:
  //   users: [{id, username, name, bio, avatar?}]
  //   posts: [{id, author(username), type, date, tags, title?, url?, note?, image?, _ts}]
  //   comments: [{id, postId, author(username), text, date}]
  //   friends: symmetric adjacency map keyed by username
  //   session: the signed-in username, or null
  const empty = () => ({ session: null, users: [], posts: [], comments: [], likes: [], headcount: [], friends: {} });
  let state = empty();

  // ── Row → view-shape mappers ───────────────────────────────────────────────
  const dateOf = (ts) => (ts ? dayMT(ts) : TODAY);
  const idOf = (username) => (state.users.find(u => u.username === username) || {}).id || null;

  function mapUser(u) {
    const o = { id: u.id, username: u.username, name: u.name, bio: u.bio || '' };
    if (u.avatar) o.avatar = u.avatar;
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
    if (p.location) o.location = p.location;
    return o;
  }
  const nameMap = () => new Map(state.users.map(u => [u.id, u.username]));

  // ── Boot ───────────────────────────────────────────────────────────────────
  // Resolve any persisted session, then (if signed in) pull the whole world into
  // the cache. Called once before the first render. supabase-js persists the
  // session in localStorage, so a returning visitor stays logged in.
  async function init() {
    const { data: { session } } = await sb.auth.getSession();
    await hydrate(session);
  }

  // Set state.session from an auth session and load (or clear) the world.
  async function hydrate(session) {
    if (!session) { state = empty(); return; }
    await loadWorld();
    const me = state.users.find(u => u.id === session.user.id);
    state.session = me ? me.username : null;
  }

  // Pull every profile / post / comment / friendship into the cache. Reads are
  // RLS-gated to signed-in users, so this only returns data once authenticated.
  async function loadWorld() {
    const [u, p, c, l, h, f] = await Promise.all([
      sb.from('users').select('*'),
      sb.from('posts').select('*'),
      sb.from('comments').select('*').order('created_at', { ascending: true }),
      // RLS only hands back the like rows we're allowed to see: our own, plus
      // every like on our own posts. So the cache literally can't compute a count
      // for someone else's post — the rows aren't here.
      sb.from('likes').select('*').order('created_at', { ascending: true }),
      // Headcount is the opposite: who's in IS the point of an activity, so the
      // rows are readable by everyone (the table may not exist yet on an old DB —
      // loadWorld tolerates the error and leaves the list empty).
      sb.from('headcount').select('*').order('created_at', { ascending: true }),
      sb.from('friends').select('*'),
    ]);
    state.users = (u.data || []).map(mapUser);
    const nameById = nameMap();
    state.posts = (p.data || []).map(row => mapPost(row, nameById));
    state.comments = (c.data || []).map(row => ({
      id: row.id, postId: row.post_id, author: nameById.get(row.author),
      text: row.body, date: dateOf(row.created_at), _ts: row.created_at,
    }));
    state.likes = (l.data || []).map(row => ({ postId: row.post_id, user: nameById.get(row.user_id), _ts: row.created_at }));
    state.headcount = (h.data || []).map(row => ({ postId: row.post_id, user: nameById.get(row.user_id), _ts: row.created_at }));
    const fr = {};
    const link = (a, b) => { (fr[a] || (fr[a] = [])).includes(b) || fr[a].push(b); };
    for (const row of f.data || []) {
      const a = nameById.get(row.a), b = nameById.get(row.b);
      if (a && b) { link(a, b); link(b, a); }
    }
    for (const x of state.users) fr[x.username] || (fr[x.username] = []);
    state.friends = fr;
  }

  // ── Reads (synchronous, off the cache) ─────────────────────────────────────
  const users = () => state.users;
  const user  = (username) => state.users.find(u => u.username === username) || null;
  const session = () => state.session;
  const isAuthed = () => !!state.session;
  const currentUser = () => user(state.session);

  // The current user's friends — mutual only (the pair table is mutual by
  // construction; the filter is a belt-and-braces guarantee).
  function friends() {
    const me = state.session;
    const mine = state.friends[me] || [];
    return mine.filter(u => (state.friends[u] || []).includes(me));
  }

  // Home feed: your mutual friends' posts, plus your own, newest first.
  function feed() {
    const circle = new Set([state.session, ...friends()]);
    return posts().filter(p => circle.has(p.author));
  }

  // All posts, newest first, by real server timestamp (stable).
  function posts() {
    return [...state.posts].sort((a, b) => (a._ts < b._ts ? 1 : a._ts > b._ts ? -1 : 0));
  }
  const postsBy = (username) => posts().filter(p => p.author === username);

  // ── Auth (async writes) ────────────────────────────────────────────────────
  // Create an account: Supabase Auth owns the email + password; the username and
  // name ride along as metadata, and a DB trigger turns them into a public
  // profile row (see schema.sql). Email confirmation is off, so signUp returns a
  // live session and we're straight in.
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
    if (!data.session) return { ok: false, error: 'Check your email to confirm your account, then log in.' };
    await hydrate(data.session);
    return { ok: true };
  }

  async function login(email, password) {
    email = String(email || '').trim();
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) return { ok: false, error: 'Wrong email or password.' };
    await hydrate(data.session);
    return { ok: true };
  }

  async function logout() {
    await sb.auth.signOut();
    state = empty();
  }

  // ── Friends (async writes) ──────────────────────────────────────────────────
  const isFriend = (username) => friends().includes(username);

  const linkCache = (a, b) => {
    const l = state.friends[a] || (state.friends[a] = []);
    if (!l.includes(b)) l.push(b);
  };
  const unlinkCache = (a, b) => {
    const l = state.friends[a]; if (!l) return;
    const i = l.indexOf(b); if (i > -1) l.splice(i, 1);
  };

  // Add a friend — instantly mutual. Stored as one canonical (a<b) pair row; the
  // cache mirrors both directions so reads stay symmetric.
  async function addFriend(username) {
    const me = state.session;
    if (!me || username === me) return;
    const mine = idOf(me), theirs = idOf(username);
    if (!mine || !theirs) return;
    const [a, b] = [mine, theirs].sort();
    const { error } = await sb.from('friends').insert({ a, b });
    if (error && !/duplicate|unique/i.test(error.message)) return;  // already friends → fine
    linkCache(me, username); linkCache(username, me);
  }

  async function removeFriend(username) {
    const me = state.session;
    if (!me) return;
    const mine = idOf(me), theirs = idOf(username);
    if (!mine || !theirs) return;
    const [a, b] = [mine, theirs].sort();
    const { error } = await sb.from('friends').delete().eq('a', a).eq('b', b);
    if (error) return;
    unlinkCache(me, username); unlinkCache(username, me);
  }

  // ── Compose (async writes) ──────────────────────────────────────────────────
  // Upload a cropped JPEG (a data: URI from the cropper) into the public 'media'
  // bucket under the user's own {uid}/ folder, and hand back its public URL. This
  // is why photos no longer bloat the database — the column just stores the URL.
  async function uploadImage(dataURI, kind) {
    if (!/^data:/.test(dataURI)) return dataURI;      // already a URL → pass through
    const me = currentUser();
    if (!me) throw new Error('Not signed in.');
    const blob = await (await fetch(dataURI)).blob();
    const path = `${me.id}/${kind}-${Date.now()}.jpg`;
    const { error } = await sb.storage.from('media')
      // Filenames are versioned (a fresh timestamp each save), so the bytes at a
      // URL never change — cache them for a year to make repeat loads instant.
      .upload(path, blob, { contentType: 'image/jpeg', upsert: false, cacheControl: '31536000' });
    if (error) throw error;
    return sb.storage.from('media').getPublicUrl(path).data.publicUrl;
  }

  async function createPost(data) {
    const me = state.session;
    if (!me) return { ok: false, error: 'You need to be signed in.' };
    const row = { author: idOf(me), type: data.type, tags: data.tags || [] };
    if (data.title)    row.title = data.title;
    if (data.url)      row.url = data.url;
    if (data.note)     row.note = data.note;
    if (data.location) row.location = data.location;
    if (data.image) {
      try { row.image = await uploadImage(data.image, 'photo'); }
      catch { return { ok: false, error: 'Couldn’t upload the photo, try again.' }; }
    }

    const { data: inserted, error } = await sb.from('posts').insert(row).select().single();
    if (error) return { ok: false, error: 'Couldn’t publish, try again.' };
    const post = mapPost(inserted, nameMap());
    state.posts.push(post);
    return { ok: true, post };
  }

  async function deletePost(id) {
    const me = state.session;
    const i = state.posts.findIndex(p => p.id === id);
    if (i < 0 || state.posts[i].author !== me)
      return { ok: false, error: 'That post isn’t yours to delete.' };
    const { error } = await sb.from('posts').delete().eq('id', id);
    if (error) return { ok: false, error: 'Couldn’t delete, try again.' };
    state.posts.splice(i, 1);
    state.comments = state.comments.filter(c => c.postId !== id);
    state.likes = state.likes.filter(x => x.postId !== id);
    state.headcount = state.headcount.filter(x => x.postId !== id);
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
    for (const k of ['title', 'url', 'note', 'location']) {
      if (k in data) patch[k] = data[k] || null;
    }
    if ('tags' in data) patch.tags = data.tags || [];

    const { data: updated, error } = await sb.from('posts').update(patch).eq('id', id).select().single();
    if (error) return { ok: false, error: 'Couldn’t save, try again.' };
    state.posts[i] = mapPost(updated, nameMap());
    return { ok: true, post: state.posts[i] };
  }

  // ── Comments (async writes) ─────────────────────────────────────────────────
  const commentsFor = (postId) => state.comments.filter(c => c.postId === postId);

  async function addComment(postId, text) {
    const me = state.session;
    if (!me) return { ok: false, error: 'You need to be signed in.' };
    text = String(text || '').trim();
    if (!text) return { ok: false, error: 'Say something first.' };
    const post = state.posts.find(p => p.id === postId);
    if (!post) return { ok: false, error: 'That post no longer exists.' };
    if (post.author !== me && !isFriend(post.author))
      return { ok: false, error: 'You can only comment on friends’ posts.' };

    const { data: c, error } = await sb.from('comments')
      .insert({ post_id: postId, author: idOf(me), body: text }).select().single();
    if (error) return { ok: false, error: 'Couldn’t post your comment, try again.' };
    state.comments.push({ id: c.id, postId, author: me, text, date: dateOf(c.created_at), _ts: c.created_at });
    return { ok: true, comment: state.comments[state.comments.length - 1] };
  }

  async function deleteComment(id) {
    const me = state.session;
    const i = state.comments.findIndex(c => c.id === id);
    if (i < 0 || state.comments[i].author !== me)
      return { ok: false, error: 'That comment isn’t yours to delete.' };
    const { error } = await sb.from('comments').delete().eq('id', id);
    if (error) return { ok: false, error: 'Couldn’t delete, try again.' };
    state.comments.splice(i, 1);
    return { ok: true };
  }

  // ── Likes (a private signal to the author) ──────────────────────────────────
  // likesFor only ever returns what the cache holds, which RLS has already
  // filtered: for your own post that's the full set (count + who); for anyone
  // else's it's at most your own row. So likeCountFor is meaningful only to the
  // author — exactly the point.
  const likesFor = (postId) => state.likes.filter(x => x.postId === postId);
  const likeCountFor = (postId) => likesFor(postId).length;
  const likedByMe = (postId) => state.likes.some(x => x.postId === postId && x.user === state.session);

  // Toggle my like on a friend's post. You can't like your own post (the heart is
  // the author's window onto who liked, not a self-like), and likes — like
  // comments — are a friends-only gesture.
  async function toggleLike(postId) {
    const me = state.session;
    if (!me) return { ok: false };
    const post = state.posts.find(p => p.id === postId);
    if (!post || post.author === me || !isFriend(post.author)) return { ok: false };
    const mine = idOf(me);
    const has = likedByMe(postId);
    if (has) {
      const { error } = await sb.from('likes').delete().eq('post_id', postId).eq('user_id', mine);
      if (error) return { ok: false };
      state.likes = state.likes.filter(x => !(x.postId === postId && x.user === me));
    } else {
      const { error } = await sb.from('likes').insert({ post_id: postId, user_id: mine });
      if (error && !/duplicate|unique/i.test(error.message)) return { ok: false };
      if (!likedByMe(postId)) state.likes.push({ postId, user: me, _ts: new Date().toISOString() });
    }
    return { ok: true, liked: !has };
  }

  // ── Headcount (who's in, on an activity) ────────────────────────────────────
  // The public counterpart to likes: every row is readable, so anyone who can
  // see the activity sees the count and the names. You can raise or lower only
  // your own hand, and — like commenting — it's a friends-only gesture. The
  // author hosts rather than RSVPs, so their own hand stays out of the list.
  const headcountFor = (postId) => state.headcount.filter(x => x.postId === postId);
  const goingByMe = (postId) => state.headcount.some(x => x.postId === postId && x.user === state.session);

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
      state.headcount = state.headcount.filter(x => !(x.postId === postId && x.user === me));
    } else {
      const { error } = await sb.from('headcount').insert({ post_id: postId, user_id: mine });
      if (error && !/duplicate|unique/i.test(error.message)) return { ok: false };
      if (!goingByMe(postId)) state.headcount.push({ postId, user: me, _ts: new Date().toISOString() });
    }
    return { ok: true, going: !has };
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
    for (const c of state.comments)
      if (mine.has(c.postId) && c.author !== me)
        evts.push({ kind: 'comment', postId: c.postId, user: c.author, text: c.text, _ts: c._ts || '' });
    for (const l of state.likes)
      if (mine.has(l.postId) && l.user !== me)
        evts.push({ kind: 'like', postId: l.postId, user: l.user, _ts: l._ts || '' });
    for (const h of state.headcount)
      if (mine.has(h.postId) && h.user !== me)
        evts.push({ kind: 'going', postId: h.postId, user: h.user, _ts: h._ts || '' });
    return evts.sort((a, b) => (a._ts < b._ts ? 1 : a._ts > b._ts ? -1 : 0));
  }

  // ── Profile (async writes) ──────────────────────────────────────────────────
  // Set (or clear) the signed-in user's avatar — a cropped square data-URI for
  // now (Storage in step 4), or null to fall back to the initial tile.
  // Optimistic: the cache is updated to the local crop synchronously (before the
  // first await), so a caller can re-render and show the new photo instantly while
  // the upload + save happen in the background. On any failure we revert the cache.
  async function updateAvatar(dataURI) {
    const u = currentUser();
    if (!u) return { ok: false, error: 'You need to be signed in.' };
    const prev = u.avatar;
    if (dataURI) u.avatar = dataURI; else delete u.avatar;   // optimistic, synchronous
    const revert = () => { if (prev) u.avatar = prev; else delete u.avatar; };

    let url = null;
    if (dataURI) {
      try { url = await uploadImage(dataURI, 'avatar'); }
      catch { revert(); return { ok: false, error: 'Couldn’t upload, try again.' }; }
    }
    const { error } = await sb.from('users').update({ avatar: url }).eq('id', u.id);
    if (error) { revert(); return { ok: false, error: 'Couldn’t save your photo.' }; }
    if (url) u.avatar = url; else delete u.avatar;
    return { ok: true };
  }

  async function updateProfile({ name, bio } = {}) {
    const u = currentUser();
    if (!u) return { ok: false, error: 'You need to be signed in.' };
    name = (name || '').trim();
    bio = (bio || '').trim();
    if (!name) return { ok: false, error: 'Add a display name.' };
    if (name.length > 40) return { ok: false, error: 'Name: keep it under 40 characters.' };
    if (bio.length > 160) return { ok: false, error: 'Bio: keep it under 160 characters.' };
    const { error } = await sb.from('users').update({ name, bio }).eq('id', u.id);
    if (error) return { ok: false, error: 'Couldn’t save your changes.' };
    u.name = name; u.bio = bio;
    return { ok: true };
  }

  return {
    init,
    users, user, currentUser, friends, feed, posts, postsBy,
    // Auth
    session, isAuthed, signup, login, logout,
    // Friends
    isFriend, addFriend, removeFriend,
    // Compose
    createPost, deletePost, updatePost,
    // Comments
    commentsFor, addComment, deleteComment,
    // Likes
    likesFor, likeCountFor, likedByMe, toggleLike,
    // Headcount
    headcountFor, goingByMe, toggleGoing,
    // Notifications
    notifications,
    // Profile
    updateAvatar, updateProfile,
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
  return { src: 'data:image/svg+xml,' + encodeURIComponent(svg), alt: alt || 'Photo' };
}
