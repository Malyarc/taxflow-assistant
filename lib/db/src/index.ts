import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const connectionString = process.env.DATABASE_URL;

// Enable TLS when the connection string targets a managed/cloud Postgres
// (Neon, RDS, Supabase, …) or explicitly requests it. Local Docker Postgres
// has no TLS, so forcing ssl there would break every connection — keep it off
// unless the URL/host signals otherwise.
const wantsSsl =
  /sslmode=(require|verify-full|verify-ca)/.test(connectionString) ||
  /\.neon\.tech|\.rds\.amazonaws\.com|\.supabase\.|\.render\.com/.test(connectionString) ||
  process.env.PGSSL === "true";

export const pool = new Pool({
  connectionString,
  // Bound the pool so a burst can't blow past the provider's connection limit;
  // tune via PG_POOL_MAX = (provider limit) / (number of app instances).
  max: Number(process.env.PG_POOL_MAX ?? 15),
  idleTimeoutMillis: 30_000,
  // Fail fast under pool exhaustion instead of node-postgres' default of
  // waiting forever (connectionTimeoutMillis: 0), which turns a saturated pool
  // into hung requests.
  connectionTimeoutMillis: 10_000,
  keepAlive: true,
  ...(wantsSsl ? { ssl: { rejectUnauthorized: true } } : {}),
});

// An idle client emitting 'error' with no listener becomes an uncaughtException.
// Log it and let the pool evict/replace the dropped socket (common with Neon,
// which closes idle server-side connections).
pool.on("error", (err) => {
  console.error("[db] idle pg client error:", err instanceof Error ? err.message : err);
});

export const db = drizzle(pool, { schema });

export * from "./schema";
