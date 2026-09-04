# `index.ts` Documentation

## Overview

`index.ts` is the main entry point for the Printify MCP (Model Context Protocol) server. It initializes the MCP server, sets up API clients for Printify and Replicate, and defines all the tools that the server exposes to AI assistants.

## Dependencies

- `@modelcontextprotocol/sdk/server/mcp.js`: The MCP server implementation
- `@modelcontextprotocol/sdk/server/stdio.js`: The stdio transport for MCP
- `zod`: Schema validation library
- `./printify-api.js`: Custom Printify API client
- `./replicate-client.js`: Custom Replicate API client
- `dotenv`: Environment variable loader
- `fs`: File system module
- `sharp`: Image processing library
- `path`: Path manipulation module

## Main Components

### MCP Server Initialization

```typescript
// Create an MCP server
const server = new McpServer({
  name: "Printify-MCP",
  version: "1.0.0"
});
```

### API Client Initialization

The server initializes two API clients:

1. **Printify API Client**: For interacting with Printify's API
2. **Replicate API Client**: For generating images using AI

```typescript
// Auto-initialize the API clients when the server starts
(async () => {
  try {
    // Initialize Printify API client
    const printifyApiKey = process.env.PRINTIFY_API_KEY;

    if (!printifyApiKey) {
      console.error("PRINTIFY_API_KEY environment variable is not set. The Printify API client will not be initialized.");
    } else {
      // Create the client with the API key and shop ID if available
      printifyClient = new PrintifyAPI(printifyApiKey, process.env.PRINTIFY_SHOP_ID);

      // Initialize the client and fetch shops
      const shops = await printifyClient.initialize();
      
      // ...
    }

    // Initialize Replicate API client if environment variable is set
    const replicateApiToken = process.env.REPLICATE_API_TOKEN;

    if (!replicateApiToken) {
      console.error("REPLICATE_API_TOKEN environment variable is not set. The Replicate API client will not be initialized.");
    } else {
      replicateClient = new ReplicateClient(replicateApiToken);
      console.log('Replicate API client initialized successfully.');
    }
  } catch (error) {
    console.error("Error initializing API clients:", error);
  }
})();
```

### Image Processing Helper

The server includes a helper function for converting images using Sharp:

```typescript
// Helper function to convert images using Sharp
async function convertImageWithSharp(inputPath: string): Promise<{ buffer: Buffer, mimeType: string }> {
  // ...
}
```

## Exposed Tools

The server exposes the following tools to AI assistants:

### Printify Status and Shop Management

1. **get_printify_status**: Get the current status of the Printify API client
2. **list_shops**: List all available shops in the Printify account
3. **switch_shop**: Switch to a different shop

### Product Management

4. **list_products**: List products in the current shop
5. **get_product**: Get details of a specific product
6. **create_product**: Create a new product
7. **update_product**: Update an existing product
8. **delete_product**: Delete a product
9. **publish_product**: Publish a product to external sales channels

### Blueprint and Variant Management

10. **get_blueprints**: Get available product blueprints
11. **get_blueprint**: Get details of a specific blueprint
12. **get_print_providers**: Get print providers for a blueprint
13. **get_variants**: Get variants for a blueprint and print provider

### Image Management

14. **upload_image**: Upload an image to Printify
15. **generate_and_upload_image**: Generate an image with AI and upload it to Printify

### Documentation

16. **how_to_use**: Get detailed documentation on various topics

### Prompts

17. **generate_product_description**: Generate a product description using AI

## Tool Implementation Details

### get_printify_status

Gets the current status of the Printify API client, including connection status, available shops, and current shop.

```typescript
server.tool(
  "get_printify_status",
  {},
  async () => {
    // ...
  }
);
```

### list_shops

Lists all available shops in the Printify account.

```typescript
server.tool(
  "list_shops",
  {},
  async () => {
    // ...
  }
);
```

### switch_shop

Switches to a different shop by ID.

```typescript
server.tool(
  "switch_shop",
  {
    shopId: z.string().describe("The ID of the shop to switch to")
  },
  async ({ shopId }) => {
    // ...
  }
);
```

### list_products

Lists products in the current shop with pagination.

```typescript
server.tool(
  "list_products",
  {
    page: z.number().optional().default(1).describe("Page number"),
    limit: z.number().optional().default(10).describe("Number of products per page")
  },
  async ({ page, limit }) => {
    // ...
  }
);
```

### get_product

Gets details of a specific product by ID.

```typescript
server.tool(
  "get_product",
  {
    productId: z.string().describe("Product ID")
  },
  async ({ productId }) => {
    // ...
  }
);
```

### create_product

Creates a new product with the specified details.

```typescript
server.tool(
  "create_product",
  {
    title: z.string().describe("Product title"),
    description: z.string().describe("Product description"),
    blueprintId: z.number().describe("Blueprint ID"),
    printProviderId: z.number().describe("Print provider ID"),
    variants: z.array(z.object({
      variantId: z.number().describe("Variant ID"),
      price: z.number().describe("Price in cents (e.g., 1999 for $19.99)"),
      isEnabled: z.boolean().optional().default(true).describe("Whether the variant is enabled")
    })).describe("Product variants"),
    printAreas: z.record(z.string(), z.object({
      position: z.string().describe("Print position (e.g., 'front', 'back')"),
      imageId: z.string().describe("Image ID from Printify uploads")
    })).optional().describe("Print areas for the product")
  },
  async ({ title, description, blueprintId, printProviderId, variants, printAreas }) => {
    // ...
  }
);
```

### update_product

Updates an existing product with the specified details.

```typescript
server.tool(
  "update_product",
  {
    productId: z.string().describe("Product ID"),
    title: z.string().optional().describe("Product title"),
    description: z.string().optional().describe("Product description"),
    variants: z.array(z.object({
      variantId: z.number().describe("Variant ID"),
      price: z.number().describe("Price in cents (e.g., 1999 for $19.99)"),
      isEnabled: z.boolean().optional().describe("Whether the variant is enabled")
    })).optional().describe("Product variants"),
    printAreas: z.record(z.string(), z.object({
      position: z.string().describe("Print position (e.g., 'front', 'back')"),
      imageId: z.string().describe("Image ID from Printify uploads")
    })).optional().describe("Print areas for the product")
  },
  async ({ productId, title, description, variants, printAreas }) => {
    // ...
  }
);
```

### delete_product

Deletes a product by ID.

```typescript
server.tool(
  "delete_product",
  {
    productId: z.string().describe("Product ID")
  },
  async ({ productId }) => {
    // ...
  }
);
```

### publish_product

Publishes a product to external sales channels.

```typescript
server.tool(
  "publish_product",
  {
    productId: z.string().describe("Product ID"),
    publishDetails: z.object({
      title: z.boolean().optional().default(true).describe("Publish title"),
      description: z.boolean().optional().default(true).describe("Publish description"),
      images: z.boolean().optional().default(true).describe("Publish images"),
      variants: z.boolean().optional().default(true).describe("Publish variants"),
      tags: z.boolean().optional().default(true).describe("Publish tags")
    }).optional().describe("Publish details")
  },
  async ({ productId, publishDetails }) => {
    // ...
  }
);
```

### get_blueprints

Gets available product blueprints with pagination.

```typescript
server.tool(
  "get_blueprints",
  {
    page: z.number().optional().default(1).describe("Page number"),
    limit: z.number().optional().default(10).describe("Number of blueprints per page")
  },
  async ({ page, limit }) => {
    // ...
  }
);
```

### get_blueprint

Gets details of a specific blueprint by ID.

```typescript
server.tool(
  "get_blueprint",
  {
    blueprintId: z.string().describe("Blueprint ID")
  },
  async ({ blueprintId }) => {
    // ...
  }
);
```

### get_print_providers

Gets print providers for a blueprint.

```typescript
server.tool(
  "get_print_providers",
  {
    blueprintId: z.string().describe("Blueprint ID")
  },
  async ({ blueprintId }) => {
    // ...
  }
);
```

### get_variants

Gets variants for a blueprint and print provider.

```typescript
server.tool(
  "get_variants",
  {
    blueprintId: z.string().describe("Blueprint ID"),
    printProviderId: z.string().describe("Print provider ID")
  },
  async ({ blueprintId, printProviderId }) => {
    // ...
  }
);
```

### upload_image

Uploads an image to Printify from a URL, local file, or base64 data.

```typescript
server.tool(
  "upload_image",
  {
    fileName: z.string().describe("File name"),
    url: z.string().describe("URL of the image to upload, path to local file, or base64 encoded image data")
  },
  async ({ fileName, url }) => {
    // ...
  }
);
```

### how_to_use

Provides detailed documentation on various topics.

```typescript
server.tool(
  "how_to_use",
  {
    topic: z.enum([
      "product-creation",
      "blueprints",
      "print-providers",
      "variants",
      "images",
      "publishing"
    ]).describe("The topic to get documentation for")
  },
  async ({ topic }) => {
    // ...
  }
);
```

### generate_product_description

Generates a product description using AI.

```typescript
server.prompt(
  "generate_product_description",
  {
    productName: z.string(),
    category: z.string(),
    targetAudience: z.string().optional(),
    keyFeatures: z.string().optional().describe("Comma-separated list of key features")
  },
  (args) => {
    // ...
  }
);
```

### generate_and_upload_image

Generates an image with AI and uploads it to Printify.

```typescript
server.tool(
  "generate_and_upload_image",
  {
    prompt: z.string().describe("Text prompt for image generation"),
    fileName: z.string().describe("File name for the uploaded image"),
    width: z.number().optional().default(1024).describe("Image width in pixels"),
    height: z.number().optional().default(1024).describe("Image height in pixels"),
    aspectRatio: z.string().optional().describe("Aspect ratio (e.g., '16:9', '4:3', '1:1'). If provided, overrides width and height"),
    numInferenceSteps: z.number().optional().default(25).describe("Number of inference steps"),
    guidanceScale: z.number().optional().default(7.5).describe("Guidance scale"),
    negativePrompt: z.string().optional().default("low quality, bad quality, sketches").describe("Negative prompt"),
    seed: z.number().optional().describe("Random seed for reproducible generation")
  },
  async ({ prompt, fileName, width, height, aspectRatio, numInferenceSteps, guidanceScale, negativePrompt, seed }) => {
    // ...
  }
);
```

## Error Handling

The server includes robust error handling for all tools, with detailed error messages to help troubleshoot issues. For example:

```typescript
catch (error: any) {
  // Extract detailed error information
  let errorMessage = `Error creating product: ${error.message}`;
  let detailedInfo = '';

  // Add status code if available
  if (error.statusCode) {
    errorMessage += ` (Status: ${error.statusCode} ${error.statusText || ''})`;
  }

  // Check if there's response data in the error
  if (error.details) {
    detailedInfo += `\n\nAPI Response: ${JSON.stringify(error.details, null, 2)}`;
  } else if (error.response && error.response.data) {
    detailedInfo += `\n\nAPI Response: ${JSON.stringify(error.response.data, null, 2)}`;
  }

  // Add the formatted data that was actually sent to the API
  if (error.formattedData) {
    detailedInfo += `\n\nFormatted Data Sent to API: ${JSON.stringify(error.formattedData, null, 2)}`;
  }

  // Add validation errors if they exist
  if (error.validationErrors) {
    detailedInfo += `\n\nValidation Errors: ${JSON.stringify(error.validationErrors, null, 2)}`;
  }

  // Add full response data if available
  if (error.fullResponseData) {
    detailedInfo += `\n\nFull Response Data: ${JSON.stringify(error.fullResponseData, null, 2)}`;
  }

  // Add request data for debugging
  detailedInfo += `\n\nRequest Data:\n${JSON.stringify(productData, null, 2)}`;

  // Common issues and troubleshooting tips
  detailedInfo += `\n\nCommon issues:\n`;
  detailedInfo += `- Blueprint ID or Print Provider ID might be invalid\n`;
  detailedInfo += `- Variant IDs might not be valid for the selected blueprint and print provider\n`;
  detailedInfo += `- Image IDs in print areas might be invalid or not accessible\n`;
  detailedInfo += `- Required fields might be missing in the request\n`;

  return {
    content: [{
      type: "text",
      text: errorMessage + detailedInfo
    }],
    isError: true
  };
}
```

## Conclusion

`index.ts` is the core of the Printify MCP server, setting up the server and defining all the tools that AI assistants can use to interact with Printify's API. It provides a comprehensive set of tools for managing shops, products, blueprints, variants, and images, as well as generating images and product descriptions using AI.
