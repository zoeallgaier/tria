/* Tria admin (Zoe, 2026-11-11): the Dictionary, and the numbers.
   Reads supabase/admin-dashboard.sql's and admin-extras.sql's admin_*
   functions, which refuse anyone not in public.admins, and which leave admins
   themselves out of every number. Same origin as the site, so a session made
   on triaonline.com is this page's too. `?demo` draws sample numbers, flagged.

   HIG: a large title that hands over to the bar's inline title as it scrolls
   under; a tab bar on a phone, a sidebar from 900px; segmented controls; inset
   grouped lists; every target 44pt. */
(() => {
  'use strict';

  const { url, key } = window.TRIA_CONFIG;
  const sb = window.supabase.createClient(url, key);
  const DEMO = new URLSearchParams(location.search).has('demo');
  const $ = (id) => document.getElementById(id);
  const main = $('main'), nav = $('nav'), navTitle = $('nav-title');
  const tabbar = $('tabbar'), side = $('side'), sideList = $('side-list');
  const refreshBtn = $('refresh'), outBtn = $('sign-out'), sideOut = $('side-out'), sideAsof = $('side-asof');
  const tip = $('tooltip');

  const ICON = {
    overview: '<path d="M5 20v-6M12 20V5M19 20v-10"/>',
    funnel: '<path d="M3.5 5h17l-6.5 7.5V19l-4 2v-8.5z"/>',
    retention: '<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>',
    community: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><circle cx="17" cy="9" r="2.6"/><path d="M16.6 14.6c2.6.2 4.3 1.9 4.9 4.9"/>',
    dictionary: '<path d="M5 19.5v-15A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5 1.5 1.5 0 0 0 6.5 21H19"/>',
    refresh: '<path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/>',
    out: '<path d="M14 4h3.5A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5H14"/><path d="M9.5 16.5 5 12l4.5-4.5M5 12h11"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.4-4.4"/>',
    lock: '<rect x="5" y="11" width="14" height="9.5" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  };
  const svg = (k, cls = 'i') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>`;

  const TABS = [
    { key: 'overview', label: 'Overview' },
    { key: 'funnel', label: 'Funnel' },
    { key: 'retention', label: 'Retention' },
    { key: 'community', label: 'Community' },
    { key: 'dictionary', label: 'Dictionary' },
  ];
  let dataOk = false;          // an admin and the SQL is run (or demo)
  let extrasOk = true;         // admin-extras.sql is run
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

  // ── The bar: material once content is under it, the inline title once
  //    the large one has gone under. ───────────────────────────────────────
  let titleWatch = null;
  function watchTitle(title) {
    navTitle.textContent = title;
    titleWatch?.disconnect();
    nav.classList.remove('is-titled');
    const h1 = main.querySelector('h1');
    if (!h1) return;
    titleWatch = new IntersectionObserver(([e]) => {
      nav.classList.toggle('is-titled', !e.isIntersecting && e.boundingClientRect.top < nav.offsetHeight);
    }, { rootMargin: `-${nav.offsetHeight}px 0px 0px 0px` });
    titleWatch.observe(h1);
  }
  const syncUnder = () => nav.classList.toggle('is-under', window.scrollY > 2);
  window.addEventListener('scroll', () => { hideTip(); syncUnder(); }, { passive: true });

  // ── Data ──────────────────────────────────────────────────────────────────
  let fetchedAt = null;
  async function call(fn, args) {
    const id = fn + JSON.stringify(args || {});
    if (cache[id]) return cache[id];
    if (DEMO) return (cache[id] = SAMPLE[fn](args || {}));
    const { data, error } = await sb.rpc(fn, args || {});
    if (error) throw error;
    fetchedAt = new Date();
    sideAsof.textContent = 'Updated ' + clock(fetchedAt);
    return (cache[id] = data);
  }

  // ── Shell ─────────────────────────────────────────────────────────────────
  function currentTab() {
    const h = location.hash.slice(1);
    if (!dataOk) return 'dictionary';
    return TABS.some((t) => t.key === h) ? h : 'overview';
  }
  function paintShell(on) {
    side.hidden = !on; tabbar.hidden = !on;
    document.body.classList.toggle('has-side', on);
    document.body.classList.toggle('has-tabs', on);
    refreshBtn.hidden = !on || !dataOk;
    outBtn.hidden = !on || DEMO;
    sideOut.hidden = DEMO;
    if (!on) return;
    const cur = currentTab();
    const dead = (k) => !dataOk && k !== 'dictionary';
    tabbar.innerHTML = TABS.map((t) =>
      `<button class="tab" type="button" data-tab="${t.key}"${t.key === cur ? ' aria-current="page"' : ''}${dead(t.key) ? ' disabled' : ''}>` +
      `${svg(t.key)}<span>${esc(t.label)}</span></button>`).join('');
    sideList.innerHTML = TABS.map((t) =>
      `<button class="side-row" type="button" data-tab="${t.key}"${t.key === cur ? ' aria-current="page"' : ''}${dead(t.key) ? ' disabled' : ''}>` +
      `${svg(t.key)}<span>${esc(t.label)}</span></button>`).join('');
  }
  for (const el of [tabbar, sideList]) {
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-tab]');
      if (!b || b.disabled) return;
      if (location.hash.slice(1) === b.dataset.tab) window.scrollTo({ top: 0, behavior: 'smooth' });
      else location.hash = b.dataset.tab;
    });
  }
  refreshBtn.innerHTML = svg('refresh');
  outBtn.innerHTML = svg('out');
  sideOut.innerHTML = svg('out') + '<span>Log out</span>';
  refreshBtn.addEventListener('click', async () => {
    for (const k in cache) delete cache[k];
    refreshBtn.classList.add('is-spinning');
    const y = window.scrollY;
    await render(false);
    window.scrollTo(0, y);
    refreshBtn.classList.remove('is-spinning');
  });
  const signOut = async () => { await sb.auth.signOut(); location.hash = ''; boot(); };
  outBtn.addEventListener('click', signOut);
  sideOut.addEventListener('click', signOut);
  window.addEventListener('hashchange', () => render(true));

  async function render(top = true) {
    hideTip();
    paintShell(true);
    if (top) window.scrollTo(0, 0);
    const t = currentTab();
    try {
      if (t === 'overview') await renderOverview();
      else if (t === 'funnel') await renderFunnel();
      else if (t === 'retention') await renderRetention();
      else if (t === 'community') await renderCommunity();
      else renderDictionary();
    } catch (err) {
      main.innerHTML = `<div class="gate"><h1>Hm.</h1><p>Couldn't load that. ${esc(err.message || '')}</p></div>`;
    }
    if (!dataOk && !DEMO) {
      main.insertAdjacentHTML('afterbegin',
        '<div class="callout banner">The numbers need <b>supabase/admin-dashboard.sql</b> run in the Supabase SQL editor. The Dictionary is here meanwhile.</div>');
    }
    watchTitle(TABS.find((x) => x.key === t)?.label || '');
    syncUnder();
  }

  // ── The gate ──────────────────────────────────────────────────────────────
  function renderSignIn() {
    paintShell(false);
    navTitle.textContent = '';
    main.innerHTML = `
      <div class="gate">
        <h1>Tria admin</h1>
        <p>Log in with your Tria account.</p>
        <form id="signin" novalidate>
          <input class="field" type="email" name="email" placeholder="Email" autocomplete="email" required />
          <input class="field" type="password" name="password" placeholder="Password" autocomplete="current-password" required />
          <p class="err" id="err"></p>
          <button class="publish-fill" type="submit">Log in</button>
        </form>
        <p class="note">Signed in with Apple or Google? <a href="../">Log in on triaonline.com</a>, then come back here.</p>
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
    const { data: isAdmin, error } = await sb.rpc('is_admin');
    if (error && (error.code === 'PGRST202' || error.code === '42883')) { dataOk = false; render(); return; }
    if (!isAdmin) {
      paintShell(false);
      outBtn.hidden = false;
      main.innerHTML = '<div class="gate"><h1>Not here.</h1><p>This page is for Tria\'s team.</p></div>';
      return;
    }
    dataOk = true;
    render();
  }

  // ── Building blocks ───────────────────────────────────────────────────────
  function headHtml(title, lede, asOf) {
    return `<div class="head"><h1>${esc(title)}${DEMO ? '<span class="sample-flag">Sample data</span>' : ''}</h1>` +
      (lede ? `<p class="lede">${lede}</p>` : '') +
      (asOf ? `<p class="asof">As of ${esc(new Date(asOf).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}</p>` : '') + '</div>';
  }
  const sectionHead = (title, lede) =>
    `<div class="section-head"><h2>${esc(title)}</h2>${lede ? `<p class="lede">${lede}</p>` : ''}</div>`;
  function tile(label, value, note, tipText) {
    return `<div class="card tile"${tipText ? ` data-tip="${esc(tipText)}"` : ''}>` +
      `<div class="tile-label">${esc(label)}</div><div class="tile-value">${value}</div>` +
      (note ? `<div class="tile-note">${note}</div>` : '') + '</div>';
  }
  // An inset grouped list row: title (and sub), then a meter and/or a value.
  function row({ title, sub, val, meter, lead, tipText, cls }) {
    return `<div class="row${cls ? ' ' + cls : ''}"${tipText ? ` data-tip="${esc(tipText)}"` : ''}>${lead || ''}` +
      `<div class="row-main"><div class="row-title">${title}</div>${sub ? `<div class="row-sub">${sub}</div>` : ''}</div>` +
      (meter != null ? `<div class="row-meter" aria-hidden="true"><span style="width:${Math.max(0, Math.min(100, meter))}%"></span></div>` : '') +
      (val != null ? `<div class="row-val">${val}</div>` : '') + '</div>';
  }
  const list = (rows, more) => `<div class="list">${rows.join('')}${more || ''}</div>`;
  function segmented(name, opts, cur, label) {
    return `<div><span class="control-label" id="seg-${name}">${esc(label)}</span>` +
      `<div class="segmented" role="group" aria-labelledby="seg-${name}">` + opts.map(([v, l]) =>
        `<button type="button" data-${name}="${esc(v)}" aria-pressed="${String(v) === String(cur)}">${esc(l)}</button>`).join('') +
      '</div></div>';
  }

  function barsHtml(obj, names, total) {
    const rows = Object.entries(obj || {}).sort((a, b) => b[1] - a[1]);
    if (!rows.length) return '<p class="empty">Nothing this week yet.</p>';
    const max = Math.max(...rows.map((r) => r[1]));
    const sum = total ?? rows.reduce((s, r) => s + r[1], 0);
    return '<div class="bars">' + rows.map(([k, v]) => {
      const name = names[k] || k;
      return `<div class="barrow" data-tip="<b>${esc(name)}</b><br>${fmt(v)}, ${pctTxt(pct(v, sum))} of these">` +
        `<span class="barrow-name">${esc(name)}</span>` +
        `<span class="barrow-track"><span class="barrow-fill" style="width:${(v / max) * 100}%"></span></span>` +
        `<span class="barrow-val">${fmt(v)}</span></div>`;
    }).join('') + '</div>';
  }
  const chartW = () => Math.round(Math.max(300, Math.min(980, main.clientWidth - 2 * parseFloat(getComputedStyle(main).paddingLeft) - 36))) || 640;
  function niceMax(v) {
    const p = Math.pow(10, Math.floor(Math.log10(Math.max(1, v))));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
    return 10 * p;
  }

  // A weekly line chart: two series on one scale, a crosshair and a hover card.
  function lineChart(series) {
    // Drawn at the card's own width, so its words are their real size.
    const W = chartW(), H = W < 480 ? 200 : 240, L = 34, R = 10, T = 12, B = 26;
    const n = series.length;
    const nice = niceMax(Math.max(1, ...series.map((s) => Math.max(s.active, s.opened))));
    const x = (i) => L + (n === 1 ? 0 : (i / (n - 1)) * (W - L - R));
    const y = (v) => T + (1 - v / nice) * (H - T - B);
    // Opened only exists since the ping shipped: its line starts there.
    const from = Math.max(0, series.findIndex((s) => s.opened > 0));
    const hasOpened = series.some((s) => s.opened > 0);
    const path = (k) => series.map((s, i) => (k === 'opened' && i < from) ? ''
      : `${(k === 'opened' ? i === from : !i) ? 'M' : 'L'}${x(i).toFixed(1)},${y(s[k]).toFixed(1)}`).join('');
    let g = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Weekly active people, last 12 weeks">`;
    [0, nice / 2, nice].forEach((t) => {
      g += `<line class="${t ? 'gridline' : 'baseline'}" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/>` +
        `<text x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${fmt(t)}</text>`;
    });
    series.forEach((s, i) => {
      if ((n - 1 - i) % (W < 480 ? 3 : 2) === 0) g += `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${esc(day(s.week))}</text>`;
    });
    g += `<path class="area" d="${path('active')}L${x(n - 1)},${y(0)}L${x(0)},${y(0)}Z"/>`;
    if (hasOpened) g += `<path class="line line--b" d="${path('opened')}"/>`;
    g += `<path class="line line--a" d="${path('active')}"/>`;
    g += `<line class="cross" x1="0" x2="0" y1="${T}" y2="${H - B}" visibility="hidden"/>`;
    g += '<circle class="dot dot--a" r="4" visibility="hidden"/>';
    if (hasOpened) g += '<circle class="dot dot--b" r="4" visibility="hidden"/>';
    g += `<rect class="hit" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}"/></svg>`;
    const legend = '<ul class="legend"><li><span class="swatch"></span>Meaningful</li>' +
      (hasOpened ? '<li><span class="swatch swatch--b"></span>Opened</li>' : '') + '</ul>';
    return { html: legend + g, wire(root) {
      const el = root.querySelector('svg.chart');
      const cross = el.querySelector('.cross'), da = el.querySelector('.dot--a'), db = el.querySelector('.dot--b');
      const at = (e) => {
        const r = el.getBoundingClientRect();
        const vx = ((e.clientX - r.left) / r.width) * W;
        const i = Math.max(0, Math.min(n - 1, Math.round(((vx - L) / (W - L - R)) * (n - 1))));
        const s = series[i];
        cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
        da.setAttribute('cx', x(i)); da.setAttribute('cy', y(s.active)); da.setAttribute('visibility', 'visible');
        if (db) { db.setAttribute('cx', x(i)); db.setAttribute('cy', y(s.opened)); db.setAttribute('visibility', i >= from ? 'visible' : 'hidden'); }
        showTip(`<b>Week of ${esc(day(s.week))}</b><br><span class="k"></span>Meaningful ${fmt(s.active)}` +
          (hasOpened && i >= from ? `<br><span class="k k--b"></span>Opened ${fmt(s.opened)}` : '') +
          `<br>New accounts ${fmt(s.joined)}`, e.clientX, e.clientY);
      };
      const hit = el.querySelector('.hit');
      hit.addEventListener('pointermove', at);
      hit.addEventListener('pointerdown', at);
      hit.addEventListener('pointerleave', () => { hideTip(); [cross, da, db].forEach((d) => d?.setAttribute('visibility', 'hidden')); });
    } };
  }

  // Vertical columns, for a distribution.
  function columns(items) {
    const W = chartW(), H = 200, L = 8, R = 8, T = 22, B = 26;
    const n = items.length, gap = 10;
    const bw = (W - L - R - gap * (n - 1)) / n;
    const max = Math.max(1, ...items.map((d) => d.n));
    const total = items.reduce((s, d) => s + d.n, 0);
    let g = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="People by number of friends">`;
    g += `<line class="baseline" x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/>`;
    items.forEach((d, i) => {
      const h = (d.n / max) * (H - T - B);
      const x0 = L + i * (bw + gap);
      const y0 = H - B - h;
      // 4px round at the value end, square at the baseline.
      const r = Math.min(4, h, bw / 2);
      g += `<g data-tip="<b>${esc(d.label)} friend${d.label === '1' ? '' : 's'}</b><br>${fmt(d.n)} people, ${pctTxt(pct(d.n, total))}">` +
        `<rect class="hit" x="${x0}" y="${T - 20}" width="${bw}" height="${H - B - T + 20}"/>` +
        (h > 0 ? `<path class="col" d="M${x0},${H - B}V${y0 + r}Q${x0},${y0} ${x0 + r},${y0}H${x0 + bw - r}Q${x0 + bw},${y0} ${x0 + bw},${y0 + r}V${H - B}Z"/>` : '') +
        `<text class="col-label" x="${x0 + bw / 2}" y="${y0 - 6}" text-anchor="middle">${fmt(d.n)}</text>` +
        `<text x="${x0 + bw / 2}" y="${H - 8}" text-anchor="middle">${esc(d.label)}</text></g>`;
    });
    return g + '</svg>';
  }

  // ── Overview ──────────────────────────────────────────────────────────────
  const TYPE_NAMES = {
    note: 'Notes', photo: 'Frames', take: 'Takes', find: 'Finds', poll: 'Polls',
    activity: 'Plans', song: 'Music', repost: 'Reposts and quotes', moment: 'Moments', daily: 'Daily answers',
  };
  const KIND_NAMES = {
    post: 'Posts', moment: 'Moments', daily: 'Daily answers', comment: 'Comments', message: 'Messages',
    rsvp: 'RSVPs', vote: 'Poll votes', friend: 'Friendships made', circle: 'Circle joins',
  };
  const PLATFORM = { ios: 'iOS app', pwa: 'Home screen shortcut', web: 'Web', unknown: 'Before the ping' };
  const SOURCE = { invite: 'Invite link', circle: 'Circle link', profile: 'Profile link', post: 'Post link', daily: 'Daily link', referral: 'Another site', direct: 'Direct', unknown: 'Before the ping' };
  const SKIP_NOTE = 'Admins aren\'t counted, so your own activity is left out of every number here.';

  async function renderOverview() {
    const o = await call('admin_overview');
    const stick = o.mau28 ? pct(o.avgDau28, o.mau28) : null;
    const chart = lineChart(o.series || []);
    const plats = Object.entries(o.platforms7 || {}).sort((a, b) => b[1] - a[1]);
    const platTotal = plats.reduce((s, p) => s + p[1], 0);
    main.innerHTML =
      headHtml('Overview', 'Who\'s here, and who\'s doing something. Active means a meaningful interaction: create or connect, never just a like.', o.asOf) +
      '<div class="grid grid--tiles">' +
        tile('Total users', fmt(o.users), `${fmt(o.new7)} new this week, ${fmt(o.new30)} this month`) +
        tile('Weekly active', fmt(o.wau), `${pctTxt(pct(o.wau, o.users))} of everyone`, 'A meaningful interaction in the last 7 days') +
        tile('Monthly active', fmt(o.mau), 'the last 30 days', 'A meaningful interaction in the last 30 days') +
        tile('Active today', fmt(o.dau), `${fmt(o.avgDau28)} a day on average`) +
        tile('Stickiness', pctTxt(stick), 'daily ÷ monthly, 28 days', 'Average daily actives over the last 28 days, divided by the 28 day actives') +
        tile('Opened this week', fmt(o.openedWau), o.pingSince ? `since ${esc(day(o.pingSince))}` : 'counts start with the open ping', 'Opened Tria at all, from the open ping') +
      '</div>' +
      `<div class="section">${sectionHead('Weekly actives', 'The last 12 weeks, each point the seven days ending that week.')}<div class="card">${chart.html}</div></div>` +
      '<div class="section grid grid--two">' +
        `<div>${sectionHead('Made this week', 'Posts by type.')}<div class="card">${barsHtml(o.types7, TYPE_NAMES)}</div></div>` +
        `<div>${sectionHead('Done this week', 'Every meaningful interaction, by kind.')}<div class="card">${barsHtml(o.kinds7, KIND_NAMES)}</div></div>` +
      '</div>' +
      '<div class="section grid grid--two">' +
        `<div>${sectionHead('Around the place')}` + list([
          row({ title: 'Friendships', val: `<b>${fmt(o.friendships)}</b>` }),
          row({ title: 'Circles', val: `<b>${fmt(o.circles)}</b>` }),
          row({ title: 'Moments live', sub: 'up in the last 24 hours', val: `<b>${fmt(o.momentsLive)}</b>` }),
          row({ title: 'Installs this week', sub: 'the app or a home screen shortcut', val: `<b>${fmt(o.installs7)}</b>` }),
          row({ title: 'Web visitors this week', sub: 'signed out, in a browser', val: `<b>${fmt(o.webVisitors7)}</b>` }),
        ]) + '</div>' +
        `<div>${sectionHead('Opened on', 'People, this week, by where.')}` + list(plats.length
          ? plats.map(([k, v]) => row({ title: esc(PLATFORM[k] || k), meter: pct(v, platTotal), val: `<b>${fmt(v)}</b>` }))
          : [row({ title: 'Nobody yet', sub: 'counts start with the open ping' })]) + '</div>' +
      '</div>' +
      `<p class="footnote">${SKIP_NOTE} Days are ${esc(o.tz)} days.</p>`;
    chart.wire(main);
  }

  // ── Funnel ────────────────────────────────────────────────────────────────
  const STAGES = [
    { name: 'Install', say: 'the app or a shortcut, first opened' },
    { name: 'Account', say: 'an @handle claimed' },
    { name: 'Profile complete', say: 'a photo or a bio' },
    { name: 'Connected', say: 'added someone or joined a circle' },
    { name: 'First action', say: 'a first post, comment, message…' },
    { name: 'Returned', say: 'back within 7 days' },
  ];
  const fstate = { basis: 'account', by: 'none', days: 90 };
  const groupName = (by, k) => (by === 'source' ? SOURCE[k] || k : by === 'platform' ? PLATFORM[k] || k : by === 'cohort' ? 'Week of ' + day(k) : 'Everyone');

  async function renderFunnel() {
    const res = await call('admin_funnel', { p_days: fstate.days, p_basis: fstate.basis, p_by: fstate.by });
    const groups = res.groups || [];
    const first = fstate.basis === 'install' ? 0 : 1;
    const r0 = fstate.by === 'none' ? res : await call('admin_funnel', { p_days: fstate.days, p_basis: fstate.basis, p_by: 'none' });
    const overall = r0.groups?.[0] || { seq: [0, 0, 0, 0, 0, 0], any: [0, 0, 0, 0, 0, 0], young: 0, activated: 0 };

    const top = overall.seq[first] || 0;
    let worst = -1, worstRate = 2;
    for (let i = first + 1; i < 6; i++) {
      const prev = overall.seq[i - 1];
      if (!prev) continue;
      const r = overall.seq[i] / prev;
      if (r < worstRate) { worstRate = r; worst = i; }
    }
    let steps = '';
    for (let i = first; i < 6; i++) {
      const v = overall.seq[i], anyV = overall.any[i];
      if (i > first) {
        steps += `<div class="gap${i === worst ? ' is-worst' : ''}"><span>↓ ${pctTxt(pct(v, overall.seq[i - 1]))} carry on${i === worst ? ', the biggest drop' : ''}</span></div>`;
      }
      steps += `<div class="step" data-tip="<b>${esc(STAGES[i].name)}</b><br>${fmt(v)} in order, ${fmt(anyV)} at all<br>${pctTxt(pct(v, top))} of the top">` +
        `<span class="step-n">${i + 1 - first}</span>` +
        `<span class="step-name">${esc(STAGES[i].name)}<small>${esc(STAGES[i].say)}</small></span>` +
        `<span class="barrow-track"><span class="barrow-ghost" style="width:${top ? (anyV / top) * 100 : 0}%"></span><span class="barrow-fill" style="width:${top ? (v / top) * 100 : 0}%"></span></span>` +
        `<span class="step-val"><b>${fmt(v)}</b><small>${pctTxt(pct(v, top))}</small></span></div>`;
    }
    const worstLine = worst > 0
      ? `The biggest drop is <b>${esc(STAGES[worst - 1].name)} → ${esc(STAGES[worst].name)}</b>: ${pctTxt(100 - pct(overall.seq[worst], overall.seq[worst - 1]))} stop there (${fmt(overall.seq[worst - 1] - overall.seq[worst])} people).`
      : 'Not enough people yet to see a drop.';

    let split = '';
    if (fstate.by !== 'none') {
      const head = '<tr><th>' + esc({ cohort: 'Cohort', source: 'Source', platform: 'Platform' }[fstate.by]) + '</th>' +
        STAGES.slice(first).map((s) => `<th>${esc(s.name)}</th>`).join('') + '<th>Activated</th><th>Median time</th></tr>';
      const rows = groups.map((g) => {
        const t = g.seq[first];
        const cells = g.seq.slice(first).map((v, j) => (j === 0 ? `<td>${fmt(v)}</td>`
          : `<td>${pctTxt(pct(v, t))}<span class="sub">${fmt(v)}</span></td>`)).join('');
        return `<tr><td>${esc(groupName(fstate.by, g.key))}</td>${cells}` +
          `<td>${pctTxt(pct(g.activated, g.seq[1]))}<span class="sub">${fmt(g.activated)}</span></td><td>${esc(hours(g.actMedianH))}</td></tr>`;
      }).join('');
      const actRows = groups.filter((g) => g.seq[1] > 0).map((g) => {
        const name = groupName(fstate.by, g.key);
        return row({ title: esc(name), sub: `${fmt(g.seq[1])} accounts, median ${esc(hours(g.actMedianH))}`,
          meter: pct(g.activated, g.seq[1]), val: `<b>${pctTxt(pct(g.activated, g.seq[1]))}</b>`,
          tipText: `<b>${esc(name)}</b><br>${fmt(g.activated)} of ${fmt(g.seq[1])} activated` });
      });
      split = `<div class="section">${sectionHead('Split', 'Each stage as a share of the group\'s first. Activated is a share of accounts.')}` +
        `<div class="card"><div class="table-wrap"><table><thead>${head}</thead><tbody>${rows || '<tr><td>Nobody yet</td></tr>'}</tbody></table></div></div></div>` +
        (actRows.length ? `<div class="section">${sectionHead('Activation rate')}${list(actRows)}</div>` : '');
    }

    main.innerHTML =
      headHtml('Funnel', 'From the first open to coming back. Bars are people who reached each stage in order; the pale bar behind is everyone who reached it at all.') +
      '<div class="controls">' +
        segmented('basis', [['account', 'Account'], ['install', 'Install']], fstate.basis, 'Start at') +
        segmented('days', [[30, '30 days'], [90, '90 days'], [0, 'All time']], fstate.days, 'Who started in') +
        segmented('by', [['none', 'None'], ['cohort', 'Cohort'], ['source', 'Source'], ['platform', 'Platform']], fstate.by, 'Split by') +
      '</div>' +
      `<div class="card"><div class="funnel">${steps}</div>` +
        (overall.young ? `<p class="note">${fmt(overall.young)} of these accounts are under a week old and still inside their 7 days to return.</p>` : '') +
        (first === 0 ? '<p class="note">Installs count from when the open ping shipped. A browser visit is not an install.</p>' : '') +
      `<div class="callout">${worstLine}</div></div>` +
      `<div class="section">${sectionHead('Activation', 'Connected and a first action, both within 7 days of the account.')}<div class="grid grid--tiles">` +
        tile('Activated', pctTxt(pct(overall.activated, overall.seq[1])), `${fmt(overall.activated)} of ${fmt(overall.seq[1])} accounts`) +
        tile('Time to activation', esc(hours(overall.actMedianH)), 'median') +
        tile('Slower quarter', esc(hours(overall.actP75H)), 'three in four by then') +
      '</div></div>' + split +
      `<p class="footnote">${SKIP_NOTE}</p>`;

    main.querySelectorAll('.segmented button').forEach((b) => {
      b.addEventListener('click', async () => {
        if (b.dataset.basis) fstate.basis = b.dataset.basis;
        if (b.dataset.days != null) fstate.days = Number(b.dataset.days);
        if (b.dataset.by) fstate.by = b.dataset.by;
        const y = window.scrollY;
        await renderFunnel();
        watchTitle('Funnel');
        window.scrollTo(0, y);
      });
    });
  }

  // ── Retention ─────────────────────────────────────────────────────────────
  async function renderRetention() {
    const r = await call('admin_retention');
    const cohorts = (r.cohorts || []).slice().reverse();
    const head = '<tr><th>Joined the week of</th><th>People</th>' +
      [1, 2, 3, 4, 5, 6, 7, 8].map((k) => `<th>Week ${k}</th>`).join('') + '</tr>';
    const rows = cohorts.map((c) => {
      const cells = (c.weeks || []).map((w) => {
        if (!w.eligible) return '<td class="cell is-empty">·</td>';
        const p = pct(w.alive, w.eligible);
        return `<td class="cell" style="background:color-mix(in srgb, var(--data) ${Math.round(8 + (p / 100) * 62)}%, transparent)" ` +
          `data-tip="<b>Week of ${esc(day(c.week))}</b>, week ${w.k}<br>${fmt(w.alive)} of ${fmt(w.eligible)} came back">${pctTxt(p)}</td>`;
      }).join('');
      return `<tr><td>${esc(day(c.week))}</td><td>${fmt(c.size)}</td>${cells}</tr>`;
    }).join('');
    main.innerHTML =
      headHtml('Retention', 'Each week\'s new accounts, and the share alive in each week after: opened Tria, or did something meaningful.') +
      `<div class="card heat"><div class="table-wrap"><table><thead>${head}</thead><tbody>${rows || '<tr><td>Nobody yet</td></tr>'}</tbody></table></div>` +
      '<p class="note">Week 1 is days 7 to 13 after the account. A dot is a week that hasn\'t happened yet.</p></div>' +
      `<p class="footnote">${SKIP_NOTE}</p>`;
  }

  // ── Community (admin-extras.sql: no new tracking, only what Tria keeps) ──
  const THEME = {
    ruby: ['Ruby', '#df2a48'], rose: ['Blush', '#ef6bbf'], coral: ['Coral', '#fb7c46'], amber: ['Amber', '#fdb435'],
    lime: ['Lime', '#abe64c'], jade: ['Jade', '#54e89c'], cyan: ['Cyan', '#52def4'], ocean: ['Ocean', '#367df8'],
    lavender: ['Indigo', '#8564e8'], default: ['Tria', 'linear-gradient(115deg, #00c9ce, #00cc9e)'],
    none: ['None', 'linear-gradient(115deg, #3b4147, #1b1f24)'], photo: ['Photo', 'conic-gradient(#df2a48, #fdb435, #54e89c, #367df8, #8564e8, #df2a48)'],
  };
  const AUDIENCE = { public: 'Anyone', circle: 'My circle', list: 'Chosen people', community: 'A circle' };
  const ADOPTION = [
    ['posted', 'Has posted'], ['photo', 'Has a photo'], ['bio', 'Wrote a bio'], ['circle', 'In a circle'],
    ['moment', 'Shared a Moment'], ['daily', 'Answered a daily'], ['theme', 'Picked a theme'], ['pins', 'Pinned posts'],
    ['charms', 'Wears a charm'], ['pronouns', 'Pronouns'], ['push', 'Push on'], ['private', 'Private account'],
  ];
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  let showAllCircles = false;

  async function renderCommunity() {
    let x;
    try { x = await call('admin_extras'); } catch (err) {
      if (err.code === 'PGRST202' || err.code === '42883') {
        main.innerHTML = headHtml('Community') +
          '<div class="callout">This section needs <b>supabase/admin-extras.sql</b> run in the Supabase SQL editor. It adds no tracking, only reads what Tria already keeps.</div>';
        return;
      }
      throw err;
    }
    const u = x.users || 0;
    const ad = x.adoption || {};
    const circles = x.circles || [];
    const shown = showAllCircles ? circles : circles.slice(0, 8);
    const themes = {};
    Object.entries(x.themes || {}).forEach(([k, v]) => {
      const key = String(k).startsWith('p:') ? 'photo' : (THEME[k] ? k : 'photo');
      themes[key] = (themes[key] || 0) + v;
    });
    const themeRows = Object.entries(themes).sort((a, b) => b[1] - a[1]).map(([k, v]) => row({
      lead: `<span class="swatch-dot" style="background:${THEME[k][1]}"></span>`,
      title: esc(THEME[k][0]), meter: pct(v, u), val: `<b>${fmt(v)}</b> ${pctTxt(pct(v, u))}`,
    }));
    const aud = x.audiences || {};
    const audTotal = Object.values(aud).reduce((s, v) => s + v, 0);

    // The rhythm: 7 rows by 24 hours.
    const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
    (x.rhythm || []).forEach(([d, h, n]) => { grid[d][h] = n; });
    const rmax = Math.max(1, ...grid.flat());
    let peak = [0, 0, 0];
    grid.forEach((r, d) => r.forEach((n, h) => { if (n > peak[2]) peak = [d, h, n]; }));
    const hr = (h) => (h % 12 || 12) + (h < 12 ? 'am' : 'pm');
    let rhythm = '<div class="rhythm" role="img" aria-label="Meaningful interactions by weekday and hour, last 28 days"><span></span>' +
      Array.from({ length: 24 }, (_, h) => `<span class="rh">${h % 6 === 0 ? hr(h) : ''}</span>`).join('');
    [1, 2, 3, 4, 5, 6, 0].forEach((d) => {
      rhythm += `<span class="rl">${DAYS[d]}</span>` + grid[d].map((n, h) =>
        `<span class="rc" style="${n ? `background:color-mix(in srgb, var(--data) ${Math.round(10 + (n / rmax) * 80)}%, transparent)` : ''}" ` +
        `data-tip="<b>${DAYS[d]} ${hr(h)}</b><br>${fmt(n)} interactions"></span>`).join('');
    });
    rhythm += '</div>';

    const newest = (x.newest || []).map((p) => row({
      title: `${esc(p.name)} <span class="row-sub" style="display:inline">@${esc(p.handle)}</span>`,
      sub: `${esc(ago(p.joined))} · ${esc(SOURCE[p.source] || p.source)} · ${esc(PLATFORM[p.platform] || p.platform)}`,
      val: `<span class="steps" aria-label="Profile ${p.profile ? 'done' : 'not yet'}, connected ${p.connected ? 'yes' : 'no'}, acted ${p.acted ? 'yes' : 'no'}, returned ${p.returned ? 'yes' : 'no'}">` +
        ['profile', 'connected', 'acted', 'returned'].map((k) => `<i class="${p[k] ? 'on' : ''}"></i>`).join('') + '</span>',
      tipText: `<b>${esc(p.name)}</b><br>Profile ${p.profile ? '✓' : '·'}  Connected ${p.connected ? '✓' : '·'}<br>First action ${p.acted ? '✓' : '·'}  Returned ${p.returned ? '✓' : '·'}`,
    }));

    main.innerHTML =
      headHtml('Community', 'How people are connected, what they\'ve set up, and where the life is. All read off what Tria already keeps: no extra tracking.', x.asOf) +
      '<div class="grid grid--tiles">' +
        tile('Median friends', fmt(Math.round((x.friends?.median ?? 0) * 10) / 10), 'mutual, per person') +
        tile('On their own', fmt(x.friends?.alone), `${pctTxt(pct(x.friends?.alone, u))}: no friend, no circle`, 'Nobody to see their posts yet') +
        tile('Invites redeemed', fmt(x.invites?.total), `${fmt(x.invites?.last30)} in the last 30 days`) +
        tile('Blocks', fmt(x.blocks?.total), `${fmt(x.blocks?.last30)} in the last 30 days`) +
      '</div>' +
      `<div class="section">${sectionHead('Friends each', 'Mutual friends per person.')}<div class="card">${columns(x.friends?.buckets || [])}</div></div>` +
      `<div class="section">${sectionHead('Circles', 'By size, with this week\'s joins and posts.')}` +
        list(shown.length ? shown.map((c) => row({
          title: `${esc(c.name)}${c.inviteOnly ? svg('lock', 'i row-lock') : ''}`,
          sub: `c/${esc(c.slug)} · ${fmt(c.joins7)} joined, ${fmt(c.posts7)} posts this week`,
          val: `<b>${fmt(c.members)}</b> ${c.members === 1 ? 'member' : 'members'}`,
        })) : [row({ title: 'No circles yet' })],
        circles.length > 8 ? `<button class="more" type="button" id="more-circles">${showAllCircles ? 'Show fewer' : `Show all ${circles.length}`}</button>` : '') +
      '</div>' +
      '<div class="section grid grid--two">' +
        `<div>${sectionHead('Set up', 'Shares of everyone.')}` + list(ADOPTION.map(([k, label]) =>
          row({ title: esc(label), meter: pct(ad[k], u), val: `<b>${pctTxt(pct(ad[k], u))}</b>`, tipText: `<b>${esc(label)}</b><br>${fmt(ad[k])} of ${fmt(u)} people` }))) + '</div>' +
        `<div>${sectionHead('Themes', 'Profile colours picked.')}` + list(themeRows.length ? themeRows : [row({ title: 'Nobody yet' })]) + '</div>' +
      '</div>' +
      `<div class="section">${sectionHead('When Tria is used', `Meaningful interactions over the last 28 days, by weekday and hour. Busiest: ${peak[2] ? `${DAYS[peak[0]]} at ${hr(peak[1])}` : 'not yet'}.`)}<div class="card">${rhythm}</div></div>` +
      '<div class="section grid grid--two">' +
        `<div>${sectionHead('Dailies', 'The last two weeks, by answers.')}` + list((x.dailies || []).length
          ? x.dailies.map((d) => row({ title: esc(d.slug), sub: esc(day(d.day)), val: `<b>${fmt(d.answers)}</b> ${d.answers === 1 ? 'answer' : 'answers'}` }))
          : [row({ title: 'No answers yet' })]) + '</div>' +
        `<div>${sectionHead('Who posts reach', 'Posts in the last 30 days, by audience.')}` + list(Object.keys(aud).length
          ? Object.entries(aud).sort((a, b) => b[1] - a[1]).map(([k, v]) => row({ title: esc(AUDIENCE[k] || k), meter: pct(v, audTotal), val: `<b>${pctTxt(pct(v, audTotal))}</b>` }))
          : [row({ title: 'No posts yet' })]) +
          `<div style="margin-top:36px">${sectionHead('Top inviters', 'Invite links redeemed. Admins count here: it\'s credit, not skew.')}` +
          list((x.invites?.top || []).length
            ? x.invites.top.map((p) => row({ title: esc(p.name), sub: '@' + esc(p.handle), val: `<b>${fmt(p.n)}</b>` }))
            : [row({ title: 'No invites redeemed yet' })]) + '</div>' +
        '</div>' +
      '</div>' +
      `<div class="section">${sectionHead('Newest accounts', 'And how far each has come: profile, connected, first action, returned.')}${list(newest.length ? newest : [row({ title: 'Nobody yet' })])}</div>` +
      `<p class="footnote">${SKIP_NOTE}</p>`;

    $('more-circles')?.addEventListener('click', () => {
      showAllCircles = !showAllCircles;
      const y = window.scrollY;
      renderCommunity().then(() => { watchTitle('Community'); window.scrollTo(0, y); });
    });
  }

  // ── Dictionary ────────────────────────────────────────────────────────────
  let dictQ = '', dictGroup = '';
  function renderDictionary() {
    const groups = window.TRIA_DICTIONARY || [];
    const total = groups.reduce((s, g) => s + g.items.length, 0);
    main.innerHTML =
      headHtml('Dictionary', `What we call everything, so we always mean the same thing. ${total} terms.`) +
      '<div class="search">' +
        `<div class="search-box">${svg('search')}<input class="field" id="dict-q" type="search" placeholder="Search" aria-label="Search the dictionary" value="${esc(dictQ)}" autocomplete="off" /></div>` +
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
          (it.code ? `<div class="term-code">${esc(it.code)}</div>` : '') +
          (it.where ? `<div class="term-where">${esc(it.where)}</div>` : '') +
          `<p class="term-say">${esc(it.say)}</p></div></div>`)) + '</section>';
      }).join('');
    body.innerHTML = html || `<p class="empty">Nothing called "${esc(dictQ)}" yet.</p>`;
  }

  // ── Sample numbers (?demo) ────────────────────────────────────────────────
  const SAMPLE = {
    admin_overview() {
      const today = new Date();
      const series = Array.from({ length: 12 }, (_, i) => {
        const d = new Date(today); d.setDate(d.getDate() - (11 - i) * 7 - 6);
        return { week: d.toISOString().slice(0, 10), active: 40 + i * 6 + (i % 3) * 4, opened: i > 8 ? 70 + i * 5 : 0, joined: 6 + (i % 4) * 3 };
      });
      return {
        asOf: today.toISOString(), tz: 'America/New_York', pingSince: series[9].week,
        users: 214, new7: 18, new30: 61, dau: 31, wau: 104, mau: 152, avgDau28: 28.4, mau28: 149,
        openedDau: 52, openedWau: 128, openedMau: 171, webVisitors7: 87, installs7: 22,
        friendships: 486, circles: 23, momentsLive: 14,
        kinds7: { post: 96, comment: 212, message: 640, moment: 58, daily: 41, rsvp: 12, vote: 33, friend: 27, circle: 15 },
        types7: { note: 44, photo: 38, take: 6, find: 9, poll: 4, activity: 3, moment: 58, daily: 41, repost: 11 },
        platforms7: { ios: 96, pwa: 14, web: 18 }, series,
      };
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
        adoption: { photo: 171, bio: 132, pronouns: 61, private: 150, charms: 48, pins: 39, theme: 97, push: 120, posted: 166, moment: 88, circle: 102, daily: 94 },
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

  sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT' && !DEMO) renderSignIn(); });
  boot();
})();
