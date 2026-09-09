import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export * as schema from "./schema";
export * from "./schema";

export type Db = ReturnType<typeof createDb>;

export function createDb(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set");
  }
  const pool = new Pool({ connectionString: databaseUrl, max: 10 });
  return drizzle(pool, { schema, casing: "snake_case" });
}
