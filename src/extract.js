// Fungsi murni: elemen kartu / panel detail Maps -> data lead.
// Field yang tidak ditampilkan halaman = null (belum diketahui), bukan "tidak ada".
(function (root) {
  const { SELECTORS: S, PATTERNS: P } =
    typeof module !== 'undefined' ? require('./selectors.js') : root.MLS;

  const DEFAULT_SOCIAL_HOSTS = [
    'instagram.com', 'facebook.com', 'fb.com', 'fb.me', 'm.me', 'tiktok.com',
    'wa.me', 'wa.link', 'whatsapp.com', 'linktr.ee', 'lynk.id', 's.id', 'bit.ly',
    'taplink.cc', 'beacons.ai', 'heylink.me', 'msha.ke', 'linkin.bio',
    'shopee.co.id', 'shopee.com', 'tokopedia.com', 'tokopedia.link',
    'youtube.com', 'x.com', 'twitter.com', 't.me', 'line.me',
  ];

  // "1.234" -> 1234, "1,2 rb" -> 1200, "2 rb" -> 2000, "1.2K" -> 1200
  function parseCount(text) {
    const m = String(text == null ? '' : text).toLowerCase().match(/(\d[\d.,]*)\s*(rb|ribu|k|jt|juta|m)?(?![a-z])/);
    if (!m) return null;
    if (m[2]) {
      const mult = /^(rb|ribu|k)$/.test(m[2]) ? 1e3 : 1e6;
      return Math.round(parseFloat(m[1].replace(',', '.')) * mult);
    }
    return parseInt(m[1].replace(/[.,]/g, ''), 10);
  }

  function hostOf(url) {
    try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch (e) { return ''; }
  }

  // Link situs kadang dibungkus google.com/url?q=...
  function unwrapUrl(url) {
    try {
      const u = new URL(url);
      if (P.googleHost.test(u.hostname) && u.pathname === '/url') return u.searchParams.get('q') || url;
    } catch (e) { /* biarkan apa adanya */ }
    return url;
  }

  function classifyWebsite(url, socialHosts) {
    if (!url) return 'none';
    const host = hostOf(url);
    const hosts = socialHosts || DEFAULT_SOCIAL_HOSTS;
    return hosts.some((h) => host === h || host.endsWith('.' + h)) ? 'social' : 'own';
  }

  function placeKey(url) {
    const m = P.featureId.exec(url || '');
    return m ? m[1] : String(url || '').split('?')[0];
  }

  function isPhone(text) {
    const t = text.trim();
    return /^\+?\d[\d\s().-]{6,}\d$/.test(t) && t.replace(/\D/g, '').length >= 8;
  }

  function leaves(el, skip) {
    const out = [];
    for (const e of el.querySelectorAll('*')) {
      if (e.children.length || skip.has(e)) continue;
      const t = (e.textContent || '').replace(/\s+/g, ' ').trim();
      if (t) out.push(t);
    }
    return out;
  }

  function extractCard(card, socialHosts) {
    const link = card.querySelector(S.cardLink);
    if (!link) return null;
    const href = link.getAttribute('href') || '';
    const name = (link.getAttribute('aria-label') || link.textContent || '').trim();
    if (!name) return null;

    let rating = null;
    let reviewCount = null;
    const skip = new Set(link.querySelectorAll('*'));
    for (const star of card.querySelectorAll(S.stars)) {
      const m = P.starLabel.exec(star.getAttribute('aria-label') || '');
      if (!m) continue;
      rating = parseFloat(m[1].replace(',', '.'));
      reviewCount = parseCount(m[2]);
      for (const e of star.querySelectorAll('*')) {
        skip.add(e);
        const paren = /^\((.+)\)$/.exec((e.textContent || '').trim());
        if (reviewCount == null && paren) reviewCount = parseCount(paren[1]);
      }
      break;
    }

    const texts = leaves(card, skip).filter((t) => t !== name);
    const isSep = (t) => t === '·' || t.startsWith('·');
    const catIdx = texts.findIndex((t) => !isSep(t) && !/^[\d.,()\s]+$/.test(t) && !P.reviewWord.test(t));
    const category = catIdx >= 0 ? texts[catIdx] : null;
    let address = null;
    for (let i = catIdx + 1; catIdx >= 0 && i < texts.length; i++) {
      if (texts[i] === '·') continue;
      if (!isSep(texts[i]) && !P.status.test(texts[i]) && !isPhone(texts[i])) address = texts[i];
      break;
    }

    const phone = texts.find(isPhone) || null; // null = kartu tidak menampilkan

    let websiteUrl = null;
    for (const a of card.querySelectorAll(S.anyLink)) {
      const url = unwrapUrl(a.getAttribute('href') || '');
      if (!/^https?:/i.test(url) || P.googleHost.test(hostOf(url))) continue;
      websiteUrl = url;
      break;
    }

    return {
      key: placeKey(href),
      name,
      category,
      rating,
      reviewCount,
      phone,
      address,
      hasWebsite: websiteUrl ? true : null, // kartu tanpa link = belum diketahui
      websiteUrl,
      websiteType: websiteUrl ? classifyWebsite(websiteUrl, socialHosts) : 'unknown',
      isClosed: texts.some((t) => P.closed.test(t)),
      mapsUrl: href.split('?')[0],
    };
  }

  // Panel detail memuat semua kontak, jadi "tidak ada" di sini berarti memang tidak ada.
  function extractDetail(main, socialHosts) {
    const title = main.querySelector(S.detailTitle);
    if (!title || !main.querySelector(S.detailAnyItem)) return null; // belum selesai dimuat
    const labelValue = (el) => {
      const label = (el && el.getAttribute('aria-label')) || '';
      return label.includes(':') ? label.slice(label.indexOf(':') + 1).trim() : label.trim();
    };
    const web = main.querySelector(S.detailWebsite);
    const websiteUrl = web ? unwrapUrl(web.getAttribute('href') || '') || null : null;
    const phoneEl = main.querySelector(S.detailPhone);
    const addressEl = main.querySelector(S.detailAddress);
    return {
      name: (title.textContent || '').trim(),
      phone: phoneEl ? labelValue(phoneEl) || phoneEl.getAttribute('data-item-id').replace(/^phone:(tel:)?/, '') : '',
      address: addressEl ? labelValue(addressEl) : null,
      hasWebsite: !!websiteUrl,
      websiteUrl,
      websiteType: classifyWebsite(websiteUrl, socialHosts),
    };
  }

  // Data baru menimpa data lama, kecuali kalau data baru "belum diketahui".
  function mergeLead(old, fresh) {
    if (!old) return Object.assign({}, fresh);
    const out = Object.assign({}, old);
    const knowsWebsite = fresh.websiteType && fresh.websiteType !== 'unknown';
    for (const k of Object.keys(fresh)) {
      const v = fresh[k];
      if (v == null) continue;
      if (/^(hasWebsite|websiteUrl|websiteType)$/.test(k)) continue;
      if (k === 'address' && old.address && old.address.length > v.length) continue;
      if (k === 'name' && old.name) continue;
      out[k] = v;
    }
    if (knowsWebsite) {
      out.hasWebsite = fresh.hasWebsite;
      out.websiteUrl = fresh.websiteUrl || null;
      out.websiteType = fresh.websiteType;
    }
    return out;
  }

  const api = {
    DEFAULT_SOCIAL_HOSTS, parseCount, classifyWebsite, unwrapUrl, placeKey,
    extractCard, extractDetail, mergeLead,
  };
  root.MLS = Object.assign(root.MLS || {}, api);
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
