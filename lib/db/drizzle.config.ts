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
  out: path.join(__dirname, "./drizzle"),
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
