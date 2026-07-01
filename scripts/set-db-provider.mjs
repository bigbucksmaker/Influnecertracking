// Sets the Prisma datasource provider based on DATABASE_URL, so the same schema
// works on SQLite locally (file:...) and Postgres on Vercel (postgres://...).
// Runs before `prisma generate` / `prisma db push` (see package.json).
import { readFileSync, writeFileSync } from "node:fs";

const url = process.env.DATABASE_URL || "";
const provider = /^postgres(ql)?:/i.test(url) ? "postgresql" : "sqlite";

const path = new URL("../prisma/schema.prisma", import.meta.url);
const src = readFileSync(path, "utf8");
const next = src.replace(/provider = "(sqlite|postgresql)"/, `provider = "${provider}"`);
if (next !== src) writeFileSync(path, next);
console.log(`[set-db-provider] datasource provider = ${provider}`);
