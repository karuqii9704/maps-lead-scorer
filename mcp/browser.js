'use strict';
// Browser layer for the MCP server: drives a real Chromium via Playwright, injects the
// extension's pure modules (src/selectors.js + src/extract.js) into the Maps page and
// returns plain JSON. No stealth, no CAPTCHA handling: if Google blocks, we stop and say so.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { SELECTORS: S } = require('../src/selectors.js');
const X = require('../src/extract.js');

const LIMITS = { maxResults: 60, defaultResults: 20 };
const HL = (process.env.MLS_HL || 'id').trim() || 'id';
// Default headful: headless Chrome gets a reduced Maps layout without review counts. MLS_HEADLESS=true opts in.
const HEADLESS = /^(true|1|yes)$/i.test(process.env.MLS_HEADLESS || '');

class BlockedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BlockedError';
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Human-ish pacing: 1.5-3 s between scrolls and between place openings. Not configurable on purpose.
const pace = () => sleep(1500 + Math.random() * 1500);

// ---- URL validation -------------------------------------------------------------------

function validateMapsUrl(input) {
  let u;
  try { u = new URL(String(input)); } catch (e) { throw new Error('mapsUrl is not a valid URL'); }
  if (u.protocol !== 'https:') throw new Error('mapsUrl must use https');
  if (u.username || u.password) throw new Error('mapsUrl must not contain credentials');
  if (u.port) throw new Error('mapsUrl must not specify a port');
  const host = u.hostname.toLowerCase();
  const ok = ((host === 'www.google.com' || host === 'google.com') && /^\/maps(\/|$)/.test(u.pathname))
    || (host === 'maps.google.com');
  if (!ok) throw new Error('mapsUrl must be a Google Maps URL (https://www.google.com/maps/...)');
  return u;
}

function withHl(url) {
  const u = validateMapsUrl(url);
  u.searchParams.set('hl', HL);
  return u.toString();
}

// ---- browser lifecycle ----------------------------------------------------------------

let browserPromise = null;
let contextPromise = null;
let queue = Promise.resolve();

async function launch() {
  let lastErr;
  for (const extra of [{ channel: 'chrome' }, {}]) {
    try {
      return await chromium.launch(Object.assign({ headless: HEADLESS }, extra));
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(
    'Could not start a browser. Install Google Chrome, or run: npx playwright install chromium\n'
    + `(${String(lastErr && lastErr.message).split('\n')[0]})`);
}

function getContext() {
  if (!contextPromise) {
    contextPromise = (async () => {
      if (!browserPromise) browserPromise = launch();
      const browser = await browserPromise;
      const context = await browser.newContext({
        locale: HL === 'id' ? 'id-ID' : HL,
        viewport: { width: 1280, height: 900 },
      });
      const src = ['selectors.js', 'extract.js']
        .map((f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'))
        .join('\n;\n');
      await context.addInitScript({ content: src });
      return context;
    })().catch((e) => { contextPromise = null; browserPromise = null; throw e; });
  }
  return contextPromise;
}

async function closeBrowser() {
  const p = browserPromise;
  browserPromise = null;
  contextPromise = null;
  if (p) {
    try { await (await p).close(); } catch (e) { /* already gone */ }
  }
}

// One page at a time: keeps pacing honest even if the agent fires parallel calls.
function run(fn) {
  const next = queue.then(async () => {
    const context = await getContext();
    const page = await context.newPage();
    try { return await fn(page); } finally { await page.close().catch(() => {}); }
  });
  queue = next.catch(() => {});
  return next;
}

// ---- page helpers ---------------------------------------------------------------------

async function handleConsent(page) {
  if (!/(^|\/\/)consent\./.test(page.url())) return;
  const reject = page.getByRole('button', { name: /tolak semua|reject all/i }).first();
  try {
    await reject.click({ timeout: 8000 });
    await page.waitForURL((u) => !/consent\./.test(u.toString()), { timeout: 15000 });
  } catch (e) {
    throw new Error('Google showed a consent page and the "Reject all" button could not be clicked.');
  }
}

async function assertNotBlocked(page) {
  let blocked = /\/sorry\//.test(page.url());
  if (!blocked) {
    try {
      blocked = await page.evaluate(() => {
        const t = document.body ? document.body.innerText.slice(0, 3000) : '';
        return !!document.querySelector('iframe[src*="recaptcha"], #captcha-form, form[action*="/sorry/"]')
          || /unusual traffic|lalu lintas yang tidak biasa|aktivitas tidak biasa/i.test(t);
      });
    } catch (e) { blocked = false; }
  }
  if (blocked) {
    throw new BlockedError(
      'Google is showing a CAPTCHA / "unusual traffic" page. Stopped. This server does not solve or bypass it. '
      + 'Wait a while, lower the volume, or run the search by hand in your own browser.');
  }
}

async function open(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await handleConsent(page);
  await assertNotBlocked(page);
  const host = new URL(page.url()).hostname;
  if (!/(^|\.)google\.[a-z.]+$/.test(host)) throw new Error(`Unexpected redirect to ${host}`);
}

// Runs inside the Maps page. Uses the injected MLS.* (selectors.js + extract.js).
function readCardsInPage() {
  const M = globalThis.MLS;
  if (!M || !M.extractCard) return [];
  const S2 = M.SELECTORS;
  const out = [];
  for (const card of document.querySelectorAll(`${S2.feed} ${S2.card}`)) {
    const lead = M.extractCard(card);
    if (lead) out.push(lead);
  }
  return out;
}

function readDetailsInPage() {
  const M = globalThis.MLS;
  if (!M || !M.extractDetail) return [];
  const S2 = M.SELECTORS;
  const P2 = M.PATTERNS;
  const out = [];
  for (const main of document.querySelectorAll(S2.detailMain)) {
    const d = M.extractDetail(main);
    if (!d) continue;
    for (const el of main.querySelectorAll(S2.stars)) {
      const m = P2.starLabel.exec(el.getAttribute('aria-label') || '');
      if (!m) continue;
      d.rating = parseFloat(m[1].replace(',', '.'));
      if (m[2]) d.reviewCount = M.parseCount(m[2]);
      break;
    }
    if (d.reviewCount == null) {
      for (const el of main.querySelectorAll('[aria-label]')) {
        const m = /^\s*([\d.,]+\s*(?:rb|k|jt|m)?)\s*(?:ulasan|reviews?)\b/i.exec(el.getAttribute('aria-label') || '');
        if (m) { d.reviewCount = M.parseCount(m[1]); break; }
      }
    }
    // Only ever set true: a false here would overwrite a "closed" flag read from the card.
    if (P2.closed.test((main.innerText || '').slice(0, 600))) d.isClosed = true;
    const cat = main.querySelector('button[jsaction*="category"]');
    if (cat && cat.textContent.trim()) d.category = cat.textContent.trim();
    out.push(d);
  }
  return out;
}

async function readDetail(page, expectedName) {
  const pick = async () => {
    let list = [];
    try { list = await page.evaluate(readDetailsInPage); } catch (e) { /* navigating */ }
    if (!list.length) return null;
    const want = (expectedName || '').trim().toLowerCase();
    return list.find((d) => d.name.trim().toLowerCase() === want) || list[0];
  };
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await pick()) {
      await sleep(800); // let late fields (website, phone) render, then read again
      return pick();
    }
    await sleep(500);
  }
  await assertNotBlocked(page);
  return null;
}

async function scrollFeed(page) {
  return page.evaluate((sel) => {
    const f = document.querySelector(sel);
    if (!f) return { end: true };
    f.scrollBy(0, f.scrollHeight);
    return { end: /akhir daftar|end of the list|reached the end/i.test((f.innerText || '').slice(-400)) };
  }, S.feed);
}

// ---- public API -----------------------------------------------------------------------

const clampResults = (n) => Math.max(1, Math.min(LIMITS.maxResults, Math.floor(Number(n) || LIMITS.defaultResults)));

// Returns { leads, warnings }. Leads are raw (unscored); the caller scores them.
function searchLeads({ query, maxResults, enrichDetails = true }, progress = () => {}) {
  const limit = clampResults(maxResults);
  return run(async (page) => {
    const warnings = [];
    const url = `https://www.google.com/maps/search/${encodeURIComponent(query)}?hl=${encodeURIComponent(HL)}`;
    progress(0, 1, 'Opening Google Maps');
    await open(page, url);

    const leads = new Map();
    const hasFeed = await page.waitForSelector(S.feed, { timeout: 20000 }).then(() => true, () => false);
    if (!hasFeed) {
      await assertNotBlocked(page);
      // A very specific query can jump straight to one place instead of a list.
      const single = await readDetail(page, '');
      if (!single) return { leads: [], warnings: ['No result list appeared for this query.'] };
      const lead = Object.assign({ key: X.placeKey(page.url()), mapsUrl: page.url().split('?')[0], category: null }, single, { enriched: true });
      return { leads: [lead], warnings };
    }

    const absorb = (cards) => { for (const c of cards) if (!leads.has(c.key)) leads.set(c.key, c); };
    let endSeen = false;
    let stale = 0;
    for (let round = 0; round < 40; round++) {
      const before = leads.size;
      absorb(await page.evaluate(readCardsInPage));
      progress(Math.min(leads.size, limit), limit, `Collected ${Math.min(leads.size, limit)} listings`);
      if (leads.size >= limit) break;
      if (round > 0) stale = leads.size === before ? stale + 1 : 0;
      if (endSeen || stale >= 3) break;
      endSeen = (await scrollFeed(page)).end;
      await pace();
    }

    const list = [...leads.values()].slice(0, limit);
    if (!enrichDetails) return { leads: list, warnings };

    for (let i = 0; i < list.length; i++) {
      const lead = list[i];
      progress(i, list.length, `Opening place ${i + 1}/${list.length}: ${lead.name}`);
      await pace();
      try {
        const mapsUrl = new URL(lead.mapsUrl, 'https://www.google.com').toString();
        await open(page, withHl(mapsUrl));
        const detail = await readDetail(page, lead.name);
        if (detail) {
          list[i] = Object.assign(X.mergeLead(lead, detail), { enriched: true });
        } else {
          lead.enriched = false;
          lead.enrichError = 'Detail panel did not load';
        }
      } catch (e) {
        if (e instanceof BlockedError) {
          warnings.push(`Stopped enriching at ${i}/${list.length}: ${e.message}`);
          break;
        }
        lead.enriched = false;
        lead.enrichError = String(e.message).split('\n')[0];
      }
    }
    return { leads: list, warnings };
  });
}

function getPlace(mapsUrl, progress = () => {}) {
  const url = withHl(mapsUrl); // validates host/path
  return run(async (page) => {
    progress(0, 1, 'Opening place');
    await open(page, url);
    const detail = await readDetail(page, '');
    if (!detail) throw new Error('No place detail panel found at this URL (is it a /maps/place/ link?).');
    const finalUrl = page.url().split('?')[0];
    return Object.assign(
      { key: X.placeKey(page.url()), category: null, rating: null, reviewCount: null, isClosed: false, mapsUrl: finalUrl },
      detail, { enriched: true });
  });
}

module.exports = { searchLeads, getPlace, closeBrowser, validateMapsUrl, BlockedError, LIMITS, HEADLESS };
