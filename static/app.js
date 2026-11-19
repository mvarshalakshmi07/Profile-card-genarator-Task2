(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const view = $('#view');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const initials = n => (n || '?').split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const ICON = {
    ok: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    no: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    part: '<svg viewBox="0 0 24 24"><path d="M6 12h12"/></svg>',
    users: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/></svg>',
    gauge: '<svg viewBox="0 0 24 24"><path d="M12 14l4-4"/><path d="M3.5 17a9 9 0 1 1 17 0"/></svg>',
    cam: '<svg viewBox="0 0 24 24"><path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
    doc: '<svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6z"/><path d="M9 12h6M9 16h6"/></svg>',
    sun: '<svg viewBox="0 0 24 24" style="stroke-width:1.6"><circle cx="12" cy="13" r="4"/><path d="M12 3v2M4.5 8l1.5 1M19.5 8L18 9M2 17h2M20 17h2M4 21h16"/></svg>',
  };
  const THEME_BG = {
    ocean: 'linear-gradient(110deg,#BFD3FB,#F3EFE6 60%,#FFF1CC)', sunset: 'linear-gradient(110deg,#FAD0C4,#FFE8C2,#FFF6DD)',
    mint: 'linear-gradient(110deg,#BDEBD7,#DDF4EA,#F2FAE6)', lavender: 'linear-gradient(110deg,#D7CCFA,#EADFFB,#FCE8F1)',
    slate: 'linear-gradient(110deg,#CBD5E1,#E2E8F0,#F1F5F9)',
  };

  // ---------- api
  async function api(url, opts = {}) {
    const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed'), { status: res.status, errors: data.errors });
    return data;
  }
  const post = (u, b) => api(u, { method: 'POST', body: JSON.stringify(b || {}) });

  function toast(msg, error) {
    const t = $('#toast'); t.textContent = msg; t.className = 'toast show' + (error ? ' error' : '');
    clearTimeout(toast.t); toast.t = setTimeout(() => (t.className = 'toast'), 2800);
  }

  // ---------- shared bits
  const tone = s => (s >= 70 ? 'ok' : s >= 40 ? 'warn' : 'bad');
  const toneColor = s => ({ ok: 'var(--ok)', warn: 'var(--warn)', bad: 'var(--bad)' }[tone(s)]);
  function donut(pct, size = 150, label = 'Score') {
    const r = 54, c = 2 * Math.PI * r;
    return `<div class="donut" style="width:${size}px;height:${size}px">
      <svg viewBox="0 0 130 130"><circle class="bg" cx="65" cy="65" r="${r}"/>
      <circle class="fg" cx="65" cy="65" r="${r}" stroke="${toneColor(pct)}" stroke-dasharray="${(c * pct) / 100} ${c}"/></svg>
      <div class="mid"><small>${label}</small><b>${pct}%</b></div></div>`;
  }
  const avatar = p => `<span class="mini-av">${esc(initials(p.name))}${p.image_url ? `<img src="${esc(p.image_url)}" alt="" referrerpolicy="no-referrer" data-fallback>` : ''}</span>`;
  const checklist = a => `<ul class="checks">${a.breakdown.map(b => `<li><span class="dot ${b.done ? 'ok' : b.earned ? 'part' : 'no'}">${b.done ? ICON.ok : b.earned ? ICON.part : ICON.no}</span>${b.label}${!b.done && b.earned ? ' <span class="muted">· partial</span>' : ''}</li>`).join('')}</ul>`;
  const bars = items => items.map(i => `<div class="hbar"><span>${esc(i.label)}</span><div class="track"><div class="fill ${i.cls || ''}" style="width:${i.pct}%"></div></div><b>${i.val}</b></div>`).join('');
  const fmtDate = iso => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

  // broken images fall back to the initials underneath
  document.addEventListener('error', e => { if (e.target.matches?.('img[data-fallback]')) e.target.remove(); }, true);

  // ---------- views
  async function dashboard() {
    const d = await api('/api/analytics');
    setTitle('Dashboard');
    const stat = (ic, cls, n, l, sub) => `<div class="panel stat"><div class="stat-top"><span class="ico ${cls}">${ICON[ic]}</span><span class="num">${n}</span></div><div><div class="lbl">${l}</div><div class="sub ${cls}">${sub}</div></div></div>`;
    if (!d.total) {
      view.innerHTML = `<div class="page-head"><div><h1>Dashboards</h1><p>View analytics and insights across all profile cards</p></div></div>
        <div class="panel empty"><h2>No profiles yet</h2><p>Create your first profile card, or load a few samples to explore the analytics.</p>
        <div class="actions" style="justify-content:center"><a class="btn primary" href="#/create">Create a profile</a><button class="btn" id="seed">Load sample profiles</button></div></div>`;
      $('#seed').onclick = async () => { await post('/api/seed'); route(); };
      return;
    }
    const max = Math.max(1, ...d.last7.map(x => x.count));
    const dmax = Math.max(1, ...d.distribution.map(x => x.count));
    const smax = Math.max(1, ...d.top_skills.map(x => x.count));
    view.innerHTML = `
      <div class="page-head"><div><h1>Dashboards</h1><p>View analytics and insights across all profile cards</p></div></div>
      <div class="hero">${ICON.sun}<div><b>${greeting()}</b><span>Here is how your profile cards are performing</span></div><a class="btn" href="#/create">Create profile</a></div>
      <div class="grid g-4" style="margin-bottom:18px">
        ${stat('users', 'blue', d.total, 'Profiles', `${d.complete} fully complete`)}
        ${stat('gauge', 'green', d.avg_score + '%', 'Avg. profile strength', 'across all profiles')}
        ${stat('cam', 'violet', d.with_photo, 'With photo', `${Math.round((d.with_photo / d.total) * 100)}% of profiles`)}
        ${stat('doc', 'amber', d.avg_bio_words, 'Avg. bio length', 'words per bio')}
      </div>
      <div class="grid g-2" style="margin-bottom:18px">
        <div class="panel panel-pad"><div class="panel-head"><h2>Profile strength distribution</h2></div>
          ${bars(d.distribution.map((x, i) => ({ label: x.label, pct: (x.count / dmax) * 100, val: x.count, cls: ['bad', 'warn', '', 'ok'][i] })))}</div>
        <div class="panel panel-pad"><div class="panel-head"><h2>Profiles created · last 7 days</h2></div>
          <div class="cols">${d.last7.map(x => `<div class="col"><b>${x.count || ''}</b><div class="bar ${x.count ? 'has' : ''}" style="height:${(x.count / max) * 100}%"></div>${x.label}</div>`).join('')}</div></div>
      </div>
      <div class="grid g-2">
        <div class="panel panel-pad"><div class="panel-head"><h2>Recent profiles</h2><a href="#/profiles">View all</a></div>
          <div class="rows">${d.recent.map(p => `<div class="row" data-go="${p.id}">${avatar(p)}<div class="info"><b>${esc(p.name)}</b><span>${esc(p.title || 'No headline')}</span></div><span class="badge ${tone(p.score)}">${p.score}%</span></div>`).join('')}</div></div>
        <div class="panel panel-pad"><div class="panel-head"><h2>Top skills</h2></div>
          ${d.top_skills.length ? bars(d.top_skills.map(x => ({ label: x.skill, pct: (x.count / smax) * 100, val: x.count }))) : '<p class="muted">No skills added yet.</p>'}</div>
      </div>`;
    bindRows();
  }
  const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good Morning' : h < 18 ? 'Good Afternoon' : 'Good Evening'; };
  const bindRows = () => view.querySelectorAll('[data-go]').forEach(r => (r.onclick = () => (location.hash = '#/profile/' + r.dataset.go)));

  async function profiles() {
    const list = await api('/api/profiles');
    setTitle('My Profiles');
    view.innerHTML = `<div class="page-head"><div><h1>My Profiles</h1><p>${list.length} profile card${list.length === 1 ? '' : 's'}</p></div><div class="actions"><a class="btn primary" href="#/create">+ New profile</a></div></div>` +
      (list.length ? `<div class="gallery">${(await Promise.all(list.map(p => api('/api/profiles/' + p.id)))).map(r => `<div class="gal-item" data-go="${r.profile.id}">${r.card_html}<div class="gal-meta"><span class="muted">Created ${fmtDate(r.profile.created_at)}</span><span class="badge ${tone(r.analytics.score)}">${r.analytics.score}% strength</span></div></div>`).join('')}</div>`
        : '<div class="panel empty"><h2>Nothing here yet</h2><p>Create a profile to see it here.</p><a class="btn primary" href="#/create">Create a profile</a></div>');
    bindRows();
  }

  async function detail(id) {
    const r = await api('/api/profiles/' + id), a = r.analytics, p = r.profile;
    setTitle('Profile');
    view.innerHTML = `<div class="page-head"><div><h1>${esc(p.name)}</h1><p>Profile card & analytics · updated ${fmtDate(p.updated_at)}</p></div>
      <div class="actions"><a class="btn" href="#/edit/${p.id}">Edit</a><button class="btn danger" id="del">Delete</button></div></div>
      <div class="detail"><div>${r.card_html}</div><div class="grid">
        <div class="panel panel-pad"><div class="panel-head"><h2>Profile strength</h2><span class="badge ${tone(a.score)}">${a.grade}</span></div>
          <div class="strength">${donut(a.score, 150, 'Completed')}${checklist(a)}</div></div>
        <div class="panel panel-pad"><div class="panel-head"><h2>Score breakdown</h2></div>
          ${bars(a.breakdown.map(b => ({ label: b.label, pct: (b.earned / b.max) * 100, val: `${b.earned}/${b.max}`, cls: b.done ? 'ok' : b.earned ? 'warn' : 'bad' })))}</div>
        <div class="panel panel-pad"><div class="panel-head"><h2>Bio insights</h2><span class="badge blue">${a.bio.readability}</span></div>
          <div class="metric-grid">
            <div class="metric"><b>${a.bio.words}</b><span>Words</span></div>
            <div class="metric"><b>${a.bio.sentences}</b><span>Sentences</span></div>
            <div class="metric"><b>${a.bio.reading_seconds}s</b><span>Reading time</span></div>
            <div class="metric"><b>${a.bio.avg_sentence}</b><span>Words / sentence</span></div></div>
          ${a.keywords.length ? `<div class="chips" style="margin-top:14px">${a.keywords.map(k => `<span class="chip">${esc(k.word)} · ${k.count}</span>`).join('')}</div>` : ''}</div>
        <div class="panel panel-pad"><div class="panel-head"><h2>Suggestions</h2></div>
          ${a.suggestions.length ? `<ul class="sugg">${a.suggestions.map(s => `<li>💡 ${esc(s)}</li>`).join('')}</ul>` : '<p class="muted">Great work. This profile is fully optimised.</p>'}</div>
      </div></div>`;
    $('#del').onclick = async () => {
      if (!confirm(`Delete ${p.name}'s profile?`)) return;
      await api('/api/profiles/' + id, { method: 'DELETE' }); toast('Profile deleted'); location.hash = '#/profiles';
    };
  }

  async function create(id) {
    let existing = null;
    if (id) existing = (await api('/api/profiles/' + id)).profile;
    setTitle(id ? 'Edit profile' : 'Create profile');
    const v = existing || { name: '', title: '', location: '', bio: '', image_url: '', website: '', email: '', skills: [], theme: 'ocean' };
    const field = (name, label, ph, opts = {}) => `<div class="f" data-f="${name}"><label for="${name}">${label}${opts.req ? ' <i>*</i>' : ''}</label>
      ${opts.area ? `<textarea id="${name}" name="${name}" placeholder="${ph}" maxlength="600">${esc(v[name])}</textarea>` : `<input id="${name}" name="${name}" type="${opts.type || 'text'}" placeholder="${ph}" value="${esc(name === 'skills' ? v.skills.join(', ') : v[name])}" ${opts.max ? `maxlength="${opts.max}"` : ''} ${opts.req ? 'required' : ''}>`}
      <div class="hint"><span>${opts.hint || ''}</span>${opts.count ? `<span data-count="${name}"></span>` : ''}</div><div class="err-msg"></div></div>`;
    view.innerHTML = `<div class="page-head"><div><h1>${id ? 'Edit Profile' : 'Profile Card Generator'}</h1><p>Fill in your details. The card and score update as you type.</p></div></div>
    <div class="create">
      <form class="panel form-wrap" id="form" novalidate>
        <div class="form-head">Build Your Profile</div>
        <div class="tabs" role="tablist">${['Basics', 'About', 'Links & Skills', 'Style'].map((t, i) => `<button type="button" role="tab" class="tab ${i ? '' : 'active'}" data-tab="${i}">${t}</button>`).join('')}</div>
        <div class="pane active" data-pane="0">
          ${field('name', 'Full name', 'e.g. Lorna Alvarado', { req: 1, max: 80 })}
          ${field('title', 'Professional headline', 'e.g. Senior Software Engineer at TechCorp', { max: 120, count: 1, hint: '120 characters max' })}
          ${field('image_url', 'Profile image URL', 'https://example.com/photo.jpg', { type: 'url', hint: 'Direct link to a JPG or PNG' })}
          ${field('location', 'Location', 'e.g. San Francisco Bay Area', { max: 80 })}
        </div>
        <div class="pane" data-pane="1">${field('bio', 'About / Bio', 'Write a compelling summary about yourself, your experience, and what you are passionate about…', { area: 1, count: 1, hint: '600 characters max' })}</div>
        <div class="pane" data-pane="2">
          ${field('skills', 'Skills', 'Python, Design, Leadership', { hint: 'Comma separated, up to 12' })}
          <div class="two">${field('website', 'Website', 'yoursite.com')}${field('email', 'Email', 'you@example.com', { type: 'email' })}</div>
        </div>
        <div class="pane" data-pane="3"><div class="f"><label>Card banner</label><div class="swatches">${window.THEMES.map(t => `<button type="button" class="swatch ${v.theme === t ? 'on' : ''}" data-theme="${t}" aria-label="${t}" title="${t}" style="background:${THEME_BG[t]}"></button>`).join('')}</div></div></div>
        <div class="form-foot"><span class="muted" id="status"></span><div class="actions"><a class="btn" href="#/dashboard">Cancel</a><button class="btn primary" type="submit" id="submit">${id ? 'Save changes' : 'Generate card'}</button></div></div>
      </form>
      <div class="side-col"><div id="preview"></div>
        <div class="panel panel-pad" id="strength"></div>
        <div class="panel panel-pad"><div class="panel-head"><h2>Tips</h2></div><ul class="tips"><li>Use a professional headshot for your profile photo</li><li>Write a headline that showcases your value</li><li>Aim for a 40–120 word bio with concrete achievements</li><li>Add 5+ relevant skills that match your goals</li></ul></div></div>
    </div>`;

    const form = $('#form'); let theme = v.theme;
    const data = () => ({ ...Object.fromEntries(new FormData(form)), theme });
    const showErrors = (errs = {}) => form.querySelectorAll('.f[data-f]').forEach(f => {
      const m = errs[f.dataset.f]; f.classList.toggle('err', !!m); $('.err-msg', f).textContent = m || '';
    });
    const counts = () => form.querySelectorAll('[data-count]').forEach(c => { const el = $('#' + c.dataset.count); c.textContent = `${el.value.length}/${el.maxLength}`; });
    let seq = 0, timer;
    async function refresh() {
      const mine = ++seq;
      try {
        const r = await post('/api/preview', data()); if (mine !== seq) return;
        $('#preview').innerHTML = r.card_html;
        $('#strength').innerHTML = `<div class="panel-head"><h2>Profile Completion</h2><span class="badge ${tone(r.analytics.score)}">${r.analytics.grade}</span></div><div class="strength">${donut(r.analytics.score, 130, 'Completed')}${checklist(r.analytics)}</div>`;
      } catch (e) { /* preview is best-effort */ }
    }
    form.addEventListener('input', () => { counts(); clearTimeout(timer); timer = setTimeout(refresh, 250); });
    form.querySelectorAll('.tab').forEach(t => (t.onclick = () => {
      form.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === t));
      form.querySelectorAll('.pane').forEach(p => p.classList.toggle('active', p.dataset.pane === t.dataset.tab));
    }));
    form.querySelectorAll('.swatch').forEach(s => (s.onclick = () => {
      theme = s.dataset.theme; form.querySelectorAll('.swatch').forEach(x => x.classList.toggle('on', x === s)); refresh();
    }));
    form.onsubmit = async e => {
      e.preventDefault(); const btn = $('#submit'); btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Generating…';
      try {
        const r = id ? await api('/api/profiles/' + id, { method: 'PUT', body: JSON.stringify(data()) }) : await post('/api/profiles', data());
        toast(id ? 'Profile updated' : 'Profile card generated'); location.hash = '#/profile/' + r.profile.id;
      } catch (err) {
        if (err.errors) {
          showErrors(err.errors); toast('Please fix the highlighted fields', true);
          const first = Object.keys(err.errors)[0], pane = $('#' + first, form)?.closest('.pane');
          if (pane) form.querySelector(`.tab[data-tab="${pane.dataset.pane}"]`).click();
        } else toast(err.message, true);
        btn.disabled = false; btn.textContent = id ? 'Save changes' : 'Generate card';
      }
    };
    counts(); refresh();
  }

  // ---------- router
  function setTitle(t) { $('#pageTitle').textContent = t; }
  async function route() {
    $('#sidebar').classList.remove('open');
    const [, page = 'dashboard', arg] = location.hash.split('/');
    document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active',
      a.dataset.nav === (page === 'profile' || page === 'edit' ? 'profiles' : page)));
    view.innerHTML = '<p class="muted">Loading…</p>';
    try {
      if (page === 'create') await create();
      else if (page === 'edit') await create(arg);
      else if (page === 'profile') await detail(arg);
      else if (page === 'profiles') await profiles();
      else await dashboard();
    } catch (e) {
      view.innerHTML = `<div class="panel empty"><h2>${e.status === 404 ? 'Profile not found' : 'Something went wrong'}</h2><p>${esc(e.message)}</p><a class="btn primary" href="#/dashboard">Back to dashboard</a></div>`;
    }
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);
  $('#menuBtn').onclick = () => $('#sidebar').classList.toggle('open');
  route();
})();
