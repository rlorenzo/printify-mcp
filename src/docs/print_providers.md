# Print Providers

Print providers print and ship the product. They differ in quality, price, production time, and location, and each one determines which variants (colors, sizes) are available for a blueprint.

```javascript
get_print_providers({ blueprintId: "12" })   // e.g. [{ id: 29, title: "Monster Digital" }, ...]
```

To browse providers directly, `list_all_print_providers()` lists them all with their location, and `get_print_provider({ printProviderId: "29" })` shows the blueprints one provider offers.

Compare shipping before choosing. Costs are in the provider's currency, for the first item and each additional one:

```javascript
get_shipping({ blueprintId: "12", printProviderId: "29", country: "US" })
```

**Next:** `get_variants({ blueprintId: "12", printProviderId: "29" })`
