import pg from "pg";

export interface ArchiveConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

const DEFAULT_CONFIG: ArchiveConfig = {
  host: process.env.ARCHIVE_DB_HOST ?? "localhost",
  port: parseInt(process.env.ARCHIVE_DB_PORT ?? "5432"),
  database: process.env.ARCHIVE_DB_NAME ?? "archive",
  user: process.env.ARCHIVE_DB_USER ?? "postgres",
  password: process.env.ARCHIVE_DB_PASSWORD ?? "postgres",
};

export class ArchiveDB {
  private pool: pg.Pool;

  constructor(config: Partial<ArchiveConfig> = {}) {
    this.pool = new pg.Pool({ ...DEFAULT_CONFIG, ...config });
  }

  async query<T extends pg.QueryResultRow = Record<string, unknown>>(
    text: string,
    params?: unknown[]
  ): Promise<pg.QueryResult<T>> {
    return this.pool.query<T>(text, params);
  }

  async queryReadOnly<T extends pg.QueryResultRow = Record<string, unknown>>(
    text: string,
    params?: unknown[]
  ): Promise<pg.QueryResult<T>> {
    const normalized = text.trim().toUpperCase();
    if (
      !normalized.startsWith("SELECT") &&
      !normalized.startsWith("WITH") &&
      !normalized.startsWith("EXPLAIN")
    ) {
      throw new Error("Only SELECT/WITH/EXPLAIN queries are allowed");
    }
    const client = await this.pool.connect();
    try {
      await client.query("SET statement_timeout = '10s'");
      await client.query("SET default_transaction_read_only = ON");
      const result = await client.query<T>(text, params);
      return result;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async isConnected(): Promise<boolean> {
    try {
      await this.pool.query("SELECT 1");
      return true;
    } catch {
      return false;
    }
  }
}
