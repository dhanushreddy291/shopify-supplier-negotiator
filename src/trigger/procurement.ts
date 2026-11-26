import { logger, metadata, task, tasks, wait } from "@trigger.dev/sdk";
import { classifyOwnerReply, recommendSupplier } from "../lib/agent";
import { findProduct, suppliersForProduct } from "../lib/catalog";
import {
  isMockMode,
  newPurchaseOrderNumber,
  recipientTag,
  sendEmail,
  threadTag,
} from "../lib/email";
import { modelCallLimit } from "../lib/limits";
import { formatApprovalEmail, formatPurchaseOrderEmail } from "../lib/templates";
import type {
  ApprovalDecision,
  InboundReply,
  InventorySnapshot,
  ProcurementCase,
  PurchaseOrder,
  SupplierQuote,
} from "../lib/types";
import { negotiateWithSupplierTask } from "./supplier-negotiation";

const STORE_NAME = process.env.STORE_NAME || "Acme Coffee Works";
const STORE_ADDRESS = process.env.STORE_ADDRESS || "1450 Valencia St, San Francisco, CA 94110";
const OWNER_EMAIL = process.env.OWNER_EMAIL || "owner@example.com";

export type ProcurementPayload = {
  caseId: string;
  shopDomain: string;
  inventory: InventorySnapshot;
  orderQuantity: number;
};

function trackCase(record: ProcurementCase): ProcurementCase {
  const next: ProcurementCase = { ...record, updatedAt: new Date().toISOString() };
  metadata
    .set("caseId", next.id)
    .set("sku", next.sku)
    .set("orderQuantity", next.orderQuantity)
    .set("status", next.status)
    .set("case", next);
  return next;
}

export const procurementCaseTask = task({
  id: "procurement-case",
  concurrency: [{ total: 25 }, modelCallLimit],
  run: async (payload: ProcurementPayload) => {
    const { caseId, shopDomain, inventory, orderQuantity } = payload;
    const now = new Date().toISOString();

    let record: ProcurementCase = trackCase({
      id: caseId,
      shopDomain,
      sku: inventory.sku,
      productTitle: inventory.productTitle,
      available: inventory.available,
      orderQuantity,
      status: "negotiating",
      quotes: [],
      createdAt: now,
      updatedAt: now,
    });

    // 1. Load the SKU's supplier panel from the catalog.
    const product = findProduct(inventory.sku);
    const panel = product ? suppliersForProduct(product) : [];
    if (!product || panel.length === 0) {
      record = trackCase({ ...record, status: "no_quotes" });
      return { caseId, status: "no_quotes" as const, case: record };
    }

    // 2. Negotiate with each supplier in parallel via durable child tasks.
    const batch = await negotiateWithSupplierTask.batchTriggerAndWait(
      panel.map((supplier) => ({
        payload: { caseId, supplier, product, orderQuantity },
      }))
    );

    const quotes: SupplierQuote[] = batch.runs.flatMap((r) =>
      r.ok && r.output.status === "quoted" && r.output.finalQuote
        ? [r.output.finalQuote]
        : []
    );

    if (quotes.length === 0) {
      record = trackCase({ ...record, status: "no_quotes", quotes });
      return { caseId, status: "no_quotes" as const, case: record };
    }

    // 3. AI recommendation -> pause for owner approval by email.
    const recommendation = await recommendSupplier({
      sku: inventory.sku,
      quantity: orderQuantity,
      quotes,
    });

    if (!recommendation) {
      record = trackCase({ ...record, status: "no_quotes", quotes });
      return { caseId, status: "no_quotes" as const, case: record };
    }

    record = trackCase({
      ...record,
      status: "awaiting_approval",
      quotes,
      recommendation,
    });
    metadata.set("recommended", recommendation.supplierName);

    const approvalSubject = `Approve purchase order: ${recommendation.quantity} × ${inventory.productTitle}`;

    const approvalSent = await sendEmail({
      to: OWNER_EMAIL,
      subject: approvalSubject,
      text: formatApprovalEmail({ inventory, recommendation, quotes }),
      idempotencyKey: `approval-email:${caseId}`,
    });

    const approvalToken = await wait.createToken({
      timeout: isMockMode() ? "10m" : "7d",
      idempotencyKey: `approval:${caseId}`,
      tags: [
        "procurement",
        "kind:approval",
        `case:${caseId}`,
        `supplier:${recommendation.supplierId}`,
        "round:1",
        recipientTag(OWNER_EMAIL),
        ...(approvalSent.threadId ? [threadTag(approvalSent.threadId)] : []),
      ],
    });

    if (isMockMode()) {
      await tasks.trigger(
        "simulate-owner-reply",
        {
          tokenId: approvalToken.id,
          threadId: approvalSent.threadId,
          subject: approvalSubject,
        },
        { delay: "3s", idempotencyKey: `sim-owner:${approvalToken.id}` }
      );
    }

    logger.info("Suspended awaiting owner approval", {
      caseId,
      threadId: approvalSent.threadId,
      approvalSubject,
    });
    const waited = await wait.forToken<InboundReply>(approvalToken.id);

    let approval: ApprovalDecision | undefined;
    if (waited.ok) {
      const intent = await classifyOwnerReply({
        subject: waited.output.subject,
        text: waited.output.text,
      });

      approval = {
        status: intent.status,
        approvedBy: waited.output.from,
        decidedAt: new Date().toISOString(),
        note: intent.note ?? undefined,
      };
    }

    if (!approval || approval.status !== "approved") {
      const status = "rejected" as const;
      record = trackCase({ ...record, status, approval });
      return { caseId, status, recommendation, case: record };
    }

    // 4. Place the purchase order (idempotent email + run metadata).
    const winner = panel.find((s) => s.id === recommendation.supplierId)!;
    const placedAt = new Date().toISOString();
    const deliveryDate = new Date(Date.now() + recommendation.leadTimeDays * 86_400_000)
      .toISOString()
      .slice(0, 10);

    const po: PurchaseOrder = {
      number: newPurchaseOrderNumber(caseId),
      caseId,
      supplierId: winner.id,
      supplierName: winner.name,
      supplierEmail: winner.email,
      sku: inventory.sku,
      productTitle: inventory.productTitle,
      quantity: recommendation.quantity,
      unitPrice: recommendation.unitPrice,
      shippingCost: recommendation.shippingCost,
      total: recommendation.total,
      leadTimeDays: recommendation.leadTimeDays,
      paymentTerms: recommendation.paymentTerms,
      requestedDeliveryDate: deliveryDate,
      approvedBy: approval.approvedBy,
      approvedAt: approval.decidedAt,
      approvalNote: approval.note,
      placedAt,
    };

    const sent = await sendEmail({
      to: winner.email,
      subject: `Purchase Order ${po.number} · ${po.quantity} × ${po.productTitle}`,
      text: formatPurchaseOrderEmail({ po, storeName: STORE_NAME, storeAddress: STORE_ADDRESS }),
      idempotencyKey: `po-email:${caseId}`,
    });
    po.emailId = sent.id;

    record = trackCase({ ...record, status: "ordered", approval, purchaseOrder: po });
    metadata.set("poNumber", po.number);

    await sendEmail({
      to: OWNER_EMAIL,
      subject: `Ordered: ${po.number} · ${po.quantity} × ${po.productTitle}`,
      text: `Purchase order ${po.number} ($${po.total.toFixed(2)}) has been sent to ${winner.name}.\nRequested delivery: ${po.requestedDeliveryDate}.`,
      idempotencyKey: `po-confirm:${caseId}`,
    });

    logger.info("Purchase order placed", { caseId, poNumber: po.number, total: po.total });
    return { caseId, status: "ordered" as const, purchaseOrder: po, case: record };
  },
});
