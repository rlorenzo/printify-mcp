/**
 * Client initialization for the CLI entrypoint (kept out of index.ts so it can
 * be tested directly).
 */
import { PrintifyAPI } from './printify-api.js';
import { ReplicateClient } from './replicate-client.js';
import { DefaultsManager } from './model-manager.js';
import type { PrintifyContext } from './tools.js';
import { describeError } from './utils/error-handler.js';

/**
 * Populate `ctx` from the environment. Never throws: a missing key or an
 * unreachable Printify leaves that client null for the tools to report.
 * Replicate is set up first because it needs no network, so image tools are
 * ready while Printify is still connecting.
 */
export async function initializeClients(
  ctx: PrintifyContext,
  env: NodeJS.ProcessEnv = process.env
): Promise<PrintifyContext> {
  try {
    // Shared with the client so defaults set without a token still apply.
    ctx.defaultsManager ??= new DefaultsManager();

    const replicateApiToken = env.REPLICATE_API_TOKEN;
    if (!replicateApiToken) {
      console.error('REPLICATE_API_TOKEN environment variable is not set. The Replicate API client will not be initialized, so image generation is unavailable. get_defaults and set_default still work.');
    } else {
      ctx.replicateClient = new ReplicateClient(replicateApiToken, ctx.defaultsManager);
      console.error('Replicate API client initialized successfully.');
    }
  } catch (error) {
    console.error('Error initializing the Replicate API client:', describeError(error));
  }

  try {
    const printifyApiKey = env.PRINTIFY_API_KEY;

    if (!printifyApiKey) {
      console.error('PRINTIFY_API_KEY environment variable is not set. The Printify API client will not be initialized.');
    } else {
      ctx.printifyClient = new PrintifyAPI(printifyApiKey, env.PRINTIFY_SHOP_ID);
      const shops = await ctx.printifyClient.initialize();
      const currentShop = ctx.printifyClient.getCurrentShop();

      if (currentShop) {
        console.error(`Printify SDK client initialized with shop: ${currentShop.title} (ID: ${currentShop.id})`);
        console.error(`Shop selection: ${env.PRINTIFY_SHOP_ID ? 'From environment variable' : 'Automatically selected first shop'}`);
      } else if (shops.length > 0) {
        console.error(`Printify SDK client initialized, but no shop was selected. Available shops: ${shops.length}`);
        ctx.printifyClient.setShopId(shops[0].id.toString());
        console.error(`Selected shop: ${shops[0].title} (ID: ${shops[0].id})`);
      } else {
        console.error('Printify SDK client initialized, but no shops were found in your account.');
      }
    }
  } catch (error) {
    console.error('Error initializing the Printify API client:', describeError(error));
  }

  return ctx;
}
