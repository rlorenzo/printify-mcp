#!/usr/bin/env node

// Must be first: reroutes stray stdout writes before anything can emit them.
// Only the CLI entrypoint may import this — it patches global console methods,
// which would be a hostile side effect for a library consumer. The library entry
// is `exports.ts`.
import { protocolStdout } from "./stdio-guard.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools, type PrintifyContext } from "./tools.js";
import { initializeClients } from "./bootstrap.js";
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

// Auto-initialize the API clients when the server starts. Fire-and-forget: the
// server accepts connections immediately and each tool reports its own client's
// readiness.
void initializeClients(ctx);

// Start receiving messages on stdin and sending messages on stdout
const transport = new StdioServerTransport(process.stdin, protocolStdout);
await server.connect(transport);

console.error("Printify MCP Server started and connected via stdio");
