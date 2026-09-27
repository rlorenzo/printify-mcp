# Product Creation Workflow

## 1. Choose a blueprint

```javascript
get_blueprints()                 // paged: { page, limit }
get_blueprint({ blueprintId: "12" })
```

A blueprint is a base product, such as 12 for "Unisex Jersey Short Sleeve Tee".

## 2. Choose a print provider

```javascript
get_print_providers({ blueprintId: "12" })   // e.g. [{ id: 29, title: "Monster Digital" }, ...]
```

## 3. Choose variants

```javascript
get_variants({ blueprintId: "12", printProviderId: "29" })
```

The response lists variant IDs with their options (e.g. 18100 = "Black / S") and the available placeholder positions (front, back, ...).

## 4. Upload images

```javascript
upload_image({ fileName: "front.png", url: "https://example.com/front.png" })   // URL, local path, or data: URL
generate_and_upload_image({ prompt: "futuristic neon cityscape", fileName: "front.png" })
```

Each upload returns an image `id` to use in `printAreas`. See `how_to_use({ topic: "images" })`.

## 5. Create the product

```javascript
create_product({
  title: "Horizon City Skyline T-Shirt",
  description: "A neon cityscape on a premium unisex tee.",
  blueprintId: 12,
  printProviderId: 29,
  variants: [
    { variantId: 18100, price: 2499 },   // price in cents: $24.99
    { variantId: 18101, price: 2499 },
    { variantId: 18102, price: 2499 }
  ],
  printAreas: {
    front: { position: "front", imageId: "680325163d2a2ac0a2d2937c" },
    back:  { position: "back",  imageId: "680325163d2a2ac0a2d2937d" }
  }
})
```

The response includes the product ID, which you need for `update_product` and `publish_product`.

## Notes

- **Prices** are in cents. Only list the variants you want to sell.
- **Positions** depend on the blueprint. Common ones are `front`, `back`, `left_sleeve`, and `right_sleeve`.
- **Per-colorway artwork:** the object form of `printAreas` applies to every variant. To use different artwork for different variants, pass a list of groups:

  ```javascript
  printAreas: [
    { variantIds: [18100, 18101], placeholders: [{ position: "front", imageId: "..." }] },
    { variantIds: [18102],        placeholders: [{ position: "front", imageId: "..." }] }
  ]
  ```

- **Updating print areas:** in `update_product`, the object form is merged into the product's existing groups. Named positions are replaced everywhere and the rest are kept. The list form replaces all print areas. `{}` or `[]` clears them, and leaving out `printAreas` keeps them unchanged.
- **Publishing:** new products are added to your Printify catalog but must be published to reach a sales channel. See `how_to_use({ topic: "publishing" })`.
