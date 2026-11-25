import { logger, task, wait } from "@trigger.dev/sdk";
import { findOpenEmailThread, markEmailThreadCompleted } from "../lib/db";
import {
  bareAddress,
  fetchInboundEmail,
  stripQuotedReply,
  type InboundEmail,
} from "../lib/email";
import type { InboundReply } from "../lib/types";

export const ingestInboundEmailTask = task({
  id: "ingest-inbound-email",
  concurrency: { total: 20 },
  run: async (payload: {
    inboxId: string;
    threadId: string;
    emailId: string;
    tokenId?: string;
    mockEmail?: InboundEmail;
  }) => {
    const email = payload.mockEmail ?? (await fetchInboundEmail(payload));
    if (email.direction === "outbound") {
      return { status: "ignored" as const, reason: "outbound" };
    }

    const sender = bareAddress(email.from);
    const subject = email.subject ?? "";
    const rawBody =
      email.text?.trim() || (email.html ? email.html.replace(/<[^>]+>/g, " ").trim() : "");
    const text = stripQuotedReply(rawBody);

    const thread = await findOpenEmailThread(sender, payload.tokenId);
    if (!thread) {
      logger.warn("Ignoring inbound email with no open waitpoint", { sender, emailId: email.id });
      return { status: "ignored" as const, reason: "no-open-request" };
    }

    if (process.env.DEMO_FAIL_EMAIL_INGESTION === "1") {
      throw new Error("DEMO_FAIL_EMAIL_INGESTION=1: simulated ingestion failure for bulk replay");
    }

    const reply: InboundReply = {
      emailId: email.id,
      inboxId: payload.mockEmail ? undefined : payload.inboxId,
      threadId: payload.mockEmail ? undefined : payload.threadId,
      from: sender,
      subject,
      text,
    };

    await wait.completeToken<InboundReply>(thread.tokenId, reply);
    await markEmailThreadCompleted(thread.tokenId);

    logger.info("Completed email waitpoint", {
      caseId: thread.caseId,
      kind: thread.kind,
      supplierId: thread.supplierId,
      round: thread.round,
    });

    return {
      status: "completed" as const,
      kind: thread.kind,
      caseId: thread.caseId,
      tokenId: thread.tokenId,
    };
  },
});
