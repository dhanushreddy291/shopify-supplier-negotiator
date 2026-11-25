import { findProduct } from "./catalog";
import type { InventorySnapshot } from "./types";

export type ShopifyInventoryLevelEvent = {
  inventory_item_id: number;
  location_id: number;
  available: number;
  updated_at?: string;
};

const INVENTORY_ITEM_QUERY = /* GraphQL */ `
  query ProcurementInventoryItem($id: ID!) {
    inventoryItem(id: $id) {
      id
      sku
      variant { product { title } }
    }
  }
`;

type InventoryItemResponse = {
  data?: {
    inventoryItem?: {
      id: string;
      sku: string | null;
      variant: { product: { title: string } } | null;
    } | null;
  };
};

export async function enrichInventoryLevel(input: {
  shopDomain: string;
  inventoryItemId: string | number;
  locationId: string | number;
  available: number;
}): Promise<InventorySnapshot | undefined> {
  const token = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  const apiVersion = process.env.SHOPIFY_API_VERSION || "2026-10";
  const rawId = String(input.inventoryItemId);
  const gid = rawId.startsWith("gid://") ? rawId : `gid://shopify/InventoryItem/${rawId}`;
  const locationId = String(input.locationId);

  if (token) {
    const response = await fetch(
      `https://${input.shopDomain}/admin/api/${apiVersion}/graphql.json`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-shopify-access-token": token,
        },
        body: JSON.stringify({ query: INVENTORY_ITEM_QUERY, variables: { id: gid } }),
        signal: AbortSignal.timeout(10_000),
      }
    );

    if (!response.ok) {
      throw new Error(`Shopify GraphQL request failed (${response.status})`);
    }

    const payload = (await response.json()) as InventoryItemResponse;
    const item = payload.data?.inventoryItem;
    if (item?.sku) {
      return {
        sku: item.sku,
        productTitle: item.variant?.product.title ?? item.sku,
        inventoryItemId: item.id,
        locationId,
        available: input.available,
        source: "shopify",
      };
    }
  }

  const product = findProduct(gid);
  if (!product) return undefined;

  return {
    sku: product.sku,
    productTitle: product.title,
    inventoryItemId: product.inventoryItemId,
    locationId: locationId || product.locationId,
    available: input.available,
    source: "catalog",
  };
}
