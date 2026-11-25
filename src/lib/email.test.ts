import assert from "node:assert/strict";
import test from "node:test";
import {
  bareAddress,
  getEmailMode,
  isMockMode,
  sendEmail,
  stripQuotedReply,
} from "./email";
import {
  formatApprovalEmail,
  formatCounterofferEmail,
  formatPurchaseOrderEmail,
  formatQuestionReplyEmail,
  formatRfqEmail,
} from "./templates";

const harbor = { id: "sup_harbor", email: "sales@harbor-supply.example" };

test("mock mode logs emails locally and never sends real mail", async () => {
  const saved = process.env.EMAIL_MODE;
  process.env.EMAIL_MODE = "mock";
  try {
    assert.equal(getEmailMode(), "mock");
    assert.equal(isMockMode(), true);
    const sent = await sendEmail({
      to: harbor.email,
      subject: "RFQ",
      text: "Hi",
      idempotencyKey: "rfq-email:case1",
    });
    assert.equal(sent.id, "mock_rfq-email:case1");
  } finally {
    if (saved === undefined) delete process.env.EMAIL_MODE;
    else process.env.EMAIL_MODE = saved;
  }
});

test("resend mode switches getEmailMode to resend", () => {
  const saved = process.env.EMAIL_MODE;
  process.env.EMAIL_MODE = "resend";
  try {
    assert.equal(getEmailMode(), "resend");
    assert.equal(isMockMode(), false);
  } finally {
    if (saved === undefined) delete process.env.EMAIL_MODE;
    else process.env.EMAIL_MODE = saved;
  }
});

test("bareAddress extracts lowercase address from display names", () => {
  assert.equal(bareAddress("Harbor Supply <Sales@Harbor.Example>"), "sales@harbor.example");
  assert.equal(bareAddress("owner@example.com"), "owner@example.com");
});

test("stripQuotedReply drops quoted thread history", () => {
  const email = [
    "We can do $8.85 per unit, 5 day lead time.",
    "",
    "On Mon, Nov 22, 2026 at 9:00 AM Acme Procurement wrote:",
    "> Previous price was $9.50 per unit.",
  ].join("\n");

  assert.equal(stripQuotedReply(email), "We can do $8.85 per unit, 5 day lead time.");
});

test("email templates render RFQ, counteroffer, question reply, and PO bodies cleanly", () => {
  const rfq = formatRfqEmail({
    supplierName: "Harbor Supply",
    storeName: "Acme Coffee Works",
    sku: "ESP-GASKET-58",
    productTitle: "58mm E61 Group Head Gasket",
    quantity: 50,
  });
  assert.match(rfq, /SKU: ESP-GASKET-58/);
  assert.match(rfq, /Quantity: 50 units/);

  const counter = formatCounterofferEmail({
    supplierName: "Harbor Supply",
    storeName: "Acme Coffee Works",
    productTitle: "58mm E61 Group Head Gasket",
    quantity: 50,
    targetUnitPrice: 8.5,
    targetLeadTimeDays: 5,
  });
  assert.match(counter, /a unit price of \$8\.50 and a lead time of 5 days/);

  const answerReply = formatQuestionReplyEmail({
    supplierName: "Harbor Supply",
    storeName: "Acme Coffee Works",
    sku: "ESP-GASKET-58",
    productTitle: "58mm E61 Group Head Gasket",
    quantity: 50,
    answer: "Delivery is to our San Francisco warehouse within 14 days.",
  });
  assert.match(answerReply, /Delivery is to our San Francisco warehouse within 14 days\./);
  assert.match(answerReply, /please reply with your quote for 50 × 58mm E61 Group Head Gasket/);

  const po = formatPurchaseOrderEmail({
    po: {
      number: "PO-2026-ABC123",
      caseId: "pc_abc123",
      supplierId: harbor.id,
      supplierName: "Harbor Supply",
      supplierEmail: harbor.email,
      sku: "ESP-GASKET-58",
      productTitle: "58mm E61 Group Head Gasket",
      quantity: 50,
      unitPrice: 8.5,
      shippingCost: 95,
      total: 520,
      leadTimeDays: 5,
      paymentTerms: "Net 15",
      requestedDeliveryDate: "2026-12-01",
      approvedBy: "owner@example.com",
      approvedAt: "2026-11-24T00:00:00.000Z",
      placedAt: "2026-11-24T00:00:01.000Z",
    },
    storeName: "Acme Coffee Works",
    storeAddress: "1450 Valencia St, San Francisco, CA 94110",
  });
  assert.match(po, /Purchase Order PO-2026-ABC123/);
});

test("formatApprovalEmail lists recommendation and all supplier quotes", () => {
  const email = formatApprovalEmail({
    inventory: {
      sku: "ESP-GASKET-58",
      productTitle: "58mm E61 Group Head Gasket",
      inventoryItemId: "gid://shopify/InventoryItem/1",
      locationId: "gid://shopify/Location/1",
      available: 12,
      source: "catalog",
    },
    recommendation: {
      supplierId: harbor.id,
      supplierName: "Harbor Supply Co.",
      unitPrice: 8.75,
      quantity: 50,
      leadTimeDays: 6,
      shippingCost: 95,
      total: 532.5,
      paymentTerms: "Net 15",
      rationale: "Lowest landed cost and fastest lead time.",
      risks: ["Net 15 terms"],
    },
    quotes: [
      {
        supplierId: harbor.id,
        supplierName: "Harbor Supply Co.",
        unitPrice: 8.75,
        currency: "USD",
        moq: 50,
        leadTimeDays: 6,
        shippingCost: 95,
        paymentTerms: "Net 15",
        notes: "",
        round: 2,
      },
    ],
  });

  assert.match(email, /Harbor Supply Co\./);
  assert.match(email, /\$532\.50 USD/);
  assert.match(email, /Reply APPROVE or REJECT/);
});
