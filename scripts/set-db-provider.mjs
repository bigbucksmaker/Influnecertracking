// Sets the Prisma datasource provider based on DATABASE_URL, so the same schema
// works on SQLite locally (file:...) and Postgres on Vercel (postgres://...).
// Runs before `prisma generate` / `prisma db push` (see package.json).
// Reads DATABASE_URL from the process env first (Vercel), then falls back to
// .env.local / .env (local dev, which a bare `node` doesn't auto-load).
import { readFileSync, writeFileSync } from "node:fs";

function fromEnvFiles() {
  for (const f of [".env.local", ".env"]) {
    try {
      const txt = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
      const m = txt.match(/^\s*DATABASE_URL\s*=\s*(.*)\s*$/m);
      if (m) {
        let v = m[1].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
          v = v.slice(1, -1);
        }
        if (v) return v;
      }
    } catch {
      /* file missing — ignore */
    }
  }
  return "";
}

const url = process.env.DATABASE_URL || fromEnvFiles();
const provider = /^postgres(ql)?:/i.test(url) ? "postgresql" : "sqlite";

const path = new URL("../prisma/schema.prisma", import.meta.url);
const src = readFileSync(path, "utf8");
const next = src.replace(/provider = "(sqlite|postgresql)"/, `provider = "${provider}"`);
if (next !== src) writeFileSync(path, next);
console.log(`[set-db-provider] datasource provider = ${provider}`);
