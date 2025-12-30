FROM node:20-bullseye-slim AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && npm ci --omit=dev \
  && rm -rf /var/lib/apt/lists/*

FROM node:20-bullseye-slim
ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_PATH=/data/notify.sqlite
ENV CONFIG_DB_PATH=/data/notify-config.sqlite
ENV REQUIRE_AUTH=false
ENV REQUIRE_HTTPS=false
ENV REQUIRE_HMAC=true
ENV TRUST_PROXY=false
ENV ALLOWED_IPS=
ENV IP_ALLOWLIST_ENABLED=false
ENV ADMIN_BASE_PATH=
ENV ADMIN_BOOTSTRAP_USER=
ENV ADMIN_BOOTSTRAP_PASSWORD=
ENV ADMIN_SESSION_SECRET=
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN chown -R node:node /app

USER node
EXPOSE 3000
CMD ["node", "server.js"]
