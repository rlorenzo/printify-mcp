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
