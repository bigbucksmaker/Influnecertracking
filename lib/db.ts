import { PrismaClient } from "@prisma/client";

// Transient errors worth retrying: Neon auto-suspends when idle, so the first
// query after a lull can fail to connect (P1001) or hit a dropped/closing pooled
// connection. A few short retries wake it transparently instead of surfacing a
// server error to the user. (No interactive transactions are used, so retrying
// a single operation is safe.)
const TRANSIENT =
  /P1001|P1002|P1008|P1017|Can't reach database|Closed|Connection|ECONNRESET|terminating connection|Server has closed|timed out/i;

function createClient() {
  const base = new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
  return base.$extends({
    query: {
      async $allOperations({ args, query }) {
        let lastErr: unknown;
        for (let attempt = 0; attempt < 4; attempt++) {
          try {
            return await query(args);
          } catch (e) {
            lastErr = e;
            const code = (e as { code?: string })?.code ?? "";
            const msg = e instanceof Error ? e.message : String(e);
            if ((!TRANSIENT.test(code) && !TRANSIENT.test(msg)) || attempt === 3) throw e;
            await new Promise((r) => setTimeout(r, 300 * 2 ** attempt)); // 300, 600, 1200ms
          }
        }
        throw lastErr;
      },
    },
  });
}

// Reuse a single client across hot-reloads / serverless invocations.
const globalForPrisma = globalThis as unknown as { prisma?: ReturnType<typeof createClient> };

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
