import { prisma } from "../lib/db";
import { getProvider } from "../lib/provider";
import { pollAllDue, backfillPending } from "../lib/polling";
import type { PollRunSummary } from "../lib/polling";

function printSummary(s: PollRunSummary) {
  console.log(
    `\n  accounts run: ${s.accountsRun}/${s.accountsConsidered}  ·  ok ${s.ok}  ·  failed ${s.failed}`,
  );
  console.log(
    `  posts: ${s.posts}  ·  snapshots: ${s.snapshots}  ·  credits: ${s.credits.toLocaleString()} ($${(
      s.credits / 100000
    ).toFixed(2)})`,
  );
  for (const r of s.results) {
    const tag = r.ok ? "✓" : "✗";
    const err = r.error ? `  — ${r.error}` : "";
    console.log(`   ${tag} @${r.username} [${r.mode}] posts=${r.posts} credits=${r.credits}${err}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const doBackfill = args.includes("--backfill");

  console.log(`Provider: ${getProvider().name}`);

  if (doBackfill) {
    console.log("Backfilling accounts with no history…");
    printSummary(await backfillPending());
  } else {
    console.log(force ? "Polling ALL active accounts…" : "Polling due accounts…");
    printSummary(await pollAllDue({ force }));
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
