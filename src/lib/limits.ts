import { concurrencyLimit } from "@trigger.dev/sdk";

export const shopifyApiLimit = concurrencyLimit({
  name: "shopify-api",
  perKey: 2,
  total: 10,
});

export const modelCallLimit = concurrencyLimit({
  name: "llm-calls",
  total: 6,
});
