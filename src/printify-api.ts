import * as fs from 'fs';
import * as path from 'path';
import Printify from 'printify-sdk-js';
import sharp from 'sharp';

// Shop interface
export interface PrintifyShop {
  id: number;
  title: string;
  sales_channel: string;
}

// Printify API client
export class PrintifyAPI {
  private client: any;
  private apiToken: string;
  private shopId: string | null = null;
  private shops: PrintifyShop[] = [];

  constructor(apiToken: string, shopId?: string) {
    // Store the API token
    this.apiToken = apiToken;

    // Initialize the Printify SDK client
    this.client = new Printify({
      accessToken: apiToken,
      shopId: shopId || undefined, // Only pass shopId if it's provided
      enableLogging: false,
      timeout: 60000
    });

    console.error('Printify API client initialized with token:', apiToken.substring(0, 5) + '...');

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
        console.error('Shops response:', shops);

        if (shops && Array.isArray(shops)) {
          this.shops = shops;
          console.error(`Found ${this.shops.length} shops:`, this.shops);

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
        console.error('Error fetching shops from Printify API:', sdkError);

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
      console.error('Error initializing Printify API:', error);
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
        console.error('Shops response:', shops);

        if (shops && Array.isArray(shops)) {
          this.shops = shops; // keep the internal cache fresh for getCurrentShop()
          return shops;
        } else {
          console.warn('No shops found in the Printify API response');
          return [];
        }
      } catch (sdkError) {
        console.error('Error fetching shops from Printify API:', sdkError);
        throw sdkError;
      }
    } catch (error) {
      console.error('Error fetching shops:', error);
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
        console.error('Error fetching products from Printify API:', sdkError);
        throw sdkError;
      }
    } catch (error) {
      console.error('Error fetching products:', error);
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
      console.error(`Error fetching product ${productId}:`, error);
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
        formattedData.variants = productData.variants.map((variant: any) => {
          return {
            id: parseInt(variant.id || variant.variantId),
            price: parseInt(variant.price),
            is_enabled: variant.isEnabled !== false
          };
        });
      }

      // Log the raw data received
      console.error('Raw product data received:', JSON.stringify(productData, null, 2));

      // Format print areas - handle both print_areas and printAreas formats
      const printAreasData = productData.print_areas || productData.printAreas;
      if (printAreasData) {
        // Get all variant IDs from the variants array
        const variantIds = formattedData.variants.map((v: any) => v.id);

        // Create a print area entry with all variants
        const printAreaEntry: any = {
          variant_ids: variantIds,
          placeholders: []
        };

        // Add placeholders for each position (front, back, etc.)
        for (const key in printAreasData) {
          const area = printAreasData[key];
          printAreaEntry.placeholders.push({
            position: area.position,
            images: [
              {
                id: area.image_id || area.imageId,
                x: 0.5,
                y: 0.5,
                scale: 1,
                angle: 0
              }
            ]
          });
        }

        // Add the print area entry to the formatted data
        formattedData.print_areas.push(printAreaEntry);
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

        // Log the full error response
        console.error('Full error response:', error);

        // If there's a response object, extract and log the full response data
        if (error.response) {
          console.error('Response status:', error.response.status);
          console.error('Response data:', JSON.stringify(error.response.data, null, 2));

          // Add the full response data to the error object
          error.fullResponseData = error.response.data;
        }

        throw error;
      }
    } catch (error) {
      console.error('Error creating product:', error);
      throw this.enhanceError(error, productData);
    }
  }

  // Update a product
  async updateProduct(productId: string, productData: any) {
    if (!this.shopId) {
      throw new Error('Shop ID is not set. Call setShopId() first.');
    }

    try {
      // Format the product data if it contains print_areas
      if (productData.print_areas || productData.printAreas) {
        const formattedData = { ...productData };
        const printAreasData = formattedData.print_areas || formattedData.printAreas;

        // If print_areas is provided, format it correctly
        if (printAreasData) {
          // Get the current product to get variant IDs if not provided
          let variantIds: number[] = [];

          if (formattedData.variants && Array.isArray(formattedData.variants)) {
            // Use the variants from the update data
            variantIds = formattedData.variants.map((v: any) => parseInt(v.id || v.variantId));
          } else {
            // Get the current product to get its variant IDs
            try {
              const currentProduct = await this.client.products.getOne(productId);
              variantIds = currentProduct.variants
                .filter((v: any) => v.is_enabled)
                .map((v: any) => v.id);
            } catch (error) {
              console.error(`Error fetching current product ${productId}:`, error);
              // Continue with empty variant IDs
            }
          }

          // Create a print area entry with all variants
          const printAreaEntry: any = {
            variant_ids: variantIds,
            placeholders: []
          };

          // Add placeholders for each position (front, back, etc.)
          for (const key in printAreasData) {
            const area = printAreasData[key];
            printAreaEntry.placeholders.push({
              position: area.position,
              images: [
                {
                  id: area.image_id || area.imageId,
                  x: 0.5,
                  y: 0.5,
                  scale: 1,
                  angle: 0
                }
              ]
            });
          }

          // Replace the print_areas with the correctly formatted version
          formattedData.print_areas = [printAreaEntry];

          // Remove the printAreas property if it exists
          if (formattedData.printAreas) {
            delete formattedData.printAreas;
          }
        }

        console.error(`Updating product ${productId} with formatted data:`, JSON.stringify(formattedData, null, 2));
        return await this.client.products.updateOne(productId, formattedData);
      } else {
        // If no print_areas, just pass the data as is
        return await this.client.products.updateOne(productId, productData);
      }
    } catch (error) {
      console.error(`Error updating product ${productId}:`, error);
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
      console.error(`Error deleting product ${productId}:`, error);
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
      console.error(`Error publishing product ${productId}:`, error);
      throw this.enhanceError(error, publishData);
    }
  }

  // Get catalog blueprints
  async getBlueprints() {
    try {
      // Use the catalog.listBlueprints method
      return await this.client.catalog.listBlueprints();
    } catch (error) {
      console.error('Error fetching blueprints:', error);
      throw error;
    }
  }

  // Get a specific blueprint
  async getBlueprint(blueprintId: string) {
    try {
      // Use the catalog.getBlueprint method
      return await this.client.catalog.getBlueprint(blueprintId);
    } catch (error) {
      console.error(`Error fetching blueprint ${blueprintId}:`, error);
      throw error;
    }
  }

  // Get print providers for a blueprint
  async getPrintProviders(blueprintId: string) {
    try {
      // Use the catalog.getBlueprintProviders method
      return await this.client.catalog.getBlueprintProviders(blueprintId);
    } catch (error) {
      console.error(`Error fetching print providers for blueprint ${blueprintId}:`, error);
      throw error;
    }
  }

  // Get variants for a blueprint and print provider
  async getVariants(blueprintId: string, printProviderId: string) {
    try {
      // Use the catalog.getBlueprintVariants method
      return await this.client.catalog.getBlueprintVariants(blueprintId, printProviderId);
    } catch (error) {
      console.error(`Error fetching variants for blueprint ${blueprintId} and print provider ${printProviderId}:`, error);
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

      // Log the complete error response for debugging
      console.error('Complete error response:', JSON.stringify({
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data,
        headers: error.response.headers
      }, null, 2));
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
          if (source.startsWith('file:///')) {
            filePath = source.replace('file:///', '');
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
            console.error('File not found error:', error);
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
              console.error('Error checking directory:', dirError);
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
            console.error('Error during Printify upload:', uploadError);
            if (uploadError.response) {
              console.error('Response status:', uploadError.response.status);
              console.error('Response data:', JSON.stringify(uploadError.response.data, null, 2));
            }
            throw uploadError;
          }
        } catch (error: any) {
          console.error('Error reading file:', error);
          const errorMessage = error.message || 'Unknown error';

          // Create a detailed error message with troubleshooting information
          let detailedError = `Failed to process file ${source}: ${errorMessage}\n\n`;
          detailedError += 'Troubleshooting steps:\n';
          detailedError += '1. Check if the file exists and is readable\n';
          detailedError += '2. Make sure the file is a valid image (PNG, JPEG, etc.)\n';
          detailedError += '3. Try using a URL or base64 encoded string instead\n';
          detailedError += '\nFile processing details:\n';
          detailedError += `- Attempted to read from: ${source}\n`;
          detailedError += `- Current working directory: ${process.cwd()}\n`;

          // Add stack trace
          if (error.stack) {
            detailedError += `\nStack trace:\n${error.stack}\n`;
          }

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
      console.error('Error uploading image:', error);

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

      // If there's a response object, extract and log the full response data
      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response data:', JSON.stringify(error.response.data, null, 2));

        // Add the full response data to the debug info
        debugInfo.responseStatus = error.response.status;
        debugInfo.responseData = error.response.data;
      }

      throw this.enhanceError(error, debugInfo);
    }
  }
}
