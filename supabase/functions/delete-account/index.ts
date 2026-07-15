// Tria — Delete account (Supabase Edge Function).
//
// Called by the "Delete account" button in Edit profile (js/store.js
// deleteAccount()). Deployed WITHOUT --no-verify-jwt (unlike push), so
// Supabase's gateway rejects a missing/expired/malformed token before this
// code ever runs — that's the first line of defense against deleting someone
// else's account.
//
// Runs with the service role to do the two things a regular signed-in client
// can't:
//   1. Empty the caller's Storage folder (avatars + post photos live at
//      media/{uid}/…, outside the Postgres FK graph, so nothing cascades them).
//   2. Delete the auth.users row via the admin API, which cascades through
//      public.users to every post, comment, like, headcount row, friend edge,
//      block, and push subscription (see schema.sql's `on delete cascade` chain).
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically —
// no extra secrets to set for this one.

import { createClient } from 'npm:@supabase/supabase-js@2';

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

Deno.serve(async (req) => {
  try {
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token)
      return new Response(JSON.stringify({ ok: false, error: 'Not signed in.' }),
        { status: 401, headers: { 'content-type': 'application/json' } });

    // The service-role client can't infer "who called this" on its own — it has
    // to ask the auth server what this specific token resolves to.
    const { data: { user }, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !user)
      return new Response(JSON.stringify({ ok: false, error: 'Session expired. Sign in again and retry.' }),
        { status: 401, headers: { 'content-type': 'application/json' } });

    const uid = user.id;

    const { data: files, error: listErr } = await admin.storage.from('media').list(uid);
    if (listErr) console.error('delete-account: storage list failed', listErr);
    else if (files?.length)
      await admin.storage.from('media').remove(files.map((f) => `${uid}/${f.name}`));

    const { error: delErr } = await admin.auth.admin.deleteUser(uid);
    if (delErr) throw delErr;

    return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } });
  } catch (e) {
    console.error('delete-account error', e);
    return new Response(JSON.stringify({ ok: false, error: 'Could not delete your account. Try again in a moment.' }),
      { status: 500, headers: { 'content-type': 'application/json' } });
  }
});
