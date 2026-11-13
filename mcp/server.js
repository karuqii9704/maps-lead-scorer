#!/usr/bin/env node
'use strict';
// Maps Lead Scorer MCP server. Default transport: stdio. `--http`: Streamable HTTP at /mcp.
// stdout is the MCP channel in stdio mode: log to stderr only.
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { createServer } = require('./tools.js');
const browser = require('./browser.js');
const pkg = require('../package.json');

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.error(`maps-lead-scorer-mcp ${pkg.version}
Usage: maps-lead-scorer-mcp [--http]
  (default)  stdio transport
  --http     Streamable HTTP at http://MLS_HOST:MLS_PORT/mcp (default 127.0.0.1:3333)
Env: MLS_AUTH_TOKEN (required when MLS_HOST is not loopback), MLS_PORT, MLS_HOST,
     MLS_HEADLESS (true|false, default auto), MLS_HL, MLS_OUTPUT_DIR`);
  process.exit(0);
}

async function main() {
  let httpServer = null;
  if (args.includes('--http')) {
    const { startHttp } = require('./http.js');
    const host = (process.env.MLS_HOST || '127.0.0.1').trim();
    const port = process.env.MLS_PORT === undefined || process.env.MLS_PORT === '' ? 3333 : Number(process.env.MLS_PORT);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('MLS_PORT must be an integer 0-65535');
    httpServer = await startHttp({
      host, port, token: process.env.MLS_AUTH_TOKEN || null, log: (m) => console.error(m),
    });
    const addr = httpServer.address();
    const shown = host.includes(':') ? `[${host}]` : host;
    console.error(`maps-lead-scorer MCP ${pkg.version} listening on http://${shown}:${addr.port}/mcp`
      + ` (${process.env.MLS_AUTH_TOKEN ? 'bearer auth on' : 'no auth, loopback only'}, headless=${browser.HEADLESS})`);
  } else {
    await createServer().connect(new StdioServerTransport());
    process.stdin.on('close', () => bye());
    console.error(`maps-lead-scorer MCP ${pkg.version} ready (stdio, headless=${browser.HEADLESS})`);
  }

  function bye() {
    if (httpServer) httpServer.close();
    browser.closeBrowser().finally(() => process.exit(0));
  }
  process.on('SIGINT', bye);
  process.on('SIGTERM', bye);
}

main().catch((e) => {
  console.error(e && e.message ? e.message : e);
  process.exit(1);
});
