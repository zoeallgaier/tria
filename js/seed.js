/* ── Seed data ─────────────────────────────────────────────────────────────
   The starter world Tria boots into on first run: a small circle of friends and
   the posts on their feed. store.js copies this into localStorage once, then all
   reads/writes go through there — so nothing here is touched again after setup.

   This is a prototype seam: swap this + the store for a real backend later and
   the rest of the app is unchanged. */

// A stand-in profile photo: a soft diagonal gradient as a square SVG data-URI.
// Real uploads replace these; they exist so the avatar treatment (and the
// blurred profile-hero wash) is visible in the seeded demo. Some friends are
// left without one to show the initial-tile fallback.
const gradAvatar = (a, b) => 'data:image/svg+xml,' + encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='400' height='400'>` +
    `<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>` +
      `<stop offset='0' stop-color='${a}'/><stop offset='1' stop-color='${b}'/>` +
    `</linearGradient></defs>` +
    `<rect width='400' height='400' fill='url(#g)'/>` +
    `<circle cx='288' cy='150' r='84' fill='rgba(255,255,255,0.13)'/>` +
  `</svg>`);

window.TRIA_SEED = {

  // No one is signed in until an account is created or a login happens — the
  // app gates on this. The circle below is who a new account lands among.
  session: null,

  users: [
    { username: 'juniper', name: 'Juniper Vale',
      bio: 'making a bowl. mostly.', avatar: gradAvatar('#17b39a', '#2f6fe6') },
    { username: 'arlo',    name: 'Arlo Reyes',
      bio: 'guitars, garden, and old computers.' },
    { username: 'mara',    name: 'Mara Quinn',
      bio: 'photos + tomatoes.', avatar: gradAvatar('#ff9e2c', '#e23127') },
    { username: 'des',     name: 'Des Okafor',
      bio: 'off the group chat, on the trail.', avatar: gradAvatar('#84c74a', '#2f7d55') },
    { username: 'wren',    name: 'Wren Ash',
      bio: 'iced coffee, mostly.' },
  ],

  // The friendship graph — friendship is mutual, so every pairing appears on
  // both sides. The home feed shows a user's mutual friends (+ self). A new
  // signup is auto-friended (both ways) into the first few of this circle.
  friends: {
    juniper: ['arlo', 'mara', 'des', 'wren'],
    arlo:    ['juniper'],
    mara:    ['juniper'],
    des:     ['juniper'],
    wren:    ['juniper'],
  },

  // type: 'post' | 'find' | 'photo'. Title + url are optional (a bare note is a
  // valid post — the funny one-liner). Finds carry an external url.
  posts: [
    { id: 'p15', author: 'juniper', type: 'photo',
      note: 'first ripe strawberry off the balcony.',
      date: '2026-07-05', tags: ['garden'] },

    // A deliberately long one — the "read more" case. Multi-paragraph notes split
    // at the first blank line: the first paragraph is the teaser, the rest expands.
    { id: 'p16', author: 'arlo', type: 'post',
      title: 'Metalheart',
      note: 'found my old mp3 player in a box in the closet today. dead battery, ' +
        'cracked screen, click wheel worn smooth. plugged it in half expecting ' +
        'nothing and the little apple lit up like it had been waiting the whole time.\n\n' +
        '1,412 songs. all of them from one four-year stretch of my life. i had ' +
        'forgotten how much of who i was got decided by whatever was on there — ' +
        'the walking-home songs, the up-too-late songs, the one album i played so ' +
        'many times i can still hear the gap between every track.\n\n' +
        'there is a version of me preserved in that playlist that no streaming ' +
        'algorithm will ever hand back to me. no shuffle across ten thousand ' +
        'songs, no discover weekly. just the exact 1,412 i chose, in the order i ' +
        'chose, back when choosing felt like it meant something.\n\n' +
        'i sat on the floor and listened to the whole thing. would recommend. dig ' +
        'out your old one if you still have it — some of you were whole people ' +
        'inside those little metal hearts and i think we should visit them more.',
      date: '2026-07-05', tags: ['music', 'life'] },

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

  // A comment thread is just { postId, author, text, date }, oldest first —
  // insertion order IS chronological order (see Store.commentsFor). Most
  // posts start with none; a couple are seeded so the feature reads live.
  comments: [
    { id: 'c01', postId: 'p03', author: 'des', text: 'okay but the color on these',
      date: '2026-07-04' },
    { id: 'c02', postId: 'p03', author: 'wren', text: 'jealous, mine are still green',
      date: '2026-07-04' },
    { id: 'c03', postId: 'p04', author: 'juniper', text: 'sending you my address then',
      date: '2026-07-03' },
  ],
};
