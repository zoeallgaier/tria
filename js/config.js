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
};
