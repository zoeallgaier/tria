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
    if (!s.follows) s.follows = {};
    delete s.currentUser;
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
  const following = () => state.follows[state.session] || [];

  // Home feed: everyone the current user follows, plus their own posts,
  // newest first. (Chronological, no ranking — that's the whole point.)
  function feed() {
    const circle = new Set([state.session, ...following()]);
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
    state.follows[username] = state.users
      .filter(u => u.username !== username).map(u => u.username).slice(0, 3);
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

  // ── Following (writes) ──────────────────────────────────────────────────────
  // The current user's circle is just a list of usernames under their session.
  const isFollowing = (username) => following().includes(username);

  function follow(username) {
    const me = state.session;
    if (!me || username === me || !user(username)) return;
    const list = state.follows[me] || (state.follows[me] = []);
    if (!list.includes(username)) { list.push(username); save(state); }
  }

  function unfollow(username) {
    const list = state.follows[state.session];
    if (!list) return;
    const i = list.indexOf(username);
    if (i > -1) { list.splice(i, 1); save(state); }
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

  return {
    users, user, currentUser, following, feed, posts, postsBy,
    // Auth
    session, isAuthed, signup, login, logout,
    // Following
    isFollowing, follow, unfollow,
    // Compose
    createPost, deletePost, updatePost,
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
