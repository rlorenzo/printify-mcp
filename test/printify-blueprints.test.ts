import { describe, it, expect } from 'vitest';
import { getBlueprints, getVariants } from '../src/services/printify-blueprints.js';

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
