import { Pool, type QueryResultRow } from "pg";

const connectionString =
  process.env.DATABASE_URL_PG ||
  (process.env.DATABASE_URL || "").replace("postgresql+asyncpg://", "postgresql://").replace("ssl=require", "sslmode=require");

const globalForPg = globalThis as unknown as { pool?: Pool };

const isSsl =
  process.env.PGSSL === "true" ||
  connectionString.includes("sslmode=require") ||
  connectionString.includes("neon.tech");

export const pool =
  globalForPg.pool ||
  new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ssl: isSsl ? { rejectUnauthorized: false } : undefined,
  });

if (process.env.NODE_ENV !== "production") globalForPg.pool = pool;

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await pool.query<T>(text, params);
  return result.rows;
}

export async function one<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

export async function withTransaction<T>(fn: (client: import("pg").PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
