# Repurpose Studio

A private, single-tenant clone of Repurpose.io: it watches your source accounts, downloads new
posts, transforms them with FFmpeg, rewrites captions from templates and publishes to as many
destinations as you want — 24/7, in the background.

**No accounts, no login, no billing.** Opening the URL loads the dashboard directly. Keep the
deployment private (VPN, Cloudflare Access, or reverse-proxy basic auth) — there is no app-level
access control by design.

Status: **Phases 1–5 complete** — architecture, schema, deployment, the 24/7 engine, and the full
web UI (dashboard, queue, connections, workflow builder, drip scheduler, logs).

---

## Quick start

Needs only Docker (Desktop or Engine + Compose v2). Nothing to configure — no `.env`, no manual
secret:

```bash
git clone https://github.com/tayml7m/repeevy.git
cd repeevy
docker compose up -d --build
```

First build takes a few minutes (it installs FFmpeg and yt-dlp). When it finishes, open
**http://localhost:3000** — you land straight on the dashboard. `docker compose ps` should show
`repurpose-web` healthy and `repurpose-worker` running; the `migrate` container exits after
applying the schema.

The encryption key (`APP_SECRET`) is generated on first boot and stored on the `secrets` volume,
so web, worker and future restarts all share it. To bring your own key, dashboard domain or
platform credentials, copy `.env.example` to `.env` and edit it before starting.

---

## 1. Architecture

```
                    ┌──────────────────────────────────────────────┐
  Browser (any      │  Next.js App Router (web container, :3000)    │
  device) ─────────▶│  pages: /, /queue, /workflows, /connections,  │
                    │         /schedule, /logs                      │
                    │  API routes + server actions (producers)      │
                    └───────────────┬──────────────┬───────────────┘
                                    │ Prisma       │ BullMQ
                                    ▼              ▼
                    ┌───────────────────┐   ┌──────────────────────┐
                    │ PostgreSQL 17     │   │ Redis 7 (AOF,noevict)│
                    │ all app state     │   │ queues + repeat jobs │
                    └─────────┬─────────┘   └──────────┬───────────┘
                              │                        │
                    ┌─────────▼────────────────────────▼───────────┐
                    │  Worker container (24/7, own process)         │
                    │  detect → process → publish → maintenance     │
                    │  yt-dlp · fluent-ffmpeg · sharp · adapters    │
                    └───────────────┬───────────────────────────────┘
                                    │
                    ┌───────────────▼───────────────┐
                    │  Shared media volume /data    │
                    │  (or S3 / R2 when configured) │
                    └───────────────────────────────┘
```

Why two processes: Next.js request handlers should never block on a 10-minute FFmpeg render or a
YouTube resumable upload. The web container only writes rows and enqueues jobs; the worker container
drains them with configurable concurrency and survives deployments independently.

Queue topology (defined once in `src/lib/queue.ts`):

| Queue         | Producer                          | Consumer work                                                  |
| ------------- | --------------------------------- | -------------------------------------------------------------- |
| `detect`      | repeatable per active workflow    | poll source adapter, filter, dedupe, create `ContentItem`       |
| `process`     | detector / "Re-run" button        | yt-dlp download → FFmpeg transform → caption render → thumbs    |
| `publish`     | auto-publish or "Publish now"     | upload to each `PublishTarget`, write remote ids/urls           |
| `maintenance` | repeatable scheduler              | drip slot allocation, OAuth token refresh, media cleanup        |

Deduping is enforced by the database, not by worker memory: `ContentItem` has a unique
`(workflowId, sourcePostId)` index, so a post can never enter the same workflow twice even if two
polls overlap.

### Directory structure

```
.
├── docker-compose.yml          # postgres + redis + migrate + web + worker
├── Dockerfile                  # one image: ffmpeg, yt-dlp, prisma, next build, worker bundle
├── docker-entrypoint.sh        # generates/persists APP_SECRET when there is no .env
├── .env.example                # optional overrides, documented
├── prisma/
│   ├── schema.prisma           # AppConfig, Connection, Workflow, ContentItem, JobLog (+ targets, slots, assets)
│   ├── migrations/             # SQL migrations applied by the `migrate` service
│   └── seed.ts                 # idempotent default settings
├── public/
└── src/
    ├── app/
    │   ├── layout.tsx          # responsive shell, dark theme tokens
    │   ├── page.tsx            # dashboard: stats, recent detections, health warnings
    │   ├── queue/page.tsx      # content queue: filters, thumbnails, item actions
    │   ├── connections/page.tsx# accounts + API credentials (OAuth connect/test/refresh)
    │   ├── workflows/          # list, new + visual builder, edit (assets, schedule)
    │   ├── schedule/page.tsx   # drip slots per workflow
    │   ├── logs/page.tsx       # structured logs with full error traces
    │   ├── globals.css         # Tailwind v4 + shadcn design tokens
    │   └── api/
    │       ├── health/route.ts # docker healthcheck: db, redis, ffmpeg, yt-dlp, media, secret
    │       ├── media/route.ts  # authenticated-free streaming of artifacts from the volume
    │       └── oauth/[provider]/{start,callback}/route.ts  # connect flow (PKCE for X)
    ├── components/             # app shell, ui primitives, queue/connections/workflows widgets
    ├── lib/
    │   ├── actions/            # server actions for queue, connections, workflows, schedule, assets
    │   ├── env.ts              # lazily validated environment
    │   ├── db.ts               # Prisma singleton
    │   ├── redis.ts            # BullMQ connection options + health ping
    │   ├── queue.ts            # queue names + typed job payloads
    │   ├── crypto.ts           # AES-256-GCM for tokens/secrets
    │   ├── settings.ts         # settings store, DB→env credential resolution
    │   ├── platforms.ts        # platform catalogue (scopes, capabilities, env keys)
    │   ├── health.ts           # runtime checks
    │   ├── server/request.ts   # server-only cookies/headers helpers
    │   ├── adapters/           # TikTok source, YouTube + Google Drive destinations, registry
    │   ├── oauth/refresh.ts    # provider token refresh + valid-token resolution
    │   ├── media/              # yt-dlp download, FFmpeg transforms, sharp images, volume
    │   └── pipeline/           # detect, filters, captions, process, publish, schedule, cleanup, logs
    └── worker/
        └── index.ts            # 24/7 worker: four processors + repeat maintenance sweeps
```

---

## 2. Data model

All state lives in PostgreSQL. There is deliberately **no User, Session or Billing table**.

| Model                 | Purpose                                                                                                  |
| --------------------- | -------------------------------------------------------------------------------------------------------- |
| `AppConfig`           | Key/value settings: OAuth developer apps (`oauth.tiktok`), storage, scheduler defaults. Secret rows are encrypted. |
| `Connection`          | One authenticated platform account with encrypted access/refresh tokens, scopes, expiry and refresh state. |
| `Workflow`            | Source account + trigger/filters + caption rules + transforms + automation mode + drip schedule.          |
| `WorkflowDestination` | Per-destination overrides — this is how 1-to-many fan-out is modelled (unique per workflow/connection/type). |
| `ContentItem`         | A detected source post for one workflow. Unique `(workflowId, sourcePostId)` = strict dedupe.             |
| `PublishTarget`       | Per-destination publish result: caption, title, remote id/url, status, error.                              |
| `ScheduleSlot`        | Reserved drip slots; `(workflowId, scheduledFor)` unique and `localDate` for max-per-day caps.              |
| `MediaAsset`          | Intro/outro clips, SRT files and generated outputs on the media volume or S3.                              |
| `JobLog`              | Structured per-stage logging that powers `/logs` and "View full error trace".                              |

Filters, templates, transforms and scheduling are all modelled as columns so the UI can edit a
workflow without inventing a second config format.

---

## 3. Run it

### TikTok without a developer app (post yourself, detect automatically)

If you publish to TikTok yourself and only want the workflow to pick those videos up and send them
to YouTube (or anywhere else), you do not need a TikTok developer app, OAuth or an audit:

1. **Connections → TikTok → “Use public profile (no developer app)”**, paste
   `https://www.tiktok.com/@yourhandle`, and press **Start watching**. The handle is validated
   immediately with yt-dlp, so a typo fails right away.
2. **Workflows → New workflow**: source = that TikTok connection, destination = YouTube (plus Drive,
   Instagram or Facebook if you want). Auto-publish sends each new video straight to YouTube.

The worker polls the public profile, downloads each new video with yt-dlp (watermark-free), renders
it and publishes. Detection is deduped per workflow, so re-polling never reposts.

Caveats: the account must be **public**, yt-dlp can be rate-limited from datacenter IPs (export
browser cookies and set `YTDLP_COOKIES_FILE` if polling starts failing), and this mode detects videos
only — it never logs in to TikTok. The OAuth TikTok source (Display API) remains available for
private analytics/backlog needs, and TikTok as a *destination* still requires TikTok's audited
Content Posting API.

### Option A — Docker Compose (VPS, or any machine with Docker)

```bash
git clone https://github.com/tayml7m/repeevy.git
cd repeevy
docker compose up -d --build
docker compose logs -f web worker
```

Open `http://localhost:3000`. `/api/health` returns JSON: database, Redis, FFmpeg, yt-dlp, media
volume and encryption key. Compose runs migrations automatically before web/worker start; the media
volume is shared by both. No `.env` is required — see the quick start above.

Tuning the deployment (custom domain, credentials, storage) is optional:

```bash
cp .env.example .env        # set APP_URL for OAuth callbacks on a real domain, etc.
```

Useful commands:

```bash
docker compose exec web npx prisma studio     # inspect data
docker compose exec web npx prisma migrate dev --name my_change
docker compose exec web npm run db:seed
```

### Option B — Railway

1. Create a project, add **PostgreSQL** and **Redis** plugins.
2. Deploy this repo twice from the same Dockerfile: one service with start command
   `npm run start`, one with `npm run worker:prod`.
3. Set `DATABASE_URL` and `REDIS_URL` from the plugins (`${{Postgres.DATABASE_URL}}`,
   `${{Redis.REDIS_URL}}`), plus `APP_SECRET` and `APP_URL` (the public domain).
4. Run migrations once from the web service shell: `npx prisma migrate deploy`.

### Option C — Render

Create a Web Service (Docker) with `npm run start` and a Background Worker with
`npm run worker:prod`, both pointing at the same repo/image; add a Render Postgres and Key Value
instance and wire `DATABASE_URL` / `REDIS_URL`. Set the pre-deploy command to
`npx prisma migrate deploy` on the web service.

### Option D — Fly.io

`fly launch` for the web app from the Dockerfile, `fly postgres create` + `fly redis create`, then
add a second `[processes]` entry `worker = "npm run worker:prod"` in `fly.toml` and attach the same
Postgres/Redis secrets. Use a Fly volume mounted at `/data/media` for both processes.

### Local development (no Docker)

```bash
npm ci
cp .env.example .env            # point DATABASE_URL/REDIS_URL at local services
npx prisma migrate deploy
npm run dev                     # web on :3000
npm run worker                  # worker with tsx watch
```

---

## 4. Platform credentials

Each platform needs your own developer app. Set credentials either as environment variables or —
without a redeploy — paste them in **Connections → API credentials** in the UI; database values win
over env values and are encrypted with `APP_SECRET`.

| Platform      | Redirect URI                                    | Env vars                                   |
| ------------- | ----------------------------------------------- | ------------------------------------------ |
| Google (YouTube, Drive) | `{APP_URL}/api/oauth/google/callback`  | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`  |
| TikTok        | `{APP_URL}/api/oauth/tiktok/callback`           | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` |
| Instagram / Facebook | `{APP_URL}/api/oauth/meta/callback`      | `META_APP_ID`, `META_APP_SECRET` (or per-platform names) |
| X             | `{APP_URL}/api/oauth/x/callback`                | `X_CLIENT_ID`, `X_CLIENT_SECRET`            |
| LinkedIn      | `{APP_URL}/api/oauth/linkedin/callback`         | `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` |
| Snapchat      | `{APP_URL}/api/oauth/snapchat/callback`         | `SNAPCHAT_CLIENT_ID`, `SNAPCHAT_CLIENT_SECRET` |
| Dropbox       | `{APP_URL}/api/oauth/dropbox/callback`          | `DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET`     |
| Podcast RSS   | — (paste feed URL)                              | —                                          |

Notes that matter in practice: TikTok direct publish needs an audited Content Posting app; Instagram
publishing requires a Business/Creator account linked to a Facebook Page (and a Facebook Login for
Business configuration for resumable uploads); Facebook Reels need a Page you administer and 3–90 s
vertical video; YouTube uploads use a resumable session with a 3-minute/9:16 rule for Shorts;
Google Drive uses `drive.file` so the app only sees files it created or folders you explicitly grant.

Every platform above is free to set up with your own developer account. What is *not* possible for a
private self-hosted app: TikTok public posting (unaudited apps are draft/private-only and app review
excludes personal-use apps) and Snapchat (its Public Profile API is allowlisted to business partners).
A hosted publishing API such as Upload-Post or Ayrshare is the only way to bypass those two
approvals, at a monthly cost.

---

## 5. Engine (Phase 4)

`detect` polls each active workflow on its own interval, applies the media-type, hashtag,
keyword, duration and date-window filters, then inserts a `ContentItem` — the unique
`(workflowId, sourcePostId)` index turns a duplicate into a skip. Auto-publish workflows go
straight to `process`; manual workflows stop at `DETECTED` for review.

`process` downloads with yt-dlp, probes with ffprobe, then renders one MP4 per unique
aspect/fill/duration combination the destinations require (blurred-fill, center-crop or pad,
trim/cap, intro/outro concat, optional `.srt` burn-in), extracts MP3 or renders a waveform
video for audio sources, builds a slideshow for photo carousels, creates a thumbnail with
sharp, and renders captions/titles/first comments per destination. Drip workflows reserve a
`ScheduleSlot` in the workflow timezone; others publish immediately.

`publish` claims each target row atomically, uploads per-destination media, records remote ids
and URLs, and marks the item `PUBLISHED`/`PARTIAL`/`FAILED`. Uploads stream from disk with
`fs.createReadStream` and an exact `Content-Length`, so a multi-GB video never sits in memory.
Uploads are never retried automatically, so a partial failure can't duplicate a post; failures are
retried per target from the queue UI. `maintenance` runs the poll sweep, drip release, token refresh, media
retention cleanup and heartbeat (repeat jobs live only on this queue).

Implemented adapters: **TikTok** (Display API source, or public-profile polling with yt-dlp when no
developer app exists) → **YouTube** (resumable upload, thumbnail,
first comment), **Google Drive** (resumable backup + caption sidecar), **Instagram** (Reels and
Stories) and **Facebook Pages** (Reels). Everything else in the catalogue raises a clear
`UnsupportedProviderError` until its adapter is registered.

Both Meta destinations upload straight from the local file — no public media URL or S3 bucket is
needed:

- **Instagram** creates a resumable container (`upload_type=resumable`), streams the MP4 to
  `rupload.facebook.com`, waits for `status_code=FINISHED`, then calls `media_publish`. It needs a
  Business/Creator account linked to a Facebook Page and the `instagram_content_publish` scope.
  Meta documents resumable uploads for apps using **Facebook Login for Business**.
- **Facebook Pages** uses the three-phase Reels API (`video_reels` start → binary upload → finish
  with `video_state=PUBLISHED`). Facebook only accepts Reels here: 3–90 s, 9:16, and the user needs
  the `CREATE_CONTENT` task on the Page. Long-form targets are rejected with an explicit error.

When a Page has several Instagram accounts or a user administers several Pages, set the workflow
destination's account field (page id, page name or `@username`) — the adapter refuses to guess.

## 6. UI (Phase 5)

Every page is a server component that reads Prisma directly; mutations are server actions, so no
REST surface is exposed besides health and media. Pages render a setup screen instead of crashing
when Postgres is not reachable yet.

| Route          | What it does                                                                                                     |
| -------------- | ---------------------------------------------------------------------------------------------------------------- |
| `/`            | Counts by status, drip slots, last-24h publishes, recent detections, runtime warnings, recent errors.             |
| `/queue`       | Thumbnail cards (hover to enlarge, click for full size), search + hashtag/status/workflow filters, pagination.     |
| `/queue` item  | Publish now, edit title/caption (pushed to every unpublished target), trim start/end, re-run, full error trace.     |
| `/connections` | Saved Client IDs/secrets per platform (encrypted), OAuth connect, test, refresh token, disconnect.                 |
| `/workflows`   | 1-to-many builder: source → filters → media/caption rules → destinations, with per-destination overrides.          |
| `/workflows`   | Toggle active, run poll now, delete; edit page also uploads intro/outro/SRT assets per workflow.                   |
| `/schedule`    | Per-workflow immediate vs drip mode, HH:mm slots, max/day, timezone, upcoming reserved slots.                      |
| `/logs`        | Filter by level/stage/message; open any row for context JSON, duration, job id and stack trace.                    |

## 7. Security & privacy

- No auth, no users, no cookies, no session table: the URL *is* the capability. Put it behind
  Cloudflare Access / Tailscale / an nginx `auth_basic` block if the host is publicly reachable.
- OAuth tokens and API secrets are AES-256-GCM encrypted with a scrypt-derived key from `APP_SECRET`.
  Rotating `APP_SECRET` (or `docker compose down -v`, which deletes the `secrets` volume) makes
  stored tokens unreadable — reconnect accounts afterwards. Back up the `secrets` volume if you care
  about not reconnecting.
- Downloaded media is deleted after a successful publish once `MEDIA_RETENTION_HOURS` passes; the
  shared volume never grows unbounded.
- Only the web container publishes a port. Postgres, Redis and the worker stay on the private
  Compose network.

---

## 8. Roadmap

Phases 1–5 are complete, with free Meta destinations (Instagram Reels/Stories, Facebook Page Reels)
added on top. Natural next steps: LinkedIn, X and Pinterest adapters (each with its own free
developer app and, for video, API access review); an optional hosted-publishing-API adapter for
TikTok/Snapchat; an S3/R2 storage driver; and per-destination queues with independent concurrency.

Storage note: the pipeline writes to the shared media volume (`STORAGE_DRIVER=local`). The S3/R2
driver is reserved for the settings UI; selecting it today fails fast with an explanatory error.
