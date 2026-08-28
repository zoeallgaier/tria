// Tria — push sender (Supabase Edge Function).
//
// Invoked by Database Webhooks on INSERT into: comments, headcount, friends,
// and posts (posts only for @mentions in a note). It figures out WHO should be
// notified, then delivers a push to each of that person's stored devices.
//
// TWO TRANSPORTS, ONE TABLE. A browser stores a Web Push subscription; the iOS
// app stores an APNs device token, because a WKWebView has no Push API at all.
// Both live in `push_subscriptions` and the ADDRESS says which is which: an APNs
// row is `endpoint = 'apns:<hex token>'` with empty keys. That prefix is the
// whole platform discriminator, which is why the app's push needed no migration.
// Everything above `sendTo` — who gets told, and what it says — is shared.
//
// It runs with the service role, so it can read across users (RLS doesn't apply)
// — that's what lets it see a post's author and their subscriptions. Likes are
// deliberately NOT wired to this function: a like stays a silent private nod.
//
// Secrets it needs (set in the dashboard, see the handoff checklist):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:you@…)   — web
//   APNS_KEY_ID, APNS_TEAM_ID, APNS_PRIVATE_KEY (the .p8 file's contents)  — iOS
//   APNS_BUNDLE_ID (optional), APNS_ENV (optional: production | sandbox)
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.
// Missing APNs secrets are not fatal — web push keeps working and iOS rows are
// skipped with one log line, so half a setup degrades instead of failing.

import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

webpush.setVapidDetails(
  Deno.env.get('VAPID_SUBJECT') || 'mailto:zoeallgaier@gmail.com',
  Deno.env.get('VAPID_PUBLIC_KEY')!,
  Deno.env.get('VAPID_PRIVATE_KEY')!,
);

const OPEN_URL = './#/updates';   // the fallback landing, when nothing better is known

// WHERE A TAP LANDS. Every notification used to open Updates, because `sendTo`
// defaulted `url` and no caller ever passed one — so "Tap to see their profile"
// didn't, and a comment notification made you find the post yourself. These
// mirror the routes the app already mints for a copied link (see postLink and
// the `?p=` branch in route()): a post is its AUTHOR'S profile plus the post id,
// which the router reads to spotlight-scroll that card into view.
//
// `#/profile` is the author's own column, so a notification about your own post
// — which is nearly all of them: someone commented on YOURS, someone is coming
// to YOURS — takes the self route. A mention lands on somebody else's post, so
// it needs their handle.
const selfPost = (postId: string) => `./#/profile?p=${encodeURIComponent(postId)}`;
const userPost = (username: string, postId: string) =>
  `./#/u/${encodeURIComponent(username)}?p=${encodeURIComponent(postId)}`;
const userPage = (username: string) => `./#/u/${encodeURIComponent(username)}`;

type Row = Record<string, any>;

async function userById(id: string) {
  const { data } = await supabase.from('users').select('id,username,name').eq('id', id).single();
  return data;
}
async function userByName(username: string) {
  const { data } = await supabase.from('users').select('id,username,name').eq('username', username).single();
  return data;
}
async function postById(id: string) {
  const { data } = await supabase.from('posts').select('id,author,type,title,note').eq('id', id).single();
  return data;
}
// Mutual = both directed "add" edges exist (see friends table).
async function areFriends(a: string, b: string) {
  const { data } = await supabase.from('friends').select('a,b')
    .or(`and(a.eq.${a},b.eq.${b}),and(a.eq.${b},b.eq.${a})`);
  return (data?.length ?? 0) >= 2;
}

// A note may be stored as the client's small HTML subset (<h1>/<h2>/<p>/<strong>/
// <em>, see richNote in app.js), so anything that quotes one in an alert has to
// flatten it first or the reader gets "<p>" in their lock screen. Block ends
// become a space so two paragraphs don't fuse into one word; the entities the
// serializer wrote (it escapes & < > ") come back as characters, & last so a
// literal "&amp;lt;" can't be decoded twice. Titles are stored plain and are not
// put through this — a title with a literal < in it would lose the rest of itself.
function plain(t: string): string {
  return (t || '')
    .replace(/<\/(p|h1|h2)>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

// How the post reads to its author in a notification body.
function postLabel(post: Row | null): string {
  const t = (post?.title || plain((post?.note as string) ?? '')).trim();
  if (t) { const s = t.length > 44 ? t.slice(0, 44).trimEnd() + '…' : t; return `“${s}”`; }
  return post?.type === 'photo' ? 'your frame' : 'your post';
}
function snip(t: string, n = 90) { t = (t || '').trim(); return t.length > n ? t.slice(0, n).trimEnd() + '…' : t; }

// ── APNs ─────────────────────────────────────────────────────────────────────
// Apple wants a provider JWT signed ES256 with the .p8 auth key, and it wants
// that token reused: minting one per push earns a 429 (TooManyProviderTokenUpdates),
// and one older than an hour is rejected outright. So it's cached at module
// scope for 45 minutes — an Edge Function instance outlives many sends, which is
// exactly the lifetime this cache wants.
const APNS_BUNDLE_ID = Deno.env.get('APNS_BUNDLE_ID') || 'com.triaonline.tria';
const APNS_ENV = Deno.env.get('APNS_ENV') || '';
// A debug build registers with APNs SANDBOX and TestFlight/App Store with
// production, off the same `aps-environment: development` entitlement (codesign
// rewrites it at distribution signing). Nothing in the token says which one it
// came from, so with APNS_ENV unset we try production and fall back to sandbox
// on BadDeviceToken. That costs one wasted request on a dev device and saves
// the "push works on TestFlight but not on my phone" afternoon.
const APNS_HOSTS = APNS_ENV === 'sandbox' ? ['api.sandbox.push.apple.com']
  : APNS_ENV === 'production' ? ['api.push.apple.com']
  : ['api.push.apple.com', 'api.sandbox.push.apple.com'];

const b64url = (b: Uint8Array | string) =>
  btoa(typeof b === 'string' ? b : String.fromCharCode(...b))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

let apnsKey: CryptoKey | null = null;
let apnsJwt = { token: '', at: 0 };

async function apnsAuth(): Promise<string | null> {
  const kid = Deno.env.get('APNS_KEY_ID');
  const iss = Deno.env.get('APNS_TEAM_ID');
  const pem = Deno.env.get('APNS_PRIVATE_KEY');
  if (!kid || !iss || !pem) return null;
  if (apnsJwt.token && Date.now() - apnsJwt.at < 45 * 60 * 1000) return apnsJwt.token;

  if (!apnsKey) {
    // The .p8 is PKCS#8 PEM. Strip the armour and the newlines a dashboard
    // secret field is liable to mangle, then import as a P-256 signing key.
    const der = Uint8Array.from(
      atob(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')),
      (c) => c.charCodeAt(0));
    apnsKey = await crypto.subtle.importKey(
      'pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  }
  const head = b64url(JSON.stringify({ alg: 'ES256', kid }));
  const body = b64url(JSON.stringify({ iss, iat: Math.floor(Date.now() / 1000) }));
  // WebCrypto's ECDSA output is already the raw r‖s pair JWS wants — no DER unwrap.
  const sig = new Uint8Array(await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, apnsKey,
    new TextEncoder().encode(`${head}.${body}`)));
  apnsJwt = { token: `${head}.${body}.${b64url(sig)}`, at: Date.now() };
  return apnsJwt.token;
}

// Deliver to one device token. Resolves true if the row should be pruned.
async function sendApns(token: string, payload: Row): Promise<boolean> {
  const jwt = await apnsAuth();
  if (!jwt) { console.error('apns skipped: APNS_KEY_ID / APNS_TEAM_ID / APNS_PRIVATE_KEY not set'); return false; }

  // No `badge`, on purpose. Updates has no count on the nav and no dot on the
  // tab — it tells you nothing until you choose to look — and a number on the
  // app icon is that badge by another route.
  const body = JSON.stringify({
    aps: {
      alert: { title: payload.title, body: payload.body },
      sound: 'default',
      'thread-id': payload.tag || 'tria',
    },
    url: payload.url || OPEN_URL,   // read by the tap handler in app.js
  });
  const headers: Record<string, string> = {
    'authorization': `bearer ${jwt}`,
    'apns-topic': APNS_BUNDLE_ID,
    'apns-push-type': 'alert',
    'apns-priority': '10',
    'content-type': 'application/json',
  };
  // GROUPING AND REPLACING ARE NOT THE SAME HEADER, and conflating them ate
  // notifications. `thread-id` above groups: everything about one post sits
  // together in the shade, which is what you want. `apns-collapse-id` REPLACES:
  // a new notification with a matching id silently overwrites the delivered one.
  // Both were fed the same `post:<id>` tag, so a second person commenting on a
  // post deleted the first person's notification before it had been read — and
  // with no badge and no dot on the Updates tab by design, there was no second
  // channel left to notice it had happened. Collapsing is now opt-in per payload
  // and keyed per EVENT, so the only things that replace each other are things
  // that really are the same event. Apple caps this at 64 bytes.
  if (payload.collapse) headers['apns-collapse-id'] = String(payload.collapse).slice(0, 64);

  for (const host of APNS_HOSTS) {
    try {
      const res = await fetch(`https://${host}/3/device/${token}`, { method: 'POST', headers, body });
      if (res.ok) return false;
      const text = await res.text();
      const reason = (() => { try { return JSON.parse(text).reason; } catch { return text; } })();
      // The device is gone for good — same meaning as a web endpoint's 404/410.
      if (res.status === 410 || reason === 'Unregistered') return true;
      // Wrong environment: this token belongs to the other host, so try it. If
      // that was already the last host, the token really is bad and the row goes.
      if (reason === 'BadDeviceToken' && host !== APNS_HOSTS[APNS_HOSTS.length - 1]) continue;
      if (reason === 'BadDeviceToken') return true;
      console.error('apns send failed', res.status, reason);
      return false;
    } catch (e) {
      console.error('apns request failed', String(e));
      return false;
    }
  }
  return false;
}

// Deliver one payload to every device a user has registered, over whichever
// transport that device's address names. Prunes addresses the push service
// reports as gone.
async function sendTo(userId: string, payload: Row) {
  const { data: subs } = await supabase.from('push_subscriptions')
    .select('endpoint,p256dh,auth').eq('user_id', userId);
  await deliver(subs || [], payload);
}

// The delivery half on its own, so the reminder sweep can pull a whole
// activity's subscriptions in ONE query and then fan out. Fourteen invitees
// through sendTo is fourteen round trips for a table it could have read once.
async function deliver(subs: Row[], payload: Row) {
  if (!subs.length) return;
  const full = { ...payload, url: payload.url || OPEN_URL };
  const body = JSON.stringify(full);
  const drop = (endpoint: string) =>
    supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);

  await Promise.all(subs.map(async (s) => {
    if (typeof s.endpoint === 'string' && s.endpoint.startsWith('apns:')) {
      if (await sendApns(s.endpoint.slice(5), full)) await drop(s.endpoint);
      return;
    }
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body);
    } catch (e: any) {
      // 404/410 = the browser dropped this subscription; prune it. Anything else
      // (VAPID/crypto/import trouble) is logged so the first live test is legible.
      if (e?.statusCode === 404 || e?.statusCode === 410) await drop(s.endpoint);
      else console.error('push send failed', e?.statusCode, e?.body || e?.message || String(e));
    }
  }));
}

async function handle(table: string, rec: Row) {
  if (table === 'comments') {
    const post = await postById(rec.post_id);
    if (!post) return;
    const author = await userById(rec.author);        // who commented
    if (!author) return;
    const notified = new Set<string>();

    // The post's owner hears about the comment (unless they commented on their own).
    if (post.author !== rec.author) {
      await sendTo(post.author, {
        title: `${author.name} commented`,
        body: snip(rec.body) || `Commented on ${postLabel(post)}`,
        tag: `post:${post.id}`, collapse: `comment:${rec.id}`,
        url: selfPost(post.id),   // the recipient IS the author, so: their column
      });
      notified.add(post.author);
    }
    // Anyone @mentioned in the comment who is a mutual friend of the commenter.
    // A mentioned reader is usually NOT the post's author, so the link needs the
    // author's handle — fetched lazily, since most comments mention nobody and
    // this would otherwise be a round trip on every single insert.
    let owner: Row | null | undefined;
    const postOwner = async () => (owner ??= await userById(post.author));
    for (const uname of new Set([...(rec.body || '').matchAll(/@(\w+)/g)].map(m => m[1]))) {
      const u = await userByName(uname);
      if (!u || u.id === rec.author || notified.has(u.id)) continue;
      if (!(await areFriends(u.id, rec.author))) continue;
      const home = u.id === post.author ? selfPost(post.id) : await (async () => {
        const o = await postOwner();
        return o ? userPost(o.username, post.id) : OPEN_URL;
      })();
      await sendTo(u.id, {
        title: `${author.name} mentioned you`, body: snip(rec.body),
        tag: `post:${post.id}`, collapse: `comment:${rec.id}:${u.id}`,
        url: home,
      });
      notified.add(u.id);
    }
    return;
  }

  if (table === 'posts') {
    const author = await userById(rec.author);
    if (!author) return;

    // A repost IS a post row, so this trigger already fires for one — no new
    // webhook was needed. It has to run BEFORE the !rec.note guard below: a bare
    // repost carries no note at all, and that guard is what makes the mention
    // scan cheap for every other post.
    //
    // The original's author gets the news, unless it's their own row. Nothing
    // extra is checked here: RLS is not what gated this, the INSERT policy was —
    // if the row exists, the reposter was allowed to make it.
    if (rec.repost_of) {
      const orig = await postById(rec.repost_of as string);
      if (orig && orig.author !== rec.author) {
        await sendTo(orig.author, {
          title: `${author.name} reposted`,
          // A quote says what they said; a bare repost names the post instead,
          // which is the only thing there is to say about it.
          body: rec.note ? snip(plain(rec.note as string)) : postLabel(orig),
          // Collapsed PER PERSON, like headcount and for the same reason: two
          // friends passing something along is two pieces of news.
          tag: `repost:${orig.id}`, collapse: `repost:${orig.id}:${rec.author}`,
          url: selfPost(orig.id),   // the recipient wrote it
        });
      }
    }

    // Posts fire otherwise only to catch @mentions in the note (comments cover
    // the rest). A quote's sentence is scanned too, so quoting someone and
    // mentioning a third person sends both, which is correct.
    if (!rec.note) return;
    for (const uname of new Set([...(rec.note as string).matchAll(/@(\w+)/g)].map(m => m[1]))) {
      const u = await userByName(uname);
      if (!u || u.id === rec.author) continue;
      if (!(await areFriends(u.id, rec.author))) continue;
      await sendTo(u.id, {
        title: `${author.name} mentioned you`, body: snip(plain(rec.note as string)),
        tag: `post:${rec.id}`, collapse: `post:${rec.id}:${u.id}`,
        url: userPost(author.username, rec.id),
      });
    }
    return;
  }

  if (table === 'headcount') {
    // A friend RSVP'd "going" to an activity you host.
    const post = await postById(rec.post_id);
    if (!post || post.author === rec.user_id) return;   // host can't RSVP self
    const who = await userById(rec.user_id);
    if (!who) return;
    await sendTo(post.author, {
      title: `${who.name} is in`, body: `Going to ${postLabel(post)}`,
      // Collapsed PER PERSON, not per activity: two friends saying yes is two
      // pieces of news. The same person re-RSVPing is one.
      tag: `going:${post.id}`, collapse: `going:${post.id}:${rec.user_id}`,
      url: selfPost(post.id),   // the recipient hosts it
    });
    return;
  }

  if (table === 'friends') {
    // A directed add. It's a NEW friend request only if the reverse edge is
    // missing; if it exists, this insert is an acceptance — no request push.
    const { data: back } = await supabase.from('friends').select('a').eq('a', rec.b).eq('b', rec.a).maybeSingle();
    if (back) return;
    // Someone the recipient has already turned down never reaches them again,
    // however many times they re-add. A decline that still buzzes the phone is
    // not a decline. (Service key, so RLS isn't in the way — and this table must
    // never be readable by the person declined; see friend-declines.sql.)
    const { data: no } = await supabase.from('friend_declines')
      .select('decliner').eq('decliner', rec.b).eq('declined', rec.a).maybeSingle();
    if (no) return;
    const who = await userById(rec.a);                  // the person adding
    if (!who) return;
    // Name it for what it actually is on the receiving end. A private account is
    // being ASKED and has something to do about it; a public one is being
    // followed, which is news and nothing more — so it doesn't get told to go and
    // do something. Same wording split as Updates.
    const { data: target } = await supabase.from('users').select('private').eq('id', rec.b).single();
    const pending = target?.private !== false;
    // Both lines end in "tap to do X", and until now neither tap did X — every
    // notification this function sent landed on Updates. A request belongs there
    // (that's where the pinned requests block is); a follow is about a person, so
    // it opens their profile, which is what it has been promising all along.
    await sendTo(rec.b, pending
      ? { title: `${who.name} wants to be friends`, body: 'Tap to add them back.', tag: `friend:${rec.a}`, collapse: `friend:${rec.a}`, url: OPEN_URL }
      : { title: `${who.name} started following you`, body: 'Tap to see their profile.', tag: `friend:${rec.a}`, collapse: `friend:${rec.a}`, url: userPage(who.username) });
    return;
  }
}

// ── Activity reminders ───────────────────────────────────────────────────────
// Three nudges per activity, sent to its AUDIENCE and not to its headcount: a
// week out, two days out, and the morning of. That is the whole reason this
// isn't keyed on who RSVP'd — somebody who hasn't answered is exactly who the
// week-out reminder is for, and "Are you in?" is the question it exists to ask.
//
// Driven by pg_cron (supabase/activity-reminders.sql), which POSTs
// { kind: 'activity-reminders' } to this same function on the hour. Every send
// is journalled in `activity_reminders` (post, user, stage), so the sweep is
// idempotent and the hourly cadence is a RETRY rather than a repeat: the first
// run inside the quiet window does the work and every later one no-ops. If the
// 9am pass dies on a cold start, 10am picks it up and nobody is told twice.

type Stage = 'week' | 'two' | 'day';

// The app's own clock. store.js resolves every timestamp to a calendar day in
// US Mountain time (`dayMT`), so "today" has to flip in Denver here too, or a
// reminder disagrees with the card that raised it.
const TZ = 'America/Denver';
const dayTZ = (t: number | Date) => new Date(t).toLocaleDateString('en-CA', { timeZone: TZ });
const clockTZ = (t: number | Date) => {
  // hourCycle h23 rather than hour12:false — the latter renders midnight as 24
  // on some ICU builds, which would put the sweep outside its own window.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
  }).formatToParts(new Date(t));
  const at = (k: string) => Number(parts.find((x) => x.type === k)?.value ?? 0);
  return at('hour') * 60 + at('minute');
};

// A reminder must never be the thing that wakes somebody up. This is the only
// clock guard in the sweep; the journal is what makes running hourly inside it
// safe, so widening the window costs nothing but the hour a nudge arrives.
const QUIET_FROM = 9 * 60;    // 09:00 Denver
const QUIET_TO = 21 * 60;     // 21:00 Denver

const shiftDay = (dateStr: string, days: number) => {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
// Noon UTC and formatted in UTC, so the weekday can't slip a day either way.
const weekdayOf = (dateStr: string) =>
  new Date(dateStr + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });

// 'HH:MM' (24h, straight from <input type="time">) → "7:00 PM". Same rule as
// store.js's niceTime, so a notification and the card it points at agree.
function niceTime(hhmm: string): string {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return '';
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

const cut = (t: string, n = 44) => {
  t = (t || '').trim();
  return t.length > n ? t.slice(0, n).trimEnd() + '…' : t;
};

// ONE template for all five bodies: `{Name}'s activity, {when}. {place or ask}.`
// Everything optional falls out of it without its own copy, which is what stops
// a missing time or a missing place needing a special sentence.
function whenPhrase(stage: Stage, dateStr: string, timeStr: string | null): string {
  const at = timeStr ? ` at ${niceTime(timeStr)}` : '';
  if (stage === 'day') {
    // "tonight" from 5pm on. An evening plan described as happening "today" is
    // technically right and reads as though it might already have been missed.
    const hour = timeStr ? Number(String(timeStr).split(':')[0]) : -1;
    return (hour >= 17 ? 'tonight' : 'today') + at;
  }
  return `${stage === 'week' ? 'a week away' : 'two days away'}, ${weekdayOf(dateStr)}${at}`;
}

// Names are free text, and the possessive is a flat always-add-'s so a name
// ending in s needs no special case: Chris → Chris's activity.
const owns = (name: string) => `${cut(name) || 'Someone'}’s`;

// The place is its own sentence purely so it can be dropped whole. An activity's
// location is written by its host in the first person ("My place"), which is
// also why the host's NAME has to lead the body: stripped of the card, "My
// place." has no antecedent.
function placeTail(place: string | null): string {
  const p = cut((place || '').trim(), 40);
  if (!p) return '';
  return /[.!?…]$/.test(p) ? ` ${p}` : ` ${p}.`;
}

function reminderBody(host: Row, act: Row, stage: Stage, going: boolean): string {
  const head = `${owns(host.name)} activity, ${whenPhrase(stage, act.event_date, act.event_time)}.`;
  // Someone who has answered gets logistics; someone who hasn't gets the
  // question, in the app's own word for it (the RSVP button reads "Count me in"
  // and the host's push reads "<name> is in"). On the day both get logistics —
  // by then the address is the useful half and a third ask is pestering.
  if (stage !== 'day' && !going) return `${head} Are you in?`;
  return `${head}${placeTail(act.location)}`;
}

// The host is not in their own audience, so they get exactly one line, on the
// day, saying the one thing only a host needs.
function hostBody(act: Row, count: number): string {
  const when = whenPhrase('day', act.event_date, act.event_time);
  const who = count === 0 ? 'No one’s in yet.'
    : count === 1 ? '1 person is in.'
    : `${count} people are in.`;
  return `${when.charAt(0).toUpperCase()}${when.slice(1)}. ${who}`;
}

// Apple caps apns-collapse-id at 64 bytes and sendApns SLICES to fit, so a key
// built from two full uuids would be truncated mid-user-id — and two people's
// reminders that collapse into each other are one reminder. Eight hex characters
// of each is plenty apart at this scale.
const collapseKey = (postId: string, stage: string, userId: string) =>
  `r:${postId.slice(0, 8)}:${stage}:${userId.slice(0, 8)}`;

// Mutual = both directed edges, the same rule as areFriends, in bulk.
async function mutualFriends(userId: string): Promise<string[]> {
  const [out, back] = await Promise.all([
    supabase.from('friends').select('b').eq('a', userId),
    supabase.from('friends').select('a').eq('b', userId),
  ]);
  const added = new Set((back.data || []).map((r: Row) => r.a as string));
  return (out.data || []).map((r: Row) => r.b as string).filter((id) => added.has(id));
}

// Everyone on either side of a block with this person. Mutual friendship already
// implies no block (blocking severs the friendship), but a 'list' allowlist row
// outlives one, so the audience is filtered through this either way.
async function blockedWith(userId: string): Promise<Set<string>> {
  const { data } = await supabase.from('blocks').select('blocker,blocked')
    .or(`blocker.eq.${userId},blocked.eq.${userId}`);
  const out = new Set<string>();
  for (const r of data || []) out.add(r.blocker === userId ? r.blocked : r.blocker);
  return out;
}

// One subscriptions read for the whole activity, then a fan-out.
async function sendEach(jobs: Array<{ userId: string; payload: Row }>) {
  if (!jobs.length) return;
  const ids = [...new Set(jobs.map((j) => j.userId))];
  const { data: subs } = await supabase.from('push_subscriptions')
    .select('user_id,endpoint,p256dh,auth').in('user_id', ids);
  const byUser = new Map<string, Row[]>();
  for (const s of subs || []) {
    const list = byUser.get(s.user_id) || [];
    list.push(s);
    byUser.set(s.user_id, list);
  }
  await Promise.all(jobs.map((j) => deliver(byUser.get(j.userId) || [], j.payload)));
}

async function remindOne(act: Row, stage: Stage, mins: number): Promise<number> {
  // Something that has already started is not a thing to be reminded about.
  if (stage === 'day' && act.event_time) {
    const [h, m] = String(act.event_time).split(':').map(Number);
    if (Number.isFinite(h) && Number.isFinite(m) && h * 60 + m <= mins) return 0;
  }
  const host = await userById(act.author);
  if (!host) return 0;

  // WHO IS INVITED is the post's audience, which is the app's own answer.
  // 'list' is the literal allowlist. 'circle' is the host's mutual friends.
  // 'public' is ALSO the host's mutual friends and deliberately not everyone who
  // can read it: canJoin is friends-only, so anybody else would be asked a
  // question the app will not let them answer, and a public activity's audience
  // is otherwise every account on Tria.
  const invited = act.audience === 'list'
    ? ((await supabase.from('post_audience').select('user_id').eq('post_id', act.id)).data || [])
        .map((r: Row) => r.user_id as string)
    : await mutualFriends(act.author as string);

  const [blocked, heads, already] = await Promise.all([
    blockedWith(act.author as string),
    supabase.from('headcount').select('user_id').eq('post_id', act.id),
    supabase.from('activity_reminders').select('user_id').eq('post_id', act.id).eq('stage', stage),
  ]);
  const going = new Set((heads.data || []).map((r: Row) => r.user_id as string));
  const done = new Set((already.data || []).map((r: Row) => r.user_id as string));

  // Activities always carry a headline (submitComposer refuses one without), so
  // the fallback is a guard and not a case anybody should meet.
  const title = cut(act.title as string) || 'An activity';
  const jobs: Array<{ userId: string; payload: Row }> = [];

  for (const uid of new Set(invited)) {
    if (uid === act.author || blocked.has(uid) || done.has(uid)) continue;
    jobs.push({
      userId: uid,
      payload: {
        title,
        body: reminderBody(host, act, stage, going.has(uid)),
        tag: `activity:${act.id}`,
        collapse: collapseKey(act.id as string, stage, uid),
        url: userPost(host.username, act.id as string),
      },
    });
  }

  if (stage === 'day' && !done.has(act.author as string)) {
    jobs.push({
      userId: act.author as string,
      payload: {
        title,
        body: hostBody(act, going.size),
        tag: `activity:${act.id}`,
        collapse: collapseKey(act.id as string, stage, act.author as string),
        url: selfPost(act.id as string),   // the recipient hosts it
      },
    });
  }
  if (!jobs.length) return 0;

  // JOURNAL FIRST, then send. A crash between the two costs a missed reminder;
  // the other order costs a duplicate on the next hourly pass, and for a
  // notification a repeat is the worse of the two failures.
  const { error } = await supabase.from('activity_reminders').upsert(
    jobs.map((j) => ({ post_id: act.id, user_id: j.userId, stage })),
    { onConflict: 'post_id,user_id,stage', ignoreDuplicates: true },
  );
  if (error) { console.error('reminder journal failed', error.message); return 0; }

  await sendEach(jobs);
  return jobs.length;
}

async function sweepReminders() {
  const now = Date.now();
  const mins = clockTZ(now);
  if (mins < QUIET_FROM || mins >= QUIET_TO) return { skipped: 'quiet hours' };

  const today = dayTZ(now);
  // Three exact days, not three ranges. An activity posted four days out never
  // gets a week-out reminder, which is correct — the moment it names has passed.
  const stageFor = new Map<string, Stage>([
    [shiftDay(today, 7), 'week'],
    [shiftDay(today, 2), 'two'],
    [today, 'day'],
  ]);

  const { data: acts, error } = await supabase.from('posts')
    .select('id,author,title,location,audience,event_date,event_time')
    .eq('type', 'activity')
    .in('event_date', [...stageFor.keys()])
    .limit(200);
  if (error) { console.error('reminder sweep read failed', error.message); return { sent: 0 }; }
  if (!acts?.length) return { sent: 0 };

  let sent = 0;
  for (const act of acts) sent += await remindOne(act, stageFor.get(act.event_date)!, mins);
  return { sent };
}

Deno.serve(async (req) => {
  try {
    const payload = await req.json();
    // The cron sweep and the database webhooks share one function and one URL;
    // only the payload says which is calling. A webhook always carries `table`.
    if (payload.kind === 'activity-reminders') {
      const out = await sweepReminders();
      return new Response(JSON.stringify({ ok: true, ...out }), { headers: { 'content-type': 'application/json' } });
    }
    const table = payload.table as string;
    const rec = (payload.record || {}) as Row;
    if (payload.type === 'INSERT' && rec) await handle(table, rec);
    return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } });
  } catch (e) {
    console.error('push error', e);
    return new Response(JSON.stringify({ ok: false }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
});
