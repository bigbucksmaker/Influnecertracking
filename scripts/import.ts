import fs from "node:fs";
import { prisma } from "../lib/db";
import { parseHandles } from "../lib/handles";
import { upsertTags } from "../lib/accounts";
import { backfillAccount } from "../lib/polling";
import { getProvider } from "../lib/provider";

// Usage: node --import tsx scripts/import.ts "<csv path>" [--tag=Roster] [--backfill=N]
async function main() {
  const csvPath = process.argv[2];
  if (!csvPath) throw new Error("Pass the CSV path as the first argument.");
  const tagArg = process.argv.find((a) => a.startsWith("--tag="));
  const tagName = tagArg ? tagArg.split("=")[1] : "Roster";
  const bfArg = process.argv.find((a) => a.startsWith("--backfill="));
  const backfillN = bfArg ? parseInt(bfArg.split("=")[1], 10) : 0;

  const raw = fs.readFileSync(csvPath, "utf8");
  const lines = raw.split(/\r?\n/).slice(1); // skip header row
  const handleSet = new Set<string>();
  for (const line of lines) {
    if (!line.trim()) continue;
    const firstCol = line.split(",")[0]; // column A = profile URL (never contains commas)
    for (const h of parseHandles(firstCol)) handleSet.add(h);
  }
  const handles = [...handleSet];
  console.log(`Parsed ${handles.length} unique handles from ${lines.filter((l) => l.trim()).length} rows.`);

  const [tagId] = await upsertTags([tagName]);
  let created = 0;
  let skipped = 0;
  const createdIds: { id: string; username: string }[] = [];
  for (const username of handles) {
    const existing = await prisma.account.findUnique({ where: { username } });
    if (existing) {
      skipped++;
      continue;
    }
    const a = await prisma.account.create({
      data: {
        username,
        status: "active",
        addedBy: "csv-import",
        tags: { create: [{ tag: { connect: { id: tagId } } }] },
      },
    });
    created++;
    createdIds.push({ id: a.id, username });
  }
  console.log(`Created ${created}, skipped ${skipped} (already tracked). Tag: "${tagName}".`);

  if (backfillN > 0) {
    console.log(`\nProvider: ${getProvider().name}. Backfilling first ${backfillN} new accounts…`);
    let credits = 0;
    for (const c of createdIds.slice(0, backfillN)) {
      const r = await backfillAccount(c.id);
      credits += r.credits;
      console.log(`  @${c.username}: ok=${r.ok} posts=${r.posts} credits=${r.credits} ${r.error ?? ""}`);
    }
    console.log(`\nBackfill credits used: ${credits.toLocaleString()} ($${(credits / 100000).toFixed(3)})`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
