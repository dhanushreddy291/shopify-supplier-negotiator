import { idempotencyKeys, logger, webhook, webhooks } from "@trigger.dev/sdk";
import type { InboxEmailReceivedEvent } from "resend";
import { ingestInboundEmailTask } from "./email-ingestion";

export const resend = webhooks.endpoint.define({
  id: "resend",
  source: webhooks.resend<InboxEmailReceivedEvent>(),
  description: "Inbound supplier quotes and owner approval replies (inbox.email.received)",
});

export const onInboundEmail = webhook({
  id: "resend-inbound-email",
  endpoint: resend,
  filter: "event.type == 'inbox.email.received'",
  onEvent: async ({ event }) => {
    const { inbox_id, thread_id, email_id } = event.data;
    if (process.env.RESEND_INBOX_ID && inbox_id !== process.env.RESEND_INBOX_ID) return;

    const key = await idempotencyKeys.create(["resend-inbound", email_id], { scope: "global" });
    const handle = await ingestInboundEmailTask.trigger(
      { inboxId: inbox_id, threadId: thread_id, emailId: email_id },
      { idempotencyKey: key }
    );

    logger.info("Enqueued inbound email", {
      inboxId: inbox_id,
      emailId: email_id,
      from: event.data.email?.from,
      runId: handle.id,
    });
  },
});
