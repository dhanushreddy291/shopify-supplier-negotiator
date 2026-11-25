import { logger, task, tasks, wait } from "@trigger.dev/sdk";
import { runNegotiationAgent, type SupplierEmailOutcome } from "../lib/agent";
import { saveEmailThread } from "../lib/db";
import { isMockMode, sendEmail } from "../lib/email";
import { modelCallLimit } from "../lib/limits";
import {
  formatCounterofferEmail,
  formatQuestionReplyEmail,
  formatRfqEmail,
} from "../lib/templates";
import type {
  CatalogProduct,
  InboundReply,
  Supplier,
  SupplierQuote,
} from "../lib/types";

const STORE_NAME = process.env.STORE_NAME || "Acme Coffee Works";
const MAX_NEGOTIATION_ROUNDS = 2;
const REPLY_TIMEOUT = "48h";

type SupplierNegotiationResult = {
  supplierId: string;
  supplierName: string;
  status: "quoted" | "no_response" | "declined";
  finalQuote?: SupplierQuote;
  log: string;
};

export const negotiateWithSupplierTask = task({
  id: "negotiate-with-supplier",
  concurrency: modelCallLimit,
  run: async (payload: {
    caseId: string;
    supplier: Supplier;
    product: CatalogProduct;
    orderQuantity: number;
  }): Promise<SupplierNegotiationResult> => {
    const { caseId, supplier, product, orderQuantity } = payload;
    let round = 0;
    let lastReply: InboundReply | undefined;

    async function sendAndWait(text: string): Promise<SupplierEmailOutcome> {
      round += 1;
      const subject =
        round === 1
          ? `Quote request: ${orderQuantity} × ${product.title}`
          : `Re: Quote request: ${orderQuantity} × ${product.title}`;

      const token = await wait.createToken({
        timeout: isMockMode() ? "5m" : REPLY_TIMEOUT,
        idempotencyKey: `rfq:${caseId}:${supplier.id}:${round}`,
        tags: ["procurement", `case:${caseId}`, `supplier:${supplier.id}`, `round:${round}`],
      });

      await saveEmailThread({
        tokenId: token.id,
        kind: "rfq",
        caseId,
        supplierId: supplier.id,
        round,
        toEmail: supplier.email,
        subject,
      });

      await sendEmail({
        to: supplier.email,
        subject,
        text: text.trim(),
        idempotencyKey: `rfq-email:${caseId}:${supplier.id}:${round}`,
        replyToThread:
          lastReply?.inboxId && lastReply?.threadId
            ? {
                inboxId: lastReply.inboxId,
                threadId: lastReply.threadId,
                emailId: lastReply.emailId,
              }
            : undefined,
      });

      if (isMockMode()) {
        await tasks.trigger(
          "simulate-supplier-reply",
          { tokenId: token.id, supplierId: supplier.id, sku: product.sku, round, subject },
          { delay: "3s", idempotencyKey: `sim-reply:${token.id}` }
        );
      }

      const waited = await wait.forToken<InboundReply>(token.id);
      if (!waited.ok) {
        logger.warn("Supplier timed out", { caseId, supplierId: supplier.id, round });
        return { timedOut: true, round };
      }

      lastReply = waited.output;
      return { timedOut: false, round, replyText: waited.output.text };
    }

    const initial = await sendAndWait(
      formatRfqEmail({
        supplierName: supplier.name,
        storeName: STORE_NAME,
        sku: product.sku,
        productTitle: product.title,
        quantity: orderQuantity,
      })
    );

    if (initial.timedOut) {
      return {
        supplierId: supplier.id,
        supplierName: supplier.name,
        status: "no_response",
        log: "No reply before deadline.",
      };
    }

    const outcome = await runNegotiationAgent({
      supplier,
      product,
      orderQuantity,
      initialReplyText: initial.replyText,
      maxRounds: MAX_NEGOTIATION_ROUNDS,
      getRoundsUsed: () => round,
      onSendCounteroffer: ({ targetUnitPrice, targetLeadTimeDays }) =>
        sendAndWait(
          formatCounterofferEmail({
            supplierName: supplier.name,
            storeName: STORE_NAME,
            productTitle: product.title,
            quantity: orderQuantity,
            targetUnitPrice,
            targetLeadTimeDays,
          })
        ),
      onAnswerQuestion: ({ answer }) =>
        sendAndWait(
          formatQuestionReplyEmail({
            supplierName: supplier.name,
            storeName: STORE_NAME,
            sku: product.sku,
            productTitle: product.title,
            quantity: orderQuantity,
            answer,
          })
        ),
    });

    return {
      supplierId: supplier.id,
      supplierName: supplier.name,
      ...outcome,
    };
  },
});
