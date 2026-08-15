import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { Client } from "pg";
import { describe, expect, it } from "vitest";

import { loadDatabaseUrl } from "../support/database-url.js";

const execFileAsync = promisify(execFile);
const databaseUrl = loadDatabaseUrl();
const dbPackageRoot = fileURLToPath(new URL("../../../../packages/db", import.meta.url));

function databaseName(url: string): string {
  return new URL(url).pathname.replace(/^\//, "").split("?")[0] ?? "loan_review";
}

function withDatabaseName(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

describe.skipIf(!databaseUrl)("fresh migrate", () => {
  it("applies the full migration history on an empty database", async () => {
    if (!databaseUrl) {
      return;
    }

    const name = `loan_review_fresh_${process.pid}`;
    const admin = new Client({ connectionString: databaseUrl });
    await admin.connect();

    try {
      await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
      await admin.query(`CREATE DATABASE "${name}"`);
    } finally {
      await admin.end();
    }

    const freshUrl = withDatabaseName(databaseUrl, name);

    try {
      await execFileAsync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
        cwd: dbPackageRoot,
        env: { ...process.env, DATABASE_URL: freshUrl },
      });

      const migrated = new Client({ connectionString: freshUrl });
      await migrated.connect();
      try {
        const enumValue = await migrated.query<{ exists: boolean }>(
          `SELECT EXISTS (
             SELECT 1
             FROM pg_enum e
             JOIN pg_type t ON t.oid = e.enumtypid
             WHERE t.typname = 'LoanApplicationStatus'
               AND e.enumlabel = 'PENDING_CONFIRMATION'
           ) AS exists`,
        );
        const column = await migrated.query<{ exists: boolean }>(
          `SELECT EXISTS (
             SELECT 1
             FROM information_schema.columns
             WHERE table_schema = 'public'
               AND table_name = 'LoanApplication'
               AND column_name = 'proposedByUserId'
           ) AS exists`,
        );

        expect(enumValue.rows[0]?.exists).toBe(true);
        expect(column.rows[0]?.exists).toBe(true);
        expect(databaseName(freshUrl)).toBe(name);
      } finally {
        await migrated.end();
      }
    } finally {
      const cleanup = new Client({ connectionString: databaseUrl });
      await cleanup.connect();
      try {
        await cleanup.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      } finally {
        await cleanup.end();
      }
    }
  });
});
