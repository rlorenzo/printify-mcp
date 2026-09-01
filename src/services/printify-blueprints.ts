/**
 * Printify blueprints service for Printify MCP
 */
import { PrintifyAPI } from '../printify-api.js';
import { describeError, formatErrorResponse, formatSuccessResponse } from '../utils/error-handler.js';

/**
 * The most items a caller may take in one page.
 *
 * The Printify catalog holds well over a thousand blueprints, and a popular
 * blueprint can carry several hundred variants. Returning either in full
 * overruns the MCP tool output limit, so the response is both projected down to
 * the fields a caller acts on and capped at one page.
 */
const MAX_LIMIT = 100;

interface Page<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  pageCount: number;
}

/**
 * Take one page of `items`, clamping the request rather than rejecting it: an
 * out-of-range page yields the last one, and an oversized limit yields
 * MAX_LIMIT. The clamped values come back so the response can report what was
 * actually applied.
 */
function paginate<T>(items: T[], page: number, limit: number): Page<T> {
  const safeLimit = Math.min(Math.max(Math.trunc(limit) || 1, 1), MAX_LIMIT);
  const pageCount = Math.max(Math.ceil(items.length / safeLimit), 1);
  const safePage = Math.min(Math.max(Math.trunc(page) || 1, 1), pageCount);
  const start = (safePage - 1) * safeLimit;

  return {
    items: items.slice(start, start + safeLimit),
    page: safePage,
    limit: safeLimit,
    total: items.length,
    pageCount
  };
}

/**
 * Printify returns catalog collections either bare or wrapped in `data`
 * depending on the endpoint; normalize both to an array.
 */
function asArray(response: any): any[] {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.data)) return response.data;
  return [];
}

/** The trailer telling a caller how to reach the rest of a paged result. */
function pagingHint(page: Page<any>, more: string): string {
  if (page.pageCount <= 1) return more;

  // On the last page there is nothing further to request, so report the
  // position without a next-page pointer that would just repeat it.
  const next = page.page < page.pageCount
    ? ` Request page ${page.page + 1} of ${page.pageCount} for more.`
    : '';

  return `Showing ${page.items.length} of ${page.total}.${next} ${more}`;
}

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
    
    // Get blueprints
    const blueprints = await printifyClient.getBlueprints();

    // Only the fields needed to pick a blueprint. The full record carries an
    // HTML description and a list of image URLs, which together push even a
    // single page past the output limit.
    const summaries = asArray(blueprints).map((blueprint: any) => ({
      id: blueprint.id,
      title: blueprint.title,
      brand: blueprint.brand,
      model: blueprint.model
    }));

    const paged = paginate(summaries, options.page ?? 1, options.limit ?? 10);

    return {
      success: true,
      blueprints,
      page: paged,
      response: formatSuccessResponse(
        'Available Blueprints',
        {
          Total: paged.total,
          Page: paged.page,
          PageCount: paged.pageCount,
          Limit: paged.limit,
          Returned: paged.items.length,
          Blueprints: paged.items
        },
        pagingHint(paged, 'Use get_blueprint for a single blueprint\'s full record.')
      )
    };
  } catch (error: any) {
    console.error('Error getting blueprints:', describeError(error));
    
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
    console.error('Error getting blueprint:', describeError(error));
    
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
    console.error('Error getting print providers:', describeError(error));
    
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
  printProviderId: string,
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
    
    // Get variants
    const variants = await printifyClient.getVariants(blueprintId, printProviderId);

    const all = asArray((variants as any)?.variants ?? variants);

    // Every variant repeats the same placeholder geometry, so it is reported
    // once for the set instead of once per variant.
    const placeholders = Array.from(new Set(
      all.flatMap((variant: any) => (variant.placeholders ?? []).map((ph: any) => ph.position))
    ));

    const summaries = all.map((variant: any) => ({
      id: variant.id,
      title: variant.title,
      options: variant.options
    }));

    const paged = paginate(summaries, options.page ?? 1, options.limit ?? 50);

    return {
      success: true,
      variants,
      page: paged,
      response: formatSuccessResponse(
        'Blueprint Variants',
        {
          BlueprintId: blueprintId,
          PrintProviderId: printProviderId,
          Total: paged.total,
          Page: paged.page,
          PageCount: paged.pageCount,
          Limit: paged.limit,
          Returned: paged.items.length,
          Placeholders: placeholders,
          Variants: paged.items
        },
        pagingHint(paged, 'Pass a variant id to create_product as variantId.')
      )
    };
  } catch (error: any) {
    console.error('Error getting variants:', describeError(error));
    
    return {
      success: false,
      error,
      errorResponse: formatErrorResponse(
        error,
        'Get Variants',
        {
          BlueprintId: blueprintId,
          PrintProviderId: printProviderId,
          Page: options.page,
          Limit: options.limit
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
