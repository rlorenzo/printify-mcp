import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTools, type PrintifyContext } from '../../src/tools.js';

/**
 * Registers the real tool surface against fake clients and invokes tools the
 * way the MCP runtime does.
 *
 * This is what makes the duplicated paths testable: extracting
 * registerTools(server, ctx) means tools can be driven without a live server,
 * a transport, or real Printify/Replicate credentials.
 */
export function harness(ctx: Partial<PrintifyContext> = {}) {
  const server = new McpServer({ name: 'test', version: '0' });
  const context = {
    printifyClient: null,
    replicateClient: null,
    ...ctx
  } as PrintifyContext;
  registerTools(server, context);

  const tools = (server as any)._registeredTools as Record<string, any>;

  return {
    server,
    context,
    names: () => Object.keys(tools),
    /** The zod shape keys for a tool's arguments. */
    schema: (name: string) => tools[name]?.inputSchema?.shape,
    async call(name: string, args: Record<string, any> = {}) {
      const tool = tools[name];
      if (!tool) throw new Error(`no such tool: ${name}`);
      return await tool.handler(args, { signal: new AbortController().signal } as any);
    }
  };
}

/** A Printify client stub that returns canned data. */
export function fakePrintify(overrides: Record<string, any> = {}) {
  return {
    getCurrentShop: () => ({ id: 1, title: 'Test Shop' }),
    getCurrentShopId: () => '1',
    getProducts: async () => ({ data: [{ id: 'p1', title: 'One' }] }),
    getProduct: async (id: string) => ({ id, title: 'One' }),
    uploadImage: async (fileName: string) => ({
      id: 'img_1', file_name: fileName, width: 1024, height: 1024, preview_url: 'https://example.test/p.png'
    }),
    ...overrides
  } as any;
}
