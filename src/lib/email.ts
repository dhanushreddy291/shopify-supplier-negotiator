import { logger } from "@trigger.dev/sdk";
import { Resend } from "resend";

type EmailMode = "mock" | "resend";

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

type ReplyThreadRef = {
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
}): Promise<{ id: string }> {
  if (isMockMode()) {
    const id = `mock_${input.idempotencyKey}`;
    logger.info("Mock email (not sent)", {
      id,
      to: input.to,
      subject: input.subject,
      preview: input.text.slice(0, 300),
    });
    return { id };
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
    return { id: data.id };
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
