import type { CatalogProduct, Supplier } from "./types";

export const SUPPLIERS: Record<string, Supplier> = {
  sup_north: {
    id: "sup_north",
    name: "Northstar Components",
    email: process.env.SUPPLIER_EMAIL_1 || "quotes@northstar-components.example",
    rating: 4.6,
    avgLeadTimeDays: 18,
    paymentTerms: "Net 30",
  },
  sup_harbor: {
    id: "sup_harbor",
    name: "Harbor Supply Co.",
    email: process.env.SUPPLIER_EMAIL_2 || "sales@harbor-supply.example",
    rating: 4.8,
    avgLeadTimeDays: 6,
    paymentTerms: "Net 15",
  },
  sup_pacific: {
    id: "sup_pacific",
    name: "Pacific Barista Works",
    email: process.env.SUPPLIER_EMAIL_3 || "orders@pacific-barista.example",
    rating: 4.4,
    avgLeadTimeDays: 9,
    paymentTerms: "Net 30",
  },
};

export const PRODUCTS: Record<string, CatalogProduct> = {
  "ESP-GASKET-58": {
    sku: "ESP-GASKET-58",
    title: "58mm E61 Group Head Gasket",
    inventoryItemId: "gid://shopify/InventoryItem/4501001001",
    locationId: "gid://shopify/Location/7801001",
    reorderPoint: 20,
    reorderQuantity: 50,
    targetUnitPrice: 9.0,
    supplierIds: ["sup_north", "sup_harbor", "sup_pacific"],
  },
  "BURRS-64": {
    sku: "BURRS-64",
    title: "64mm Flat Burr Set (Red Speed)",
    inventoryItemId: "gid://shopify/InventoryItem/4501002001",
    locationId: "gid://shopify/Location/7801001",
    reorderPoint: 10,
    reorderQuantity: 50,
    targetUnitPrice: 68.0,
    supplierIds: ["sup_north", "sup_pacific"],
  },
  "PITCHER-20": {
    sku: "PITCHER-20",
    title: "20oz Stainless Milk Pitcher",
    inventoryItemId: "gid://shopify/InventoryItem/4501003001",
    locationId: "gid://shopify/Location/7801001",
    reorderPoint: 25,
    reorderQuantity: 100,
    targetUnitPrice: 10.5,
    supplierIds: ["sup_harbor", "sup_pacific"],
  },
};

export function findProduct(skuOrInventoryItemId: string | number): CatalogProduct | undefined {
  const value = String(skuOrInventoryItemId);
  return (
    PRODUCTS[value] ??
    Object.values(PRODUCTS).find(
      (product) =>
        product.inventoryItemId === value || product.inventoryItemId.endsWith(`/${value}`)
    )
  );
}

export function suppliersForProduct(product: CatalogProduct): Supplier[] {
  return product.supplierIds
    .map((id) => SUPPLIERS[id])
    .filter((supplier): supplier is Supplier => Boolean(supplier));
}
