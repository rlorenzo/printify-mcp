import * as fs from 'fs';
import * as path from 'path';
import Printify from 'printify-sdk-js';
import sharp from 'sharp';
import { describeError } from './utils/error-handler.js';

// Shop interface
export interface PrintifyShop {
  id: number;
  title: string;
  sales_channel: string;
}

// Printify API client
/**
 * Build the placeholder list for one print-area entry.
 *
 * Accepts the tool-shaped form -- a map (or list) of `{ position, imageId }`,
 * which becomes a centred, unrotated, unscaled single image -- and passes
 * through placeholders that already carry their own `images`, so a caller who
 * knows the exact placement Printify should store can say so.
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
 * Build the print-area list for a flat map: one entry covering the given
 * variants, or none at all when the map names no placements.
 *
 * An empty map is the flat form's way of saying "no print areas", the same
 * thing an empty group list says. Sending one entry with an empty
 * `placeholders` array instead is not that request -- it is a malformed print
 * area that the API has no reason to accept.
 *
 * Placements with no variants to carry them are rejected for the same reason
 * `formatPrintAreaGroups` rejects an empty group: `variant_ids: []` is accepted
 * by the API and then attaches the artwork to nothing. It is reachable from
 * either side -- a create carrying no variants, or an update whose product has
 * no enabled ones -- and neither is worth sending.
 *
 * Shared by product creation and update, which format print areas identically.
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
 * Does this input already name its own variant groups?
 *
 * Printify scopes each print area to a set of variant ids, which is how one
 * product carries different artwork per colorway. The flat `{ front: {...} }`
 * map cannot express that, so callers who need it pass a list of
 * `{ variantIds, placeholders }` groups instead.
 *
 * An empty list counts as one: it is the only way to say "no print areas at
 * all", and reading it as a flat map instead makes that request a silent no-op
 * on update and an empty all-variant entry on create.
 */
function isPerVariantGroups(printAreasData: any): boolean {
  return Array.isArray(printAreasData)
    && printAreasData.every((group: any) => group && (group.variant_ids || group.variantIds));
}

/**
 * Normalize caller-supplied variant groups to the API's wire shape, accepting
 * `variantIds` or `variant_ids` and either placeholder form.
 *
 * A group that names no usable variant -- an empty list, or ids that are not
 * numbers -- is rejected rather than sent: `variant_ids: []` attaches the
 * artwork to nothing, which the API accepts and silently drops. Clearing print
 * areas is what the empty *group list* is for.
 *
 * Ids are converted with `Number`, not `parseInt`: `parseInt('12bad')` is 12,
 * so a typo'd id would quietly point the artwork at whichever variant happens
 * to be numbered by the prefix.
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
 * Fold a flat print-area map into a product's existing variant groups.
 *
 * The flat form says "this image, this placement" without saying which
 * variants it belongs to, so the only non-destructive reading is *every*
 * group: each named placement is replaced wherever it already exists and
 * appended where it does not, and every placement the caller did not mention
 * survives untouched. Replacing the whole list with a single all-variant entry
 * instead -- what this used to do -- silently collapses per-colorway artwork
 * into one image with nothing in the response to show it happened.
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
 * Normalize tool-shaped variants to the API's wire shape.
 *
 * Callers supply { variantId | id, price, isEnabled }; the API expects
 * { id, price, is_enabled } with numeric ids and prices. Shared by create and
 * update, which previously disagreed: update passed variants through raw, so
 * an update carrying variants sent `variantId` to an API that reads `id`.
 */
function formatVariants(variants: any[]): any[] {
  return variants.map((variant: any) => ({
    id: parseInt(variant.id || variant.variantId),
    price: parseInt(variant.price),
    is_enabled: variant.isEnabled !== false
  }));
}

/**
 * Shops as a log line: ids and titles only. The full records carry account
 * details that nothing downstream of a log message needs.
 */
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
    // Store the API token
    this.apiToken = apiToken;

    // Report whether a token was supplied, never any part of it. Even a prefix
    // is secret-derived, and stderr here is the MCP client's log file. Logged
    // before the SDK is constructed, because the SDK throws a bare
    // "accessToken is required" on an empty one and this line says why.
    console.error(`Printify API client initializing (API token ${apiToken ? 'present' : 'MISSING'})`);

    // Initialize the Printify SDK client
    this.client = new Printify({
      accessToken: apiToken,
      shopId: shopId || undefined, // Only pass shopId if it's provided
      enableLogging: false,
      timeout: 60000
    });

    // Set the shop ID if provided
    if (shopId) {
      this.shopId = shopId;
      console.error('Shop ID set to:', shopId);
    } else {
      console.error('No shop ID provided. Will attempt to select the first available shop during initialization.');
    }
  }

  // Initialize the API client by fetching shops
  async initialize(): Promise<PrintifyShop[]> {
    try {
      console.error('Initializing Printify API client...');

      // Get shops using the SDK
      try {
        console.error('Fetching shops from Printify API...');
        const shops = await this.client.shops.list();

        if (shops && Array.isArray(shops)) {
          this.shops = shops;
          console.error(`Found ${this.shops.length} shops: ${summarizeShops(this.shops)}`);

          // If shops are available, set the first one as default if not already set
          if (this.shops.length > 0 && !this.shopId) {
            this.shopId = this.shops[0].id.toString();
            console.error(`Setting default shop ID to: ${this.shopId}`);

            // Create a new client with the shop ID
            this.client = new Printify({
              accessToken: this.apiToken,
              shopId: this.shopId,
              enableLogging: false,
              timeout: 60000
            });
          }
        } else {
          console.warn('No shops found in the Printify API response');
        }

        return this.shops;
      } catch (sdkError) {
        console.error('Error fetching shops from Printify API:', describeError(sdkError));

        // If we already have a shop ID, we can continue with that
        if (this.shopId) {
          console.error(`Using existing shop ID: ${this.shopId}`);
          return this.shops;
        }

        // Never fabricate shops: a caller acting on invented IDs is worse than a
        // clear failure.
        throw sdkError;
      }
    } catch (error) {
      console.error('Error initializing Printify API:', describeError(error));
      throw error;
    }
  }

  // Get all available shops
  getAvailableShops(): PrintifyShop[] {
    return this.shops;
  }

  // Get the current shop ID
  getCurrentShopId(): string | null {
    return this.shopId;
  }

  // Get the current shop
  getCurrentShop(): PrintifyShop | null {
    if (!this.shopId) return null;
    return this.shops.find(shop => shop.id.toString() === this.shopId) || null;
  }

  // Set the shop ID for subsequent requests
  setShopId(shopId: string) {
    console.error(`Setting shop ID to: ${shopId}`);
    this.shopId = shopId;

    // Create a new client instance with the new shop ID
    // The SDK requires creating a new client when changing shop ID
    this.client = new Printify({
      accessToken: this.apiToken,
      shopId: shopId,
      enableLogging: false,
      timeout: 60000
    });

    console.error(`Shop ID set to: ${shopId} (created new client instance)`);
  }

  // Get a list of shops
  async getShops() {
    try {
      console.error('Fetching shops from Printify API...');

      try {
        const shops = await this.client.shops.list();
        console.error(`Fetched ${Array.isArray(shops) ? shops.length : 0} shops: ${summarizeShops(shops)}`);

        if (shops && Array.isArray(shops)) {
          this.shops = shops; // keep the internal cache fresh for getCurrentShop()
          return shops;
        } else {
          console.warn('No shops found in the Printify API response');
          return [];
        }
      } catch (sdkError) {
        console.error('Error fetching shops from Printify API:', describeError(sdkError));
        throw sdkError;
      }
    } catch (error) {
      console.error('Error fetching shops:', describeError(error));
      throw error;
    }
  }

  // Get a list of products
  async getProducts(page = 1, limit = 10) {
    if (!this.shopId) {
      throw new Error('Shop ID is not set. Call setShopId() first.');
    }

    try {
      try {
        // Use the products.list method with pagination parameters
        console.error(`Fetching products for shop ${this.shopId}, page ${page}, limit ${limit}`);
        const response = await this.client.products.list({ page, limit });
        return response;
      } catch (sdkError) {
        console.error('Error fetching products from Printify API:', describeError(sdkError));
        throw sdkError;
      }
    } catch (error) {
      console.error('Error fetching products:', describeError(error));
      throw error;
    }
  }

  // Get a specific product
  async getProduct(productId: string) {
    if (!this.shopId) {
      throw new Error('Shop ID is not set. Call setShopId() first.');
    }

    try {
      // Use the products.getOne method with the product ID
      return await this.client.products.getOne(productId);
    } catch (error) {
      console.error(`Error fetching product ${productId}:`, describeError(error));
      throw error;
    }
  }

  // Create a new product
  async createProduct(productData: any) {
    if (!this.shopId) {
      throw new Error('Shop ID is not set. Call setShopId() first.');
    }

    try {
      // Format the product data to match the API's expected format
      const formattedData: any = {
        title: productData.title,
        description: productData.description,
        blueprint_id: parseInt(productData.blueprint_id || productData.blueprintId),
        print_provider_id: parseInt(productData.print_provider_id || productData.printProviderId),
        variants: [],
        print_areas: [],
        tags: productData.tags || []
      };

      // Format variants
      if (productData.variants && Array.isArray(productData.variants)) {
        formattedData.variants = formatVariants(productData.variants);
      }

      // Log the raw data received
      console.error('Raw product data received:', JSON.stringify(productData, null, 2));

      // Format print areas - handle both print_areas and printAreas formats
      const printAreasData = productData.print_areas || productData.printAreas;
      if (isPerVariantGroups(printAreasData)) {
        // Per-colorway artwork, stated explicitly.
        formattedData.print_areas = formatPrintAreaGroups(printAreasData);
      } else if (printAreasData) {
        // The flat form: one entry over every variant. Safe here in a way it is
        // not on update -- a new product has no existing groups to overwrite.
        const variantIds = formattedData.variants.map((v: any) => v.id);

        formattedData.print_areas = buildPrintAreas(variantIds, printAreasData);
      }

      console.error(`Creating product with shop ID: ${this.shopId}`);
      console.error('Formatted product data:', JSON.stringify(formattedData, null, 2));

      try {
        // Use the products.create method with the formatted data
        const result = await this.client.products.create(formattedData);
        return result;
      } catch (error: any) {
        // Add the formatted data to the error object for better debugging
        error.formattedData = formattedData;

        // describeError already reports the status and the response body.
        console.error('Full error response:', describeError(error));

        if (error.response) {
          // Kept for callers that inspect the thrown error, not for the log.
          error.fullResponseData = error.response.data;
        }

        throw error;
      }
    } catch (error) {
      console.error('Error creating product:', describeError(error));
      throw this.enhanceError(error, productData);
    }
  }

  // Update a product
  async updateProduct(productId: string, productData: any) {
    if (!this.shopId) {
      throw new Error('Shop ID is not set. Call setShopId() first.');
    }

    try {
      // Variants must be normalized whether or not print areas are present.
      if (productData.variants && Array.isArray(productData.variants)) {
        productData = { ...productData, variants: formatVariants(productData.variants) };
      }

      // Format the product data if it contains print_areas
      const printAreasData = productData.print_areas || productData.printAreas;
      if (printAreasData) {
        const formattedData = { ...productData };
        // Both spellings are accepted on the way in; only the API's own key
        // goes out, so the SDK never sees a stray camelCase field.
        delete formattedData.printAreas;

        if (isPerVariantGroups(printAreasData)) {
          // The caller said which variants get which artwork. Take them at
          // their word -- there is nothing to merge against.
          formattedData.print_areas = formatPrintAreaGroups(printAreasData);
        } else if (buildPlaceholders(printAreasData).length === 0) {
          // A flat map naming no placements says what an empty group list says:
          // no print areas. There is nothing to reconcile, so no fetch either.
          formattedData.print_areas = [];
        } else {
          // A flat map has to be reconciled with what the product already has,
          // so the update needs the live product. A failure here used to be
          // swallowed and the update sent on with *empty* variant ids, which
          // attaches the artwork to nothing; refusing is the only safe answer.
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
            // Nothing to preserve: one entry over every variant being updated,
            // falling back to the product's enabled variants. An *empty*
            // variant list is not a variant list -- taking it would attach the
            // artwork to nothing.
            const variantIds = formattedData.variants?.length
              ? formattedData.variants.map((v: any) => parseInt(v.id || v.variantId))
              : (currentProduct?.variants ?? [])
                  .filter((v: any) => v.is_enabled)
                  .map((v: any) => v.id);

            formattedData.print_areas = buildPrintAreas(variantIds, printAreasData);
          }
        }

        console.error(`Updating product ${productId} with formatted data:`, JSON.stringify(formattedData, null, 2));
        return await this.client.products.updateOne(productId, formattedData);
      } else {
        // If no print_areas, just pass the data as is
        return await this.client.products.updateOne(productId, productData);
      }
    } catch (error) {
      console.error(`Error updating product ${productId}:`, describeError(error));
      throw this.enhanceError(error, productData);
    }
  }

  // Delete a product
  async deleteProduct(productId: string) {
    if (!this.shopId) {
      throw new Error('Shop ID is not set. Call setShopId() first.');
    }

    try {
      // Use the products.deleteOne method with the product ID
      return await this.client.products.deleteOne(productId);
    } catch (error) {
      console.error(`Error deleting product ${productId}:`, describeError(error));
      throw error;
    }
  }

  // Publish a product
  async publishProduct(productId: string, publishData: any) {
    if (!this.shopId) {
      throw new Error('Shop ID is not set. Call setShopId() first.');
    }

    try {
      // Use the products.publishOne method with the product ID and publish data
      return await this.client.products.publishOne(productId, publishData);
    } catch (error) {
      console.error(`Error publishing product ${productId}:`, describeError(error));
      throw this.enhanceError(error, publishData);
    }
  }

  // Get catalog blueprints
  async getBlueprints() {
    try {
      // Use the catalog.listBlueprints method
      return await this.client.catalog.listBlueprints();
    } catch (error) {
      console.error('Error fetching blueprints:', describeError(error));
      throw error;
    }
  }

  // Get a specific blueprint
  async getBlueprint(blueprintId: string) {
    try {
      // Use the catalog.getBlueprint method
      return await this.client.catalog.getBlueprint(blueprintId);
    } catch (error) {
      console.error(`Error fetching blueprint ${blueprintId}:`, describeError(error));
      throw error;
    }
  }

  // Get print providers for a blueprint
  async getPrintProviders(blueprintId: string) {
    try {
      // Use the catalog.getBlueprintProviders method
      return await this.client.catalog.getBlueprintProviders(blueprintId);
    } catch (error) {
      console.error(`Error fetching print providers for blueprint ${blueprintId}:`, describeError(error));
      throw error;
    }
  }

  // Get variants for a blueprint and print provider
  async getVariants(blueprintId: string, printProviderId: string) {
    try {
      // Use the catalog.getBlueprintVariants method
      return await this.client.catalog.getBlueprintVariants(blueprintId, printProviderId);
    } catch (error) {
      console.error(`Error fetching variants for blueprint ${blueprintId} and print provider ${printProviderId}:`, describeError(error));
      throw error;
    }
  }

  // Helper method to enhance error with more details
  private enhanceError(error: any, requestData?: any): any {
    // Extract detailed error information from the response
    if (error.response) {
      error.details = error.response.data;
      error.statusCode = error.response.status;
      error.statusText = error.response.statusText;

      // Extract validation errors if they exist
      if (error.response.data && error.response.data.errors) {
        error.validationErrors = error.response.data.errors;
      }

      // Response headers are deliberately not logged: they carry no diagnostic
      // value that the status does not, and dumping header maps is how request
      // headers -- which hold the bearer token -- end up in logs by mistake.
      console.error('Complete error response:', describeError(error));
    }

    if (requestData) {
      error.requestData = requestData;
    }

    return error;
  }

  // Upload an image (supports URLs, local files, and base64 content)
  async uploadImage(fileName: string, source: string) {
    try {
      console.error(`Uploading image ${fileName}`);

      // If the source starts with http:// or https://, use the URL upload method
      if (source.startsWith('http://') || source.startsWith('https://')) {
        console.error(`Uploading from URL: ${source.substring(0, 30)}...`);
        return await this.client.uploads.uploadImage({ file_name: fileName, url: source });
      }

      // If it's a file path, try to read the file and convert to base64
      if (source.startsWith('file://') || source.includes(':\\') || source.includes(':/') || !source.startsWith('data:')) {
        try {
          console.error(`Attempting to read file from: ${source}`);

          // Handle file:// protocol
          let filePath = source;
          if (source.startsWith('file://')) {
            // Strip only the scheme: file:///Users/x is the absolute path
            // /Users/x, so the third slash must survive.
            filePath = source.slice('file://'.length);
          }

          // Strip the leading slash only from Windows paths of the form /C:/...
          // produced by file:// URIs. Genuine POSIX absolute paths must keep it.
          if (/^\/[a-zA-Z]:[\\/]/.test(filePath)) {
            filePath = filePath.substring(1);
          }

          console.error(`Normalized file path: ${filePath}`);

          // Check if file exists
          if (!fs.existsSync(filePath)) {
            const error = new Error(`File not found: ${filePath}`);
            console.error('File not found error:', describeError(error));
            console.error('Current working directory:', process.cwd());
            console.error('File path type:', typeof filePath);
            console.error('Absolute path check:', path.isAbsolute(filePath) ? 'Absolute' : 'Relative');

            // Try to list the directory contents if possible
            try {
              const dir = path.dirname(filePath);
              if (fs.existsSync(dir)) {
                console.error('Directory exists. Contents:', fs.readdirSync(dir));
              } else {
                console.error('Parent directory does not exist:', dir);
              }
            } catch (dirError) {
              console.error('Error checking directory:', describeError(dirError));
            }

            throw error;
          }

          // Get file stats
          const stats = fs.statSync(filePath);
          console.error(`File size: ${stats.size} bytes`);

          if (stats.size === 0) {
            throw new Error(`File is empty: ${filePath}`);
          }

          if (stats.size > 10 * 1024 * 1024) { // 10MB limit
            throw new Error(`File is too large (${Math.round(stats.size / (1024 * 1024))}MB). Maximum size is 10MB.`);
          }

          // Process the image with Sharp
          console.error('Processing image with Sharp before uploading...');

          // Use Sharp directly
          const sharpInstance = sharp(filePath);
          const outputFormat = path.extname(filePath).toLowerCase() === '.jpg' ||
                              path.extname(filePath).toLowerCase() === '.jpeg' ? 'jpeg' : 'png';

          // Convert to the appropriate format
          if (outputFormat === 'jpeg') {
            sharpInstance.jpeg({ quality: 100 });
          } else {
            sharpInstance.png({ quality: 100 });
          }

          // Get the buffer
          const buffer = await sharpInstance.toBuffer();
          console.error(`Image processed successfully: ${buffer.length} bytes`);

          // Determine the MIME type
          const mimeType = outputFormat === 'jpeg' ? 'image/jpeg' : 'image/png';

          // Convert to base64
          const base64Data = buffer.toString('base64');
          console.error(`Converted to base64 string of length ${base64Data.length}`);

          // Create data URL with the proper MIME type prefix
          const dataUrl = `data:${mimeType};base64,${base64Data}`;
          console.error(`Uploading with data URL (MIME type: ${mimeType})`);

          try {
            console.error(`Uploading to Printify with file_name: ${fileName}, contents length: ${base64Data.length}`);
            // Use the dataUrl instead of just the base64Data
            const result = await this.client.uploads.uploadImage({ file_name: fileName, contents: dataUrl.split(',')[1] });
            console.error('Upload successful, result:', result);
            return result;
          } catch (uploadError: any) {
            console.error('Error during Printify upload:', describeError(uploadError));
            throw uploadError;
          }
        } catch (error: any) {
          console.error('Error reading file:', describeError(error));
          const errorMessage = error.message || 'Unknown error';

          // Create a detailed error message with troubleshooting information
          let detailedError = `Failed to process file ${source}: ${errorMessage}\n\n`;
          detailedError += 'Troubleshooting steps:\n';
          detailedError += '1. Check if the file exists and is readable\n';
          detailedError += '2. Make sure the file is a valid image (PNG, JPEG, etc.)\n';
          detailedError += '3. Try using a URL or base64 encoded string instead\n';
          detailedError += '\nFile processing details:\n';
          detailedError += `- Attempted to read from: ${source}\n`;

          throw new Error(detailedError, { cause: error });
        }
      } else if (source.startsWith('data:image/')) {
        // If source is base64 data with data URL prefix
        // Extract the base64 content
        const base64Content = source.split(',')[1];
        console.error(`Uploading image with base64 data from data URL (length: ${base64Content.length})`);
        return await this.client.uploads.uploadImage({ file_name: fileName, contents: base64Content });
      } else {
        // Otherwise, assume it's a base64 encoded string without prefix
        console.error(`Uploading image with base64 data (length: ${source.length})`);
        return await this.client.uploads.uploadImage({ file_name: fileName, contents: source });
      }
    } catch (error: any) {
      console.error('Error uploading image:', describeError(error));

      // Add detailed debugging information
      const debugInfo: any = {
        fileName,
        sourceType: typeof source,
        sourceLength: source.length,
        currentWorkingDir: process.cwd(),
        errorMessage: error.message,
        errorStack: error.stack
      };

      console.error('Detailed upload error information:', JSON.stringify(debugInfo, null, 2));

      if (error.response) {
        // Carried on the thrown error for callers; the log line above and
        // describeError have already reported the status and body.
        debugInfo.responseStatus = error.response.status;
        debugInfo.responseData = error.response.data;
      }

      throw this.enhanceError(error, debugInfo);
    }
  }
}
