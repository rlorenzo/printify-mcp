/**
 * Tool and prompt registration, shared by the executable and the library
 * factory (`createPrintifyMcpServer`).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PrintifyAPI, requireShop } from "./printify-api.js";
import { ReplicateClient } from "./replicate-client.js";
import { DefaultsManager } from "./model-manager.js";
import { mergeGenerationOptions } from "./generation-options.js";
import { stageOnImgbb, requiresImgbb, hasImgbbKey, IMGBB_REQUIRED_MESSAGE } from "./services/imgbb.js";
import { saveDebugCopy } from "./services/image-format.js";
import { generateImage } from "./services/image-generator.js";
import { boundErrorText, describeError, formatSuccessResponse, previewText, textResponse } from "./utils/error-handler.js";
import { ensureDirectoryExists, validateFilePath } from "./utils/file-utils.js";
import * as shops from "./services/printify-shops.js";
import * as products from "./services/printify-products.js";
import * as blueprints from "./services/printify-blueprints.js";
import * as orders from "./services/printify-orders.js";
import * as uploads from "./services/printify-uploads.js";
import { uploadImageToPrintify, determineImageSourceType } from "./services/printify-uploader.js";
import axios from "axios";
import FormData from "form-data";
import * as fs from "fs";
import * as path from "path";
import { readFile } from "fs/promises";
import { fileURLToPath } from "url";

/**
 * Clients shared with the tool handlers. Mutable because the clients are
 * initialized after the tools are registered.
 */
export interface PrintifyContext {
  printifyClient: PrintifyAPI | null;
  replicateClient: ReplicateClient | null;
  /**
   * Image-generation defaults. Held here, not on the Replicate client, so
   * `get_defaults`/`set_default` work without a REPLICATE_API_TOKEN. Created on
   * first use when omitted (see `defaultsFor`).
   */
  defaultsManager?: DefaultsManager;
}

type ToolResult = { content: any[]; isError?: boolean };
type ServiceResult = { success: boolean; response?: any; errorResponse?: any };

/** An error inside the MCP result envelope, so it reaches the model rather than the transport. */
function toolError(text: string): ToolResult {
  // Often carries an error.message that echoes model-supplied input.
  return { content: [{ type: "text", text: boundErrorText(text) }], isError: true };
}

/** The defaults as a markdown table. */
function formatDefaultsTable(allDefaults: Record<string, any>): string {
  const rows = Object.entries(allDefaults)
    .map(([key, val]) => `| ${key} | ${typeof val === 'object' ? JSON.stringify(val) : val} |`);
  return ['| Option | Value |', '|--------|-------|', ...rows].join('\n');
}

/** A model's markdown summary; `selected` marks the current default. */
function formatModelInfo(
  model: { id: string; name: string; description: string; capabilities: string[] },
  selected: boolean
): string {
  return `## ${model.name}${selected ? ' ✓ SELECTED' : ''}\n` +
         `- ID: \`${model.id}\`\n` +
         `- Description: ${model.description}\n` +
         `- Capabilities: ${model.capabilities.join(', ')}\n` +
         (selected ? `- Status: **Currently selected as default model**\n` : '');
}

function variantSchema<T extends z.ZodType<boolean | undefined>>(isEnabled: T) {
  return z.object({
    variantId: z.number().describe("Variant ID"),
    price: z.number().describe("Price in cents (e.g., 1999 for $19.99)"),
    isEnabled: isEnabled.describe("Whether the variant is enabled")
  });
}

/**
 * Print areas: a flat map of placements (every variant on create, merged into
 * existing groups on update), or a list of variant groups for per-colorway
 * artwork.
 */
const printAreasSchema = z.union([
  z.record(z.string(), z.object({
    position: z.string().describe("Print position (e.g., 'front', 'back')"),
    imageId: z.string().describe("Image ID from Printify uploads")
  })).describe("One entry per placement, applied to every variant"),
  z.array(z.object({
    variantIds: z.array(z.number()).describe("Variant IDs this artwork applies to"),
    placeholders: z.array(z.object({
      position: z.string().describe("Print position (e.g., 'front', 'back')"),
      imageId: z.string().describe("Image ID from Printify uploads")
    })).describe("Placements for these variants")
  })).describe("One entry per variant group, for per-colorway artwork")
]);

type ReadyContext = PrintifyContext & { printifyClient: PrintifyAPI };

function printifyReady(ctx: PrintifyContext): ctx is ReadyContext {
  return ctx.printifyClient !== null;
}


function printifyNotReady(): ToolResult {
  return toolError("Printify API client is not initialized. Set the PRINTIFY_API_KEY environment variable, or pass printifyApiKey to createPrintifyMcpServer().");
}

/** Only the two generation tools need Replicate; the defaults tools do not. */
function replicateNotReady(): ToolResult {
  return toolError("Replicate API client is not initialized, so image generation is unavailable. Set the REPLICATE_API_TOKEN environment variable, or pass replicateApiToken to createPrintifyMcpServer().");
}

/**
 * The context's defaults, created on first use. Prefers the Replicate client's
 * manager so a default set here still reaches image generation.
 */
function defaultsFor(ctx: PrintifyContext): DefaultsManager {
  ctx.defaultsManager ??= ctx.replicateClient?.getDefaultsManager?.() ?? new DefaultsManager();
  return ctx.defaultsManager;
}

/** Collapse a service result into the MCP envelope. */
function unwrap(result: ServiceResult): ToolResult {
  return (result.success ? result.response : result.errorResponse) as ToolResult;
}

const DOC_TOPICS = [
  "product_creation",
  "blueprints",
  "print_providers",
  "variants",
  "images",
  "publishing",
  "image_generation",
  "orders"
] as const;

/** Generation options shared by generate_and_upload_image and generate_image. */
const imageGenerationOptions = {
  model: z.string().optional()
    .describe("Optional: Override the default model. Use get_defaults to see available models"),

  // Common parameters for both models
  width: z.number().optional().describe("Image width in pixels (default 1024 unless an aspect ratio is set)"),
  height: z.number().optional().describe("Image height in pixels (default 1024 unless an aspect ratio is set)"),
  aspectRatio: z.string().optional().describe("Aspect ratio (e.g., '16:9', '4:3', '1:1'). If provided, overrides width and height"),
  // No zod defaults here: unset options fall back to DefaultsManager, so
  // set_default takes effect.
  outputFormat: z.enum(["jpeg", "png", "webp"]).optional().describe("Output format"),
  safetyTolerance: z.number().optional().describe("Safety tolerance (0-6)"),
  seed: z.number().optional().describe("Random seed for reproducible generation"),
  numInferenceSteps: z.number().optional().describe("Number of inference steps"),
  guidanceScale: z.number().optional().describe("Guidance scale"),
  negativePrompt: z.string().optional().describe("Negative prompt"),

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
 * Upload a generated image to Printify: by ImgBB URL when staged, otherwise as
 * a data URL (raw base64 would be mistaken for a file path).
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

const READ_ONLY = { readOnlyHint: true };

/** Register every Printify tool and prompt on `server`. */
export function registerTools(server: McpServer, ctx: PrintifyContext): void {
  /** Guard on the Printify client, then unwrap the service result. */
  const withPrintify = <A>(run: (client: PrintifyAPI, args: A) => Promise<ServiceResult>) =>
    async (args: A): Promise<ToolResult> => {
      if (!printifyReady(ctx)) return printifyNotReady();
      return unwrap(await run(ctx.printifyClient, args));
    };

  server.tool("get_printify_status", {}, READ_ONLY, withPrintify((client) => shops.getPrintifyStatus(client)));

  server.tool("list_shops", {}, READ_ONLY, withPrintify((client) => shops.listPrintifyShops(client)));

  server.tool(
    "switch_shop",
    { shopId: z.string().describe("The ID of the shop to switch to") },
    withPrintify((client, { shopId }) => shops.switchPrintifyShop(client, shopId))
  );

  server.tool(
    "list_products",
    {
      page: z.number().optional().default(1).describe("Page number"),
      limit: z.number().optional().default(10).describe("Number of products per page")
    },
    READ_ONLY,
    withPrintify((client, { page, limit }) => products.listProducts(client, { page, limit }))
  );

  server.tool(
    "get_product",
    { productId: z.string().describe("Product ID") },
    READ_ONLY,
    withPrintify((client, { productId }) => products.getProduct(client, productId))
  );

  server.tool(
    "create_product",
    {
      title: z.string().describe("Product title"),
      description: z.string().describe("Product description"),
      blueprintId: z.number().describe("Blueprint ID"),
      printProviderId: z.number().describe("Print provider ID"),
      variants: z.array(variantSchema(z.boolean().optional().default(true))).describe("Product variants"),
      printAreas: printAreasSchema.optional().describe("Print areas for the product"),
      tags: z.array(z.string()).optional().describe("Tags for the product")
    },
    withPrintify((client, args) => products.createProduct(client, args))
  );

  server.tool(
    "update_product",
    {
      productId: z.string().describe("Product ID"),
      title: z.string().optional().describe("Product title"),
      description: z.string().optional().describe("Product description"),
      variants: z.array(variantSchema(z.boolean().optional())).optional().describe("Product variants"),
      printAreas: printAreasSchema.optional().describe("Print areas for the product"),
      tags: z.array(z.string()).optional().describe("Tags for the product")
    },
    { title: "Update product", destructiveHint: true, idempotentHint: false },
    withPrintify((client, { productId, ...updateData }) => products.updateProduct(client, productId, updateData))
  );

  server.tool(
    "delete_product",
    { productId: z.string().describe("Product ID") },
    { title: "Delete product", destructiveHint: true, idempotentHint: false },
    withPrintify((client, { productId }) => products.deleteProduct(client, productId))
  );

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
    { title: "Publish product", destructiveHint: true, idempotentHint: false },
    withPrintify((client, { productId, publishDetails }) => products.publishProduct(client, productId, publishDetails))
  );

  server.tool(
    "set_publish_succeeded",
    {
      productId: z.string().describe("Printify product ID"),
      externalId: z.string().describe("The product's id in the custom sales channel"),
      handle: z.string().describe("The product's URL in the custom sales channel")
    },
    { title: "Mark publish succeeded (custom channels)", destructiveHint: false, idempotentHint: true },
    withPrintify((client, { productId, externalId, handle }) =>
      products.setPublishSucceeded(client, productId, { id: externalId, handle }))
  );

  server.tool(
    "set_publish_failed",
    {
      productId: z.string().describe("Printify product ID"),
      reason: z.string().describe("Why publishing failed, e.g. \"Request timed out\"")
    },
    { title: "Mark publish failed (custom channels)", destructiveHint: false, idempotentHint: true },
    withPrintify((client, { productId, reason }) => products.setPublishFailed(client, productId, reason))
  );

  server.tool(
    "notify_unpublished",
    { productId: z.string().describe("Printify product ID") },
    { title: "Mark product unpublished (custom channels)", destructiveHint: true, idempotentHint: true },
    withPrintify((client, { productId }) => products.notifyUnpublished(client, productId))
  );

  server.tool(
    "get_blueprints",
    {
      page: z.number().optional().default(1).describe("Page number"),
      limit: z.number().optional().default(10).describe("Number of blueprints per page (max 100)")
    },
    READ_ONLY,
    withPrintify((client, { page, limit }) => blueprints.getBlueprints(client, { page, limit }))
  );

  server.tool(
    "get_blueprint",
    { blueprintId: z.string().describe("Blueprint ID") },
    READ_ONLY,
    withPrintify((client, { blueprintId }) => blueprints.getBlueprint(client, blueprintId))
  );

  server.tool(
    "get_print_providers",
    { blueprintId: z.string().describe("Blueprint ID") },
    READ_ONLY,
    withPrintify((client, { blueprintId }) => blueprints.getPrintProviders(client, blueprintId))
  );

  server.tool(
    "get_variants",
    {
      blueprintId: z.string().describe("Blueprint ID"),
      printProviderId: z.string().describe("Print provider ID"),
      page: z.number().optional().default(1).describe("Page number"),
      limit: z.number().optional().default(50).describe("Number of variants per page (max 100)"),
      showOutOfStock: z.boolean().optional()
        .describe("Include variants that are currently out of stock (the API hides them by default)")
    },
    READ_ONLY,
    withPrintify((client, { blueprintId, printProviderId, page, limit, showOutOfStock }) =>
      blueprints.getVariants(client, blueprintId, printProviderId, { page, limit, showOutOfStock }))
  );

  server.tool(
    "list_all_print_providers",
    {
      page: z.number().optional().default(1).describe("Page number"),
      limit: z.number().optional().default(20).describe("Number of providers per page (max 100)")
    },
    READ_ONLY,
    withPrintify((client, { page, limit }) => blueprints.listAllPrintProviders(client, { page, limit }))
  );

  server.tool(
    "get_print_provider",
    {
      printProviderId: z.string().describe("Print provider ID"),
      page: z.number().optional().default(1).describe("Page of the provider's blueprints"),
      limit: z.number().optional().default(20).describe("Number of blueprints per page (max 100)")
    },
    READ_ONLY,
    withPrintify((client, { printProviderId, page, limit }) =>
      blueprints.getPrintProvider(client, printProviderId, { page, limit }))
  );

  server.tool(
    "get_shipping",
    {
      blueprintId: z.string().describe("Blueprint ID"),
      printProviderId: z.string().describe("Print provider ID"),
      country: z.string().optional().describe("Two-letter country code (e.g. US, DE) to show only the rates for that country")
    },
    READ_ONLY,
    withPrintify((client, { blueprintId, printProviderId, country }) =>
      blueprints.getShipping(client, blueprintId, printProviderId, { country }))
  );

  server.tool(
    "list_orders",
    {
      page: z.number().int().positive().optional().default(1).describe("Page number"),
      limit: z.number().int().positive().optional().default(10).describe("Number of orders per page"),
      status: z.string().optional()
        .describe("Only orders with this status, e.g. pending, on-hold, in-production, fulfilled, canceled"),
      sku: z.string().optional().describe("Only orders containing this SKU")
    },
    READ_ONLY,
    withPrintify((client, { page, limit, status, sku }) => orders.listOrders(client, { page, limit, status, sku }))
  );

  server.tool(
    "get_order",
    { orderId: z.string().describe("Order ID") },
    READ_ONLY,
    withPrintify((client, { orderId }) => orders.getOrder(client, orderId))
  );

  server.tool(
    "calculate_order_shipping",
    {
      lineItems: z.array(z.object({
        productId: z.string().optional().describe("Product ID (with variantId)"),
        variantId: z.number().optional().describe("Variant ID"),
        printProviderId: z.number().optional().describe("Print provider ID (with blueprintId and variantId, for a product not in the shop)"),
        blueprintId: z.number().optional().describe("Blueprint ID"),
        sku: z.string().optional().describe("Product SKU (instead of the ids)"),
        quantity: z.number().int().positive().describe("Quantity")
      })).min(1).describe("Items to quote, each by productId + variantId, by printProviderId + blueprintId + variantId, or by sku"),
      address: z.object({
        country: z.string().describe("Two-letter country code, e.g. US"),
        zip: z.string().optional().describe("Postal code"),
        region: z.string().optional().describe("State or region"),
        city: z.string().optional().describe("City"),
        address1: z.string().optional().describe("Street address"),
        address2: z.string().optional().describe("Apartment, suite, etc."),
        firstName: z.string().optional().describe("Recipient first name"),
        lastName: z.string().optional().describe("Recipient last name"),
        email: z.string().optional().describe("Recipient email"),
        phone: z.string().optional().describe("Recipient phone")
      }).describe("Destination address. Printify may reject a partial address, so give the full recipient address when you have it")
    },
    // Quotes only: the endpoint is a POST but creates nothing.
    READ_ONLY,
    withPrintify((client, { lineItems, address }) => orders.calculateOrderShipping(client, lineItems, address))
  );

  server.tool(
    "create_order",
    {
      lineItems: z.array(z.object({
        productId: z.string().optional().describe("Product ID (with variantId)"),
        variantId: z.number().optional().describe("Variant ID"),
        printProviderId: z.number().optional().describe("Print provider ID (with blueprintId, variantId and printAreas, for an item not saved as a product)"),
        blueprintId: z.number().optional().describe("Blueprint ID"),
        printAreas: z.record(z.string(), z.string()).optional().describe("Position to image URL, e.g. { front: \"https://...\" }"),
        sku: z.string().optional().describe("Product SKU (instead of the ids)"),
        quantity: z.number().int().positive().describe("Quantity")
      })).min(1).describe("Items to order"),
      address: z.object({
        firstName: z.string().describe("Recipient first name"),
        lastName: z.string().describe("Recipient last name"),
        email: z.string().optional().describe("Recipient email"),
        phone: z.string().optional().describe("Recipient phone"),
        country: z.string().describe("Two-letter country code, e.g. US"),
        region: z.string().optional().describe("State or region"),
        address1: z.string().describe("Street address"),
        address2: z.string().optional().describe("Apartment, suite, etc."),
        city: z.string().describe("City"),
        zip: z.string().describe("Postal code"),
        company: z.string().optional().describe("Company")
      }).describe("Shipping address"),
      shippingMethod: z.enum(["standard", "priority", "printify_express", "economy"]).optional()
        .describe("Shipping method (default standard). printify_express is Printify Express, for eligible products only; " +
          "calculate_order_shipping quotes it as \"Printify Express\""),
      externalId: z.string().optional().describe("Your own id for the order; generated when omitted"),
      label: z.string().optional().describe("A label shown on the order in Printify"),
      sendShippingNotification: z.boolean().optional().describe("Have Printify email the recipient when it ships (default false)")
    },
    { title: "Create order (on hold)", destructiveHint: false, idempotentHint: false },
    withPrintify((client, args) => orders.createOrder(client, args))
  );

  server.tool(
    "send_order_to_production",
    {
      orderId: z.string().describe("Order ID of an on-hold order"),
      confirm: z.literal(true).describe("Must be true: sending to production charges the Printify account and cannot be undone")
    },
    { title: "Send order to production (charges the account)", destructiveHint: true, idempotentHint: false },
    withPrintify((client, { orderId }) => orders.sendOrderToProduction(client, orderId))
  );

  server.tool(
    "cancel_order",
    { orderId: z.string().describe("Order ID of an order that is on hold or awaiting payment") },
    { title: "Cancel order", destructiveHint: true, idempotentHint: true },
    withPrintify((client, { orderId }) => orders.cancelOrder(client, orderId))
  );

  server.tool(
    "upload_image",
    {
      fileName: z.string().describe("File name"),
      url: z.string().describe("URL of the image to upload, path to a local file inside ALLOWED_FILE_DIR, or a data: URL with base64 image data")
    },
    withPrintify((client, { fileName, url }) => {
      // A "file" source may be raw base64 of any length, so it is bounded too.
      const sourceType = determineImageSourceType(url);
      const sourcePreview = sourceType === 'file' ? previewText(url) : url.substring(0, 30) + '...';
      console.error(`Attempting to upload image: ${fileName} from ${sourceType} source: ${sourcePreview}`);

      return uploadImageToPrintify(client, fileName, url);
    })
  );

  server.tool(
    "get_defaults",
    {},
    READ_ONLY,
    async () => {
      try {
        const defaults = defaultsFor(ctx);
        const currentDefault = defaults.getDefault('model');
        const modelInfo = defaults.getAvailableModels()
          .map(model => formatModelInfo(model, model.id === currentDefault))
          .join('\n');

        return textResponse(
          `# Current Default Settings\n\n` +
          (ctx.replicateClient ? `` :
            `> No REPLICATE_API_TOKEN is configured, so these defaults can be read and ` +
            `changed but image generation is unavailable.\n\n`) +
          `## Selected Model\n\n${modelInfo}\n\n` +
          `## All Default Parameters\n\n` +
          formatDefaultsTable(defaults.getAllDefaults()) +
          `\n\n` +
          `To change any default setting, use the \`set_default\` tool:\n` +
          `\`\`\`javascript\n` +
          `set_default({ option: "model", value: "black-forest-labs/flux-1.1-pro-ultra" })\n` +
          `set_default({ option: "aspectRatio", value: "16:9" })\n` +
          `set_default({ option: "raw", value: false })\n` +
          `\`\`\``
        );
      } catch (error: any) {
        return toolError(`Error getting defaults: ${error.message}`);
      }
    }
  );

  server.tool(
    "set_default",
    {
      option: z.string().describe("The option name to set (e.g., 'model', 'aspectRatio', 'raw', etc.)"),
      value: z.any().describe("The value to set for the option")
    },
    async ({ option, value }) => {
      try {
        const defaults = defaultsFor(ctx);
        defaults.setDefault(option, value);

        const selectedModel = option === 'model'
          ? defaults.getAvailableModels().find(model => model.id === value)
          : undefined;

        return textResponse(
          `# Default Setting Updated\n\n` +
          `Successfully set default \`${option}\` to: \`${value}\`\n\n` +
          (selectedModel ? formatModelInfo(selectedModel, true) + '\n' : '') +
          `## Current Default Settings\n\n` +
          formatDefaultsTable(defaults.getAllDefaults()) +
          `\n\nThese settings will be used by default for all image generation unless overridden in the tool call.`
        );
      } catch (error: any) {
        return toolError(`Error setting default: ${error.message}`);
      }
    }
  );

  server.tool(
    "how_to_use",
    {
      topic: z.enum(DOC_TOPICS).describe("The topic to get documentation for")
    },
    READ_ONLY,
    async ({ topic }) => {
      // Resolved from this module's location, independent of the working directory.
      const filePath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'docs', `${topic}.md`);
      try {
        return textResponse(await readFile(filePath, 'utf8'));
      } catch (readError: any) {
        console.error(`Failed to read docs for "${topic}" at ${filePath}:`, readError);
        return toolError(`Documentation for topic "${topic}" not found. Available topics are: ${DOC_TOPICS.join(', ')}`);
      }
    }
  );

  server.prompt(
    "generate_product_description",
    {
      productName: z.string(),
      category: z.string(),
      targetAudience: z.string().optional(),
      keyFeatures: z.string().optional().describe("Comma-separated list of key features")
    },
    ({ productName, category, targetAudience, keyFeatures }) => {
      const featuresText = keyFeatures
        ? `\nKey features:\n${keyFeatures.split(',').map(f => `- ${f.trim()}`).join('\n')}`
        : "";
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

  /** Generate with the stored defaults, overridden by any explicit tool argument. */
  const runGeneration = (replicate: ReplicateClient, prompt: string, fileName: string, args: Record<string, any>) => {
    const options = mergeGenerationOptions(defaultsFor(ctx).getAllDefaults(), args);
    return { options, result: generateImage(replicate, prompt, fileName, options) };
  };

  server.tool(
    "list_uploads",
    {
      page: z.number().optional().default(1).describe("Page number"),
      limit: z.number().optional().default(10).describe("Number of images per page")
    },
    READ_ONLY,
    withPrintify((client, { page, limit }) => uploads.listUploads(client, { page, limit }))
  );

  server.tool(
    "get_upload",
    { imageId: z.string().describe("Uploaded image ID") },
    READ_ONLY,
    withPrintify((client, { imageId }) => uploads.getUpload(client, imageId))
  );

  server.tool(
    "archive_upload",
    { imageId: z.string().describe("Uploaded image ID") },
    { title: "Archive uploaded image", destructiveHint: true, idempotentHint: true },
    withPrintify((client, { imageId }) => uploads.archiveUpload(client, imageId))
  );

  server.tool(
    "generate_and_upload_image",
    {
      prompt: z.string().describe("Text prompt for image generation"),
      fileName: z.string().describe("File name for the uploaded image"),
      ...imageGenerationOptions
    },
    async ({ prompt, fileName, ...args }): Promise<ToolResult> => {
      if (!ctx.replicateClient) return replicateNotReady();
      if (!printifyReady(ctx)) return printifyNotReady();

      // Fail before generating: an Ultra image that cannot be staged is wasted spend.
      const modelToUse = args.model || defaultsFor(ctx).getDefault('model');
      if (requiresImgbb(modelToUse) && !hasImgbbKey(process.env.IMGBB_API_KEY)) {
        return toolError(`ERROR: ${IMGBB_REQUIRED_MESSAGE}`);
      }

      try {
        requireShop(ctx.printifyClient);
      } catch (error: any) {
        return toolError(error.message);
      }

      console.error(`Starting generate_and_upload_image with prompt: ${prompt}`);

      const generated = await runGeneration(ctx.replicateClient, prompt, fileName, args).result;
      if (!generated.success) return generated.errorResponse;

      const { buffer: imageBuffer, mimeType, fileName: finalFileName, model: usingModel } = generated;
      const uploadDetails = [
        `Preparing to upload image to Printify:`,
        `- File name: ${finalFileName}`,
        `- Image buffer size: ${imageBuffer.length} bytes`,
        `- MIME type: ${mimeType}`,
        `- Model used: ${usingModel}`
      ].join('\n');
      console.error(uploadDetails);

      await saveDebugCopy(imageBuffer, finalFileName);

      const staged = await stageOnImgbb(imageBuffer, usingModel, {
        axios, FormData, apiKey: process.env.IMGBB_API_KEY
      });
      if (staged.method === 'failed') return toolError(staged.message);
      const imageUrl = staged.method === 'imgbb' ? staged.imageUrl : undefined;

      // Upload through the configured client, so a key passed to
      // createPrintifyMcpServer() is honored.
      let image: any;
      try {
        image = await uploadGenerated(ctx.printifyClient, finalFileName, imageBuffer, mimeType, staged.method, imageUrl);
      } catch (uploadError: any) {
        console.error('Error uploading generated image to Printify:', describeError(uploadError));
        const status = uploadError.response?.status;
        return toolError(`Error uploading to Printify: ${uploadError.message || String(uploadError)}\n\n` +
                  `Upload method: ${staged.method}${imageUrl ? `\nImgBB URL: ${imageUrl}` : ''}` +
                  (status ? `\n\nHTTP status: ${status}` : ''));
      }

      return formatSuccessResponse(
        'Image Generated and Uploaded Successfully',
        {
          Prompt: prompt,
          Model: usingModel.split('/')[1],
          'Image ID': image.id,
          'File Name': image.file_name,
          Dimensions: `${image.width}x${image.height}`,
          'Preview URL': image.preview_url,
          'Upload Method': staged.method === "imgbb" ? "ImgBB URL" : "Direct base64",
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
      );
    }
  );

  server.tool(
    "generate_image",
    {
      prompt: z.string().describe("Text prompt for image generation"),
      outputPath: z.string().describe("Path where the generated image should be saved; must be inside ALLOWED_FILE_DIR (default: the working directory)"),
      ...imageGenerationOptions
    },
    async ({ prompt, outputPath: rawOutputPath, ...args }): Promise<ToolResult> => {
      if (!ctx.replicateClient) return replicateNotReady();

      // Validated before generating, so a rejected path costs no Replicate spend.
      let outputPath: string;
      try {
        outputPath = validateFilePath(rawOutputPath, 'write');
      } catch (error: any) {
        return toolError(error.message);
      }

      console.error(`Starting generate_image with prompt: ${prompt}`);
      console.error(`Output path: ${outputPath}`);

      const { options, result } = runGeneration(ctx.replicateClient, prompt, path.basename(outputPath), args);
      const generated = await result;
      if (!generated.success) return generated.errorResponse;

      const { buffer: imageBuffer, dimensions } = generated;

      try {
        // Re-validate after the (slow) Replicate call, in case outputPath was
        // swapped for a symlink out of ALLOWED_FILE_DIR meanwhile.
        outputPath = validateFilePath(rawOutputPath, 'write');
        ensureDirectoryExists(path.dirname(outputPath));

        // O_NOFOLLOW makes a symlink swapped in after that check fail with
        // ELOOP on POSIX. It is undefined on Windows, where the revalidation
        // above is the only protection.
        const fd = fs.openSync(
          outputPath,
          fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | (fs.constants.O_NOFOLLOW || 0)
        );
        try {
          // writeFileSync loops until the whole buffer is written.
          fs.writeFileSync(fd, imageBuffer);
        } finally {
          fs.closeSync(fd);
        }

        return formatSuccessResponse(
          'Image Generated Successfully',
          {
            Prompt: prompt,
            Model: generated.model.split('/')[1],
            'Output Path': outputPath,
            // The file actually written; generated.fileName carries the
            // format's extension, which outputPath need not.
            'File Name': path.basename(outputPath),
            'File Size': `${imageBuffer.length} bytes`,
            'Dimensions': dimensions,
            'Format': options.outputFormat,
            'Generation Parameters': {
              // Only when one was used: explicit width/height drop the ratio,
              // and reporting "1:1" then would describe an image not made.
              ...(options.aspectRatio ? { 'Aspect Ratio': options.aspectRatio } : {}),
              'Inference Steps': options.numInferenceSteps,
              'Guidance Scale': options.guidanceScale,
              'Negative Prompt': options.negativePrompt,
              ...(args.raw !== undefined ? { 'Raw Mode': args.raw } : {}),
              ...(args.promptUpsampling !== undefined ? { 'Prompt Upsampling': args.promptUpsampling } : {}),
              ...(args.outputQuality !== undefined ? { 'Output Quality': args.outputQuality } : {}),
              ...(args.imagePromptStrength !== undefined ? { 'Image Prompt Strength': args.imagePromptStrength } : {}),
              ...(args.seed !== undefined ? { 'Seed': args.seed } : {})
            }
          },
          `Image has been successfully generated and saved to: ${outputPath}`
        );
      } catch (error: any) {
        return toolError(`Error saving image to ${outputPath}: ${error.message || String(error)}`);
      }
    }
  );
}
