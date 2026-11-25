export type Supplier = {
  id: string;
  name: string;
  email: string;
  rating: number;
  avgLeadTimeDays: number;
  paymentTerms: string;
};

export type CatalogProduct = {
  sku: string;
  title: string;
  inventoryItemId: string;
  locationId: string;
  reorderPoint: number;
  reorderQuantity: number;
  targetUnitPrice: number;
  supplierIds: string[];
};

export type InventorySnapshot = {
  sku: string;
  productTitle: string;
  inventoryItemId: string;
  locationId: string;
  available: number;
  source: "shopify" | "catalog";
};

export type SupplierQuote = {
  supplierId: string;
  supplierName: string;
  unitPrice: number;
  currency: string;
  moq: number;
  leadTimeDays: number;
  shippingCost: number;
  paymentTerms: string;
  notes: string;
  round: number;
};

export type InboundReply = {
  emailId: string;
  inboxId?: string;
  threadId?: string;
  from: string;
  subject: string;
  text: string;
};

export type Recommendation = {
  supplierId: string;
  supplierName: string;
  unitPrice: number;
  quantity: number;
  leadTimeDays: number;
  shippingCost: number;
  total: number;
  paymentTerms: string;
  rationale: string;
  risks: string[];
};

export type ApprovalDecision = {
  status: "approved" | "rejected";
  approvedBy: string;
  decidedAt: string;
  note?: string;
};

export type PurchaseOrder = {
  number: string;
  caseId: string;
  supplierId: string;
  supplierName: string;
  supplierEmail: string;
  sku: string;
  productTitle: string;
  quantity: number;
  unitPrice: number;
  shippingCost: number;
  total: number;
  leadTimeDays: number;
  paymentTerms: string;
  requestedDeliveryDate: string;
  approvedBy: string;
  approvedAt: string;
  approvalNote?: string;
  placedAt: string;
  emailId?: string;
};

export type CaseStatus =
  | "negotiating"
  | "awaiting_approval"
  | "rejected"
  | "ordered"
  | "no_quotes";

export type ProcurementCase = {
  id: string;
  shopDomain: string;
  sku: string;
  productTitle: string;
  available: number;
  orderQuantity: number;
  status: CaseStatus;
  quotes: SupplierQuote[];
  recommendation?: Recommendation;
  approval?: ApprovalDecision;
  purchaseOrder?: PurchaseOrder;
  createdAt: string;
  updatedAt: string;
};
