# Production image with a real Chromium for PDF export (Railway).
# Local Mac still uses the system Chrome via CHROME_PATH / findChrome().
FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    fonts-dejavu-core \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    CHROME_PATH=/usr/bin/chromium \
    PDF_USE_SPAWN=0 \
    PDF_TIMEOUT_MS=45000 \
    NODE_ENV=production

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .
RUN npm run build

EXPOSE 3001
CMD ["node", "server/index.js"]
