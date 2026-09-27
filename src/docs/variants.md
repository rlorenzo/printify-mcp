# Variants

A variant is one purchasable option, such as a color and size combination, for a blueprint from a specific print provider. Each has an ID and a cost (what you pay the provider). You set the retail price.

```javascript
get_variants({ blueprintId: "12", printProviderId: "29", page: 1, limit: 50 })
```

Example: `{ "id": 18100, "title": "Black / S", "options": { "color": "Black", "size": "S" } }`

The response also lists the available placeholder positions (front, back, ...).

In `create_product`, list the variants to sell with prices in cents:

```javascript
variants: [
  { variantId: 18100, price: 2499 },                     // $24.99
  { variantId: 18101, price: 2499, isEnabled: false }    // isEnabled defaults to true
]
```

**Next:** upload artwork with `upload_image` or `generate_and_upload_image`.
