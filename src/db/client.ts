import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../config/env.js";
import * as schema from "./schema.js";

// postgres-js connection pool — options mirror pace-bot/src/db/client.ts.
// postgres() is lazy: importing this module does NOT open a connection; the
// first query does. (No DB is touched in Slices 0-1.)
export const sqlClient = postgres(env.DATABASE_URL, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 5,
});

export const db = drizzle(sqlClient, { schema });
export type DB = typeof db;
