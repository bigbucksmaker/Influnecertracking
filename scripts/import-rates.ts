import fs from "node:fs";
import { prisma } from "../lib/db";
import { parseHandles } from "../lib/handles";

// Extract a USD amount from a messy rate cell:
//   "Qt+Com $15" → 15 · "QT/Retweet+com = $20" → 20 · "20$" → 20 · "$41" → 41
//   "Qt+Com 1000 inr" → null (non-USD, left blank to edit manually)
function parseRate(cell: string | undefined): number | null {
  if (!cell) return null;
  const s = String(cell);
  const m = s.match(/\$\s*([\d,]+)/) || s.match(/([\d,]+)\s*\$/);
  if (m) return parseInt(m[1].replace(/,/g, ""), 10);
  return null;
}

async function main() {
  const csvPath = process.argv[2];
  if (!csvPath) throw new Error("Pass the CSV path as the first argument.");
  const raw = fs.readFileSync(csvPath, "utf8");
  const lines = raw.split(/\r?\n/).slice(1); // skip header

  let updated = 0;
  let missing = 0;
  let withRate = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    const cols = line.split(","); // cells in this CSV never contain commas
    const handles = parseHandles(cols[0] || "");
    if (!handles.length) continue;
    const username = handles[0];

    const rateQuoteTweet = parseRate(cols[2]); // "Quote Tweet + comment rates"
    const ratePost = parseRate(cols[3]); // "Post"
    const rateRetweet = parseRate(cols[4]); // "Retweet"
    const rateThread = parseRate(cols[5]); // "Threads"
    if (rateQuoteTweet != null) withRate++;

    // Write the audit trail + freshness stamp for any change (value layer
    // reads ratesUpdatedAt; RateEvent is the negotiation history).
    const existing = await prisma.account.findUnique({
      where: { username },
      select: { id: true, rateQuoteTweet: true, ratePost: true, rateRetweet: true, rateThread: true },
    });
    if (!existing) {
      missing++;
      continue;
    }
    const next = { rateQuoteTweet, ratePost, rateRetweet, rateThread };
    const changes = (Object.keys(next) as (keyof typeof next)[])
      .filter((k) => next[k] !== existing[k])
      .map((k) => ({ accountId: existing.id, field: k, oldValue: existing[k], newValue: next[k], changedBy: "import-rates" }));

    await prisma.account.update({
      where: { id: existing.id },
      data: { ...next, ...(changes.length ? { ratesUpdatedAt: new Date() } : {}) },
    });
    if (changes.length) {
      try {
        await prisma.rateEvent.createMany({ data: changes });
      } catch {
        /* RateEvent table may predate `prisma db push` — rate values are still saved */
      }
    }
    updated++;
  }
  console.log(`Updated ${updated} accounts (${withRate} with a quote-tweet rate), ${missing} not found.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
