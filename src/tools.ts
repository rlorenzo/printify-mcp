/**
 * Tool and prompt registration for the Printify MCP server.
 *
 * Kept separate from the CLI entrypoint so that both the executable and the
 * library factory (`createPrintifyMcpServer`) register the same surface. Prior
 * to this split the tools lived in module scope in `index.ts` and the library
 * factory returned a server with none of them.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PrintifyAPI } from "./printify-api.js";
import { ReplicateClient } from "./replicate-client.js";
import { mergeGenerationOptions } from "./generation-options.js";
import { stageOnImgbb, requiresImgbb, hasImgbbKey } from "./services/imgbb.js";
import { saveDebugCopy } from "./services/image-format.js";

/**
 * Clients shared with the tool handlers.
 *
 * Held as a mutable object rather than passed by value because the clients are
 * initialized asynchronously after the tools are registered; handlers must read
 * whatever is current at call time.
 */
export interface PrintifyContext {
  printifyClient: PrintifyAPI | null;
  replicateClient: ReplicateClient | null;
}

type ToolResult = { content: any[]; isError?: boolean };

/** A context whose Printify client is known to be configured. */
type ReadyContext = PrintifyContext & { printifyClient: PrintifyAPI };

/**
 * Type predicate so a tool body can use `ctx.printifyClient` without a non-null
 * assertion after the guard.
 */
function printifyReady(ctx: PrintifyContext): ctx is ReadyContext {
  return ctx.printifyClient !== null;
}

/**
 * The error result for tools that need a configured Printify client. Returned
 * rather than thrown so the failure stays inside the MCP result envelope
 * instead of surfacing as a transport error.
 */
function printifyNotReady(): ToolResult {
  return {
    content: [{
      type: "text",
      text: "Printify API client is not initialized. Set the PRINTIFY_API_KEY environment variable, or pass printifyApiKey to createPrintifyMcpServer()."
    }],
    isError: true
  };
}

/**
 * Collapse a service result into the MCP envelope.
 *
 * Services return { success, response, errorResponse }; every tool handled that
 * with the same if/else, so the shape is asserted in one place instead of ten.
 */
function unwrap(result: { success: boolean; response?: any; errorResponse?: any }): ToolResult {
  return (result.success ? result.response : result.errorResponse) as ToolResult;
}

/**
 * Options shared by both image-generation tools.
 *
 * generate_and_upload_image and generate_image accept an identical set of
 * generation parameters and differ only in their destination field (fileName
 * vs outputPath), so the schema is declared once and spread into both.
 */
const imageGenerationOptions = {
  model: z.string().optional()
    .describe("Optional: Override the default model. Use get_defaults to see available models"),

  // Common parameters for both models
  width: z.number().optional().describe("Image width in pixels (default 1024 unless an aspect ratio is set)"),
  height: z.number().optional().describe("Image height in pixels (default 1024 unless an aspect ratio is set)"),
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
} as const;

/**
 * Hand a generated image to Printify, by hosted URL when it was staged on
 * ImgBB, otherwise as base64.
 *
 * The direct path sends a data URL so PrintifyAPI.uploadImage takes its base64
 * branch; raw base64 would be mistaken for a file path.
 */
async function uploadGenerated(
  client: PrintifyAPI,
  fileName: string,
  imageBuffer: Buffer,
  mimeType: string | undefined,
  uploadMethod: string,
  imageUrl?: string
): Promise<any> {
  if (uploadMethod === 'imgbb' && imageUrl) {
    const image = await client.uploadImage(fileName, imageUrl);
    console.error(`Successfully uploaded image to Printify using ImgBB URL. Image ID: ${image.id}`);
    return image;
  }
  const base64Data = imageBuffer.toString('base64');
  const image = await client.uploadImage(fileName, `data:${mimeType ?? 'image/png'};base64,${base64Data}`);
  console.error(`Successfully uploaded image to Printify using direct base64. Image ID: ${image.id}`);
  return image;
}

/** Register every Printify tool and prompt on `server`. */
export function registerTools(server: McpServer, ctx: PrintifyContext): void {
  // Get Printify status tool
  server.tool(
    "get_printify_status",
    {},
    async (): Promise<{ content: any[], isError?: boolean }> => {
      // Import the printify shops service
      const { getPrintifyStatus } = await import('./services/printify-shops.js');

      if (!printifyReady(ctx)) return printifyNotReady();

      // Call the service
      const result = await getPrintifyStatus(ctx.printifyClient);

      return unwrap(result);
    }
  );

  // List shops tool
  server.tool(
    "list_shops",
    {},
    async (): Promise<{ content: any[], isError?: boolean }> => {
      // Import the printify shops service
      const { listPrintifyShops } = await import('./services/printify-shops.js');

      if (!printifyReady(ctx)) return printifyNotReady();

      // Call the service
      const result = await listPrintifyShops(ctx.printifyClient);

      return unwrap(result);
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

      if (!printifyReady(ctx)) return printifyNotReady();

      // Call the service
      const result = await switchPrintifyShop(ctx.printifyClient, shopId);

      return unwrap(result);
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

      if (!printifyReady(ctx)) return printifyNotReady();

      // Call the service
      const result = await listProducts(ctx.printifyClient, { page, limit });

      return unwrap(result);
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

      if (!printifyReady(ctx)) return printifyNotReady();

      // Call the service
      const result = await getProduct(ctx.printifyClient, productId);

      return unwrap(result);
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

      if (!printifyReady(ctx)) return printifyNotReady();

      // Call the service
      const result = await createProduct(ctx.printifyClient, {
        title,
        description,
        blueprintId,
        printProviderId,
        variants,
        printAreas,
        tags
      });

      return unwrap(result);
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

      if (!printifyReady(ctx)) return printifyNotReady();

      // Call the service
      const result = await updateProduct(ctx.printifyClient, productId, {
        title,
        description,
        variants,
        printAreas,
        tags
      });

      return unwrap(result);
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

      if (!printifyReady(ctx)) return printifyNotReady();

      // Call the service
      const result = await deleteProduct(ctx.printifyClient, productId);

      return unwrap(result);
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

      if (!printifyReady(ctx)) return printifyNotReady();

      // Call the service
      const result = await publishProduct(ctx.printifyClient, productId, publishDetails);

      return unwrap(result);
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

      if (!printifyReady(ctx)) return printifyNotReady();

      // Call the service
      const result = await getBlueprints(ctx.printifyClient, { page, limit });

      return unwrap(result);
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

      if (!printifyReady(ctx)) return printifyNotReady();

      // Call the service
      const result = await getBlueprint(ctx.printifyClient, blueprintId);

      return unwrap(result);
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

      if (!printifyReady(ctx)) return printifyNotReady();

      // Call the service
      const result = await getPrintProviders(ctx.printifyClient, blueprintId);

      return unwrap(result);
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

      if (!printifyReady(ctx)) return printifyNotReady();

      // Call the service
      const result = await getVariants(ctx.printifyClient, blueprintId, printProviderId);

      return unwrap(result);
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

      if (!printifyReady(ctx)) return printifyNotReady();

      // Log the attempt with limited information for privacy
      const sourceType = determineImageSourceType(url);
      const sourcePreview = sourceType === 'url' ? url.substring(0, 30) + '...' :
                           sourceType === 'file' ? url : // Show full file path
                           url.substring(0, 30) + '...';

      console.error(`Attempting to upload image: ${fileName} from ${sourceType} source: ${sourcePreview}`);

      // Call the service
      const result = await uploadImageToPrintify(ctx.printifyClient, fileName, url);

      return unwrap(result);
    }
  );

  // Imgur upload tool has been removed - we now upload directly to Printify

  // Get defaults tool
  server.tool(
    "get_defaults",
    {},
    async () => {
      try {
        if (!ctx.replicateClient) {
          return {
            content: [{
              type: "text",
              text: "Replicate API client is not initialized. The REPLICATE_API_TOKEN environment variable may not be set."
            }],
            isError: true
          };
        }

        const models = ctx.replicateClient.getAvailableModels();
        const currentDefault = ctx.replicateClient.getDefault('model');
        const allDefaults = ctx.replicateClient.getAllDefaults();

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
        if (!ctx.replicateClient) {
          return {
            content: [{
              type: "text",
              text: "Replicate API client is not initialized. The REPLICATE_API_TOKEN environment variable may not be set."
            }],
            isError: true
          };
        }

        // Set the default value
        ctx.replicateClient.setDefault(option, value);

        // Get all current defaults for the response
        const allDefaults = ctx.replicateClient.getAllDefaults();

        // Format the response based on the option type
        let detailedResponse = "";

        if (option === 'model') {
          // For model option, provide more detailed information
          const models = ctx.replicateClient.getAvailableModels();
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

      ...imageGenerationOptions
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
      if (!ctx.replicateClient) {
        return {
          content: [{
            type: "text",
            text: "Replicate API client is not initialized. The REPLICATE_API_TOKEN environment variable may not be set."
          }],
          isError: true
        };
      }

      if (!printifyReady(ctx)) return printifyNotReady();

      // Check if we're using the Ultra model which requires ImgBB
      // Determine which model to use (user-specified or default)
      const modelToUse = model || ctx.replicateClient.getDefaultModel();

      // Fail before generating: an Ultra image that cannot be staged is wasted
      // spend.
      if (requiresImgbb(modelToUse) && !hasImgbbKey(process.env.IMGBB_API_KEY)) {
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
      const currentShop = ctx.printifyClient.getCurrentShop();
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
      const defaults = ctx.replicateClient.getAllDefaults();

      // STEP 1: Generate the image with Replicate and process with Sharp
      // Start with defaults, then override with parameters from the tool call
      const generationResult = await generateImage(
        ctx.replicateClient,
        prompt,
        fileName,
        mergeGenerationOptions(defaults, {
          model, width, height, aspectRatio, outputFormat, safetyTolerance, seed,
          numInferenceSteps, guidanceScale, negativePrompt, promptUpsampling,
          outputQuality, raw, imagePromptStrength
        })
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

      await saveDebugCopy(imageBuffer, finalFileName);

      if (!imageBuffer || !finalFileName) {
        return {
          content: [{
            type: "text",
            text: `Error: No ${imageBuffer ? 'filename' : 'image data'} available for upload`
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

      // STEP 2: Stage on ImgBB when required or available.
      const staged = await stageOnImgbb(imageBuffer, usingModel, {
        axios, FormData, apiKey: process.env.IMGBB_API_KEY
      });
      if (staged.method === 'failed') {
        return { content: [{ type: "text", text: staged.message }], isError: true };
      }
      const uploadMethod = staged.method;
      const imageUrl = staged.method === 'imgbb' ? staged.imageUrl : undefined;

      // STEP 4/5: Use the configured Printify client.
      // Constructing a second SDK client from process.env here would ignore a key
      // passed to createPrintifyMcpServer(), and fall back to an empty token.
      const printifyForUpload = ctx.printifyClient;
      if (!printifyForUpload) {
        return {
          content: [{
            type: "text",
            text: `Printify client is not initialized. Set PRINTIFY_API_KEY, or pass printifyApiKey to createPrintifyMcpServer().` +
                  (imageUrl ? `\n\nThe generated image is available at: ${imageUrl}` : '')
          }],
          isError: true
        };
      }
      console.error(`Uploading via configured Printify client (shop ${printifyForUpload.getCurrentShopId() || 'unset'})`);

      // STEP 6: Upload the image to Printify
      let image: any;
      try {
        image = await uploadGenerated(printifyForUpload, finalFileName, imageBuffer, mimeType, uploadMethod, imageUrl);
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

      ...imageGenerationOptions
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
      if (!ctx.replicateClient) {
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
      const modelToUse = model || ctx.replicateClient.getDefaultModel();

      console.error(`Starting generate_image with prompt: ${prompt}`);
      console.error(`Using model: ${modelToUse}`);
      console.error(`Output path: ${outputPath}`);

      // Get default parameters first
      const defaults = ctx.replicateClient.getAllDefaults();

      // Generate the image with Replicate and process with Sharp
      // Start with defaults, then override with parameters from the tool call
      const generationResult = await generateImage(
        ctx.replicateClient,
        prompt,
        fileName,
        mergeGenerationOptions(defaults, {
          model, width, height, aspectRatio, outputFormat, safetyTolerance, seed,
          numInferenceSteps, guidanceScale, negativePrompt, promptUpsampling,
          outputQuality, raw, imagePromptStrength
        })
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
}
