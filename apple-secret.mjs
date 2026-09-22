#!/usr/bin/env node
// Mint Apple's OAuth client secret for Supabase's Apple provider.
//
//   node apple-secret.mjs AuthKey_XXXXXXXXXX.p8 <KeyID> [ServicesID] [TeamID]
//
// Apple's "client secret" is not a secret you are given. It is a JWT you SIGN,
// with the .p8 key from the developer portal, and Supabase's Secret Key field
// wants that token — not the contents of the file. Pasting the .p8 in is the
// most natural wrong move here, and GoTrue's answer to it is the same
// "missing OAuth secret" as pasting nothing at all.
//
// AND IT EXPIRES. Apple caps the lifetime at six months (15777000 seconds from
// iat, and it rejects anything longer), which makes this the one credential in
// Tria that stops working on a date rather than on a change. Nothing in the app
// will see it coming: Sign in with Apple simply begins failing, on the web
// first, because the native path checks the identity token against Apple's
// public keys and never uses this secret at all (see supabase/OAUTH-SETUP.md).
// So re-run this before the date it prints and paste the new token in.
//
// No dependencies, because a JWT is three base64url strings and Node can sign
// ES256 on its own. The one catch is the encoding: JOSE wants the raw r||s
// signature and OpenSSL hands back DER by default, so `dsaEncoding` is
// load-bearing — without it Apple rejects a token that looks perfectly formed.
//
// The .p8 never leaves this machine and must never enter this repo. It is the
// only secret in Tria's setup that isn't public by design (compare the
// publishable key and the VAPID public key, which are both committed).

import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';

const TEAM_ID = '8L793UU9T2';                    // Tria's Apple developer team
const SERVICES_ID = 'com.triaonline.tria.web';   // the WEB client, not the bundle id
const MAX_LIFETIME = 15777000;                   // six months, Apple's ceiling

const [, , p8Path, keyId, servicesId = SERVICES_ID, teamId = TEAM_ID] = process.argv;

if (!p8Path || !keyId) {
  console.error('usage: node apple-secret.mjs <AuthKey_XXXXXXXXXX.p8> <KeyID> [ServicesID] [TeamID]');
  process.exit(1);
}

const b64url = (input) => Buffer.from(input).toString('base64url');

let key;
try {
  key = createPrivateKey(readFileSync(p8Path));
} catch (e) {
  console.error(`Couldn't read a private key out of ${p8Path}: ${e.message}`);
  console.error('It should be the file the developer portal downloaded, beginning "-----BEGIN PRIVATE KEY-----".');
  process.exit(1);
}

const iat = Math.floor(Date.now() / 1000);
const exp = iat + MAX_LIFETIME;

// `sub` is the SERVICES ID and not the bundle id. This token is for the web
// flow's code exchange; the bundle id's only job is to be in the Client IDs
// list, where it answers for the identity token's audience.
const header = { alg: 'ES256', kid: keyId };
const payload = { iss: teamId, iat, exp, aud: 'https://appleid.apple.com', sub: servicesId };

const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
const signature = sign('sha256', Buffer.from(signingInput), { key, dsaEncoding: 'ieee-p1363' });

console.log(`${signingInput}.${b64url(signature)}`);
console.error('');
console.error(`  team     ${teamId}`);
console.error(`  key      ${keyId}`);
console.error(`  subject  ${servicesId}`);
console.error(`  EXPIRES  ${new Date(exp * 1000).toISOString().slice(0, 10)}  <- diary this`);
console.error('');
console.error('Paste the line above into Supabase > Sign In / Providers > Apple > Secret Key.');
