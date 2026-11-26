import { randomBytes } from "node:crypto";
import { logger } from "@trigger.dev/sdk";
import { Resend } from "resend";

/**
 * Resend outbound/inbound email helpers and waitpoint correlation tags.
 *
 * EMAIL_MODE controls how outbound email behaves:
 *   - mock (default): nothing is sent; demo tasks simulate replies after 3s.
 *   - resend: sends real emails via Resend to supplier addresses in catalog.ts and OWNER_EMAIL.
 */

export function newCaseId(): string {
  return `pc_${randomBytes(6).toString("hex")}`;
}

export function newPurchaseOrderNumber(caseId: string): string {
  return `PO-${new Date().getUTCFullYear()}-${caseId.replace(/^pc_/, "").toUpperCase()}`;
}

/** Tag attached to a waitpoint token for Resend `thread_id` correlation. */
export function threadTag(threadId: string): string {
  return `thread:${threadId}`;
}

export function recipientTag(email: string): string {
  return `to:${bareAddress(email)}`;
}

export type EmailMode = "mock" | "resend";

export type InboundEmail = {
  id: string;
  direction: "inbound" | "outbound";
  from: string;
  to: string[];
  subject: string | null;
  text: string | null;
  html: string | null;
  received_at: string;
};

export type ReplyThreadRef = {
  inboxId: string;
  threadId: string;
  emailId: string;
};

let cachedClient: { apiKey: string; resend: Resend } | undefined;

function getResend(): Resend {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is required when EMAIL_MODE=resend");
  }
  if (!cachedClient || cachedClient.apiKey !== apiKey) {
    cachedClient = { apiKey, resend: new Resend(apiKey) };
  }
  return cachedClient.resend;
}

export function getEmailMode(): EmailMode {
  const raw = (process.env.EMAIL_MODE ?? "mock").trim().toLowerCase();
  return raw === "resend" ? "resend" : "mock";
}

export function isMockMode(): boolean {
  return getEmailMode() === "mock";
}

export async function sendEmail(input: {
  to: string;
  subject: string;
  text: string;
  idempotencyKey: string;
  replyToThread?: ReplyThreadRef;
}): Promise<{ id: string; threadId?: string }> {
  if (isMockMode()) {
    const id = `mock_${input.idempotencyKey}`;
    const threadId = input.replyToThread?.threadId ?? `mock_thread_${input.idempotencyKey}`;
    logger.info("Mock email (not sent)", {
      id,
      threadId,
      to: input.to,
      subject: input.subject,
      preview: input.text.slice(0, 300),
    });
    return { id, threadId };
  }

  const resend = getResend();

  if (input.replyToThread) {
    const { data, error } = await resend.inboxes.threads.emails.reply(
      {
        inboxId: input.replyToThread.inboxId,
        threadId: input.replyToThread.threadId,
        emailId: input.replyToThread.emailId,
        text: input.text,
      },
      { idempotencyKey: input.idempotencyKey }
    );

    if (error || !data) {
      throw new Error(`Failed to reply in thread: ${error?.message ?? "no data"}`);
    }

    logger.info("Threaded reply sent via Resend Inbox", {
      id: data.id,
      to: input.to,
      threadId: input.replyToThread.threadId,
    });
    return { id: data.id, threadId: input.replyToThread.threadId };
  }

  // When RESEND_INBOX_ID is configured, send new outbound threads through the
  // Resend Inbox (drafts.create -> drafts.send -> drafts.get) so Resend creates
  // and returns a `thread_id` that inbound replies will carry in webhook payloads.
  const inboxId = process.env.RESEND_INBOX_ID?.trim();
  if (inboxId) {
    const { data: created, error: createError } = await resend.inboxes.drafts.create(
      {
        inboxId,
        to: [input.to],
        subject: input.subject,
        text: input.text,
      },
      { idempotencyKey: `${input.idempotencyKey}:draft` }
    );

    if (createError || !created) {
      throw new Error(`Failed to create inbox draft: ${createError?.message ?? "no data"}`);
    }

    const { data: sent, error: sendError } = await resend.inboxes.drafts.send(
      { inboxId, draftId: created.id },
      { idempotencyKey: input.idempotencyKey }
    );

    if (sendError && sendError.statusCode !== 409) {
      throw new Error(`Failed to send inbox draft: ${sendError.message}`);
    }

    const { data: draft, error: getError } = await resend.inboxes.drafts.get({
      inboxId,
      draftId: created.id,
    });

    if (getError) {
      logger.warn("Sent inbox draft but failed to read back thread_id", {
        draftId: created.id,
        error: getError.message,
      });
    }

    const emailId = sent?.id ?? draft?.email_id ?? created.id;
    const threadId = draft?.thread_id ?? undefined;

    logger.info("Email sent via Resend Inbox", {
      id: emailId,
      threadId,
      to: input.to,
      subject: input.subject,
    });
    return { id: emailId, threadId };
  }

  const { data, error } = await resend.emails.send(
    {
      from: process.env.PROCUREMENT_FROM_EMAIL || "Acme Procurement <procurement@resend.dev>",
      to: input.to,
      subject: input.subject,
      text: input.text,
      replyTo: process.env.PROCUREMENT_REPLY_TO,
    },
    { idempotencyKey: input.idempotencyKey }
  );

  if (error || !data) {
    throw new Error(`Failed to send email: ${error?.message ?? "no data"}`);
  }

  logger.info("Email sent via Resend", { id: data.id, to: input.to, subject: input.subject });
  return { id: data.id };
}

export async function fetchInboundEmail(input: {
  inboxId: string;
  threadId: string;
  emailId: string;
}): Promise<InboundEmail> {
  const resend = getResend();
  const { data, error } = await resend.inboxes.threads.emails.get(input);
  if (error || !data) {
    throw new Error(`Failed to fetch inbound email: ${error?.message ?? "no data"}`);
  }
  return {
    id: data.id,
    direction: data.direction,
    from: data.from,
    to: data.to,
    subject: data.subject,
    text: data.text,
    html: data.html,
    received_at: data.received_at,
  };
}

export function bareAddress(raw: string): string {
  return (raw.match(/<([^<>]+)>/)?.[1] ?? raw).trim().toLowerCase();
}

export function stripQuotedReply(text: string): string {
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  const kept: string[] = [];

  for (const line of normalized.split("\n")) {
    const trimmed = line.trim();
    if (
      /^On .+wrote:\s*$/i.test(trimmed) ||
      /^-{2,}\s*Original Message\s*-{2,}\s*$/i.test(trimmed) ||
      /^_{10,}\s*$/.test(trimmed) ||
      /^Begin forwarded message:\s*$/i.test(trimmed)
    ) {
      break;
    }
    if (!trimmed.startsWith(">")) kept.push(line);
  }

  return kept.join("\n").trim() || normalized;
}
