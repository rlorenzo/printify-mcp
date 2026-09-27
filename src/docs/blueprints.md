# Blueprints

A blueprint is a base product type (t-shirt, mug, poster). Its ID decides which print providers and print positions are available.

```javascript
get_blueprints({ page: 1, limit: 10 })   // id, title, brand, model
get_blueprint({ blueprintId: "12" })     // full record
```

Example: `{ "id": 12, "title": "Unisex Jersey Short Sleeve Tee", "brand": "Bella+Canvas", "model": "3001" }`

**Next:** `get_print_providers({ blueprintId: "12" })`
