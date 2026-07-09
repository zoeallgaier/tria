// Tria — Web Push sender (Supabase Edge Function).
//
// Invoked by Database Webhooks on INSERT into: comments, headcount, friends,
// and posts (posts only for @mentions in a note). It figures out WHO should be
// notified, then delivers a Web Push to each of that person's stored devices.
//
// It runs with the service role, so it can read across users (RLS doesn't apply)
// — that's what lets it see a post's author and their subscriptions. Likes are
// deliberately NOT wired to this function: a like stays a silent private nod.
//
// Secrets it needs (set in the dashboard, see the handoff checklist):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:you@…)
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.

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

// How the post reads to its author in a notification body.
function postLabel(post: Row | null): string {
  const t = ((post?.title || post?.note) ?? '').trim();
  if (t) { const s = t.length > 44 ? t.slice(0, 44).trimEnd() + '…' : t; return `“${s}”`; }
  return post?.type === 'photo' ? 'your photo' : 'your post';
}
function snip(t: string, n = 90) { t = (t || '').trim(); return t.length > n ? t.slice(0, n).trimEnd() + '…' : t; }

// Deliver one payload to every device a user has registered. Prunes endpoints
// the push service reports as gone (404/410).
async function sendTo(userId: string, payload: Row) {
  const { data: subs } = await supabase.from('push_subscriptions')
    .select('endpoint,p256dh,auth').eq('user_id', userId);
  if (!subs?.length) return;
  const body = JSON.stringify({ ...payload, url: payload.url || OPEN_URL });
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body);
    } catch (e: any) {
      // 404/410 = the browser dropped this subscription; prune it. Anything else
      // (VAPID/crypto/import trouble) is logged so the first live test is legible.
      if (e?.statusCode === 404 || e?.statusCode === 410)
        await supabase.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
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
      await sendTo(u.id, { title: `${author.name} mentioned you`, body: snip(rec.note), tag: `post:${rec.id}` });
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
    const who = await userById(rec.a);                  // the person adding
    if (!who) return;
    await sendTo(rec.b, { title: `${who.name} wants to be friends`, body: 'Tap to add them back.', tag: `friend:${rec.a}` });
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
