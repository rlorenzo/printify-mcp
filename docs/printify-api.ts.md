# `printify-api.ts` Documentation

## Overview

`printify-api.ts` implements a client for interacting with the Printify API using the official Printify SDK. It provides methods for managing shops, products, blueprints, variants, and images.

## Dependencies

- `fs`: File system module for reading local files
- `printify-sdk-js`: Official Printify SDK

## Interfaces

### PrintifyShop

Represents a shop in Printify.

```typescript
export interface PrintifyShop {
  id: number;
  title: string;
  sales_channel: string;
}
```

## PrintifyAPI Class

The main class for interacting with the Printify API.

### Constructor

```typescript
constructor(apiToken: string, shopId?: string)
```

- `apiToken`: The Printify API token
- `shopId` (optional): The ID of the shop to use

### Properties

- `private client`: The Printify SDK client
- `private apiToken`: The Printify API token
- `private shopId`: The current shop ID
- `private shops`: Array of available shops

### Methods

#### initialize

Initializes the API client by fetching shops.

```typescript
async initialize(): Promise<PrintifyShop[]>
```

- Returns: A promise that resolves to an array of shops

This method:

1. Fetches shops from the Printify API
2. Stores the shops in the `shops` property
3. Sets the first shop as the default if no shop ID was provided
4. Creates a new client with the shop ID
5. Falls back to mock shops if the API call fails

#### getAvailableShops

Gets all available shops.

```typescript
getAvailableShops(): PrintifyShop[]
```

- Returns: An array of shops

#### getCurrentShopId

Gets the current shop ID.

```typescript
getCurrentShopId(): string | null
```

- Returns: The current shop ID or null if no shop is selected

#### getCurrentShop

Gets the current shop.

```typescript
getCurrentShop(): PrintifyShop | null
```

- Returns: The current shop or null if no shop is selected

#### setShopId

Sets the shop ID for subsequent requests.

```typescript
setShopId(shopId: string)
```

- `shopId`: The ID of the shop to use

This method:

1. Sets the shop ID
2. Creates a new client instance with the new shop ID (required by the SDK)

#### getShops

Gets a list of shops.

```typescript
async getShops()
```

- Returns: A promise that resolves to an array of shops

#### getProducts

Gets a list of products with pagination.

```typescript
async getProducts(page = 1, limit = 10)
```

- `page`: The page number (default: 1)
- `limit`: The number of products per page (default: 10)
- Returns: A promise that resolves to a list of products

#### getProduct

Gets a specific product by ID.

```typescript
async getProduct(productId: string)
```

- `productId`: The ID of the product to get
- Returns: A promise that resolves to the product details

#### createProduct

Creates a new product.

```typescript
async createProduct(productData: any)
```

- `productData`: The product data
- Returns: A promise that resolves to the created product

This method:

1. Formats the product data to match the API's expected format
2. Handles variants and print areas
3. Calls the Printify API to create the product
4. Enhances errors with detailed information for debugging

#### updateProduct

Updates an existing product.

```typescript
async updateProduct(productId: string, productData: any)
```

- `productId`: The ID of the product to update
- `productData`: The product data to update
- Returns: A promise that resolves to the updated product

This method:

1. Formats the product data if it contains print areas
2. Handles variants and print areas
3. Calls the Printify API to update the product
4. Enhances errors with detailed information for debugging

#### deleteProduct

Deletes a product.

```typescript
async deleteProduct(productId: string)
```

- `productId`: The ID of the product to delete
- Returns: A promise that resolves when the product is deleted

#### publishProduct

Publishes a product to external sales channels.

```typescript
async publishProduct(productId: string, publishData: any)
```

- `productId`: The ID of the product to publish
- `publishData`: The publish data
- Returns: A promise that resolves to the publish result

#### getBlueprints

Gets catalog blueprints.

```typescript
async getBlueprints()
```

- Returns: A promise that resolves to a list of blueprints

#### getBlueprint

Gets a specific blueprint by ID.

```typescript
async getBlueprint(blueprintId: string)
```

- `blueprintId`: The ID of the blueprint to get
- Returns: A promise that resolves to the blueprint details

#### getPrintProviders

Gets print providers for a blueprint.

```typescript
async getPrintProviders(blueprintId: string)
```

- `blueprintId`: The ID of the blueprint
- Returns: A promise that resolves to a list of print providers

#### getVariants

Gets variants for a blueprint and print provider.

```typescript
async getVariants(blueprintId: string, printProviderId: string)
```

- `blueprintId`: The ID of the blueprint
- `printProviderId`: The ID of the print provider
- Returns: A promise that resolves to a list of variants

#### enhanceError

Helper method to enhance errors with more details.

```typescript
private enhanceError(error: any, requestData?: any): any
```

- `error`: The error to enhance
- `requestData` (optional): The request data
- Returns: The enhanced error

This method:

1. Extracts detailed error information from the response
2. Adds status code, validation errors, and request data
3. Logs the complete error response for debugging

#### uploadImage

Uploads an image to Printify.

```typescript
async uploadImage(fileName: string, source: string)
```

- `fileName`: The name of the file
- `source`: The source of the image (URL, local file path, or base64 data)
- Returns: A promise that resolves to the uploaded image details

This method:

1. Determines the type of source (URL, file path, or base64 data)
2. Handles each type appropriately:
   - For URLs, uses the URL upload method
   - For file paths, reads the file and converts to base64
   - For base64 data, uses it directly
3. Uploads the image to Printify
4. Enhances errors with detailed information for debugging

## Error Handling

The class includes robust error handling for all methods, with detailed error messages to help troubleshoot issues. For example:

```typescript
catch (error: any) {
  console.error('Error uploading image:', error);
  throw this.enhanceError(error, { fileName, sourceType: typeof source, sourceLength: source.length });
}
```

## Conclusion

`printify-api.ts` provides a comprehensive client for interacting with the Printify API, handling all aspects of shop and product management, as well as image uploads. It includes robust error handling and detailed logging to help troubleshoot issues.
