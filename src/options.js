(function () {
  const M = globalThis.MLS;
  const box = document.getElementById('weights');
  const hosts = document.getElementById('hosts');
  const status = document.getElementById('status');

  for (const key of Object.keys(M.DEFAULT_WEIGHTS)) {
    const label = document.createElement('label');
    label.className = 'row';
    label.textContent = M.WEIGHT_LABELS[key];
    const input = document.createElement('input');
    input.type = 'number';
    input.min = 0;
    input.max = 100;
    input.id = 'w-' + key;
    label.appendChild(input);
    box.appendChild(label);
  }

  function fill(weights, socialHosts) {
    for (const key of Object.keys(M.DEFAULT_WEIGHTS)) document.getElementById('w-' + key).value = weights[key];
    hosts.value = socialHosts.join('\n');
  }

  function flash(text) {
    status.textContent = text;
    setTimeout(() => { status.textContent = ''; }, 2000);
  }

  chrome.storage.local.get({ weights: null, socialHosts: null }, (data) => {
    fill(Object.assign({}, M.DEFAULT_WEIGHTS, data.weights), data.socialHosts || M.DEFAULT_SOCIAL_HOSTS);
  });

  document.getElementById('save').addEventListener('click', () => {
    const weights = {};
    for (const key of Object.keys(M.DEFAULT_WEIGHTS)) {
      const n = Number(document.getElementById('w-' + key).value);
      weights[key] = Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : M.DEFAULT_WEIGHTS[key];
    }
    const socialHosts = hosts.value.split(/\s+/)
      .map((h) => h.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, ''))
      .filter(Boolean);
    chrome.storage.local.set({ weights, socialHosts }, () => {
      fill(weights, socialHosts);
      flash('Tersimpan.');
    });
  });

  document.getElementById('reset').addEventListener('click', () => {
    chrome.storage.local.remove(['weights', 'socialHosts'], () => {
      fill(M.DEFAULT_WEIGHTS, M.DEFAULT_SOCIAL_HOSTS);
      flash('Dikembalikan ke default.');
    });
  });
})();
