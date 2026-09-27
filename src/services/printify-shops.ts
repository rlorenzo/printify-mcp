/**
 * Printify shops service.
 */
import { PrintifyAPI } from '../printify-api.js';
import { runService, textResponse, TIPS } from '../utils/error-handler.js';

export async function getPrintifyStatus(printifyClient: PrintifyAPI) {
  return runService('Get Printify Status', { tips: [TIPS.apiKey, TIPS.connected] }, async () => {
    const shops = await printifyClient.getShops();
    const currentShop = printifyClient.getCurrentShop();

    return {
      shops,
      currentShop,
      response: textResponse(
        `Printify API Status:\n\n` +
        `Connected: Yes\n` +
        `Available Shops: ${shops.length}\n` +
        `Current Shop: ${currentShop ? `${currentShop.title} (ID: ${currentShop.id})` : 'None'}`
      )
    };
  });
}

export async function listPrintifyShops(printifyClient: PrintifyAPI) {
  return runService('List Printify Shops', { tips: [TIPS.apiKey, TIPS.connected] }, async () => {
    const shops = await printifyClient.getShops();
    const currentShopId = printifyClient.getCurrentShopId();

    if (shops.length === 0) {
      return { shops: [], response: textResponse("No shops found in your Printify account.") };
    }

    const shopsText = shops.map((shop: any) => {
      const isCurrent = shop.id.toString() === currentShopId;
      return `${isCurrent ? '→ ' : '  '}${shop.title} (ID: ${shop.id}, Channel: ${shop.sales_channel})`;
    }).join('\n');

    return {
      shops,
      currentShopId,
      response: textResponse(`Available Printify Shops:\n\n${shopsText}`)
    };
  });
}

export async function switchPrintifyShop(printifyClient: PrintifyAPI, shopId: string) {
  return runService(
    'Switch Printify Shop',
    {
      context: () => ({ ShopId: shopId }),
      tips: ['Check that the shop ID is valid', 'Use the list_shops tool to see available shops', TIPS.connected]
    },
    async () => {
      const shops = await printifyClient.getShops();
      const shop = shops.find((s: any) => s.id.toString() === shopId);
      if (!shop) {
        throw new Error(`Shop with ID ${shopId} not found. Use the list_shops tool to see available shops.`);
      }

      printifyClient.setShopId(shopId);

      return {
        shop,
        response: textResponse(`Switched to shop: ${shop.title} (ID: ${shop.id}, Channel: ${shop.sales_channel})`)
      };
    }
  );
}
