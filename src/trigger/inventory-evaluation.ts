import { idempotencyKeys, logger, metadata, task } from "@trigger.dev/sdk";
import { findProduct } from "../lib/catalog";
import { newCaseId } from "../lib/email";
import { shopifyApiLimit } from "../lib/limits";
import { enrichInventoryLevel } from "../lib/shopify";
import { procurementCaseTask } from "./procurement";

export const evaluateInventoryTask = task({
  id: "evaluate-inventory",
  concurrency: shopifyApiLimit,
  run: async (payload: {
    shopDomain: string;
    inventoryItemId: string | number;
    locationId: string | number;
    available: number;
  }) => {
    const inventory = await enrichInventoryLevel(payload);
    if (!inventory) {
      return { status: "ignored" as const, reason: "unknown inventory item" };
    }

    const product = findProduct(inventory.sku);
    if (!product) {
      return { status: "ignored" as const, reason: "unknown product" };
    }

    metadata.set("sku", inventory.sku).set("available", inventory.available);

    if (inventory.available > product.reorderPoint) {
      return { status: "no_action" as const, sku: inventory.sku, available: inventory.available };
    }

    const orderQuantity = product.reorderQuantity;
    const caseId = newCaseId();

    const idempotencyKey = await idempotencyKeys.create(
      ["procurement-case", payload.shopDomain, inventory.sku],
      { scope: "global" }
    );

    const handle = await procurementCaseTask.trigger(
      {
        caseId,
        shopDomain: payload.shopDomain,
        inventory,
        orderQuantity,
      },
      {
        idempotencyKey,
        idempotencyKeyTTL: "12h",
        concurrencyKey: payload.shopDomain,
        tags: ["procurement", `sku:${inventory.sku}`, `case:${caseId}`],
      }
    );

    logger.info("Triggered procurement case", {
      caseId,
      sku: inventory.sku,
      orderQuantity,
      runId: handle.id,
    });

    return { status: "triggered" as const, caseId, orderQuantity, runId: handle.id };
  },
});
