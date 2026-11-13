// Tria — nudge emails (Supabase Edge Function), sent from the admin dashboard's
// Nudge page (Zoe, 2026-11-11: "Can we do an email for users who haven't
// really been in the funnel?").
//
// POST { ids: uuid[], step, subject, message } with the admin's own session
// (supabase-js `functions.invoke` sends it). The caller must be in `admins`
// (asked as THEM, through is_admin()); only then does the service role look
// up each person's email and send through Resend, the service already behind
// Tria's auth mail. Every send is logged in `nudges` (admin-nudge.sql) and
// nobody in `nudge_stop` is ever written to.
//
// `{name}` in the subject or message is the person's first name.
// The message is plain words: a blank line starts a paragraph. Every email ends
// on an Open Tria button and one line saying how to stop them. Replies go to
// NUDGE_REPLY_TO, so "stop" reaches a person, who marks it on the page.
//
// Secrets (supabase secrets set ...):
//   RESEND_API_KEY   Resend's API key (Resend → API Keys)
//   NUDGE_FROM       optional, default "Tria <hello@triaonline.com>"; the
//                    domain must be verified in Resend
//   NUDGE_REPLY_TO   REQUIRED: where replies land. Without it nothing sends,
//                    because a "reply stop" that bounces is no way out.
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are injected.
//
// Deploy: supabase functions deploy nudge --no-verify-jwt
// (live since 2026-11-12, JWT verification off: the gate is is_admin() below,
// asked as the caller, so an unsigned POST is a 403 and a GET says only the
// From and whether it's ready.)

import { createClient } from 'npm:@supabase/supabase-js@2';

const REV = '2026-11-12';
const URL_ = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND = Deno.env.get('RESEND_API_KEY') || '';
const FROM = Deno.env.get('NUDGE_FROM') || 'Tria <hello@triaonline.com>';
const REPLY_TO = Deno.env.get('NUDGE_REPLY_TO') || '';
const SITE = 'https://triaonline.com/';
const STEPS = ['profile', 'connect', 'post', 'return', 'quiet'];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const esc = (s: string) => s.replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const firstName = (name: string | null, handle: string | null) =>
  (String(name || '').trim().split(/\s+/)[0] || handle || 'there');
const fill = (s: string, name: string) => s.replace(/\{name\}/g, name);

const SANS = "'Oxygen',-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif";
const SERIF = "'Instrument Serif',Georgia,'Times New Roman',serif";

// The auth mail's card (email-templates/), Tria's ramp on the button. The
// admin page draws this as its preview (letterHtml in admin/admin.js, Zoe,
// 2026-11-12: "what does it look like?"): KEEP THE TWO EQUAL BY HAND.
function html(message: string) {
  const paras = message.trim().split(/\n\s*\n/).map((p) =>
    `<p style="font-family:${SANS};font-size:15px;line-height:1.6;color:#14171a;margin:16px 0 0 0;">` +
    esc(p.trim()).replace(/\n/g, '<br>') + '</p>').join('');
  return `<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Oxygen:wght@300;400;700&display=swap" rel="stylesheet" type="text/css">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0;padding:0;background-color:#edeef0;">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:440px;width:100%;background-color:#f6f7f8;border:1px solid #dadde1;border-radius:20px;">
      <tr><td style="padding:40px 36px 36px 36px;">
        <div style="font-family:${SERIF};font-style:italic;font-size:30px;line-height:1;color:#14171a;">tria</div>
        ${paras}
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 0 0;"><tr>
          <td align="center" bgcolor="#00cbb6" style="border-radius:999px;background:linear-gradient(115deg,#00c9ce,#00cc9e);">
            <a href="${SITE}" target="_blank" style="display:inline-block;padding:14px 30px;font-family:${SANS};font-size:15px;font-weight:700;color:#14171a;text-decoration:none;border-radius:999px;">Open Tria</a>
          </td></tr></table>
        <div style="border-top:1px solid #dadde1;margin:32px 0 0 0;"></div>
        <p style="font-family:${SANS};font-size:12px;line-height:1.6;color:#5c636b;margin:20px 0 0 0;">You're getting this because you have a Tria account. Reply "stop" and we won't email you again.</p>
      </td></tr>
    </table>
  </td></tr>
</table>`;
}
const text = (message: string) =>
  `${message.trim()}\n\nOpen Tria: ${SITE}\n\nYou're getting this because you have a Tria account. Reply "stop" and we won't email you again.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  // GET says who it sends from (that is in every email anyway) and whether the
  // secrets are set; never the reply address. The admin page reads it.
  if (req.method === 'GET') return json({ ok: true, rev: REV, from: FROM, ready: !!(RESEND && REPLY_TO) });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);

  // Asked as the caller: only Tria's team.
  const auth = req.headers.get('Authorization') || '';
  const asCaller = createClient(URL_, ANON, { global: { headers: { Authorization: auth } } });
  const [{ data: isAdmin }, { data: who }] = await Promise.all([
    asCaller.rpc('is_admin'), asCaller.auth.getUser(),
  ]);
  if (!isAdmin || !who?.user) return json({ error: 'forbidden' }, 403);
  if (!RESEND || !REPLY_TO) return json({ error: 'not_ready' }, 503);

  let body: { ids?: unknown; step?: unknown; subject?: unknown; message?: unknown };
  try { body = await req.json(); } catch { return json({ error: 'body' }, 400); }
  const ids = Array.isArray(body.ids) ? [...new Set(body.ids.filter((x) => typeof x === 'string'))] as string[] : [];
  const subject = String(body.subject || '').trim().slice(0, 140);
  const message = String(body.message || '').trim().slice(0, 4000);
  const step = STEPS.includes(String(body.step)) ? String(body.step) : 'other';
  if (!ids.length || ids.length > 100 || !subject || !message) return json({ error: 'body' }, 400);

  const svc = createClient(URL_, SERVICE);
  const [{ data: people }, { data: stops }, { data: admins }] = await Promise.all([
    svc.from('users').select('id, name, username').in('id', ids),
    svc.from('nudge_stop').select('user_id').in('user_id', ids),
    svc.from('admins').select('user_id'),
  ]);
  const skip = new Set([...(stops || []), ...(admins || [])].map((r: { user_id: string }) => r.user_id));
  const targets: { id: string; email: string; name: string }[] = [];
  for (const p of people || []) {
    if (skip.has(p.id)) continue;
    const { data } = await svc.auth.admin.getUserById(p.id);
    const email = data?.user?.email;
    if (email) targets.push({ id: p.id, email, name: firstName(p.name, p.username) });
  }
  if (!targets.length) return json({ sent: 0, skipped: ids.length });

  const res = await fetch('https://api.resend.com/emails/batch', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(targets.map((t) => ({
      from: FROM,
      to: [t.email],
      reply_to: REPLY_TO,
      subject: fill(subject, t.name),
      html: html(fill(message, t.name)),
      text: text(fill(message, t.name)),
      headers: { 'List-Unsubscribe': `<mailto:${REPLY_TO}?subject=stop>` },
    }))),
  });
  if (!res.ok) {
    console.log('resend', res.status, await res.text());
    return json({ error: 'resend', status: res.status }, 502);
  }

  await svc.from('nudges').insert(targets.map((t) => ({ user_id: t.id, step, via: 'email', sent_by: who.user!.id })));
  return json({ sent: targets.length, skipped: ids.length - targets.length });
});
