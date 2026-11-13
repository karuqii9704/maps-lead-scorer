'use strict';
// Offline MCP smoke test: spawns the stdio server, no browser, no network.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { validateMapsUrl } = require('../mcp/browser.js');

const LEADS = [
  { name: 'Klinik A', rating: 4.8, reviewCount: 120, phone: '0812', websiteType: 'none', websiteUrl: null },
  { name: 'Klinik B', rating: 4.0, reviewCount: 12, phone: '', websiteType: 'own', websiteUrl: 'https://b.example' },
];

async function withClient(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mls-'));
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [path.join(__dirname, '..', 'mcp', 'server.js')],
    env: Object.assign({}, process.env, { MLS_OUTPUT_DIR: dir }),
    stderr: 'ignore',
  }));
  try { await fn(client, dir); } finally { await client.close(); fs.rmSync(dir, { recursive: true, force: true }); }
}

test('tools/list exposes the 4 tools', () => withClient(async (c) => {
  const { tools } = await c.listTools();
  assert.deepStrictEqual(tools.map((t) => t.name).sort(), ['export_csv', 'get_place', 'score_leads', 'search_leads']);
  for (const t of tools) assert.ok(t.inputSchema && t.inputSchema.properties, t.name);
}));

test('score_leads works offline and sorts by score', () => withClient(async (c) => {
  const r = await c.callTool({ name: 'score_leads', arguments: { leads: LEADS } });
  assert.ok(!r.isError);
  const json = JSON.parse(r.content[0].text.slice(r.content[0].text.indexOf('[')));
  assert.strictEqual(json[0].name, 'Klinik A');
  assert.strictEqual(json[0].score, 40 + 15 + 20 + 5);
}));

test('export_csv writes a BOM CSV and rejects non-.csv paths', () => withClient(async (c, dir) => {
  const r = await c.callTool({ name: 'export_csv', arguments: { leads: LEADS, path: 'out.csv' } });
  assert.ok(!r.isError, r.content[0].text);
  const buf = fs.readFileSync(path.join(dir, 'out.csv'));
  assert.deepStrictEqual([...buf.slice(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.match(buf.toString('utf8'), /Klinik A/);
  const bad = await c.callTool({ name: 'export_csv', arguments: { leads: LEADS, path: 'x.sh' } });
  assert.ok(bad.isError);
}));

test('get_place rejects non-Maps URLs', () => withClient(async (c) => {
  for (const u of ['https://evil.example/maps/place/x', 'http://www.google.com/maps/place/x',
    'https://www.google.com.evil.example/maps/', 'https://www.google.com/search?q=x', 'file:///etc/passwd']) {
    const r = await c.callTool({ name: 'get_place', arguments: { mapsUrl: u } });
    assert.ok(r.isError, u);
  }
}));

test('validateMapsUrl accepts place URLs only on google.com/maps', () => {
  assert.ok(validateMapsUrl('https://www.google.com/maps/place/Foo/@1,2,3z'));
  assert.throws(() => validateMapsUrl('https://user:pw@www.google.com/maps/place/x'));
});
