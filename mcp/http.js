'use strict';
// Streamable HTTP transport (stateless: one McpServer per request) at /mcp.
// Auth: bearer token, required whenever the bind host is not loopback.
const http = require('http');
const crypto = require('crypto');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { createServer } = require('./tools.js');

const MAX_BODY = 5 * 1024 * 1024;
const MIN_TOKEN_LENGTH = 16;

function isLoopbackHost(host) {
  const h = String(host || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '::1' || /^127(\.\d{1,3}){3}$/.test(h) || h === '::ffff:127.0.0.1';
}

// Constant-time token check: compare fixed-length digests so length does not leak.
function tokenMatches(header, token) {
  const m = /^Bearer\s+(.+)$/i.exec(header || '');
  const a = crypto.createHash('sha256').update(m ? m[1].trim() : '').digest();
  const b = crypto.createHash('sha256').update(token).digest();
  return crypto.timingSafeEqual(a, b) && !!m;
}

// Throws if the configuration is unsafe. Called before binding.
function checkConfig({ host, token }) {
  if (token != null && token.length < MIN_TOKEN_LENGTH) {
    throw new Error(`MLS_AUTH_TOKEN must be at least ${MIN_TOKEN_LENGTH} characters`);
  }
  if (!isLoopbackHost(host) && !token) {
    throw new Error(
      `Refusing to listen on ${host}: set MLS_AUTH_TOKEN (>= ${MIN_TOKEN_LENGTH} chars) when the host is not loopback. `
      + 'Clients must send "Authorization: Bearer <token>".');
  }
}

function send(res, status, body, headers) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, Object.assign({ 'Content-Type': 'application/json' }, headers));
  res.end(payload);
}
const rpcError = (res, status, message, headers) =>
  send(res, status, { jsonrpc: '2.0', error: { code: -32000, message }, id: null }, headers);

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('Request body too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// Returns a listening http.Server. Resolves after 'listening'.
function startHttp({ host = '127.0.0.1', port = 3333, token = null, log = () => {} } = {}) {
  checkConfig({ host, token });
  const loopback = isLoopbackHost(host);

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      if (url.pathname === '/healthz' && req.method === 'GET') return send(res, 200, { ok: true });
      if (url.pathname !== '/mcp') return send(res, 404, { error: 'Not found. MCP endpoint is /mcp' });

      if (token) {
        if (!tokenMatches(req.headers.authorization, token)) {
          return rpcError(res, 401, 'Unauthorized', { 'WWW-Authenticate': 'Bearer' });
        }
      } else if (loopback) {
        // No token on loopback: block DNS-rebinding by requiring a loopback Host header.
        const hostHeader = String(req.headers.host || '').replace(/:\d+$/, '');
        if (!isLoopbackHost(hostHeader)) return rpcError(res, 403, 'Forbidden host');
      }

      if (req.method !== 'POST') return rpcError(res, 405, 'Method not allowed (stateless server: POST only)', { Allow: 'POST' });
      // Requiring application/json forces a CORS preflight for browsers, so web pages cannot call a local server.
      if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) {
        return rpcError(res, 415, 'Content-Type must be application/json');
      }

      let body;
      try { body = JSON.parse(await readBody(req)); } catch (e) {
        return rpcError(res, e.status || 400, e.status ? e.message : 'Invalid JSON');
      }

      const mcp = createServer({ confineOutput: true });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on('close', () => { transport.close().catch(() => {}); mcp.close().catch(() => {}); });
      await mcp.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (e) {
      log(`request error: ${e && e.message}`);
      if (!res.headersSent) rpcError(res, 500, 'Internal server error');
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(server));
  });
}

module.exports = { startHttp, isLoopbackHost, tokenMatches, checkConfig };
