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

const OPEN_URL = './#/updates';   // where a tapped notification lands

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
  // Same job as the Web Push `tag`: a second comment on one post replaces the
  // first rather than stacking. Apple caps this at 64 bytes.
  if (payload.tag) headers['apns-collapse-id'] = String(payload.tag).slice(0, 64);

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
  if (!subs?.length) return;
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
      await sendTo(post.author, { title: `${author.name} commented`, body: snip(rec.body) || `Commented on ${postLabel(post)}`, tag: `post:${post.id}` });
      notified.add(post.author);
    }
    // Anyone @mentioned in the comment who is a mutual friend of the commenter.
    for (const uname of new Set([...(rec.body || '').matchAll(/@(\w+)/g)].map(m => m[1]))) {
      const u = await userByName(uname);
      if (!u || u.id === rec.author || notified.has(u.id)) continue;
      if (!(await areFriends(u.id, rec.author))) continue;
      await sendTo(u.id, { title: `${author.name} mentioned you`, body: snip(rec.body), tag: `post:${post.id}` });
      notified.add(u.id);
    }
    return;
  }

  if (table === 'posts') {
    // Posts fire only to catch @mentions in the note (comments cover the rest).
    const author = await userById(rec.author);
    if (!author || !rec.note) return;
    for (const uname of new Set([...(rec.note as string).matchAll(/@(\w+)/g)].map(m => m[1]))) {
      const u = await userByName(uname);
      if (!u || u.id === rec.author) continue;
      if (!(await areFriends(u.id, rec.author))) continue;
      await sendTo(u.id, { title: `${author.name} mentioned you`, body: snip(plain(rec.note as string)), tag: `post:${rec.id}` });
    }
    return;
  }

  if (table === 'headcount') {
    // A friend RSVP'd "going" to an activity you host.
    const post = await postById(rec.post_id);
    if (!post || post.author === rec.user_id) return;   // host can't RSVP self
    const who = await userById(rec.user_id);
    if (!who) return;
    await sendTo(post.author, { title: `${who.name} is in`, body: `Going to ${postLabel(post)}`, tag: `going:${post.id}` });
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
    await sendTo(rec.b, pending
      ? { title: `${who.name} wants to be friends`, body: 'Tap to add them back.', tag: `friend:${rec.a}` }
      : { title: `${who.name} started following you`, body: 'Tap to see their profile.', tag: `friend:${rec.a}` });
    return;
  }
}

Deno.serve(async (req) => {
  try {
    const payload = await req.json();
    const table = payload.table as string;
    const rec = (payload.record || {}) as Row;
    if (payload.type === 'INSERT' && rec) await handle(table, rec);
    return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } });
  } catch (e) {
    console.error('push error', e);
    return new Response(JSON.stringify({ ok: false }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
});
