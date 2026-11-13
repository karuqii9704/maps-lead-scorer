// Content script: panel, scan kartu yang terlihat, baca panel detail, simpan ke chrome.storage.local.
// Tidak ada request jaringan. Hanya membaca DOM yang sudah ditampilkan Maps.
(function () {
  const M = globalThis.MLS;
  const S = M.SELECTORS;
  if (document.querySelector('.mls-root')) return;

  let leads = {};
  let weights = Object.assign({}, M.DEFAULT_WEIGHTS);
  let socialHosts = M.DEFAULT_SOCIAL_HOSTS.slice();
  const filters = { minScore: 0, noWebsite: false, minReviews: 0, q: '' };
  const sort = { col: 'score', dir: -1 };

  // Tanpa innerHTML: Maps memakai Trusted Types.
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const k of Object.keys(attrs || {})) el.setAttribute(k, attrs[k]);
    el.append(...kids);
    return el;
  }
  const num = (f, max) => h('input', Object.assign({ type: 'number', 'data-f': f, min: 0, value: 0 }, max ? { max } : {}));
  const root = h('div', { class: 'mls-root' },
    h('div', { class: 'mls-head' },
      h('strong', null, 'Maps Lead Scorer'),
      h('span', { class: 'mls-count' }),
      h('button', { class: 'mls-toggle', title: 'Buka/tutup panel', 'aria-label': 'Buka/tutup panel', 'aria-expanded': 'true' }, '⌃')),
    h('div', { class: 'mls-body' },
      h('div', { class: 'mls-actions' },
        h('button', { 'data-act': 'scan' }, 'Scan hasil'),
        h('button', { 'data-act': 'csv' }, 'Export CSV'),
        h('button', { 'data-act': 'clear' }, 'Hapus daftar')),
      h('div', { class: 'mls-filters' },
        h('label', null, 'Skor min ', num('minScore', 100)),
        h('label', null, 'Ulasan min ', num('minReviews')),
        h('label', null, h('input', { type: 'checkbox', 'data-f': 'noWebsite' }), ' Tanpa website saja'),
        h('input', { type: 'search', 'data-f': 'q', placeholder: 'Saring daftar di bawah (nama / kategori)', 'aria-label': 'Saring daftar lead' })),
      h('div', { class: 'mls-table-wrap' },
        h('table', null,
          h('thead', null, h('tr', null,
            h('th', { 'data-sort': 'score' }, 'Skor'), h('th', { 'data-sort': 'name' }, 'Nama'),
            h('th', { 'data-sort': 'rating' }, 'Rating'), h('th', { 'data-sort': 'reviewCount' }, 'Ulasan'),
            h('th', null, 'Web'), h('th', null, 'Telp'))),
          h('tbody')),
        h('p', { class: 'mls-empty' }, 'Belum ada lead. Ketik pencarian di kotak "Telusuri Google Maps" di kiri atas (misalnya "klinik kecantikan Bekasi"), lalu klik "Scan hasil".'))));
  const $ = (sel) => root.querySelector(sel);

  function scored() {
    return Object.values(leads).map((l) => Object.assign({}, l, M.scoreLead(l, weights)));
  }

  function visible() {
    const q = filters.q.trim().toLowerCase();
    return scored()
      .filter((l) => l.score >= filters.minScore
        && (l.reviewCount || 0) >= filters.minReviews
        && (!filters.noWebsite || l.websiteType === 'none')
        && (!q || `${l.name} ${l.category || ''}`.toLowerCase().includes(q)))
      .sort((a, b) => {
        const x = a[sort.col], y = b[sort.col];
        const cmp = typeof x === 'string' || typeof y === 'string'
          ? String(x || '').localeCompare(String(y || ''), 'id')
          : (x || 0) - (y || 0);
        return cmp * sort.dir || b.score - a.score;
      });
  }

  const WEB_TEXT = { none: 'Tidak ada', social: 'Sosmed', own: 'Ada', unknown: '?' };

  function render() {
    const rows = visible();
    const total = Object.keys(leads).length;
    $('.mls-count').textContent = `${rows.length} / ${total} lead`;
    $('.mls-empty').hidden = total > 0;
    $('table').hidden = total === 0;
    for (const th of root.querySelectorAll('th[data-sort]')) {
      if (th.dataset.sort === sort.col) th.setAttribute('aria-sort', sort.dir < 0 ? 'descending' : 'ascending');
      else th.removeAttribute('aria-sort');
    }
    const body = $('tbody');
    body.textContent = '';
    for (const l of rows) {
      const tr = document.createElement('tr');
      tr.dataset.key = l.key;
      tr.title = 'Klik untuk membuka tempat ini di Maps';
      tr.tabIndex = 0;
      const cell = (text, cls) => {
        const td = document.createElement('td');
        td.textContent = text;
        if (cls) td.className = cls;
        tr.appendChild(td);
        return td;
      };
      cell('', 'mls-score').append(
        h('span', { class: 'mls-badge mls-' + l.label.toLowerCase(), title: l.label }, String(l.score)));
      const name = cell(l.name, 'mls-name');
      name.append(h('small', null, [l.category, l.reasons.join(' · ')].filter(Boolean).join(' — ')));
      if (l.incomplete) name.append(h('span', { class: 'mls-chip' }, 'data belum lengkap'));
      cell(l.rating == null ? '-' : String(l.rating).replace('.', ','));
      cell(l.reviewCount == null ? '-' : l.reviewCount.toLocaleString('id-ID'));
      cell(WEB_TEXT[l.websiteType] || '?', 'mls-web-' + (l.websiteType || 'unknown')).title = l.websiteUrl || '';
      cell(l.phone == null ? '?' : l.phone || 'Tidak ada', l.phone == null ? 'mls-unknown' : '');
      body.appendChild(tr);
    }
  }

  function save() {
    chrome.storage.local.set({ leads });
  }

  function scan() {
    let changed = false;
    const put = (key, fresh) => {
      const merged = M.mergeLead(leads[key], fresh);
      if (JSON.stringify(merged) !== JSON.stringify(leads[key])) {
        leads[key] = merged;
        changed = true;
      }
    };
    for (const card of document.querySelectorAll(`${S.feed} ${S.card}`)) {
      const lead = M.extractCard(card, socialHosts);
      if (lead) put(lead.key, lead);
    }
    // Panel detail yang sedang dibuka: lengkapi website/telepon lead yang sudah ada di daftar.
    const open = leads[M.placeKey(location.href)];
    if (open) {
      for (const main of document.querySelectorAll(S.detailMain)) {
        const d = M.extractDetail(main, socialHosts);
        if (d && d.name === open.name) put(open.key, d);
      }
    }
    if (changed) {
      save();
      render();
    }
  }

  function exportCsv() {
    const url = URL.createObjectURL(new Blob([M.toCsv(visible())], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `leads-maps-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  root.addEventListener('click', (e) => {
    const act = e.target.dataset && e.target.dataset.act;
    if (act === 'scan') { scan(); render(); }
    if (act === 'csv') exportCsv();
    if (act === 'clear' && e.target.textContent === 'Yakin hapus?') {
      leads = {};
      save();
      render();
      e.target.textContent = 'Hapus daftar';
    } else if (act === 'clear') {
      e.target.textContent = 'Yakin hapus?';
      setTimeout(() => { e.target.textContent = 'Hapus daftar'; }, 3000);
    }
    const toggle = e.target.closest('.mls-toggle');
    if (toggle) toggle.setAttribute('aria-expanded', String(!root.classList.toggle('mls-collapsed')));
    const th = e.target.closest('th[data-sort]');
    if (th) {
      sort.dir = sort.col === th.dataset.sort ? -sort.dir : th.dataset.sort === 'name' ? 1 : -1;
      sort.col = th.dataset.sort;
      render();
    }
    const tr = e.target.closest('tbody tr');
    if (tr) {
      const link = [...document.querySelectorAll(`${S.feed} ${S.cardLink}`)]
        .find((a) => M.placeKey(a.getAttribute('href')) === tr.dataset.key);
      if (link) link.click();
      else if (leads[tr.dataset.key]) location.href = leads[tr.dataset.key].mapsUrl;
    }
  });

  root.addEventListener('input', (e) => {
    const f = e.target.dataset && e.target.dataset.f;
    if (!f) return;
    filters[f] = e.target.type === 'checkbox' ? e.target.checked
      : e.target.type === 'number' ? Number(e.target.value) || 0 : e.target.value;
    render();
  });

  // Jangan biarkan ketikan di panel memicu shortcut keyboard Maps.
  root.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && e.target.matches('tbody tr')) e.target.click();
  });

  chrome.storage.local.get({ leads: {}, weights: null, socialHosts: null }, (data) => {
    leads = data.leads || {};
    if (data.weights) weights = Object.assign({}, M.DEFAULT_WEIGHTS, data.weights);
    if (data.socialHosts) socialHosts = data.socialHosts;
    document.body.appendChild(root);
    render();
    scan();

    // Scan ulang saat daftar bertambah (scroll) atau panel detail dibuka. Perubahan di panel sendiri diabaikan.
    let timer = null;
    new MutationObserver((records) => {
      if (records.every((r) => root.contains(r.target))) return;
      clearTimeout(timer);
      timer = setTimeout(scan, 600);
    }).observe(document.body, { childList: true, subtree: true });
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.weights) weights = Object.assign({}, M.DEFAULT_WEIGHTS, changes.weights.newValue);
    if (changes.socialHosts) socialHosts = changes.socialHosts.newValue || M.DEFAULT_SOCIAL_HOSTS.slice();
    if (changes.weights || changes.socialHosts) {
      // Klasifikasi ulang website yang sudah diketahui dengan daftar host terbaru.
      for (const l of Object.values(leads)) {
        if (l.websiteUrl) l.websiteType = M.classifyWebsite(l.websiteUrl, socialHosts);
      }
      render();
    }
  });
})();
