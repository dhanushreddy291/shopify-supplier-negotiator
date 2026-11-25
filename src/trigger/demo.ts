import { logger, task } from "@trigger.dev/sdk";
import { findProduct, SUPPLIERS } from "../lib/catalog";
import type { InboundEmail } from "../lib/email";
import { ingestInboundEmailTask } from "./email-ingestion";
import { evaluateInventoryTask } from "./inventory-evaluation";

const SHOP_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || "acme-coffee.myshopify.com";
const OWNER_EMAIL = process.env.OWNER_EMAIL || "owner@example.com";

export const simulateInventoryLowTask = task({
  id: "simulate-inventory-low",
  run: async (payload: { sku?: string; available?: number }) => {
    const sku = payload.sku ?? "ESP-GASKET-58";
    const product = findProduct(sku);
    if (!product) throw new Error(`Unknown demo SKU: ${sku}`);

    const available = payload.available ?? Math.max(0, product.reorderPoint - 6);
    const handle = await evaluateInventoryTask.trigger(
      {
        shopDomain: SHOP_DOMAIN,
        inventoryItemId: product.inventoryItemId,
        locationId: product.locationId,
        available,
      },
      { concurrencyKey: SHOP_DOMAIN, tags: ["demo", `sku:${sku}`] }
    );

    logger.info("Demo stockout triggered", { sku, available, runId: handle.id });
    return { sku, available, evaluationRunId: handle.id };
  },
});

const DEMO_PRICE_MULTIPLIER: Record<string, number> = {
  sup_harbor: 1.04,
  sup_pacific: 1.09,
  sup_north: 1.14,
};

export const simulateSupplierReplyTask = task({
  id: "simulate-supplier-reply",
  run: async (payload: {
    tokenId: string;
    supplierId: string;
    sku: string;
    round: number;
    subject?: string;
  }) => {
    const supplier = SUPPLIERS[payload.supplierId];
    if (!supplier) throw new Error(`Unknown supplier: ${payload.supplierId}`);

    const product = findProduct(payload.sku);
    const basePrice = (product?.targetUnitPrice ?? 9) * (DEMO_PRICE_MULTIPLIER[supplier.id] ?? 1.05);
    const discount = payload.round > 1 ? 0.93 : 1;
    const unitPrice = Math.round(basePrice * discount * 100) / 100;
    const leadTime = Math.max(4, Math.min(supplier.avgLeadTimeDays, 12));
    const moq = Math.min(50, product?.reorderQuantity ?? 50);

    const mockEmail: InboundEmail = {
      id: `sim_supplier_${supplier.id}_${payload.round}_${payload.tokenId}`,
      direction: "inbound",
      from: `${supplier.name} <${supplier.email}>`,
      to: ["procurement@resend.dev"],
      subject: payload.subject ? `Re: ${payload.subject}` : `Re: Quote for ${payload.sku}`,
      text: [
        `Hi team,`,
        `Here is our quote for ${payload.sku}:`,
        `- Unit price: $${unitPrice.toFixed(2)} per unit`,
        `- MOQ: ${moq} units`,
        `- Lead time: ${leadTime} days`,
        `- Shipping: $95.00 for the full order`,
        `- Payment terms: ${supplier.paymentTerms}`,
      ].join("\n"),
      html: null,
      received_at: new Date().toISOString(),
    };

    const handle = await ingestInboundEmailTask.trigger({
      inboxId: "mock-inbox",
      threadId: `mock_${payload.tokenId}`,
      emailId: mockEmail.id,
      tokenId: payload.tokenId,
      mockEmail,
    });

    return { supplierId: supplier.id, unitPrice, leadTime, ingestionRunId: handle.id };
  },
});

export const simulateOwnerReplyTask = task({
  id: "simulate-owner-reply",
  run: async (payload: { tokenId: string; subject?: string; replyText?: string }) => {
    const text = payload.replyText ?? "Approved. Please ask them to ship before Friday.";
    const mockEmail: InboundEmail = {
      id: `sim_owner_${payload.tokenId}`,
      direction: "inbound",
      from: `Store Owner <${OWNER_EMAIL}>`,
      to: ["procurement@resend.dev"],
      subject: payload.subject ? `Re: ${payload.subject}` : "Re: Approve purchase order",
      text,
      html: null,
      received_at: new Date().toISOString(),
    };

    const result = await ingestInboundEmailTask
      .triggerAndWait({
        inboxId: "mock-inbox",
        threadId: `mock_${payload.tokenId}`,
        emailId: mockEmail.id,
        tokenId: payload.tokenId,
        mockEmail,
      })
      .unwrap();

    return result;
  },
});
