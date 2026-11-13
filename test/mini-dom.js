// DOM mini khusus test, supaya extract.js bisa diuji di Node tanpa dependency.
// Mendukung: tag, [attr], [attr="v"], [attr*="v"], [attr^="v"], turunan (spasi), koma.
'use strict';

const VOID = new Set(['img', 'br', 'input', 'meta', 'link', 'hr']);
const decode = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');

class El {
  constructor(tag, attrs) {
    this.tagName = tag.toUpperCase();
    this.attrs = attrs;
    this.childNodes = [];
    this.parent = null;
  }
  get children() { return this.childNodes.filter((n) => n instanceof El); }
  get textContent() { return this.childNodes.map((n) => (typeof n === 'string' ? n : n.textContent)).join(''); }
  getAttribute(name) { return name in this.attrs ? this.attrs[name] : null; }
  querySelectorAll(selector) {
    const alts = selector.split(',').map((s) => s.trim().split(/\s+/).map(parseCompound));
    const out = [];
    const walk = (el) => {
      for (const c of el.children) {
        if (alts.some((chain) => matchChain(c, chain))) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function parseCompound(text) {
  const tag = (/^[a-z0-9]+/i.exec(text) || [''])[0].toUpperCase();
  const attrs = [];
  const re = /\[([\w-]+)(?:([*^]?=)"([^"]*)")?\]/g;
  let m;
  while ((m = re.exec(text))) attrs.push({ name: m[1], op: m[2], value: m[3] });
  return { tag, attrs };
}

function matchCompound(el, c) {
  if (c.tag && el.tagName !== c.tag) return false;
  return c.attrs.every((a) => {
    const v = el.getAttribute(a.name);
    if (v == null) return false;
    if (!a.op) return true;
    return a.op === '=' ? v === a.value : a.op === '*=' ? v.includes(a.value) : v.startsWith(a.value);
  });
}

function matchChain(el, chain) {
  if (!matchCompound(el, chain[chain.length - 1])) return false;
  let i = chain.length - 2;
  for (let p = el.parent; p && i >= 0; p = p.parent) if (matchCompound(p, chain[i])) i--;
  return i < 0;
}

function parse(html) {
  const rootEl = new El('root', {});
  let cur = rootEl;
  const re = /<!--[\s\S]*?-->|<(\/?)([a-z0-9]+)((?:"[^"]*"|[^>"])*)>|([^<]+)/gi;
  let m;
  while ((m = re.exec(html))) {
    if (m[4] != null) { cur.childNodes.push(decode(m[4])); continue; }
    if (!m[2]) continue;
    const tag = m[2].toLowerCase();
    if (m[1]) { if (cur.parent) cur = cur.parent; continue; }
    const attrs = {};
    const are = /([\w:-]+)(?:="([^"]*)")?/g;
    let a;
    while ((a = are.exec(m[3]))) attrs[a[1]] = decode(a[2] || '');
    const el = new El(tag, attrs);
    el.parent = cur;
    cur.childNodes.push(el);
    if (!VOID.has(tag)) cur = el;
  }
  return rootEl;
}

module.exports = { parse };
