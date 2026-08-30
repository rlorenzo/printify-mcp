/**
 * Library entrypoint.
 *
 * This module is the package's `main`/`exports` target. It deliberately does not
 * import `stdio-guard.js` or connect a transport: importing the library must not
 * patch the consumer's console or take over their stdio. The executable
 * (`index.ts`) owns those side effects.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import dotenv from "dotenv";
import { PrintifyAPI } from "./printify-api.js";
import { ReplicateClient } from "./replicate-client.js";
import { DefaultsManager } from "./model-manager.js";
import { registerTools, type PrintifyContext } from "./tools.js";

// Public surface
export { PrintifyAPI, type PrintifyShop } from './printify-api.js';
export { ReplicateClient } from './replicate-client.js';
export { DefaultsManager } from './model-manager.js';
export { registerTools, type PrintifyContext } from './tools.js';
export * from './services/image-generator.js';
export * from './services/printify-uploader.js';
export * from './services/printify-products.js';
export * from './services/printify-blueprints.js';
export * from './services/printify-shops.js';
export * from './utils/error-handler.js';
export * from './utils/file-utils.js';

/**
 * Create a Printify MCP server with the full tool surface registered.
 *
 * The caller is responsible for connecting a transport, which keeps this usable
 * over stdio, HTTP, or in tests.
 */
export function createPrintifyMcpServer(options?: {
  printifyApiKey?: string;
  printifyShopId?: string;
  replicateApiToken?: string;
  serverName?: string;
  serverVersion?: string;
}) {
  // Load environment variables if not explicitly provided
  if (!options?.printifyApiKey || !options?.replicateApiToken) {
    dotenv.config();
  }

  const server = new McpServer({
    name: options?.serverName || "Printify-MCP",
    version: options?.serverVersion || "1.0.0"
  });

  const printifyApiKey = options?.printifyApiKey || process.env.PRINTIFY_API_KEY;
  const printifyShopId = options?.printifyShopId || process.env.PRINTIFY_SHOP_ID;
  const replicateApiToken = options?.replicateApiToken || process.env.REPLICATE_API_TOKEN;

  // Shared with the Replicate client when there is one, so a default set
  // through set_default reaches image generation, and survives its absence.
  const defaultsManager = new DefaultsManager();

  const ctx: PrintifyContext = {
    printifyClient: printifyApiKey ? new PrintifyAPI(printifyApiKey, printifyShopId) : null,
    replicateClient: replicateApiToken ? new ReplicateClient(replicateApiToken, defaultsManager) : null,
    defaultsManager
  };

  registerTools(server, ctx);

  return {
    server,
    get printifyClient() { return ctx.printifyClient; },
    get replicateClient() { return ctx.replicateClient; },
    async initialize() {
      if (ctx.printifyClient) {
        await ctx.printifyClient.initialize();
      }
      return { printifyClient: ctx.printifyClient, replicateClient: ctx.replicateClient };
    }
  };
}

export default createPrintifyMcpServer;
