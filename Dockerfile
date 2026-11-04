FROM node:24-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates tzdata \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .
RUN chmod +x scripts/entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["scripts/entrypoint.sh"]
CMD ["node", "src/server.js"]
