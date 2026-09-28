/**
 * Printify catalog service: blueprints, print providers, variants, and shipping.
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

/** "Brooklyn, NY, US" from a provider's location; missing parts are skipped. */
function formatLocation(location: any): string | undefined {
  const parts = [location?.city, location?.region, location?.country].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : undefined;
}

export async function listAllPrintProviders(
  printifyClient: PrintifyAPI,
  options: {
    page?: number;
    limit?: number;
  } = {}
) {
  return runService(
    'List Print Providers',
    { context: () => ({ Page: options.page, Limit: options.limit }), tips: [TIPS.apiKey, TIPS.connected] },
    async () => {
      const providers = await printifyClient.listAllPrintProviders();
      const summaries = asArray(providers).map((provider: any) => ({
        id: provider.id,
        title: provider.title,
        location: formatLocation(provider.location)
      }));

      const paged = paginate(summaries, options.page ?? 1, options.limit ?? 20);

      return {
        providers,
        page: paged,
        response: formatSuccessResponse(
          'Print Providers',
          {
            Total: paged.total,
            Page: paged.page,
            PageCount: paged.pageCount,
            Limit: paged.limit,
            Returned: paged.items.length,
            Providers: paged.items
          },
          pagingHint(paged, 'Use get_print_provider for a provider\'s blueprints.')
        )
      };
    }
  );
}

export async function getPrintProvider(
  printifyClient: PrintifyAPI,
  printProviderId: string,
  options: {
    page?: number;
    limit?: number;
  } = {}
) {
  return runService(
    'Get Print Provider',
    {
      context: () => ({ PrintProviderId: printProviderId, Page: options.page, Limit: options.limit }),
      tips: ['Check that the print provider ID is valid', TIPS.apiKey, TIPS.connected]
    },
    async () => {
      const provider: any = await printifyClient.getPrintProvider(printProviderId);

      // A provider can offer hundreds of blueprints, so they are paged like
      // get_blueprints and reduced to the same summary fields.
      const blueprintSummaries = asArray(provider?.blueprints).map((blueprint: any) => ({
        id: blueprint.id,
        title: blueprint.title,
        brand: blueprint.brand,
        model: blueprint.model
      }));
      const paged = paginate(blueprintSummaries, options.page ?? 1, options.limit ?? 20);

      return {
        provider,
        page: paged,
        response: formatSuccessResponse(
          'Print Provider',
          {
            Id: provider?.id,
            Title: provider?.title,
            Location: formatLocation(provider?.location) ?? 'Unknown',
            'Blueprints Total': paged.total,
            Page: paged.page,
            PageCount: paged.pageCount,
            Limit: paged.limit,
            Blueprints: paged.items
          },
          pagingHint(paged, 'Use get_variants with a blueprint id and this provider id for its variants.')
        )
      };
    }
  );
}

/** "4.50 USD" from Printify's `{ cost, currency }`, where cost is in cents. */
function formatCost(price: any): string | undefined {
  if (typeof price?.cost !== 'number') return undefined;
  return `${(price.cost / 100).toFixed(2)} ${price.currency ?? ''}`.trim();
}

/** Profiles with the same variants, keyed by their sorted variant ids. */
function groupByVariants(profiles: any[]): any[][] {
  const groups = new Map<string, any[]>();
  for (const profile of profiles) {
    const key = [...(profile.variant_ids ?? [])].sort((a: number, b: number) => a - b).join(',');
    groups.set(key, [...(groups.get(key) ?? []), profile]);
  }
  return [...groups.values()];
}

/**
 * The shipping profiles that apply to one country. Profiles are split by
 * variant, so the choice is made per variant group: the group's profile naming
 * the country, else its REST_OF_THE_WORLD profile. A group with neither does
 * not ship there, and the note says which variants those are.
 */
function profilesForCountry(profiles: any[], country: string): { matched: any[]; note?: string } {
  const names = (profile: any, code: string) => (profile.countries ?? []).includes(code);
  const matched: any[] = [];
  let fellBack = 0;
  const unshipped: number[] = [];

  for (const group of groupByVariants(profiles)) {
    const named = group.find((profile) => names(profile, country));
    const rest = group.find((profile) => names(profile, 'REST_OF_THE_WORLD'));
    if (named) {
      matched.push(named);
    } else if (rest) {
      matched.push(rest);
      fellBack++;
    } else {
      unshipped.push(...(group[0].variant_ids ?? []));
    }
  }

  if (matched.length === 0) {
    return { matched, note: `This provider does not ship this blueprint to ${country}.` };
  }
  const notes: string[] = [];
  if (fellBack > 0) {
    notes.push(fellBack === matched.length
      ? `No profile names ${country}; showing REST_OF_THE_WORLD rates.`
      : `Some variants have no ${country} profile; they show REST_OF_THE_WORLD rates.`);
  }
  if (unshipped.length > 0) {
    notes.push(`${unshipped.length} variant(s) do not ship to ${country}: ${unshipped.join(', ')}.`);
  }
  return { matched, note: notes.join('\n') || undefined };
}

export async function getShipping(
  printifyClient: PrintifyAPI,
  blueprintId: string,
  printProviderId: string,
  options: { country?: string } = {}
) {
  return runService(
    'Get Shipping',
    {
      context: () => ({
        BlueprintId: blueprintId,
        PrintProviderId: printProviderId,
        ...(options.country ? { Country: options.country } : {})
      }),
      tips: [
        'Check that the blueprint ID is valid',
        'Check that the print provider offers this blueprint (see get_print_providers)',
        TIPS.apiKey,
        TIPS.connected
      ]
    },
    async () => {
      const shipping: any = await printifyClient.getShipping(blueprintId, printProviderId);
      const profiles = asArray(shipping?.profiles);

      const country = options.country?.trim().toUpperCase();
      const { matched, note: countryNote } = country
        ? profilesForCountry(profiles, country)
        : { matched: profiles, note: undefined };

      const summaries = matched.map((profile: any) => ({
        countries: profile.countries,
        firstItem: formatCost(profile.first_item),
        additionalItem: formatCost(profile.additional_items),
        variantCount: (profile.variant_ids ?? []).length,
        variantIds: profile.variant_ids
      }));

      const handling = shipping?.handling_time;

      return {
        shipping,
        response: formatSuccessResponse(
          'Shipping Rates',
          {
            BlueprintId: blueprintId,
            PrintProviderId: printProviderId,
            ...(country ? { Country: country } : {}),
            'Handling Time': handling ? `${handling.value} ${handling.unit}${handling.value === 1 ? '' : 's'}` : 'Unknown',
            Profiles: summaries
          },
          [countryNote, 'Costs are what the provider charges you per order: the first item, then each additional item.']
            .filter(Boolean).join('\n')
        )
      };
    }
  );
}
