/* ── Seed data ─────────────────────────────────────────────────────────────
   The starter world Tria boots into on first run: a small circle of friends and
   the posts on their feed. store.js copies this into localStorage once, then all
   reads/writes go through there — so nothing here is touched again after setup.

   This is a prototype seam: swap this + the store for a real backend later and
   the rest of the app is unchanged. */

window.TRIA_SEED = {

  // No one is signed in until an account is created or a login happens — the
  // app gates on this. The circle below is who a new account lands among.
  session: null,

  users: [
    { username: 'juniper', name: 'Juniper Vale',
      bio: 'making a bowl. mostly.' },
    { username: 'arlo',    name: 'Arlo Reyes',
      bio: 'guitars, garden, and old computers.' },
    { username: 'mara',    name: 'Mara Quinn',
      bio: 'photos + tomatoes.' },
    { username: 'des',     name: 'Des Okafor',
      bio: 'off the group chat, on the trail.' },
    { username: 'wren',    name: 'Wren Ash',
      bio: 'iced coffee, mostly.' },
  ],

  // Who the current user follows — the home feed is these people (+ self).
  follows: {
    juniper: ['arlo', 'mara', 'des', 'wren'],
  },

  // type: 'post' | 'find' | 'photo'. Title + url are optional (a bare note is a
  // valid post — the funny one-liner). Finds carry an external url.
  posts: [
    { id: 'p15', author: 'juniper', type: 'photo',
      note: 'first ripe strawberry off the balcony.',
      date: '2026-07-05', tags: ['garden'] },

    { id: 'p01', author: 'juniper', type: 'post',
      note: 'wifi went out for an hour and i became a person again.',
      date: '2026-07-05', tags: ['life'] },

    { id: 'p02', author: 'arlo', type: 'find',
      title: 'The Solar-Powered Cyberdeck',
      url: 'https://www.youtube.com/watch?v=sVnjyTWPwnc',
      note: 'computers were supposed to be fun.',
      date: '2026-07-04', tags: ['tech', 'diy'] },

    { id: 'p03', author: 'mara', type: 'photo',
      note: 'the tomatoes finally came in 🍅',
      date: '2026-07-04', tags: ['garden'] },

    { id: 'p04', author: 'des', type: 'post',
      title: 'Why I quit the group chat',
      note: 'and started sending letters instead. slower, better.',
      date: '2026-07-03', tags: ['life', 'rant'] },

    { id: 'p05', author: 'wren', type: 'post',
      note: 'no thoughts. just iced coffee and a good book.',
      date: '2026-07-02', tags: ['life'] },

    { id: 'p06', author: 'juniper', type: 'find',
      title: 'A Post-American Internet',
      url: 'https://www.youtube.com/watch?v=39jsstmmUUs',
      note: 'cory doctorow. need i say more.',
      date: '2026-07-01', tags: ['tech', 'politics'] },

    { id: 'p07', author: 'mara', type: 'photo',
      note: 'sunset from the fire escape.',
      date: '2026-06-30', tags: ['city'] },

    { id: 'p08', author: 'arlo', type: 'post',
      note: 'increasingly convinced my houseplant is judging me.',
      date: '2026-06-29', tags: ['funny'] },

    { id: 'p09', author: 'des', type: 'photo',
      note: 'found this little guy on the trail.',
      date: '2026-06-28', tags: ['nature'] },

    { id: 'p10', author: 'wren', type: 'find',
      title: 'How to Draw the Human Hand',
      url: 'https://www.youtube.com/watch?v=EA2Sz9zvGqA',
      note: 'i will never be free of this.',
      date: '2026-06-27', tags: ['art'] },

    { id: 'p11', author: 'juniper', type: 'photo',
      note: 'first pottery class. it is a bowl. mostly.',
      date: '2026-06-26', tags: ['life', 'clay'] },

    { id: 'p12', author: 'mara', type: 'post',
      title: 'The case for the flip phone',
      note: 'week two. i do not miss it even a little.',
      date: '2026-06-25', tags: ['tech'] },

    { id: 'p13', author: 'arlo', type: 'photo',
      note: 'band practice in the garage.',
      date: '2026-06-24', tags: ['music'] },

    { id: 'p14', author: 'wren', type: 'post',
      note: 'sometimes a nap is a form of protest.',
      date: '2026-06-24', tags: ['life', 'funny'] },
  ],
};
