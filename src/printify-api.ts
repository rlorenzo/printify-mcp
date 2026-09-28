import * as path from 'path';
import Printify from 'printify-sdk-js';
import sharp from 'sharp';
import { describeError, previewText } from './utils/error-handler.js';
import { normalizeFileUri, readConfinedFile } from './utils/file-utils.js';
import { applyOutputFormat, mimeTypeFor } from './services/image-format.js';

/** Largest local file an upload will read; the uploader's pre-check uses the same limit. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export interface PrintifyShop {
  id: number;
  title: string;
  sales_channel: string;
}

/** The selected shop, or the error every shop-scoped service reports without one. */
export function requireShop(client: PrintifyAPI): PrintifyShop {
  const shop = client.getCurrentShop();
  if (!shop) {
    throw new Error('No shop is currently selected. Use the list_shops and switch_shop tools to select a shop.');
  }
  return shop;
}

/**
 * A resource id checked before the SDK puts it into a URL path. The SDK does
 * not encode ids, and these come from the model: a value like "abc/../../x"
 * would otherwise reach a different endpoint with the account's API key.
 */
function pathId(value: string | number, label: string): string {
  const id = String(value ?? '').trim();
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error(`${label} must be a plain id (letters, digits, - or _), got "${String(value ?? '').slice(0, 40)}"`);
  }
  return id;
}

/**
 * A catalog id checked before the SDK puts it into a URL path. The SDK does
 * not encode ids, and these come from the model: a value like "3/../../shops"
 * would otherwise reach a different endpoint with the account's API key.
 */
function catalogId(value: string | number, label: string): string {
  const id = String(value).trim();
  if (!/^\d+$/.test(id)) {
    throw new Error(`${label} must be a numeric id, got "${String(value).slice(0, 40)}"`);
  }
  return id;
}

/**
 * Placeholders for one print-area entry. `{ position, imageId }` becomes a
 * centred, unscaled image; placeholders with their own `images` pass through.
 */
function buildPlaceholders(printAreasData: Record<string, any> | any[]): any[] {
  const areas = Array.isArray(printAreasData) ? printAreasData : Object.values(printAreasData ?? {});
  return areas.map((area: any) => (
    Array.isArray(area.images)
      ? { position: area.position, images: area.images }
      : {
          position: area.position,
          images: [{
            id: area.image_id || area.imageId,
            x: 0.5,
            y: 0.5,
            scale: 1,
            angle: 0
          }]
        }
  ));
}

/**
 * Print areas for a flat map: one entry over `variantIds`, or none when the map
 * is empty. Zero variants is rejected: the API accepts `variant_ids: []` and
 * silently attaches the artwork to nothing.
 */
function buildPrintAreas(variantIds: any[], printAreasData: Record<string, any> | any[]): any[] {
  const placeholders = buildPlaceholders(printAreasData);
  if (placeholders.length === 0) return [];

  if (variantIds.length === 0) {
    throw new Error(
      'Cannot apply print areas to zero variants. Supply the variants the ' +
      'artwork belongs to, or pass per-variant groups that name them.'
    );
  }

  return [{ variant_ids: variantIds, placeholders }];
}

/**
 * Whether the input is a list of `{ variantIds, placeholders }` groups. An empty
 * list counts, since it is how a caller clears all print areas.
 */
function isPerVariantGroups(printAreasData: any): boolean {
  return Array.isArray(printAreasData)
    && printAreasData.every((group: any) => group && (group.variant_ids || group.variantIds));
}

/**
 * Normalize variant groups to the wire shape. A group with no valid numeric id
 * is rejected. Ids use `Number`, not `parseInt`, so '12bad' is not read as 12.
 */
function formatPrintAreaGroups(groups: any[]): any[] {
  return groups.map((group: any) => {
    const variantIds = (group.variant_ids || group.variantIds || [])
      .map((id: any) => Number(id))
      .filter((id: number) => Number.isInteger(id) && id > 0);

    if (variantIds.length === 0) {
      throw new Error(
        'Each print-area group must name at least one numeric variant id. ' +
        'To clear a product\'s print areas, pass an empty group list instead.'
      );
    }

    return { variant_ids: variantIds, placeholders: buildPlaceholders(group.placeholders ?? {}) };
  });
}

/**
 * Merge a flat print-area map into every existing variant group: named
 * placements are replaced or appended, and unnamed ones are kept, so
 * per-colorway artwork survives.
 */
function mergePrintAreas(existingAreas: any[], printAreasData: Record<string, any> | any[]): any[] {
  const incoming = buildPlaceholders(printAreasData);
  const byPosition = new Map(incoming.map((placeholder: any) => [placeholder.position, placeholder]));

  return existingAreas.map((area: any) => {
    const placeholders = (area.placeholders ?? []).map((ph: any) => byPosition.get(ph.position) ?? ph);
    const present = new Set(placeholders.map((ph: any) => ph.position));

    return {
      variant_ids: area.variant_ids ?? [],
      placeholders: [...placeholders, ...incoming.filter((ph: any) => !present.has(ph.position))]
    };
  });
}

/**
 * Normalize `{ variantId | id, price, isEnabled }` to the wire shape
 * `{ id, price, is_enabled }`. Ids must be positive integers; this is where
 * untrusted ids are validated before reaching print areas.
 */
function formatVariants(variants: any[]): any[] {
  return variants.map((variant: any) => {
    const id = Number(variant.id ?? variant.variantId);

    if (!Number.isInteger(id) || id <= 0) {
      throw new Error(`Invalid variant id: ${JSON.stringify(variant.id ?? variant.variantId)}. Variant ids must be positive integers.`);
    }

    return { id, price: parseInt(variant.price), is_enabled: variant.isEnabled !== false };
  });
}

/** Shops as a log line: ids and titles only, no account details. */
function summarizeShops(shops: any): string {
  if (!Array.isArray(shops) || shops.length === 0) return 'none';
  return shops.map((shop: any) => `${shop?.id} (${shop?.title})`).join(', ');
}

export class PrintifyAPI {
  private client: any;
  private apiToken: string;
  private shopId: string | null = null;
  private shops: PrintifyShop[] = [];

  constructor(apiToken: string, shopId?: string) {
    this.apiToken = apiToken;

    // Never log any part of the token: stderr is the MCP client's log file.
    // Logged before the SDK is built, since it throws a bare error on an empty token.
    console.error(`Printify API client initializing (API token ${apiToken ? 'present' : 'MISSING'})`);

    this.client = this.buildClient(shopId);

    if (shopId) {
      this.shopId = shopId;
      console.error('Shop ID set to:', shopId);
    } else {
      console.error('No shop ID provided. Will attempt to select the first available shop during initialization.');
    }
  }

  /** The SDK binds a shop at construction, so every shop change needs a new client. */
  private buildClient(shopId?: string | null) {
    return new Printify({
      accessToken: this.apiToken,
      shopId: shopId || undefined,
      enableLogging: false,
      timeout: 60000
    });
  }

  private requireShopId(): string {
    if (!this.shopId) {
      throw new Error('Shop ID is not set. Call setShopId() first.');
    }
    return this.shopId;
  }

  /** Fetch shops and select the first one when no shop ID was given. */
  async initialize(): Promise<PrintifyShop[]> {
    console.error('Initializing Printify API client...');

    try {
      await this.getShops();
    } catch (error) {
      // Continue with a configured shop ID, but never fabricate shops.
      if (!this.shopId) throw error;
      console.error(`Using existing shop ID: ${this.shopId}`);
      return this.shops;
    }

    if (this.shops.length > 0 && !this.shopId) {
      this.setShopId(this.shops[0].id.toString());
    }

    return this.shops;
  }

  getAvailableShops(): PrintifyShop[] {
    return this.shops;
  }

  getCurrentShopId(): string | null {
    return this.shopId;
  }

  getCurrentShop(): PrintifyShop | null {
    if (!this.shopId) return null;
    return this.shops.find(shop => shop.id.toString() === this.shopId) || null;
  }

  setShopId(shopId: string) {
    this.shopId = shopId;
    this.client = this.buildClient(shopId);
    console.error(`Shop ID set to: ${shopId}`);
  }

  /** Fetch shops, refreshing the cache used by getCurrentShop(). */
  async getShops() {
    console.error('Fetching shops from Printify API...');
    try {
      const shops = await this.client.shops.list();
      if (!Array.isArray(shops)) {
        console.warn('No shops found in the Printify API response');
        return [];
      }
      console.error(`Fetched ${shops.length} shops: ${summarizeShops(shops)}`);
      this.shops = shops;
      return shops;
    } catch (error) {
      console.error('Error fetching shops:', describeError(error));
      throw error;
    }
  }

  async getProducts(page = 1, limit = 10) {
    const shopId = this.requireShopId();
    try {
      console.error(`Fetching products for shop ${shopId}, page ${page}, limit ${limit}`);
      return await this.client.products.list({ page, limit });
    } catch (error) {
      console.error('Error fetching products:', describeError(error));
      throw error;
    }
  }

  async getProduct(productId: string) {
    this.requireShopId();
    try {
      return await this.client.products.getOne(productId);
    } catch (error) {
      console.error(`Error fetching product ${productId}:`, describeError(error));
      throw error;
    }
  }

  async createProduct(productData: any) {
    const shopId = this.requireShopId();
    let formattedData: any;

    try {
      formattedData = {
        title: productData.title,
        description: productData.description,
        blueprint_id: parseInt(productData.blueprint_id || productData.blueprintId),
        print_provider_id: parseInt(productData.print_provider_id || productData.printProviderId),
        variants: Array.isArray(productData.variants) ? formatVariants(productData.variants) : [],
        print_areas: [],
        tags: productData.tags || []
      };

      console.error('Raw product data received:', JSON.stringify(productData, null, 2));

      const printAreasData = productData.print_areas || productData.printAreas;
      if (isPerVariantGroups(printAreasData)) {
        formattedData.print_areas = formatPrintAreaGroups(printAreasData);
      } else if (printAreasData) {
        // A new product has no existing groups, so one entry over every variant is safe.
        const variantIds = formattedData.variants.map((v: any) => v.id);
        formattedData.print_areas = buildPrintAreas(variantIds, printAreasData);
      }

      console.error(`Creating product with shop ID: ${shopId}`);
      console.error('Formatted product data:', JSON.stringify(formattedData, null, 2));

      return await this.client.products.create(formattedData);
    } catch (error: any) {
      error.formattedData = formattedData;
      console.error('Error creating product:', describeError(error));
      throw this.enhanceError(error, productData);
    }
  }

  async updateProduct(productId: string, productData: any) {
    this.requireShopId();

    try {
      const formattedData = { ...productData };
      if (Array.isArray(productData.variants)) {
        formattedData.variants = formatVariants(productData.variants);
      }

      const printAreasData = productData.print_areas || productData.printAreas;
      if (!printAreasData) {
        return await this.client.products.updateOne(productId, formattedData);
      }

      // Only the API's own key goes out.
      delete formattedData.printAreas;

      if (isPerVariantGroups(printAreasData)) {
        formattedData.print_areas = formatPrintAreaGroups(printAreasData);
      } else if (buildPlaceholders(printAreasData).length === 0) {
        // An empty flat map clears print areas, like an empty group list.
        formattedData.print_areas = [];
      } else {
        // A flat map is merged into the live product's groups, so it must be
        // fetched; without it the update would attach artwork to nothing.
        let currentProduct: any;
        try {
          currentProduct = await this.client.products.getOne(productId);
        } catch (error) {
          console.error(`Error fetching current product ${productId}:`, describeError(error));
          throw new Error(
            `Cannot update print areas: failed to fetch product ${productId} (${describeError(error)})`,
            { cause: error }
          );
        }

        const existingAreas = currentProduct?.print_areas ?? [];
        if (existingAreas.length > 0) {
          formattedData.print_areas = mergePrintAreas(existingAreas, printAreasData);
        } else {
          // Nothing to merge into: cover the variants being updated, or else the
          // product's enabled variants.
          const variantIds = formattedData.variants?.length
            ? formattedData.variants.map((v: any) => v.id)
            : (currentProduct?.variants ?? [])
                .filter((v: any) => v.is_enabled)
                .map((v: any) => v.id);

          formattedData.print_areas = buildPrintAreas(variantIds, printAreasData);
        }
      }

      console.error(`Updating product ${productId} with formatted data:`, JSON.stringify(formattedData, null, 2));
      return await this.client.products.updateOne(productId, formattedData);
    } catch (error) {
      console.error(`Error updating product ${productId}:`, describeError(error));
      throw this.enhanceError(error, productData);
    }
  }

  async deleteProduct(productId: string) {
    this.requireShopId();
    try {
      return await this.client.products.deleteOne(productId);
    } catch (error) {
      console.error(`Error deleting product ${productId}:`, describeError(error));
      throw error;
    }
  }

  async publishProduct(productId: string, publishData: any) {
    this.requireShopId();
    try {
      return await this.client.products.publishOne(productId, publishData);
    } catch (error) {
      console.error(`Error publishing product ${productId}:`, describeError(error));
      throw this.enhanceError(error, publishData);
    }
  }

  async getBlueprints() {
    try {
      return await this.client.catalog.listBlueprints();
    } catch (error) {
      console.error('Error fetching blueprints:', describeError(error));
      throw error;
    }
  }

  async getBlueprint(blueprintId: string) {
    try {
      return await this.client.catalog.getBlueprint(blueprintId);
    } catch (error) {
      console.error(`Error fetching blueprint ${blueprintId}:`, describeError(error));
      throw error;
    }
  }

  async getPrintProviders(blueprintId: string) {
    try {
      return await this.client.catalog.getBlueprintProviders(blueprintId);
    } catch (error) {
      console.error(`Error fetching print providers for blueprint ${blueprintId}:`, describeError(error));
      throw error;
    }
  }

  /**
   * A blueprint's variants from one provider. The API hides out-of-stock
   * variants unless asked; the SDK method takes no query options, so that case
   * goes through the SDK's own authenticated request.
   */
  async getVariants(blueprintId: string, printProviderId: string, options: { showOutOfStock?: boolean } = {}) {
    try {
      if (!options.showOutOfStock) {
        return await this.client.catalog.getBlueprintVariants(blueprintId, printProviderId);
      }
      const url = `/v1/catalog/blueprints/${encodeURIComponent(blueprintId)}` +
        `/print_providers/${encodeURIComponent(printProviderId)}/variants.json`;
      return await this.client.catalog.request(url, { method: 'GET', params: { 'show-out-of-stock': 1 } });
    } catch (error) {
      console.error(`Error fetching variants for blueprint ${blueprintId} and print provider ${printProviderId}:`, describeError(error));
      throw error;
    }
  }

  /** Every print provider in the catalog, not just those offering one blueprint. */
  async listAllPrintProviders() {
    try {
      return await this.client.catalog.listProviders();
    } catch (error) {
      console.error('Error fetching print providers:', describeError(error));
      throw error;
    }
  }

  /** One print provider, with its location and the blueprints it offers. */
  async getPrintProvider(printProviderId: string) {
    const id = catalogId(printProviderId, 'printProviderId');
    try {
      return await this.client.catalog.getProvider(id);
    } catch (error) {
      console.error(`Error fetching print provider ${id}:`, describeError(error));
      throw error;
    }
  }

  /** Shipping costs and handling time for a blueprint from one provider. */
  async getShipping(blueprintId: string, printProviderId: string) {
    const blueprint = catalogId(blueprintId, 'blueprintId');
    const provider = catalogId(printProviderId, 'printProviderId');
    try {
      return await this.client.catalog.getVariantShipping(blueprint, provider);
    } catch (error) {
      console.error(`Error fetching shipping for blueprint ${blueprint} and print provider ${provider}:`, describeError(error));
      throw error;
    }
  }

  /** One page of the current shop's orders, optionally filtered by status or SKU. */
  async listOrders(options: { page?: number; limit?: number; status?: string; sku?: string } = {}) {
    const shopId = this.requireShopId();
    try {
      return await this.client.orders.list(options);
    } catch (error) {
      console.error(`Error fetching orders for shop ${shopId}:`, describeError(error));
      throw error;
    }
  }

  async getOrder(orderId: string) {
    this.requireShopId();
    const id = pathId(orderId, 'orderId');
    try {
      return await this.client.orders.getOne(id);
    } catch (error) {
      console.error(`Error fetching order ${id}:`, describeError(error));
      throw error;
    }
  }

  /** Shipping cost per method for a prospective order; nothing is created. */
  async calculateOrderShipping(data: any) {
    this.requireShopId();
    try {
      return await this.client.orders.calculateShipping(data);
    } catch (error) {
      console.error('Error calculating order shipping:', describeError(error));
      throw error;
    }
  }

  /** Create an order. Printify holds it as a draft until it is sent to production. */
  async createOrder(data: any) {
    const shopId = this.requireShopId();
    try {
      return await this.client.orders.submit(data);
    } catch (error) {
      console.error(`Error creating order for shop ${shopId}:`, describeError(error));
      throw error;
    }
  }

  /** Release an on-hold order for printing; this is where Printify charges for it. */
  async sendOrderToProduction(orderId: string) {
    this.requireShopId();
    const id = pathId(orderId, 'orderId');
    try {
      return await this.client.orders.sendToProduction(id);
    } catch (error) {
      console.error(`Error sending order ${id} to production:`, describeError(error));
      throw error;
    }
  }

  /** Cancel an order that is still on hold or awaiting payment. */
  async cancelOrder(orderId: string) {
    this.requireShopId();
    const id = pathId(orderId, 'orderId');
    try {
      return await this.client.orders.cancelUnpaid(id);
    } catch (error) {
      console.error(`Error cancelling order ${id}:`, describeError(error));
      throw error;
    }
  }

  /** One page of the account's uploaded images. */
  async listUploads(page = 1, limit = 10) {
    try {
      return await this.client.uploads.list(page, limit);
    } catch (error) {
      console.error('Error fetching uploads:', describeError(error));
      throw error;
    }
  }

  async getUpload(imageId: string) {
    const id = pathId(imageId, 'imageId');
    try {
      return await this.client.uploads.getById(id);
    } catch (error) {
      console.error(`Error fetching upload ${id}:`, describeError(error));
      throw error;
    }
  }

  /** Archive an uploaded image, removing it from the upload library. */
  async archiveUpload(imageId: string) {
    const id = pathId(imageId, 'imageId');
    try {
      return await this.client.uploads.archive(id);
    } catch (error) {
      console.error(`Error archiving upload ${id}:`, describeError(error));
      throw error;
    }
  }

  /** Attach the API's status and validation errors to a thrown error for callers. */
  private enhanceError(error: any, requestData?: any): any {
    if (error.response) {
      error.details = error.response.data;
      error.statusCode = error.response.status;
      error.statusText = error.response.statusText;
      if (error.response.data?.errors) {
        error.validationErrors = error.response.data.errors;
      }
    }

    if (requestData) {
      error.requestData = requestData;
    }

    return error;
  }

  /** Upload an image from a URL, a local file, or base64 content. */
  async uploadImage(fileName: string, source: string) {
    try {
      console.error(`Uploading image ${fileName}`);

      if (source.startsWith('http://') || source.startsWith('https://')) {
        console.error(`Uploading from URL: ${source.substring(0, 30)}...`);
        return await this.client.uploads.uploadImage({ file_name: fileName, url: source });
      }

      if (!source.startsWith('data:')) {
        return await this.uploadFile(fileName, source);
      }

      // Only `;base64,` data URLs: without that marker the payload is
      // percent-encoded text (RFC 2397), not base64.
      const match = /^data:[^,]*;base64,(.+)$/s.exec(source);
      if (!match) {
        throw new Error(
          `Invalid data URL for ${fileName}: expected "data:<mime>;base64,<payload>" with a non-empty base64 payload.`
        );
      }
      const contents = match[1];
      console.error(`Uploading image with base64 data from data URL (length: ${contents.length})`);
      return await this.client.uploads.uploadImage({ file_name: fileName, contents });
    } catch (error: any) {
      console.error('Error uploading image:', describeError(error));
      throw this.enhanceError(error, {
        fileName,
        sourceType: typeof source,
        sourceLength: source.length,
        currentWorkingDir: process.cwd(),
        errorMessage: error.message,
        errorStack: error.stack,
        ...(error.response ? { responseStatus: error.response.status, responseData: error.response.data } : {})
      });
    }
  }

  /** Read a local image, normalize it with Sharp, and upload it as base64. */
  private async uploadFile(fileName: string, source: string) {
    try {
      let filePath = normalizeFileUri(source);

      console.error(`Reading image file: ${previewText(filePath)}`);

      // Every local read ends here, so this confinement check holds even for
      // callers that skip uploadImageToPrintify's validation. The file is read
      // through one descriptor and never reopened by name.
      const { resolved, data } = readConfinedFile(filePath, MAX_UPLOAD_BYTES);

      const ext = path.extname(resolved).toLowerCase();
      const outputFormat = ext === '.jpg' || ext === '.jpeg' ? 'jpeg' : 'png';
      const buffer = await applyOutputFormat(sharp(data), outputFormat).toBuffer();
      const contents = buffer.toString('base64');

      console.error(`Uploading ${fileName} (${mimeTypeFor(outputFormat)}, ${contents.length} base64 chars)`);
      const result = await this.client.uploads.uploadImage({ file_name: fileName, contents });
      console.error('Upload successful, result:', result);
      return result;
    } catch (error: any) {
      console.error('Error reading file:', describeError(error));
      throw new Error(
        `Failed to process file ${previewText(source)}: ${error.message || 'Unknown error'}\n\n` +
        'Troubleshooting steps:\n' +
        '1. Check if the file exists and is readable\n' +
        '2. Make sure the file is a valid image (PNG, JPEG, etc.)\n' +
        '3. Try using a URL or a data URL (data:<mime>;base64,<payload>) instead\n' +
        '\nFile processing details:\n' +
        `- Attempted to read from: ${previewText(source)}\n`,
        { cause: error }
      );
    }
  }
}
