# Maps Lead Scorer MCP server, Streamable HTTP mode.
# Base image version must match the "playwright" version in package.json.
FROM mcr.microsoft.com/playwright:v1.65.0-noble

# xvfb gives Chromium a display, so Google Maps serves the full layout (with review counts).
RUN apt-get update \
 && apt-get install -y --no-install-recommends xvfb xauth \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY mcp ./mcp

RUN mkdir -p /data && chown pwuser:pwuser /data
ENV NODE_ENV=production \
    MLS_HOST=0.0.0.0 \
    MLS_PORT=3333 \
    MLS_OUTPUT_DIR=/data
# MLS_AUTH_TOKEN is NOT set here. The server refuses to start on 0.0.0.0 without it:
#   docker run -e MLS_AUTH_TOKEN=... -p 127.0.0.1:3333:3333 maps-lead-scorer

USER pwuser
EXPOSE 3333
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.MLS_PORT+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["xvfb-run", "-a", "-s", "-screen 0 1280x960x24", "node", "mcp/server.js", "--http"]
