#!/usr/bin/env node

// Must be first: reroutes stray stdout writes before anything can emit them.
// Only the CLI entrypoint may import this — it patches global console methods,
// which would be a hostile side effect for a library consumer. The library entry
// is `exports.ts`.
import { protocolStdout } from "./stdio-guard.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PrintifyAPI } from "./printify-api.js";
import { ReplicateClient } from "./replicate-client.js";
import { registerTools, type PrintifyContext } from "./tools.js";
import dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();

// Create an MCP server
const server = new McpServer({
  name: "Printify-MCP",
  version: "1.0.0"
});

// Shared with the tool handlers; populated by the async initialization below.
const ctx: PrintifyContext = {
  printifyClient: null,
  replicateClient: null
};

registerTools(server, ctx);

// Auto-initialize the API clients when the server starts
(async () => {
  try {
    // Initialize Printify API client
    const printifyApiKey = process.env.PRINTIFY_API_KEY;

    if (!printifyApiKey) {
      console.error("PRINTIFY_API_KEY environment variable is not set. The Printify API client will not be initialized.");
    } else {
      // Create the client with the API key
      ctx.printifyClient = new PrintifyAPI(printifyApiKey);

      // Initialize the client and fetch shops
      const shops = await ctx.printifyClient.initialize();

      // Get the current shop after initialization
      const currentShop = ctx.printifyClient.getCurrentShop();

      if (currentShop) {
        // A shop was automatically selected (either from PRINTIFY_SHOP_ID or the first available shop)
        console.error(`Printify SDK client initialized with shop: ${currentShop.title} (ID: ${currentShop.id})`);
        console.error(`Shop selection: ${process.env.PRINTIFY_SHOP_ID ? 'From environment variable' : 'Automatically selected first shop'}`);
      } else if (shops.length > 0) {
        // Shops exist but none was selected (this shouldn't happen with the current implementation)
        console.error(`Printify SDK client initialized, but no shop was selected. Available shops: ${shops.length}`);
        console.error('Attempting to select the first shop...');
        ctx.printifyClient.setShopId(shops[0].id.toString());
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
      ctx.replicateClient = new ReplicateClient(replicateApiToken);
      console.error('Replicate API client initialized successfully.');
    }
  } catch (error) {
    console.error("Error initializing API clients:", error);
  }
})();

// Start receiving messages on stdin and sending messages on stdout
const transport = new StdioServerTransport(process.stdin, protocolStdout);
await server.connect(transport);

console.error("Printify MCP Server started and connected via stdio");
