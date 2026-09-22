/* Supabase project config. The *publishable* key is designed to live in the
   browser — Row Level Security (see supabase/schema.sql) is what actually guards
   the data, so this is safe to commit. The secret key must NEVER appear here. */
window.TRIA_CONFIG = {
  url: 'https://autjondbgcjctezbxliv.supabase.co',
  key: 'sb_publishable_HybWJd3J_dDESzb5-OGAbg_9ksocyyQ',
  // VAPID *public* key for Web Push — the browser needs it to subscribe. Public
  // by design (it only lets a subscription name Tria as its sender); the paired
  // private key lives ONLY as a Supabase secret, never here. See the push Edge
  // Function + supabase/push-subscriptions.sql.
  vapidPublicKey: 'BCVwE8VZ8vxQEoMLgFFiV2FEaoWdS5xs6LKfrisGckCrdKYJlaRasxGZd5DnRh9XJq0cL1jaHlMDQhGSaRrSxsk',

  /* Meta app id, which `instagram-stories://share` takes as `source_application`
     and refuses to open without (their rule since January 2023). PUBLIC by
     design, the same way the publishable key above is: it names Tria as the
     sender and grants nothing. It is not an API key, there is no paired secret,
     and it buys exactly one thing — handing a card OUT to Instagram Stories.
     It does not let Tria read anything from Instagram and it is not what would
     put Tria in Instagram's share row. See docs/social-links.md, Stage 4. */
  metaAppId: '2472037233323838',
};
