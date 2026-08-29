/**
 * Printify blueprints service for Printify MCP
 */
import { PrintifyAPI } from '../printify-api.js';
import { formatErrorResponse } from '../utils/error-handler.js';

/**
 * Get blueprints from Printify
 */
export async function getBlueprints(
  printifyClient: PrintifyAPI,
  options: {
    page?: number;
    limit?: number;
  } = {}
) {
  try {
    // Validate client is initialized
    if (!printifyClient) {
      throw new Error('Printify API client is not initialized. The PRINTIFY_API_KEY environment variable may not be set.');
    }
    
    // Set default options
    const page = options.page || 1;
    const limit = options.limit || 10;
    
    // Get blueprints
    const blueprints = await printifyClient.getBlueprints();
    
    return {
      success: true,
      blueprints,
      response: {
        content: [{
          type: "text",
          text: `Available blueprints (page ${page}, limit ${limit}):\n\n${JSON.stringify(blueprints, null, 2)}`
        }]
      }
    };
  } catch (error: any) {
    console.error('Error getting blueprints:', error);
    
    return {
      success: false,
      error,
      errorResponse: formatErrorResponse(
        error,
        'Get Blueprints',
        {
          Page: options.page,
          Limit: options.limit
        },
        [
          'Check that your Printify API key is valid',
          'Ensure your Printify account is properly connected'
        ]
      )
    };
  }
}

/**
 * Get a specific blueprint from Printify
 */
export async function getBlueprint(
  printifyClient: PrintifyAPI,
  blueprintId: string
) {
  try {
    // Validate client is initialized
    if (!printifyClient) {
      throw new Error('Printify API client is not initialized. The PRINTIFY_API_KEY environment variable may not be set.');
    }
    
    // Get blueprint
    const blueprint = await printifyClient.getBlueprint(blueprintId);
    
    return {
      success: true,
      blueprint,
      response: {
        content: [{
          type: "text",
          text: `Blueprint details for ID ${blueprintId}:\n\n${JSON.stringify(blueprint, null, 2)}`
        }]
      }
    };
  } catch (error: any) {
    console.error('Error getting blueprint:', error);
    
    return {
      success: false,
      error,
      errorResponse: formatErrorResponse(
        error,
        'Get Blueprint',
        {
          BlueprintId: blueprintId
        },
        [
          'Check that the blueprint ID is valid',
          'Check that your Printify API key is valid',
          'Ensure your Printify account is properly connected'
        ]
      )
    };
  }
}

/**
 * Get print providers for a blueprint
 */
export async function getPrintProviders(
  printifyClient: PrintifyAPI,
  blueprintId: string
) {
  try {
    // Validate client is initialized
    if (!printifyClient) {
      throw new Error('Printify API client is not initialized. The PRINTIFY_API_KEY environment variable may not be set.');
    }
    
    // Get print providers
    const printProviders = await printifyClient.getPrintProviders(blueprintId);
    
    return {
      success: true,
      printProviders,
      response: {
        content: [{
          type: "text",
          text: `Print providers for blueprint ID ${blueprintId}:\n\n${JSON.stringify(printProviders, null, 2)}`
        }]
      }
    };
  } catch (error: any) {
    console.error('Error getting print providers:', error);
    
    return {
      success: false,
      error,
      errorResponse: formatErrorResponse(
        error,
        'Get Print Providers',
        {
          BlueprintId: blueprintId
        },
        [
          'Check that the blueprint ID is valid',
          'Check that your Printify API key is valid',
          'Ensure your Printify account is properly connected'
        ]
      )
    };
  }
}

/**
 * Get variants for a blueprint and print provider
 */
export async function getVariants(
  printifyClient: PrintifyAPI,
  blueprintId: string,
  printProviderId: string
) {
  try {
    // Validate client is initialized
    if (!printifyClient) {
      throw new Error('Printify API client is not initialized. The PRINTIFY_API_KEY environment variable may not be set.');
    }
    
    // Get variants
    const variants = await printifyClient.getVariants(blueprintId, printProviderId);
    
    return {
      success: true,
      variants,
      response: {
        content: [{
          type: "text",
          text: `Variants for blueprint ID ${blueprintId} and print provider ID ${printProviderId}:\n\n${JSON.stringify(variants, null, 2)}`
        }]
      }
    };
  } catch (error: any) {
    console.error('Error getting variants:', error);
    
    return {
      success: false,
      error,
      errorResponse: formatErrorResponse(
        error,
        'Get Variants',
        {
          BlueprintId: blueprintId,
          PrintProviderId: printProviderId
        },
        [
          'Check that the blueprint ID is valid',
          'Check that the print provider ID is valid',
          'Check that your Printify API key is valid',
          'Ensure your Printify account is properly connected'
        ]
      )
    };
  }
}
