// Fungsi murni: daftar lead (sudah diberi skor) -> teks CSV. BOM supaya Excel membaca UTF-8.
(function (root) {
  const WEBSITE_TYPE = { none: 'Tidak ada', social: 'Media sosial', own: 'Website sendiri', unknown: 'Belum diketahui' };
  const COLUMNS = [
    ['Skor', (l) => l.score],
    ['Label', (l) => l.label],
    ['Nama', (l) => l.name],
    ['Kategori', (l) => l.category],
    ['Rating', (l) => (l.rating == null ? '' : String(l.rating).replace('.', ','))],
    ['Jumlah Ulasan', (l) => l.reviewCount],
    ['Telepon', (l) => (l.phone == null ? 'Belum diketahui' : l.phone || 'Tidak ada')],
    ['Alamat', (l) => l.address],
    ['Website', (l) => l.websiteUrl],
    ['Jenis Website', (l) => WEBSITE_TYPE[l.websiteType] || WEBSITE_TYPE.unknown],
    ['Tutup', (l) => (l.isClosed ? 'Ya' : 'Tidak')],
    ['Data Lengkap', (l) => (l.incomplete ? 'Belum' : 'Ya')],
    ['Alasan', (l) => (l.reasons || []).join('; ')],
    ['URL Maps', (l) => l.mapsUrl],
  ];

  const FORMULA_START = '=+-@' + String.fromCharCode(9, 13); // = + - @ tab CR
  // Sel teks yang diawali = + - @ tab atau CR dibaca Excel sebagai formula: awali dengan '. Angka tidak disentuh.
  function cell(v) {
    let s = v == null ? '' : String(v);
    if (typeof v !== 'number' && s && FORMULA_START.includes(s[0])) s = "'" + s;
    return /[",\r\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCsv(leads) {
    const rows = [COLUMNS.map((c) => c[0])].concat(leads.map((l) => COLUMNS.map((c) => c[1](l))));
    return String.fromCharCode(0xfeff) + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
  }

  const api = { toCsv, WEBSITE_TYPE };
  root.MLS = Object.assign(root.MLS || {}, api);
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
