'use strict';
// Tool definitions shared by every transport (stdio, Streamable HTTP).
const fs = require('fs');
const path = require('path');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { z } = require('zod');
const { scoreLead, DEFAULT_WEIGHTS } = require('../src/score.js');
const { toCsv } = require('../src/csv.js');
const browser = require('./browser.js');
const pkg = require('../package.json');

const weightsSchema = z.object(
  Object.fromEntries(Object.keys(DEFAULT_WEIGHTS).map((k) => [k, z.number().min(0).max(100).optional()])),
).strict().describe(`Override scoring weights (points). Defaults: ${JSON.stringify(DEFAULT_WEIGHTS)}`);

const nullableStr = z.string().nullable().optional();
const leadSchema = z.object({
  name: z.string(),
  category: nullableStr,
  rating: z.number().nullable().optional(),
  reviewCount: z.number().nullable().optional(),
  phone: z.string().nullable().optional().describe('null = unknown, "" = confirmed none'),
  address: nullableStr,
  websiteUrl: nullableStr,
  websiteType: z.enum(['none', 'social', 'own', 'unknown']).optional(),
  isClosed: z.boolean().optional(),
  mapsUrl: nullableStr,
}).passthrough();

const withScore = (lead, weights) => Object.assign({}, lead, scoreLead(lead, weights));
const text = (t) => ({ content: [{ type: 'text', text: t }] });
const fail = (e) => ({ isError: true, content: [{ type: 'text', text: (e && e.message) || String(e) }] });

function summarize(leads) {
  const count = (f) => leads.filter(f).length;
  return `${leads.length} lead(s). ${count((l) => l.score >= 70)} Potensial (>=70), `
    + `${count((l) => l.websiteType === 'none')} without website, ${count((l) => l.incomplete)} with incomplete data.`;
}

// Headless Chrome is served a reduced Maps layout without review counts (observed 2026-11-13); headful shows them.
function dataWarnings(leads) {
  const missing = leads.some((l) => l.rating != null && l.reviewCount == null);
  return missing && browser.HEADLESS
    ? ['Review counts are missing: headless Chrome gets a reduced Maps layout. Scores omit the review-count points. '
      + 'Run the server with a display (on a VPS: xvfb-run -a) or set MLS_HEADLESS=false for full data.']
    : [];
}

function progressFor(extra) {
  const token = extra && extra._meta && extra._meta.progressToken;
  if (token == null) return () => {};
  return (progress, total, message) => {
    extra.sendNotification({
      method: 'notifications/progress',
      params: { progressToken: token, progress, total, message },
    }).catch(() => {});
  };
}

// confineOutput (used in HTTP mode): export_csv may only write inside MLS_OUTPUT_DIR / the working directory.
function createServer({ confineOutput = false } = {}) {
  const server = new McpServer({ name: 'maps-lead-scorer', version: pkg.version });

  server.registerTool('search_leads', {
    description:
      'Search Google Maps for businesses and score them as sales leads (Indonesian SMB outreach: no/social-only website, '
      + 'phone, reviews, rating). Drives a real browser at human pace (1.5-3 s between steps; a Chrome window opens when a '
      + 'display is available), so it is slow: about 5-8 s per listing with enrichDetails. Max 60 results per call. '
      + "Automated Maps collection is restricted by Google's terms: keep volume low. Stops with an error if Google shows a CAPTCHA.",
    inputSchema: {
      query: z.string().min(2).max(200).describe('Maps search text, e.g. "klinik gigi Bandung"'),
      maxResults: z.number().int().min(1).max(browser.LIMITS.maxResults).optional()
        .describe(`Listings to collect (default ${browser.LIMITS.defaultResults}, max ${browser.LIMITS.maxResults})`),
      enrichDetails: z.boolean().optional()
        .describe('Open each place to read website/phone/address (default true). Without it, scores are marked incomplete.'),
      minScore: z.number().min(0).max(100).optional().describe('Only return leads with score >= this'),
      noWebsiteOnly: z.boolean().optional().describe('Only return leads confirmed to have no website'),
      weights: weightsSchema.optional(),
    },
  }, async ({ query, maxResults, enrichDetails, minScore, noWebsiteOnly, weights }, extra) => {
    try {
      const { leads, warnings } = await browser.searchLeads(
        { query, maxResults, enrichDetails: enrichDetails !== false }, progressFor(extra));
      warnings.push(...dataWarnings(leads));
      let scored = leads.map((l) => withScore(l, weights));
      const collected = scored.length;
      if (minScore != null) scored = scored.filter((l) => l.score >= minScore);
      if (noWebsiteOnly) scored = scored.filter((l) => l.websiteType === 'none');
      scored.sort((a, b) => b.score - a.score);
      const head = `${summarize(scored)} Collected ${collected} from "${query}".`
        + (warnings.length ? `\nWarnings:\n- ${warnings.join('\n- ')}` : '');
      return text(`${head}\n\n${JSON.stringify(scored, null, 2)}`);
    } catch (e) {
      return fail(e);
    }
  });

  server.registerTool('get_place', {
    description: 'Open one Google Maps place URL (https://www.google.com/maps/place/...), read its details and score it. Slow (browser).',
    inputSchema: {
      mapsUrl: z.string().max(2000).describe('Google Maps place URL. Other hosts are rejected.'),
      weights: weightsSchema.optional(),
    },
  }, async ({ mapsUrl, weights }, extra) => {
    try {
      const lead = await browser.getPlace(mapsUrl, progressFor(extra));
      const w = dataWarnings([lead]);
      return text((w.length ? `Warning: ${w[0]}\n\n` : '') + JSON.stringify(withScore(lead, weights), null, 2));
    } catch (e) {
      return fail(e);
    }
  });

  server.registerTool('score_leads', {
    description: 'Re-score a list of leads (e.g. with different weights). Pure computation, no browser, works offline. Returns leads sorted by score.',
    inputSchema: {
      leads: z.array(leadSchema).min(1).max(500),
      weights: weightsSchema.optional(),
    },
  }, async ({ leads, weights }) => {
    try {
      const scored = leads.map((l) => withScore(l, weights)).sort((a, b) => b.score - a.score);
      return text(`${summarize(scored)}\n\n${JSON.stringify(scored, null, 2)}`);
    } catch (e) {
      return fail(e);
    }
  });

  server.registerTool('export_csv', {
    description:
      'Write leads to a CSV file on the machine running the server (UTF-8 with BOM, opens in Excel). Scores are computed for leads that lack one. '
      + 'Path must end in .csv; relative paths resolve against MLS_OUTPUT_DIR or the server working directory. Default: leads-<timestamp>.csv.',
    inputSchema: {
      leads: z.array(leadSchema).min(1).max(500),
      path: z.string().min(1).max(500).optional().describe('Output file path ending in .csv'),
    },
  }, async ({ leads, path: outPath }) => {
    try {
      const base = process.env.MLS_OUTPUT_DIR ? path.resolve(process.env.MLS_OUTPUT_DIR) : process.cwd();
      const name = outPath || `leads-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
      if (name.includes('\0')) throw new Error('Invalid path');
      if (!/\.csv$/i.test(name)) throw new Error('path must end with .csv');
      const file = path.resolve(base, name);
      if (confineOutput) {
        const rel = path.relative(base, file);
        if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('path must stay inside the server output directory');
      }
      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) throw new Error('path is a directory');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const rows = leads.map((l) => (typeof l.score === 'number' && l.label ? l : withScore(l)));
      fs.writeFileSync(file, toCsv(rows), 'utf8');
      return text(`Wrote ${rows.length} lead(s) to ${file}`);
    } catch (e) {
      return fail(e);
    }
  });

  return server;
}

module.exports = { createServer };
