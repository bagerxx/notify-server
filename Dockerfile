FROM node:20-bullseye-slim AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && npm ci --omit=dev \
  && rm -rf /var/lib/apt/lists/*

FROM node:20-bullseye-slim
ENV NODE_ENV=production
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN mkdir -p /app/data /app/keys \
  && chown -R node:node /app

USER node
EXPOSE 3000
CMD ["node", "server.js"]
