/**
 * Printify catalog service: blueprints, print providers, and variants.
 */
import { PrintifyAPI } from '../printify-api.js';
import { formatSuccessResponse, runService, textResponse, TIPS } from '../utils/error-handler.js';

/**
 * Page size cap. The catalog has over a thousand blueprints and a blueprint can
 * have hundreds of variants; either in full overruns the MCP output limit.
 */
const MAX_LIMIT = 100;

interface Page<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  pageCount: number;
}

/** One page of `items`. Out-of-range page and limit values are clamped, not rejected. */
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

/** Catalog endpoints return collections either bare or wrapped in `data`. */
function asArray(response: any): any[] {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.data)) return response.data;
  return [];
}

/** The trailer telling a caller how to reach the rest of a paged result. */
function pagingHint(page: Page<any>, more: string): string {
  if (page.pageCount <= 1) return more;

  const next = page.page < page.pageCount
    ? ` Request page ${page.page + 1} of ${page.pageCount} for more.`
    : '';

  return `Showing ${page.items.length} of ${page.total}.${next} ${more}`;
}

export async function getBlueprints(
  printifyClient: PrintifyAPI,
  options: {
    page?: number;
    limit?: number;
  } = {}
) {
  return runService(
    'Get Blueprints',
    { context: () => ({ Page: options.page, Limit: options.limit }), tips: [TIPS.apiKey, TIPS.connected] },
    async () => {
      const blueprints = await printifyClient.getBlueprints();

      // Summary fields only: the full record's HTML description and image list
      // push even one page past the output limit.
      const summaries = asArray(blueprints).map((blueprint: any) => ({
        id: blueprint.id,
        title: blueprint.title,
        brand: blueprint.brand,
        model: blueprint.model
      }));

      const paged = paginate(summaries, options.page ?? 1, options.limit ?? 10);

      return {
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
    }
  );
}

export async function getBlueprint(
  printifyClient: PrintifyAPI,
  blueprintId: string
) {
  return runService(
    'Get Blueprint',
    {
      context: () => ({ BlueprintId: blueprintId }),
      tips: ['Check that the blueprint ID is valid', TIPS.apiKey, TIPS.connected]
    },
    async () => {
      const blueprint = await printifyClient.getBlueprint(blueprintId);
      return {
        blueprint,
        response: textResponse(`Blueprint details for ID ${blueprintId}:\n\n${JSON.stringify(blueprint, null, 2)}`)
      };
    }
  );
}

export async function getPrintProviders(
  printifyClient: PrintifyAPI,
  blueprintId: string
) {
  return runService(
    'Get Print Providers',
    {
      context: () => ({ BlueprintId: blueprintId }),
      tips: ['Check that the blueprint ID is valid', TIPS.apiKey, TIPS.connected]
    },
    async () => {
      const printProviders = await printifyClient.getPrintProviders(blueprintId);
      return {
        printProviders,
        response: textResponse(`Print providers for blueprint ID ${blueprintId}:\n\n${JSON.stringify(printProviders, null, 2)}`)
      };
    }
  );
}

export async function getVariants(
  printifyClient: PrintifyAPI,
  blueprintId: string,
  printProviderId: string,
  options: {
    page?: number;
    limit?: number;
    showOutOfStock?: boolean;
  } = {}
) {
  return runService(
    'Get Variants',
    {
      context: () => ({
        BlueprintId: blueprintId,
        PrintProviderId: printProviderId,
        Page: options.page,
        Limit: options.limit,
        ...(options.showOutOfStock ? { ShowOutOfStock: true } : {})
      }),
      tips: [
        'Check that the blueprint ID is valid',
        'Check that the print provider ID is valid',
        TIPS.apiKey,
        TIPS.connected
      ]
    },
    async () => {
      const variants = await printifyClient.getVariants(blueprintId, printProviderId, {
        showOutOfStock: options.showOutOfStock
      });
      const all = asArray((variants as any)?.variants ?? variants);

      // Every variant repeats the same placeholders, so report them once.
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
        variants,
        page: paged,
        response: formatSuccessResponse(
          'Blueprint Variants',
          {
            BlueprintId: blueprintId,
            PrintProviderId: printProviderId,
            // Say which list this is: by default the API leaves out-of-stock variants out.
            'Out Of Stock': options.showOutOfStock ? 'included' : 'hidden (pass showOutOfStock: true to include)',
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
    }
  );
}
