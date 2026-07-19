import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

function missingDatabaseUrlError(): Error {
  return new Error(
    "DATABASE_URL must be set. Add a Postgres connection string in your deployment environment variables.",
  );
}

const databaseUrl = process.env.DATABASE_URL;
const missingDatabaseUrlProxy = new Proxy(
  {},
  {
    get() {
      throw missingDatabaseUrlError();
    },
  },
);

export const pool = databaseUrl
  ? new Pool({ connectionString: databaseUrl })
  : (missingDatabaseUrlProxy as pg.Pool);

export const db = databaseUrl
  ? drizzle(pool, { schema })
  : (missingDatabaseUrlProxy as ReturnType<typeof drizzle<typeof schema>>);

export * from "./schema";
