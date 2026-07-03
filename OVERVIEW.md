# Influencer Tracking — Full Overview

Internal tool for **Atomik Growth** to vet, **price**, and monitor X (Twitter) influencers for
client campaigns. It maintains a **shared team watchlist**, builds its own historical time-series of
every account's profile and post metrics, ranks accounts by a composite **Performance Score**,
computes a full **value layer** on top of maintained campaign rates (implied CPM, Value Score,
price-vs-peers, budget planning, campaign spend economics), tracks API spend against a budget, and
auto-categorizes creators into niches with AI.

> One shared workspace: everyone on the `@atomikgrowth.com` domain sees the same accounts, the same
> data, and the same settings. There are no per-user watchlists.

- **Live:** https://www.virality.studio
- **Repo:** github.com/bigbucksmaker/Influnecertracking
- **Stack:** Next.js 15 (App Router) · TypeScript · Tailwind · Recharts · Prisma · Postgres (Neon) ·
  Auth.js (Google) · Vercel (hosting + Cron) · twitterapi.io (data) · Anthropic Claude (niches + assistant)

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
9. [The value layer (rates → economics)](#9-the-value-layer-rates--economics)
10. [Budget planner](#10-budget-planner)
11. [Leaderboard](#11-leaderboard)
12. [Influencer detail page](#12-influencer-detail-page)
13. [Campaigns & placements](#13-campaigns--placements)
13b. [Live post tracking (launch ops)](#13b-live-post-tracking-launch-ops)
14. [Shortlists](#14-shortlists)
15. [The Ask assistant](#15-the-ask-assistant)
16. [Dashboard, alerts & command palette](#16-dashboard-alerts--command-palette)
17. [Cost tracking & budget](#17-cost-tracking--budget)
18. [AI niche categorization](#18-ai-niche-categorization)
19. [Settings](#19-settings)
20. [UI design language](#20-ui-design-language)
21. [Performance & caching](#21-performance--caching)
22. [Scheduled polling (Cron)](#22-scheduled-polling-cron)
23. [The DataProvider abstraction](#23-the-dataprovider-abstraction)
24. [API routes](#24-api-routes)
25. [Scripts / CLI](#25-scripts--cli)
26. [Environment variables](#26-environment-variables)
27. [Deployment](#27-deployment)
28. [Project structure](#28-project-structure)
29. [Operational notes & gotchas](#29-operational-notes--gotchas)
30. [Out of scope / roadmap](#30-out-of-scope--roadmap)

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

## 2. Auth & access

- **Google OAuth via Auth.js (NextAuth v5)**, JWT session strategy (no DB adapter needed).
- Access is **restricted to the `@atomikgrowth.com` domain** — enforced in the `signIn` callback in
  `auth.ts`. A valid Google login outside the domain is rejected.
- `middleware.ts` gates every page: unauthenticated requests are redirected to `/login`. API routes
  do their own checks (`requireUser()` for session routes, `CRON_SECRET` for the cron route).
- **Dev bypass:** `DEV_AUTH_BYPASS=true` locally logs in as `dev@atomikgrowth.com` without Google.
  Must be `false` in production. Configurable domain via `ALLOWED_EMAIL_DOMAIN`.

## 3. Data source & cost model (twitterapi.io)

Auth is a single `x-api-key` header. Endpoints used:

| Purpose | Endpoint |
|---|---|
| Profile | `GET /twitter/user/info?userName=` |
| Recent posts | `GET /twitter/user/last_tweets?userName=&cursor=` |
| Backfill (date-bounded) | `GET /twitter/tweet/advanced_search?query=from:USER since_time:… until_time:…` |
| Cheap metric refresh | `GET /twitter/tweets?tweet_ids=a,b,c` |
| Account balance | `GET /oapi/my/info` |

**Credit / cost constants** (hardcoded in `lib/cost.ts`): `$1 = 100,000 credits` · tweet read =
**15 cr** · profile = **18 cr** · **minimum 15 cr/request**. Credits charged per request =
`max(15, itemsReturned × perItem)`; balance checks are free.

**Plan tiers:** Starter 3.13M/$29 · Builder 11.29M/$99 · **Pro 25.07M/$199 (current)** ·
Scale 69.86M/$499 · Business 224.85M/$1,499. Two limits apply: monthly **credits** and per-second
**QPS** (`TWITTERAPI_QPS_MS` spaces requests client-side; Pro = `50`). 429/5xx retried with backoff.

## 4. Data model

Postgres via Prisma (`prisma/schema.prisma`). Kept portable (no enums / scalar-lists / JSON).

| Table | Purpose |
|---|---|
| **Account** | A tracked X account: `username`, cached profile fields, `status`, `pollingTier`, `lastPostedAt/lastPolledAt/backfilledAt`, **campaign rates** (`rateQuoteTweet`, `ratePost`, `rateRetweet`, `rateThread`) + **`ratesUpdatedAt`** (freshness stamp for the value layer). |
| **RateEvent** | Audit trail of every rate change: `field`, `oldValue → newValue`, `changedBy`, `changedAt`. Written by the in-app rate editor and the import script. Negotiation history per creator. |
| **AccountSnapshot** | Profile metrics over time. Unique `(accountId, capturedAt)`. |
| **Post** | One row per tweet: text, `postedAt`, freeze state, **`commissioned`** flag (extended tracking window). Retweets are **not** stored. |
| **PostSnapshot** | Per-post metrics over time, with precomputed `engagements` (likes+reposts+replies+quotes+bookmarks — defined once in `lib/engagement.ts`). |
| **Campaign** | A client campaign grouping placements. |
| **Placement** | One commissioned post: `type`, `priceUsd`, optional linked `postId`. Delivery ratios are price-free; `priceUsd` powers spend / actual-CPM economics. |
| **Shortlist / ShortlistItem** | Saved candidate slates, optionally scoped to a campaign. |
| **ApiCallLog** | Every provider call with credits charged — powers all cost tracking. |
| **AppSettings** | Single-row config (weights, plan cap, cadences, freeze windows, confidence + underdelivery thresholds) plus background-poll job state. |
| **Tag / AccountTag** | Niche tags (manual + AI), many-to-many. |

Deleting an account cascades to its snapshots, posts, tags, placements, shortlist items, and rate
events.

## 5. Watchlist management

The **Watchlist** page (`/accounts`) is the shared roster: bulk add (handles, `@mentions`, or URLs —
parsed by `lib/handles.ts`), tag by niche, set rates on add, pause/resume, per-account backfill,
hard delete. The table shows avatar, tags, followers, post count, tier, backfill status, last poll.

## 6. Backfill on add

Adding a handle backfills the last `backfillDays` (default **7**) so charts have history
immediately: profile → first snapshot; `advanced_search` (paginated, ≤25 pages) → date-bounded post
history; every call logged (purpose `backfill`). Accounts never backfilled are always "due".

## 7. Adaptive polling, freezing & retweet handling

Polling is designed to **control the bill** (`lib/polling.ts`).

- **Tiers:** accounts that posted within `activeWindowHours` (48h) poll every `activePollHours`
  (3h); dormant accounts every `dormantPollHours` (24h).
- **Freezing:** only posts newer than `freezeAgeDays` (3d) are re-fetched. Older posts get one final
  snapshot and are frozen — no more credits. **Commissioned posts** use the extended
  `commissionedFreezeDays` window (14d) and are un-frozen when attached to a campaign.
- **Cheap refresh:** in-window posts that scrolled off the latest page are refreshed in one batched
  `tweets?tweet_ids=` call.
- **Retweets are excluded** (they carry the original author's metrics). Quote tweets count.
- **Runs:** manual "Run poll now" starts a locked, DB-heartbeat background job (progress shared
  across tabs/users); Vercel Cron hits `/api/cron/poll` hourly and only polls what's due;
  `npm run poll` locally.

## 8. Performance Score & metrics

Computed in `lib/scoring.ts` over a **trailing 7-day window** (organic, non-reply posts; latest
snapshot per post). **Price never enters this score.**

- **Reach** = **MEDIAN** views/post (robust to viral spikes; mean kept for reference; p25 = floor;
  consistency = IQR ÷ median → steady/normal/spiky).
- **ER (impressions)** = Σ engagements ÷ Σ impressions (ER vs followers also shown).
- Both normalized across the tracked set (**percentile** default, z-score optional) → weighted blend
  (default 50/50) → **0–100**, ranked.
- **Confidence layer:** `< minPostsForConfidence` posts in-window or data staler than
  `stalePollHours` → `lowConfidence` + reasons, dimmed in every UI and excluded from planner/dashboard
  value picks by default.
- **Movers:** WoW mean views/engagement; ≥ +25% = rising, ≤ −`fallingThreshold` = falling. 4-week
  weekly-median sparkline per row.
- Follower growth (7d/30d) is charted for context but excluded from the score.

## 9. The value layer (rates → economics)

`lib/value.ts` — the roster's rates are maintained and trusted, so the app computes what the team
actually trades on. Boundaries: the Performance Score and campaign delivery ratios stay price-free;
the value layer sits **alongside**, and every value metric inherits the confidence flags.

- **Implied CPM (per format)** = rate ÷ median organic views × 1,000 — for QT, post, and thread
  (retweets carry no native views).
- **Basis** = QT rate, falling back to the post rate (`valueBasis` records which; everything
  downstream labels post-basis rows).
- **Views per dollar** = median views ÷ basis rate; **cost per 1K engagements** = basis rate ÷
  median engagements × 1,000.
- **Value Score (0–100)** = ½ · pct(views/$) + ½ · pct(eng/$), percentile-ranked across all priced
  accounts; `valueRank` = 1..n.
- **Price position** = implied CPM vs the median CPM of **niche peers** (accounts sharing a tag,
  ≥3 required, else the whole priced set): ≤ **0.70×** underpriced · ≥ **1.40×** overpriced · else
  fair. `priceVsPeersPct` carries the exact delta.
- **Rate freshness:** every rate edit stamps `Account.ratesUpdatedAt` and writes `RateEvent` rows;
  the UI hints when rates are > 90 days old.

Surfaced on the leaderboard (Economics column group + Best value preset), the influencer rate card,
shortlists (per-item + slate totals), campaigns (spend, actual CPM), the dashboard (Best value
panel), the planner, and the assistant.

## 10. Budget planner

`/planner` (`lib/planner.ts`, `POST /api/planner`) — "I have $X for this niche; what's the best
slate?"

- Inputs: budget (USD), format (QT / post / thread), optional niche, optional min-median-views
  floor, optional max creators, include-low-confidence toggle (default off).
- Algorithm: rank candidates by **views per dollar** for the chosen format's rate, then walk down
  the list taking **one slot per creator** while the budget allows (greedy knapsack approximation —
  near-optimal at these slot prices).
- Output: the slate with per-creator rate, expected views (their organic median — an estimate,
  before any paid-post uplift/decay), views/$, CPM, ER, Value ring; totals (cost, leftover, expected
  views/engagements, blended CPM); a transparent excluded-count line (no rate / low-confidence / no
  recent posts / below floor / off-niche).
- Actions: **Save as shortlist** (optionally linked to a campaign; items carry planner notes) and
  **CSV export**. The assistant can run the same engine via its `planBudget` tool.

## 11. Leaderboard

`/leaderboard` — fully sortable/filterable (`components/LeaderboardTable.tsx`).

- **Presets:** Top performance · **Best value** (sorts Value, filters to priced) · Rising · Falling.
- **Column groups:** Rank (score + confidence dot) · Reach (median + p25, steadiness) · Engagement ·
  Audience · Momentum (posts 7d, WoW, 4wk sparkline) · **Economics** (QT rate, post rate hidden by
  default, est. CPM with a vs-peers arrow, Value ring, price-position badge hidden by default) ·
  Status.
- Search / niche / tier / direction / priced-only filters; column visibility menu; sticky header +
  identity column; per-row actions (☆ shortlist, ✎ rates).
- **CSV export** of the current view includes all rates + economics fields.
- Deep-linkable: `?preset=value`, `?direction=falling`, `?tag=…`, `?q=…`.

## 12. Influencer detail page

`/influencer/[username]` — header (avatar, badges, tags, bio, follower counts), stat cards
(Performance + rank, **Value Score + rank**, median views, followers, both ERs, **est. CPM**, WoW),
the **Rates & value card** (all four formats with per-format implied CPM, basis marker, price
position vs peers, value rank, cost per 1K engagements, rate freshness + inline ✎ editor), charts
(follower growth, **median views per posting day** — the typical-post trend, gaps on no-post days,
ER over time, and the **view distribution** scatter: every organic post vs the median/p25 bands,
commissioned posts as ◆ markers with delivery multiples), and recent posts ranked by views.

## 13. Campaigns & placements

`/campaigns` (`lib/placements.ts`) — attach commissioned tweets by URL/id; each is ingested once,
flagged `commissioned`, un-frozen, and tracked on the extended window.

- **Delivery (price-free):** views ÷ the creator's **organic baseline** (their 30d median excluding
  commissioned posts). Below `underdeliverThreshold` (0.7×) = underdelivered. Distribution bars per
  placement; median delivery per campaign.
- **Economics (actuals):** per placement, **actual CPM** = price ÷ delivered views × 1K and cost per
  engagement; per campaign, **total spend**, **blended CPM** and **cost/engagement** over
  priced+linked placements only (unpriced views never flatter the CPM).
- Campaign list shows spend + actual CPM columns; underdelivery alerts include the price paid.

## 13b. Live post tracking (launch ops)

`/live` (`lib/live.ts`) — minute-by-minute telemetry for a launch post while the roster amplifies
it. Paste the post's URL the moment it ships; the panel shows a Bloomberg-style readout:

- **Ticker** — views, engagements, likes, reposts, replies, quotes, bookmarks, ER, each with a
  trailing-5-minute delta.
- **Pace** — views/min and engagements/min over trailing 5m and 15m windows.
- **Charts** — views since tracking started, plus a velocity chart (new views/engagements per tick).
- **Quote-tweet feed** — `advanced_search quoted_tweet_id:<id>` runs every ~4 minutes to discover
  amplifiers; **roster creators are highlighted**, with a combined-QT-views roll-up. Known QTs get
  their metrics refreshed in the same batched read as the main post.
- **Controls** — stop/resume, label, optional campaign link, configurable auto-stop window.

Mechanics & cost design:
- A tick = one batched `tweets?tweet_ids=` read (main post + ≤19 recent QTs → ≤300 credits ≈ $0.003).
- The open panel refreshes every 30s; **server-side rate-limiting (`intervalSec`, floor 30s) means
  any number of open tabs cost at most one provider call per interval** (tick claims are atomic).
- A per-minute Vercel cron (`/api/cron/live`) keeps trackers ticking when no tab is open.
- **`maxDurationMin` auto-stops every tracker** (default 24h) so a forgotten tracker cannot bleed
  credits. Snapshots land in `PostSnapshot` (source `live`), so the post's history persists after
  the tracker stops. All calls are logged to `ApiCallLog` (purposes `live` / `live_quotes`).

Tables: `LiveTracker` (status, interval, auto-stop window, last tick/quote-check) and `LiveQuote`
(the amplification feed, `isRoster` flagged, unique per tracker+tweet).

## 14. Shortlists

`/shortlists` (`lib/shortlists.ts`) — saved candidate slates, optionally campaign-scoped. Each item
carries performance (score, median, steadiness, ER) **and economics** (basis rate, implied CPM,
Value ring, price position). The footer prices the slate: **total cost, expected views, blended
CPM**, priced/unpriced counts. CSV export includes both layers + a totals line. Items can be added
from the leaderboard (☆), by handle, via the planner's save action, or by the assistant (with
confirmation).

## 15. The Ask assistant

The floating **Ask** widget (`components/AskWidget.tsx`, `app/api/chat/*`, `lib/assistant/*`) is a
Claude-powered analyst over the app's own read models.

- **Curated tools:** queryLeaderboard (niche/direction/tier/min-views/**max-QT-rate/price-position**
  filters, sortable by **valueScore**), getCreator, compareCreators, listMovers, listNiches,
  listCampaigns (delivery + economics), listShortlists, **planBudget** (the planner engine),
  costSummary.
- **runSql:** SELECT-only fallback against Postgres (guarded, LIMIT enforced; optional
  `DATABASE_URL_RO`), for questions the curated tools can't express — including RateEvent history.
- **Write actions** (addToShortlist, runPoll) surface as **Confirm buttons** in the widget; nothing
  executes until clicked.
- The system prompt (`lib/assistant/prompt.ts`) enforces: every number from a tool result; median
  over mean; announce low-confidence; label value metrics as estimates from organic medians.

## 16. Dashboard, alerts & command palette

`/` — stat strip (tracked / active / dormant / **priced** / last poll), then: **Best value** (top
high-confidence Value Scores with basis rate + est. CPM), **Top by median reach**, **Movers**
(risers + decliners with sparklines), **Active campaigns** (delivery + spend + blended CPM),
**Needs attention**, and a **planner cross-link**. The credit-usage widget sits below.

**Needs attention** (`lib/alerts.ts`) ranks: underdelivering commissioned posts (with price paid) →
falling accounts → low-confidence scores → dormant accounts; each account appears once at its
highest severity.

**Command palette** — `⌘K` anywhere (mounted globally from the layout, trigger in the sidebar):
jump to any creator or campaign, run a poll, open any page.

## 17. Cost tracking & budget

`/cost` (`lib/cost-summary.ts`) — credits + USD this month, linear month-end projection, % of plan
cap with over-budget warning and a recommended plan, per-endpoint / per-day / per-influencer
breakdowns, avg credits per poll. Everything derives from `ApiCallLog`, so cost is measured, never
estimated.

## 18. AI niche categorization

`/niches` (`lib/niche.ts`) — Claude (structured outputs) proposes 8–14 niches from sampled stored
post text ($0 in twitterapi.io credits), you review/edit, then it classifies each creator into 1–3
of the **confirmed** niches and attaches them as tags (immediately filterable everywhere). Post text
is sanitized against unpaired surrogates so request bodies stay valid JSON.

## 19. Settings

`/settings` — shared workspace config: score weights + normalization; plan cap; adaptive polling
cadences (active window/interval, dormant interval, freeze age, backfill days); confidence
thresholds (min posts, stale hours) and falling threshold; commissioned freeze window and
underdeliver threshold; include-replies toggle.

## 20. UI design language

Operator-terminal dark theme, defined entirely by semantic tokens in `tailwind.config.ts` +
`app/globals.css` (change tokens → whole app re-themes):

- **Dual accents:** violet (`accent`) = performance/navigation; teal (`money`) = the value layer —
  rates, CPM, Value Score, spend. The distinction is consistent app-wide.
- **Glass surfaces** (translucent panels with top hairline highlights + backdrop blur), an ambient
  fixed background glow, refined shadows and glow rings, `fade-up` micro-animations, shimmer
  skeletons.
- **Instrument components** (`components/ui.tsx`): Card, StatCard (accent hairlines), Badge,
  ProgressBar (gradient), Avatar, Sparkline, **ScoreRing** (radial 0–100 meter, violet/teal,
  dimmed when low-confidence), **DeltaChip**, PageHeader (eyebrow support), EmptyState.
- Inter (UI) + JetBrains Mono (all numerics, tabular) via next/font. Dark Recharts tooltips shared
  from `TOOLTIP_STYLE`. Keyboard-only focus rings. `prefers-reduced-motion` respected.

## 21. Performance & caching

Heavy read aggregations (leaderboard incl. economics, cost summary, watchlist overview, influencer
detail, campaigns, shortlists) are wrapped in `unstable_cache` (`lib/cache.ts`) with a 120s TTL and
tag `app-data`; every mutation calls `revalidateTag`. **Cache-key version `V` must be bumped whenever
a cached shape changes** (Vercel's Data Cache persists across deploys) — currently `v3` (economics
fields). The influencer page reuses the cached leaderboard for rank; a global `loading.tsx` gives
instant navigation feedback.

## 22. Scheduled polling (Cron)

`vercel.json` registers an hourly cron on `/api/cron/poll` plus a **per-minute cron on
`/api/cron/live`** for launch-post trackers (Vercel sends `Authorization: Bearer $CRON_SECRET` to
both). Adaptive tiering means each poll run only touches accounts actually due; the live cron
no-ops unless a tracker is live and due. Vercel Hobby = daily crons + 60s functions; **Pro**
(minute-level crons + 300s) required for this schedule.

## 23. The DataProvider abstraction

`lib/provider/` — `DataProvider` interface (`getUserByUsername`, `getUserLatestTweets`,
`searchTweets`, `getTweetsByIds`, optional `getBalance`), every method returning a `cost` object.
`TwitterApiIoProvider` (defensive envelope handling, QPS throttle, retries, chunked batch reads) and
`MockProvider` (deterministic fake data, `DATA_PROVIDER=mock`). Swap sources by implementing the
interface and registering it in `lib/provider/index.ts`.

## 24. API routes

All under `app/api/` (Node runtime, dynamic). Session routes require a signed-in domain user; the
cron route requires `CRON_SECRET`.

| Route | Method | Purpose |
|---|---|---|
| `/api/auth/[...nextauth]` | GET/POST | Auth.js handlers |
| `/api/accounts` | GET / POST | list overview / add (+ tags, rates, backfill) |
| `/api/accounts/[id]` | PATCH / DELETE | update status/tags/**rates (writes RateEvent + ratesUpdatedAt)** / remove |
| `/api/accounts/[id]/backfill` | POST | backfill one account |
| `/api/planner` | POST | **budget allocation (zod-validated)** |
| `/api/live` · `/api/live/[id]` | GET/POST · GET/PATCH/DELETE | live trackers: list/start · payload/stop-resume/delete |
| `/api/live/[id]/tick` | POST | one measurement cycle + fresh panel payload (rate-limited) |
| `/api/cron/live` | GET | per-minute cron tick for all live trackers (CRON_SECRET) |
| `/api/campaigns` · `/api/campaigns/[id]` | GET/POST · PATCH/DELETE | campaigns CRUD |
| `/api/placements` · `/api/placements/[id]` | POST · DELETE | attach / detach commissioned posts |
| `/api/shortlists` | GET / POST | list / create (**optional `items[]` bulk seed** — used by the planner) |
| `/api/shortlists/[id]` · `[id]/items` · `items/[itemId]` | DELETE · POST · DELETE | shortlist items |
| `/api/chat` · `/api/chat/act` | POST | the Ask assistant (stream + confirmed write actions) |
| `/api/poll` · `/api/poll/status` | POST · GET | background poll + shared progress |
| `/api/cron/poll` | GET | scheduled poll (CRON_SECRET) |
| `/api/settings` | GET / PATCH | read / update settings (zod-validated) |
| `/api/niches/propose` · `/api/niches/apply` | POST | AI niche taxonomy / classification |

## 25. Scripts / CLI

Run with env loaded (`npm run <script>`), all via `tsx`:

- `npm run dev` / `build` / `start` — Next.js. `npm run db:push` / `db:seed` / `db:studio` / `db:reset`.
- `npm run poll` — poll due accounts (`-- --force` all active; `-- --backfill` missing history).
- `scripts/import.ts` — bulk-import handles from a CSV (`--tag=Roster [--backfill=N]`).
- `scripts/import-rates.ts` — import campaign rates from the roster CSV (parses messy cells like
  `Qt+Com $15` / `20$`; non-USD left blank). **Writes RateEvent rows + `ratesUpdatedAt`** for any
  change.

## 26. Environment variables

| Var | What |
|---|---|
| `DATABASE_URL` | Postgres (Neon) pooled connection string |
| `DATABASE_URL_RO` | Optional read-only Postgres URL for the assistant's SQL tool |
| `AUTH_SECRET` / `AUTH_TRUST_HOST` | Auth.js secret / `true` |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Google OAuth client |
| `ALLOWED_EMAIL_DOMAIN` | `atomikgrowth.com` |
| `DEV_AUTH_BYPASS` | `true` locally for the dev login; `false` in prod |
| `DATA_PROVIDER` | `twitterapiio` (real) or `mock` |
| `TWITTERAPI_IO_KEY` / `TWITTERAPI_QPS_MS` | twitterapi.io key / request spacing (Pro = 50) |
| `CRON_SECRET` | Bearer token Vercel Cron sends to `/api/cron/poll` |
| `ANTHROPIC_API_KEY` | Claude key for Niches + the assistant |

## 27. Deployment

Vercel + Neon. Full runbook in **`DEPLOY.md`**; in short: provision Postgres, `npm run db:push` +
`db:seed`, import the roster + rates, push to GitHub → import in Vercel → set env vars
(`DEV_AUTH_BYPASS=false`), add the prod Google redirect URI, `TWITTERAPI_QPS_MS=50`, deploy.

> **Schema changes ship with `npm run db:push` against the prod `DATABASE_URL`, run before or
> immediately with the deploy.** Recent additive changes: `Account.ratesUpdatedAt`, `RateEvent`.
> The app degrades gracefully if RateEvent lags (writes are best-effort), but any Account read fails
> until `ratesUpdatedAt` exists — so push the schema first.

## 28. Project structure

```
app/                       # App Router pages + API routes
  page.tsx                 # dashboard
  leaderboard/ planner/ live/ campaigns/ shortlists/ accounts/ niches/ cost/ settings/ login/
  influencer/[username]/   # detail page
  api/                     # accounts, planner, live, campaigns, placements, shortlists,
                           # chat, poll, cron (poll + live), settings, niches, auth
components/                # Nav, CommandPalette, LeaderboardTable, BudgetPlanner, RateCard,
                           # LivePanel, LiveTrackersManager, CampaignsManager, CampaignDetail,
                           # ShortlistsManager, AddToShortlist, AccountsManager, InfluencerCharts,
                           # CostWidget, CostDailyChart, AskWidget, RunPollButton, RatesEditor,
                           # NicheManager, SettingsForm, ui
lib/
  db.ts                    # Prisma singleton (Neon cold-start retry)
  provider/                # DataProvider: types, twitterapiio, mock, index
  cost.ts cost-summary.ts  # credit model + spend analytics
  polling.ts ingest.ts     # poll/backfill engine + snapshot writes
  scoring.ts stats.ts      # Performance Score + shared statistics
  value.ts planner.ts      # the value layer + budget allocation
  live.ts                  # launch-post live tracking (ticks, quote discovery)
  placements.ts            # campaign delivery + spend economics
  shortlists.ts alerts.ts  # slates with totals + needs-attention feed
  metrics.ts               # influencer detail series
  cache.ts settings.ts     # cached reads (bump V on shape changes) + app settings
  accounts.ts handles.ts   # watchlist queries + handle/tweet-id parsing
  engagement.ts twitter-time.ts format.ts logging.ts api.ts
  anthropic.ts niche.ts    # Claude client + niche taxonomy/classification
  assistant/               # prompt, tools (incl. planBudget), sql guard
prisma/schema.prisma       # data model (incl. RateEvent)
scripts/                   # poll, import, import-rates, seed
auth.ts middleware.ts vercel.json
```

## 29. Operational notes & gotchas

- **Neon auto-suspends when idle** — first query after a lull can time out; retry wakes it.
- **Cache lag** — out-of-band DB changes (scripts) can show stale for up to ~120s; in-app mutations
  refresh instantly. **Bump `V` in `lib/cache.ts` whenever a cached shape changes.**
- **twitterapi.io has two limits** — credits (spend) and QPS (throughput). A slow poll usually means
  `TWITTERAPI_QPS_MS` is too high for the plan.
- **Value metrics are estimates** — implied CPM and expected views come from organic medians; paid
  posts can land above or below. Low-confidence rows are dimmed and excluded from planner/dashboard
  picks by default; don't quote their CPMs.
- **Rate hygiene** — the UI flags rates older than 90 days; re-confirm before quoting a client.
  RateEvent keeps the full negotiation history (`SELECT * FROM "RateEvent" WHERE "accountId" = …`).
- **Counts are 32-bit ints** — fine for this domain.
- **Secrets that passed through chat should be rotated** (Neon password, Google secret,
  twitterapi.io key, Anthropic key) — env-only, so rotating is a value swap + redeploy.

## 30. Out of scope / roadmap

- **Audience-quality analysis** (% US, bot detection) remains out of scope.
- Natural next steps: niche-level value benchmarks on the dashboard (median CPM per niche),
  rate-change alerts ("@x raised QT 40%"), planner v2 (multi-slot per creator, per-niche quotas,
  frequency caps), campaign expected-vs-actual forecasting from planner slates, and Sheets export.
