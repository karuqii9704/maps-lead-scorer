'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('./mini-dom.js');
const { SELECTORS: S } = require('../src/selectors.js');
const X = require('../src/extract.js');
const { scoreLead, DEFAULT_WEIGHTS } = require('../src/score.js');
const { toCsv } = require('../src/csv.js');

const load = (f) => parse(fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8'));
const cards = load('cards.html');
const detail = load('detail.html');
const card = (name) => X.extractCard(cards.querySelector(`[data-case="${name}"]`));
const pane = (name) => X.extractDetail(detail.querySelector(`[data-case="${name}"]`));

test('parseCount: pemisah ribuan Indonesia dan akhiran rb', () => {
  assert.equal(X.parseCount('1.234'), 1234);
  assert.equal(X.parseCount('545 Ulasan'), 545);
  assert.equal(X.parseCount('1,2 rb'), 1200);
  assert.equal(X.parseCount('2 rb ulasan'), 2000);
  assert.equal(X.parseCount('1.2K reviews'), 1200);
  assert.equal(X.parseCount('1,5 jt'), 1500000);
  assert.equal(X.parseCount('3 reviews'), 3);
  assert.equal(X.parseCount(''), null);
});

test('selector feed menemukan semua kartu fixture', () => {
  assert.equal(cards.querySelectorAll(`${S.feed} ${S.card}`).length, 6);
});

test('kartu live: nama, rating, ulasan, kategori, alamat; website dan telepon belum diketahui', () => {
  const l = card('live-basic');
  assert.equal(l.name, 'Klinik Kecantikan Bandung Skin Centre');
  assert.equal(l.rating, 4.9);
  assert.equal(l.reviewCount, 545);
  assert.equal(l.category, 'Klinik Perawatan Kulit');
  assert.equal(l.address, 'Jl. Ir. H. Juanda No.147');
  assert.equal(l.key, '0x2e68e6512ff89c45:0x5902ed38a1e074cd');
  assert.ok(!l.mapsUrl.includes('?'));
  assert.equal(l.websiteType, 'unknown');
  assert.equal(l.hasWebsite, null);
  assert.equal(l.phone, null);
  assert.equal(l.isClosed, false, '"Tutup · Buka Kam" adalah jam buka, bukan tutup permanen');
});

test('kartu live: jumlah ulasan "3.201"', () => {
  assert.equal(card('live-thousands').reviewCount, 3201);
});

test('kartu tutup sementara dan tutup permanen', () => {
  assert.equal(card('live-closed').isClosed, true);
  const l = card('no-reviews');
  assert.equal(l.isClosed, true);
  assert.equal(l.rating, null);
  assert.equal(l.reviewCount, null);
  assert.equal(l.category, 'Dokter gigi');
  assert.equal(l.address, null);
});

test('kartu dengan website sendiri, telepon, dan ulasan "1,2 rb"', () => {
  const l = card('own-website');
  assert.equal(l.websiteType, 'own');
  assert.equal(l.hasWebsite, true);
  assert.equal(l.websiteUrl, 'https://www.klinikgigicontoh.co.id/');
  assert.equal(l.phone, '0812-3456-7890');
  assert.equal(l.reviewCount, 1200);
  assert.equal(l.rating, 4.2);
  assert.equal(l.address, 'Jl. Riau No.10');
});

test('kartu dengan website media sosial (link dibungkus google.com/url)', () => {
  const l = card('social-website');
  assert.equal(l.websiteType, 'social');
  assert.equal(l.websiteUrl, 'https://www.instagram.com/salonayu.bdg/');
  assert.equal(l.phone, null);
});

test('classifyWebsite', () => {
  assert.equal(X.classifyWebsite(null), 'none');
  assert.equal(X.classifyWebsite('https://linktr.ee/abc'), 'social');
  assert.equal(X.classifyWebsite('https://api.whatsapp.com/send?phone=62'), 'social');
  assert.equal(X.classifyWebsite('https://shopee.co.id/toko'), 'social');
  assert.equal(X.classifyWebsite('https://notinstagram.com'), 'own');
  assert.equal(X.classifyWebsite('https://klinik.id', ['klinik.id']), 'social');
});

test('panel detail: website dan telepon terbaca', () => {
  const d = pane('with-contacts');
  assert.equal(d.name, 'Mariana Beauty');
  assert.equal(d.websiteUrl, 'http://www.marianabeauty.id/');
  assert.equal(d.websiteType, 'own');
  assert.equal(d.phone, '0896-0282-8667');
  assert.match(d.address, /^Jl\. Gn\. Batu No\.64.*40175$/);
});

test('panel detail tanpa kontak = memang tidak ada; panel belum dimuat = null', () => {
  const d = pane('no-contacts');
  assert.equal(d.websiteType, 'none');
  assert.equal(d.hasWebsite, false);
  assert.equal(d.phone, '');
  assert.equal(pane('loading'), null);
});

test('mergeLead: detail melengkapi kartu, scan ulang kartu tidak menghapus data detail', () => {
  const fromCard = card('live-closed');
  const full = X.mergeLead(fromCard, pane('no-contacts'));
  assert.equal(full.websiteType, 'none');
  assert.equal(full.phone, '');
  assert.equal(full.reviewCount, 1342);
  const rescanned = X.mergeLead(full, fromCard);
  assert.equal(rescanned.websiteType, 'none');
  assert.equal(rescanned.phone, '');
  assert.match(rescanned.address, /40173$/);
});

test('skor: tanpa website + telepon + ulasan banyak + rating menengah', () => {
  const r = scoreLead({ websiteType: 'none', phone: '0812', reviewCount: 45, rating: 4.2 });
  assert.equal(r.score, 85);
  assert.equal(r.label, 'Potensial');
  assert.equal(r.incomplete, false);
  assert.deepEqual(r.reasons, ['Belum punya website', 'Ada nomor telepon', 'Ulasan banyak (≥30)', 'Rating 3,5–4,4']);
});

test('skor: website sosial, website sendiri, telepon tidak ada', () => {
  assert.equal(scoreLead({ websiteType: 'social', phone: '', reviewCount: 12, rating: 4.8 }).score, 40);
  assert.equal(scoreLead({ websiteType: 'social', phone: '', reviewCount: 12, rating: 4.8 }).label, 'Lumayan');
  const own = scoreLead({ websiteType: 'own', phone: '', reviewCount: 5, rating: 3.0 });
  assert.equal(own.score, 0);
  assert.equal(own.label, 'Rendah');
  assert.equal(own.incomplete, false);
});

test('skor: field belum diketahui = 0 poin dan ditandai belum lengkap', () => {
  const r = scoreLead(card('live-basic'));
  assert.equal(r.score, 25); // ulasan >=30 (20) + rating >=4,5 (5)
  assert.equal(r.incomplete, true);
  assert.ok(!r.reasons.includes('Belum punya website'));
});

test('skor: bisnis tutup dipaksa 0', () => {
  const r = scoreLead({ websiteType: 'none', phone: '0812', reviewCount: 99, rating: 4.0, isClosed: true });
  assert.equal(r.score, 0);
  assert.deepEqual(r.reasons, ['Tutup permanen/sementara']);
});

test('skor: bobot bisa diubah dan dibatasi 100', () => {
  assert.equal(scoreLead({ websiteType: 'none', phone: '' }, { noWebsite: 10 }).score, 10);
  assert.equal(scoreLead({ websiteType: 'none', phone: '1', reviewCount: 50 }, { noWebsite: 90 }).score, 100);
  assert.equal(DEFAULT_WEIGHTS.noWebsite, 40);
});

test('CSV: BOM, kolom, tanda kutip, karakter Indonesia', () => {
  const lead = Object.assign(card('own-website'), { name: 'Klinik "Séhat", Bandung' });
  const csv = toCsv([Object.assign(lead, scoreLead(lead))]);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  const [head, row] = csv.slice(1).split('\r\n');
  assert.equal(head, 'Skor,Label,Nama,Kategori,Rating,Jumlah Ulasan,Telepon,Alamat,Website,Jenis Website,Tutup,Data Lengkap,Alasan,URL Maps');
  assert.ok(row.startsWith('45,Lumayan,"Klinik ""Séhat"", Bandung",Klinik gigi,"4,2",1200,0812-3456-7890,Jl. Riau No.10,'));
  assert.ok(row.includes('Website sendiri,Tidak,Ya,'));
});

test('CSV: sel teks diawali = + - @ tab CR diberi awalan apostrof (formula injection), angka tidak', () => {
  const lead = Object.assign(card('own-website'), {
    name: '=HYPERLINK("http://x")', category: '+1', address: '-2', phone: '@a', websiteUrl: '\tx', mapsUrl: '\rm',
  });
  const csv = toCsv([Object.assign(lead, scoreLead(lead))]);
  assert.ok(csv.includes(`45,Lumayan,"'=HYPERLINK(""http://x"")",'+1,`));
  assert.ok(csv.includes(",'-2,"));
  assert.ok(csv.includes(",'@a,"));
  assert.ok(csv.includes(",'\tx,"));
  assert.ok(csv.includes('"\'\rm"'));
  // Angka (Skor, Jumlah Ulasan) tetap polos, juga yang negatif.
  assert.ok(toCsv([{ name: 'n', score: 0, label: 'Rendah', reviewCount: 5, rating: 4 }]).includes('0,Rendah,n,,4,5,'));
  assert.ok(toCsv([{ name: 'n', score: -3, label: 'x', reviewCount: -1 }]).includes('-3,x,n,,,-1,'));
  // Teks biasa tidak diberi awalan.
  assert.ok(!toCsv([{ name: 'Klinik', score: 1, label: 'x' }]).includes("'"));
});
