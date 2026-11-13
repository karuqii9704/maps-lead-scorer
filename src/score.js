// Fungsi murni: lead + bobot -> { score, label, reasons[], incomplete }.
(function (root) {
  const DEFAULT_WEIGHTS = {
    noWebsite: 40,
    socialOnly: 25,
    phone: 15,
    reviewsHigh: 20, // >= 30 ulasan
    reviewsMid: 10, // 10-29 ulasan
    ratingMid: 10, // 3,5 - 4,4
    ratingHigh: 5, // >= 4,5
  };

  const WEIGHT_LABELS = {
    noWebsite: 'Belum punya website',
    socialOnly: 'Website hanya media sosial / link-in-bio',
    phone: 'Ada nomor telepon',
    reviewsHigh: 'Ulasan 30 atau lebih',
    reviewsMid: 'Ulasan 10–29',
    ratingMid: 'Rating 3,5–4,4',
    ratingHigh: 'Rating 4,5 ke atas',
  };

  function scoreLabel(score) {
    return score >= 70 ? 'Potensial' : score >= 40 ? 'Lumayan' : 'Rendah';
  }

  function scoreLead(lead, weights) {
    const w = Object.assign({}, DEFAULT_WEIGHTS, weights);
    const incomplete = lead.websiteType === 'unknown' || lead.websiteType == null || lead.phone == null;
    if (lead.isClosed) return { score: 0, label: 'Rendah', reasons: ['Tutup permanen/sementara'], incomplete };

    let score = 0;
    const reasons = [];
    const add = (key, text) => { score += Number(w[key]) || 0; reasons.push(text); };

    if (lead.websiteType === 'none') add('noWebsite', 'Belum punya website');
    else if (lead.websiteType === 'social') add('socialOnly', 'Website hanya media sosial');
    if (lead.phone) add('phone', 'Ada nomor telepon');
    if (lead.reviewCount >= 30) add('reviewsHigh', 'Ulasan banyak (≥30)');
    else if (lead.reviewCount >= 10) add('reviewsMid', 'Ulasan 10–29');
    if (lead.rating >= 4.5) add('ratingHigh', 'Rating ≥4,5');
    else if (lead.rating >= 3.5) add('ratingMid', 'Rating 3,5–4,4');

    score = Math.max(0, Math.min(100, score));
    return { score, label: scoreLabel(score), reasons, incomplete };
  }

  const api = { DEFAULT_WEIGHTS, WEIGHT_LABELS, scoreLead, scoreLabel };
  root.MLS = Object.assign(root.MLS || {}, api);
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
