# Publishing

- **Pop-Up Store:** products are added to your store automatically and `publish_product` is not needed. Products can take a few minutes to appear. If one doesn't, check that its variants are enabled and priced and that its print areas have images. The store URL is usually `[your-shop-name].printify.me`.
- **External channels (Shopify, Etsy, ...):** publish after creating or updating a product:

  ```javascript
  publish_product({ productId: "..." })
  publish_product({
    productId: "...",
    publishDetails: { title: true, description: true, images: true, variants: true, tags: true }
  })
  ```

Managing products: `get_product`, `update_product`, `delete_product`, `list_products`.

## Custom (API) sales channels

Shopify, Etsy and similar channels report the result of a publish themselves. A custom channel connected through the API must report it, or the product stays locked as "publishing" in Printify. After `publish_product`, report exactly one outcome.

If the listing was created:

```javascript
set_publish_succeeded({ productId: "p1", externalId: "5941187e", handle: "https://example.com/products/p1" })
```

If it failed:

```javascript
set_publish_failed({ productId: "p1", reason: "Request timed out" })
```

Later, if a published listing is taken down from the channel:

```javascript
notify_unpublished({ productId: "p1" })
```
