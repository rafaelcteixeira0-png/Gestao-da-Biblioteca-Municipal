# Two build targets. The final/default image is the native Node API.
FROM caddy:2-alpine AS proxy
RUN mkdir -p /data/caddy /config/caddy \
    && chown -R 1000:1000 /data /config \
    && chmod 0700 /data /config /data/caddy /config/caddy
COPY --chown=1000:1000 deploy/Caddyfile /etc/caddy/Caddyfile
USER 1000:1000
EXPOSE 8080 8443

FROM node:24-bookworm-slim AS api
ENV NODE_ENV=production \
    LIBRARY_MODE=hosted \
    LIBRARY_HOST=0.0.0.0 \
    LIBRARY_PORT=3001 \
    LIBRARY_DB_PATH=/data/library.sqlite \
    LIBRARY_COOKIE_SECURE=true
WORKDIR /app
# API modules use only Node built-ins, including node:sqlite.
COPY --chown=node:node package.json ./
COPY --chown=node:node server ./server
RUN mkdir -p /data /backups \
    && chown node:node /data /backups \
    && chmod 0700 /data /backups
USER node
EXPOSE 3001
VOLUME ["/data", "/backups"]
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:3001/api/health', { signal: AbortSignal.timeout(3000) }).then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"]
CMD ["node", "server/start.mjs"]
