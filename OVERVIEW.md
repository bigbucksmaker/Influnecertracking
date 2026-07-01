# Influencer Tracking — Full Overview

Internal tool for **Atomik Growth** to vet and monitor X (Twitter) influencers for client
campaigns. It maintains a **shared team watchlist**, builds its own historical time-series of every
account's profile and post metrics, ranks accounts by a composite **Performance Score**, tracks
API spend against a budget, and auto-categorizes creators into niches with AI.

> One shared workspace: everyone on the `@atomikgrowth.com` domain sees the same accounts, the same
> data, and the same settings. There are no per-user watchlists.

- **Live:** https://www.virality.studio
- **Repo:** github.com/bigbucksmaker/Influnecertracking
- **Stack:** Next.js 15 (App Router) · TypeScript · Tailwind · Recharts · Prisma · Postgres (Neon) ·
  Auth.js (Google) · Vercel (hosting + Cron) · twitterapi.io (data) · Anthropic Claude (niches)

---

## Table of contents

1. [The core idea: build your own history](#1-the-core-idea-build-your-own-history)
2. [Auth & access](#2-auth--access)
3. [Data source & cost model (twitterapi.io)](#3-data-source--cost-model-twitterapiio)
4. [Data model](#4-data-model)
5. [Watchlist management](#5-watchlist-management)
6. [Backfill on add](#6-backfill-on-add)
7. [Adaptive polling, freezing & retweet handling](#7-adaptive-polling-freezing--retweet-handling)
8. [Performance Score & metrics](#8-performance-score--metrics)
9. [Leaderboard](#9-leaderboard)
10. [Campaign rates](#10-campaign-rates)
11. [Influencer detail page](#11-influencer-detail-page)
12. [Cost tracking & budget](#12-cost-tracking--budget)
13. [AI niche categorization](#13-ai-niche-categorization)
14. [Settings](#14-settings)
15. [Dashboard](#15-dashboard)
16. [Performance & caching](#16-performance--caching)
17. [Scheduled polling (Cron)](#17-scheduled-polling-cron)
18. [The DataProvider abstraction](#18-the-dataprovider-abstraction)
19. [API routes](#19-api-routes)
20. [Scripts / CLI](#20-scripts--cli)
21. [Environment variables](#21-environment-variables)
22. [Deployment](#22-deployment)
23. [Project structure](#23-project-structure)
24. [Operational notes & gotchas](#24-operational-notes--gotchas)
25. [Out of scope / roadmap](#25-out-of-scope--roadmap)

---

## 1. The core idea: build your own history

twitterapi.io (like the X API) only ever returns a **current snapshot** of a post's views/likes/etc.
There is no "views over time" endpoint. So the app builds its own history:

- On a schedule it fetches each account's **profile** (followers, following, post count) and **recent
  posts** (per-post views, likes, reposts, replies, quotes, bookmarks).
- Every pull is written as a **timestamped snapshot**.
- **All trends are computed from the stored snapshots** — follower growth, view growth, engagement
  over time, week-over-week movers, etc.

Two time series result: one **per account** (profile metrics) and one **per post** (engagement
metrics), both accumulating with every poll.

---

## 2. Auth & access

- **Google OAuth via Auth.js (NextAuth v5)**, JWT session strategy (no DB adapter needed).
- Access is **restricted to the `@atomikgrowth.com` domain** — enforced in the `signIn` callback in
  `auth.ts` (`email.endsWith("@atomikgrowth.com")`). A valid Google login outside the domain is
  rejected.
- `middleware.ts` gates every page: unauthenticated requests are redirected to `/login`. API routes
  do their own checks (`requireUser()` for session routes, `CRON_SECRET` for the cron route).
- **Dev bypass:** set `DEV_AUTH_BYPASS=true` locally to log in as `dev@atomikgrowth.com` without
  Google (a "Dev sign in" button appears on `/login`). Must be `false` in production.
- Configurable domain via `ALLOWED_EMAIL_DOMAIN`.

---

## 3. Data source & cost model (twitterapi.io)

Auth is a single `x-api-key` header (no OAuth). Endpoints used:

| Purpose | Endpoint |
|---|---|
| Profile | `GET /twitter/user/info?userName=` |
| Recent posts | `GET /twitter/user/last_tweets?userName=&cursor=` |
| Backfill (date-bounded) | `GET /twitter/tweet/advanced_search?query=from:USER since_time:… until_time:…` |
| Cheap metric refresh | `GET /twitter/tweets?tweet_ids=a,b,c` |
| Account balance | `GET /oapi/my/info` |

**Credit / cost constants** (hardcoded in `lib/cost.ts`):

- `$1 = 100,000 credits`
- Tweet read = **15 credits** ($0.15 / 1k)
- User profile = **18 credits** ($0.18 / 1k)
- **Minimum 15 credits per request**, even if it returns nothing
- Credits charged per request = `max(15, itemsReturned × perItem)`; balance checks are free.

**Plan tiers** (monthly credit caps, incl. tier bonus):

| Plan | Credits / mo | Price | QPS (calls/sec) |
|---|--:|--:|--:|
| Free | — | — | 3 |
| Starter | 3.13M | $29 | 5 |
| Builder | 11.29M | $99 | 10 |
| **Pro (current)** | **25.07M** | **$199** | **20** |
| Scale | 69.86M | $499 | 50 |
| Business | 224.85M | $1,499 | 500 |

**Rate limiting:** the provider serializes and spaces requests client-side to respect the per-key
QPS limit (`TWITTERAPI_QPS_MS`, ms between requests). Free tier ≈ `5200`; on the current **Pro**
plan it's `50` (20 req/s). Set `0` to disable. 429/5xx are retried with backoff.

---

## 4. Data model

Postgres via Prisma (`prisma/schema.prisma`). Kept portable (no enums / scalar-lists / JSON).

| Table | Purpose |
|---|---|
| **Account** | A tracked X account: `username` (unique, lowercased), `xUserId`, cached profile fields (`displayName`, `profilePicture`, `description`, `isBlueVerified`, `xCreatedAt`), `status` (active/paused), `pollingTier` (active/dormant), `lastPostedAt`, `lastPolledAt`, `backfilledAt`, `addedBy`, and **campaign rates** (`rateQuoteTweet`, `ratePost`, `rateRetweet`, `rateThread`). |
| **AccountSnapshot** | Profile metrics over time: `followers`, `following`, `statusesCount`, `mediaCount`, `favouritesCount`, `capturedAt`, `source`. Unique `(accountId, capturedAt)`. |
| **Post** | One row per tweet: `id` (tweet id), `text`, `postedAt`, `lang`, `isReply`, `url`, `firstSeenAt`, **freeze state** (`isFrozen`, `frozenAt`), `lastMetricsAt`. Retweets are **not** stored. |
| **PostSnapshot** | Per-post metrics over time: `viewCount`, `likeCount`, `retweetCount`, `replyCount`, `quoteCount`, `bookmarkCount`, `engagements` (precomputed), `capturedAt`, `source`. Unique `(postId, capturedAt)`. |
| **ApiCallLog** | Every provider call: `endpoint`, `accountId?`, `purpose`, `itemsReturned`, `creditsCharged`, `estimatedCostUsd`, `ok`, `httpStatus`, `errorMessage`, `durationMs`, `requestedAt`. Powers all cost tracking. |
| **AppSettings** | Single "singleton" row of tunables (weights, plan cap, cadences, freeze window, normalization, includeReplies) **plus** background-poll job state (`pollRunningAt`, `pollDone`, `pollTotal`, `pollFinishedAt`). |
| **Tag** / **AccountTag** | Niche/label tags, many-to-many with accounts. Used both for manual niche tags and AI niches. |

`engagements` is defined once in `lib/engagement.ts` as **likes + reposts + replies + quotes +
bookmarks** and stored on each snapshot so aggregation is cheap.

Deleting an account cascades to its snapshots, posts, and tags.

---

## 5. Watchlist management

The **Watchlist** page (`/accounts`) is the shared roster.

- **Add / import in bulk** — paste handles, `@mentions`, or profile URLs separated by commas,
  spaces, or newlines. `lib/handles.ts` parses and validates them (extracts the handle from URLs,
  strips `@`, lowercases, dedupes, validates `[a-z0-9_]{1,15}`).
- **Tag by niche** on add, or edit a row's tags anytime.
- **Set campaign rates** on add (quote-tweet / post / retweet / thread, USD).
- **Pause / resume** an account (paused accounts aren't polled or ranked).
- **Backfill now** button per account (re-pull last N days).
- **Remove** (hard delete + cascade).
- Table shows avatar, name, tags, current followers, post count, polling tier, backfill status, last
  poll time.

---

## 6. Backfill on add

When a handle is added it's **backfilled with the last N days** (`backfillDays`, default **7**) so its
charts have history immediately:

1. Fetch the profile (`user/info`) → first `AccountSnapshot`, fills the account's profile fields.
2. `advanced_search` with `from:USER since_time:… until_time:…`, paginated (up to 25 pages), to pull
   the date-bounded post history.
3. Ingest posts → `Post` + `PostSnapshot` rows (source `backfill`).
4. Mark `backfilledAt`, set `lastPostedAt` and `pollingTier`.

Every call is logged to `ApiCallLog` (purpose `backfill`) so the one-time cost per influencer is
visible. Accounts added but not yet backfilled (`backfilledAt = null`) are always "due" and get
backfilled on the next poll as a safety net.

---

## 7. Adaptive polling, freezing & retweet handling

Polling is designed to **control the bill** (`lib/polling.ts`).

**Tiering** — accounts aren't all polled at one flat rate:
- **Active** (posted within `activeWindowHours`, default **48h**) → polled every `activePollHours`
  (default **3h**).
- **Dormant** → polled every `dormantPollHours` (default **24h**).
- An account is "due" when `now − lastPolledAt ≥ its tier interval` (or it's never been polled/backfilled).

**A single poll of one account:**
1. Fetch profile → `AccountSnapshot` (source `poll`).
2. Fetch recent posts (`last_tweets`), paginating only as far back as the freeze window (≤3 pages).
3. **Refresh scrolled-off in-window posts** — any not-yet-frozen post newer than the freeze window
   that wasn't in the latest page is refreshed in one cheap batched `tweets?tweet_ids=` call.
4. Update `lastPolledAt`, `lastPostedAt`, and recompute the tier.

**Freezing** — on each poll only posts **newer than `freezeAgeDays`** (default **3 days**) are
re-fetched. Once a post is older, it gets one **final snapshot** and is marked `isFrozen` — the app
stops paying credits to re-read stale posts. Frozen posts still appear in history/charts.

**Retweets are excluded** — a retweet carries the **original author's** metrics, not the influencer's.
Counting them would misattribute other people's reach and double-count self-retweets. Retweets are
detected on ingest (`retweeted_tweet` object or an `RT @…` text prefix) and never stored. Quote
tweets (the influencer's own commentary, with their own reach) **do** count.

**Running a poll:**
- **Manual** — the "Run poll now" button kicks off a **server-side background job** (`runBackgroundPoll`)
  via Next.js `after()`; it returns immediately and continues even if you close the tab. A shared,
  DB-backed heartbeat + progress (`pollRunningAt` / `pollDone` / `pollTotal`) drives a progress bar
  that's consistent across refreshes and across teammates. A lock prevents overlapping runs.
- **Scheduled** — Vercel Cron hits `/api/cron/poll` hourly; it runs the same locked job and only
  polls accounts actually due per their tier.
- **Local** — `npm run poll` (see [Scripts](#20-scripts--cli)).

---

## 8. Performance Score & metrics

Computed in `lib/scoring.ts` over a **trailing 7-day window** (posts *authored* in the last 7 days,
using each post's latest snapshot). Replies and retweets are excluded.

- **Reach** = average views per post.
- **Engagement rate (impressions)** = Σ engagements ÷ Σ impressions.
- Both are **normalized across the tracked set** — **percentile rank** (default) or **z-score** — to
  a 0–100 scale, then combined:
  **`Performance Score = reachWeight·reachNorm + engagementWeight·erNorm`** (weights normalized to
  sum 1; default **50/50**), rounded to one decimal, ranked descending.

**Engagement rate is shown two ways:**
- **ER (impressions)** = engagements ÷ impressions.
- **ER (followers)** = avg engagements per post ÷ current followers.

**Follower growth** is tracked and charted (7d and 30d, absolute + %) as context but is **excluded**
from the score.

**Rising flag & movers** — week-over-week: this week's avg views/post vs the previous week's
(and the same for engagement). An account is "rising" when either jumps **≥ 25%** (`RISING_THRESHOLD`).
The dashboard's "Rising this week" list ranks by WoW view growth.

---

## 9. Leaderboard

`/leaderboard` — a fully sortable, filterable table (`components/LeaderboardTable.tsx`).

- **Columns:** rank, account, Performance Score, followers, follower Δ 7d, follower Δ 30d, avg
  views/post (reach), ER (impressions), ER (followers), posts 7d, **QT Rate**, WoW views (with a
  ▲ rising badge), polling tier, last poll.
- **Sort** by any column (click the header to toggle asc/desc; nulls sort last).
- **Filter** by search (handle/name), niche (any tag), tier, and "rising only."
- **Edit rates inline** — the ✎ button opens a modal to set all four rates (writes via `PATCH`).
- **Export CSV** of the current filtered view (includes rates and all metrics).
- Reads a cached snapshot for speed; edits/mutations refresh it immediately.

---

## 10. Campaign rates

Each account carries four USD rates: **quote-tweet, post, retweet, thread**.

- Initially imported from the roster CSV (`scripts/import-rates.ts`, which parses messy cells like
  `Qt+Com $15` / `$41` / `20$`; non-USD values like `1000 inr` are left blank to edit manually).
- Editable in the leaderboard (✎ modal) and settable on the Watchlist add form.
- The **QT Rate** column is sortable, and all rates are included in the CSV export — so you can weigh
  performance against price when picking creators for a campaign.

---

## 11. Influencer detail page

`/influencer/[username]` (`lib/metrics.ts` + `components/InfluencerCharts.tsx`):

- **Header** — avatar, name, verified badge, tier, tags, bio, follower/following counts, last poll.
- **Stat cards** — Performance Score + rank, followers (+7d %), avg views/post, ER (impressions),
  ER (followers), WoW views.
- **Charts** (7d / 30d toggle):
  - **Follower growth** — line from `AccountSnapshot`s.
  - **Post views (cumulative)** — a **carry-forward** area chart: at each run timestamp it sums each
    post's last-known views, so the line reflects accumulated reach and **never dips when a post
    freezes**.
  - **Engagement rate** — engagements ÷ views over time.
- **Recent posts** — ranked by views, showing views/likes/reposts/replies/quotes/bookmarks + ER per
  post, with a "frozen" badge; each links to the tweet. (Retweets never appear.)

---

## 12. Cost tracking & budget

`/cost` (`lib/cost-summary.ts`) + a widget on the dashboard.

- **This month** — credits used and USD, request count.
- **Projected month-end** — linear run-rate projection from spend so far.
- **Plan cap** — configurable (`planCapCredits`, default **Pro 25.07M**); shows % used and projected
  % of cap, with an **over-budget warning** and a **recommended plan** when projected spend exceeds
  the cap.
- **Breakdowns:** per **endpoint** (profile/recent-tweets/backfill/refresh), per **day** (30-day bar
  chart), per **influencer** (top spenders), and **avg credits per poll** (trailing 7d).
- **Plan tiers table** highlights your current plan and the recommended one for your projected spend.

Everything derives from `ApiCallLog`, so cost is measured, not estimated.

---

## 13. AI niche categorization

`/niches` (`lib/niche.ts`) — derive niche categories from what creators actually post, then auto-tag
everyone. **Uses stored post text, so it costs $0 in twitterapi.io credits** — only a one-time
Anthropic (Claude) cost.

- **Model:** `claude-sonnet-5` via the Anthropic TypeScript SDK, with **structured outputs**
  (json_schema) so responses are guaranteed valid JSON. Needs `ANTHROPIC_API_KEY`.
- **Step 1 — Suggest:** samples a few posts from **every** influencer (not just the most recent/
  prolific), sends them to Claude, and gets back 8–14 proposed niches (name + description).
- **Step 2 — Review & edit:** you rename/add/remove categories. **Only the confirmed names are used.**
- **Step 3 — Apply:** classifies each influencer into 1–3 niches and attaches them as **tags**
  (so they're immediately filterable on the leaderboard). Runs in client-driven batches with a
  progress bar; ignores any category the model invents outside your list.

Post text is sanitized (unpaired surrogate halves from truncated emoji are stripped) so the request
body stays valid JSON. The current roster's 13 niches (e.g., *AI Agents & Productivity Tools*,
*AI Model News & Releases*, *Crypto Giveaways & Engagement Farming*) were derived this way.

---

## 14. Settings

`/settings` — a single shared config (`AppSettings`) applied workspace-wide:

- **Performance Score weights** — reach vs engagement slider; **normalization** (percentile / z-score).
- **Budget** — plan cap (preset tiers or custom credit value).
- **Adaptive polling** — active window (h), active poll interval (h), dormant poll interval (h),
  freeze age (days), backfill window (days).
- **Include replies** in tracking (default off).

Defaults: weights 50/50 · plan cap Pro 25.07M · active window 48h · active poll 3h · dormant poll
24h · freeze 3 days · backfill 7 days · percentile normalization · replies off.

---

## 15. Dashboard

`/` — at-a-glance: tracked accounts, polling-tier split (active/dormant), posts tracked, last poll
time, the **credit-usage widget**, **top performers**, **rising this week**, and a **Run poll now**
button.

---

## 16. Performance & caching

The heavy read aggregations (leaderboard, cost summary, watchlist overview, influencer detail) are
wrapped in `unstable_cache` (`lib/cache.ts`) with a **120-second TTL** and the tag `app-data`, so
tab switches are near-instant instead of re-scanning Postgres each time. Every mutation
(add/remove/tag/rate/settings/poll/niche-apply) calls `revalidateTag("app-data")` to refresh
immediately. The influencer detail page reuses the cached leaderboard for its rank rather than
recomputing the whole set. A global `loading.tsx` gives instant navigation feedback.

---

## 17. Scheduled polling (Cron)

`vercel.json` registers an **hourly** cron on `/api/cron/poll`. Vercel automatically sends
`Authorization: Bearer $CRON_SECRET`, which the route verifies. Adaptive tiering means each hourly
run only touches accounts actually due, so "hourly" ≠ "poll everyone every hour."

> Vercel **Hobby** allows only daily crons + 60s functions; **Pro** allows the hourly schedule +
> 300s — recommended for ~300 accounts. Change the schedule (e.g. `0 */3 * * *`) or the per-tier
> intervals in Settings to dial cadence up or down.

---

## 18. The DataProvider abstraction

The data source sits behind a swappable interface (`lib/provider/`):

- `DataProvider` — `getUserByUsername`, `getUserLatestTweets`, `searchTweets`, `getTweetsByIds`,
  optional `getBalance`. Every method returns a `cost` object so credit logging is uniform.
- `TwitterApiIoProvider` — the concrete implementation (defensive response-envelope handling per the
  official skill, QPS throttle, retries, chunked batch reads).
- `MockProvider` — deterministic fake data (`DATA_PROVIDER=mock`) so the whole app runs with no API
  key, for local dev/tests.
- `getProvider()` chooses based on `DATA_PROVIDER`.

To swap sources later (e.g. a different vendor), implement `DataProvider` and register it — nothing
else changes.

---

## 19. API routes

All under `app/api/` (Node runtime, dynamic). Session routes require a signed-in `@atomikgrowth.com`
user; the cron route requires `CRON_SECRET`.

| Route | Method | Purpose |
|---|---|---|
| `/api/auth/[...nextauth]` | GET/POST | Auth.js handlers |
| `/api/accounts` | GET / POST | list overview / add (+ tags, rates, backfill) |
| `/api/accounts/[id]` | PATCH / DELETE | update status/tags/rates / remove |
| `/api/accounts/[id]/backfill` | POST | backfill one account |
| `/api/poll` | POST | start the server-side background poll |
| `/api/poll/status` | GET | shared poll progress (for the progress bar) |
| `/api/cron/poll` | GET | scheduled poll (CRON_SECRET) |
| `/api/settings` | GET / PATCH | read / update settings (zod-validated) |
| `/api/niches/propose` | POST | AI: propose a niche taxonomy |
| `/api/niches/apply` | POST | AI: classify + tag a batch of influencers |

---

## 20. Scripts / CLI

Run with env loaded (`npm run <script>`), all via `tsx`:

- `npm run dev` / `build` / `start` — Next.js.
- `npm run db:push` — sync schema to the DB. `npm run db:seed` — settings + starter tags.
  `npm run db:studio` — Prisma Studio. `npm run db:reset` — force-reset + seed.
- `npm run poll` — poll due accounts locally. `-- --force` polls all active; `-- --backfill` backfills
  any account missing history.
- `scripts/import.ts` — bulk-import handles from a CSV: `node --import tsx scripts/import.ts "<csv>"
  --tag=Roster [--backfill=N]`.
- `scripts/import-rates.ts` — import campaign rates from the roster CSV.

---

## 21. Environment variables

| Var | What |
|---|---|
| `DATABASE_URL` | Postgres (Neon) pooled connection string |
| `AUTH_SECRET` | Auth.js secret (`openssl rand -base64 32`) |
| `AUTH_TRUST_HOST` | `true` |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Google OAuth client |
| `ALLOWED_EMAIL_DOMAIN` | `atomikgrowth.com` |
| `DEV_AUTH_BYPASS` | `true` locally for the dev login; `false` in prod |
| `DATA_PROVIDER` | `twitterapiio` (real) or `mock` |
| `TWITTERAPI_IO_KEY` | twitterapi.io API key |
| `TWITTERAPI_QPS_MS` | ms between provider requests (Free ≈ 5200, Pro = 50, 0 = off) |
| `CRON_SECRET` | Bearer token Vercel Cron sends to `/api/cron/poll` |
| `ANTHROPIC_API_KEY` | Claude key for the Niches feature |

Secrets live in `.env.local` locally (gitignored) and in Vercel env vars in production. `.env` holds
only `DATABASE_URL` for the Prisma CLI.

---

## 22. Deployment

Postgres in prod, Vercel for hosting + cron. The provider is hardcoded `postgresql`. Full runbook in
**`DEPLOY.md`**; in short:

1. Provision Postgres (Neon free tier or Vercel Postgres); set `DATABASE_URL` (pooled).
2. `npm run db:push` + `npm run db:seed` against it; import the roster (`scripts/import.ts`,
   `scripts/import-rates.ts`).
3. Push to GitHub → import in Vercel → set all env vars (Production + Preview), `DEV_AUTH_BYPASS=false`.
4. Add the Google redirect URI `https://<domain>/api/auth/callback/google`.
5. Set `TWITTERAPI_QPS_MS=50` for the Pro plan. Deploy.

---

## 23. Project structure

```
app/                       # App Router pages + API routes
  page.tsx                 # dashboard
  leaderboard/ accounts/ niches/ cost/ settings/ login/
  influencer/[username]/   # detail page
  api/                     # accounts, poll, cron, settings, niches, auth
components/                # Nav, LeaderboardTable, AccountsManager, charts,
                           # CostWidget, RunPollButton, RatesEditor, NicheManager, ui
lib/
  db.ts                    # Prisma singleton
  provider/                # DataProvider: types, twitterapiio, mock, index
  cost.ts cost-summary.ts  # credit model + spend analytics
  polling.ts ingest.ts     # poll/backfill engine + snapshot writes
  scoring.ts metrics.ts    # Performance Score + detail-page series
  cache.ts settings.ts     # cached reads + app settings
  accounts.ts handles.ts   # watchlist queries + handle parsing
  engagement.ts twitter-time.ts format.ts logging.ts api.ts
  anthropic.ts niche.ts    # Claude client + niche taxonomy/classification
prisma/schema.prisma       # data model
scripts/                   # poll, import, import-rates, seed
auth.ts middleware.ts vercel.json
```

---

## 24. Operational notes & gotchas

- **Neon auto-suspends when idle** — the first query after a lull can time out; retry wakes it.
- **Cache lag** — after an out-of-band DB change (a script, not an in-app action), pages can show
  stale data for up to ~120s until the cache revalidates (in-app mutations refresh instantly).
- **twitterapi.io has two limits** — *credits* (spend) and *QPS* (throughput). A slow poll usually
  means `TWITTERAPI_QPS_MS` is too high for your plan, not a bug.
- **Counts are stored as 32-bit ints** — fine for this domain (< 2.1B views/followers per item).
- **Secrets that passed through chat should be rotated** once set up (Neon password, Google secret,
  twitterapi.io key, Anthropic key) — the app reads them from env, so rotating is a value swap +
  redeploy.

---

## 25. Out of scope / roadmap

- **Audience-quality analysis** (e.g. % US, bot detection) is explicitly out of scope for v1.
- Natural next steps: a niche-breakdown widget on the dashboard (counts per niche → filtered
  leaderboard), rate-vs-performance ("value") scoring, CSV/Sheets export of campaign shortlists, and
  alerting on big movers.
