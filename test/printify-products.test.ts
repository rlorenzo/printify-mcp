import { describe, it, expect, vi } from 'vitest';
import { listProducts } from '../src/services/printify-products.js';

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
