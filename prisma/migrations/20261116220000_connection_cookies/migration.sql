-- Optional per-connection yt-dlp cookie jar (encrypted at rest by the app).
ALTER TABLE "Connection"
  ADD COLUMN "cookieJar" TEXT;
