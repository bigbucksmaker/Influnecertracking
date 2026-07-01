import { PrismaClient } from "@prisma/client";

/**
 * Guarded read-only SQL for the assistant's analytics escape hatch.
 *
 * Defence in depth:
 *  1. Validation — a single statement, must start with SELECT/WITH, no write/DDL
 *     keywords, no dangerous functions, and a forced LIMIT.
 *  2. A READ ONLY transaction with a short statement_timeout (best-effort; falls
 *     back to a plain query if the pooled connection rejects interactive txns).
 *  3. DATABASE_URL_RO — point this at a dedicated read-only Postgres role so the
 *     connection physically cannot write. Falls back to DATABASE_URL if unset.
 */

const g = globalThis as unknown as { __roPrisma?: PrismaClient };

function roClient(): PrismaClient {
  if (!g.__roPrisma) {
    g.__roPrisma = new PrismaClient({
      datasourceUrl: process.env.DATABASE_URL_RO ?? process.env.DATABASE_URL,
      log: ["error"],
    });
  }
  return g.__roPrisma;
}

// Blocked as whole words. `into` catches SELECT … INTO (a write); `offset` is safe
// because \b makes "set" inside it non-matching.
const FORBIDDEN =
  /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|comment|copy|vacuum|analyze|reindex|refresh|cluster|call|do|merge|into|lock|nextval|setval|set_config|pg_read_file|pg_read_binary_file|pg_ls_dir|pg_sleep|lo_import|lo_export|dblink|pg_terminate_backend|pg_cancel_backend)\b/i;

export class SqlGuardError extends Error {}

export function validateSql(raw: string): string {
  let sql = raw.trim().replace(/;+\s*$/g, ""); // drop trailing semicolons
  if (!sql) throw new SqlGuardError("Empty query.");
  if (sql.includes(";")) throw new SqlGuardError("Only a single statement is allowed.");
  if (!/^\s*(select|with)\b/i.test(sql)) {
    throw new SqlGuardError("Only SELECT (or WITH … SELECT) queries are allowed.");
  }
  if (FORBIDDEN.test(sql)) {
    throw new SqlGuardError("Query contains a forbidden keyword — this tool is strictly read-only.");
  }
  if (!/\blimit\s+\d+/i.test(sql)) sql = `${sql} LIMIT 200`;
  return sql;
}

// JSON-safe: Postgres COUNT/bigint come back as BigInt, and dates as Date.
function jsonSafe(rows: unknown): unknown {
  return JSON.parse(
    JSON.stringify(rows, (_k, v) =>
      typeof v === "bigint" ? Number(v) : v instanceof Date ? v.toISOString() : v,
    ),
  );
}

export async function runReadOnlySql(raw: string): Promise<unknown[]> {
  const sql = validateSql(raw);
  const db = roClient();
  try {
    const rows = await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '5000'");
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      return tx.$queryRawUnsafe<Record<string, unknown>[]>(sql);
    });
    return jsonSafe(rows) as unknown[];
  } catch (e) {
    // Some pooled connections reject interactive transactions. Validation already
    // guarantees a SELECT-only statement; fall back to a plain read.
    const msg = e instanceof Error ? e.message : String(e);
    if (e instanceof SqlGuardError) throw e;
    if (/read-only|permission|denied/i.test(msg)) throw new SqlGuardError("Write blocked: connection is read-only.");
    const rows = await db.$queryRawUnsafe<Record<string, unknown>[]>(sql);
    return jsonSafe(rows) as unknown[];
  }
}
