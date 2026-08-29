#!/usr/bin/env node

// Must be first: reroutes stray stdout writes before anything can emit them.
import { protocolStdout } from "./stdio-guard.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { PrintifyAPI } from "./printify-api.js";
import { ReplicateClient } from "./replicate-client.js";
import dotenv from "dotenv";
// File system imports moved to service modules

// Export the main classes and types for use as a library
export { PrintifyAPI, type PrintifyShop } from './printify-api.js';
export { ReplicateClient } from './replicate-client.js';
export { createPrintifyMcpServer } from './exports.js';

// Export services for use as a library
export * from './services/image-generator.js';
export * from './services/printify-uploader.js';
export * from './services/printify-products.js';
export * from './utils/error-handler.js';
export * from './utils/file-utils.js';

// Load environment variables from .env file
dotenv.config();

// Create an MCP server
const server = new McpServer({
  name: "Printify-MCP",
  version: "1.0.0"
});

// Initialize API clients
let printifyClient: PrintifyAPI | null = null;
let replicateClient: ReplicateClient | null = null;

// Note: The image conversion functionality has been moved to src/services/image-processor.ts

// Auto-initialize the API clients when the server starts
(async () => {
  try {
    // Initialize Printify API client
    const printifyApiKey = process.env.PRINTIFY_API_KEY;

    if (!printifyApiKey) {
      console.error("PRINTIFY_API_KEY environment variable is not set. The Printify API client will not be initialized.");
    } else {
      // Create the client with the API key
      printifyClient = new PrintifyAPI(printifyApiKey);

      // Initialize the client and fetch shops
      const shops = await printifyClient.initialize();

      // Get the current shop after initialization
      const currentShop = printifyClient.getCurrentShop();

      if (currentShop) {
        // A shop was automatically selected (either from PRINTIFY_SHOP_ID or the first available shop)
        console.error(`Printify SDK client initialized with shop: ${currentShop.title} (ID: ${currentShop.id})`);
        console.error(`Shop selection: ${process.env.PRINTIFY_SHOP_ID ? 'From environment variable' : 'Automatically selected first shop'}`);
      } else if (shops.length > 0) {
        // Shops exist but none was selected (this shouldn't happen with the current implementation)
        console.error(`Printify SDK client initialized, but no shop was selected. Available shops: ${shops.length}`);
        console.error('Attempting to select the first shop...');
        printifyClient.setShopId(shops[0].id.toString());
        console.error(`Selected shop: ${shops[0].title} (ID: ${shops[0].id})`);
      } else {
        console.error("Printify SDK client initialized, but no shops were found in your account.");
        console.error("Please make sure your Printify account has at least one shop.");
      }
    }

    // Initialize Replicate API client if environment variable is set
    const replicateApiToken = process.env.REPLICATE_API_TOKEN;

    if (!replicateApiToken) {
      console.error("REPLICATE_API_TOKEN environment variable is not set. The Replicate API client will not be initialized.");
    } else {
      replicateClient = new ReplicateClient(replicateApiToken);
      console.error('Replicate API client initialized successfully.');
    }
  } catch (error) {
    console.error("Error initializing API clients:", error);
  }
})();

// Get Printify status tool
server.tool(
  "get_printify_status",
  {},
  async (): Promise<{ content: any[], isError?: boolean }> => {
    // Import the printify shops service
    const { getPrintifyStatus } = await import('./services/printify-shops.js');

    // Check if client is initialized
    if (!printifyClient) {
      return {
        content: [{
          type: "text",
          text: "Printify API client is not initialized. The PRINTIFY_API_KEY environment variable may not be set."
        }],
        isError: true
      };
    }

    // Call the service
    const result = await getPrintifyStatus(printifyClient);

    // Return the result
    if (result.success) {
      return result.response as { content: any[], isError?: boolean };
    } else {
      return result.errorResponse as { content: any[], isError: boolean };
    }
  }
);

// List shops tool
server.tool(
  "list_shops",
  {},
  async (): Promise<{ content: any[], isError?: boolean }> => {
    // Import the printify shops service
    const { listPrintifyShops } = await import('./services/printify-shops.js');

    // Check if client is initialized
    if (!printifyClient) {
      return {
        content: [{
          type: "text",
          text: "Printify API client is not initialized. The PRINTIFY_API_KEY environment variable may not be set."
        }],
        isError: true
      };
    }

    // Call the service
    const result = await listPrintifyShops(printifyClient);

    // Return the result
    if (result.success) {
      return result.response as { content: any[], isError?: boolean };
    } else {
      return result.errorResponse as { content: any[], isError: boolean };
    }
  }
);

// Switch shop tool
server.tool(
  "switch_shop",
  {
    shopId: z.string().describe("The ID of the shop to switch to")
  },
  async ({ shopId }): Promise<{ content: any[], isError?: boolean }> => {
    // Import the printify shops service
    const { switchPrintifyShop } = await import('./services/printify-shops.js');

    // Check if client is initialized
    if (!printifyClient) {
      return {
        content: [{
          type: "text",
          text: "Printify API client is not initialized. The PRINTIFY_API_KEY environment variable may not be set."
        }],
        isError: true
      };
    }

    // Call the service
    const result = await switchPrintifyShop(printifyClient, shopId);

    // Return the result
    if (result.success) {
      return result.response as { content: any[], isError?: boolean };
    } else {
      return result.errorResponse as { content: any[], isError: boolean };
    }
  }
);

// This tool is now replaced by the list_shops tool

// List products tool
server.tool(
  "list_products",
  {
    page: z.number().optional().default(1).describe("Page number"),
    limit: z.number().optional().default(10).describe("Number of products per page")
  },
  async ({ page, limit }): Promise<{ content: any[], isError?: boolean }> => {
    // Import the printify products service
    const { listProducts } = await import('./services/printify-products.js');

    // Check if client is initialized
    if (!printifyClient) {
      return {
        content: [{
          type: "text",
          text: "Printify API client is not initialized. The PRINTIFY_API_KEY environment variable may not be set."
        }],
        isError: true
      };
    }

    // Call the service
    const result = await listProducts(printifyClient, { page, limit });

    // Return the result
    if (result.success) {
      return result.response as { content: any[], isError?: boolean };
    } else {
      return result.errorResponse as { content: any[], isError: boolean };
    }
  }
);

// Get product tool
server.tool(
  "get_product",
  {
    productId: z.string().describe("Product ID")
  },
  async ({ productId }): Promise<{ content: any[], isError?: boolean }> => {
    // Import the printify products service
    const { getProduct } = await import('./services/printify-products.js');

    // Check if client is initialized
    if (!printifyClient) {
      return {
        content: [{
          type: "text",
          text: "Printify API client is not initialized. The PRINTIFY_API_KEY environment variable may not be set."
        }],
        isError: true
      };
    }

    // Call the service
    const result = await getProduct(printifyClient, productId);

    // Return the result
    if (result.success) {
      return result.response as { content: any[], isError?: boolean };
    } else {
      return result.errorResponse as { content: any[], isError: boolean };
    }
  }
);

// Create product tool
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
    })).optional().describe("Print areas for the product"),
    tags: z.array(z.string()).optional().describe("Tags for the product")
  },
  async ({ title, description, blueprintId, printProviderId, variants, printAreas, tags }): Promise<{ content: any[], isError?: boolean }> => {
    // Import the printify products service
    const { createProduct } = await import('./services/printify-products.js');

    // Check if client is initialized
    if (!printifyClient) {
      return {
        content: [{
          type: "text",
          text: "Printify API client is not initialized. The PRINTIFY_API_KEY environment variable may not be set."
        }],
        isError: true
      };
    }

    // Call the service
    const result = await createProduct(printifyClient, {
      title,
      description,
      blueprintId,
      printProviderId,
      variants,
      printAreas,
      tags
    });

    // Return the result
    if (result.success) {
      return result.response as { content: any[], isError?: boolean };
    } else {
      return result.errorResponse as { content: any[], isError: boolean };
    }
  }
);

// Update product tool
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
    })).optional().describe("Print areas for the product"),
    tags: z.array(z.string()).optional().describe("Tags for the product")
  },
  async ({ productId, title, description, variants, printAreas, tags }): Promise<{ content: any[], isError?: boolean }> => {
    // Import the printify products service
    const { updateProduct } = await import('./services/printify-products.js');

    // Check if client is initialized
    if (!printifyClient) {
      return {
        content: [{
          type: "text",
          text: "Printify API client is not initialized. The PRINTIFY_API_KEY environment variable may not be set."
        }],
        isError: true
      };
    }

    // Call the service
    const result = await updateProduct(printifyClient, productId, {
      title,
      description,
      variants,
      printAreas,
      tags
    });

    // Return the result
    if (result.success) {
      return result.response as { content: any[], isError?: boolean };
    } else {
      return result.errorResponse as { content: any[], isError: boolean };
    }
  }
);

// Delete product tool
server.tool(
  "delete_product",
  {
    productId: z.string().describe("Product ID")
  },
  async ({ productId }): Promise<{ content: any[], isError?: boolean }> => {
    // Import the printify products service
    const { deleteProduct } = await import('./services/printify-products.js');

    // Check if client is initialized
    if (!printifyClient) {
      return {
        content: [{
          type: "text",
          text: "Printify API client is not initialized. The PRINTIFY_API_KEY environment variable may not be set."
        }],
        isError: true
      };
    }

    // Call the service
    const result = await deleteProduct(printifyClient, productId);

    // Return the result
    if (result.success) {
      return result.response as { content: any[], isError?: boolean };
    } else {
      return result.errorResponse as { content: any[], isError: boolean };
    }
  }
);

// Publish product tool
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
  async ({ productId, publishDetails }): Promise<{ content: any[], isError?: boolean }> => {
    // Import the printify products service
    const { publishProduct } = await import('./services/printify-products.js');

    // Check if client is initialized
    if (!printifyClient) {
      return {
        content: [{
          type: "text",
          text: "Printify API client is not initialized. The PRINTIFY_API_KEY environment variable may not be set."
        }],
        isError: true
      };
    }

    // Call the service
    const result = await publishProduct(printifyClient, productId, publishDetails);

    // Return the result
    if (result.success) {
      return result.response as { content: any[], isError?: boolean };
    } else {
      return result.errorResponse as { content: any[], isError: boolean };
    }
  }
);

// Get blueprints tool
server.tool(
  "get_blueprints",
  {
    page: z.number().optional().default(1).describe("Page number"),
    limit: z.number().optional().default(10).describe("Number of blueprints per page")
  },
  async ({ page, limit }): Promise<{ content: any[], isError?: boolean }> => {
    // Import the printify blueprints service
    const { getBlueprints } = await import('./services/printify-blueprints.js');

    // Check if client is initialized
    if (!printifyClient) {
      return {
        content: [{
          type: "text",
          text: "Printify API client is not initialized. The PRINTIFY_API_KEY environment variable may not be set."
        }],
        isError: true
      };
    }

    // Call the service
    const result = await getBlueprints(printifyClient, { page, limit });

    // Return the result
    if (result.success) {
      return result.response as { content: any[], isError?: boolean };
    } else {
      return result.errorResponse as { content: any[], isError: boolean };
    }
  }
);

// Get blueprint tool
server.tool(
  "get_blueprint",
  {
    blueprintId: z.string().describe("Blueprint ID")
  },
  async ({ blueprintId }): Promise<{ content: any[], isError?: boolean }> => {
    // Import the printify blueprints service
    const { getBlueprint } = await import('./services/printify-blueprints.js');

    // Check if client is initialized
    if (!printifyClient) {
      return {
        content: [{
          type: "text",
          text: "Printify API client is not initialized. The PRINTIFY_API_KEY environment variable may not be set."
        }],
        isError: true
      };
    }

    // Call the service
    const result = await getBlueprint(printifyClient, blueprintId);

    // Return the result
    if (result.success) {
      return result.response as { content: any[], isError?: boolean };
    } else {
      return result.errorResponse as { content: any[], isError: boolean };
    }
  }
);

// Get print providers tool
server.tool(
  "get_print_providers",
  {
    blueprintId: z.string().describe("Blueprint ID")
  },
  async ({ blueprintId }): Promise<{ content: any[], isError?: boolean }> => {
    // Import the printify blueprints service
    const { getPrintProviders } = await import('./services/printify-blueprints.js');

    // Check if client is initialized
    if (!printifyClient) {
      return {
        content: [{
          type: "text",
          text: "Printify API client is not initialized. The PRINTIFY_API_KEY environment variable may not be set."
        }],
        isError: true
      };
    }

    // Call the service
    const result = await getPrintProviders(printifyClient, blueprintId);

    // Return the result
    if (result.success) {
      return result.response as { content: any[], isError?: boolean };
    } else {
      return result.errorResponse as { content: any[], isError: boolean };
    }
  }
);

// Get variants tool
server.tool(
  "get_variants",
  {
    blueprintId: z.string().describe("Blueprint ID"),
    printProviderId: z.string().describe("Print provider ID")
  },
  async ({ blueprintId, printProviderId }): Promise<{ content: any[], isError?: boolean }> => {
    // Import the printify blueprints service
    const { getVariants } = await import('./services/printify-blueprints.js');

    // Check if client is initialized
    if (!printifyClient) {
      return {
        content: [{
          type: "text",
          text: "Printify API client is not initialized. The PRINTIFY_API_KEY environment variable may not be set."
        }],
        isError: true
      };
    }

    // Call the service
    const result = await getVariants(printifyClient, blueprintId, printProviderId);

    // Return the result
    if (result.success) {
      return result.response as { content: any[], isError?: boolean };
    } else {
      return result.errorResponse as { content: any[], isError: boolean };
    }
  }
);

// Upload image tool
server.tool(
  "upload_image",
  {
    fileName: z.string().describe("File name"),
    url: z.string().describe("URL of the image to upload, path to local file, or base64 encoded image data")
  },
  async ({ fileName, url }): Promise<{ content: any[], isError?: boolean }> => {
    // Import the printify uploader service
    const { uploadImageToPrintify, determineImageSourceType } = await import('./services/printify-uploader.js');

    // Check if client is initialized
    if (!printifyClient) {
      return {
        content: [{
          type: "text",
          text: "Printify API client is not initialized. The PRINTIFY_API_KEY environment variable may not be set."
        }],
        isError: true
      };
    }

    // Log the attempt with limited information for privacy
    const sourceType = determineImageSourceType(url);
    const sourcePreview = sourceType === 'url' ? url.substring(0, 30) + '...' :
                         sourceType === 'file' ? url : // Show full file path
                         url.substring(0, 30) + '...';

    console.error(`Attempting to upload image: ${fileName} from ${sourceType} source: ${sourcePreview}`);

    // Call the service
    const result = await uploadImageToPrintify(printifyClient, fileName, url);

    // Return the result
    if (result.success) {
      return result.response as { content: any[], isError?: boolean };
    } else {
      return result.errorResponse as { content: any[], isError: boolean };
    }
  }
);

// Imgur upload tool has been removed - we now upload directly to Printify

// Get defaults tool
server.tool(
  "get_defaults",
  {},
  async () => {
    try {
      if (!replicateClient) {
        return {
          content: [{
            type: "text",
            text: "Replicate API client is not initialized. The REPLICATE_API_TOKEN environment variable may not be set."
          }],
          isError: true
        };
      }

      const models = replicateClient.getAvailableModels();
      const currentDefault = replicateClient.getDefault('model');
      const allDefaults = replicateClient.getAllDefaults();

      // Format the response in a user-friendly way
      const modelInfo = models.map(model => {
        if (model.id === currentDefault) {
          return `## ${model.name} ✓ SELECTED\n` +
                 `- ID: \`${model.id}\`\n` +
                 `- Description: ${model.description}\n` +
                 `- Capabilities: ${model.capabilities.join(', ')}\n` +
                 `- Status: **Currently selected as default model**\n`;
        } else {
          return `## ${model.name}\n` +
                 `- ID: \`${model.id}\`\n` +
                 `- Description: ${model.description}\n` +
                 `- Capabilities: ${model.capabilities.join(', ')}\n`;
        }
      }).join('\n');

      // Format all current defaults as a table
      const defaultsTable = Object.entries(allDefaults)
        .map(([key, val]) => `| ${key} | ${typeof val === 'object' ? JSON.stringify(val) : val} |`)
        .join('\n');

      return {
        content: [{
          type: "text",
          text: `# Current Default Settings\n\n` +
                `## Selected Model\n\n${modelInfo}\n\n` +
                `## All Default Parameters\n\n` +
                `| Option | Value |\n` +
                `|--------|-------|\n` +
                defaultsTable +
                `\n\n` +
                `To change any default setting, use the \`set_default\` tool:\n` +
                `\`\`\`javascript\n` +
                `set_default({ option: "model", value: "black-forest-labs/flux-1.1-pro-ultra" })\n` +
                `set_default({ option: "aspectRatio", value: "16:9" })\n` +
                `set_default({ option: "raw", value: false })\n` +
                `\`\`\``
        }]
      };
    } catch (error: any) {
      return {
        content: [{
          type: "text",
          text: `Error getting defaults: ${error.message}`
        }],
        isError: true
      };
    }
  }
);

// Note: The get-models tool has been removed in favor of the more general get_defaults tool

// Set default parameter tool
server.tool(
  "set_default",
  {
    option: z.string().describe("The option name to set (e.g., 'model', 'aspectRatio', 'raw', etc.)"),
    value: z.any().describe("The value to set for the option")
  },
  async ({ option, value }) => {
    try {
      if (!replicateClient) {
        return {
          content: [{
            type: "text",
            text: "Replicate API client is not initialized. The REPLICATE_API_TOKEN environment variable may not be set."
          }],
          isError: true
        };
      }

      // Set the default value
      replicateClient.setDefault(option, value);

      // Get all current defaults for the response
      const allDefaults = replicateClient.getAllDefaults();

      // Format the response based on the option type
      let detailedResponse = "";

      if (option === 'model') {
        // For model option, provide more detailed information
        const models = replicateClient.getAvailableModels();
        const selectedModel = models.find(model => model.id === value);

        if (selectedModel) {
          detailedResponse = `## ${selectedModel.name} ✓ SELECTED\n` +
                           `- ID: \`${selectedModel.id}\`\n` +
                           `- Description: ${selectedModel.description}\n` +
                           `- Capabilities: ${selectedModel.capabilities.join(', ')}\n` +
                           `- Status: **Currently selected as default model**\n\n`;
        }
      }

      // Format all current defaults as a table
      const defaultsTable = Object.entries(allDefaults)
        .map(([key, val]) => `| ${key} | ${typeof val === 'object' ? JSON.stringify(val) : val} |`)
        .join('\n');

      return {
        content: [{
          type: "text",
          text: `# Default Setting Updated\n\n` +
                `Successfully set default \`${option}\` to: \`${value}\`\n\n` +
                detailedResponse +
                `## Current Default Settings\n\n` +
                `| Option | Value |\n` +
                `|--------|-------|\n` +
                defaultsTable +
                `\n\nThese settings will be used by default for all image generation unless overridden in the tool call.`
        }]
      };
    } catch (error: any) {
      return {
        content: [{
          type: "text",
          text: `Error setting default: ${error.message}`
        }],
        isError: true
      };
    }
  }
);

// Note: The set-model tool has been removed in favor of the more general set_default tool

// How to use Printify tool - provides detailed documentation on product creation workflow
server.tool(
  "how_to_use",
  {
    topic: z.enum([
      "product_creation",
      "blueprints",
      "print_providers",
      "variants",
      "images",
      "publishing",
      "image_generation"
    ]).describe("The topic to get documentation for")
  },
  async ({ topic }) => {
    try {
      // Import required modules
      const fs = await import('fs');
      const path = await import('path');
      const { promisify } = await import('util');
      const readFile = promisify(fs.readFile);

      // Convert topic to file name format
      const fileName = `${topic}.md`;

      // Get the directory of the current file using import.meta.url
      // This works regardless of where the process is started from
      const { fileURLToPath } = await import('url');
      const currentFilePath = fileURLToPath(import.meta.url);
      const currentDirPath = path.dirname(currentFilePath);
      const filePath = path.join(currentDirPath, 'docs', fileName);

      // Read the documentation file
      let documentation;
      try {
        documentation = await readFile(filePath, 'utf8');
      } catch (readError: any) {
        console.error(`Failed to read docs for "${topic}" at ${filePath}:`, readError);

        return {
          content: [{
            type: "text",
            text: `Documentation for topic "${topic}" not found. Available topics are: product_creation, blueprints, print_providers, variants, images, publishing, image_generation`
          }],
          isError: true
        };
      }

      return {
        content: [{
          type: "text",
          text: documentation
        }]
      };
    } catch (error: any) {
      return {
        content: [{
          type: "text",
          text: `Error retrieving documentation: ${error.message}`
        }],
        isError: true
      };
    }
  }
);


// Add a prompt for product description generation
server.prompt(
  "generate_product_description",
  {
    productName: z.string(),
    category: z.string(),
    targetAudience: z.string().optional(),
    keyFeatures: z.string().optional().describe("Comma-separated list of key features")
  },
  (args) => {
    const { productName, category, targetAudience, keyFeatures } = args;
    let featuresText = "";
    if (keyFeatures) {
      const featuresList = keyFeatures.split(',').map(f => f.trim());
      if (featuresList.length > 0) {
        featuresText = `\nKey features:\n${featuresList.map((f: string) => `- ${f}`).join('\n')}`;
      }
    }

    const audienceText = targetAudience ? `\nTarget audience: ${targetAudience}` : "";

    return {
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `Please write a compelling product description for the following product:

Product name: ${productName}
Category: ${category}${audienceText}${featuresText}

The description should be engaging, highlight the benefits, and be suitable for an e-commerce platform.`
        }
      }]
    };
  }
);

// Generate and upload image tool - combines Replicate image generation with Printify upload
server.tool(
  "generate_and_upload_image",
  {
    prompt: z.string().describe("Text prompt for image generation"),
    fileName: z.string().describe("File name for the uploaded image"),

    // Optional model override
    model: z.string().optional()
      .describe("Optional: Override the default model. Use get_defaults to see available models"),

    // Common parameters for both models
    width: z.number().optional().default(1024).describe("Image width in pixels"),
    height: z.number().optional().default(1024).describe("Image height in pixels"),
    aspectRatio: z.string().optional().describe("Aspect ratio (e.g., '16:9', '4:3', '1:1'). If provided, overrides width and height"),
    outputFormat: z.enum(["jpeg", "png", "webp"]).optional().default("png").describe("Output format"),
    safetyTolerance: z.number().optional().default(2).describe("Safety tolerance (0-6)"),
    seed: z.number().optional().describe("Random seed for reproducible generation"),
    numInferenceSteps: z.number().optional().default(25).describe("Number of inference steps"),
    guidanceScale: z.number().optional().default(7.5).describe("Guidance scale"),
    negativePrompt: z.string().optional().default("low quality, bad quality, sketches").describe("Negative prompt"),

    // Flux 1.1 Pro specific parameters
    promptUpsampling: z.boolean().optional()
      .describe("Enable prompt upsampling (Flux 1.1 Pro only)"),
    outputQuality: z.number().optional()
      .describe("Output quality 1-100 (Flux 1.1 Pro only)"),

    // Flux 1.1 Pro Ultra specific parameters
    raw: z.boolean().optional()
      .describe("Generate less processed, more natural-looking images (Flux 1.1 Pro Ultra only)"),
    imagePromptStrength: z.number().optional()
      .describe("Image prompt strength 0-1 (Flux 1.1 Pro Ultra only)")
  },
  async ({
    prompt, fileName, model, width, height, aspectRatio, outputFormat, safetyTolerance,
    seed, numInferenceSteps, guidanceScale, negativePrompt, promptUpsampling, outputQuality,
    raw, imagePromptStrength
  }): Promise<{ content: any[], isError?: boolean }> => {
    // Import the services
    const { generateImage } = await import('./services/image-generator.js');
    const { formatSuccessResponse } = await import('./utils/error-handler.js');

    // Check if clients are initialized
    if (!replicateClient) {
      return {
        content: [{
          type: "text",
          text: "Replicate API client is not initialized. The REPLICATE_API_TOKEN environment variable may not be set."
        }],
        isError: true
      };
    }

    if (!printifyClient) {
      return {
        content: [{
          type: "text",
          text: "Printify API client is not initialized. The PRINTIFY_API_KEY environment variable may not be set."
        }],
        isError: true
      };
    }

    // Check if we're using the Ultra model which requires ImgBB
    // Determine which model to use (user-specified or default)
    const modelToUse = model || replicateClient.getDefaultModel();

    // Check if ImgBB API key is set when using Ultra model
    if (modelToUse.includes('flux-1.1-pro-ultra') && (!process.env.IMGBB_API_KEY || process.env.IMGBB_API_KEY === 'your-imgbb-api-key')) {
      return {
        content: [{
          type: "text",
          text: `ERROR: The Flux 1.1 Pro Ultra model generates high-resolution images that are too large for direct base64 upload.\n\n` +
                `You MUST set the IMGBB_API_KEY environment variable when using this model.\n\n` +
                `Get a free API key from https://api.imgbb.com/ and add it to your .env file:\n` +
                `IMGBB_API_KEY=your_api_key_here`
        }],
        isError: true
      };
    }

    // Check if a shop is selected
    const currentShop = printifyClient.getCurrentShop();
    if (!currentShop) {
      return {
        content: [{
          type: "text",
          text: "No shop is currently selected. Use the list_shops and switch_shop tools to select a shop."
        }],
        isError: true
      };
    }

    console.error(`Starting generate_and_upload_image with prompt: ${prompt}`);

    // Get default parameters first
    const defaults = replicateClient.getAllDefaults();

    // STEP 1: Generate the image with Replicate and process with Sharp
    // Start with defaults, then override with parameters from the tool call
    const generationResult = await generateImage(
      replicateClient,
      prompt,
      fileName,
      {
        // Start with defaults
        model: defaults.model,
        width: defaults.width,
        height: defaults.height,
        aspectRatio: defaults.aspectRatio,
        outputFormat: defaults.outputFormat,
        safetyTolerance: defaults.safetyTolerance,
        numInferenceSteps: defaults.numInferenceSteps,
        guidanceScale: defaults.guidanceScale,
        negativePrompt: defaults.negativePrompt,
        raw: defaults.raw,
        promptUpsampling: defaults.promptUpsampling,
        outputQuality: defaults.outputQuality,

        // Override with parameters from the tool call (if provided)
        ...(model !== undefined && { model }),
        ...(width !== undefined && { width }),
        ...(height !== undefined && { height }),
        ...(aspectRatio !== undefined && { aspectRatio }),
        ...(outputFormat !== undefined && { outputFormat }),
        ...(safetyTolerance !== undefined && { safetyTolerance }),
        ...(seed !== undefined && { seed }),
        ...(numInferenceSteps !== undefined && { numInferenceSteps }),
        ...(guidanceScale !== undefined && { guidanceScale }),
        ...(negativePrompt !== undefined && { negativePrompt }),
        ...(promptUpsampling !== undefined && { promptUpsampling }),
        ...(outputQuality !== undefined && { outputQuality }),
        ...(raw !== undefined && { raw }),
        ...(imagePromptStrength !== undefined && { imagePromptStrength })
      }
    );

    // If image generation failed, return the error
    if (!generationResult.success) {
      return generationResult.errorResponse as { content: any[], isError: boolean };
    }

    const imageBuffer = generationResult.buffer;
    const mimeType = generationResult.mimeType;
    const finalFileName = generationResult.fileName;
    const usingModel = generationResult.model;

    // Make sure we have valid image data
    if (!imageBuffer) {
      return {
        content: [{
          type: "text",
          text: "Failed to get valid image data from the image generator."
        }],
        isError: true
      };
    }

    // STEP 2: Upload the processed image to Printify
    console.error(`Uploading processed image to Printify`);
    console.error(`Image buffer size: ${imageBuffer.length} bytes`);
    console.error(`MIME type: ${mimeType}`);
    console.error(`File name: ${finalFileName}`);

    // Prepare for upload to Printify
    const uploadDetails = [
      `Preparing to upload image to Printify:`,
      `- File name: ${finalFileName}`,
      `- Image buffer size: ${imageBuffer?.length || 0} bytes`,
      `- MIME type: ${mimeType}`,
      `- Model used: ${usingModel}`
    ].join('\n');

    // Copy of every generated image, written only when explicitly enabled.
    if (process.env.PRINTIFY_MCP_DEBUG) try {
      const fs = await import('fs');
      const path = await import('path');

      // Create a debug directory if it doesn't exist
      const debugDir = path.join(process.cwd(), 'debug');
      if (!fs.existsSync(debugDir)) {
        fs.mkdirSync(debugDir, { recursive: true });
      }

      // Save the base64 data to a file for debugging
      const debugFilePath = path.join(debugDir, `debug_${Date.now()}_${finalFileName}`);

      // Save buffer directly to debug file
      if (imageBuffer) {
        fs.writeFileSync(debugFilePath, imageBuffer);
        console.error(`Saved image data to debug file: ${debugFilePath}`);
        console.error(`Debug file size: ${imageBuffer.length} bytes`);
      } else {
        console.error('No image data to save for debugging');
      }
    } catch (debugError) {
      console.error('Error saving debug file:', debugError);
    }

    // Validate input data
    if (!imageBuffer) {
      return {
        content: [{
          type: "text",
          text: "Error: No image data available for upload"
        }],
        isError: true
      };
    }

    if (!finalFileName) {
      return {
        content: [{
          type: "text",
          text: "Error: No filename available for upload"
        }],
        isError: true
      };
    }

    // STEP 1: Import required modules
    let axios;
    let FormData;
    try {
      axios = (await import('axios')).default;
      FormData = (await import('form-data')).default;
    } catch (importError: any) {
      return {
        content: [{
          type: "text",
          text: `Error importing required modules: ${importError.message || String(importError)}`
        }],
        isError: true
      };
    }

    // STEP 2: Prepare image for upload (either via ImgBB or direct base64)
    let imageUrl;
    let uploadMethod = "direct";

    // Check if we're using the Ultra model
    const isUsingUltraModel = usingModel.includes('flux-1.1-pro-ultra');

    // Check if ImgBB API key is set
    const imgbbApiKey = process.env.IMGBB_API_KEY;

    if (imgbbApiKey && imgbbApiKey !== 'your-imgbb-api-key') {
      // If ImgBB API key is set, use ImgBB to get a URL
      try {
        // Create form data for ImgBB
        const formData = new FormData();
        // Convert buffer to base64 for ImgBB upload
        const base64Data = imageBuffer.toString('base64');
        formData.append('image', base64Data);

        // Upload to ImgBB with the key as a query parameter
        const imgbbResponse = await axios.post(
          `https://api.imgbb.com/1/upload?key=${imgbbApiKey}`,
          formData
        );

        // Get the image URL from ImgBB response
        imageUrl = imgbbResponse.data.data.url;
        uploadMethod = "imgbb";

        // Log success
        console.error(`Successfully uploaded image to ImgBB. URL: ${imageUrl}`);
      } catch (imgbbError: any) {
        // Only fall back to direct upload if not using Ultra model
        if (isUsingUltraModel) {
          return {
            content: [{
              type: "text",
              text: `Error uploading to ImgBB: ${imgbbError.message || String(imgbbError)}\n\n` +
                    `When using the Ultra model, ImgBB upload is required and cannot be bypassed.\n\n` +
                    `Response data: ${JSON.stringify(imgbbError.response?.data || {}, null, 2)}`
            }],
            isError: true
          };
        }

        console.error(`Error uploading to ImgBB: ${imgbbError.message || String(imgbbError)}. Falling back to direct base64 upload.`);
        // Fall back to direct base64 upload for non-Ultra models
        uploadMethod = "direct";
      }
    } else if (!isUsingUltraModel) {
      console.error("No ImgBB API key found. Using direct base64 upload.");
    }

    // STEP 4: Import Printify SDK
    let Printify;
    try {
      Printify = (await import('printify-sdk-js')).default;
    } catch (importError: any) {
      return {
        content: [{
          type: "text",
          text: `Error importing Printify SDK: ${importError.message || String(importError)}\n\n` +
                `ImgBB URL: ${imageUrl}`
        }],
        isError: true
      };
    }

    // STEP 5: Create Printify client
    let printifySDK;
    try {
      printifySDK = new Printify({
        accessToken: process.env.PRINTIFY_API_KEY || '',
        shopId: printifyClient ? printifyClient.getCurrentShopId() || undefined : undefined
      });

      // Log client creation
      console.error(`Created Printify client with shop ID: ${printifyClient?.getCurrentShopId() || 'undefined'}`);
    } catch (clientError: any) {
      return {
        content: [{
          type: "text",
          text: `Error creating Printify client: ${clientError.message || String(clientError)}\n\n` +
                `ImgBB URL: ${imageUrl}`
        }],
        isError: true
      };
    }

    // STEP 6: Upload the image to Printify
    let image;
    try {
      if (uploadMethod === "imgbb" && imageUrl) {
        // Upload using the URL from ImgBB
        image = await printifySDK.uploads.uploadImage({
          file_name: finalFileName,
          url: imageUrl
        });
        console.error(`Successfully uploaded image to Printify using ImgBB URL. Image ID: ${image.id}`);
      } else {
        // Direct base64 upload
        // Convert buffer to base64 for Printify direct upload
        const base64Data = imageBuffer.toString('base64');
        image = await printifySDK.uploads.uploadImage({
          file_name: finalFileName,
          contents: base64Data
        });
        console.error(`Successfully uploaded image to Printify using direct base64. Image ID: ${image.id}`);
      }
    } catch (uploadError: any) {
      return {
        content: [{
          type: "text",
          text: `Error uploading to Printify: ${uploadError.message || String(uploadError)}\n\n` +
                `Upload method: ${uploadMethod}${imageUrl ? `\nImgBB URL: ${imageUrl}` : ''}\n\n` +
                `Response data: ${JSON.stringify(uploadError.response?.data || {}, null, 2)}`
        }],
        isError: true
      };
    }

    // STEP 7: Return success response
    const response = formatSuccessResponse(
      'Image Generated and Uploaded Successfully',
      {
        Prompt: prompt,
        Model: usingModel.split('/')[1],
        'Image ID': image.id,
        'File Name': image.file_name,
        Dimensions: `${image.width}x${image.height}`,
        'Preview URL': image.preview_url,
        'Upload Method': uploadMethod === "imgbb" ? "ImgBB URL" : "Direct base64",
        ...(imageUrl ? { 'ImgBB URL': imageUrl } : {}),
        'Upload Details': uploadDetails
      },
      `You can now use this image ID (${image.id}) when creating a product.\n\n` +
      `**Example:**\n` +
      `\`\`\`json\n` +
      `"print_areas": {\n` +
      `  "front": { "position": "front", "imageId": "${image.id}" }\n` +
      `}\n` +
      `\`\`\``
    ) as { content: any[], isError?: boolean };

    return response;


  }
);

// Generate image tool - uses Replicate directly without Printify integration
server.tool(
  "generate_image",
  {
    prompt: z.string().describe("Text prompt for image generation"),
    outputPath: z.string().describe("Full path where the generated image should be saved"),

    // Optional model override
    model: z.string().optional()
      .describe("Optional: Override the default model. Use get_defaults to see available models"),

    // Common parameters for both models
    width: z.number().optional().default(1024).describe("Image width in pixels"),
    height: z.number().optional().default(1024).describe("Image height in pixels"),
    aspectRatio: z.string().optional().describe("Aspect ratio (e.g., '16:9', '4:3', '1:1'). If provided, overrides width and height"),
    outputFormat: z.enum(["jpeg", "png", "webp"]).optional().default("png").describe("Output format"),
    safetyTolerance: z.number().optional().default(2).describe("Safety tolerance (0-6)"),
    seed: z.number().optional().describe("Random seed for reproducible generation"),
    numInferenceSteps: z.number().optional().default(25).describe("Number of inference steps"),
    guidanceScale: z.number().optional().default(7.5).describe("Guidance scale"),
    negativePrompt: z.string().optional().default("low quality, bad quality, sketches").describe("Negative prompt"),

    // Flux 1.1 Pro specific parameters
    promptUpsampling: z.boolean().optional()
      .describe("Enable prompt upsampling (Flux 1.1 Pro only)"),
    outputQuality: z.number().optional()
      .describe("Output quality 1-100 (Flux 1.1 Pro only)"),

    // Flux 1.1 Pro Ultra specific parameters
    raw: z.boolean().optional()
      .describe("Generate less processed, more natural-looking images (Flux 1.1 Pro Ultra only)"),
    imagePromptStrength: z.number().optional()
      .describe("Image prompt strength 0-1 (Flux 1.1 Pro Ultra only)")
  },
  async ({
    prompt, outputPath, model, width, height, aspectRatio, outputFormat, safetyTolerance,
    seed, numInferenceSteps, guidanceScale, negativePrompt, promptUpsampling, outputQuality,
    raw, imagePromptStrength
  }): Promise<{ content: any[], isError?: boolean }> => {
    // Import the services
    const { generateImage } = await import('./services/image-generator.js');
    const { formatSuccessResponse } = await import('./utils/error-handler.js');
    const fs = await import('fs');
    const path = await import('path');

    // Check if Replicate client is initialized
    if (!replicateClient) {
      return {
        content: [{
          type: "text",
          text: "Replicate API client is not initialized. The REPLICATE_API_TOKEN environment variable may not be set."
        }],
        isError: true
      };
    }

    // Extract filename from the output path
    const fileName = path.basename(outputPath);

    // Check if we're using the Ultra model which requires ImgBB
    // Determine which model to use (user-specified or default)
    const modelToUse = model || replicateClient.getDefaultModel();

    console.error(`Starting generate_image with prompt: ${prompt}`);
    console.error(`Using model: ${modelToUse}`);
    console.error(`Output path: ${outputPath}`);

    // Get default parameters first
    const defaults = replicateClient.getAllDefaults();

    // Generate the image with Replicate and process with Sharp
    // Start with defaults, then override with parameters from the tool call
    const generationResult = await generateImage(
      replicateClient,
      prompt,
      fileName,
      {
        // Start with defaults
        model: defaults.model,
        width: defaults.width,
        height: defaults.height,
        aspectRatio: defaults.aspectRatio,
        outputFormat: defaults.outputFormat,
        safetyTolerance: defaults.safetyTolerance,
        numInferenceSteps: defaults.numInferenceSteps,
        guidanceScale: defaults.guidanceScale,
        negativePrompt: defaults.negativePrompt,
        raw: defaults.raw,
        promptUpsampling: defaults.promptUpsampling,
        outputQuality: defaults.outputQuality,

        // Override with parameters from the tool call (if provided)
        ...(model !== undefined && { model }),
        ...(width !== undefined && { width }),
        ...(height !== undefined && { height }),
        ...(aspectRatio !== undefined && { aspectRatio }),
        ...(outputFormat !== undefined && { outputFormat }),
        ...(safetyTolerance !== undefined && { safetyTolerance }),
        ...(seed !== undefined && { seed }),
        ...(numInferenceSteps !== undefined && { numInferenceSteps }),
        ...(guidanceScale !== undefined && { guidanceScale }),
        ...(negativePrompt !== undefined && { negativePrompt }),
        ...(promptUpsampling !== undefined && { promptUpsampling }),
        ...(outputQuality !== undefined && { outputQuality }),
        ...(raw !== undefined && { raw }),
        ...(imagePromptStrength !== undefined && { imagePromptStrength })
      }
    );

    // If image generation failed, return the error
    if (!generationResult.success) {
      return generationResult.errorResponse as { content: any[], isError: boolean };
    }

    const imageBuffer = generationResult.buffer;
    const finalFileName = generationResult.fileName;
    const usingModel = generationResult.model;
    const dimensions = generationResult.dimensions;

    // Make sure we have valid image data
    if (!imageBuffer) {
      return {
        content: [{
          type: "text",
          text: "Failed to get valid image data from the image generator."
        }],
        isError: true
      };
    }

    try {
      // Create the directory if it doesn't exist
      const outputDir = path.dirname(outputPath);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // Save the buffer directly to the specified output path
      if (imageBuffer) {
        fs.writeFileSync(outputPath, imageBuffer);
      } else {
        throw new Error('No image data available to save');
      }

      // Return success response
      const response = formatSuccessResponse(
        'Image Generated Successfully',
        {
          Prompt: prompt,
          Model: usingModel.split('/')[1],
          'Output Path': outputPath,
          'File Name': finalFileName,
          'File Size': `${imageBuffer ? imageBuffer.length : 0} bytes`,
          'Dimensions': dimensions || `${width}x${height}`,
          'Format': outputFormat || 'png',
          'Generation Parameters': {
            // Use the actual dimensions from the generated image
            ...(generationResult.dimensions ? { 'Dimensions': generationResult.dimensions } : {}),
            // Show the aspect ratio that was actually used (from tool call or defaults)
            'Aspect Ratio': aspectRatio || defaults.aspectRatio || '1:1',
            'Inference Steps': numInferenceSteps || defaults.numInferenceSteps,
            'Guidance Scale': guidanceScale || defaults.guidanceScale,
            'Negative Prompt': negativePrompt || defaults.negativePrompt,
            ...(raw !== undefined ? { 'Raw Mode': raw } : {}),
            ...(promptUpsampling !== undefined ? { 'Prompt Upsampling': promptUpsampling } : {}),
            ...(outputQuality !== undefined ? { 'Output Quality': outputQuality } : {}),
            ...(imagePromptStrength !== undefined ? { 'Image Prompt Strength': imagePromptStrength } : {}),
            ...(seed !== undefined ? { 'Seed': seed } : {})
          }
        },
        `Image has been successfully generated and saved to: ${outputPath}`
      ) as { content: any[], isError?: boolean };

      return response;
    } catch (error: any) {
      return {
        content: [{
          type: "text",
          text: `Error saving image to ${outputPath}: ${error.message || String(error)}`
        }],
        isError: true
      };
    }
  }
);

// Start receiving messages on stdin and sending messages on stdout
const transport = new StdioServerTransport(process.stdin, protocolStdout);
await server.connect(transport);

console.error("Printify MCP Server started and connected via stdio");

// Default export
export default server;
