/* Tria admin (Zoe, 2026-11-11): the numbers that matter for a word of mouth
   beta, and the Dictionary. Reads supabase/admin-dashboard.sql's and
   admin-extras.sql's admin_* functions, which refuse anyone not in
   public.admins and leave admins themselves out of every number. Same origin
   as the site, so a session made on triaonline.com is this page's too.
   `?demo` draws sample numbers, flagged.

   THE LAYOUT IS TRIA'S OWN (Zoe: "This shouldn't really be different from the
   standard tria layout"): the inset glass rail on a desktop, wordmark ruled
   off at its head and the way back to your profile at its foot; on a phone
   the floating glass capsule and a top bar with a back chevron, the page's
   name centred, the band and hairline only once content is under it. There
   is no Log out here (Zoe: "I don't want to log out I want to go back to my
   account"). Copy is as few words as do the job (Zoe: "use as little words as
   possible"); definitions live in the hover cards and the Dictionary. */
(() => {
  'use strict';

  const { url, key } = window.TRIA_CONFIG;
  const sb = window.supabase.createClient(url, key);
  const DEMO = new URLSearchParams(location.search).has('demo');
  const $ = (id) => document.getElementById(id);
  const main = $('main'), bar = $('bar'), barTitle = $('bar-title');
  const dock = $('dock'), dockPill = $('dock-pill'), rail = $('rail'), railList = $('rail-list');
  const refreshBtn = $('refresh'), asof = $('asof'), face = $('face');
  const tip = $('tooltip');
  const PROFILE = '../#/profile';

  const ICON = {
    overview: '<path d="M5 20v-6M12 20V5M19 20v-10"/>',
    // Activity: a pulse.
    activity: '<path d="M3 12h4l2.5-6 5 12 2.5-6h4"/>',
    // Nudge: an envelope.
    nudge: '<rect x="3" y="5.5" width="18" height="13" rx="3"/><path d="m3.8 7.2 8.2 6 8.2-6"/>',
    // Dailies: the app's daily sun.
    dailies: '<circle cx="12" cy="12" r="4"/><path d="M12 2.8v2.2M12 19v2.2M2.8 12H5M19 12h2.2M5.5 5.5l1.6 1.6M16.9 16.9l1.6 1.6M5.5 18.5l1.6-1.6M16.9 7.1l1.6-1.6"/>',
    // They asked us to stop: a struck envelope.
    stop: '<rect x="3" y="5.5" width="18" height="13" rx="3"/><path d="m3.8 7.2 8.2 6 8.2-6"/><path d="M4 3.5 20 20.5"/>',
    // The app's own friends mark (ICONS.friends in app.js).
    community: '<circle cx="8.3" cy="9" r="2.7"/><circle cx="15.7" cy="9" r="2.7"/><path d="M3.5 19.5a4.8 4.8 0 0 1 9.6 0"/><path d="M10.9 19.5a4.8 4.8 0 0 1 9.6 0"/>',
    dictionary: '<path d="M5 19.5v-15A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5 1.5 1.5 0 0 0 6.5 21H19"/>',
    refresh: '<path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/>',
    chevron: '<path d="M15 5.5 8 12l7 6.5"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.4-4.4"/>',
    lock: '<rect x="5" y="11" width="14" height="9.5" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  };
  const svg = (k, cls = 'i') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>`;

  // Settling in (the funnel) lives in the Overview since 2026-11-11 (Zoe:
  // "settling in can be in overview"); Who to nudge and the dailies have pages
  // of their own. Retention went on 2026-11-12 (Zoe: "remove"); its week 1
  // figure stays on the Overview, so admin_retention is still read there.
  const TABS = [
    { key: 'overview', label: 'Overview' },
    { key: 'activity', label: 'Activity' },
    { key: 'nudge', label: 'Nudge' },
    { key: 'community', label: 'Community' },
    { key: 'dailies', label: 'Dailies' },
    { key: 'dictionary', label: 'Dictionary' },
  ];
  let dataOk = false;          // an admin and the SQL is run (or demo)
  let extrasOk = true;         // admin-extras.sql answers
  let extrasWhy = '';          // and, when it doesn't, what to run
  let nudgeOk = true, nudgeWhy = '';     // admin-nudge.sql
  const cache = {};

  // ── Small things ──────────────────────────────────────────────────────────
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => (n == null ? '–' : Number(n).toLocaleString('en-US'));
  const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
  const pctTxt = (v) => (v == null ? '–' : (v >= 10 || v === 0 ? Math.round(v) : v.toFixed(1)) + '%');
  const hours = (h) => {
    if (h == null) return '–';
    if (h < 1) return Math.max(1, Math.round(h * 60)) + ' min';
    if (h < 48) return (h < 10 ? h.toFixed(1) : Math.round(h)) + ' h';
    return (h / 24).toFixed(1) + ' days';
  };
  const day = (iso) => new Date(String(iso).slice(0, 10) + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const clock = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const ago = (iso) => {
    const d = (Date.now() - new Date(iso)) / 86400000;
    return d < 1 ? 'today' : d < 2 ? 'yesterday' : d < 14 ? Math.floor(d) + ' days ago' : day(iso);
  };
  const missing = (err) => err && (err.code === 'PGRST202' || err.code === '42883');

  // ── The hover card ────────────────────────────────────────────────────────
  function showTip(html, x, y) {
    tip.innerHTML = html;
    tip.hidden = false;
    const r = tip.getBoundingClientRect();
    tip.style.left = Math.min(window.innerWidth - r.width - 8, Math.max(8, x + 14)) + 'px';
    tip.style.top = (y - r.height - 12 < 8 ? y + 16 : y - r.height - 12) + 'px';
  }
  const hideTip = () => { tip.hidden = true; };
  document.addEventListener('pointerover', (e) => {
    const t = e.target.closest('[data-tip]');
    if (t) showTip(t.dataset.tip, e.clientX, e.clientY);
  });
  document.addEventListener('pointermove', (e) => {
    const t = e.target.closest('[data-tip]');
    if (t && !tip.hidden) showTip(t.dataset.tip, e.clientX, e.clientY);
  });
  document.addEventListener('pointerout', (e) => {
    if (e.target.closest('[data-tip]') && !e.relatedTarget?.closest?.('[data-tip]')) hideTip();
  });

  // ── The bar: its band once content is under it; on a desktop its title
  //    once the page's own has gone under (a phone always shows it). ───────
  let titleWatch = null;
  function watchTitle(title) {
    barTitle.textContent = title;
    document.title = title ? `${title} · Tria admin` : 'Tria admin';
    titleWatch?.disconnect();
    bar.classList.remove('is-titled');
    const h1 = main.querySelector('h1');
    if (!h1) return;
    titleWatch = new IntersectionObserver(([e]) => {
      bar.classList.toggle('is-titled', !e.isIntersecting && e.boundingClientRect.top < bar.offsetHeight);
    }, { rootMargin: `-${bar.offsetHeight}px 0px 0px 0px` });
    titleWatch.observe(h1);
  }
  const syncUnder = () => bar.classList.toggle('is-under', window.scrollY > 2);
  window.addEventListener('scroll', () => { hideTip(); syncUnder(); }, { passive: true });

  // ── Data ──────────────────────────────────────────────────────────────────
  async function call(fn, args) {
    const id = fn + JSON.stringify(args || {});
    if (cache[id]) return cache[id];
    if (DEMO) return (cache[id] = SAMPLE[fn](args || {}));
    const { data, error } = await sb.rpc(fn, args || {});
    if (error) throw error;
    asof.textContent = 'Updated ' + clock(new Date());
    return (cache[id] = data);
  }
  // admin-extras.sql may not be run yet, or run before admin-dashboard.sql's
  // newer half (it reads metrics.people, 42P01 without it): null and a line
  // saying which file to run, never a throw, so the Overview still draws.
  async function extras() {
    if (!extrasOk) return null;
    try { return await call('admin_extras'); } catch (err) {
      extrasOk = false;
      extrasWhy = missing(err) ? 'Run <b>supabase/admin-extras.sql</b>.'
        : err?.code === '42P01' ? 'Re-run <b>supabase/admin-dashboard.sql</b>, then this fills in.'
        : 'Couldn\'t load these. ' + esc(err?.message || '');
      return null;
    }
  }
  // admin-nudge.sql the same way: null and what to run.
  async function nudgeData() {
    if (!nudgeOk) return null;
    try { return await call('admin_nudge'); } catch (err) {
      nudgeOk = false;
      nudgeWhy = missing(err) || err?.code === '42P01' ? 'Run <b>supabase/admin-nudge.sql</b> for email addresses and sending.'
        : 'Couldn\'t load these. ' + esc(err?.message || '');
      return null;
    }
  }
  // One section's numbers failing never blanks the page: each call settles
  // on its own, a failure is null.
  const settle = (ps) => Promise.allSettled(ps).then((rs) => rs.map((r) => (r.status === 'fulfilled' ? r.value : null)));

  // ── Shell ─────────────────────────────────────────────────────────────────
  function currentTab() {
    const h = location.hash.slice(1);
    if (!dataOk) return 'dictionary';
    return TABS.some((t) => t.key === h) ? h : 'overview';
  }
  // An old #funnel link lands on the Overview's Settling in.
  const wantsFunnel = () => location.hash === '#funnel';
  function paintShell(on) {
    rail.hidden = !on; dock.hidden = !on;
    document.body.classList.toggle('has-shell', on);
    refreshBtn.hidden = !on || !dataOk;
    if (!on) return;
    const cur = currentTab();
    const item = (t, cls) => {
      const dead = !dataOk && t.key !== 'dictionary';
      return `<button class="${cls}" type="button" data-tab="${t.key}" aria-label="${esc(t.label)}"` +
        `${t.key === cur ? ' aria-current="page"' : ''}${dead ? ' disabled' : ''}>` +
        `${svg(t.key)}<span class="lbl">${esc(t.label)}</span></button>`;
    };
    dockPill.innerHTML = TABS.map((t) => item(t, 'dock-tab')).join('');
    railList.innerHTML = TABS.map((t) => item(t, 'rail-row')).join('');
  }
  for (const el of [dockPill, railList]) {
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-tab]');
      if (!b || b.disabled) return;
      if (location.hash.slice(1) === b.dataset.tab) window.scrollTo({ top: 0, behavior: 'smooth' });
      else location.hash = b.dataset.tab;
    });
  }
  $('bar-back').innerHTML = svg('chevron');
  refreshBtn.innerHTML = svg('refresh');
  refreshBtn.addEventListener('click', async () => {
    for (const k in cache) delete cache[k];
    extrasOk = true;
    extrasWhy = '';
    nudgeOk = true;
    nudgeWhy = '';
    sender = null;
    refreshBtn.classList.add('is-spinning');
    const y = window.scrollY;
    await render(false);
    window.scrollTo(0, y);
    refreshBtn.classList.remove('is-spinning');
  });
  window.addEventListener('hashchange', () => render(true));

  async function render(top = true) {
    hideTip();
    paintShell(true);
    if (top) window.scrollTo(0, 0);
    const t = currentTab();
    try {
      if (t === 'overview') await renderOverview();
      else if (t === 'activity') await renderActivity();
      else if (t === 'nudge') await renderNudge();
      else if (t === 'community') await renderCommunity();
      else if (t === 'dailies') await renderDailies();
      else renderDictionary();
    } catch (err) {
      main.innerHTML = `<div class="gate"><h1>Hm.</h1><p>Couldn't load that. ${esc(err.message || '')}</p></div>`;
    }
    if (!dataOk && !DEMO) {
      main.insertAdjacentHTML('afterbegin',
        '<div class="callout banner">Numbers need <b>supabase/admin-dashboard.sql</b> run.</div>');
    }
    leadNote();
    watchTitle(TABS.find((x) => x.key === t)?.label || '');
    syncUnder();
    if (t === 'overview' && wantsFunnel()) $('funnel')?.scrollIntoView();
  }

  // Your face at the rail's foot, the way back to your profile.
  async function paintFace(userId) {
    if (DEMO || !userId) return;
    const { data } = await sb.from('users').select('name, avatar').eq('id', userId).maybeSingle();
    if (!data) return;
    face.innerHTML = data.avatar
      ? `<img src="${esc(data.avatar)}" alt="" />`
      : esc((data.name || '?').trim().charAt(0).toUpperCase());
  }

  // ── The gate ──────────────────────────────────────────────────────────────
  function renderSignIn() {
    paintShell(false);
    barTitle.textContent = '';
    main.innerHTML = `
      <div class="gate">
        <h1>Tria admin</h1>
        <form id="signin" novalidate>
          <input class="field" type="email" name="email" placeholder="Email" autocomplete="email" required />
          <input class="field" type="password" name="password" placeholder="Password" autocomplete="current-password" required />
          <p class="err" id="err"></p>
          <button class="publish-fill" type="submit">Log in</button>
        </form>
        <p class="note">Apple or Google? <a href="../">Log in on Tria</a> first.</p>
      </div>`;
    const form = $('signin');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button');
      btn.disabled = true;
      const { error } = await sb.auth.signInWithPassword({
        email: form.email.value.trim(), password: form.password.value,
      }).catch((err) => ({ error: err }));
      btn.disabled = false;
      if (error) { $('err').textContent = 'That email and password don\'t match.'; return; }
      boot();
    });
  }

  async function boot() {
    hideTip();
    for (const k in cache) delete cache[k];
    if (DEMO) { dataOk = true; render(); return; }
    main.innerHTML = '';
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { renderSignIn(); return; }
    paintFace(session.user.id);
    const { data: isAdmin, error } = await sb.rpc('is_admin');
    if (missing(error)) { dataOk = false; render(); return; }
    if (!isAdmin) {
      paintShell(false);
      main.innerHTML = `<div class="gate"><h1>Not here.</h1><p>This page is for Tria's team.</p>` +
        `<a class="pill-quiet gate-back" href="${PROFILE}">Back to Tria</a></div>`;
      return;
    }
    dataOk = true;
    render();
  }

  // ── Building blocks ───────────────────────────────────────────────────────
  const headHtml = (title) =>
    `<div class="head"><h1>${esc(title)}</h1>${DEMO ? '<span class="sample-flag">Sample data</span>' : ''}</div>`;
  const sectionHead = (title, sub, link) =>
    `<div class="section-head"><h2>${esc(title)}</h2>${link || ''}${sub ? `<p class="sub">${sub}</p>` : ''}</div>`;
  // A change on the week before: an arrow and a word, never colour alone.
  function delta(now, before, unit = '', than = 'last week') {
    if (before == null || now == null) return '';
    const d = Math.round((now - before) * 10) / 10;
    if (!d) return `<span class="delta">Same as ${than}</span>`;
    return `<span class="delta ${d > 0 ? 'is-up' : 'is-down'}">${d > 0 ? '↑' : '↓'} ${fmt(Math.abs(d))}${unit} on ${than}</span>`;
  }
  function tile(label, value, note, tipText, cls = '', attrs = '') {
    return `<div class="card tile${cls ? ' ' + cls : ''}"${tipText ? ` data-tip="${esc(tipText)}"` : ''}${attrs}>` +
      `<div class="tile-label">${esc(label)}</div><div class="tile-value">${value}</div>` +
      (note ? `<div class="tile-note">${note}</div>` : '') + '</div>';
  }
  // A row of small figures in one card.
  const strip = (items) => '<div class="card strip">' + items.map(([label, value, tipText]) =>
    `<div class="strip-item"${tipText ? ` data-tip="${esc(tipText)}"` : ''}><div class="strip-value">${value}</div><div class="strip-label">${esc(label)}</div></div>`).join('') + '</div>';
  // An inset grouped list row: title (and sub), then a value. A list is for
  // records (people, days); a number across kinds is bars.
  function row({ title, sub, val, lead, tipText, cls }) {
    return `<div class="row${cls ? ' ' + cls : ''}"${tipText ? ` data-tip="${esc(tipText)}"` : ''}>${lead || ''}` +
      `<div class="row-main"><div class="row-title">${title}</div>${sub ? `<div class="row-sub">${sub}</div>` : ''}</div>` +
      (val != null ? `<div class="row-val">${val}</div>` : '') + '</div>';
  }
  const list = (rows, more) => `<div class="list">${rows.join('')}${more || ''}</div>`;
  function segmented(name, opts, cur, label) {
    return `<div><span class="control-label" id="seg-${name}">${esc(label)}</span>` +
      `<div class="segmented" role="group" aria-labelledby="seg-${name}">` + opts.map(([v, l]) =>
        `<button type="button" data-${name}="${esc(v)}" aria-pressed="${String(v) === String(cur)}">${esc(l)}</button>`).join('') +
      '</div></div>';
  }

  // ── The three chart styles (Zoe, 2026-11-12: "use like max 3 styles of
  //    charts for data, picking the best options for the type of data") ──────
  //   THE LINE, anything over time (lineChart, mountLine).
  //   THE BARS, anything across kinds: counts, shares, a distribution, a
  //     ranking (barChart).
  //   THE HEATMAP, weekday by hour, the one two-way grid (rhythmHtml).
  // Columns and the lists' little meters are gone; a list is for records.
  // One hue (--data) everywhere; a second line is dashed in muted ink.

  // THE BARS. Each row is its name over its bar, the value to its right. With
  // `total`, a bar is its share of that whole and the value is the percent
  // over the count; without, bars are against the longest and the value is
  // the number. `sort: false` keeps an order that means something (friends
  // each, weekdays). `max` sets the scale (two charts read side by side).
  // `pick` ({ on }) makes each row a way to show just that.
  // A row: { key, n, name (html), lead, sub, val, small, tip, cls }.
  function barChart(rows, { total, max: scale, sort = true, pick, empty = 'Nothing yet.' } = {}) {
    let rs = rows.filter((r) => r.n > 0 || r.keep);
    if (sort) rs = rs.slice().sort((a, b) => b.n - a.n);
    if (!rs.length) return `<p class="empty">${empty}</p>`;
    const max = total || scale || Math.max(1, ...rs.map((r) => r.n));
    const hasOn = pick && rs.some((r) => r.key === pick.on);
    return `<div class="bars${hasOn ? ' has-on' : ''}">` + rs.map((r) => {
      const val = r.val ?? (total ? pctTxt(pct(r.n, total)) : fmt(r.n));
      const small = r.small ?? (total ? fmt(r.n) : '');
      const tipText = (r.tip ?? `<b>${r.name}</b><br>${fmt(r.n)}${total ? ` of ${fmt(total)}, ${pctTxt(pct(r.n, total))}` : ''}`) +
        (pick ? `<br>${pick.on === r.key ? 'Tap to show everything' : 'Tap to show just this'}` : '');
      return `<div class="barrow${r.cls ? ' ' + r.cls : ''}${pick ? ' is-pick' + (pick.on === r.key ? ' is-on' : '') : ''}" data-tip="${esc(tipText)}"${pick ? pickAttrs(r.key, pick.on) : ''}>` +
        `<span class="barrow-name">${r.lead || ''}<span>${r.name}</span></span>` +
        `<span class="barrow-val"><b>${val}</b>${small ? `<small>${small}</small>` : ''}</span>` +
        `<span class="barrow-track" aria-hidden="true"><span class="barrow-fill" style="width:${Math.min(100, (r.n / max) * 100)}%"></span></span>` +
        (r.sub ? `<span class="barrow-sub">${r.sub}</span>` : '') + '</div>';
    }).join('') + '</div>';
  }
  // Rows off { key: n } or { key: { n, people, prev } }: the change on the
  // window before as the small line, and who in the tip.
  function countRows(obj, names, before) {
    return Object.entries(obj || {}).map(([k, v]) => {
      v = typeof v === 'number' ? { n: v } : v;
      const name = esc(names[k] || k);
      const ch = v.prev != null && v.prev !== v.n
        ? `<span class="${v.n > v.prev ? 'is-up' : 'is-down'}">${v.n > v.prev ? '↑' : '↓'} ${fmt(Math.abs(v.n - v.prev))}</span>` : '';
      return { key: k, n: v.n || 0, name, small: ch,
        tip: `<b>${name}</b><br>${fmt(v.n)}` + (v.people != null ? `, by ${fmt(v.people)} ${v.people === 1 ? 'person' : 'people'}` : '') +
          (v.prev != null ? `<br>${fmt(v.prev)} ${esc(before || '')}` : '') };
    });
  }
  // Rows off { key: n } as shares of a whole.
  const shareRows = (obj, names) => Object.entries(obj || {}).map(([k, n]) => ({ key: k, n: n || 0, name: esc(names[k] || k) }));
  const sumOf = (obj) => Object.values(obj || {}).reduce((a, v) => a + (Number(v) || 0), 0);
  // A chart is drawn at its card's own width, so its words are their real size.
  const chartW = (el) => Math.round(Math.max(260, Math.min(980, (el?.clientWidth || main.clientWidth) - 36))) || 600;
  function niceMax(v) {
    const p = Math.pow(10, Math.floor(Math.log10(Math.max(1, v))));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
    return 10 * p;
  }

  // THE LINE. `points` in time order; `lines` one or two { key, name, late }:
  // the first solid over its area, the second dashed in muted ink, both on
  // ONE axis; a `late` line starts at its first point above zero (the open
  // ping's lines). `at` names each point's date. `head(p, i)` heads a point's
  // hover card and `more(p, i)` follows its numbers. `soFar`: the last point
  // is still going (today, this week), so the first line's last stretch is
  // dotted rather than read as a fall.
  function lineChart(points, W, { lines, at = 'week', head, more, soFar = false, label = '' }) {
    const n = points.length;
    if (!n) return { html: '<p class="empty">Nothing yet.</p>', wire() {} };
    const H = W < 480 ? 190 : 220, L = 34, R = 10, T = 12, B = 26;
    const v = (p, l) => Number(p[l.key]) || 0;
    const nice = niceMax(Math.max(1, ...points.map((p) => Math.max(...lines.map((l) => v(p, l))))));
    const x = (i) => L + (n === 1 ? (W - L - R) / 2 : (i / (n - 1)) * (W - L - R));
    const y = (val) => T + (1 - val / nice) * (H - T - B);
    const from = lines.map((l) => (l.late ? points.findIndex((p) => v(p, l) > 0) : 0));
    const drawn = from.map((f) => f >= 0);
    const path = (l, j, a, b) => {
      let d = '';
      for (let i = Math.max(a, from[j]); i <= b; i++) d += `${d ? 'L' : 'M'}${x(i).toFixed(1)},${y(v(points[i], l)).toFixed(1)}`;
      return d;
    };
    const cut = soFar && n > 2 ? n - 2 : n - 1;   // where the first line's solid stretch ends
    let g = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">`;
    [0, nice / 2, nice].forEach((t) => {
      g += `<line class="${t ? 'gridline' : 'baseline'}" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/>` +
        `<text x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${fmt(t)}</text>`;
    });
    // A date label every ~64px, whatever the number of points, the last always.
    const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor((W - L - R) / 64))));
    points.forEach((p, i) => {
      if ((n - 1 - i) % every === 0) g += `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${esc(day(p[at]))}</text>`;
    });
    const solid = path(lines[0], 0, 0, cut);
    g += `<path class="area" d="${solid}L${x(cut)},${y(0)}L${x(0)},${y(0)}Z"/>`;
    lines.forEach((l, j) => { if (j && drawn[j]) g += `<path class="line line--b" d="${path(l, j, 0, n - 1)}"/>`; });
    g += `<path class="line line--a" d="${solid}"/>`;
    if (cut < n - 1) g += `<path class="line line--a line--sofar" d="${path(lines[0], 0, cut, n - 1)}"/>`;
    g += `<line class="cross" x1="0" x2="0" y1="${T}" y2="${H - B}" visibility="hidden"/>`;
    lines.forEach((l, j) => { g += `<circle class="dot dot--${j ? 'b' : 'a'}" r="4" visibility="hidden"/>`; });
    g += `<rect class="hit" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}"/></svg>`;
    const legend = lines.length > 1 && drawn[1]
      ? '<ul class="legend">' + lines.map((l, j) => `<li><span class="swatch${j ? ' swatch--b' : ''}"></span>${esc(l.name)}</li>`).join('') + '</ul>' : '';
    return { html: legend + g, wire(root) {
      const el = root.querySelector('svg.chart');
      const cross = el.querySelector('.cross'), dots = [...el.querySelectorAll('.dot')];
      const at_ = (e) => {
        const r = el.getBoundingClientRect();
        const vx = ((e.clientX - r.left) / r.width) * W;
        const i = n === 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round(((vx - L) / (W - L - R)) * (n - 1))));
        const p = points[i];
        cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
        let t = head ? head(p, i) : `<b>${esc(day(p[at]))}</b>`;
        lines.forEach((l, j) => {
          const on = drawn[j] && i >= from[j];
          dots[j].setAttribute('cx', x(i)); dots[j].setAttribute('cy', y(v(p, l)));
          dots[j].setAttribute('visibility', on ? 'visible' : 'hidden');
          if (on) t += `<br><span class="k${j ? ' k--b' : ''}"></span>${esc(l.name)} ${fmt(v(p, l))}`;
        });
        if (more) t += more(p, i);
        showTip(t, e.clientX, e.clientY);
      };
      const hit = el.querySelector('.hit');
      hit.addEventListener('pointermove', at_);
      hit.addEventListener('pointerdown', at_);
      hit.addEventListener('pointerleave', () => { hideTip(); [cross, ...dots].forEach((d) => d.setAttribute('visibility', 'hidden')); });
    } };
  }
  // Draw a line chart into its card, at the card's width.
  function mountLine(el, points, opts) {
    if (!el) return;
    const c = lineChart(points, chartW(el), opts);
    el.innerHTML = c.html;
    c.wire(el);
  }
  const addDays = (iso, n) => { const d = new Date(String(iso).slice(0, 10) + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString(); };
  const weekTo = (p) => `<b>Week to ${esc(day(addDays(p.week, 6)))}</b>`;

  // ── Names ─────────────────────────────────────────────────────────────────
  const TYPE_NAMES = {
    note: 'Notes', photo: 'Frames', take: 'Takes', find: 'Finds', poll: 'Polls',
    activity: 'Plans', song: 'Music', repost: 'Reposts', quote: 'Quotes', moment: 'Moments', daily: 'Daily answers',
  };
  const KIND_NAMES = {
    post: 'Posts', moment: 'Moments', daily: 'Daily answers', comment: 'Comments', message: 'Messages',
    rsvp: 'RSVPs', vote: 'Poll votes', friend: 'Friendships', circle: 'Circle joins',
  };
  const PLATFORM = { ios: 'iOS app', pwa: 'Home screen', web: 'Web', unknown: 'Before tracking' };
  const SOURCE = { invite: 'Invite', circle: 'Circle link', profile: 'Profile link', post: 'Post link', daily: 'Daily link', referral: 'Another site', direct: 'Direct', unknown: 'Before tracking' };
  const SKIP_NOTE = 'Your own activity and the App Review test account aren\'t counted.';
  const foot = () => `<p class="footnote">${SKIP_NOTE}</p>`;
  // The caveats lead the page, under its title and controls (Zoe, 2026-11-11:
  // "put disclaimer on top since i want to know"); they were its last line.
  function leadNote() {
    const n = main.querySelector(':scope > .footnote');
    const at = main.querySelector(':scope > .controls') || main.querySelector(':scope > .head');
    if (n && at && at.nextElementSibling !== n) at.after(n);
  }


  // ── Overview: the pulse of a word of mouth beta ───────────────────────────
  // Since 2026-11-11 (Zoe) it also holds Monthly active, the week's rhythm
  // ("put when busiest graph in overview") and Settling in, the funnel
  // ("settling in can be in overview"); Who to nudge went to its own page.
  const who = (p) => `<a class="who" href="../#/u/${encodeURIComponent(p.handle)}">${esc(p.name)}</a>`;

  async function renderOverview() {
    // admin_overview is the page; the rest are sections that draw when they
    // answer and say so when they don't (Zoe, 2026-11-11: "what happened to
    // the overview?", one 42P01 in admin_extras had blanked all of it).
    const [o, st, src30, ret, x, z] = await settle([
      call('admin_overview'),
      call('admin_settling', { p_days: 30 }),
      call('admin_funnel', { p_days: 30, p_basis: 'account', p_by: 'source' }),
      call('admin_retention'),
      extras(),
      nudgeData(),
    ]);
    if (!o) throw new Error('admin_overview didn\'t answer.');
    const s = (o.series || []).map((w) => ({ ...w, active: w.active || 0, opened: w.opened || 0, joined: w.joined || 0 }));
    const cur = s[s.length - 1], prev = s[s.length - 2];
    // The monthly line needs admin-dashboard.sql re-run (2026-11-11).
    const hasMonthly = s.some((w) => w.monthly != null);
    const hist = (o.history || []).map((w) => ({ week: w.week, monthly: w.monthly || 0, weekly: w.weekly || 0 }));

    // Week 1 retention: the last four cohorts old enough to say.
    const ripe = (ret?.cohorts || []).filter((c) => c.weeks?.[0]?.eligible > 0).slice(-4);
    const w1 = ripe.length ? pct(ripe.reduce((a, c) => a + c.weeks[0].alive, 0), ripe.reduce((a, c) => a + c.weeks[0].eligible, 0)) : null;

    // Word of mouth: the share of last month's accounts that came by invite.
    const srcGroups = src30?.groups || [];
    const invited = srcGroups.find((r) => r.key === 'invite')?.seq?.[1] || 0;
    const srcTotal = srcGroups.reduce((a, r) => a + (r.seq?.[1] || 0), 0);


    // Who to nudge is a page now; the Overview says how many are waiting.
    const toNudge = z ? fresh(z.people || []).length
      : x ? (x.newest || []).filter((p) => nextStep(p) !== 'Settled in').length : null;
    const nudgeLine = toNudge
      ? `<a class="callout callout--go" href="#nudge"><span><b>${fmt(toNudge)}</b> ${toNudge === 1 ? 'person' : 'people'} to nudge.</span>${svg('chevron', 'i i--go')}</a>`
      : '';

    const rh = x ? rhythmHtml(x.rhythm) : null;

    main.innerHTML =
      headHtml('Overview') +
      // Active today is a top card and Settled in a small figure (Zoe,
      // 2026-11-12: "make active today a top card, swap it for settled in").
      '<div class="grid grid--kpi">' +
        tile('Active today', fmt(o.dau), o.avgDau28 != null ? `${fmt(o.avgDau28)} a day on average` : '', 'Created or connected today, so far. The average is the last 28 days. Likes don\'t count.') +
        tile('Weekly active', fmt(o.wau), delta(cur?.active, prev?.active), 'Created or connected in the last 7 days. Likes don\'t count.') +
        tile('Monthly active', fmt(o.mau), delta(o.mau, o.mauPrev, '', 'last month'), 'Created or connected in the last 30 days, against the 30 before. Likes don\'t count.') +
        tile('New this week', fmt(o.new7), delta(cur?.joined, prev?.joined), 'Accounts made in the last 7 days') +
      '</div>' +
      strip([
        ['Everyone', fmt(o.users), 'Every account, yours left out'],
        ['Settled in', st?.people ? pctTxt(pct(st.settled, st.people)) : '–', 'Made a friend (or joined a circle) and shared something, both in their first week. Joined in the last 30 days, a week old or more' +
          (st?.people ? `: ${fmt(st.settled)} of ${fmt(st.people)}` : '')],
        ['Back in week 1, last month', pctTxt(w1), 'Of the people who joined in the last month (the last 4 signup weeks old enough to tell), the share active again 7 to 13 days after joining'],
        ['Opened, week', fmt(o.openedWau), 'Opened Tria in the last 7 days, doing something or not'],
        ['Opened, month', fmt(o.openedMau), 'Opened Tria in the last 30 days, doing something or not'],
      ]) +
      nudgeLine +
      '<div class="section grid grid--two">' +
        `<div>${sectionHead('Weekly active', '12 weeks')}<div class="card" id="c-active"></div></div>` +
        `<div>${sectionHead('Monthly active', '30 days at a time')}<div class="card" id="c-monthly">` +
          (hasMonthly ? '' : '<p class="empty">Re-run <b>supabase/admin-dashboard.sql</b> to draw this.</p>') + '</div></div>' +
      '</div>' +
      `<div class="section">${sectionHead('All time', hist.length ? 'Since ' + esc(day(hist[0].week)) + ', a point a week' : '')}<div class="card" id="c-history">` +
        (hist.length > 1 ? '' : '<p class="empty">Re-run <b>supabase/admin-dashboard.sql</b> to draw this.</p>') + '</div></div>' +
      `<div class="section" id="funnel"></div>` +
      `<div class="section">${sectionHead('When', rh?.peak ? `Busiest ${rh.peak}` : 'Last 4 weeks')}` +
        (rh ? `<div class="card">${rh.html}</div>` : `<div class="callout">${extrasWhy}</div>`) + '</div>' +
      `<div class="section">${sectionHead('Word of mouth')}<div class="grid ${x ? 'grid--kpi' : 'grid--tiles'}">` +
        tile('From an invite', src30 ? pctTxt(pct(invited, srcTotal)) : '–', src30 ? `${fmt(invited)} of ${fmt(srcTotal)}, 30 days` : '', 'New accounts that came through an invite link') +
        (x ? tile('Invites redeemed', fmt(x.invites?.last30), `${fmt(x.invites?.total)} all time`, 'Last 30 days') +
          tile('On their own', fmt(x.friends?.alone), pctTxt(pct(x.friends?.alone, x.users)) + ' of everyone', 'No friend and no circle, so nobody sees their posts') +
          tile('Median friends', fmt(Math.round((x.friends?.median ?? 0) * 10) / 10), 'mutual, each') : '') +
      '</div>' +
      '<div class="grid grid--two section-tight">' +
        `<div>${sectionHead('New accounts', 'A week')}<div class="card" id="c-joined"></div></div>` +
        (x ? `<div>${sectionHead('Top inviters')}` + list((x.invites?.top || []).length
            ? x.invites.top.map((p) => row({ title: who(p), sub: '@' + esc(p.handle), val: `<b>${fmt(p.n)}</b>` }))
            : [row({ title: 'None yet' })]) + '</div>' : '') +
      '</div></div>' +
      foot();

    mountLine($('c-active'), s, { lines: [{ key: 'active', name: 'Active' }, { key: 'opened', name: 'Opened', late: true }],
      head: weekTo, label: 'Weekly active people, last 12 weeks' });
    if (hasMonthly) mountLine($('c-monthly'), s, { lines: [{ key: 'monthly', name: 'Active' }, { key: 'monthlyOpened', name: 'Opened', late: true }],
      head: (p) => `<b>30 days to ${esc(day(addDays(p.week, 6)))}</b>`, label: 'Monthly active people, last 12 weeks' });
    if (hist.length > 1) mountLine($('c-history'), hist, { lines: [{ key: 'monthly', name: 'Monthly active' }, { key: 'weekly', name: 'Weekly active' }],
      head: weekTo, label: 'Monthly and weekly active people, all time' });
    mountLine($('c-joined'), s, { lines: [{ key: 'joined', name: 'New' }], head: weekTo, label: 'New accounts a week, last 12 weeks' });
    paintSettling($('funnel'), sstate.days === 30 ? st : null);
  }

  // The week's rhythm: 7 rows by 24 hours, meaningful events, 28 days.
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const hr = (h) => (h % 12 || 12) + (h < 12 ? 'am' : 'pm');
  function rhythmHtml(cells) {
    const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
    (cells || []).forEach(([d, h, n]) => { grid[d][h] = n; });
    const rmax = Math.max(1, ...grid.flat());
    let peak = [0, 0, 0];
    grid.forEach((r, d) => r.forEach((n, h) => { if (n > peak[2]) peak = [d, h, n]; }));
    let html = '<div class="rhythm" role="img" aria-label="Activity by weekday and hour, last 28 days"><span></span>' +
      Array.from({ length: 24 }, (_, h) => `<span class="rh">${h % 6 === 0 ? hr(h) : ''}</span>`).join('');
    [1, 2, 3, 4, 5, 6, 0].forEach((d) => {
      html += `<span class="rl">${DAYS[d]}</span>` + grid[d].map((n, h) =>
        `<span class="rc" style="${n ? `background:color-mix(in srgb, var(--data) ${Math.round(10 + (n / rmax) * 80)}%, transparent)` : ''}" ` +
        `data-tip="<b>${DAYS[d]} ${hr(h)}</b><br>${fmt(n)}"></span>`).join('');
    });
    return { html: html + '</div>', peak: peak[2] ? `${DAYS[peak[0]]} ${hr(peak[1])}` : '' };
  }

  // ── Activity: what was made and done, its own page ──────────────────────
  // Zoe, 2026-11-11, of the Overview's Made this week, Done this week and
  // Opened on: "this should be its own page and I want to see more data".
  // admin_activity: a window (7 days by default) beside the one before it.
  // Until admin-dashboard.sql is re-run it draws the Overview's week alone.
  const AUD = { public: 'Anyone', circle: 'My circle', list: 'Chosen people', community: 'A circle' };
  const CHAT = { direct: 'One to one', group: 'Group chats', activity: 'Plan chats', community: 'Circle chats (old)' };
  const OS = { ios: 'iPhone or iPad', android: 'Android', mac: 'Mac', windows: 'Windows', other: 'Other' };
  // f, the pick (Zoe, 2026-11-11: "lemme tap a card to filter data by type"):
  // null is everything, 'made' every post type together, else a post type
  // (TYPE_NAMES) or a kind besides making (KIND_NAMES). Kept across windows.
  const astate = { days: 7, f: null };
  const PICK_NAMES = { ...TYPE_NAMES, ...KIND_NAMES, made: 'Made' };
  const pickAttrs = (k, on) => ` data-af="${esc(k ?? '')}" role="button" tabindex="0" aria-pressed="${on === k}"`;

  async function renderActivity() {
    let a = null, why = '';
    try { a = await call('admin_activity', { p_days: astate.days }); } catch (err) {
      why = missing(err) ? 'Re-run <b>supabase/admin-dashboard.sql</b> for the windows, changes and everything below. Until then, the last 7 days.'
        : 'Couldn\'t load these. ' + esc(err?.message || '');
    }
    const d = a ? astate.days : 7;
    const before = d === 7 ? 'the week before' : d ? `the ${d} days before` : '';
    const span = d ? `last ${d} days` : 'all time';
    const controls = '<div class="controls">' + segmented('adays', [[7, '7 days'], [30, '30 days'], [90, '90 days'], [0, 'All time']], astate.days, 'Window') + '</div>';
    const wire = () => main.querySelectorAll('[data-adays]').forEach((b) => b.addEventListener('click', () => {
      astate.days = Number(b.dataset.adays); renderActivity();
    }));

    if (!a) {
      const o = await call('admin_overview');
      main.innerHTML = headHtml('Activity') + `<div class="callout">${why}</div>` +
        '<div class="section grid grid--three">' +
          `<div>${sectionHead('Made', 'Last 7 days')}<div class="card">${barChart(countRows(o.types7, TYPE_NAMES))}</div></div>` +
          `<div>${sectionHead('Done', 'Last 7 days')}<div class="card">${barChart(countRows(o.kinds7, KIND_NAMES))}</div></div>` +
          `<div>${sectionHead('Opened on', 'Last 7 days')}<div class="card">${barChart(shareRows(o.platforms7, PLATFORM), { total: sumOf(o.platforms7), empty: 'Nobody yet.' })}</div></div>` +
        '</div>' + foot();
      return;
    }

    paintActivity(a, { d, before, span, controls, wire });
  }

  function paintActivity(a, { d, before, span, controls, wire }) {
    const K = a.kinds || {};
    const sumK = (ks, f = 'n') => ks.reduce((x, k) => x + (K[k]?.[f] || 0), 0);
    const hasPrev = a.prevFrom != null;
    const made = sumK(['post', 'moment', 'daily']), madePrev = hasPrev ? sumK(['post', 'moment', 'daily'], 'prev') : null;
    // What people did besides making: Made has its own bars, so Interactions
    // leaves posts, Moments and daily answers to it.
    const talk = Object.fromEntries(Object.entries(K).filter(([k]) => !['post', 'moment', 'daily'].includes(k)));
    const opened = a.opened ?? null;
    const doneAll = Object.values(K).reduce((x, v) => x + (v.n || 0), 0);
    const cv = a.conversation || {};
    const ser = a.series || [];
    // Opened on and Devices are shares of the people who opened Tria (someone
    // on two counts in both); App versions, of the people on iOS.
    const seen = opened || sumOf(a.platforms);
    const vers = a.versions || [];
    const verTot = vers.reduce((x, v) => x + v.n, 0);
    const chats = Object.entries(a.chats || {}).sort((x, y) => y[1].messages - x[1].messages);
    const dl = (now, prev) => (hasPrev ? delta(now, prev, '', before) : '');
    const each = (n, p) => (p ? fmt(Math.round((n / p) * 10) / 10) : '–');

    // The pick. It needs each point's 'by' (admin-dashboard.sql re-run).
    const canPick = ser.some((p) => p.by);
    const f = canPick ? astate.f : null;
    const isPost = f != null && (f === 'made' || f in TYPE_NAMES);
    const oneType = isPost && f !== 'made';
    const fName = f ? PICK_NAMES[f] || f : '';
    const st = !f ? null : f === 'made' ? { n: made, people: a.makers, prev: madePrev }
      : (oneType ? a.types?.[f] : K[f]) || { n: 0, people: 0, prev: hasPrev ? 0 : null };
    // Posted to and the conversation are posts: one type's own, or all of them.
    const fcv = !f || f === 'made' ? cv : oneType ? a.conversationBy?.[f] || null : null;
    const audSrc = oneType ? a.audiencesBy?.[f] || {} : a.audiences || {};
    const audSub = oneType ? fName : f && !isPost ? 'All posts' : '';
    // Busiest circles: by the type picked, by joins for Circle joins.
    let circ = (a.circles || []).map((c) => ({ ...c, v: oneType ? c.types?.[f] || 0 : f === 'circle' ? c.joins : c.posts }));
    if (oneType || f === 'circle') circ = circ.filter((c) => c.v > 0).sort((x, y) => y.v - x.v);
    circ = circ.slice(0, 8);
    const circSub = oneType ? fName : f === 'circle' ? 'By joins' : f && f !== 'made' ? 'All posts' : '';

    const pickTile = (k) => (canPick ? { cls: 'is-pick' + (f === k ? ' is-on' : ''), attrs: pickAttrs(k, f) } : { cls: '', attrs: '' });
    const tl = (k, label, value, note, tipText) => {
      const p = pickTile(k);
      return tile(label, value, note, tipText + (canPick && f !== k ? (k ? '. Tap to show just this.' : '. Tap to show everything.') : '.'), p.cls, p.attrs);
    };

    const convStrip = (c, what) => (c ? [
      ['Got a reply', pctTxt(pct(c.replied, c.posts)), `${fmt(c.replied)} of ${fmt(c.posts)} ${what} got a comment from someone else`],
      ['First reply in', esc(hours(c.firstReplyH)), `Typical (median) time from a post to its first comment from someone else, of the ${what} that got one`],
      ['Comments per post', c.posts ? each(c.comments, c.posts) : '–', `${fmt(c.comments)} comments on the ${fmt(c.posts)} ${what} made in the window, on average`],
    ] : []);
    const figures = !f ? strip([
      ['Made something', a.active ? pctTxt(pct(a.makers, a.active)) : '–', `${fmt(a.makers)} of the ${fmt(a.active)} active made a post, Moment or daily answer`],
      ['Things each', each(doneAll, a.active), `${fmt(doneAll)} things made or done by ${fmt(a.active)} active people, on average each`],
      ...convStrip(cv, 'posts (Moments and bare reposts left out)'),
    ]) : strip([
      [fName, fmt(st.n), `${fmt(st.n)} in the window` + (st.prev != null ? `, ${fmt(st.prev)} ${before}` : '')],
      ['People', fmt(st.people), `Different people who did it`],
      ['Of active', a.active ? pctTxt(pct(st.people, a.active)) : '–', `The share of the ${fmt(a.active)} active people`],
      ['Each', each(st.n, st.people), `${fmt(st.n)} by ${fmt(st.people)} ${st.people === 1 ? 'person' : 'people'}, on average each`],
      ...convStrip(fcv, f === 'made' ? 'posts (Moments and bare reposts left out)' : fName.toLowerCase()),
    ]);

    const chartTitle = (f ? fName : 'Active') + (a.byWeek ? ' each week' : ' each day');

    main.innerHTML =
      headHtml('Activity') + controls +
      `<p class="footnote">${esc(span[0].toUpperCase() + span.slice(1))}, from ${esc(day(a.from))}. ` +
        (canPick ? (f ? 'The chart, the figures, Posted to and Busiest circles follow the pick; chats and devices are everyone\'s. '
          : 'Tap a card or a bar to see just that. ')
          : 'Re-run <b>supabase/admin-dashboard.sql</b> to see one type at a time. ') +
        `A friendship counts once, the day it became mutual. Opened on, Devices and App versions count people since the open ping began; someone on two counts in both. ${SKIP_NOTE}</p>` +
      (f ? `<div class="pickbar"><span>Showing <b>${esc(fName)}</b></span><button class="pill-quiet" type="button" data-af="">Show everything</button></div>` : '') +
      '<div class="grid grid--kpi">' +
        tl(null, 'Active', fmt(a.active), dl(a.active, a.activePrev), 'People who created or connected. Likes don\'t count') +
        tl('made', 'Made', fmt(made), dl(made, madePrev), 'Posts (quotes too), Moments and daily answers. A bare repost isn\'t counted') +
        tl('comment', 'Comments', fmt(K.comment?.n || 0), dl(K.comment?.n || 0, K.comment?.prev), 'On any post') +
        tl('message', 'Messages', fmt(K.message?.n || 0), dl(K.message?.n || 0, K.message?.prev), 'In any chat') +
      '</div>' +
      figures +
      `<div class="section">${sectionHead(chartTitle, f ? 'How many, and by how many people' : 'People who created or connected')}<div class="card" id="c-act"></div></div>` +
      '<div class="section grid grid--three">' +
        `<div>${sectionHead('Made', 'By type')}<div class="card">${barChart(countRows(a.types, TYPE_NAMES, before), { pick: canPick && { on: f } })}</div></div>` +
        `<div>${sectionHead('Interactions', 'Besides making')}<div class="card">${barChart(countRows(talk, KIND_NAMES, before), { pick: canPick && { on: f } })}</div></div>` +
        `<div>${sectionHead('Posted to', audSub)}<div class="card">${barChart(shareRows(audSrc, AUD), { total: sumOf(audSrc), empty: f === 'moment' ? 'Moments aren\'t counted here.' : 'Nothing yet.' })}</div></div>` +
      '</div>' +
      '<div class="section grid grid--two">' +
        `<div>${sectionHead('Chats', 'Messages')}<div class="card">${barChart(chats.map(([k, v]) => ({
          key: k, n: v.messages, name: esc(CHAT[k] || k),
          sub: `${fmt(v.chats)} ${v.chats === 1 ? 'chat' : 'chats'}, ${fmt(v.people)} ${v.people === 1 ? 'person' : 'people'} writing`,
        })), { empty: 'No messages.' })}</div></div>` +
        `<div>${sectionHead('Busiest circles', circSub || 'Posts')}<div class="card">${barChart(circ.map((c) => ({
          key: c.slug, n: c.v, name: `<a class="who" href="../#/c/${encodeURIComponent(c.slug)}">${esc(c.name)}</a>`,
          sub: `c/${esc(c.slug)} · ${fmt(c.people)} posting · ${fmt(c.joins)} joined`,
          tip: `<b>${esc(c.name)}</b>` + (oneType ? `<br>${fmt(c.v)} ${esc(fName.toLowerCase())}` : '') + `<br>${fmt(c.posts)} posts by ${fmt(c.people)}<br>${fmt(c.joins)} joined`,
        })), { sort: false, empty: 'Quiet.' })}</div></div>` +
      '</div>' +
      '<div class="section grid grid--three">' +
        `<div>${sectionHead('Opened on', seen ? `Of ${fmt(seen)} people` : 'People')}<div class="card">${barChart(shareRows(a.platforms, PLATFORM), { total: seen, empty: 'Nobody yet.' })}</div></div>` +
        `<div>${sectionHead('Devices', 'People')}<div class="card">${barChart(shareRows(a.os, OS), { total: seen, empty: 'None seen.' })}</div></div>` +
        `<div>${sectionHead('App versions', 'People on iOS')}<div class="card">${barChart(vers.map((v) => ({ key: v.v, n: v.n, name: esc(v.v) })), { total: verTot, empty: 'None seen.' })}</div></div>` +
      '</div>';

    // The Overview's line (Zoe, 2026-11-12: "I don't like the bar graph. use
    // the same style as overview"): people, the Active tile's unit; with a
    // pick, its count and the people behind it. The last point is still going.
    const n = ser.length;
    const head = (p, i) => `<b>${a.byWeek ? 'Week of ' : ''}${esc(day(p.at))}${i === n - 1 ? ', so far' : ''}</b>`;
    mountLine($('c-act'), f ? ser.map((p) => ({ at: p.at, n: (p.by?.[f] || [0, 0])[0], ppl: (p.by?.[f] || [0, 0])[1] })) : ser, f
      ? { at: 'at', lines: [{ key: 'n', name: fName }, { key: 'ppl', name: 'People' }], head, soFar: true, label: chartTitle }
      : { at: 'at', lines: [{ key: 'people', name: 'Active' }], head, soFar: true, label: chartTitle,
          more: (p) => `<br>${fmt(p.posts)} made<br>${fmt(p.events)} things made or done` });
    wire();
    main.querySelectorAll('[data-af]').forEach((el) => {
      const go = () => {
        const k = el.dataset.af || null;
        astate.f = astate.f === k ? null : k;
        hideTip();
        const y = window.scrollY;
        paintActivity(a, { d, before, span, controls, wire });
        window.scrollTo(0, y);
      };
      el.addEventListener('click', (e) => { if (!e.target.closest('a')) go(); });
      if (el.tagName !== 'BUTTON') el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
      });
    });
  }

  // ── Settling in, a section of the Overview ────────────────────────────────
  // Zoe, 2026-11-11: the six stage funnel (in order vs at all, three splits,
  // installs) was "painful to look at or understand", and Activated "can be
  // folded" into it. Now it is one question: of the people who joined, what
  // did they do in their first week? One headline, Settled in (made a friend
  // or joined a circle, AND shared something, the old Activated), and the four
  // things on their own, each out of the same people. Only accounts a week old
  // or more count, so nobody is marked down for days they still have.
  const SETTLE = [
    { k: 'profile', name: 'Added a photo or bio', tip: 'A profile photo or a bio' },
    { k: 'connected', name: 'Made a friend or joined a circle', tip: 'A mutual friend (a request they asked or answered, now both ways), or a circle joined. A follow or an unanswered request doesn\'t count.' },
    { k: 'shared', name: 'Shared something', tip: 'A post, Moment, daily answer, comment, message, RSVP or poll vote. A like doesn\'t count.' },
    { k: 'back', name: 'Came back another day', tip: 'Opened Tria or did something on any of the 6 days after the day they joined' },
  ];
  const sstate = { days: 30 };

  async function paintSettling(box, given) {
    if (!box) return;
    let r = given;
    if (!r) {
      try { r = await call('admin_settling', { p_days: sstate.days }); } catch (err) {
        const missing = /admin_settling|PGRST202|42883/.test(String(err?.message || err?.code || ''));
        box.innerHTML = sectionHead('Settling in') + `<div class="callout">${missing
          ? 'Re-run <b>supabase/admin-dashboard.sql</b> to draw this.' : 'Couldn\'t load these. ' + esc(err?.message || '')}</div>`;
        return;
      }
    }
    const n = r.people || 0;
    const joinedIn = sstate.days ? `joined in the last ${sstate.days} days` : 'ever joined';
    const low = n ? SETTLE.reduce((m, st) => ((r[st.k] || 0) < (r[m.k] || 0) ? st : m), SETTLE[0]) : null;
    // In their own order (the order a first week goes), the fewest in bold.
    const bars = barChart(SETTLE.map((st) => ({
      key: st.k, n: r[st.k] || 0, keep: true, name: esc(st.name), cls: st === low ? 'is-strong' : '',
      tip: `<b>${esc(st.name)}</b><br>${esc(st.tip)}<br>${fmt(r[st.k] || 0)} of ${fmt(n)}`,
    })), { total: n, sort: false });
    box.innerHTML =
      sectionHead('Settling in', 'What people did in their first week') +
      '<div class="controls">' + segmented('sdays', [[30, '30 days'], [90, '90 days'], [0, 'All time']], sstate.days, 'Joined in') + '</div>' +
      (n ? '<div class="card settle">' +
          `<div class="settle-head"><div class="tile-value">${pctTxt(pct(r.settled, n))}</div>` +
          `<p><b>Settled in.</b> ${fmt(r.settled)} of the ${fmt(n)} who ${joinedIn} made a friend and shared something in their first week` +
          (r.medianH != null ? `, typically within ${esc(hours(r.medianH)).replace(' ', '&nbsp;')}` : '') + '.</p></div>' +
          bars +
          (r.young ? `<p class="note">${fmt(r.young)} more joined this past week and count once their week is up.</p>` : '') +
          (r.pingSince ? `<p class="note">Opening Tria counts as coming back since ${esc(day(r.pingSince))}; before that only doing something did.</p>`
            : '<p class="note">Coming back counts only doing something until the open ping has data.</p>') +
        '</div>' +
        (low ? `<a class="callout callout--go" href="#nudge"><span>Fewest people <b>${esc(low.name.toLowerCase())}</b>. See who to nudge.</span>${svg('chevron', 'i i--go')}</a>` : '')
        : `<div class="card"><p class="empty">Nobody who ${joinedIn} has had their first week yet.${r.young ? ` ${fmt(r.young)} joined this past week.` : ''}</p></div>`);
    box.querySelectorAll('.segmented button').forEach((b) => {
      b.addEventListener('click', () => { sstate.days = Number(b.dataset.sdays); paintSettling(box); });
    });
  }

  // ── Nudge: who hasn't settled in, and an email to them ────────────────────
  // Zoe, 2026-11-11: "Can we do an email for users who haven't really been in
  // the funnel?" admin-nudge.sql says who and where each stopped; the email
  // goes through the `nudge` Edge Function (Resend, from a Tria address), or
  // the admin's own Mail app, then marked as sent by hand.
  const STEP = {
    profile: { say: 'No photo or bio', chip: 'No profile' },
    connect: { say: 'No friends yet', chip: 'No friends' },
    post: { say: 'Hasn\'t posted', chip: 'Not posted' },
    return: { say: 'Hasn\'t come back', chip: 'Not back' },
    quiet: { say: 'Gone quiet', chip: 'Quiet' },
  };
  // What to say, by where they stopped. Plain words, {name} their first name.
  const LETTER = {
    all: ['A note from Tria', 'Hi {name},\n\nThanks for making a Tria account. Is there anything that would make it better for you? Just reply, I read every one.\n\nZoe, at Tria'],
    profile: ['Your Tria is a blank page', 'Hi {name},\n\nYou made a Tria account, which is lovely. It\'s still a blank page, though. Add a photo or a line about you so your friends know it\'s really you.\n\nZoe, at Tria'],
    connect: ['Tria is quiet without your friends', 'Hi {name},\n\nTria is only as good as the people on it, and right now it\'s just you. Send a friend your link, or join a circle for something you\'re into.\n\nZoe, at Tria'],
    post: ['Say something on Tria', 'Hi {name},\n\nYour people are on Tria. Share a note, a photo, or answer today\'s daily question. There\'s no algorithm, so your friends will actually see it.\n\nZoe, at Tria'],
    return: ['Come see what\'s new', 'Hi {name},\n\nYou made a Tria account and we haven\'t seen you since. Your friends have been posting. Come have a look.\n\nZoe, at Tria'],
    quiet: ['We miss you on Tria', 'Hi {name},\n\nIt\'s been a while. A few things have happened on Tria since you were last there, and your circle is still there.\n\nZoe, at Tria'],
  };
  const WEEK = 7 * 86400000;
  const nstate = { step: 'all', picked: new Set(), subject: '', message: '', edited: false, marked: null };
  // Not stopped, and (unless asked) not written to in the last week.
  const fresh = (people) => people.filter((p) => !p.stopped && (!p.nudged || Date.now() - new Date(p.nudged) > WEEK));
  const firstName = (p) => (String(p.name || '').trim().split(/\s+/)[0] || p.handle || 'there');

  // What a new account still needs, in funnel order (admin-extras' newest,
  // the page's fallback until admin-nudge.sql runs).
  function nextStep(p) {
    if (!p.profile) return 'No photo or bio';
    if (!p.connected) return 'No friends yet';
    if (!p.acted) return 'Hasn\'t posted';
    if (!p.returned) return (Date.now() - new Date(p.joined)) / 86400000 < 1 ? 'Joined today' : 'Hasn\'t come back';
    return 'Settled in';
  }
  const stepDots = (p) => `<span class="steps" aria-hidden="true">` +
    ['profile', 'connected', 'acted', 'returned'].map((k) => `<i class="${p[k] ? 'on' : ''}"></i>`).join('') + '</span>';
  const stepTip = (p) => `<b>${esc(p.name)}</b><br>Profile ${p.profile ? '✓' : '·'}  Connected ${p.connected ? '✓' : '·'}<br>Posted ${p.acted ? '✓' : '·'}  Came back ${p.returned ? '✓' : '·'}`;

  // What a nudge looks like (Zoe, 2026-11-12: "where is the email sent from
  // and what does it look like?"): drawn under the letter as it's written,
  // under who it's from. letterHtml is functions/nudge's html(), its font link
  // left out (this page has the fonts): KEEP THE TWO EQUAL BY HAND.
  const NUDGE_FROM = 'Tria <hello@triaonline.com>';
  const MAIL_SANS = "'Oxygen',-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif";
  const MAIL_SERIF = "'Instrument Serif',Georgia,'Times New Roman',serif";
  function letterHtml(message) {
    const paras = message.trim().split(/\n\s*\n/).filter(Boolean).map((p) =>
      `<p style="font-family:${MAIL_SANS};font-size:15px;line-height:1.6;color:#14171a;margin:16px 0 0 0;">` +
      esc(p.trim()).replace(/\n/g, '<br>') + '</p>').join('');
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0;padding:0;background-color:#edeef0;">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:440px;width:100%;background-color:#f6f7f8;border:1px solid #dadde1;border-radius:20px;">
      <tr><td style="padding:40px 36px 36px 36px;">
        <div style="font-family:${MAIL_SERIF};font-style:italic;font-size:30px;line-height:1;color:#14171a;">tria</div>
        ${paras}
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 0 0;"><tr>
          <td align="center" bgcolor="#00cbb6" style="border-radius:999px;background:linear-gradient(115deg,#00c9ce,#00cc9e);">
            <a href="https://triaonline.com/" target="_blank" rel="noopener" style="display:inline-block;padding:14px 30px;font-family:${MAIL_SANS};font-size:15px;font-weight:700;color:#14171a;text-decoration:none;border-radius:999px;">Open Tria</a>
          </td></tr></table>
        <div style="border-top:1px solid #dadde1;margin:32px 0 0 0;"></div>
        <p style="font-family:${MAIL_SANS};font-size:12px;line-height:1.6;color:#5c636b;margin:20px 0 0 0;">You're getting this because you have a Tria account. Reply "stop" and we won't email you again.</p>
      </td></tr>
    </table>
  </td></tr>
</table>`;
  }
  // Whether sending is set up: the nudge function's GET says who it sends
  // from and whether its secrets are set. Asked once a visit (refresh asks
  // again); no answer in 5s, or none at all, is "not deployed".
  let sender = null;
  async function senderState() {
    if (sender) return sender;
    if (DEMO) return (sender = { from: NUDGE_FROM, ready: false, live: false });
    const ask = sb.functions.invoke('nudge', { method: 'GET' }).then(({ data, error }) => {
      if (error) throw error;
      return { from: data?.from || NUDGE_FROM, ready: !!data?.ready, live: true };
    });
    const late = new Promise((res) => setTimeout(() => res(null), 5000));
    try { sender = (await Promise.race([ask, late])) || { from: NUDGE_FROM, ready: false, live: false }; }
    catch { sender = { from: NUDGE_FROM, ready: false, live: false }; }
    return sender;
  }

  async function renderNudge() {
    const [z, snd] = await Promise.all([nudgeData(), senderState()]);
    if (!z) {
      // Before admin-nudge.sql: the newest accounts, as the Overview had them.
      const x = await extras();
      const rows = (x?.newest || []).slice().sort((a, b) => (nextStep(a) === 'Settled in') - (nextStep(b) === 'Settled in')).map((p) => row({
        title: who(p),
        sub: `${esc(ago(p.joined))} · ${esc(SOURCE[p.source] || p.source)} · ${esc(PLATFORM[p.platform] || p.platform)}`,
        val: `<span class="next${p.returned ? ' is-done' : ''}">${esc(nextStep(p))}</span>${stepDots(p)}`,
        tipText: stepTip(p),
      }));
      main.innerHTML = headHtml('Nudge') + `<div class="callout banner">${nudgeWhy}</div>` +
        (x ? `${sectionHead('Newest accounts')}${list(rows.length ? rows : [row({ title: 'Nobody yet' })])}` : `<div class="callout">${extrasWhy}</div>`) + foot();
      return;
    }
    const everyone = z.people || [];
    const live = everyone.filter((p) => !p.stopped);
    // Nudged this week is its own section (Zoe, 2026-11-12: "put nudged in a
    // new section"); a week on, they're back in the list above.
    const pool = fresh(live);
    const lately = live.filter((p) => !pool.includes(p)).sort((a, b) => new Date(b.nudged) - new Date(a.nudged));
    const shown = nstate.step === 'all' ? pool : pool.filter((p) => p.step === nstate.step);
    const stopped = everyone.filter((p) => p.stopped);
    // A pick that left the list (a filter changed) is let go.
    const ids = new Set(shown.map((p) => p.id));
    for (const id of nstate.picked) if (!ids.has(id)) nstate.picked.delete(id);
    if (!nstate.edited) [nstate.subject, nstate.message] = LETTER[nstate.step] || LETTER.all;
    const count = (k) => (k === 'all' ? pool.length : pool.filter((p) => p.step === k).length);

    const personRow = (p) => {
      const on = nstate.picked.has(p.id);
      const sub = [p.email ? esc(p.email) : 'No email', 'joined ' + esc(ago(p.joined)),
        p.nudged ? 'nudged ' + esc(ago(p.nudged)) : ''].filter(Boolean).join(' · ');
      return `<div class="row pick-row${on ? ' is-picked' : ''}" data-tip="${esc(stepTip(p))}">` +
        `<label class="pick"><input type="checkbox" data-pick="${esc(p.id)}"${on ? ' checked' : ''}${p.email ? '' : ' disabled'} aria-label="Email ${esc(p.name)}"><span class="pick-box" aria-hidden="true"></span></label>` +
        `<div class="row-main"><div class="row-title">${who(p)}</div><div class="row-sub">${sub}</div></div>` +
        `<div class="row-val"><span class="next">${esc(STEP[p.step]?.say || '')}</span>${stepDots(p)}</div>` +
        `<button class="icon-btn" type="button" data-stop="${esc(p.id)}" aria-label="${esc(p.name)} asked us to stop" data-tip="Asked us to stop">${svg('stop')}</button>` +
        '</div>';
    };
    const pickable = shown.filter((p) => p.email);
    const allOn = pickable.length && pickable.every((p) => nstate.picked.has(p.id));
    const n = nstate.picked.size;

    main.innerHTML =
      headHtml('Nudge') +
      `<div class="scopes scopes--page" role="group" aria-label="Where they stopped">` +
        [['all', 'Everyone'], ...Object.entries(STEP).map(([k, v]) => [k, v.chip])].map(([k, l]) =>
          `<button class="pill-quiet${k === nstate.step ? ' is-on' : ''}" type="button" data-step="${k}" aria-pressed="${k === nstate.step}">${esc(l)} <span class="chip-n">${fmt(count(k))}</span></button>`).join('') +
      '</div>' +
      // The email leads, Select all in its head, so sending to a whole step
      // is a pick and a send with no scrolling (Zoe, 2026-11-12: "put send
      // form n all at the top"); the people follow the preview.
      `<div class="section-tight">${sectionHead('Email', (n ? `To ${fmt(n)} ${n === 1 ? 'person' : 'people'}` : 'Pick people below') +
          (pickable.length ? ` · <button class="linkish" type="button" id="n-all">${allOn ? 'Select none' : `Select all ${fmt(pickable.length)}`}</button>` : ''))}` +
        '<div class="card letter">' +
          `<input class="field field--plain" id="n-subject" type="text" maxlength="140" placeholder="Subject" aria-label="Subject" value="${esc(nstate.subject)}" />` +
          `<textarea class="field field--plain field--area" id="n-message" rows="9" maxlength="4000" aria-label="Message">${esc(nstate.message)}</textarea>` +
          '<p class="note">{name} is their first name. Every email ends with an Open Tria button and how to stop them.</p>' +
          '<div class="letter-acts">' +
            `<button class="publish-fill" type="button" id="n-send"${n ? '' : ' disabled'}>${n ? `Send to ${fmt(n)}` : 'Send'}</button>` +
            `<button class="pill-quiet" type="button" id="n-mail"${n ? '' : ' disabled'}>Open in Mail</button>` +
            '<button class="pill-quiet" type="button" id="n-test">Send me a test</button>' +
          '</div>' +
          `<p class="note" id="n-status" role="status">${nstate.marked ? `Sent it from Mail? <button class="linkish" type="button" id="n-mark">Mark ${fmt(nstate.marked.ids.length)} as nudged</button>` : ''}</p>` +
        '</div></div>' +
      `<div class="section">${sectionHead('What they get', snd.live && snd.ready ? 'Sent through Resend, one email each. Replies come to the reply address on the nudge function.'
          : snd.live ? 'Not sending yet: set <b>RESEND_API_KEY</b> and <b>NUDGE_REPLY_TO</b> on the nudge function.'
          : 'Not sending yet: the nudge function isn\'t deployed. Open in Mail sends it from your own address, as plain words.')}` +
        '<div class="mail-preview" id="n-preview"></div></div>' +
      `<div class="section">${sectionHead(nstate.step === 'all' ? 'People' : STEP[nstate.step].say)}` + list(shown.length
        ? shown.map(personRow)
        : [row({ title: nstate.step === 'all' ? 'Everyone has settled in.' : 'Nobody here.' })]) + '</div>' +
      (lately.length ? `<div class="section">${sectionHead('Nudged', 'This week. Back in the list after seven days.')}` + list(lately.map((p) =>
        `<div class="row nudged-row" data-tip="${esc(stepTip(p))}">` +
          `<div class="row-main"><div class="row-title">${who(p)}</div><div class="row-sub">${[p.email ? esc(p.email) : '', esc(STEP[p.step]?.say || '')].filter(Boolean).join(' · ')}</div></div>` +
          `<div class="row-val">${esc(ago(p.nudged))}</div>` +
          `<button class="icon-btn" type="button" data-stop="${esc(p.id)}" aria-label="${esc(p.name)} asked us to stop" data-tip="Asked us to stop">${svg('stop')}</button>` +
        '</div>')) + '</div>' : '') +
      (stopped.length ? `<div class="section">${sectionHead('Asked us to stop', 'Never emailed')}` + list(stopped.map((p) => row({
        title: who(p), sub: esc(p.email || ''),
        val: `<button class="linkish" type="button" data-unstop="${esc(p.id)}">Undo</button>`,
      }))) + '</div>' : '') +
      foot();

    const again = () => { const y = window.scrollY; renderNudge().then(() => window.scrollTo(0, y)); };
    const reload = () => { if (!DEMO) for (const k in cache) if (k.startsWith('admin_nudge')) delete cache[k]; again(); };
    main.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => {
      nstate.step = b.dataset.step; nstate.picked.clear(); again();
    }));
    $('n-all')?.addEventListener('click', () => {
      if (allOn) nstate.picked.clear(); else pickable.forEach((p) => nstate.picked.add(p.id));
      again();
    });
    main.querySelectorAll('[data-pick]').forEach((c) => c.addEventListener('change', () => {
      if (c.checked) nstate.picked.add(c.dataset.pick); else nstate.picked.delete(c.dataset.pick);
      again();
    }));
    const subj = $('n-subject'), msg = $('n-message');
    // The preview: the first person picked (else the first listed) by name.
    // Send me a test fills {name} the same way, so the test is the preview.
    const example = () => {
      const ps = shown.filter((p) => nstate.picked.has(p.id) && p.email);
      const eg = ps[0] || shown.find((p) => p.email);
      return { ps, eg, name: eg ? firstName(eg) : 'there' };
    };
    const paintPreview = () => {
      const { ps, eg, name } = example();
      const fill = (s) => s.replace(/\{name\}/g, name);
      const to = !eg ? 'Pick people below'
        : ps.length > 1 ? `${esc(eg.email)} <span class="mail-k">and ${fmt(ps.length - 1)} more, one email each</span>`
        : esc(eg.email) + (ps.length ? '' : ' <span class="mail-k">for example</span>');
      $('n-preview').innerHTML =
        '<div class="mail-head">' +
          `<div class="mail-line"><span class="mail-k">From</span><span>${esc(snd.from)}</span></div>` +
          `<div class="mail-line"><span class="mail-k">To</span><span>${to}</span></div>` +
          `<div class="mail-subject">${esc(fill(nstate.subject.trim())) || '<span class="mail-k">No subject</span>'}</div>` +
        '</div>' +
        `<div class="mail-body">${letterHtml(fill(nstate.message))}</div>`;
    };
    paintPreview();
    subj.addEventListener('input', () => { nstate.subject = subj.value; nstate.edited = true; paintPreview(); });
    msg.addEventListener('input', () => { nstate.message = msg.value; nstate.edited = true; paintPreview(); });

    const picked = () => shown.filter((p) => nstate.picked.has(p.id) && p.email);
    const stepOf = () => (nstate.step === 'all' ? 'other' : nstate.step);
    const status = $('n-status');
    // Why the nudge function said no, in words, for Send and the test alike.
    const DEPLOY = '<b>supabase functions deploy nudge --no-verify-jwt</b>';
    const trouble = async (err) => {
      const code = err?.context?.status;
      const said = code ? await err.context.json?.().catch(() => null) : null;
      return code === 503 ? 'Sending isn\'t set up yet: set <b>RESEND_API_KEY</b> and <b>NUDGE_REPLY_TO</b> on the nudge function. Open in Mail works now.'
        : code === 403 ? 'Only Tria\'s team can send these.'
        : code === 502 ? 'Resend refused it. Check the sending domain is verified.'
        : said?.error === 'no_email' ? 'Your account has no email address to send a test to.'
        : code === 400 ? `The live nudge function is older than this page: ${DEPLOY}.`
        : code === 404 || err?.name === 'FunctionsFetchError' || err?.name === 'FunctionsRelayError'
          ? `The nudge function isn't deployed yet: ${DEPLOY}. Open in Mail works now.`
          : 'Couldn\'t send. ' + esc(err?.message || '');
    };

    // Send: two taps, as every irreversible thing in Tria is.
    const send = $('n-send');
    let armed = 0;
    send.addEventListener('click', async () => {
      const ps = picked();
      if (!ps.length) return;
      if (!nstate.subject.trim() || !nstate.message.trim()) { status.textContent = 'Write a subject and a message first.'; return; }
      if (Date.now() - armed > 4000) {
        armed = Date.now();
        send.textContent = `Send to ${fmt(ps.length)}? Tap again`;
        setTimeout(() => { if (armed && Date.now() - armed >= 4000) send.textContent = `Send to ${fmt(ps.length)}`; }, 4100);
        return;
      }
      armed = 0;
      send.disabled = true;
      send.textContent = 'Sending…';
      const done = (line) => { send.disabled = false; send.textContent = `Send to ${fmt(ps.length)}`; status.innerHTML = line; };
      if (DEMO) { done('Sample data: nothing was sent.'); return; }
      try {
        const { data, error } = await sb.functions.invoke('nudge', {
          body: { ids: ps.map((p) => p.id), step: stepOf(), subject: nstate.subject, message: nstate.message },
        });
        if (error) throw error;
        nstate.picked.clear();
        nstate.edited = false;
        nstate.marked = null;
        for (const k in cache) if (k.startsWith('admin_nudge')) delete cache[k];
        await renderNudge();
        $('n-status').textContent = `Sent to ${fmt(data?.sent || 0)}.` + (data?.skipped ? ` ${fmt(data.skipped)} skipped.` : '');
      } catch (err) {
        done(await trouble(err));
      }
    });

    // Send me a test (Zoe, 2026-11-12): the letter as written, filled as the
    // preview is, to your own account's address only. One tap, since it
    // reaches nobody else; never logged as a nudge.
    const test = $('n-test');
    test.addEventListener('click', async () => {
      if (!nstate.subject.trim() || !nstate.message.trim()) { status.textContent = 'Write a subject and a message first.'; return; }
      const { name } = example();
      test.disabled = true;
      test.textContent = 'Sending…';
      const done = (line) => { test.disabled = false; test.textContent = 'Send me a test'; status.innerHTML = line; };
      if (DEMO) { done('Sample data: no test was sent.'); return; }
      try {
        const { data, error } = await sb.functions.invoke('nudge', {
          body: { test: true, name, subject: nstate.subject, message: nstate.message },
        });
        if (error) throw error;
        done(`Sent a test to <b>${esc(data?.to || 'you')}</b>, as ${esc(name)} would get it.`);
      } catch (err) {
        done(await trouble(err));
      }
    });

    // Open in Mail: from the admin's own address. One person gets their name;
    // several go as Bcc with "there".
    $('n-mail').addEventListener('click', () => {
      const ps = picked();
      if (!ps.length) return;
      const name = ps.length === 1 ? firstName(ps[0]) : 'there';
      const fill = (s) => s.replace(/\{name\}/g, name);
      const body = fill(nstate.message.trim()) + '\n\nOpen Tria: https://triaonline.com/';
      const to = ps.length === 1 ? encodeURIComponent(ps[0].email) : '';
      const bcc = ps.length > 1 ? `bcc=${encodeURIComponent(ps.map((p) => p.email).join(','))}&` : '';
      nstate.marked = { ids: ps.map((p) => p.id), step: stepOf() };
      location.href = `mailto:${to}?${bcc}subject=${encodeURIComponent(fill(nstate.subject))}&body=${encodeURIComponent(body)}`;
      status.innerHTML = `Sent it from Mail? <button class="linkish" type="button" id="n-mark">Mark ${fmt(ps.length)} as nudged</button>`;
      wireMark();
    });
    const wireMark = () => $('n-mark')?.addEventListener('click', async () => {
      const m = nstate.marked;
      if (!m) return;
      if (!DEMO) {
        const { error } = await sb.rpc('admin_nudge_sent', { p_ids: m.ids, p_step: m.step, p_via: 'mail' });
        if (error) { status.textContent = 'Couldn\'t mark them. ' + (error.message || ''); return; }
      } else everyone.forEach((p) => { if (m.ids.includes(p.id)) p.nudged = new Date().toISOString(); });
      nstate.marked = null;
      nstate.picked.clear();
      reload();
    });
    wireMark();

    const setStop = async (id, stop) => {
      if (!DEMO) {
        const { error } = await sb.rpc('admin_nudge_stop', { p_id: id, p_stop: stop });
        if (error) { status.textContent = 'Couldn\'t save that. ' + (error.message || ''); return; }
      } else {
        const p = everyone.find((q) => q.id === id);
        if (p) p.stopped = stop;
      }
      nstate.picked.delete(id);
      reload();
    };
    main.querySelectorAll('[data-stop]').forEach((b) => b.addEventListener('click', () => setStop(b.dataset.stop, true)));
    main.querySelectorAll('[data-unstop]').forEach((b) => b.addEventListener('click', () => setStop(b.dataset.unstop, false)));
  }

  // ── Community (admin-extras.sql: no new tracking, only what Tria keeps) ──
  // Every number here is bars since 2026-11-12 (Zoe: "use better style charts
  // for the data at hand"): friends each in its own order, where posts go and
  // what people set up as shares, the circles by members. Bio and pronouns
  // aren't counted (Zoe: "bio doesn't need to be tracked, same for pronouns").
  const THEME = {
    ruby: ['Ruby', '#df2a48'], rose: ['Blush', '#ef6bbf'], coral: ['Coral', '#fb7c46'], amber: ['Amber', '#fdb435'],
    lime: ['Lime', '#abe64c'], jade: ['Jade', '#54e89c'], cyan: ['Cyan', '#52def4'], ocean: ['Ocean', '#367df8'],
    lavender: ['Indigo', '#8564e8'], default: ['Tria', 'linear-gradient(115deg, #00c9ce, #00cc9e)'],
    none: ['None', 'linear-gradient(115deg, #3b4147, #1b1f24)'], photo: ['Photo', 'conic-gradient(#df2a48, #fdb435, #54e89c, #367df8, #8564e8, #df2a48)'],
  };
  const AUDIENCE = { public: 'Anyone', circle: 'My circle', list: 'Chosen people', community: 'A circle' };
  const ADOPTION = [
    ['posted', 'Posted'], ['photo', 'Profile photo'], ['circle', 'In a circle'],
    ['moment', 'Shared a Moment'], ['daily', 'Answered a daily'], ['theme', 'Picked a theme'], ['push', 'Push on'],
    ['pins', 'Pinned a post'], ['charms', 'Wears a charm'], ['private', 'Private account'],
  ];
  const FRIENDS = { 0: 'No friends', 1: '1 friend' };
  let showAllCircles = false;

  async function renderCommunity() {
    const x = await extras();
    if (!x) {
      main.innerHTML = headHtml('Community') + `<div class="callout">${extrasWhy}</div>`;
      return;
    }
    const u = x.users || 0;
    const ad = x.adoption || {};
    const circles = x.circles || [];
    const shown = showAllCircles ? circles : circles.slice(0, 8);
    const themes = {};
    Object.entries(x.themes || {}).forEach(([k, v]) => {
      const key = THEME[k] ? k : 'photo';
      themes[key] = (themes[key] || 0) + v;
    });
    const buckets = x.friends?.buckets || [];
    const aud = x.audiences || {};

    main.innerHTML =
      headHtml('Community') +
      '<div class="grid grid--kpi">' +
        tile('Median friends', fmt(Math.round((x.friends?.median ?? 0) * 10) / 10), 'mutual, each') +
        tile('On their own', fmt(x.friends?.alone), pctTxt(pct(x.friends?.alone, u)) + ' of everyone', 'No friend and no circle') +
        tile('Circles', fmt(circles.length), `${fmt(circles.reduce((a, c) => a + (c.posts7 || 0), 0))} posts this week`) +
        tile('Blocks', fmt(x.blocks?.total), `${fmt(x.blocks?.last30)} in 30 days`) +
      '</div>' +
      '<div class="section grid grid--two">' +
        `<div>${sectionHead('Friends each', 'Mutual')}<div class="card">${barChart(buckets.map((b) => ({
          key: b.label, n: b.n, keep: true, name: esc(FRIENDS[b.label] || `${b.label} friends`),
        })), { total: buckets.reduce((a, b) => a + b.n, 0), sort: false })}</div></div>` +
        `<div>${sectionHead('Posted to', 'Posts, 30 days')}<div class="card">${barChart(shareRows(aud, AUDIENCE), { total: sumOf(aud) })}</div></div>` +
      '</div>' +
      '<div class="section grid grid--two">' +
        `<div>${sectionHead('Set up', 'Of everyone')}<div class="card">${barChart(ADOPTION.map(([k, label]) => ({
          key: k, n: ad[k] || 0, keep: true, name: esc(label),
        })), { total: u })}</div></div>` +
        `<div>${sectionHead('Themes', 'Of everyone')}<div class="card">${barChart(Object.entries(themes).map(([k, v]) => ({
          key: k, n: v, name: esc(THEME[k][0]), lead: `<span class="swatch-dot" style="background:${THEME[k][1]}"></span>`,
        })), { total: u, empty: 'None yet.' })}</div></div>` +
      '</div>' +
      `<div class="section">${sectionHead('Circles', 'By members')}<div class="card">${barChart(shown.map((c) => ({
          key: c.slug, n: c.members, keep: true,
          name: `<a class="who" href="../#/c/${encodeURIComponent(c.slug)}">${esc(c.name)}</a>${c.inviteOnly ? svg('lock', 'i row-lock') : ''}`,
          sub: `c/${esc(c.slug)} · +${fmt(c.joins7)} joined, ${fmt(c.posts7)} ${c.posts7 === 1 ? 'post' : 'posts'} this week`,
          tip: `<b>c/${esc(c.slug)}</b><br>${fmt(c.members)} members<br>+${fmt(c.joins7)} joined this week<br>${fmt(c.posts7)} posts this week`,
        })), { sort: false, max: circles[0]?.members, empty: 'None yet.' })}</div>` +
        (circles.length > 8 ? `<p class="note note--page"><button class="linkish" type="button" id="more-circles">${showAllCircles ? 'Show fewer' : `Show all ${circles.length}`}</button></p>` : '') +
      '</div>' +
      foot();

    $('more-circles')?.addEventListener('click', () => {
      showAllCircles = !showAllCircles;
      const y = window.scrollY;
      renderCommunity().then(() => { watchTitle('Community'); window.scrollTo(0, y); });
    });
  }

  // ── Dailies (admin-dailies.sql) ───────────────────────────────────────────
  // Zoe, 2026-11-11: "daily stats should also be its own page". People per
  // day against who was around that week, replies from others, the prompts
  // that land and the ones that don't. Likes are never read.
  // Laid out again on 2026-11-12 (Zoe: "format the data more cleanly", "best
  // and least on top after today same for answered with"): today, then the
  // prompts that land best and least and what people answer with, then the
  // figures and the charts, then the days themselves, the last week until
  // asked for more.
  const ASKS = { photo: 'Frame', note: 'Note', find: 'Find', poll: 'Poll' };
  let showAllDays = false;
  async function renderDailies() {
    let d;
    try { d = await call('admin_dailies'); } catch (err) {
      const why = missing(err) ? 'Run <b>supabase/admin-dailies.sql</b>.'
        : err?.code === '42P01' ? 'Run <b>supabase/daily-analytics.sql</b>, then <b>supabase/admin-dailies.sql</b>.'
        : 'Couldn\'t load these. ' + esc(err?.message || '');
      main.innerHTML = headHtml('Dailies') + `<div class="callout">${why}</div>`;
      return;
    }
    const days = d.days || [];
    const todayIso = new Date().toLocaleDateString('en-CA', { timeZone: d.tz || 'America/New_York' });
    const today = days.find((r) => String(r.day).slice(0, 10) === todayIso);
    const done = days.filter((r) => r !== today);   // finished days only, for rates
    const sum = (rows, k) => rows.reduce((a, r) => a + (r[k] || 0), 0);
    const perDay = done.length ? Math.round((sum(done, 'people') / done.length) * 10) / 10 : null;
    const rate = pct(sum(done, 'people'), sum(done, 'around'));
    const replied = pct(sum(days, 'replied'), sum(days, 'answers'));
    const prompts = (d.prompts || []).filter((p) => p.runs > 0);
    // Best and least never name the same prompt: with fewer than twelve run,
    // the top half is best and the rest least.
    const best = prompts.slice().sort((a, b) => b.avgPeople - a.avgPeople || b.answers - a.answers)
      .slice(0, Math.min(6, Math.ceil(prompts.length / 2)));
    const quiet = prompts.filter((p) => !best.includes(p)).sort((a, b) => a.avgPeople - b.avgPeople || a.answers - b.answers).slice(0, 6);
    // Zoe, 2026-11-11: "dailies need graphs". Every week since the first daily,
    // and the weekdays, since the rotation is planned by weekday.
    const weeks = d.weeks || [];
    const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const DOW_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const dows = DOW.map((name, i) => (d.weekdays || []).find((w) => w.dow === i + 1) || { dow: i + 1, avgPeople: 0, days: 0 });
    // Best and least share one scale, so a quiet prompt looks quiet.
    const top = Math.max(1, ...prompts.map((p) => p.avgPeople || 0));
    const promptBars = (ps) => barChart(ps.map((p) => ({
      key: p.slug, n: p.avgPeople || 0, keep: true, name: esc(p.prompt), val: fmt(p.avgPeople),
      sub: `${esc(ASKS[p.type] || p.type)} · ran ${fmt(p.runs)} ${p.runs === 1 ? 'time' : 'times'} · ${fmt(p.answers)} ${p.answers === 1 ? 'answer' : 'answers'}`,
      tip: `<b>${esc(p.prompt)}</b><br>${fmt(p.avgPeople)} people a run<br>${fmt(p.answers)} answers over ${fmt(p.runs)} ${p.runs === 1 ? 'run' : 'runs'}`,
    })), { sort: false, max: top, empty: 'None yet.' });
    // A day: its date as a little calendar page, the prompt, then how it went.
    const dayRow = (r) => {
      const dt = new Date(String(r.day).slice(0, 10) + 'T12:00:00');
      const isToday = r === today;
      return row({
        lead: `<span class="day-chip" aria-hidden="true"><small>${esc(dt.toLocaleDateString('en-US', { weekday: 'short' }))}</small><b>${dt.getDate()}</b></span>`,
        title: esc(r.prompt),
        sub: [esc(ASKS[r.type] || r.type), isToday ? 'so far' : `${pctTxt(pct(r.people, r.around))} of ${fmt(r.around)} around`,
          `${fmt(r.replied)} got a reply`].join(' · '),
        val: `<b>${fmt(r.people)}</b>`,
        tipText: `<b>${esc(day(r.day))}</b><br>${fmt(r.people)} of ${fmt(r.around)} around answered (${pctTxt(pct(r.people, r.around))})<br>${fmt(r.answers)} answers, ${fmt(r.replied)} got a reply`,
      });
    };
    const listed = showAllDays ? days : days.slice(0, 7);

    main.innerHTML =
      headHtml('Dailies') +
      (today ? `<div class="card daily-now"><div class="tile-label">Today · ${esc(ASKS[today.type] || today.type)}</div>` +
        `<p class="daily-prompt">${esc(today.prompt)}</p>` +
        `<p class="tile-note">${fmt(today.people)} ${today.people === 1 ? 'person has' : 'people have'} answered so far` +
          (perDay != null ? `. A day averages ${fmt(perDay)}.` : '.') + '</p></div>' : '') +
      `<div class="${today ? 'section ' : ''}grid grid--three">` +
        `<div>${sectionHead('Land best', 'People a run')}<div class="card">${promptBars(best)}</div></div>` +
        `<div>${sectionHead('Land least', 'People a run')}<div class="card">${promptBars(quiet)}</div></div>` +
        `<div>${sectionHead('Answered with', '4 weeks')}<div class="card">${barChart(shareRows(d.types, TYPE_NAMES), { total: sumOf(d.types) })}</div></div>` +
      '</div>' +
      '<div class="section grid grid--kpi">' +
        tile('People a day', fmt(perDay), 'last 4 weeks', 'Average people answering a finished day, last 28 days') +
        tile('Answer rate', pctTxt(rate), 'of people around', 'People who answered, out of those who opened Tria or did something in the 7 days to that day') +
        tile('Got a reply', pctTxt(replied), 'of answers', 'Answers with a comment from someone other than the author. Likes aren\'t counted.') +
        tile('Regulars', fmt(d.regulars), `of ${fmt(d.answerers)} who answered`, 'Answered on 4 or more days in the last 28') +
      '</div>' +
      `<div class="section">${sectionHead('People a day', '4 weeks')}<div class="card" id="c-daily"></div></div>` +
      '<div class="section grid grid--two">' +
        (weeks.length > 1 ? `<div>${sectionHead('All time', 'Since ' + esc(day(weeks[0].week)) + ', a week at a time')}<div class="card" id="c-daily-all"></div></div>` : '') +
        (dows.some((w) => w.days) ? `<div>${sectionHead('By weekday', 'People a day, on average')}<div class="card">${barChart(dows.map((w, i) => ({
          key: DOW[i], n: w.avgPeople || 0, keep: true, name: DOW_NAMES[i], val: fmt(w.avgPeople),
          tip: `<b>${DOW_NAMES[i]}</b><br>${fmt(w.avgPeople)} people a day, over ${fmt(w.days)} ${w.days === 1 ? 'day' : 'days'}`,
        })), { sort: false })}</div></div>` : '') +
      '</div>' +
      `<div class="section">${sectionHead('Every day', 'People who answered')}` + list(listed.length ? listed.map(dayRow) : [row({ title: 'None yet' })]) +
        (days.length > 7 ? `<p class="note note--page"><button class="linkish" type="button" id="more-days">${showAllDays ? 'Show the last week' : `Show all ${days.length}`}</button></p>` : '') +
      '</div>' +
      foot();

    const chron = days.slice().reverse();
    mountLine($('c-daily'), chron, { at: 'day', lines: [{ key: 'people', name: 'People' }], soFar: !!today,
      head: (p) => `<b>${esc(day(p.day))}${p === today ? ', so far' : ''}</b><br>${esc(p.prompt)}`,
      more: (p) => `<br>${fmt(p.answers)} answers, ${pctTxt(pct(p.people, p.around))} of those around`,
      label: 'People answering the daily, last 28 days' });
    if (weeks.length > 1) mountLine($('c-daily-all'), weeks, { lines: [{ key: 'people', name: 'People' }, { key: 'answers', name: 'Answers' }], soFar: true,
      head: (p, i) => `<b>Week of ${esc(day(p.week))}${i === weeks.length - 1 ? ', so far' : ''}</b>`,
      label: 'People answering the daily and answers, a week at a time, all time' });
    $('more-days')?.addEventListener('click', () => {
      showAllDays = !showAllDays;
      const y = window.scrollY;
      renderDailies().then(() => { watchTitle('Dailies'); window.scrollTo(0, y); });
    });
  }

  // ── Dictionary ────────────────────────────────────────────────────────────
  let dictQ = '', dictGroup = '';
  function renderDictionary() {
    const groups = window.TRIA_DICTIONARY || [];
    const total = groups.reduce((a, g) => a + g.items.length, 0);
    main.innerHTML =
      headHtml('Dictionary') +
      '<div class="search">' +
        `<div class="search-box">${svg('search')}<input class="field" id="dict-q" type="search" placeholder="Search ${total} terms" aria-label="Search the dictionary" value="${esc(dictQ)}" autocomplete="off" /></div>` +
        `<div class="scopes" role="group" aria-label="Groups">${[['', 'All'], ...groups.map((g) => [g.group, g.group])].map(([v, l]) =>
          `<button class="pill-quiet${v === dictGroup ? ' is-on' : ''}" type="button" data-group="${esc(v)}" aria-pressed="${v === dictGroup}">${esc(l)}</button>`).join('')}</div>` +
      '</div><div id="dict-body"></div>';
    const q = $('dict-q');
    q.addEventListener('input', () => { dictQ = q.value; paintDict(); });
    main.querySelectorAll('[data-group]').forEach((b) => b.addEventListener('click', () => {
      dictGroup = b.dataset.group;
      main.querySelectorAll('[data-group]').forEach((el) => {
        const on = el.dataset.group === dictGroup;
        el.classList.toggle('is-on', on); el.setAttribute('aria-pressed', on);
      });
      paintDict();
    }));
    paintDict();
  }
  function paintDict() {
    const body = $('dict-body');
    const words = dictQ.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const hit = (it) => words.every((w) => [it.name, it.code, it.where, it.say].join(' ').toLowerCase().includes(w));
    const html = (window.TRIA_DICTIONARY || [])
      .filter((g) => !dictGroup || g.group === dictGroup)
      .map((g) => {
        const items = g.items.filter(hit);
        if (!items.length) return '';
        return `<section class="dict-group"><h2>${esc(g.group)}</h2>` + list(items.map((it) =>
          `<div class="row term"><div class="row-main"><div class="row-title">${esc(it.name)}</div>` +
          `<p class="term-say">${esc(it.say)}</p>` +
          ((it.where || it.code) ? `<div class="term-meta">${it.where ? `<span class="term-where">${esc(it.where)}</span>` : ''}${it.code ? `<code>${esc(it.code)}</code>` : ''}</div>` : '') +
          '</div></div>')) + '</section>';
      }).join('');
    body.innerHTML = html || `<p class="empty">Nothing called "${esc(dictQ)}".</p>`;
  }

  // ── Sample numbers (?demo) ────────────────────────────────────────────────
  const SAMPLE = {
    admin_overview() {
      const today = new Date();
      const series = Array.from({ length: 12 }, (_, i) => {
        const d = new Date(today); d.setDate(d.getDate() - (11 - i) * 7 - 6);
        return { week: d.toISOString().slice(0, 10), active: 40 + i * 6 + (i % 3) * 4, opened: i > 8 ? 70 + i * 5 : 0,
          monthly: 92 + i * 6 + (i % 2) * 3, monthlyOpened: i > 8 ? 130 + i * 4 : 0, joined: 6 + (i % 4) * 3 };
      });
      return {
        asOf: today.toISOString(), tz: 'America/New_York', pingSince: series[9].week,
        users: 214, new7: 18, new30: 61, dau: 31, wau: 104, mau: 152, avgDau28: 28.4, mau28: 149,
        openedDau: 52, openedWau: 128, openedMau: 171, webVisitors7: 87, installs7: 22,
        friendships: 486, circles: 23, momentsLive: 14,
        kinds7: { post: 96, comment: 212, message: 640, moment: 58, daily: 41, rsvp: 12, vote: 33, friend: 27, circle: 15 },
        types7: { note: 44, photo: 38, take: 6, find: 9, poll: 4, activity: 3, moment: 58, daily: 41, repost: 11 },
        platforms7: { ios: 96, pwa: 14, web: 18 }, series, mauPrev: 131,
        history: Array.from({ length: 40 }, (_, i) => {
          const d = new Date(today); d.setDate(d.getDate() - (39 - i) * 7 - 6);
          const grow = Math.round(4 + i * 2.4 + Math.sin(i / 2) * 5);
          return { week: d.toISOString().slice(0, 10), weekly: Math.max(2, grow + 0 * i), monthly: Math.round(grow * 1.45 + 6) };
        }),
      };
    },
    admin_activity({ p_days }) {
      const SHARE = { moment: 0.12, photo: 0.1, note: 0.1, daily: 0.09, quote: 0.02, song: 0.03, take: 0.01, find: 0.01, poll: 0.01,
        comment: 0.3, message: 0.12, circle: 0.05, friend: 0.04, vote: 0.01, rsvp: 0.01 };
      const d = p_days || 0, m = d ? d / 7 : 30, today = new Date();
      const k = (n, people, r = 0.9) => ({ n: Math.round(n * m), people: Math.round(people * Math.min(m, 3)), prev: d ? Math.round(n * m * r) : null });
      const byWeek = !d || d > 120, len = byWeek ? 40 : d;
      return {
        days: d, from: new Date(today - (len * (byWeek ? 7 : 1) - 1) * 864e5).toISOString().slice(0, 10), to: today.toISOString().slice(0, 10),
        prevFrom: d ? 'x' : null, byWeek,
        active: Math.round(104 * Math.min(m, 1.6)), activePrev: d ? Math.round(94 * Math.min(m, 1.6)) : null,
        makers: Math.round(46 * Math.min(m, 1.6)), makersPrev: d ? Math.round(41 * Math.min(m, 1.6)) : null,
        kinds: { comment: k(243, 61, 1.1), message: k(100, 34, 0.8), circle: k(91, 50, 0.7), post: k(80, 38), friend: k(37, 25, 1.2), moment: k(36, 21), daily: k(26, 26, 1.05), vote: k(6, 6, 2), rsvp: k(4, 4) },
        types: { moment: k(36, 21), photo: k(30, 19), note: k(29, 17, 1.1), daily: k(26, 26), quote: k(6, 5), song: k(8, 7, 0.5), take: k(3, 3), find: k(2, 2), poll: k(2, 2, 1.5) },
        audiences: { circle: Math.round(52 * m), public: Math.round(31 * m), community: Math.round(19 * m), list: Math.round(4 * m) },
        conversation: { posts: Math.round(106 * m), replied: Math.round(71 * m), comments: Math.round(243 * m), firstReplyH: 1.8 },
        chats: { direct: { messages: Math.round(70 * m), chats: 21, people: 30 }, group: { messages: Math.round(24 * m), chats: 4, people: 14 }, activity: { messages: Math.round(6 * m), chats: 2, people: 7 } },
        series: Array.from({ length: len }, (_, i) => {
          const at = new Date(today - (len - 1 - i) * (byWeek ? 7 : 1) * 864e5).toISOString().slice(0, 10);
          const e = Math.round((byWeek ? 40 + i * 9 : 60 + (i % 7 === 5 || i % 7 === 6 ? 30 : 0)) + Math.sin(i) * 12);
          const by = {};
          Object.entries(SHARE).forEach(([key, sh], j) => {
            const n = Math.max(0, Math.round(e * sh * (1 + Math.sin(i * 1.3 + j) * 0.4)));
            if (n) by[key] = [n, Math.max(1, Math.round(n / 1.6))];
          });
          const mk = Object.keys(by).filter((key) => key in TYPE_NAMES);
          const mn = mk.reduce((x, key) => x + by[key][0], 0);
          if (mn) by.made = [mn, Math.max(1, Math.round(mn / 1.9))];
          return { at, events: e, people: Math.round(e / 3.4), posts: mn, by };
        }),
        audiencesBy: Object.fromEntries(['photo', 'note', 'daily', 'quote', 'song', 'take', 'find', 'poll'].map((t, j) => {
          const n = Math.round([30, 29, 26, 6, 8, 3, 2, 2][j] * m);
          return [t, Object.fromEntries([['circle', 0.5], ['public', 0.3], ['community', 0.15], ['list', 0.05]]
            .map(([au, r]) => [au, Math.round(n * r * (1 + j / 10))]).filter(([, v]) => v > 0))];
        })),
        conversationBy: Object.fromEntries(['photo', 'note', 'daily', 'quote', 'song', 'take', 'find', 'poll'].map((t, j) => {
          const posts = Math.round([30, 29, 26, 6, 8, 3, 2, 2][j] * m);
          return [t, { posts, replied: Math.round(posts * [0.8, 0.7, 0.5, 0.6, 0.4, 0.9, 0.5, 1][j]), comments: Math.round(posts * [2.6, 2.9, 1.2, 1.5, 0.8, 3, 1, 4][j]), firstReplyH: [1.2, 2.4, 3.1, 0.9, 5, 1.1, 7, 0.6][j] }];
        })),
        circles: [
          { name: 'Film club', slug: 'film', posts: Math.round(14 * m), people: 9, joins: 6, types: { note: Math.round(8 * m), photo: Math.round(4 * m), poll: Math.round(2 * m) } },
          { name: 'Climbing', slug: 'climb', posts: Math.round(9 * m), people: 6, joins: 3, types: { photo: Math.round(7 * m), activity: Math.round(2 * m) } },
          { name: 'D&D', slug: 'dnd', posts: Math.round(6 * m), people: 5, joins: 1, types: { note: Math.round(4 * m), take: Math.round(2 * m) } },
          { name: 'Plant people', slug: 'plants', posts: Math.round(3 * m), people: 3, joins: 4, types: { photo: Math.round(3 * m) } },
        ],
        opened: 131, platforms: { ios: 96, web: 28, pwa: 14 }, os: { ios: 110, mac: 22, android: 9, windows: 4 },
        versions: [{ v: '2.0 (1276)', n: 64 }, { v: '2.0 (1270)', n: 31 }, { v: '2.0 (1262)', n: 12 }],
      };
    },
    admin_settling({ p_days }) {
      const n = p_days === 30 ? 43 : p_days === 90 ? 118 : 196;
      const f = (r) => Math.round(n * r);
      return { days: p_days, pingSince: new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10), people: n, young: 18,
        profile: f(0.72), connected: f(0.61), shared: f(0.47), back: f(0.66), settled: f(0.39), medianH: 21.5 };
    },
    admin_funnel({ p_basis, p_by }) {
      const mk = (key, n, f) => {
        const seq = [n, Math.round(n * f[0]), 0, 0, 0, 0];
        for (let i = 2; i < 6; i++) seq[i] = Math.round(seq[i - 1] * f[i - 1]);
        if (p_basis !== 'install') seq[0] = seq[1];
        const any = seq.map((v, i) => (i < 2 ? v : Math.min(seq[1], Math.round(v * 1.15))));
        return { key, n: seq[0], seq, any, young: Math.round(seq[1] * 0.12), activated: Math.round(seq[4] * 0.86), actMedianH: 19.5, actP75H: 52 };
      };
      const base = [0.58, 0.71, 0.64, 0.8, 0.62];
      const groups = p_by === 'source'
        ? [mk('invite', 40, [0.8, 0.8, 0.9, 0.85, 0.75]), mk('circle', 34, [0.55, 0.7, 0.7, 0.8, 0.6]), mk('direct', 90, [0.5, 0.65, 0.5, 0.75, 0.55]), mk('profile', 22, base)]
        : p_by === 'platform'
          ? [mk('ios', 120, base), mk('pwa', 30, [0.5, 0.6, 0.55, 0.7, 0.5]), mk('web', 36, [0.4, 0.6, 0.5, 0.7, 0.45])]
          : p_by === 'cohort'
            ? ['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02'].map((w, i) => mk(w, 24 + i * 4, base.map((b) => Math.min(0.95, b + i * 0.02))))
            : [mk('all', 186, base)];
      return { basis: p_basis, by: p_by, groups };
    },
    admin_retention() {
      const weeks = ['2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09'];
      return { cohorts: weeks.map((w, i) => {
        const size = 12 + (i * 7) % 15, live = 11 - i;
        return { week: w, size, weeks: Array.from({ length: 8 }, (_, j) => {
          const k = j + 1, eligible = k <= live ? size : 0;
          return { k, eligible, alive: eligible ? Math.round(size * (0.62 * Math.pow(0.9, k) + 0.04 * (i % 3))) : 0 };
        }) };
      }) };
    },
    admin_nudge() {
      const now = Date.now();
      const people = [
        ['Ivy', 'ivy', 2, 'profile', [0, 0, 0, 0], null, false], ['Noor', 'noor', 3, 'profile', [0, 0, 0, 1], null, false],
        ['Theo', 'theo', 4, 'connect', [1, 0, 0, 1], null, false], ['Sam', 'sam', 9, 'connect', [1, 0, 1, 0], 10, false],
        ['Mina', 'mina', 5, 'post', [1, 1, 0, 1], null, false], ['Jo', 'jo', 12, 'return', [1, 1, 1, 0], 3, false],
        ['Rae', 'rae', 40, 'quiet', [1, 1, 1, 1], null, false], ['Kit', 'kit', 30, 'post', [1, 1, 0, 0], null, true],
      ].map(([name, handle, d, step, f, nudged, stopped], i) => ({
        id: '00000000-0000-4000-8000-00000000000' + i, name, handle, email: handle + '@example.com',
        joined: new Date(now - d * 86400000).toISOString(), step,
        profile: !!f[0], connected: !!f[1], acted: !!f[2], returned: !!f[3],
        nudged: nudged == null ? null : new Date(now - nudged * 86400000).toISOString(), nudges: nudged == null ? 0 : 1, stopped,
      }));
      return { asOf: new Date().toISOString(), people };
    },
    admin_dailies() {
      const P = [['title', 'note', 'Give today a title.'], ['flowers', 'note', 'Who deserves their flowers today?'],
        ['never-delete', 'photo', 'Show us a photo you\'d never delete.'], ['petty', 'note', 'What\'s the pettiest hill you\'re dying on?'],
        ['one-song', 'find', 'Share one song the room needs to hear.'], ['kept', 'photo', 'Show us something you\'ve kept for years.'],
        ['overthink', 'note', 'What are you overthinking right now?']];
      const days = Array.from({ length: 28 }, (_, i) => {
        const d = new Date(); d.setDate(d.getDate() - i);
        const [slug, type, prompt] = P[i % P.length];
        const people = i === 0 ? 9 : 14 + ((i * 7) % 13);
        return { day: d.toLocaleDateString('en-CA'), slug, type, prompt, run: 2, answers: people + (i % 3), people,
          replied: Math.round(people * 0.6), around: 96 + (i % 5) * 3 };
      });
      return {
        asOf: new Date().toISOString(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone, days,
        prompts: P.map(([slug, type, prompt], i) => ({ slug, type, prompt, runs: 2, answers: 40 - i * 4, avgPeople: 19 - i * 1.5 })),
        types: { note: 260, photo: 170, find: 48 }, answerers: 88, regulars: 31,
        weeks: Array.from({ length: 16 }, (_, i) => {
          const d = new Date(); d.setDate(d.getDate() - (15 - i) * 7 - ((d.getDay() + 6) % 7));
          const people = Math.round(8 + i * 2.2 + (i % 3) * 3);
          return { week: d.toLocaleDateString('en-CA'), people, answers: Math.round(people * 2.4) };
        }),
        weekdays: [17.2, 15.8, 11.4, 19.6, 14.1, 21.3, 12.7].map((avgPeople, i) => ({ dow: i + 1, avgPeople, days: 15 })),
      };
    },
    admin_extras() {
      const rhythm = [];
      for (let d = 0; d < 7; d++) for (let h = 7; h < 24; h++) {
        const n = Math.round(4 + 30 * Math.exp(-((h - 20) ** 2) / 10) + 12 * Math.exp(-((h - 12) ** 2) / 4) + (d === 0 || d === 6 ? 8 : 0));
        rhythm.push([d, h, n]);
      }
      return {
        asOf: new Date().toISOString(), users: 214,
        friends: { median: 4, alone: 23, buckets: [
          { label: '0', n: 31 }, { label: '1', n: 22 }, { label: '2 to 4', n: 58 }, { label: '5 to 9', n: 61 }, { label: '10 to 24', n: 34 }, { label: '25 or more', n: 8 }] },
        circles: [
          ['dnd', 'Dungeons and Dragons', 41, 3, 12, false], ['film', 'Film club', 33, 2, 9, false], ['plants', 'Plant people', 27, 4, 6, false],
          ['nyc', 'New York', 24, 1, 14, false], ['poems', 'Poems', 18, 2, 7, false], ['runclub', 'Run club', 15, 0, 3, true],
          ['books', 'Books', 14, 1, 2, false], ['synths', 'Synths', 9, 0, 1, false], ['knit', 'Knitting', 7, 1, 2, true], ['bikes', 'Bikes', 4, 0, 0, false],
        ].map(([slug, name, members, joins7, posts7, inviteOnly]) => ({ slug, name, members, joins7, posts7, inviteOnly })),
        dailies: ['title', 'flowers', 'never-delete', 'petty', 'one-song', 'kept', 'overthink', 'desk'].map((slug, i) => {
          const d = new Date(); d.setDate(d.getDate() - i);
          return { slug, day: d.toISOString().slice(0, 10), answers: 30 - i * 3 + (i % 2) * 5, people: 28 - i * 3 };
        }),
        rhythm,
        invites: { total: 64, last30: 19, top: [{ name: 'Ana', handle: 'ana', n: 12 }, { name: 'Ben', handle: 'ben', n: 8 }, { name: 'Cat', handle: 'cat', n: 5 }] },
        adoption: { photo: 171, private: 150, charms: 48, pins: 39, theme: 97, push: 120, posted: 166, moment: 88, circle: 102, daily: 94 },
        themes: { photo: 90, default: 41, ocean: 21, lavender: 17, rose: 14, jade: 11, coral: 8, none: 7, amber: 5 },
        audiences: { circle: 310, public: 120, community: 96, list: 22 },
        newest: [['Mina', 'mina', 0, 'invite', 'ios', [1, 1, 1, 0]], ['Theo', 'theo', 1, 'circle', 'ios', [1, 1, 0, 1]], ['Ivy', 'ivy', 2, 'direct', 'pwa', [0, 0, 0, 0]],
          ['Luca', 'luca', 3, 'profile', 'ios', [1, 1, 1, 1]], ['Rae', 'rae', 5, 'referral', 'web', [1, 0, 0, 1]]].map(([name, handle, d, source, platform, s]) => ({
          name, handle, joined: new Date(Date.now() - d * 86400000).toISOString(), source, platform,
          profile: !!s[0], connected: !!s[1], acted: !!s[2], returned: !!s[3] })),
        blocks: { total: 6, last30: 2 },
      };
    },
  };

  boot();
})();
