'use strict';
// Offline tests for the Streamable HTTP mode: loopback server, auth, refusal to start unsafely.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { isLoopbackHost, tokenMatches, checkConfig } = require('../mcp/http.js');
const { resolveHeadless } = require('../mcp/browser.js');

const SERVER = path.join(__dirname, '..', 'mcp', 'server.js');
const TOKEN = 'test-token-0123456789abcdef';

function startServer(env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mls-http-'));
  const child = spawn(process.execPath, [SERVER, '--http'], {
    env: Object.assign({}, process.env, { MLS_PORT: '0', MLS_OUTPUT_DIR: dir }, env),
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let err = '';
  const ready = new Promise((resolve, reject) => {
    child.stderr.on('data', (d) => {
      err += d;
      const m = /listening on (http:\/\/\S+\/mcp)/.exec(err);
      if (m) resolve(m[1]);
    });
    child.once('exit', (code) => reject(new Error(`exited ${code}: ${err}`)));
    setTimeout(() => reject(new Error('timeout: ' + err)), 15000);
  });
  const stop = () => { child.kill(); fs.rmSync(dir, { recursive: true, force: true }); };
  return ready.then((url) => ({ url, stop, dir }), (e) => { stop(); throw e; });
}

function rawRequest(url, { method = 'POST', headers = {}, body = '{}' } = {}) {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: u.hostname, port: u.port, path: u.pathname, method, headers }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

const JSON_HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };

test('HTTP loopback: tools/list and score_leads over Streamable HTTP, no token needed', async () => {
  const s = await startServer({});
  try {
    const client = new Client({ name: 't', version: '0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(s.url)));
    const { tools } = await client.listTools();
    assert.deepStrictEqual(tools.map((t) => t.name).sort(), ['export_csv', 'get_place', 'score_leads', 'search_leads']);
    const r = await client.callTool({ name: 'score_leads', arguments: { leads: [{ name: 'A', websiteType: 'none', phone: '1' }] } });
    assert.ok(!r.isError);
    assert.match(r.content[0].text, /"score": 55/);
    const bad = await client.callTool({ name: 'export_csv', arguments: { leads: [{ name: 'A' }], path: '../escape.csv' } });
    assert.ok(bad.isError, 'HTTP mode confines export_csv to the output dir');
    const ok = await client.callTool({ name: 'export_csv', arguments: { leads: [{ name: 'A' }], path: 'ok.csv' } });
    assert.ok(!ok.isError);
    assert.ok(fs.existsSync(path.join(s.dir, 'ok.csv')));
    await client.close();

    const health = await rawRequest(s.url.replace('/mcp', '/healthz'), { method: 'GET', body: '' });
    assert.strictEqual(health.status, 200);
    assert.strictEqual((await rawRequest(s.url, { headers: { 'Content-Type': 'text/plain' } })).status, 415);
    assert.strictEqual((await rawRequest(s.url, { method: 'GET', body: '', headers: JSON_HEADERS })).status, 405);
    assert.strictEqual((await rawRequest(s.url, { headers: Object.assign({ Host: 'evil.example' }, JSON_HEADERS) })).status, 403);
  } finally { s.stop(); }
});

test('HTTP with token: 401 without or with a wrong token, works with the right one', async () => {
  const s = await startServer({ MLS_AUTH_TOKEN: TOKEN });
  try {
    assert.strictEqual((await rawRequest(s.url, { headers: JSON_HEADERS })).status, 401);
    assert.strictEqual((await rawRequest(s.url, { headers: Object.assign({ Authorization: 'Bearer nope' }, JSON_HEADERS) })).status, 401);
    assert.strictEqual((await rawRequest(s.url, { headers: Object.assign({ Authorization: TOKEN }, JSON_HEADERS) })).status, 401);
    const client = new Client({ name: 't', version: '0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(s.url), {
      requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
    }));
    assert.strictEqual((await client.listTools()).tools.length, 4);
    await client.close();
  } finally { s.stop(); }
});

test('non-loopback host without MLS_AUTH_TOKEN refuses to start', async () => {
  await assert.rejects(startServer({ MLS_HOST: '0.0.0.0', MLS_AUTH_TOKEN: '' }), /Refusing to listen on 0\.0\.0\.0.*MLS_AUTH_TOKEN/s);
  await assert.rejects(startServer({ MLS_HOST: '127.0.0.1', MLS_AUTH_TOKEN: 'short' }), /at least 16/);
});

test('helpers: loopback detection, constant-time bearer check, config check, headless auto', () => {
  for (const h of ['127.0.0.1', 'localhost', '::1', '[::1]', '127.1.2.3']) assert.ok(isLoopbackHost(h), h);
  for (const h of ['0.0.0.0', '::', '192.168.1.5', 'example.com', '']) assert.ok(!isLoopbackHost(h), h);
  assert.ok(tokenMatches(`Bearer ${TOKEN}`, TOKEN));
  assert.ok(!tokenMatches(`Bearer ${TOKEN}x`, TOKEN));
  assert.ok(!tokenMatches(TOKEN, TOKEN));
  assert.ok(!tokenMatches(undefined, TOKEN));
  assert.throws(() => checkConfig({ host: '0.0.0.0', token: null }));
  assert.doesNotThrow(() => checkConfig({ host: '0.0.0.0', token: TOKEN }));
  assert.doesNotThrow(() => checkConfig({ host: '127.0.0.1', token: null }));

  assert.strictEqual(resolveHeadless({}, 'win32'), false);
  assert.strictEqual(resolveHeadless({}, 'darwin'), false);
  assert.strictEqual(resolveHeadless({}, 'linux'), true);
  assert.strictEqual(resolveHeadless({ DISPLAY: ':99' }, 'linux'), false);
  assert.strictEqual(resolveHeadless({ WAYLAND_DISPLAY: 'wayland-0' }, 'linux'), false);
  assert.strictEqual(resolveHeadless({ MLS_HEADLESS: 'true' }, 'win32'), true);
  assert.strictEqual(resolveHeadless({ MLS_HEADLESS: 'false' }, 'linux'), false);
});
