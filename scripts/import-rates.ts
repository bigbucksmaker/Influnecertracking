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

    const res = await prisma.account.updateMany({
      where: { username },
      data: { rateQuoteTweet, ratePost, rateRetweet, rateThread },
    });
    if (res.count > 0) updated++;
    else missing++;
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
