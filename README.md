# Influencer Tracking — Atomik Growth

Internal tool to vet and monitor X (Twitter) influencers for client campaigns. Tracks a **shared**
team watchlist of X accounts, builds its own time-series history from periodic snapshots, and ranks
accounts by a composite **Performance Score**.

Built with Next.js (App Router) + TypeScript + Tailwind + Recharts, Prisma + SQLite (dev) / Postgres
(prod), Auth.js (Google OAuth, restricted to `@atomikgrowth.com`), and Vercel Cron for scheduled polling.

Data source: [twitterapi.io](https://docs.twitterapi.io) (single `x-api-key` header), wrapped behind a
swappable `DataProvider` interface.

---

## Why snapshots?

twitterapi.io only returns the **current** metrics for a post — there's no historical time-series
endpoint. So this app builds its own history: on a schedule it fetches each account's profile + recent
posts and stores a **timestamped snapshot** of every metric. All trends are computed from stored
snapshots.

---

## Data model

| Table | Purpose |
|---|---|
| `Account` | The watchlist row (handle, profile cache, status, polling tier). |
| `AccountSnapshot` | Profile metrics over time (followers / following / post count). |
| `Post` | One row per tweet (text, posted-at, **freeze state**). |
| `PostSnapshot` | Per-post metrics over time (views, likes, reposts, replies, quotes, bookmarks, engagements). |
| `ApiCallLog` | Every provider call: endpoint, items, **credits charged**, timestamp — powers cost tracking. |
| `AppSettings` | Single-row config: score weights, plan cap, polling cadences, freeze window. |
| `Tag` / `AccountTag` | Niche tagging (many-to-many). |

The schema avoids enums / scalar-lists / JSON columns so it runs unchanged on **SQLite and Postgres**.

---

## Local setup

Requires Node 20+ (installed here via Homebrew: `/opt/homebrew/bin` — add it to your PATH).

```bash
npm install
cp .env.example .env.local        # then fill in the blanks (see below)
npm run db:push                   # create the SQLite schema
npm run db:seed                   # default settings + starter tags
npm run dev                       # http://localhost:3000
```

### Environment variables (`.env.local`)

| Var | What |
|---|---|
| `DATABASE_URL` | `file:./dev.db` locally. Postgres URL in prod. |
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Google OAuth client (see below). |
| `ALLOWED_EMAIL_DOMAIN` | `atomikgrowth.com` — only this domain may sign in. |
| `DEV_AUTH_BYPASS` | `true` for a local "Dev sign in" button before Google is wired up. Set `false` for real auth. |
| `TWITTERAPI_IO_KEY` | Your twitterapi.io key (dashboard → API key). |
| `DATA_PROVIDER` | `twitterapiio` (real) or `mock` (deterministic fake data, no key needed). |
| `CRON_SECRET` | Bearer token the cron route checks; Vercel injects it automatically on scheduled runs. |

> **Try it with no keys:** set `DATA_PROVIDER=mock` and `DEV_AUTH_BYPASS=true`, then add a few
> handles on the Watchlist page — the app fills in realistic, stable fake data so every chart works.

### Google OAuth

1. Google Cloud Console → APIs & Services → Credentials → **Create OAuth client ID** (Web application).
2. Authorized redirect URIs:
   - `http://localhost:3000/api/auth/callback/google`
   - `https://YOUR-APP.vercel.app/api/auth/callback/google`
3. Put the client id/secret in `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`.
4. Domain restriction is enforced in `auth.ts` (`signIn` callback) — even a valid Google login is
   rejected unless the email ends in `@atomikgrowth.com`.

---

## Using it

- **Watchlist** — add handles (comma/space/newline separated, `@handles` or profile URLs OK), tag by
  niche, pause, remove. Adding a handle **backfills the last 7 days** of posts immediately (logged as
  a one-time credit cost) so its charts have history right away.
- **Leaderboard** — sortable/filterable table of every metric. Click any column to sort; filter by
  niche/tier/rising; export the current view to CSV.
- **Influencer page** — follower / post-view / engagement charts (7d & 30d) + recent posts ranked by
  performance. Engagement rate is shown two ways: ÷ impressions and ÷ followers.
- **Cost** — credits used this month, projected month-end, % of cap, per-endpoint / per-day /
  per-influencer breakdowns, and a plan recommendation.
- **Settings** — score weights (reach vs engagement), plan cap, polling cadences, freeze window.

### Polling (locally)

```bash
npm run poll                 # poll accounts that are due (respects tiers)
npm run poll -- --force      # poll every active account now
npm run poll -- --backfill   # backfill any account still missing history
```

### Performance Score

Trailing 7-day window per account:

- **Reach** = average views per post.
- **Engagement rate** = Σ engagements ÷ Σ impressions (engagements = likes + reposts + replies +
  quotes + bookmarks).

Each is normalized across the tracked set (percentile by default, or z-score) → combined
`reachWeight · reach + engagementWeight · engagement` → **0–100**. Default weights 50/50, adjustable
in Settings. Follower growth is tracked and charted for context but **excluded** from the score.

### Adaptive polling & freezing (controls your bill)

- **Tiers:** accounts that posted within the *active window* (default 48h) poll every few hours;
  dormant accounts poll once daily.
- **Freezing:** on each poll only posts newer than the *freeze age* (default 3 days) are re-fetched.
  Once older, a post gets one final snapshot and is frozen — no more credits spent re-reading it.
- **Cheap refresh:** in-window posts that scroll off the latest page are refreshed in a single batched
  `tweets?tweet_ids=` call rather than paginating.

All cadences and windows are Settings, so you can dial cost up or down without code changes.

### Cost model (hardcoded constants)

`$1 = 100,000 credits` · tweet read = 15 cr · user profile = 18 cr · minimum 15 cr/request.
Plan caps: Starter 3.13M · **Builder 11.29M (default)** · Pro 25.07M · Scale 69.86M.

---

## Deploy to Vercel

See **[DEPLOY.md](DEPLOY.md)** for the full step-by-step runbook. In short:

1. Push to GitHub, import into Vercel.
2. Provision Postgres (Neon free tier or Vercel Postgres). **No schema edit needed** — the provider
   auto-switches to `postgresql` when `DATABASE_URL` is a Postgres URL (`scripts/set-db-provider.mjs`).
   Run `npm run db:push` + `npm run db:seed` against the prod `DATABASE_URL`.
3. Set all env vars in Vercel (Production + Preview); set `DEV_AUTH_BYPASS=false`. Add the prod Google
   redirect URI.
4. `vercel.json` registers an **hourly** cron hitting `/api/cron/poll`. Adaptive tiering means each run
   only polls accounts actually due, so hourly is cheap. (Vercel **Hobby** = daily crons only + 60s
   functions; **Pro** allows the hourly schedule + 300s — recommended for 300 accounts.)

---

## Swapping the data source

Implement the `DataProvider` interface in `lib/provider/types.ts` (see `twitterapiio.ts` /
`mock.ts`) and register it in `lib/provider/index.ts`. Every method returns a `cost` object so cost
logging stays uniform regardless of source.
