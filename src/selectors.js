// Semua selector DOM Google Maps ada di sini. Kalau Maps berubah, perbaiki file ini saja.
// Diverifikasi di Maps live (hl=id) pada 2026-11-11. Sengaja tanpa nama class.
(function (root) {
  const SELECTORS = {
    feed: 'div[role="feed"]',
    card: 'div[role="article"]',
    cardLink: 'a[href*="/maps/place/"]', // aria-label = nama bisnis
    stars: '[role="img"][aria-label]', // "4,9 bintang 545 Ulasan"
    anyLink: 'a[href]',
    detailMain: 'div[role="main"][aria-label]',
    detailTitle: 'h1',
    detailAnyItem: '[data-item-id]',
    detailWebsite: '[data-item-id="authority"]',
    detailPhone: '[data-item-id^="phone:"]',
    detailAddress: '[data-item-id="address"]',
  };

  const PATTERNS = {
    closed: /tutup permanen|tutup sementara|permanently closed|temporarily closed/i,
    starLabel: /^\s*([\d.,]+)\s*(?:bintang|stars?)\s*(.*)$/i,
    reviewWord: /ulasan|review/i,
    status: /^\s*(buka|tutup|open|close)/i, // baris jam buka, bukan alamat
    featureId: /!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i, // id tempat di URL Maps
    googleHost: /(^|\.)(google\.[a-z.]+|gstatic\.com|googleusercontent\.com|googleadservices\.com|goo\.gl)$/i,
  };

  root.MLS = Object.assign(root.MLS || {}, { SELECTORS, PATTERNS });
  if (typeof module !== 'undefined') module.exports = { SELECTORS, PATTERNS };
})(globalThis);
