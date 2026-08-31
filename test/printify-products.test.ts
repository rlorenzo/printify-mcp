import { describe, it, expect, vi } from 'vitest';
import { listProducts, getProduct } from '../src/services/printify-products.js';

function fakeClient(overrides: Record<string, any> = {}) {
  return {
    getCurrentShop: () => ({ id: 1, title: 'Test Shop' }),
    getProducts: vi.fn(async () => ({ data: [{ id: 'p1', title: 'One' }, { id: 'p2', title: 'Two' }] })),
    ...overrides
  } as any;
}

describe('listProducts', () => {
  // Regression: arguments were passed as (limit, page) to a (page, limit)
  // signature, silently inverting pagination.
  it('passes page and limit to the client in that order', async () => {
    const client = fakeClient();
    await listProducts(client, { limit: 25, page: 3 });
    expect(client.getProducts).toHaveBeenCalledWith(3, 25);
  });

  it('defaults to page 1 and limit 10', async () => {
    const client = fakeClient();
    await listProducts(client, {});
    expect(client.getProducts).toHaveBeenCalledWith(1, 10);
  });

  // Regression: the Printify SDK returns a paginated { data: [...] } envelope,
  // so reading .length off it always yielded undefined.
  it('counts products from the paginated data envelope', async () => {
    const result = await listProducts(fakeClient(), {});
    expect(result.success).toBe(true);
    expect(result.response.content[0].text).toContain('**Count**: "2"');
  });

  it('reports zero rather than undefined when the envelope is empty', async () => {
    const client = fakeClient({ getProducts: vi.fn(async () => ({ data: [] })) });
    const result = await listProducts(client, {});
    expect(result.response.content[0].text).toContain('**Count**: "0"');
    expect(result.response.content[0].text).not.toContain('undefined');
  });

  it('tolerates a response with no data key', async () => {
    const client = fakeClient({ getProducts: vi.fn(async () => ({})) });
    const result = await listProducts(client, {});
    expect(result.response.content[0].text).toContain('**Count**: "0"');
  });

  it('fails when no shop is selected', async () => {
    const client = fakeClient({ getCurrentShop: () => null });
    const result = await listProducts(client, {});
    expect(result.success).toBe(false);
  });
});

function fakeProduct(overrides: Record<string, any> = {}) {
  return {
    id: 'prod1',
    title: 'Test Product',
    description: 'A test product description.',
    tags: ['test-tag', 'sample'],
    blueprint_id: 1,
    print_provider_id: 2,
    visible: true,
    is_locked: false,
    created_at: '2026-08-01 10:00:00+00:00',
    updated_at: '2026-08-30 10:00:00+00:00',
    variants: [
      { id: 101, title: 'Variant A', price: 1000, cost: 400, is_enabled: true },
      { id: 102, title: 'Variant B', price: 1000, cost: 400, is_enabled: true },
      { id: 103, title: 'Variant C', price: 2000, cost: 900, is_enabled: false }
    ],
    print_areas: [
      {
        variant_ids: [101, 102],
        placeholders: [
          {
            position: 'front',
            images: [{ id: 'img1', name: 'front.png', x: 0.5, y: 0.5, scale: 0.9, angle: 0 }]
          }
        ]
      }
    ],
    external: { id: 'ext1', handle: 'test-product' },
    ...overrides
  };
}

function productClient(product: any = fakeProduct(), overrides: Record<string, any> = {}) {
  return fakeClient({ getProduct: vi.fn(async () => product), ...overrides });
}

describe('getProduct', () => {
  // Regression: the service fetched the full record, then built a response
  // carrying only ProductId/Title/Shop, so nothing else ever reached the caller.
  it('includes the description, tags and catalog ids', async () => {
    const result = await getProduct(productClient(), 'prod1');
    const text = result.response.content[0].text;
    expect(text).toContain('A test product description.');
    expect(text).toContain('"test-tag"');
    expect(text).toContain('**BlueprintId**: "1"');
    expect(text).toContain('**PrintProviderId**: "2"');
  });

  it('lists enabled variants with their ids, prices and costs', async () => {
    const result = await getProduct(productClient(), 'prod1');
    const text = result.response.content[0].text;
    expect(text).toContain('101');
    expect(text).toContain('1000');
    expect(text).toContain('400');
  });

  it('excludes disabled variants but still counts them', async () => {
    const result = await getProduct(productClient(), 'prod1');
    const text = result.response.content[0].text;
    expect(text).toContain('**VariantCount**: "3"');
    expect(text).toContain('**EnabledCount**: "2"');
    expect(text).not.toContain('103');
  });

  // A print area can override the artwork for one colorway. Reporting only a
  // count leaves that override untraceable to the colors it applies to.
  it('names the enabled variants each print area covers', async () => {
    const result = await getProduct(productClient(), 'prod1');
    const text = result.response.content[0].text;
    expect(text).toContain('"title":"Variant A"');
    expect(text).toContain('"title":"Variant B"');
  });

  it('omits disabled variants from a print area listing', async () => {
    const product = fakeProduct({
      print_areas: [{
        variant_ids: [101, 103],
        placeholders: [{ position: 'front', images: [] }]
      }]
    });
    const result = await getProduct(productClient(product), 'prod1');
    const text = result.response.content[0].text;
    expect(text).toContain('**VariantCount**: "3"');
    expect(text).toContain('"id":101');
    expect(text).not.toContain('"id":103');
  });

  // Printify omits keys rather than sending empty values, so a default of
  // false would report an absent `visible` as a hidden listing.
  it('distinguishes an absent flag from a false one', async () => {
    const absent = await getProduct(productClient({ id: 'p', title: 'T' }), 'p');
    expect(absent.response.content[0].text).toContain('**Visible**: null');
    expect(absent.response.content[0].text).toContain('**Locked**: null');

    const hidden = await getProduct(productClient(fakeProduct({ visible: false })), 'prod1');
    expect(hidden.response.content[0].text).toContain('**Visible**: "false"');
  });

  it('reports an absent timestamp as null rather than empty', async () => {
    const result = await getProduct(productClient({ id: 'p', title: 'T' }), 'p');
    expect(result.response.content[0].text).toContain('**CreatedAt**: null');
  });

  it('surfaces print area image ids and placement', async () => {
    const result = await getProduct(productClient(), 'prod1');
    const text = result.response.content[0].text;
    expect(text).toContain('"id":"img1"');
    expect(text).toContain('"position":"front"');
    expect(text).toContain('"scale":0.9');
  });

  it('keeps the original ProductId, Title and Shop fields', async () => {
    const result = await getProduct(productClient(), 'prod1');
    const text = result.response.content[0].text;
    expect(text).toContain('**ProductId**: "prod1"');
    expect(text).toContain('Test Product');
    expect(text).toContain('Test Shop');
  });

  // Printify omits keys on some products, and formatFields renders a missing
  // value as the literal string "undefined". The fixture carries only an id so
  // that every field the response emits, title included, has to be guarded.
  it('emits no "undefined" for a sparse record', async () => {
    const sparse = { id: 'prod2' };
    const result = await getProduct(productClient(sparse), 'prod2');
    expect(result.response.content[0].text).not.toContain('undefined');
  });

  it('fails when no shop is selected', async () => {
    const client = productClient(fakeProduct(), { getCurrentShop: () => null });
    const result = await getProduct(client, 'prod1');
    expect(result.success).toBe(false);
  });
});
