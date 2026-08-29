/**
 * Printify products service for Printify MCP
 */
import { PrintifyAPI } from '../printify-api.js';
import { formatErrorResponse, formatSuccessResponse } from '../utils/error-handler.js';

/**
 * List products from Printify
 */
export async function listProducts(
  printifyClient: PrintifyAPI,
  options: {
    limit?: number;
    page?: number;
  } = {}
) {
  try {
    // Validate shop is selected
    const currentShop = printifyClient.getCurrentShop();
    if (!currentShop) {
      throw new Error('No shop is currently selected. Use the list-shops and switch-shop tools to select a shop.');
    }

    // Set default options
    const limit = options.limit || 10;
    const page = options.page || 1;

    // Get products
    const products = await printifyClient.getProducts(page, limit);

    return {
      success: true,
      products,
      response: formatSuccessResponse(
        'Products Retrieved Successfully',
        {
          Count: products.data?.length ?? 0,
          Page: page,
          Limit: limit,
          Shop: currentShop,
          Products: (products.data ?? []).map((p: any) => ({ id: p.id, title: p.title }))
        }
      )
    };
  } catch (error: any) {
    console.error('Error listing products:', error);

    return {
      success: false,
      error,
      errorResponse: formatErrorResponse(
        error,
        'List Products',
        {
          Shop: printifyClient.getCurrentShop(),
          Limit: options.limit,
          Page: options.page
        },
        [
          'Check that your Printify API key is valid',
          'Ensure your Printify account is properly connected',
          'Make sure you have selected a shop'
        ]
      )
    };
  }
}

/**
 * Get a product from Printify
 */
export async function getProduct(
  printifyClient: PrintifyAPI,
  productId: string
) {
  try {
    // Validate shop is selected
    const currentShop = printifyClient.getCurrentShop();
    if (!currentShop) {
      throw new Error('No shop is currently selected. Use the list-shops and switch-shop tools to select a shop.');
    }

    // Get product
    const product = await printifyClient.getProduct(productId);

    return {
      success: true,
      product,
      response: formatSuccessResponse(
        'Product Retrieved Successfully',
        {
          ProductId: productId,
          Title: product.title,
          Shop: currentShop
        }
      )
    };
  } catch (error: any) {
    console.error('Error getting product:', error);

    return {
      success: false,
      error,
      errorResponse: formatErrorResponse(
        error,
        'Get Product',
        {
          ProductId: productId,
          Shop: printifyClient.getCurrentShop()
        },
        [
          'Check that the product ID is valid',
          'Ensure your Printify account is properly connected',
          'Make sure you have selected a shop'
        ]
      )
    };
  }
}

/**
 * Create a product in Printify
 */
export async function createProduct(
  printifyClient: PrintifyAPI,
  productData: {
    title: string;
    description: string;
    blueprintId: number;
    printProviderId: number;
    variants: Array<{
      variantId: number;
      price: number;
      isEnabled?: boolean;
    }>;
    printAreas?: Record<string, {
      position: string;
      imageId: string;
    }>;
    tags?: string[];
  }
) {
  try {
    // Validate shop is selected
    const currentShop = printifyClient.getCurrentShop();
    if (!currentShop) {
      throw new Error('No shop is currently selected. Use the list-shops and switch-shop tools to select a shop.');
    }

    // Create product
    const product = await printifyClient.createProduct(productData);

    return {
      success: true,
      product,
      response: formatSuccessResponse(
        'Product Created Successfully',
        {
          ProductId: product.id,
          Title: product.title,
          Shop: currentShop
        },
        `You can now publish this product using the publish-product tool.`
      )
    };
  } catch (error: any) {
    console.error('Error creating product:', error);

    return {
      success: false,
      error,
      errorResponse: formatErrorResponse(
        error,
        'Create Product',
        {
          Title: productData.title,
          BlueprintId: productData.blueprintId,
          PrintProviderId: productData.printProviderId,
          VariantsCount: productData.variants.length,
          Shop: printifyClient.getCurrentShop()
        },
        [
          'Check that the blueprint ID is valid',
          'Check that the print provider ID is valid',
          'Check that the variant IDs are valid',
          'Ensure your Printify account is properly connected',
          'Make sure you have selected a shop'
        ]
      )
    };
  }
}

/**
 * Update a product in Printify
 */
export async function updateProduct(
  printifyClient: PrintifyAPI,
  productId: string,
  updateData: {
    title?: string;
    description?: string;
    variants?: Array<{
      variantId: number;
      price: number;
      isEnabled?: boolean;
    }>;
    printAreas?: Record<string, {
      position: string;
      imageId: string;
    }>;
    tags?: string[];
  }
) {
  try {
    // Validate shop is selected
    const currentShop = printifyClient.getCurrentShop();
    if (!currentShop) {
      throw new Error('No shop is currently selected. Use the list-shops and switch-shop tools to select a shop.');
    }

    // Update product
    const product = await printifyClient.updateProduct(productId, updateData);

    return {
      success: true,
      product,
      response: formatSuccessResponse(
        'Product Updated Successfully',
        {
          ProductId: productId,
          Title: updateData.title || 'Not updated',
          Shop: currentShop
        },
        `You may need to publish the changes using the publish-product tool.`
      )
    };
  } catch (error: any) {
    console.error('Error updating product:', error);

    return {
      success: false,
      error,
      errorResponse: formatErrorResponse(
        error,
        'Update Product',
        {
          ProductId: productId,
          UpdateData: updateData,
          Shop: printifyClient.getCurrentShop()
        },
        [
          'Check that the product ID is valid',
          'Check that the variant IDs are valid',
          'Ensure your Printify account is properly connected',
          'Make sure you have selected a shop'
        ]
      )
    };
  }
}

/**
 * Delete a product from Printify
 */
export async function deleteProduct(
  printifyClient: PrintifyAPI,
  productId: string
) {
  try {
    // Validate shop is selected
    const currentShop = printifyClient.getCurrentShop();
    if (!currentShop) {
      throw new Error('No shop is currently selected. Use the list-shops and switch-shop tools to select a shop.');
    }

    // Delete product
    await printifyClient.deleteProduct(productId);

    return {
      success: true,
      response: formatSuccessResponse(
        'Product Deleted Successfully',
        {
          ProductId: productId,
          Shop: currentShop
        }
      )
    };
  } catch (error: any) {
    console.error('Error deleting product:', error);

    return {
      success: false,
      error,
      errorResponse: formatErrorResponse(
        error,
        'Delete Product',
        {
          ProductId: productId,
          Shop: printifyClient.getCurrentShop()
        },
        [
          'Check that the product ID is valid',
          'Ensure your Printify account is properly connected',
          'Make sure you have selected a shop'
        ]
      )
    };
  }
}

/**
 * Publish a product to Printify
 */
export async function publishProduct(
  printifyClient: PrintifyAPI,
  productId: string,
  publishDetails?: {
    title?: boolean;
    description?: boolean;
    images?: boolean;
    variants?: boolean;
    tags?: boolean;
  }
) {
  try {
    // Validate shop is selected
    const currentShop = printifyClient.getCurrentShop();
    if (!currentShop) {
      throw new Error('No shop is currently selected. Use the list-shops and switch-shop tools to select a shop.');
    }

    // Publish product
    const result = await printifyClient.publishProduct(productId, publishDetails);

    return {
      success: true,
      result,
      response: formatSuccessResponse(
        'Product Published Successfully',
        {
          ProductId: productId,
          Shop: currentShop
        }
      )
    };
  } catch (error: any) {
    console.error('Error publishing product:', error);

    return {
      success: false,
      error,
      errorResponse: formatErrorResponse(
        error,
        'Publish Product',
        {
          ProductId: productId,
          PublishDetails: publishDetails,
          Shop: printifyClient.getCurrentShop()
        },
        [
          'Check that the product ID is valid',
          'Ensure your Printify account is properly connected',
          'Make sure you have selected a shop'
        ]
      )
    };
  }
}
