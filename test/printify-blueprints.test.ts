import { describe, it, expect } from 'vitest';
import { getBlueprints, getVariants, listAllPrintProviders, getPrintProvider, getShipping } from '../src/services/printify-blueprints.js';

function fakeClient(overrides: Record<string, any> = {}) {
  return {
    getCurrentShop: () => ({ id: 1, title: 'Test Shop' }),
    getBlueprints: async () => ({ data: [] }),
    getVariants: async () => ({ id: 2, variants: [] }),
    ...overrides
  } as any;
}

/** A blueprint as Printify returns it: a long HTML description and image URLs. */
function fakeBlueprint(id: number) {
  return {
    id,
    title: `Blueprint ${id}`,
    brand: 'Test Brand',
    model: `M-${id}`,
    description: '<p>'.padEnd(400, 'x') + '</p>',
    images: [`https://example.test/${id}-a.jpg`, `https://example.test/${id}-b.jpg`]
  };
}

function fakeVariant(id: number) {
  return {
    id,
    title: `Variant ${id}`,
    options: { color: 'Black', size: 'M' },
    placeholders: [
      { position: 'front', width: 3000, height: 3000 },
      { position: 'back', width: 3000, height: 3000 }
    ]
  };
}

const blueprints = (n: number) => Array.from({ length: n }, (_, i) => fakeBlueprint(i + 1));
const variants = (n: number) => Array.from({ length: n }, (_, i) => fakeVariant(i + 1));

describe('getBlueprints', () => {
  // Regression: page and limit were accepted, echoed in the header, and then
  // ignored -- the whole catalog was serialized into every response.
  it('returns only the requested page', async () => {
    const client = fakeClient({ getBlueprints: async () => ({ data: blueprints(25) }) });
    const result = await getBlueprints(client, { page: 2, limit: 10 });
    expect(result.page!.items.map((b: any) => b.id)).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  });

  it('reports the totals alongside the page', async () => {
    const client = fakeClient({ getBlueprints: async () => ({ data: blueprints(25) }) });
    const text = (await getBlueprints(client, { page: 2, limit: 10 })).response!.content[0].text;
    expect(text).toContain('**Total**: "25"');
    expect(text).toContain('**Page**: "2"');
    expect(text).toContain('**PageCount**: "3"');
    expect(text).toContain('**Returned**: "10"');
  });

  it('drops the description and image URLs', async () => {
    const client = fakeClient({ getBlueprints: async () => ({ data: blueprints(3) }) });
    const text = (await getBlueprints(client, {})).response!.content[0].text;
    expect(text).toContain('"brand":"Test Brand"');
    expect(text).not.toContain('example.test');
    expect(text).not.toContain('<p>');
  });

  it('defaults to the first page of ten', async () => {
    const client = fakeClient({ getBlueprints: async () => ({ data: blueprints(25) }) });
    const result = await getBlueprints(client, {});
    expect(result.page!.page).toBe(1);
    expect(result.page!.items).toHaveLength(10);
  });

  it('caps an oversized limit at 100', async () => {
    const client = fakeClient({ getBlueprints: async () => ({ data: blueprints(500) }) });
    const result = await getBlueprints(client, { limit: 1000 });
    expect(result.page!.limit).toBe(100);
    expect(result.page!.items).toHaveLength(100);
  });

  it('clamps a page past the end to the last one', async () => {
    const client = fakeClient({ getBlueprints: async () => ({ data: blueprints(25) }) });
    const result = await getBlueprints(client, { page: 99, limit: 10 });
    expect(result.page!.page).toBe(3);
    expect(result.page!.items).toHaveLength(5);
  });

  it('points at the next page only when there is one', async () => {
    const many = fakeClient({ getBlueprints: async () => ({ data: blueprints(25) }) });
    const few = fakeClient({ getBlueprints: async () => ({ data: blueprints(3) }) });
    expect((await getBlueprints(many, {})).response!.content[0].text).toContain('Request page 2 of 3');
    expect((await getBlueprints(few, {})).response!.content[0].text).not.toContain('Request page');

    // The last page still reports its position, but pointing at a next page
    // there would just repeat the page the caller is already on.
    const last = (await getBlueprints(many, { page: 3 })).response!.content[0].text;
    expect(last).toContain('Showing 5 of 25.');
    expect(last).not.toContain('Request page');
  });

  it('accepts a bare array as well as a data wrapper', async () => {
    const client = fakeClient({ getBlueprints: async () => blueprints(4) });
    expect((await getBlueprints(client, {})).page!.total).toBe(4);
  });

  it('handles an empty catalog', async () => {
    const result = await getBlueprints(fakeClient(), {});
    expect(result.success).toBe(true);
    expect(result.page!.total).toBe(0);
    expect(result.page!.pageCount).toBe(1);
  });

  it('reports a failure without throwing', async () => {
    const client = fakeClient({ getBlueprints: async () => { throw new Error('catalog down'); } });
    const result = await getBlueprints(client, {});
    expect(result.success).toBe(false);
    expect(result.errorResponse!.content[0].text).toMatch(/catalog down/);
  });
});

describe('getVariants', () => {
  it('returns only the requested page', async () => {
    const client = fakeClient({ getVariants: async () => ({ id: 2, variants: variants(120) }) });
    const result = await getVariants(client, '1', '2', { page: 2, limit: 50 });
    expect(result.page!.items).toHaveLength(50);
    expect(result.page!.items[0].id).toBe(51);
  });

  it('reports the totals alongside the page', async () => {
    const client = fakeClient({ getVariants: async () => ({ id: 2, variants: variants(120) }) });
    const text = (await getVariants(client, '1', '2', {})).response!.content[0].text;
    expect(text).toContain('**Total**: "120"');
    expect(text).toContain('**PageCount**: "3"');
    expect(text).toContain('**BlueprintId**: "1"');
    expect(text).toContain('**PrintProviderId**: "2"');
  });

  // The geometry repeats identically on every variant, so it is reported once.
  it('lifts the placeholder positions out of the variants', async () => {
    const client = fakeClient({ getVariants: async () => ({ id: 2, variants: variants(3) }) });
    const text = (await getVariants(client, '1', '2', {})).response!.content[0].text;
    expect(text).toContain('**Placeholders**: ["front","back"]');
    expect(text).not.toContain('3000');
  });

  it('keeps the ids and options a caller needs for create_product', async () => {
    const client = fakeClient({ getVariants: async () => ({ id: 2, variants: variants(2) }) });
    const text = (await getVariants(client, '1', '2', {})).response!.content[0].text;
    expect(text).toContain('"id":1');
    expect(text).toContain('"color":"Black"');
  });

  it('defaults to the first page of fifty', async () => {
    const client = fakeClient({ getVariants: async () => ({ id: 2, variants: variants(120) }) });
    const result = await getVariants(client, '1', '2');
    expect(result.page!.page).toBe(1);
    expect(result.page!.limit).toBe(50);
  });

  it('caps an oversized limit at 100', async () => {
    const client = fakeClient({ getVariants: async () => ({ id: 2, variants: variants(400) }) });
    expect((await getVariants(client, '1', '2', { limit: 1000 })).page!.limit).toBe(100);
  });

  it('accepts a bare array of variants', async () => {
    const client = fakeClient({ getVariants: async () => variants(6) });
    expect((await getVariants(client, '1', '2', {})).page!.total).toBe(6);
  });

  it('handles a blueprint with no variants', async () => {
    const result = await getVariants(fakeClient(), '1', '2', {});
    expect(result.success).toBe(true);
    expect(result.page!.total).toBe(0);
  });

  it('reports a failure without throwing', async () => {
    const client = fakeClient({ getVariants: async () => { throw new Error('provider gone'); } });
    const result = await getVariants(client, '1', '2', {});
    expect(result.success).toBe(false);
    expect(result.errorResponse!.content[0].text).toMatch(/provider gone/);
  });
});

describe('listAllPrintProviders', () => {
  const providers = (n: number) => Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    title: `Provider ${i + 1}`,
    location: { address1: '1 Main St', city: 'Brooklyn', region: 'NY', country: 'US', zip: '11221' }
  }));

  it('pages the providers and keeps only id, title and a short location', async () => {
    const client = fakeClient({ listAllPrintProviders: async () => providers(45) });
    const result = await listAllPrintProviders(client, { page: 3, limit: 20 });
    expect(result.page!.items).toEqual([
      { id: 41, title: 'Provider 41', location: 'Brooklyn, NY, US' },
      { id: 42, title: 'Provider 42', location: 'Brooklyn, NY, US' },
      { id: 43, title: 'Provider 43', location: 'Brooklyn, NY, US' },
      { id: 44, title: 'Provider 44', location: 'Brooklyn, NY, US' },
      { id: 45, title: 'Provider 45', location: 'Brooklyn, NY, US' }
    ]);
    const text = result.response!.content[0].text;
    expect(text).toContain('**Total**: "45"');
    expect(text).not.toContain('1 Main St');
  });

  it('reports a failure without throwing', async () => {
    const client = fakeClient({ listAllPrintProviders: async () => { throw new Error('catalog down'); } });
    const result = await listAllPrintProviders(client);
    expect(result.success).toBe(false);
    expect(result.errorResponse!.content[0].text).toMatch(/catalog down/);
  });
});

describe('getPrintProvider', () => {
  it('reports the location and pages the blueprints as summaries', async () => {
    const provider = {
      id: 29,
      title: 'Monster Digital',
      location: { city: 'Charlotte', region: 'NC', country: 'US' },
      blueprints: Array.from({ length: 30 }, (_, i) => fakeBlueprint(i + 1))
    };
    const client = fakeClient({ getPrintProvider: async () => provider });
    const result = await getPrintProvider(client, '29', { page: 2, limit: 20 });
    expect(result.page!.items).toHaveLength(10);
    expect(result.page!.items[0]).toEqual({ id: 21, title: 'Blueprint 21', brand: 'Test Brand', model: 'M-21' });
    const text = result.response!.content[0].text;
    expect(text).toContain('**Location**: "Charlotte, NC, US"');
    expect(text).toContain('**Blueprints Total**: "30"');
    // Blueprint descriptions are long HTML; only summaries are returned.
    expect(text).not.toContain('<p>');
  });
});

describe('getShipping', () => {
  const shipping = {
    handling_time: { value: 3, unit: 'day' },
    profiles: [
      { variant_ids: [1, 2], first_item: { cost: 450, currency: 'USD' }, additional_items: { cost: 200, currency: 'USD' }, countries: ['US'] },
      { variant_ids: [1, 2], first_item: { cost: 650, currency: 'USD' }, additional_items: { cost: 300, currency: 'USD' }, countries: ['CA', 'DE'] },
      { variant_ids: [1, 2], first_item: { cost: 1100, currency: 'USD' }, additional_items: { cost: 500, currency: 'USD' }, countries: ['REST_OF_THE_WORLD'] }
    ]
  };

  it('lists every profile with costs in currency units', async () => {
    const client = fakeClient({ getShipping: async () => shipping });
    const text = (await getShipping(client, '12', '29')).response!.content[0].text;
    expect(text).toContain('**Handling Time**: "3 days"');
    expect(text).toContain('"firstItem":"4.50 USD"');
    expect(text).toContain('"additionalItem":"5.00 USD"');
    expect(text).toContain('"variantCount":2');
  });

  it('narrows to the profiles for a country, case-insensitively', async () => {
    const client = fakeClient({ getShipping: async () => shipping });
    const text = (await getShipping(client, '12', '29', { country: 'de' })).response!.content[0].text;
    expect(text).toContain('**Country**: "DE"');
    expect(text).toContain('"firstItem":"6.50 USD"');
    expect(text).not.toContain('4.50 USD');
    expect(text).not.toContain('11.00 USD');
  });

  it('falls back to REST_OF_THE_WORLD for a country no profile names', async () => {
    const client = fakeClient({ getShipping: async () => shipping });
    const text = (await getShipping(client, '12', '29', { country: 'JP' })).response!.content[0].text;
    expect(text).toContain('"firstItem":"11.00 USD"');
    expect(text).toContain('No profile names JP; showing REST_OF_THE_WORLD rates.');
  });

  it('says so when the provider does not ship to the country at all', async () => {
    const client = fakeClient({ getShipping: async () => ({ ...shipping, profiles: shipping.profiles.slice(0, 1) }) });
    const text = (await getShipping(client, '12', '29', { country: 'JP' })).response!.content[0].text;
    expect(text).toContain('This provider does not ship this blueprint to JP.');
    expect(text).toContain('**Profiles**: []');
  });

  it('reports a failure without throwing', async () => {
    const client = fakeClient({ getShipping: async () => { throw new Error('no such provider'); } });
    const result = await getShipping(client, '12', '29');
    expect(result.success).toBe(false);
    expect(result.errorResponse!.content[0].text).toMatch(/no such provider/);
  });
});
