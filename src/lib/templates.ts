import type { InventorySnapshot, PurchaseOrder, Recommendation, SupplierQuote } from "./types";

export function formatRfqEmail(input: {
  supplierName: string;
  storeName: string;
  sku: string;
  productTitle: string;
  quantity: number;
}): string {
  return [
    `Hello ${input.supplierName} team,`,
    "",
    `${input.storeName} is requesting a quote for replenishment of the following item:`,
    "",
    `- SKU: ${input.sku}`,
    `- Description: ${input.productTitle}`,
    `- Quantity: ${input.quantity} units`,
    `- Requested delivery: earliest available; please state lead time`,
    "",
    "Please include the unit price at this quantity, any price breaks, lead time in business days, payment terms, and shipping cost. If you cannot fulfill the full quantity, let us know the partial quantity available.",
    "",
    "Thank you,",
    `${input.storeName} procurement`,
  ].join("\n");
}

export function formatCounterofferEmail(input: {
  supplierName: string;
  storeName: string;
  productTitle: string;
  quantity: number;
  targetUnitPrice: number | null;
  targetLeadTimeDays: number | null;
}): string {
  const asks: string[] = [];
  if (input.targetUnitPrice != null) {
    asks.push(`a unit price of $${input.targetUnitPrice.toFixed(2)}`);
  }
  if (input.targetLeadTimeDays != null) {
    asks.push(`a lead time of ${input.targetLeadTimeDays} days`);
  }
  const ask = asks.length > 0 ? asks.join(" and ") : "better pricing or a shorter lead time";

  return [
    `Hello ${input.supplierName} team,`,
    "",
    `Thank you for quoting ${input.quantity} × ${input.productTitle}.`,
    `We would like to move forward, but we need ${ask}.`,
    "",
    "If that works for you, please reply with the revised quote and we will issue the purchase order.",
    "",
    "Thank you,",
    `${input.storeName} procurement`,
  ].join("\n");
}

export function formatQuestionReplyEmail(input: {
  supplierName: string;
  storeName: string;
  sku: string;
  productTitle: string;
  quantity: number;
  answer: string;
}): string {
  return [
    `Hello ${input.supplierName} team,`,
    "",
    input.answer.trim(),
    "",
    `When you are ready, please reply with your quote for ${input.quantity} × ${input.productTitle} (${input.sku}), including unit price, lead time in business days, payment terms, and shipping cost.`,
    "",
    "Thank you,",
    `${input.storeName} procurement`,
  ].join("\n");
}

export function formatApprovalEmail(input: {
  inventory: InventorySnapshot;
  recommendation: Recommendation;
  quotes: SupplierQuote[];
}): string {
  const { inventory, recommendation: rec, quotes } = input;
  const rows = quotes
    .map((q) => {
      const landed = q.unitPrice * rec.quantity + q.shippingCost;
      return `- ${q.supplierName}: $${landed.toFixed(2)} landed ($${q.unitPrice.toFixed(2)}/unit + $${q.shippingCost.toFixed(2)} shipping), ${q.leadTimeDays}d`;
    })
    .join("\n");

  return [
    `The procurement agent recommends ordering ${rec.quantity} × ${inventory.productTitle} (${inventory.sku}) from ${rec.supplierName.replace(/\.+$/, "")}.`,
    "",
    `  Unit price: $${rec.unitPrice.toFixed(2)}`,
    `  Shipping:   $${rec.shippingCost.toFixed(2)}`,
    `  Total:      $${rec.total.toFixed(2)} USD (${rec.paymentTerms})`,
    `  Lead time:  ${rec.leadTimeDays} days`,
    "",
    `Why: ${rec.rationale}`,
    rec.risks.length ? `Risks:\n${rec.risks.map((r) => `- ${r}`).join("\n")}` : "",
    "",
    `All quotes:\n${rows}`,
    "",
    `Reply APPROVE or REJECT (you may add delivery notes).`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatPurchaseOrderEmail(input: {
  po: PurchaseOrder;
  storeName: string;
  storeAddress: string;
}): string {
  const { po, storeName, storeAddress } = input;
  return [
    `Hi ${po.supplierName} team,`,
    "",
    `Please confirm receipt of Purchase Order ${po.number}:`,
    "",
    `  Product:            ${po.productTitle} (${po.sku})`,
    `  Quantity:           ${po.quantity} units`,
    `  Unit price:         $${po.unitPrice.toFixed(2)}`,
    `  Shipping:           $${po.shippingCost.toFixed(2)}`,
    `  Total:              $${po.total.toFixed(2)} USD`,
    `  Payment terms:      ${po.paymentTerms}`,
    `  Requested delivery: ${po.requestedDeliveryDate} (${po.leadTimeDays}d lead)`,
    `  Ship to:            ${storeName}, ${storeAddress}`,
    po.approvalNote ? `  Owner notes:        ${po.approvalNote}` : "",
    "",
    `Approved by ${po.approvedBy} on ${po.approvedAt}.`,
    "",
    `Thank you,\n${storeName} procurement`,
  ]
    .filter(Boolean)
    .join("\n");
}
