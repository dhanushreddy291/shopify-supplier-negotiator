import { idempotencyKeys, logger, webhook, webhooks } from "@trigger.dev/sdk";
import type { ShopifyInventoryLevelEvent } from "../lib/shopify";
import { evaluateInventoryTask } from "./inventory-evaluation";

const DEFAULT_SHOP = process.env.SHOPIFY_STORE_DOMAIN || "acme-coffee.myshopify.com";

export const shopify = webhooks.endpoint.define({
  id: "shopify",
  source: webhooks.shopify<ShopifyInventoryLevelEvent>(),
  description: "Shopify inventory_levels/update webhooks",
});

export const onInventoryLevelUpdate = webhook({
  id: "shopify-inventory-level-update",
  endpoint: shopify,
  filter: "header.x-shopify-topic == 'inventory_levels/update'",
  onEvent: async ({ event, headers, ctx }) => {
    const data = event;
    if (typeof data.available !== "number" || !Number.isFinite(data.available)) return;

    const shopDomain = headers.get("x-shopify-shop-domain") ?? DEFAULT_SHOP;
    const updatedAt = data.updated_at ?? headers.get("x-shopify-webhook-id") ?? ctx.run.id;

    const key = await idempotencyKeys.create(
      ["inventory-eval", shopDomain, String(data.inventory_item_id), String(data.available), updatedAt],
      { scope: "global" }
    );

    const handle = await evaluateInventoryTask.trigger(
      {
        shopDomain,
        inventoryItemId: data.inventory_item_id,
        locationId: data.location_id,
        available: data.available,
      },
      { idempotencyKey: key, concurrencyKey: shopDomain }
    );

    logger.info("Enqueued inventory evaluation", {
      shopDomain,
      inventoryItemId: data.inventory_item_id,
      available: data.available,
      runId: handle.id,
    });
  },
});
