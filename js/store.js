/* ── Store ─────────────────────────────────────────────────────────────────
   The single source of truth at runtime. On first load it seeds localStorage
   from TRIA_SEED; after that every read/write goes through here. Keeping all
   data access behind this object is the seam that lets a real backend drop in
   later without touching the views. */

// The prototype's "now" — a single source of truth shared by new posts (their
// date stamp) and niceDate (its relative-date baseline) so they always agree.
const TODAY = new Date().toISOString().slice(0, 10);

const Store = (() => {
  const KEY = 'tria.v1';

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return migrate(JSON.parse(raw));
    } catch { /* corrupt or unavailable — fall back to a fresh seed */ }
    const fresh = structuredClone(window.TRIA_SEED);
    save(fresh);
    return fresh;
  }

  // Bring older saved states forward: pre-auth saves had `currentUser` and no
  // `session`, so treat them as signed out (the app then shows the gate).
  function migrate(s) {
    if (s.session === undefined) s.session = null;
    if (!s.comments) s.comments = [];
    delete s.currentUser;

    // Following → Friends. Older states carried a one-directional `follows` map
    // (you followed people who didn't necessarily follow back). Friendship is
    // now mutual, so promote every past follow (either direction) to a two-way
    // friendship — nobody loses their circle in the switch.
    if (!s.friends) {
      const fr = {};
      const link = (a, b) => { (fr[a] || (fr[a] = [])).includes(b) || fr[a].push(b); };
      const old = s.follows || {};
      for (const a of Object.keys(old))
        for (const b of (old[a] || [])) { link(a, b); link(b, a); }
      s.friends = fr;
    }
    delete s.follows;

    // Backfill sample avatars added to the seed after an install's first run:
    // the store only seeds once, so states created before avatars existed still
    // show initial tiles for the seeded friends. Copy the avatar from the seed
    // for any matching username that has none — real accounts (no seed match)
    // are untouched, and anyone the seed leaves photo-less stays on the tile.
    const seedUsers = (window.TRIA_SEED && window.TRIA_SEED.users) || [];
    for (const u of s.users || []) {
      if (u.avatar) continue;
      const seed = seedUsers.find(su => su.username === u.username);
      if (seed && seed.avatar) u.avatar = seed.avatar;
    }
    return s;
  }

  // Returns false if the write failed (e.g. localStorage quota — a fat photo
  // data-URI can hit it), so callers that must persist can roll back and warn.
  function save(state) {
    try { localStorage.setItem(KEY, JSON.stringify(state)); return true; }
    catch { return false; }
  }

  // A lightweight, non-reversible fingerprint for passwords. This is a
  // front-end prototype with no server, so it is NOT real security — it just
  // keeps the literal password out of localStorage. Real auth lives behind the
  // store's backend seam later.
  function hash(str) {
    let h = 5381;
    for (const c of String(str)) h = ((h << 5) + h + c.charCodeAt(0)) >>> 0;
    return 'h' + h.toString(36);
  }

  let state = load();

  // ── Reads ────────────────────────────────────────────────────────────────
  const users = () => state.users;
  const user  = (username) => state.users.find(u => u.username === username) || null;
  const session = () => state.session;
  const isAuthed = () => !!state.session && !!user(state.session);
  const currentUser = () => user(state.session);

  // The current user's friends — mutual only: you list them AND they list you.
  // (Writes keep both sides in sync, so this normally equals your own list; the
  // mutual filter is the guarantee that the Circle only ever shows friends.)
  function friends() {
    const me = state.session;
    const mine = state.friends[me] || [];
    return mine.filter(u => (state.friends[u] || []).includes(me));
  }

  // Home feed: your mutual friends' posts, plus your own, newest first.
  // (Chronological, no ranking — that's the whole point.)
  function feed() {
    const circle = new Set([state.session, ...friends()]);
    return posts().filter(p => circle.has(p.author));
  }

  // ── Auth (writes) ──────────────────────────────────────────────────────────
  // Create an account and sign in. A new account lands among a few of the
  // existing circle so its feed isn't empty on day one — the rest are left to
  // find on the Friends → "Find people" list.
  function signup({ name, username, password }) {
    name = String(name || '').trim();
    username = String(username || '').trim().toLowerCase();
    if (!name) return { ok: false, error: 'Add a display name.' };
    if (!/^[a-z0-9_]{2,20}$/.test(username))
      return { ok: false, error: 'Username: 2–20 letters, numbers or _.' };
    if (user(username)) return { ok: false, error: 'That username is taken.' };
    if (String(password || '').length < 4)
      return { ok: false, error: 'Password needs at least 4 characters.' };

    state.users.push({ username, name, pass: hash(password), bio: '' });
    // Land among a few of the existing circle as mutual friends, so the feed
    // isn't empty on day one (both sides, since friendship is two-way).
    state.friends[username] = [];
    state.users
      .filter(u => u.username !== username).slice(0, 3)
      .forEach(u => {
        state.friends[username].push(u.username);
        (state.friends[u.username] || (state.friends[u.username] = [])).push(username);
      });
    state.session = username;
    save(state);
    return { ok: true };
  }

  function login(username, password) {
    username = String(username || '').trim().toLowerCase();
    const u = user(username);
    if (!u || u.pass !== hash(password || ''))
      return { ok: false, error: 'Wrong username or password.' };
    state.session = username;
    save(state);
    return { ok: true };
  }

  function logout() { state.session = null; save(state); }

  // ── Friends (writes) ────────────────────────────────────────────────────────
  // Friendship is mutual: are they in your circle (and you in theirs)?
  const isFriend = (username) => friends().includes(username);

  // Link/unlink one direction of the friendship graph (no save — callers batch).
  function link(a, b) {
    const list = state.friends[a] || (state.friends[a] = []);
    if (!list.includes(b)) list.push(b);
  }
  function unlink(a, b) {
    const list = state.friends[a];
    if (!list) return;
    const i = list.indexOf(b);
    if (i > -1) list.splice(i, 1);
  }

  // Add a friend — instantly mutual (both directions), since in this prototype
  // there's no second live person to accept a request. Remove undoes both sides.
  function addFriend(username) {
    const me = state.session;
    if (!me || username === me || !user(username)) return;
    link(me, username);
    link(username, me);
    save(state);
  }

  function removeFriend(username) {
    const me = state.session;
    if (!me) return;
    unlink(me, username);
    unlink(username, me);
    save(state);
  }

  // All posts, newest first. Ties broken by id so order is stable across loads.
  function posts() {
    return [...state.posts].sort((a, b) =>
      (a.date < b.date ? 1 : a.date > b.date ? -1 : (a.id < b.id ? 1 : -1)));
  }

  const postsBy = (username) => posts().filter(p => p.author === username);

  // ── Compose (writes) ────────────────────────────────────────────────────────
  // Publish a new entry from the current user. `data.image` is a cropped photo
  // data-URI (photos only). Only the fields that apply to the type are stored,
  // matching the shape of the seed. On a storage failure we roll back so runtime
  // state never drifts from what's persisted.
  function createPost(data) {
    const me = state.session;
    if (!me) return { ok: false, error: 'You need to be signed in.' };

    const post = {
      id: 'u' + Date.now().toString(36),
      author: me,
      type: data.type,
      date: TODAY,
      tags: data.tags || [],
    };
    if (data.title) post.title = data.title;
    if (data.url)   post.url = data.url;
    if (data.note)  post.note = data.note;
    if (data.image) post.image = data.image;

    state.posts.push(post);
    if (!save(state)) {
      state.posts.pop();
      return { ok: false, error: 'Couldn’t save — device storage may be full.' };
    }
    return { ok: true, post };
  }

  // Remove one of your OWN posts. Guarded by author === session so a stale or
  // hand-crafted id can never delete someone else's entry. Rolls back on a
  // failed write so runtime state never drifts from what's persisted.
  function deletePost(id) {
    const me = state.session;
    const i = state.posts.findIndex(p => p.id === id);
    if (i < 0 || state.posts[i].author !== me)
      return { ok: false, error: 'That post isn’t yours to delete.' };
    const [removed] = state.posts.splice(i, 1);
    if (!save(state)) {
      state.posts.splice(i, 0, removed);
      return { ok: false, error: 'Couldn’t save — try again.' };
    }
    return { ok: true };
  }

  // Edit the TEXT of one of your own posts (title / url / note / tags). Type and
  // image are fixed — swapping a photo means delete + repost. A field given as
  // an empty string is cleared; omit a field to leave it untouched. Works on a
  // copy and swaps it in, so a failed write rolls back cleanly.
  function updatePost(id, data) {
    const me = state.session;
    const i = state.posts.findIndex(p => p.id === id);
    if (i < 0 || state.posts[i].author !== me)
      return { ok: false, error: 'That post isn’t yours to edit.' };

    const before = state.posts[i];
    const updated = { ...before };
    for (const k of ['title', 'url', 'note']) {
      if (!(k in data)) continue;
      if (data[k]) updated[k] = data[k]; else delete updated[k];
    }
    if ('tags' in data) updated.tags = data.tags || [];

    state.posts[i] = updated;
    if (!save(state)) {
      state.posts[i] = before;
      return { ok: false, error: 'Couldn’t save — try again.' };
    }
    return { ok: true, post: updated };
  }

  // ── Comments (reads + writes) ───────────────────────────────────────────────
  // A thread is just every comment for a post, oldest first — the array only
  // ever grows by push, so filtering it preserves that chronological order
  // without needing a stored timestamp finer than the day.
  const commentsFor = (postId) => state.comments.filter(c => c.postId === postId);

  function addComment(postId, text) {
    const me = state.session;
    if (!me) return { ok: false, error: 'You need to be signed in.' };
    text = String(text || '').trim();
    if (!text) return { ok: false, error: 'Say something first.' };
    const post = state.posts.find(p => p.id === postId);
    if (!post) return { ok: false, error: 'That post no longer exists.' };
    // Friends-only: you can comment on a friend's post, or your own.
    if (post.author !== me && !isFriend(post.author))
      return { ok: false, error: 'You can only comment on friends’ posts.' };

    const comment = { id: 'c' + Date.now().toString(36), postId, author: me, text, date: TODAY };
    state.comments.push(comment);
    if (!save(state)) {
      state.comments.pop();
      return { ok: false, error: 'Couldn’t save — try again.' };
    }
    return { ok: true, comment };
  }

  // Remove one of your OWN comments. Guarded by author === session, same as
  // deletePost — a stale or hand-crafted id can never delete someone else's.
  function deleteComment(id) {
    const me = state.session;
    const i = state.comments.findIndex(c => c.id === id);
    if (i < 0 || state.comments[i].author !== me)
      return { ok: false, error: 'That comment isn’t yours to delete.' };
    const [removed] = state.comments.splice(i, 1);
    if (!save(state)) {
      state.comments.splice(i, 0, removed);
      return { ok: false, error: 'Couldn’t save — try again.' };
    }
    return { ok: true };
  }

  // Set (or clear) the signed-in user's profile photo — a cropped square data-URI
  // (or null/'' to drop back to the initial tile). Rolls back on a failed write so
  // runtime state never drifts from what's persisted.
  function updateAvatar(dataURI) {
    const u = currentUser();
    if (!u) return { ok: false, error: 'You need to be signed in.' };
    const before = u.avatar;
    if (dataURI) u.avatar = dataURI; else delete u.avatar;
    if (!save(state)) {
      if (before) u.avatar = before; else delete u.avatar;
      return { ok: false, error: 'Couldn’t save — the photo may be too large.' };
    }
    return { ok: true };
  }

  // Update the signed-in user's display name + bio. Name is required (it fronts
  // every post + directory row); bio is optional. Rolls back on a failed write.
  function updateProfile({ name, bio } = {}) {
    const u = currentUser();
    if (!u) return { ok: false, error: 'You need to be signed in.' };
    name = (name || '').trim();
    bio = (bio || '').trim();
    if (!name) return { ok: false, error: 'Add a display name.' };
    if (name.length > 40) return { ok: false, error: 'Name: keep it under 40 characters.' };
    if (bio.length > 160) return { ok: false, error: 'Bio: keep it under 160 characters.' };
    const before = { name: u.name, bio: u.bio };
    u.name = name;
    u.bio = bio;
    if (!save(state)) {
      u.name = before.name; u.bio = before.bio;
      return { ok: false, error: 'Couldn’t save your changes.' };
    }
    return { ok: true };
  }

  return {
    users, user, currentUser, friends, feed, posts, postsBy,
    // Auth
    session, isAuthed, signup, login, logout,
    // Friends
    isFriend, addFriend, removeFriend,
    // Compose
    createPost, deletePost, updatePost,
    // Comments
    commentsFor, addComment, deleteComment,
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
  const now = new Date(TODAY + 'T12:00:00');  // prototype "now" (shared w/ new posts)
  const days = Math.round((now - d) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7)  return days + 'd ago';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const domainOf = (url) => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
};

// A calm, tonal stand-in for a photo (no real uploads until the publish step).
// Kept neutral — warm greys, no hue — so it sits inside the off-black/off-white
// system rather than fighting it. Deterministic from the id, drawn as an inline
// SVG data URI so it behaves like a normal <img>, lightbox included.
function placeholderPhoto(id, alt) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const l = 60 + (h % 14);                       // vary lightness a little per photo
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
