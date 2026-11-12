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
    // Nudge: an envelope.
    nudge: '<rect x="3" y="5.5" width="18" height="13" rx="3"/><path d="m3.8 7.2 8.2 6 8.2-6"/>',
    // Dailies: the app's daily sun.
    dailies: '<circle cx="12" cy="12" r="4"/><path d="M12 2.8v2.2M12 19v2.2M2.8 12H5M19 12h2.2M5.5 5.5l1.6 1.6M16.9 16.9l1.6 1.6M5.5 18.5l1.6-1.6M16.9 7.1l1.6-1.6"/>',
    // They asked us to stop: a struck envelope.
    stop: '<rect x="3" y="5.5" width="18" height="13" rx="3"/><path d="m3.8 7.2 8.2 6 8.2-6"/><path d="M4 3.5 20 20.5"/>',
    retention: '<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>',
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
  // of their own.
  const TABS = [
    { key: 'overview', label: 'Overview' },
    { key: 'nudge', label: 'Nudge' },
    { key: 'retention', label: 'Retention' },
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
      else if (t === 'nudge') await renderNudge();
      else if (t === 'retention') await renderRetention();
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
  function delta(now, before, unit = '') {
    if (before == null || now == null) return '';
    const d = Math.round((now - before) * 10) / 10;
    if (!d) return '<span class="delta">Same as last week</span>';
    return `<span class="delta ${d > 0 ? 'is-up' : 'is-down'}">${d > 0 ? '↑' : '↓'} ${fmt(Math.abs(d))}${unit} on last week</span>`;
  }
  function tile(label, value, note, tipText, cls = '') {
    return `<div class="card tile${cls ? ' ' + cls : ''}"${tipText ? ` data-tip="${esc(tipText)}"` : ''}>` +
      `<div class="tile-label">${esc(label)}</div><div class="tile-value">${value}</div>` +
      (note ? `<div class="tile-note">${note}</div>` : '') + '</div>';
  }
  // A row of small figures in one card.
  const strip = (items) => '<div class="card strip">' + items.map(([label, value, tipText]) =>
    `<div class="strip-item"${tipText ? ` data-tip="${esc(tipText)}"` : ''}><div class="strip-value">${value}</div><div class="strip-label">${esc(label)}</div></div>`).join('') + '</div>';
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

  function barsHtml(obj, names) {
    const rows = Object.entries(obj || {}).sort((a, b) => b[1] - a[1]);
    if (!rows.length) return '<p class="empty">Nothing yet.</p>';
    const max = Math.max(...rows.map((r) => r[1]));
    const sum = rows.reduce((s, r) => s + r[1], 0);
    return '<div class="bars">' + rows.map(([k, v]) => {
      const name = names[k] || k;
      return `<div class="barrow" data-tip="<b>${esc(name)}</b><br>${fmt(v)}, ${pctTxt(pct(v, sum))}">` +
        `<span class="barrow-name">${esc(name)}</span>` +
        `<span class="barrow-track"><span class="barrow-fill" style="width:${(v / max) * 100}%"></span></span>` +
        `<span class="barrow-val">${fmt(v)}</span></div>`;
    }).join('') + '</div>';
  }
  // A chart is drawn at its card's own width, so its words are their real size.
  const chartW = (el) => Math.round(Math.max(260, Math.min(980, (el?.clientWidth || main.clientWidth) - 36))) || 600;
  function niceMax(v) {
    const p = Math.pow(10, Math.floor(Math.log10(Math.max(1, v))));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
    return 10 * p;
  }

  // A line chart a point a week: meaningful actives (`a`), and opens (`b`)
  // once the ping exists. `span` is the window each point counts: 7 for
  // weekly active, 30 for monthly.
  function lineChart(rows, W, { a = 'active', b = 'opened', span = 7 } = {}) {
    const series = rows.map((s) => ({ week: s.week, active: s[a] || 0, opened: s[b] || 0 }));
    const H = W < 480 ? 190 : 220, L = 34, R = 10, T = 12, B = 26;
    const n = series.length;
    const nice = niceMax(Math.max(1, ...series.map((s) => Math.max(s.active, s.opened))));
    const x = (i) => L + (n === 1 ? 0 : (i / (n - 1)) * (W - L - R));
    const y = (v) => T + (1 - v / nice) * (H - T - B);
    const from = Math.max(0, series.findIndex((s) => s.opened > 0));
    const hasOpened = series.some((s) => s.opened > 0);
    const path = (k) => series.map((s, i) => (k === 'opened' && i < from) ? ''
      : `${(k === 'opened' ? i === from : !i) ? 'M' : 'L'}${x(i).toFixed(1)},${y(s[k]).toFixed(1)}`).join('');
    let g = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${span === 7 ? 'Weekly' : 'Monthly'} active people, last 12 weeks">`;
    [0, nice / 2, nice].forEach((t) => {
      g += `<line class="${t ? 'gridline' : 'baseline'}" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/>` +
        `<text x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${fmt(t)}</text>`;
    });
    const every = W < 420 ? 4 : W < 560 ? 3 : 2;
    series.forEach((s, i) => {
      if ((n - 1 - i) % every === 0) g += `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${esc(day(s.week))}</text>`;
    });
    g += `<path class="area" d="${path('active')}L${x(n - 1)},${y(0)}L${x(0)},${y(0)}Z"/>`;
    if (hasOpened) g += `<path class="line line--b" d="${path('opened')}"/>`;
    g += `<path class="line line--a" d="${path('active')}"/>`;
    g += `<line class="cross" x1="0" x2="0" y1="${T}" y2="${H - B}" visibility="hidden"/>`;
    g += '<circle class="dot dot--a" r="4" visibility="hidden"/>';
    if (hasOpened) g += '<circle class="dot dot--b" r="4" visibility="hidden"/>';
    g += `<rect class="hit" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}"/></svg>`;
    const legend = hasOpened
      ? '<ul class="legend"><li><span class="swatch"></span>Active</li><li><span class="swatch swatch--b"></span>Opened</li></ul>' : '';
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
        showTip(`<b>${span === 7 ? 'Week' : '30 days'} to ${esc(day(addDays(s.week, 6)))}</b><br><span class="k"></span>Active ${fmt(s.active)}` +
          (hasOpened && i >= from ? `<br><span class="k k--b"></span>Opened ${fmt(s.opened)}` : ''), e.clientX, e.clientY);
      };
      const hit = el.querySelector('.hit');
      hit.addEventListener('pointermove', at);
      hit.addEventListener('pointerdown', at);
      hit.addEventListener('pointerleave', () => { hideTip(); [cross, da, db].forEach((d) => d?.setAttribute('visibility', 'hidden')); });
    } };
  }
  const addDays = (iso, n) => { const d = new Date(String(iso).slice(0, 10) + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString(); };

  // Vertical columns: a distribution, or a count a week.
  function columns(items, W, { every = 1, label = '' } = {}) {
    const H = 190, L = 4, R = 4, T = 22, B = 26;
    const n = items.length, gap = n > 8 ? 6 : 10;
    const bw = (W - L - R - gap * (n - 1)) / n;
    const max = Math.max(1, ...items.map((d) => d.n));
    let g = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">`;
    g += `<line class="baseline" x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/>`;
    items.forEach((d, i) => {
      const h = (d.n / max) * (H - T - B);
      const x0 = L + i * (bw + gap);
      const y0 = H - B - h;
      const r = Math.min(4, h, bw / 2);   // 4px round at the value end, square at the baseline
      const showX = (n - 1 - i) % every === 0;
      g += `<g data-tip="${esc(d.tip)}">` +
        `<rect class="hit" x="${x0}" y="${T - 20}" width="${bw}" height="${H - B - T + 20}"/>` +
        (h > 0 ? `<path class="col" d="M${x0},${H - B}V${y0 + r}Q${x0},${y0} ${x0 + r},${y0}H${x0 + bw - r}Q${x0 + bw},${y0} ${x0 + bw},${y0 + r}V${H - B}Z"/>` : '') +
        (bw >= 18 || i === n - 1 ? `<text class="col-label" x="${x0 + bw / 2}" y="${y0 - 6}" text-anchor="middle">${fmt(d.n)}</text>` : '') +
        (showX ? `<text x="${x0 + bw / 2}" y="${H - 8}" text-anchor="middle">${esc(d.label)}</text>` : '') + '</g>';
    });
    return g + '</svg>';
  }

  // Where the most people stop, on a funnel's in-order counts.
  function worstDrop(seq, first) {
    let worst = -1, rate = 2;
    for (let i = first + 1; i < 6; i++) {
      if (!seq[i - 1]) continue;
      const r = seq[i] / seq[i - 1];
      if (r < rate) { rate = r; worst = i; }
    }
    return worst;
  }

  // ── Names ─────────────────────────────────────────────────────────────────
  const TYPE_NAMES = {
    note: 'Notes', photo: 'Frames', take: 'Takes', find: 'Finds', poll: 'Polls',
    activity: 'Plans', song: 'Music', repost: 'Reposts', moment: 'Moments', daily: 'Daily answers',
  };
  const KIND_NAMES = {
    post: 'Posts', moment: 'Moments', daily: 'Daily answers', comment: 'Comments', message: 'Messages',
    rsvp: 'RSVPs', vote: 'Poll votes', friend: 'Friendships', circle: 'Circle joins',
  };
  const PLATFORM = { ios: 'iOS app', pwa: 'Home screen', web: 'Web', unknown: 'Before tracking' };
  const SOURCE = { invite: 'Invite', circle: 'Circle link', profile: 'Profile link', post: 'Post link', daily: 'Daily link', referral: 'Another site', direct: 'Direct', unknown: 'Before tracking' };
  const SKIP_NOTE = 'Your own activity isn\'t counted.';
  const foot = () => `<p class="footnote">${SKIP_NOTE}</p>`;


  // ── Overview: the pulse of a word of mouth beta ───────────────────────────
  // Since 2026-11-11 (Zoe) it also holds Monthly active, the week's rhythm
  // ("put when busiest graph in overview") and Settling in, the funnel
  // ("settling in can be in overview"); Who to nudge went to its own page.
  const who = (p) => `<a class="who" href="../#/u/${encodeURIComponent(p.handle)}">${esc(p.name)}</a>`;

  async function renderOverview() {
    // admin_overview is the page; the rest are sections that draw when they
    // answer and say so when they don't (Zoe, 2026-11-11: "what happened to
    // the overview?", one 42P01 in admin_extras had blanked all of it).
    const [o, f30, src30, ret, x, z] = await settle([
      call('admin_overview'),
      call('admin_funnel', { p_days: 30, p_basis: 'account', p_by: 'none' }),
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
    const g = f30?.groups?.[0];
    const accounts30 = g?.seq?.[1] || 0;

    // Week 1 retention: the last four cohorts old enough to say.
    const ripe = (ret?.cohorts || []).filter((c) => c.weeks?.[0]?.eligible > 0).slice(-4);
    const w1 = ripe.length ? pct(ripe.reduce((a, c) => a + c.weeks[0].alive, 0), ripe.reduce((a, c) => a + c.weeks[0].eligible, 0)) : null;

    // Word of mouth: the share of last month's accounts that came by invite.
    const srcGroups = src30?.groups || [];
    const invited = srcGroups.find((r) => r.key === 'invite')?.seq?.[1] || 0;
    const srcTotal = srcGroups.reduce((a, r) => a + (r.seq?.[1] || 0), 0);

    const plats = Object.entries(o.platforms7 || {}).sort((a, b) => b[1] - a[1]);
    const platTotal = plats.reduce((a, p) => a + p[1], 0);

    // Who to nudge is a page now; the Overview says how many are waiting.
    const toNudge = z ? fresh(z.people || []).length
      : x ? (x.newest || []).filter((p) => nextStep(p) !== 'Settled in').length : null;
    const nudgeLine = toNudge
      ? `<a class="callout callout--go" href="#nudge"><span><b>${fmt(toNudge)}</b> ${toNudge === 1 ? 'person hasn\'t' : 'people haven\'t'} settled in yet.</span>${svg('chevron', 'i i--go')}</a>`
      : '';

    const rh = x ? rhythmHtml(x.rhythm) : null;

    main.innerHTML =
      headHtml('Overview') +
      '<div class="grid grid--kpi">' +
        tile('Weekly active', fmt(o.wau), delta(cur?.active, prev?.active), 'Created or connected in the last 7 days. Likes don\'t count.') +
        tile('Monthly active', fmt(o.mau), hasMonthly ? delta(cur?.monthly, prev?.monthly) : '', 'Created or connected in the last 30 days. Likes don\'t count.') +
        tile('New this week', fmt(o.new7), delta(cur?.joined, prev?.joined), 'Accounts made in the last 7 days') +
        tile('Activated', g ? pctTxt(pct(g.activated, accounts30)) : '–', g ? `${fmt(g.activated)} of ${fmt(accounts30)} new, 30 days` : '', 'Connected and posted within a week of joining. New accounts, last 30 days.') +
      '</div>' +
      nudgeLine +
      '<div class="section grid grid--two">' +
        `<div>${sectionHead('Weekly active', '12 weeks')}<div class="card" id="c-active"></div></div>` +
        `<div>${sectionHead('Monthly active', '30 days at a time')}<div class="card" id="c-monthly">` +
          (hasMonthly ? '' : '<p class="empty">Re-run <b>supabase/admin-dashboard.sql</b> to draw this.</p>') + '</div></div>' +
      '</div>' +
      strip([
        ['Everyone', fmt(o.users), 'Every account, yours left out'],
        ['Today', fmt(o.dau), 'Created or connected today'],
        ['Back in week 1', pctTxt(w1), 'Active again 7 to 13 days after joining, the last 4 signup weeks'],
        ['Stickiness', pctTxt(o.mau28 ? pct(o.avgDau28, o.mau28) : null), 'Average day ÷ month, 28 days. 20% is healthy for a social app.'],
        ['Opened, week', fmt(o.openedWau), 'Opened Tria in the last 7 days, doing something or not'],
        ['Opened, month', fmt(o.openedMau), 'Opened Tria in the last 30 days, doing something or not'],
      ]) +
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
      '<div class="section grid grid--three">' +
        `<div>${sectionHead('Made this week')}<div class="card">${barsHtml(o.types7, TYPE_NAMES)}</div></div>` +
        `<div>${sectionHead('Done this week')}<div class="card">${barsHtml(o.kinds7, KIND_NAMES)}</div></div>` +
        `<div>${sectionHead('Opened on', 'This week')}` + list(plats.length
          ? plats.map(([k, v]) => row({ title: esc(PLATFORM[k] || k), meter: pct(v, platTotal), val: `<b>${fmt(v)}</b>` }))
          : [row({ title: 'Nobody yet' })]) + '</div>' +
      '</div>' +
      foot();

    const ca = $('c-active'), cm = $('c-monthly'), cj = $('c-joined');
    const wk = lineChart(s, chartW(ca));
    ca.innerHTML = wk.html;
    wk.wire(ca);
    if (hasMonthly) {
      const mo = lineChart(s, chartW(cm), { a: 'monthly', b: 'monthlyOpened', span: 30 });
      cm.innerHTML = mo.html;
      mo.wire(cm);
    }
    const W = chartW(cj);
    cj.innerHTML = columns(s.map((w) => ({
      n: w.joined, label: day(w.week),
      tip: `<b>Week to ${esc(day(addDays(w.week, 6)))}</b><br>${fmt(w.joined)} new`,
    })), W, { every: W < 420 ? 4 : W < 560 ? 3 : 2, label: 'New accounts a week, last 12 weeks' });
    await paintFunnel($('funnel'));
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

  // ── Settling in (the funnel), a section of the Overview ───────────────────
  const STAGES = [
    { name: 'Install', say: 'First opened the app or a shortcut' },
    { name: 'Account', say: 'Claimed an @handle' },
    { name: 'Profile', say: 'Added a photo or bio' },
    { name: 'Connected', say: 'Made a friend or joined a circle' },
    { name: 'Posted', say: 'First post, comment, message, RSVP or vote' },
    { name: 'Came back', say: 'Active again within 7 days' },
  ];
  // 30 days by default, so its Activated agrees with the tile above it.
  const fstate = { basis: 'account', by: 'none', days: 30 };
  const groupName = (by, k) => (by === 'source' ? SOURCE[k] || k : by === 'platform' ? PLATFORM[k] || k : by === 'cohort' ? 'Week of ' + day(k) : 'Everyone');

  async function paintFunnel(box) {
    if (!box) return;
    let res, r0;
    try {
      res = await call('admin_funnel', { p_days: fstate.days, p_basis: fstate.basis, p_by: fstate.by });
      r0 = fstate.by === 'none' ? res : await call('admin_funnel', { p_days: fstate.days, p_basis: fstate.basis, p_by: 'none' });
    } catch (err) {
      box.innerHTML = sectionHead('Settling in') + `<div class="callout">Couldn't load these. ${esc(err?.message || '')}</div>`;
      return;
    }
    const groups = res.groups || [];
    const first = fstate.basis === 'install' ? 0 : 1;
    const overall = r0.groups?.[0] || { seq: [0, 0, 0, 0, 0, 0], any: [0, 0, 0, 0, 0, 0], young: 0, activated: 0 };

    const top = overall.seq[first] || 0;
    const worst = worstDrop(overall.seq, first);
    let steps = '';
    for (let i = first; i < 6; i++) {
      const v = overall.seq[i], anyV = overall.any[i];
      if (i > first) {
        steps += `<div class="gap${i === worst ? ' is-worst' : ''}"><span>↓ ${pctTxt(pct(v, overall.seq[i - 1]))}${i === worst ? ', biggest drop' : ''}</span></div>`;
      }
      steps += `<div class="step" data-tip="<b>${esc(STAGES[i].name)}</b><br>${esc(STAGES[i].say)}<br>${fmt(v)} in order, ${fmt(anyV)} at all">` +
        `<span class="step-name">${esc(STAGES[i].name)}</span>` +
        `<span class="barrow-track"><span class="barrow-ghost" style="width:${top ? (anyV / top) * 100 : 0}%"></span><span class="barrow-fill" style="width:${top ? (v / top) * 100 : 0}%"></span></span>` +
        `<span class="step-val"><b>${fmt(v)}</b><small>${pctTxt(pct(v, top))}</small></span></div>`;
    }
    const worstLine = worst > 0
      ? `<a class="callout callout--go" href="#nudge"><span><b>${esc(STAGES[worst - 1].name)} → ${esc(STAGES[worst].name)}</b> loses the most: ${fmt(overall.seq[worst - 1] - overall.seq[worst])} people, ${pctTxt(100 - pct(overall.seq[worst], overall.seq[worst - 1]))}.</span>${svg('chevron', 'i i--go')}</a>`
      : '';

    let split = '';
    if (fstate.by !== 'none') {
      const head = '<tr><th>' + esc({ cohort: 'Joined', source: 'Source', platform: 'Platform' }[fstate.by]) + '</th>' +
        STAGES.slice(first).map((st) => `<th>${esc(st.name)}</th>`).join('') + '<th>Activated</th><th>Median</th></tr>';
      const rows = groups.map((gr) => {
        const t = gr.seq[first];
        const cells = gr.seq.slice(first).map((v, j) => (j === 0 ? `<td>${fmt(v)}</td>`
          : `<td>${pctTxt(pct(v, t))}<span class="sub">${fmt(v)}</span></td>`)).join('');
        return `<tr><td>${esc(groupName(fstate.by, gr.key))}</td>${cells}` +
          `<td>${pctTxt(pct(gr.activated, gr.seq[1]))}<span class="sub">${fmt(gr.activated)}</span></td><td>${esc(hours(gr.actMedianH))}</td></tr>`;
      }).join('');
      const actRows = groups.filter((gr) => gr.seq[1] > 0).map((gr) => {
        const name = groupName(fstate.by, gr.key);
        return row({ title: esc(name), sub: `${fmt(gr.seq[1])} accounts`,
          meter: pct(gr.activated, gr.seq[1]), val: `<b>${pctTxt(pct(gr.activated, gr.seq[1]))}</b>`,
          tipText: `<b>${esc(name)}</b><br>${fmt(gr.activated)} of ${fmt(gr.seq[1])} activated<br>median ${esc(hours(gr.actMedianH))}` });
      });
      split = (actRows.length ? `<div class="section-tight">${sectionHead('Activated by ' + { cohort: 'week', source: 'source', platform: 'platform' }[fstate.by])}${list(actRows)}</div>` : '') +
        `<div class="section-tight">${sectionHead('Every stage')}` +
        `<div class="card"><div class="table-wrap"><table><thead>${head}</thead><tbody>${rows || '<tr><td>Nobody yet</td></tr>'}</tbody></table></div></div></div>`;
    }

    box.innerHTML =
      sectionHead('Settling in', 'From account to coming back') +
      '<div class="controls">' +
        segmented('basis', [['account', 'Account'], ['install', 'Install']], fstate.basis, 'From') +
        segmented('days', [[30, '30 days'], [90, '90 days'], [0, 'All']], fstate.days, 'Joined in') +
        segmented('by', [['none', 'All'], ['cohort', 'Week'], ['source', 'Source'], ['platform', 'Platform']], fstate.by, 'Split') +
      '</div>' +
      `<div class="card"><div class="funnel">${steps}</div>` +
        '<ul class="legend legend--foot"><li><span class="swatch swatch--fill"></span>In order</li><li><span class="swatch swatch--ghost"></span>At all</li></ul>' +
        (overall.young ? `<p class="note">${fmt(overall.young)} are still in their first week.</p>` : '') +
        (first === 0 ? '<p class="note">Installs count from when tracking began.</p>' : '') +
      '</div>' + worstLine +
      '<div class="grid grid--tiles section-tight">' +
        tile('Activated', pctTxt(pct(overall.activated, overall.seq[1])), `${fmt(overall.activated)} of ${fmt(overall.seq[1])}`, 'Connected and posted, both within 7 days of joining') +
        tile('Median time', esc(hours(overall.actMedianH)), 'to activate') +
        tile('Slowest quarter', esc(hours(overall.actP75H)), '3 in 4 by then') +
      '</div>' + split;

    box.querySelectorAll('.segmented button').forEach((b) => {
      b.addEventListener('click', () => {
        if (b.dataset.basis) fstate.basis = b.dataset.basis;
        if (b.dataset.days != null) fstate.days = Number(b.dataset.days);
        if (b.dataset.by) fstate.by = b.dataset.by;
        paintFunnel(box);
      });
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
  const nstate = { step: 'all', fresh: true, picked: new Set(), subject: '', message: '', edited: false, marked: null };
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

  async function renderNudge() {
    const z = await nudgeData();
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
    const pool = nstate.fresh ? fresh(live) : live;
    const shown = nstate.step === 'all' ? pool : pool.filter((p) => p.step === nstate.step);
    const stopped = everyone.filter((p) => p.stopped);
    // A pick that left the list (a filter changed) is let go.
    const ids = new Set(shown.map((p) => p.id));
    for (const id of nstate.picked) if (!ids.has(id)) nstate.picked.delete(id);
    if (!nstate.edited) [nstate.subject, nstate.message] = LETTER[nstate.step] || LETTER.all;
    const count = (k) => (k === 'all' ? pool.length : pool.filter((p) => p.step === k).length);
    const recent = live.length - fresh(live).length;

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
      (recent ? `<p class="note note--page"><button class="linkish" type="button" id="n-fresh">${nstate.fresh ? `Show ${fmt(recent)} nudged this week` : 'Hide those nudged this week'}</button></p>` : '') +
      '<div class="section-tight">' + list(shown.length
        ? [`<div class="row row--head"><button class="linkish" type="button" id="n-all"${pickable.length ? '' : ' disabled'}>${allOn ? 'Select none' : `Select all ${fmt(pickable.length)}`}</button></div>`, ...shown.map(personRow)]
        : [row({ title: nstate.step === 'all' ? 'Everyone has settled in.' : 'Nobody here.' })]) + '</div>' +
      `<div class="section">${sectionHead('Email', n ? `To ${fmt(n)} ${n === 1 ? 'person' : 'people'}` : 'Pick people above')}` +
        '<div class="card letter">' +
          `<input class="field field--plain" id="n-subject" type="text" maxlength="140" placeholder="Subject" aria-label="Subject" value="${esc(nstate.subject)}" />` +
          `<textarea class="field field--plain field--area" id="n-message" rows="9" maxlength="4000" aria-label="Message">${esc(nstate.message)}</textarea>` +
          '<p class="note">{name} is their first name. Every email ends with an Open Tria button and how to stop them.</p>' +
          '<div class="letter-acts">' +
            `<button class="publish-fill" type="button" id="n-send"${n ? '' : ' disabled'}>${n ? `Send to ${fmt(n)}` : 'Send'}</button>` +
            `<button class="pill-quiet" type="button" id="n-mail"${n ? '' : ' disabled'}>Open in Mail</button>` +
          '</div>' +
          `<p class="note" id="n-status" role="status">${nstate.marked ? `Sent it from Mail? <button class="linkish" type="button" id="n-mark">Mark ${fmt(nstate.marked.ids.length)} as nudged</button>` : ''}</p>` +
        '</div></div>' +
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
    $('n-fresh')?.addEventListener('click', () => { nstate.fresh = !nstate.fresh; again(); });
    $('n-all')?.addEventListener('click', () => {
      if (allOn) nstate.picked.clear(); else pickable.forEach((p) => nstate.picked.add(p.id));
      again();
    });
    main.querySelectorAll('[data-pick]').forEach((c) => c.addEventListener('change', () => {
      if (c.checked) nstate.picked.add(c.dataset.pick); else nstate.picked.delete(c.dataset.pick);
      again();
    }));
    const subj = $('n-subject'), msg = $('n-message');
    subj.addEventListener('input', () => { nstate.subject = subj.value; nstate.edited = true; });
    msg.addEventListener('input', () => { nstate.message = msg.value; nstate.edited = true; });

    const picked = () => shown.filter((p) => nstate.picked.has(p.id) && p.email);
    const stepOf = () => (nstate.step === 'all' ? 'other' : nstate.step);
    const status = $('n-status');

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
        const code = err?.context?.status;
        done(code === 503 ? 'Sending isn\'t set up yet: set <b>RESEND_API_KEY</b> and <b>NUDGE_REPLY_TO</b> on the nudge function. Open in Mail works now.'
          : code === 403 ? 'Only Tria\'s team can send these.'
          : code === 502 ? 'Resend refused it. Check the sending domain is verified.'
          : code === 404 || err?.name === 'FunctionsFetchError' || err?.name === 'FunctionsRelayError'
            ? 'The nudge function isn\'t deployed yet: <b>supabase functions deploy nudge</b>. Open in Mail works now.'
            : 'Couldn\'t send. ' + esc(err?.message || ''));
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

  // ── Retention ─────────────────────────────────────────────────────────────
  async function renderRetention() {
    const r = await call('admin_retention');
    const all = r.cohorts || [];
    // Weighted average back in week k, over every cohort old enough.
    const avg = (k) => {
      let a = 0, e = 0;
      all.forEach((c) => { const w = c.weeks?.[k - 1]; if (w?.eligible) { a += w.alive; e += w.eligible; } });
      return e ? pct(a, e) : null;
    };
    const cohorts = all.slice().reverse();
    const head = '<tr><th>Joined</th><th>People</th>' +
      [1, 2, 3, 4, 5, 6, 7, 8].map((k) => `<th>Wk ${k}</th>`).join('') + '</tr>';
    const rows = cohorts.map((c) => {
      const cells = (c.weeks || []).map((w) => {
        if (!w.eligible) return '<td class="cell is-empty">·</td>';
        const p = pct(w.alive, w.eligible);
        return `<td class="cell" style="background:color-mix(in srgb, var(--data) ${Math.round(8 + (p / 100) * 62)}%, transparent)" ` +
          `data-tip="<b>Joined week of ${esc(day(c.week))}</b><br>Week ${w.k}: ${fmt(w.alive)} of ${fmt(w.eligible)} back">${pctTxt(p)}</td>`;
      }).join('');
      return `<tr><td>${esc(day(c.week))}</td><td>${fmt(c.size)}</td>${cells}</tr>`;
    }).join('');
    main.innerHTML =
      headHtml('Retention') +
      '<div class="grid grid--kpi">' +
        tile('Week 1', pctTxt(avg(1)), 'back', 'Active again 7 to 13 days after joining. Every signup week, weighted.') +
        tile('Week 2', pctTxt(avg(2)), 'back') +
        tile('Week 4', pctTxt(avg(4)), 'back') +
        tile('Week 8', pctTxt(avg(8)), 'back') +
      '</div>' +
      `<div class="section">${sectionHead('By signup week', 'Share active each week after')}` +
      `<div class="card heat"><div class="table-wrap"><table><thead>${head}</thead><tbody>${rows || '<tr><td>Nobody yet</td></tr>'}</tbody></table></div></div></div>` +
      foot();
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
    ['posted', 'Posted'], ['photo', 'Photo'], ['bio', 'Bio'], ['circle', 'In a circle'],
    ['moment', 'Shared a Moment'], ['daily', 'Answered a daily'], ['theme', 'Picked a theme'], ['push', 'Push on'],
    ['pins', 'Pinned a post'], ['charms', 'Wears a charm'], ['pronouns', 'Pronouns'], ['private', 'Private'],
  ];
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
    const themeRows = Object.entries(themes).sort((a, b) => b[1] - a[1]).map(([k, v]) => row({
      lead: `<span class="swatch-dot" style="background:${THEME[k][1]}"></span>`,
      title: esc(THEME[k][0]), meter: pct(v, u), val: `<b>${fmt(v)}</b>`,
    }));
    const aud = x.audiences || {};
    const audTotal = Object.values(aud).reduce((a, v) => a + v, 0);

    main.innerHTML =
      headHtml('Community') +
      '<div class="grid grid--kpi">' +
        tile('Median friends', fmt(Math.round((x.friends?.median ?? 0) * 10) / 10), 'mutual, each') +
        tile('On their own', fmt(x.friends?.alone), pctTxt(pct(x.friends?.alone, u)) + ' of everyone', 'No friend and no circle') +
        tile('Circles', fmt(circles.length), `${fmt(circles.reduce((a, c) => a + (c.posts7 || 0), 0))} posts this week`) +
        tile('Blocks', fmt(x.blocks?.total), `${fmt(x.blocks?.last30)} in 30 days`) +
      '</div>' +
      `<div class="section">${sectionHead('Friends each')}<div class="card" id="c-friends"></div></div>` +
      `<div class="section">${sectionHead('Circles')}` +
        list(shown.length ? shown.map((c) => row({
          title: `<a class="who" href="../#/c/${encodeURIComponent(c.slug)}">${esc(c.name)}</a>${c.inviteOnly ? svg('lock', 'i row-lock') : ''}`,
          sub: `c/${esc(c.slug)} · +${fmt(c.joins7)} joined, ${fmt(c.posts7)} posts this week`,
          val: `<b>${fmt(c.members)}</b>`,
          tipText: `<b>c/${esc(c.slug)}</b><br>${fmt(c.members)} members`,
        })) : [row({ title: 'None yet' })],
        circles.length > 8 ? `<button class="more" type="button" id="more-circles">${showAllCircles ? 'Show fewer' : `Show all ${circles.length}`}</button>` : '') +
      '</div>' +
      '<div class="section grid grid--two">' +
        `<div>${sectionHead('Set up')}` + list(ADOPTION.map(([k, label]) =>
          row({ title: esc(label), meter: pct(ad[k], u), val: `<b>${pctTxt(pct(ad[k], u))}</b>`, tipText: `<b>${esc(label)}</b><br>${fmt(ad[k])} of ${fmt(u)}` }))) + '</div>' +
        `<div>${sectionHead('Themes')}` + list(themeRows.length ? themeRows : [row({ title: 'None yet' })]) + '</div>' +
      '</div>' +
      `<div class="section">${sectionHead('Audiences', 'Posts, 30 days')}` + list(Object.keys(aud).length
        ? Object.entries(aud).sort((a, b) => b[1] - a[1]).map(([k, v]) => row({ title: esc(AUDIENCE[k] || k), meter: pct(v, audTotal), val: `<b>${pctTxt(pct(v, audTotal))}</b>` }))
        : [row({ title: 'None yet' })]) + '</div>' +
      foot();

    const cf = $('c-friends');
    const buckets = x.friends?.buckets || [];
    const total = buckets.reduce((a, d) => a + d.n, 0);
    cf.innerHTML = columns(buckets.map((d) => ({
      n: d.n, label: d.label,
      tip: `<b>${esc(d.label)} friend${d.label === '1' ? '' : 's'}</b><br>${fmt(d.n)} people, ${pctTxt(pct(d.n, total))}`,
    })), chartW(cf), { label: 'People by number of friends' });

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
  const ASKS = { photo: 'Frame', note: 'Note', find: 'Find', poll: 'Poll' };
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
    const best = prompts.slice().sort((a, b) => b.avgPeople - a.avgPeople || b.answers - a.answers).slice(0, 6);
    const quiet = prompts.slice().sort((a, b) => a.avgPeople - b.avgPeople || a.answers - b.answers).slice(0, 6);
    const promptRow = (p) => row({
      title: esc(p.prompt), sub: `${esc(ASKS[p.type] || p.type)} · ran ${fmt(p.runs)}×`,
      val: `<b>${fmt(p.avgPeople)}</b>`, tipText: `<b>${esc(p.slug)}</b><br>${fmt(p.avgPeople)} people a run, ${fmt(p.answers)} answers in all`,
    });

    main.innerHTML =
      headHtml('Dailies') +
      (today ? `<div class="card daily-now"><div class="tile-label">Today · ${esc(ASKS[today.type] || today.type)}</div>` +
        `<p class="daily-prompt">${esc(today.prompt)}</p>` +
        `<p class="tile-note">${fmt(today.people)} ${today.people === 1 ? 'person has' : 'people have'} answered so far</p></div>` : '') +
      `<div class="grid grid--kpi${today ? ' section-tight' : ''}">` +
        tile('A day', fmt(perDay), 'people answer, 4 weeks', 'Average people answering a finished day, last 28 days') +
        tile('Answer rate', pctTxt(rate), 'of those around', 'People who answered, out of those who opened Tria or did something in the 7 days to that day') +
        tile('Got a reply', pctTxt(replied), 'of answers', 'Answers with a comment from someone other than the author. Likes aren\'t counted.') +
        tile('Regulars', fmt(d.regulars), `of ${fmt(d.answerers)} who answered`, 'Answered on 4 or more days in the last 28') +
      '</div>' +
      `<div class="section">${sectionHead('People a day', '4 weeks')}<div class="card" id="c-daily"></div></div>` +
      `<div class="section">${sectionHead('Every day')}` + list(days.length ? days.map((r) => row({
        title: esc(r.prompt),
        sub: `${esc(day(r.day))} · ${esc(ASKS[r.type] || r.type)} · ${fmt(r.answers)} ${r.answers === 1 ? 'answer' : 'answers'}, ${fmt(r.replied)} replied to`,
        meter: pct(r.people, r.around), val: `<b>${fmt(r.people)}</b>`,
        tipText: `<b>${esc(day(r.day))}</b><br>${fmt(r.people)} of ${fmt(r.around)} around answered (${pctTxt(pct(r.people, r.around))})`,
      })) : [row({ title: 'None yet' })]) + '</div>' +
      '<div class="section grid grid--two">' +
        `<div>${sectionHead('Land best', 'People a run')}` + list(best.length ? best.map(promptRow) : [row({ title: 'None yet' })]) + '</div>' +
        `<div>${sectionHead('Land least', 'People a run')}` + list(quiet.length ? quiet.map(promptRow) : [row({ title: 'None yet' })]) + '</div>' +
      '</div>' +
      `<div class="section">${sectionHead('Answered with', '4 weeks')}<div class="card">${barsHtml(d.types, TYPE_NAMES)}</div></div>` +
      foot();

    const cd = $('c-daily');
    const W = chartW(cd);
    const chron = days.slice().reverse();
    cd.innerHTML = columns(chron.map((r) => ({
      n: r.people, label: day(r.day),
      tip: `<b>${esc(day(r.day))}</b><br>${esc(r.prompt)}<br>${fmt(r.people)} people, ${fmt(r.answers)} answers`,
    })), W, { every: W < 420 ? 7 : W < 700 ? 4 : 2, label: 'People answering the daily, last 28 days' });
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

  boot();
})();
