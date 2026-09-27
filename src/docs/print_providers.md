# Print Providers

Print providers print and ship the product. They differ in quality, price, production time, and location, and each one determines which variants (colors, sizes) are available for a blueprint.

```javascript
get_print_providers({ blueprintId: "12" })   // e.g. [{ id: 29, title: "Monster Digital" }, ...]
```

**Next:** `get_variants({ blueprintId: "12", printProviderId: "29" })`
