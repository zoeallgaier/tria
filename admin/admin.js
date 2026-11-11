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
    // Settling in: steps up to a door.
    funnel: '<path d="M3.5 20h5v-5h5v-5h5V4.5"/><path d="M15.5 7.5 18.5 4.5l3 3"/>',
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

  const TABS = [
    { key: 'overview', label: 'Overview' },
    { key: 'funnel', label: 'Settling in' },   // the funnel, in Tria's words
    { key: 'retention', label: 'Retention' },
    { key: 'community', label: 'Community' },
    { key: 'dictionary', label: 'Dictionary' },
  ];
  let dataOk = false;          // an admin and the SQL is run (or demo)
  let extrasOk = true;         // admin-extras.sql answers
  let extrasWhy = '';          // and, when it doesn't, what to run
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
  // One section's numbers failing never blanks the page: each call settles
  // on its own, a failure is null.
  const settle = (ps) => Promise.allSettled(ps).then((rs) => rs.map((r) => (r.status === 'fulfilled' ? r.value : null)));

  // ── Shell ─────────────────────────────────────────────────────────────────
  function currentTab() {
    const h = location.hash.slice(1);
    if (!dataOk) return 'dictionary';
    return TABS.some((t) => t.key === h) ? h : 'overview';
  }
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
      else if (t === 'funnel') await renderFunnel();
      else if (t === 'retention') await renderRetention();
      else if (t === 'community') await renderCommunity();
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

  // A weekly line chart: meaningful actives, and opens once the ping exists.
  function lineChart(series, W) {
    const H = W < 480 ? 190 : 220, L = 34, R = 10, T = 12, B = 26;
    const n = series.length;
    const nice = niceMax(Math.max(1, ...series.map((s) => Math.max(s.active, s.opened))));
    const x = (i) => L + (n === 1 ? 0 : (i / (n - 1)) * (W - L - R));
    const y = (v) => T + (1 - v / nice) * (H - T - B);
    const from = Math.max(0, series.findIndex((s) => s.opened > 0));
    const hasOpened = series.some((s) => s.opened > 0);
    const path = (k) => series.map((s, i) => (k === 'opened' && i < from) ? ''
      : `${(k === 'opened' ? i === from : !i) ? 'M' : 'L'}${x(i).toFixed(1)},${y(s[k]).toFixed(1)}`).join('');
    let g = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Weekly active people, last 12 weeks">`;
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
        showTip(`<b>Week to ${esc(day(addDays(s.week, 6)))}</b><br><span class="k"></span>Active ${fmt(s.active)}` +
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

  // What a new account still needs, in funnel order.
  function nextStep(p) {
    if (!p.profile) return 'No photo or bio';
    if (!p.connected) return 'No friends yet';
    if (!p.acted) return 'Hasn\'t posted';
    if (!p.returned) return (Date.now() - new Date(p.joined)) / 86400000 < 1 ? 'Joined today' : 'Hasn\'t come back';
    return 'Settled in';
  }
  const stepDots = (p) => `<span class="steps" aria-hidden="true">` +
    ['profile', 'connected', 'acted', 'returned'].map((k) => `<i class="${p[k] ? 'on' : ''}"></i>`).join('') + '</span>';

  // ── Overview: the pulse of a word of mouth beta ───────────────────────────
  async function renderOverview() {
    // admin_overview is the page; the rest are sections that draw when they
    // answer and say so when they don't (Zoe, 2026-11-11: "what happened to
    // the overview?", one 42P01 in admin_extras had blanked all of it).
    const [o, f30, src30, ret, x] = await settle([
      call('admin_overview'),
      call('admin_funnel', { p_days: 30, p_basis: 'account', p_by: 'none' }),
      call('admin_funnel', { p_days: 30, p_basis: 'account', p_by: 'source' }),
      call('admin_retention'),
      extras(),
    ]);
    if (!o) throw new Error('admin_overview didn\'t answer.');
    const s = (o.series || []).map((w) => ({ ...w, active: w.active || 0, opened: w.opened || 0, joined: w.joined || 0 }));
    const cur = s[s.length - 1], prev = s[s.length - 2];
    const g = f30?.groups?.[0];
    const accounts30 = g?.seq?.[1] || 0;

    // Week 1 retention: the last four cohorts old enough to say.
    const ripe = (ret?.cohorts || []).filter((c) => c.weeks?.[0]?.eligible > 0).slice(-4);
    const w1 = ripe.length ? pct(ripe.reduce((a, c) => a + c.weeks[0].alive, 0), ripe.reduce((a, c) => a + c.weeks[0].eligible, 0)) : null;

    // Word of mouth: the share of last month's accounts that came by invite.
    const srcGroups = src30?.groups || [];
    const invited = srcGroups.find((r) => r.key === 'invite')?.seq?.[1] || 0;
    const srcTotal = srcGroups.reduce((a, r) => a + (r.seq?.[1] || 0), 0);

    const worst = g ? worstDrop(g.seq, 1) : -1;
    const dropLine = worst > 0
      ? `<a class="callout callout--go" href="#funnel"><span>Biggest drop: <b>${pctTxt(100 - pct(g.seq[worst], g.seq[worst - 1]))}</b> ` +
        `stop between ${esc(STAGES[worst - 1].name)} and ${esc(STAGES[worst].name)}.</span>${svg('chevron', 'i i--go')}</a>`
      : '';

    const plats = Object.entries(o.platforms7 || {}).sort((a, b) => b[1] - a[1]);
    const platTotal = plats.reduce((a, p) => a + p[1], 0);
    const who = (p) => `<a class="who" href="../#/u/${encodeURIComponent(p.handle)}">${esc(p.name)}</a>`;

    // Who to nudge first: the newest who are stuck, then the settled.
    const newest = (x?.newest || []).slice().sort((a, b) => (nextStep(a) === 'Settled in') - (nextStep(b) === 'Settled in')).map((p) => row({
      title: who(p),
      sub: `${esc(ago(p.joined))} · ${esc(SOURCE[p.source] || p.source)} · ${esc(PLATFORM[p.platform] || p.platform)}`,
      val: `<span class="next${p.returned ? ' is-done' : ''}">${esc(nextStep(p))}</span>${stepDots(p)}`,
      tipText: `<b>${esc(p.name)}</b><br>Profile ${p.profile ? '✓' : '·'}  Connected ${p.connected ? '✓' : '·'}<br>Posted ${p.acted ? '✓' : '·'}  Came back ${p.returned ? '✓' : '·'}`,
    }));
    const extrasNote = x ? '' : `<div class="callout">${extrasWhy}</div>`;

    main.innerHTML =
      headHtml('Overview') +
      '<div class="grid grid--kpi">' +
        tile('Weekly active', fmt(o.wau), delta(cur?.active, prev?.active), 'Created or connected in the last 7 days. Likes don\'t count.') +
        tile('New this week', fmt(o.new7), delta(cur?.joined, prev?.joined), 'Accounts made in the last 7 days') +
        tile('Activated', g ? pctTxt(pct(g.activated, accounts30)) : '–', g ? `${fmt(g.activated)} of ${fmt(accounts30)} new, 30 days` : '', 'Connected and posted within a week of joining. New accounts, last 30 days.') +
        tile('Back in week 1', pctTxt(w1), ripe.length ? 'last 4 signup weeks' : 'too new to say', 'Active again 7 to 13 days after joining') +
      '</div>' +
      dropLine +
      `<div class="section">${sectionHead('Weekly active', '12 weeks')}<div class="card" id="c-active"></div>` +
      strip([
        ['Everyone', fmt(o.users), 'Every account, yours left out'],
        ['This month', fmt(o.mau), 'Created or connected in the last 30 days'],
        ['Today', fmt(o.dau), 'Created or connected today'],
        ['Stickiness', pctTxt(o.mau28 ? pct(o.avgDau28, o.mau28) : null), 'Average day ÷ month, 28 days. 20% is healthy for a social app.'],
        ['Opened', fmt(o.openedWau), 'Opened Tria this week, doing something or not'],
      ]) + '</div>' +
      `<div class="section">${sectionHead('New people', 'Who to nudge')}` +
        (x ? list(newest.length ? newest : [row({ title: 'Nobody yet' })]) : extrasNote) + '</div>' +
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

    const ca = $('c-active'), cj = $('c-joined');
    const chart = lineChart(s, chartW(ca));
    ca.innerHTML = chart.html;
    chart.wire(ca);
    const W = chartW(cj);
    cj.innerHTML = columns(s.map((w) => ({
      n: w.joined, label: day(w.week),
      tip: `<b>Week to ${esc(day(addDays(w.week, 6)))}</b><br>${fmt(w.joined)} new`,
    })), W, { every: W < 420 ? 4 : W < 560 ? 3 : 2, label: 'New accounts a week, last 12 weeks' });
  }

  // ── Funnel ────────────────────────────────────────────────────────────────
  const STAGES = [
    { name: 'Install', say: 'First opened the app or a shortcut' },
    { name: 'Account', say: 'Claimed an @handle' },
    { name: 'Profile', say: 'Added a photo or bio' },
    { name: 'Connected', say: 'Made a friend or joined a circle' },
    { name: 'Posted', say: 'First post, comment, message, RSVP or vote' },
    { name: 'Came back', say: 'Active again within 7 days' },
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
      ? `<div class="callout"><span><b>${esc(STAGES[worst - 1].name)} → ${esc(STAGES[worst].name)}</b> loses the most: ${fmt(overall.seq[worst - 1] - overall.seq[worst])} people, ${pctTxt(100 - pct(overall.seq[worst], overall.seq[worst - 1]))}.</span></div>`
      : '';

    let split = '';
    if (fstate.by !== 'none') {
      const head = '<tr><th>' + esc({ cohort: 'Joined', source: 'Source', platform: 'Platform' }[fstate.by]) + '</th>' +
        STAGES.slice(first).map((s) => `<th>${esc(s.name)}</th>`).join('') + '<th>Activated</th><th>Median</th></tr>';
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
      split = (actRows.length ? `<div class="section">${sectionHead('Activated')}${list(actRows)}</div>` : '') +
        `<div class="section">${sectionHead('Every stage')}` +
        `<div class="card"><div class="table-wrap"><table><thead>${head}</thead><tbody>${rows || '<tr><td>Nobody yet</td></tr>'}</tbody></table></div></div></div>`;
    }

    main.innerHTML =
      headHtml('Settling in') +
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
      `<div class="section">${sectionHead('Activation')}<div class="grid grid--tiles">` +
        tile('Activated', pctTxt(pct(overall.activated, overall.seq[1])), `${fmt(overall.activated)} of ${fmt(overall.seq[1])}`, 'Connected and posted, both within 7 days of joining') +
        tile('Median time', esc(hours(overall.actMedianH)), 'to activate') +
        tile('Slowest quarter', esc(hours(overall.actP75H)), '3 in 4 by then') +
      '</div></div>' + split + foot();

    main.querySelectorAll('.segmented button').forEach((b) => {
      b.addEventListener('click', async () => {
        if (b.dataset.basis) fstate.basis = b.dataset.basis;
        if (b.dataset.days != null) fstate.days = Number(b.dataset.days);
        if (b.dataset.by) fstate.by = b.dataset.by;
        const y = window.scrollY;
        await renderFunnel();
        watchTitle('Settling in');
        window.scrollTo(0, y);
      });
    });
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
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
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

    // The rhythm: 7 rows by 24 hours.
    const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
    (x.rhythm || []).forEach(([d, h, n]) => { grid[d][h] = n; });
    const rmax = Math.max(1, ...grid.flat());
    let peak = [0, 0, 0];
    grid.forEach((r, d) => r.forEach((n, h) => { if (n > peak[2]) peak = [d, h, n]; }));
    const hr = (h) => (h % 12 || 12) + (h < 12 ? 'am' : 'pm');
    let rhythm = '<div class="rhythm" role="img" aria-label="Activity by weekday and hour, last 28 days"><span></span>' +
      Array.from({ length: 24 }, (_, h) => `<span class="rh">${h % 6 === 0 ? hr(h) : ''}</span>`).join('');
    [1, 2, 3, 4, 5, 6, 0].forEach((d) => {
      rhythm += `<span class="rl">${DAYS[d]}</span>` + grid[d].map((n, h) =>
        `<span class="rc" style="${n ? `background:color-mix(in srgb, var(--data) ${Math.round(10 + (n / rmax) * 80)}%, transparent)` : ''}" ` +
        `data-tip="<b>${DAYS[d]} ${hr(h)}</b><br>${fmt(n)}"></span>`).join('');
    });
    rhythm += '</div>';

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
      `<div class="section">${sectionHead('When', peak[2] ? `Busiest ${DAYS[peak[0]]} ${hr(peak[1])}` : '')}<div class="card">${rhythm}</div></div>` +
      '<div class="section grid grid--two">' +
        `<div>${sectionHead('Set up')}` + list(ADOPTION.map(([k, label]) =>
          row({ title: esc(label), meter: pct(ad[k], u), val: `<b>${pctTxt(pct(ad[k], u))}</b>`, tipText: `<b>${esc(label)}</b><br>${fmt(ad[k])} of ${fmt(u)}` }))) + '</div>' +
        `<div>${sectionHead('Themes')}` + list(themeRows.length ? themeRows : [row({ title: 'None yet' })]) + '</div>' +
      '</div>' +
      '<div class="section grid grid--two">' +
        `<div>${sectionHead('Dailies', 'Last 2 weeks')}` + list((x.dailies || []).length
          ? x.dailies.map((d) => row({ title: esc(d.slug), sub: esc(day(d.day)), val: `<b>${fmt(d.answers)}</b>` }))
          : [row({ title: 'None yet' })]) + '</div>' +
        `<div>${sectionHead('Audiences', 'Posts, 30 days')}` + list(Object.keys(aud).length
          ? Object.entries(aud).sort((a, b) => b[1] - a[1]).map(([k, v]) => row({ title: esc(AUDIENCE[k] || k), meter: pct(v, audTotal), val: `<b>${pctTxt(pct(v, audTotal))}</b>` }))
          : [row({ title: 'None yet' })]) + '</div>' +
      '</div>' +
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

  boot();
})();
