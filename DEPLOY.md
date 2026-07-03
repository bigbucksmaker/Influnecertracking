# Deployment runbook (Vercel + Postgres)

The app uses **Postgres (Neon)** in both dev and prod. `DATABASE_URL` is the only
database config — set it in `.env.local` locally and in Vercel env vars for production.

## 1. Get a Postgres database

**Option A — Neon (recommended, free tier):**
1. Go to https://neon.tech → sign up → **New Project**.
2. Copy the **pooled** connection string (Dashboard → Connection Details → toggle
   "Pooled connection"). It looks like:
   `postgresql://USER:PASSWORD@ep-xxx-pooler.REGION.aws.neon.tech/neondb?sslmode=require`
3. Also grab the **direct** (non-pooled) string — handy for one-off `prisma db push`.

**Option B — Vercel Postgres:** In your Vercel project → **Storage → Create Database
→ Postgres**. Vercel auto-adds `DATABASE_URL` (and friends) to the project env.

> Serverless needs a **pooled** connection for the app runtime. Use the pooled URL
> for `DATABASE_URL`. (Neon's pooler handles this; Vercel Postgres does too.)

## 2. Initialize the Postgres schema (once)

From your machine, point at the DB and push the schema + seed defaults:

```bash
export PATH="/opt/homebrew/bin:$PATH"
DATABASE_URL="postgresql://…(direct or pooled)…" npm run db:push
DATABASE_URL="postgresql://…"                    npm run db:seed
```

> **Schema changes on an existing deployment:** whenever a PR touches
> `prisma/schema.prisma`, run `npm run db:push` against the prod `DATABASE_URL`
> **before (or immediately with) the merge** — `db push` is additive-safe for new
> columns/tables and does not touch data. Recent example: `Account.ratesUpdatedAt`
> + the `RateEvent` table (the value-layer audit trail). RateEvent writes are
> best-effort in code, but Account reads fail until `ratesUpdatedAt` exists, so
> push the schema first.

Import the roster into Postgres (creates rows only — cheap):

```bash
DATABASE_URL="postgresql://…" TWITTERAPI_IO_KEY="…" DATA_PROVIDER="twitterapiio" \
  node --import tsx scripts/import.ts "/path/to/X INFLUENCERS TOTAL.csv" --tag=Roster
```

(Backfilling all 313 needs a paid twitterapi.io plan — see the note at the bottom.)

## 3. Deploy to Vercel

1. Push this repo to GitHub, then **Import Project** in Vercel (framework auto-detected
   as Next.js; build command `npm run build` is already correct).
2. Set **Environment Variables** (Production + Preview):

   | Var | Value |
   |---|---|
   | `DATABASE_URL` | your **pooled** Postgres URL |
   | `AUTH_SECRET` | `openssl rand -base64 32` |
   | `AUTH_GOOGLE_ID` | Google OAuth client id |
   | `AUTH_GOOGLE_SECRET` | Google OAuth client secret |
   | `ALLOWED_EMAIL_DOMAIN` | `atomikgrowth.com` |
   | `DEV_AUTH_BYPASS` | `false` |
   | `TWITTERAPI_IO_KEY` | your twitterapi.io key |
   | `TWITTERAPI_QPS_MS` | `5200` free tier · `50` (or `0`) on a paid plan |
   | `CRON_SECRET` | `openssl rand -base64 32` (Vercel sends it to the cron route) |
   | `AUTH_TRUST_HOST` | `true` |

3. In **Google Cloud Console → Credentials → your OAuth client**, add the production
   redirect URI: `https://YOUR-APP.vercel.app/api/auth/callback/google`.
4. Deploy.

## 4. Cron

`vercel.json` registers an **hourly** run of `/api/cron/poll`. Vercel automatically
sends `Authorization: Bearer $CRON_SECRET`, which the route verifies. Adaptive tiering
means each hourly run only polls accounts that are actually *due* (active every few
hours, dormant daily) — so hourly ≠ polling all 313 every hour.

- **Vercel Hobby**: crons run **daily only** and functions cap at **60s** — not enough
  for 313 accounts. **Pro** is required for the hourly schedule + 300s functions.
- To poll fewer times, change the schedule in `vercel.json` (e.g. `"0 */3 * * *"` for
  every 3 hours) or raise the per-tier intervals in **Settings**.

## Important: twitterapi.io plan

You're currently on the **free tier**: **1 request / 5 seconds** and a small bonus
credit balance. That's fine for a demo but impractical for 313 accounts (a full backfill
is ~100k credits and, at 1 req/5s, backfill+polling would take hours).

For production: pick a paid plan (the **Cost** page recommends one from your projected
spend), then set `TWITTERAPI_QPS_MS=50` (or `0`) to lift the client-side throttle. Rough
ongoing cost is shown live on the Cost page once polling runs.
