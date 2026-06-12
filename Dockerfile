FROM node:26-alpine AS builder
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN npm install -g pnpm@11.1.1
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm run build

FROM node:26-alpine AS runner
WORKDIR /app
ENV TZ=Europe/Berlin
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Subscriptions (SSE) übertragen die ausgewählte Verbindung als Query-Parameter;
# bei mehrteiligen Reisen überschreitet das die Standard-Header-Grenze (16 KB)
# und führt sonst zu HTTP 431.
ENV NODE_OPTIONS=--max-http-header-size=131072
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Some data files used at runtime are not included in standalone
COPY --from=builder /app/node_modules/.pnpm/db-hafas-stations@2.0.0 ./node_modules/.pnpm/db-hafas-stations@2.0.0

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=5 \
    CMD IP=$(hostname -i | awk '{print $1}'); wget -q -O - "http://$IP:${PORT:-3000}" > /dev/null || exit 1

CMD ["node", "server.js"]
