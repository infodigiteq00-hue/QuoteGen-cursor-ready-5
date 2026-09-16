# Optional Chromium image for PDF export (not used while railway.toml is on NIXPACKS).
# When enabling: set builder = "DOCKERFILE" and ensure Railway has
# VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY available at build time.
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
    PDF_TIMEOUT_MS=45000

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# Vite bakes these into the browser bundle — must be present during build.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY

COPY . .
RUN npm run build \
    && npm prune --omit=dev

ENV NODE_ENV=production

EXPOSE 3001
CMD ["node", "server/index.js"]
