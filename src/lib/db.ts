import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { bareAddress } from "./email";
import type { ProcurementCase } from "./types";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS procurement_cases (
  id text PRIMARY KEY,
  shop_domain text NOT NULL,
  sku text NOT NULL,
  status text NOT NULL,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS procurement_cases_open_idx
  ON procurement_cases (shop_domain, sku, status);

CREATE TABLE IF NOT EXISTS email_threads (
  token_id text PRIMARY KEY,
  kind text NOT NULL,
  case_id text NOT NULL,
  supplier_id text,
  round integer,
  to_email text NOT NULL,
  subject text NOT NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_threads_open_recipient_idx
  ON email_threads (to_email, created_at DESC)
  WHERE completed_at IS NULL;
`;

const globalDb = globalThis as unknown as {
  __pgPool?: Pool;
  __pgReady?: Promise<void>;
};

function getPool(): Pool {
  if (!globalDb.__pgPool) {
    const connectionString = process.env.DATABASE_URL?.trim().replace(/^(['"])(.*)\1$/, "$2");
    if (!connectionString) {
      throw new Error("DATABASE_URL is required");
    }
    const needsSsl = /neon\.tech|supabase|render\.com|amazonaws\.com/i.test(connectionString);
    globalDb.__pgPool = new Pool({
      connectionString,
      max: 8,
      ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
    });
  }
  return globalDb.__pgPool;
}

export async function initDb(): Promise<Pool> {
  const pool = getPool();
  if (!globalDb.__pgReady) {
    globalDb.__pgReady = pool
      .query(SCHEMA_SQL)
      .then(() => undefined)
      .catch((error) => {
        globalDb.__pgReady = undefined;
        throw error;
      });
  }
  await globalDb.__pgReady;
  return pool;
}

export async function closeDb(): Promise<void> {
  await globalDb.__pgPool?.end();
  globalDb.__pgPool = undefined;
  globalDb.__pgReady = undefined;
}

export function newCaseId(): string {
  return `pc_${randomBytes(6).toString("hex")}`;
}

export function newPurchaseOrderNumber(caseId: string): string {
  return `PO-${new Date().getUTCFullYear()}-${caseId.replace(/^pc_/, "").toUpperCase()}`;
}

export async function saveCase(record: ProcurementCase): Promise<ProcurementCase> {
  const pool = await initDb();
  const next: ProcurementCase = { ...record, updatedAt: new Date().toISOString() };
  await pool.query(
    `INSERT INTO procurement_cases (id, shop_domain, sku, status, data, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (id) DO UPDATE
       SET status = EXCLUDED.status,
           data = EXCLUDED.data,
           updated_at = EXCLUDED.updated_at`,
    [next.id, next.shopDomain, next.sku, next.status, next, next.createdAt, next.updatedAt]
  );
  return next;
}

type EmailThread = {
  tokenId: string;
  kind: "rfq" | "approval";
  caseId: string;
  supplierId: string | null;
  round: number | null;
  toEmail: string;
  subject: string;
};

export async function saveEmailThread(thread: EmailThread): Promise<void> {
  const pool = await initDb();
  await pool.query(
    `INSERT INTO email_threads (token_id, kind, case_id, supplier_id, round, to_email, subject, completed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NULL)
     ON CONFLICT (token_id) DO UPDATE
       SET kind = EXCLUDED.kind,
           case_id = EXCLUDED.case_id,
           supplier_id = EXCLUDED.supplier_id,
           round = EXCLUDED.round,
           to_email = EXCLUDED.to_email,
           subject = EXCLUDED.subject,
           completed_at = NULL`,
    [
      thread.tokenId,
      thread.kind,
      thread.caseId,
      thread.supplierId,
      thread.round,
      bareAddress(thread.toEmail),
      thread.subject,
    ]
  );
}

export async function findOpenEmailThread(
  toEmail: string,
  tokenId?: string
): Promise<EmailThread | undefined> {
  const pool = await initDb();
  const { rows } = await pool.query<EmailThread>(
    `SELECT
       token_id AS "tokenId",
       kind,
       case_id AS "caseId",
       supplier_id AS "supplierId",
       round,
       to_email AS "toEmail",
       subject
     FROM email_threads
     WHERE to_email = $1
       AND completed_at IS NULL
       AND ($2::text IS NULL OR token_id = $2)
     ORDER BY created_at DESC
     LIMIT 1`,
    [bareAddress(toEmail), tokenId ?? null]
  );
  return rows[0];
}

export async function markEmailThreadCompleted(tokenId: string): Promise<void> {
  const pool = await initDb();
  await pool.query(
    `UPDATE email_threads SET completed_at = now() WHERE token_id = $1 AND completed_at IS NULL`,
    [tokenId]
  );
}
