import { logger, task, wait } from "@trigger.dev/sdk";
import {
  bareAddress,
  fetchInboundEmail,
  recipientTag,
  stripQuotedReply,
  threadTag,
  type InboundEmail,
} from "../lib/email";
import type { InboundReply } from "../lib/types";

async function findWaitingToken(input: {
  threadId?: string;
  sender: string;
  tokenId?: string;
}): Promise<{ id: string; tags: string[] } | undefined> {
  if (input.tokenId) {
    const token = await wait.retrieveToken(input.tokenId);
    if (token.status === "WAITING") {
      return { id: token.id, tags: token.tags };
    }
    return undefined;
  }

  if (input.threadId) {
    for await (const token of wait.listTokens({
      status: "WAITING",
      tags: [threadTag(input.threadId)],
    })) {
      return { id: token.id, tags: token.tags };
    }
  }

  for await (const token of wait.listTokens({
    status: "WAITING",
    tags: [recipientTag(input.sender)],
  })) {
    if (!token.tags.some((t) => t.startsWith("thread:"))) {
      return { id: token.id, tags: token.tags };
    }
  }

  return undefined;
}

function tagValue(tags: string[], prefix: string): string | undefined {
  const match = tags.find((t) => t.startsWith(`${prefix}:`));
  return match ? match.slice(prefix.length + 1) : undefined;
}

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

    const token = await findWaitingToken({
      threadId: payload.threadId,
      sender,
      tokenId: payload.tokenId,
    });
    if (!token) {
      logger.warn("Ignoring inbound email with no open waitpoint", {
        threadId: payload.threadId,
        sender,
        emailId: email.id,
      });
      return { status: "ignored" as const, reason: "no-open-request" };
    }

    if (process.env.DEMO_FAIL_EMAIL_INGESTION === "1") {
      throw new Error("DEMO_FAIL_EMAIL_INGESTION=1: simulated ingestion failure for bulk replay");
    }

    const reply: InboundReply = {
      emailId: email.id,
      inboxId: payload.mockEmail ? undefined : payload.inboxId,
      threadId: payload.threadId,
      from: sender,
      subject,
      text,
    };

    await wait.completeToken<InboundReply>(token.id, reply);

    const caseId = tagValue(token.tags, "case");
    const kind = tagValue(token.tags, "kind") as "rfq" | "approval" | undefined;
    const supplierId = tagValue(token.tags, "supplier");
    const round = tagValue(token.tags, "round");

    logger.info("Completed email waitpoint", {
      tokenId: token.id,
      threadId: payload.threadId,
      caseId,
      kind,
      supplierId,
      round,
    });

    return {
      status: "completed" as const,
      kind,
      caseId,
      threadId: payload.threadId,
      tokenId: token.id,
    };
  },
});
