# virality.studio — X roster overlay (Chrome extension)

A right-hand dashboard on any X profile: when the account is on the tracker's
watchlist you see their metrics instantly (Performance + Value rings, median
views, ER, rates, est. CPM, price position, niches, 4-week sparkline); when
they aren't, one click adds them — backfill runs and the dashboard appears as
soon as the data lands.

Requires the companion endpoint `/api/ext/profile` (shipped with the main app)
and a signed-in virality.studio session in the same Chrome profile.

## Install (Mac, Chrome)

1. Get this `extension/` folder locally (clone the repo, or download it).
2. Open `chrome://extensions` in Chrome.
3. Toggle **Developer mode** (top right).
4. Click **Load unpacked** → select the `extension/` folder.
5. Make sure you're signed in at https://www.virality.studio in the same
   browser profile.
6. Visit any X profile. Tracked creators slide the dashboard in automatically;
   untracked ones show the add card (collapse it to a pill with the — button).

## How it works

- `content.js` watches the URL (X is an SPA), extracts the handle on profile
  pages, and renders a fixed drawer inside a shadow DOM — X's markup and CSS
  never touch it.
- `background.js` makes all tracker requests with your existing session cookie
  (`host_permissions` scope the extension to virality.studio only).
- **Add** posts to the same endpoint the Watchlist page uses
  (`POST /api/accounts`, with backfill), optionally with a QT rate and a niche
  tag, then polls until the account is scored and swaps in the dashboard.

## Options

Extension options page → **Tracker base URL** — point it at
`http://localhost:3000` for local dev or a preview deployment. (The host must
also be listed in `manifest.json` `host_permissions`.)

## Troubleshooting

- **"Signed out" in the panel** — open virality.studio in a tab, sign in,
  then hit ↻ in the panel header.
- **Panel never appears** — check you're on a profile root
  (`x.com/<handle>`), not a status page; reserved paths (home, search,
  notifications…) are deliberately ignored.
- **After adding, "Backfilling…" for more than ~2 minutes** — the account may
  be handle-invalid or the API budget exhausted; check the Watchlist page and
  the Cost page in the tracker.
