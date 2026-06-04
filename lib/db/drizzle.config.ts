import { defineConfig } from "drizzle-kit";
import path from "path";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  // Versioned migrations live here (committed to git). `drizzle-kit generate`
  // writes SQL + meta snapshots; `drizzle-kit migrate` applies pending ones and
  // records them in the __drizzle_migrations table. `push` (direct schema sync)
  // is retained for LOCAL dev iteration only — never run push against prod (a
  // renamed column reads as drop+add → silent data loss).
  // RELATIVE on purpose. drizzle-kit 0.31.9 prepends "./" when it reads the
  // meta snapshots, so an ABSOLUTE out (path.join(__dirname, ...)) produced a
  // malformed ".//Users/.../drizzle/meta/0000_snapshot.json" → ENOENT, which
  // blocked `generate` (the documented "journal snapshot-path bug"). drizzle-kit
  // resolves a relative out against the config dir, which is the CWD for the
  // `pnpm --filter @workspace/db run generate|migrate` scripts.
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
