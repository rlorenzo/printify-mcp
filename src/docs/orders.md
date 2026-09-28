# Orders

Read the current shop's orders and quote shipping before ordering. Amounts are converted from Printify's cents.

```javascript
list_orders({ status: "on-hold", page: 1, limit: 10 })   // summaries: id, status, recipient, item count, total
get_order({ orderId: "5a96f649b2439217" })              // items, costs, shipping address, tracking
```

`list_orders` leaves out street addresses and contact details; `get_order` returns them for one order.

Quote shipping for items that are not ordered yet. Give the full recipient address: Printify may reject a partial one. Identify each item by `productId` + `variantId`, by `printProviderId` + `blueprintId` + `variantId`, or by `sku`:

```javascript
calculate_order_shipping({
  lineItems: [{ productId: "5bfd0b66a342bcc9b5563216", variantId: 17887, quantity: 2 }],
  address: {
    firstName: "Ada", lastName: "Lovelace", email: "ada@example.com", phone: "555-0100",
    address1: "1 Main St", city: "New York", region: "NY", zip: "10001", country: "US"
  }
})
// Rates per method, e.g. { Standard: "4.99", Express: "12.99" }
```

Nothing is ordered by these tools.
