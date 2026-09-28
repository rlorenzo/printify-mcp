import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { harness, fakePrintify } from './helpers/harness.js';

/**
 * Characterization tests: they pin the CURRENT observable behaviour of the
 * duplicated code paths so the duplication can be extracted without changing
 * what callers see. They assert what the code does, not what it should do.
 */

// Every tool that unwraps a { success, response, errorResponse } service result
// through the same copy-pasted if/else.
const UNWRAPPING_TOOLS = [
  'list_products', 'get_product', 'delete_product', 'publish_product',
  'get_blueprints', 'get_blueprint', 'get_print_providers', 'get_variants'
];

describe('client guard (14 duplicated call sites)', () => {
  const NEEDS_CLIENT = [
    'get_printify_status', 'list_shops', 'switch_shop', 'list_products',
    'get_product', 'create_product', 'update_product', 'delete_product',
    'publish_product', 'get_blueprints', 'get_blueprint', 'get_print_providers',
    'get_variants', 'upload_image'
  ];

  it.each(NEEDS_CLIENT)('%s reports an uninitialized client identically', async (name) => {
    const h = harness({ printifyClient: null });
    const res = await h.call(name, {});
    expect(res.isError).toBe(true);
    expect(res.content[0].type).toBe('text');
    expect(res.content[0].text).toContain('Printify API client is not initialized');
    // Both configuration paths must be named; the env var is not the only one.
    expect(res.content[0].text).toContain('PRINTIFY_API_KEY');
    expect(res.content[0].text).toContain('createPrintifyMcpServer');
  });
});

describe('service result unwrapping (duplicated if/else)', () => {
  it.each(UNWRAPPING_TOOLS)('%s returns the service response on success', async (name) => {
    const h = harness({ printifyClient: fakePrintify() });
    const res = await h.call(name, { productId: 'p1', blueprintId: 1, printProviderId: 2 });
    // An MCP error response also carries text content, so the success shape is
    // only meaningful alongside isError being falsy.
    expect(res.isError, `${name} returned an error: ${res.content?.[0]?.text}`).toBeFalsy();
    expect(res).toHaveProperty('content');
    expect(Array.isArray(res.content)).toBe(true);
    expect(res.content[0]).toHaveProperty('type', 'text');
  });

  it.each(UNWRAPPING_TOOLS)('%s surfaces a service failure as isError', async (name) => {
    const boom = async () => { throw new Error('upstream exploded'); };
    const h = harness({
      printifyClient: fakePrintify({
        getProducts: boom, getProduct: boom, deleteProduct: boom, publishProduct: boom,
        getBlueprints: boom, getBlueprint: boom, getPrintProviders: boom, getVariants: boom
      })
    });
    const res = await h.call(name, { productId: 'p1', blueprintId: 1, printProviderId: 2 });
    expect(res.isError).toBe(true);
    expect(res.content[0].type).toBe('text');
  });
});

describe('image tool schemas (31-line duplicated schema)', () => {
  // The two generation tools share every option but their destination field.
  const SHARED = ['prompt', 'model', 'width', 'height', 'aspectRatio', 'outputFormat', 'safetyTolerance'];

  it('both tools expose the shared generation options', () => {
    const h = harness();
    for (const tool of ['generate_and_upload_image', 'generate_image']) {
      const shape = h.schema(tool);
      expect(shape, `${tool} has no schema`).toBeTruthy();
      for (const key of SHARED) {
        expect(Object.keys(shape), `${tool} missing ${key}`).toContain(key);
      }
    }
  });

  // Regression: width/height carried a zod .default(1024), so the MCP runtime
  // injected dimensions the caller never asked for and mergeGenerationOptions
  // then discarded any configured aspectRatio. The harness calls the raw
  // handler, so only parsing through the schema catches this.
  it('leaves width and height absent when the caller omits them', () => {
    const h = harness();
    for (const tool of ['generate_and_upload_image', 'generate_image']) {
      const parsed = z.object(h.schema(tool))
        .parse({ prompt: 'a cat', fileName: 'c', outputPath: '/tmp/c.png' });
      expect(parsed.width, `${tool} injected a width`).toBeUndefined();
      expect(parsed.height, `${tool} injected a height`).toBeUndefined();
    }
  });

  it('differs only in the destination field', () => {
    const h = harness();
    const upload = Object.keys(h.schema('generate_and_upload_image'));
    const local = Object.keys(h.schema('generate_image'));
    expect(upload.filter((k) => !local.includes(k))).toEqual(['fileName']);
    expect(local.filter((k) => !upload.includes(k))).toEqual(['outputPath']);
  });

  it('reports an uninitialized Replicate client for both', async () => {
    const h = harness({ printifyClient: fakePrintify(), replicateClient: null });
    for (const tool of ['generate_and_upload_image', 'generate_image']) {
      const res = await h.call(tool, { prompt: 'a cat', fileName: 'c', outputPath: '/tmp/c.png' });
      expect(res.isError, `${tool} should error`).toBe(true);
      expect(res.content[0].text).toMatch(/Replicate/i);
    }
  });
});

describe('tool surface', () => {
  it('registers exactly the expected tools', () => {
    expect(harness().names()).toHaveLength(28);
  });
});

describe('test harness', () => {
  // A misspelled tool name should fail loudly and say so, not as a TypeError
  // from reading the schema of a tool that isn't there.
  it('rejects an unknown tool name in callParsed', async () => {
    await expect(harness({}).callParsed('no_such_tool')).rejects.toThrow(/no such tool: no_such_tool/);
  });
});

describe('order tools', () => {
  it('calculate_order_shipping validates and forwards the items and address', async () => {
    let sent: any;
    const h = harness({
      printifyClient: fakePrintify({ calculateOrderShipping: async (data: any) => { sent = data; return { standard: 500 }; } })
    });
    const res = await h.callParsed('calculate_order_shipping', {
      lineItems: [{ productId: 'p1', variantId: 1, quantity: 1 }],
      address: { country: 'US', zip: '10001' }
    });
    expect(res.isError).toBeFalsy();
    expect(sent.address_to).toEqual({ country: 'US', region: '', zip: '10001' });
  });

  it('calculate_order_shipping rejects an empty item list at the schema', async () => {
    const h = harness({ printifyClient: fakePrintify() });
    await expect(h.callParsed('calculate_order_shipping', { lineItems: [], address: { country: 'US' } })).rejects.toThrow();
  });

  it.each(['list_orders', 'get_order', 'calculate_order_shipping'])('%s needs the Printify client', async (name) => {
    const res = await harness({ printifyClient: null }).call(name, {});
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('Printify API client is not initialized');
  });
});

describe('catalog provider and shipping tools', () => {
  it('get_shipping passes the ids and country through to the client', async () => {
    const calls: any[] = [];
    const h = harness({
      printifyClient: fakePrintify({
        getShipping: async (...args: any[]) => { calls.push(args); return { handling_time: { value: 1, unit: 'day' }, profiles: [] }; }
      })
    });
    const res = await h.callParsed('get_shipping', { blueprintId: '12', printProviderId: '29', country: 'US' });
    expect(res.isError).toBeFalsy();
    expect(res.content[0].text).toContain('**Country**: "US"');
    expect(calls).toEqual([['12', '29']]);
  });

  it.each(['list_all_print_providers', 'get_print_provider', 'get_shipping'])('%s needs the Printify client', async (name) => {
    const res = await harness({ printifyClient: null }).call(name, {});
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('Printify API client is not initialized');
  });
});

describe('how_to_use orders', () => {
  it('serves the orders guide', async () => {
    const res = await harness().call('how_to_use', { topic: 'orders' });
    expect(res.isError).toBeFalsy();
    expect(res.content[0].text).toContain('calculate_order_shipping');
  });
});

describe('order change tools', () => {
  // Sending to production spends money, so it takes an explicit confirmation.
  it('send_order_to_production requires confirm: true', async () => {
    const sent: string[] = [];
    const h = harness({
      printifyClient: fakePrintify({ sendOrderToProduction: async (id: string) => { sent.push(id); return { id }; } })
    });
    await expect(h.callParsed('send_order_to_production', { orderId: 'o1' })).rejects.toThrow();
    await expect(h.callParsed('send_order_to_production', { orderId: 'o1', confirm: false })).rejects.toThrow();
    expect(sent).toEqual([]);
    const res = await h.callParsed('send_order_to_production', { orderId: 'o1', confirm: true });
    expect(res.isError).toBeFalsy();
    expect(sent).toEqual(['o1']);
  });

  it('create_order requires the full shipping address', async () => {
    const h = harness({ printifyClient: fakePrintify({ createOrder: async () => ({ id: 'o' }) }) });
    await expect(h.callParsed('create_order', {
      lineItems: [{ sku: 'S', quantity: 1 }],
      address: { country: 'US', zip: '10001' }
    })).rejects.toThrow();
  });

  it('marks sending to production and cancelling as destructive', () => {
    const tools = (harness() as any).server._registeredTools;
    expect(tools.send_order_to_production.annotations.destructiveHint).toBe(true);
    expect(tools.cancel_order.annotations.destructiveHint).toBe(true);
  });
});

describe('create_order shipping methods', () => {
  // Code 3 is Printify Express; a bare "express" would be confused with the
  // separate Express rate that calculate_order_shipping quotes.
  it('accepts printify_express and rejects a bare express', async () => {
    let sent: any;
    const h = harness({ printifyClient: fakePrintify({ createOrder: async (data: any) => { sent = data; return { id: 'o' }; } }) });
    const address = { firstName: 'A', lastName: 'B', address1: '1 St', city: 'C', zip: '1', country: 'US' };
    await expect(h.callParsed('create_order', { lineItems: [{ sku: 'S', quantity: 1 }], address, shippingMethod: 'express' })).rejects.toThrow();
    const res = await h.callParsed('create_order', { lineItems: [{ sku: 'S', quantity: 1 }], address, shippingMethod: 'printify_express' });
    expect(res.isError).toBeFalsy();
    expect(sent.shipping_method).toBe(3);
    expect(sent.is_printify_express).toBe(true);
  });
});

describe('list_orders paging', () => {
  // Negative or fractional values would otherwise reach the Printify API.
  it.each([{ page: 0 }, { page: -1 }, { page: 1.5 }, { limit: 0 }, { limit: -5 }, { limit: 2.5 }])(
    'rejects %j at the schema', async (args) => {
      const h = harness({ printifyClient: fakePrintify() });
      await expect(h.callParsed('list_orders', args)).rejects.toThrow();
    });

  it('accepts positive integers', async () => {
    let seen: any;
    const h = harness({ printifyClient: fakePrintify({ listOrders: async (opts: any) => { seen = opts; return { data: [] }; } }) });
    const res = await h.callParsed('list_orders', { page: 2, limit: 5 });
    expect(res.isError).toBeFalsy();
    expect(seen).toEqual({ page: 2, limit: 5 });
  });
});

describe('get_variants showOutOfStock', () => {
  it('passes the flag from the tool arguments to the client', async () => {
    const calls: any[] = [];
    const h = harness({
      printifyClient: fakePrintify({
        getVariants: async (...args: any[]) => { calls.push(args); return { variants: [] }; }
      })
    });
    const res = await h.callParsed('get_variants', { blueprintId: '12', printProviderId: '29', showOutOfStock: true });
    expect(res.isError).toBeFalsy();
    expect(calls).toEqual([['12', '29', { showOutOfStock: true }]]);
  });
});
