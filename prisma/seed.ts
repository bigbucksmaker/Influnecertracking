import { prisma } from "../lib/db";
import { DEFAULT_SETTINGS } from "../lib/settings";

async function main() {
  // 1) app settings singleton
  await prisma.appSettings.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton", ...DEFAULT_SETTINGS },
  });

  // 2) a starter set of niche tags (safe to edit/remove in the UI)
  const tags = ["AI", "Crypto", "Web3", "SaaS", "Marketing", "Growth", "Design", "Startups"];
  for (const name of tags) {
    await prisma.tag.upsert({ where: { name }, update: {}, create: { name } });
  }

  console.log(`Seeded app settings + ${tags.length} tags.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
