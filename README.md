# Influencer Tracking — Atomik Growth

Internal tool to vet, **price**, and monitor X (Twitter) influencers for client campaigns. Tracks a
**shared** team watchlist, builds its own time-series history from periodic snapshots, ranks
accounts by a composite **Performance Score**, and — now that roster rates are maintained — computes
a full **value layer**: implied CPM, Value Score (performance per dollar), price-vs-peers
positioning, campaign spend economics, and a budget planner.

Built with Next.js 15 (App Router) + TypeScript + Tailwind + Recharts, Prisma + Postgres (Neon),
Auth.js (Google OAuth, restricted to `@atomikgrowth.com`), Vercel Cron for scheduled polling, and
Anthropic Claude for AI niches + the in-app assistant.

- **Live:** https://www.virality.studio
- **Deep documentation:** [OVERVIEW.md](OVERVIEW.md) · **Deploy runbook:** [DEPLOY.md](DEPLOY.md)

---

## Why snapshots?

twitterapi.io only returns the **current** metrics for a post — there is no historical time-series
endpoint. So the app builds its own history: on a schedule it fetches each account's profile +
recent posts and stores a **timestamped snapshot** of every metric. All trends are computed from
stored snapshots.

---

## The two scores

**Performance Score (0–100, violet)** — trailing 7 days, price-free by design:
- **Reach** = MEDIAN views/post (robust to viral spikes; p25 shown as the floor).
- **Engagement rate** = Σ engagements ÷ Σ impressions.
- Each normalized across the tracked set (percentile default, z-score optional), combined by the
  configurable weights (default 50/50). Replies and retweets excluded. Confidence flags (thin or
  stale data) travel with every row.

**Value Score (0–100, teal)** — what a dollar buys, computed in `lib/value.ts`:
- **Implied CPM** = rate ÷ median organic views × 1,000 (per format: QT, post, thread).
- **Basis** = the QT rate, falling back to the post rate (`valueBasis` says which).
- **Value Score** = percentile blend of views-per-dollar and engagements-per-dollar across all
  priced accounts.
- **Price position** = implied CPM vs niche-peer median (≥3 peers sharing a tag, else the whole
  priced set): ≤0.70× **underpriced** · ≥1.40× **overpriced** · else fair.
- Everything is an estimate from organic medians and inherits the confidence flags. The Performance
  Score and campaign delivery ratios stay price-free — the value layer sits alongside, never inside.

Every rate edit stamps `ratesUpdatedAt` and writes a **RateEvent** audit row (old → new, who, when),
so negotiation history is queryable and stale rates are flagged in the UI after 90 days.

---

## Data model

| Table | Purpose |
|---|---|
| `Account` | Watchlist row: handle, profile cache, status, polling tier, **campaign rates** + `ratesUpdatedAt`. |
| `AccountSnapshot` | Profile metrics over time (followers / following / post count). |
| `Post` | One row per tweet (text, posted-at, freeze state, `commissioned` flag). |
| `PostSnapshot` | Per-post metrics over time (views, likes, reposts, replies, quotes, bookmarks, engagements). |
| `Campaign` / `Placement` | Client campaigns and commissioned posts; delivery measured vs each creator's organic baseline (price-free), plus spend / actual-CPM economics. |
| `Shortlist` / `ShortlistItem` | Saved candidate slates with per-creator economics and slate totals. |
| `RateEvent` | Audit trail of every rate change (negotiation history). |
| `ApiCallLog` | Every provider call with credits charged — powers cost tracking. |
| `AppSettings` | Single-row config: weights, plan cap, polling cadences, freeze windows, thresholds. |
| `Tag` / `AccountTag` | Niche tagging (manual + AI). |

---

## The surfaces

- **Dashboard** — best value, top reach, movers, active campaigns (with spend), needs-attention feed,
  credit budget widget. `⌘K` opens the global command palette from anywhere.
- **Leaderboard** — presets (Top performance / Best value / Rising / Falling), an Economics column
  group (rates, est. CPM, Value ring, price position), column toggles, CSV export.
- **Planner** — give it a budget + format + niche; greedy allocation on views-per-dollar produces a
  slate with totals (cost, expected views, blended CPM), saveable as a shortlist, exportable as CSV.
- **Live post tracking** — paste a launch post the moment it ships: 30s heartbeat (pulse chart of
  views/min), pace, and a quote-tweet amplification feed with roster creators highlighted.
  Server-side rate limiting + a 24h auto-stop keep credits capped; a per-minute cron covers closed
  tabs. Each tracker can mint a **public read-only share link** (no login, revocable, can't spend
  credits) for clients on launch day.
- **Influencer page** — charts (followers, median views per day, ER, view distribution), a rate card
  with per-format implied CPM + price positioning + rate freshness, recent posts.
- **Campaigns** — attach commissioned tweets; delivery vs organic baseline, spend, actual CPM, cost
  per engagement, underdelivery flags.
- **Shortlists** — candidate slates that price themselves (rate, CPM, Value per creator; totals row).
- **Niches** — Claude proposes a taxonomy from stored post text; you approve; it tags everyone. $0 in
  twitterapi.io credits.
- **Cost** — credits used, projections vs plan cap, per-endpoint/day/influencer breakdowns.
- **Ask** — the in-app assistant. Curated tools + read-only SQL; answers "best value under $50 in AI
  niche", "build me a $3k plan" (planBudget tool); write actions require an explicit Confirm click.
- **Chrome extension** ([`extension/`](extension/README.md)) — a dashboard overlay on X profiles:
  tracked creators show their metrics (scores, median views, rates, CPM) in a right-hand drawer;
  untracked ones get a one-click "Track" that adds + backfills, then swaps in the dashboard.
  Served by `GET /api/ext/profile`; load unpacked via `chrome://extensions`.

---

## Local setup

Requires Node 20+.

```bash
npm install
cp .env.example .env.local        # then fill in the blanks
npm run db:push                   # sync schema to Postgres
npm run db:seed                   # default settings + starter tags
npm run dev                       # http://localhost:3000
```

> **Try it with no keys:** set `DATA_PROVIDER=mock` and `DEV_AUTH_BYPASS=true`, then add a few
> handles on the Watchlist page — deterministic fake data makes every chart work.

### Environment variables (`.env.local`)

| Var | What |
|---|---|
| `DATABASE_URL` | Postgres (Neon) pooled connection string |
| `DATABASE_URL_RO` | Optional read-only connection for the assistant's SQL tool |
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `AUTH_TRUST_HOST` | `true` |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Google OAuth client |
| `ALLOWED_EMAIL_DOMAIN` | `atomikgrowth.com` — only this domain may sign in |
| `DEV_AUTH_BYPASS` | `true` locally for a dev login button; `false` in prod |
| `DATA_PROVIDER` | `twitterapiio` (real) or `mock` |
| `TWITTERAPI_IO_KEY` | twitterapi.io API key |
| `TWITTERAPI_QPS_MS` | ms between provider requests (Free ≈ 5200 · Pro = 50 · 0 = off) |
| `CRON_SECRET` | Bearer token the cron route checks |
| `ANTHROPIC_API_KEY` | Claude key for Niches + the assistant |

### Polling (locally)

```bash
npm run poll                 # poll accounts that are due (respects tiers)
npm run poll -- --force      # poll every active account now
npm run poll -- --backfill   # backfill any account still missing history
```

### Cost control (twitterapi.io)

`$1 = 100,000 credits` · tweet read = 15 cr · profile = 18 cr · minimum 15 cr/request.
Adaptive polling keeps the bill down: active accounts poll every few hours, dormant ones daily;
posts older than the freeze window get one final snapshot and are never re-read (commissioned posts
get an extended window). All cadences are Settings.

---

## Deploy

Vercel + Neon; hourly cron on `/api/cron/poll`. Full runbook in **[DEPLOY.md](DEPLOY.md)**.
**Schema changes ship via `npm run db:push` against the prod `DATABASE_URL` — run it before or
immediately with the deploy** (all recent changes are additive: `Account.ratesUpdatedAt`,
`RateEvent`).

## Swapping the data source

Implement the `DataProvider` interface in `lib/provider/types.ts` (see `twitterapiio.ts` /
`mock.ts`) and register it in `lib/provider/index.ts`. Every method returns a `cost` object so cost
logging stays uniform regardless of source.
