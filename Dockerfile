# syntax=docker/dockerfile:1.7
# ─────────────────────────────────────────────────────────────────────────────
# One image, two processes:
#   web     -> next start          (port 3000)
#   worker  -> node dist/worker    (24/7 BullMQ consumer, ffmpeg + yt-dlp)
#   migrate -> prisma migrate deploy (one-shot)
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS base

ENV NEXT_TELEMETRY_DISABLED=1 \
    PYTHONUNBUFFERED=1 \
    NODE_OPTIONS=--max-old-space-size=2048 \
    YTDLP_VERSION=latest \
    CURL_CFFI_VERSION=0.17.0

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      ffmpeg \
      # libass needs real fonts to burn .srt subtitles.
      fonts-dejavu-core \
      python3 \
      python3-pip \
 # TikTok's extractor needs TLS impersonation; yt-dlp uses curl_cffi for that.
 # Without it, public TikTok profiles fail with a JSON parse error.
 && python3 -m pip install --break-system-packages --no-cache-dir \
      "curl_cffi==${CURL_CFFI_VERSION}" \
 && rm -rf /var/lib/apt/lists/* \
 # Standalone yt-dlp build: independent of distro Python packaging and much
 # newer than Debian's, which keeps extractors working. Pin YTDLP_VERSION for
 # reproducible images.
 && curl -fsSL "https://github.com/yt-dlp/yt-dlp/releases/${YTDLP_VERSION}/download/yt-dlp" \
      -o /usr/local/bin/yt-dlp \
 && chmod +x /usr/local/bin/yt-dlp \
 && yt-dlp --version

WORKDIR /app

# ── Dependencies (with Prisma client generated) ───────────────────────────────
FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund

# ── Build: Next.js + bundled worker ───────────────────────────────────────────
FROM deps AS builder
COPY . .
RUN npx prisma generate \
 && npm run build \
 && npm run build:worker

# ── Production dependencies only ──────────────────────────────────────────────
FROM base AS prod-deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --no-audit --no-fund

# ── Runtime ───────────────────────────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN useradd --system --uid 1001 --create-home appuser \
 && mkdir -p /data/media /data/secret \
 && chown -R appuser:appuser /data /app

COPY --from=prod-deps --chown=appuser:appuser /app/node_modules ./node_modules
COPY --from=builder  --chown=appuser:appuser /app/.next ./.next
COPY --from=builder  --chown=appuser:appuser /app/dist ./dist
COPY --from=builder  --chown=appuser:appuser /app/public ./public
COPY --from=builder  --chown=appuser:appuser /app/prisma ./prisma
COPY --chown=appuser:appuser package.json package-lock.json next.config.mjs ./
# Generates/persists APP_SECRET when the app is started without a .env file.
COPY --chmod=0755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

USER appuser
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=5 \
  CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["npm", "run", "start"]
