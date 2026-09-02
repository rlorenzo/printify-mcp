=== DETAILED DOCUMENTATION: PRODUCT CREATION WORKFLOW ===

This guide provides EXACT step-by-step instructions for creating a product in Printify.

## STEP-BY-STEP PRODUCT CREATION WORKFLOW

### STEP 1: CHOOSE A BLUEPRINT

```javascript
// Get a list of all available blueprints
get_blueprints_printify()
```

The response will contain a list of blueprints. Each blueprint has:
- id: The unique identifier (REQUIRED for next steps)
- title: The name of the product
- description: Details about the product
- brand: The manufacturer

EXAMPLE RESPONSE (partial):
```json
[
  {
    "id": 12,
    "title": "Unisex Jersey Short Sleeve Tee",
    "description": "Description goes here",
    "brand": "Bella+Canvas",
    "model": "3001"
  },
  // More blueprints...
]
```

**ACTION:** Select a blueprint ID from the list (e.g., 12 for "Unisex Jersey Short Sleeve Tee").

### STEP 2: CHOOSE A PRINT PROVIDER

```javascript
// Get print providers for your selected blueprint
get_print_providers_printify({ blueprintId: "12" }) // Replace 12 with your chosen blueprint ID
```

The response will contain available print providers for this blueprint:

EXAMPLE RESPONSE:
```json
[
  { "id": 29, "title": "Monster Digital" },
  { "id": 16, "title": "MyLocker" },
  // More providers...
]
```

**ACTION:** Select a print provider ID (e.g., 29 for "Monster Digital").

### STEP 3: GET VARIANTS

```javascript
// Get available variants (sizes, colors, etc.)
get_variants_printify({
  blueprintId: "12",      // Replace with your blueprint ID
  printProviderId: "29"  // Replace with your print provider ID
})
```

The response will contain all available variants (combinations of colors, sizes, etc.):

EXAMPLE RESPONSE (partial):
```json
{
  "id": 29,
  "title": "Monster Digital",
  "variants": [
    {
      "id": 18100,
      "title": "Black / S",
      "options": { "color": "Black", "size": "S" },
      "placeholders": [...]
    },
    {
      "id": 18101,
      "title": "Black / M",
      "options": { "color": "Black", "size": "M" },
      "placeholders": [...]
    },
    // More variants...
  ]
}
```

**ACTION:** Select the variant IDs you want to offer (e.g., 18100, 18101, 18102 for Black in S, M, L sizes).

### STEP 4: UPLOAD IMAGES

You have two options for uploading images:

#### Option A: Upload an existing image

```javascript
// Upload from a URL or local file
upload_image({
  fileName: "front-design.png",
  url: "path/to/image.png"  // Can be a URL, local file path, or base64 data
})
```

#### Option B: Generate and upload an AI image

```javascript
// Generate an image with AI and upload it directly
generate_and_upload_image({
  prompt: "futuristic cityscape with neon lights",
  fileName: "front-design.png",
  // Optional parameters:
  width: 1024,                // Default: 1024
  height: 1024,               // Default: 1024
  aspectRatio: "1:1",         // Overrides width/height if provided
  numInferenceSteps: 25,      // Default: 25
  guidanceScale: 7.5,         // Default: 7.5
  negativePrompt: "low quality, bad quality",  // Default provided
  seed: 12345                 // Optional: for reproducible results
})
```

Both methods will return an image object with an ID you'll need for the next step:

EXAMPLE RESPONSE:
```json
{
  "id": "680325163d2a2ac0a2d2937c",
  "file_name": "front-design.png",
  "height": 1024,
  "width": 1024,
  "size": 1138575,
  "mime_type": "image/png",
  "preview_url": "https://images.printify.com/mockup/680325163d2a2ac0a2d2937c/12.png",
  "upload_time": "2023-10-09 07:29:43"
}
```

**ACTION:**
1. Upload images for all print positions you need (front, back, etc.)
2. Save the image IDs for each position

### STEP 5: CREATE THE PRODUCT

```javascript
// Create the product with all gathered information
create_product({
  title: "Horizon City Skyline T-Shirt",  // Product title
  description: "Step into the future with our Horizon City Skyline T-Shirt. This premium unisex tee features a stunning futuristic cityscape with neon lights and towering skyscrapers.",  // Detailed description

  // IDs from previous steps
  blueprintId: 12,            // From Step 1
  printProviderId: 29,        // From Step 2

  // Variants from Step 3 with pricing (in cents)
  variants: [
    { variantId: 18100, price: 2499 },  // Black / S for $24.99
    { variantId: 18101, price: 2499 },  // Black / M for $24.99
    { variantId: 18102, price: 2499 }   // Black / L for $24.99
  ],

  // Print areas with image IDs from Step 4
  printAreas: {
    "front": { position: "front", imageId: "680325163d2a2ac0a2d2937c" },
    "back": { position: "back", imageId: "680325163d2a2ac0a2d2937d" }
  }
})
```

The response will contain the complete product information:

EXAMPLE RESPONSE (partial):
```json
{
  "id": "68032b43a24efbac6502b6f7",
  "title": "Horizon City Skyline T-Shirt",
  "description": "Step into the future with our Horizon City Skyline T-Shirt...",
  "variants": [...],
  "images": [...],
  "created_at": "2023-10-09 13:52:17+00:00",
  "updated_at": "2023-10-09 13:52:18+00:00",
  "visible": true,
  "is_locked": false,
  "blueprint_id": 12,
  "print_provider_id": 29,
  "print_areas": [...]
}
```

**ACTION:** Your product is now created! The product ID in the response can be used to update or publish the product later.

## COMPLETE REAL-WORLD EXAMPLE

Here's a complete example of creating a t-shirt with front and back designs:

```javascript
// Step 1: Get blueprints and choose one
get_blueprints()
// Selected blueprint ID 12 (Unisex Jersey Short Sleeve Tee)

// Step 2: Get print providers for this blueprint
get_print_providers({ blueprintId: "12" })
// Selected print provider ID 29 (Monster Digital)

// Step 3: Get variants for this blueprint and print provider
get_variants({ blueprintId: "12", printProviderId: "29" })
// Selected variant IDs 18100 (Black / S), 18101 (Black / M), 18102 (Black / L)

// Step 4: Generate and upload front image
const frontImage = await generate_and_upload_image({
  prompt: "A futuristic cityscape with neon lights and tall skyscrapers, horizon city logo design",
  fileName: "horizon-city-front"
})
// Got image ID: 68032b22ae74bf725ed406ec

// Step 4b: Generate and upload back image
const backImage = await generate_and_upload_image({
  prompt: "A minimalist 'Horizon City' text logo with futuristic font, suitable for the back of a t-shirt",
  fileName: "horizon-city-back"
})
// Got image ID: 68032b377e36fbdd32791027

// Step 5: Create the product
create_product({
  title: "Horizon City Skyline T-Shirt",
  description: "Step into the future with our Horizon City Skyline T-Shirt. This premium unisex tee features a stunning futuristic cityscape with neon lights and towering skyscrapers on the front, and a sleek minimalist Horizon City logo on the back.",
  blueprintId: 12,
  printProviderId: 29,
  variants: [
    { variantId: 18100, price: 2499 },
    { variantId: 18101, price: 2499 },
    { variantId: 18102, price: 2499 }
  ],
  printAreas: {
    "front": { position: "front", imageId: "68032b22ae74bf725ed406ec" },
    "back": { position: "back", imageId: "68032b377e36fbdd32791027" }
  }
})
// Product created with ID: 68032b43a24efbac6502b6f7
```

## IMPORTANT NOTES

1. **Pricing:** All prices are in cents (e.g., 2499 = $24.99).

2. **Variants:** Only enable the variants you want to sell. Each variant has a cost (what you pay) and a price (what customers pay).

3. **Images:** Make sure your images meet the requirements for the specific product. Generally:
   - High resolution (at least 300 DPI)
   - PNG or JPEG format
   - Appropriate dimensions for the print area

4. **Print Areas:** Different products have different available print areas. Common ones include:
   - front
   - back
   - left_sleeve
   - right_sleeve

   The `printAreas` object above applies the same artwork to every variant.
   Printify actually scopes print areas to variant IDs, so to give different
   colorways different artwork, pass a list of groups instead:

   ```javascript
   printAreas: [
     { variantIds: [18100, 18101], placeholders: [{ position: "front", imageId: "..." }] },
     { variantIds: [18102], placeholders: [{ position: "front", imageId: "..." }] }
   ]
   ```

   On `update_product` the object form is merged into whatever groups the
   product already has: the placements it names are replaced everywhere, and
   the ones it does not name are left alone. Use the list form when an update
   should only touch some variants.

5. **Publishing:** Products created through the API are automatically added to your Printify catalog but may need to be published to external sales channels.
