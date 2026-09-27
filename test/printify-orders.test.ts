import { describe, it, expect } from 'vitest';
import { listOrders, getOrder, calculateOrderShipping, createOrder, sendOrderToProduction, cancelOrder } from '../src/services/printify-orders.js';

function fakeClient(overrides: Record<string, any> = {}) {
  return {
    getCurrentShop: () => ({ id: 1, title: 'Test Shop' }),
    listOrders: async () => ({ current_page: 1, data: [] }),
    getOrder: async (id: string) => fakeOrder(id),
    calculateOrderShipping: async () => ({ standard: 499 }),
    ...overrides
  } as any;
}

/** An order as Printify returns one, with the recipient's full contact details. */
function fakeOrder(id = 'ord_1') {
  return {
    id,
    status: 'in-production',
    created_at: '2026-09-01 10:00:00+00:00',
    metadata: { shop_order_label: '#1001' },
    address_to: {
      first_name: 'Ada', last_name: 'Lovelace', email: 'ada@example.test', phone: '555-0100',
      country: 'US', region: 'NY', city: 'Brooklyn', address1: '1 Secret St', zip: '11221'
    },
    line_items: [
      { product_id: 'p1', variant_id: 18100, quantity: 2, cost: 1250, shipping_cost: 450, status: 'in-production',
        metadata: { title: 'Tee', variant_label: 'Black / S', sku: 'SKU-1' } },
      { product_id: 'p2', variant_id: 18101, quantity: 1, cost: 900, shipping_cost: 0, status: 'in-production',
        metadata: { title: 'Mug', variant_label: '11oz', sku: 'SKU-2' } }
    ],
    total_price: 4999,
    total_shipping: 450,
    total_tax: 0,
    shipments: [{ carrier: 'usps', number: '9400', url: 'https://track.test/9400', delivered_at: null }]
  };
}

describe('listOrders', () => {
  it('summarizes each order without the street address or contact details', async () => {
    const client = fakeClient({ listOrders: async () => ({ current_page: 1, data: [fakeOrder()] }) });
    const result = await listOrders(client);
    const text = result.response!.content[0].text;
    expect(text).toContain('"id":"ord_1"');
    expect(text).toContain('"recipient":"Ada Lovelace — Brooklyn, US"');
    expect(text).toContain('"items":3');
    expect(text).toContain('"total":"49.99"');
    expect(text).not.toContain('1 Secret St');
    expect(text).not.toContain('ada@example.test');
    expect(text).not.toContain('555-0100');
  });

  it('passes paging and only the filters that were given', async () => {
    let seen: any;
    const client = fakeClient({ listOrders: async (opts: any) => { seen = opts; return { current_page: 2, data: [] }; } });
    await listOrders(client, { page: 2, limit: 5, status: 'fulfilled' });
    expect(seen).toEqual({ page: 2, limit: 5, status: 'fulfilled' });
  });

  it('requires a selected shop', async () => {
    const client = fakeClient({ getCurrentShop: () => null });
    const result = await listOrders(client);
    expect(result.success).toBe(false);
    expect(result.errorResponse!.content[0].text).toMatch(/No shop is currently selected/);
  });
});

describe('getOrder', () => {
  it('returns the items, amounts, address and tracking', async () => {
    const text = (await getOrder(fakeClient(), 'ord_1')).response!.content[0].text;
    expect(text).toContain('**Status**: "in-production"');
    expect(text).toContain('**Total**: "49.99"');
    expect(text).toContain('**Shipping**: "4.50"');
    expect(text).toContain('"variant":"Black / S"');
    expect(text).toContain('"cost":"12.50"');
    expect(text).toContain('"url":"https://track.test/9400"');
    // One order's address is what get_order is for.
    expect(text).toContain('1 Secret St');
  });

  it('reports a failure without throwing', async () => {
    const client = fakeClient({ getOrder: async () => { throw new Error('order not found'); } });
    const result = await getOrder(client, 'nope');
    expect(result.success).toBe(false);
    expect(result.errorResponse!.content[0].text).toMatch(/order not found/);
  });
});

describe('calculateOrderShipping', () => {
  it('sends the snake_case request with only the given fields', async () => {
    let sent: any;
    const client = fakeClient({ calculateOrderShipping: async (data: any) => { sent = data; return { standard: 499 }; } });
    await calculateOrderShipping(
      client,
      [{ productId: 'p1', variantId: 18100, quantity: 2 }, { sku: 'SKU-2', quantity: 1 }],
      { country: ' us ', zip: '11221' }
    );
    expect(sent).toEqual({
      line_items: [{ product_id: 'p1', variant_id: 18100, quantity: 2 }, { sku: 'SKU-2', quantity: 1 }],
      address_to: { country: 'US', region: '', zip: '11221' }
    });
  });

  it('lists the quoted methods in currency units and skips the missing ones', async () => {
    const client = fakeClient({ calculateOrderShipping: async () => ({ standard: 1000, express: 5000, economy: 399 }) });
    const text = (await calculateOrderShipping(client, [{ sku: 'S', quantity: 3 }], { country: 'BE' })).response!.content[0].text;
    expect(text).toContain('**Rates**: {"Standard":"10.00","Economy":"3.99","Express":"50.00"}');
    expect(text).toContain('**Items**: "3"');
    expect(text).toContain('Nothing was ordered.');
  });

  it('reports a failure without throwing', async () => {
    const client = fakeClient({ calculateOrderShipping: async () => { throw new Error('Printify SDK: 400 Bad Request'); } });
    const result = await calculateOrderShipping(client, [{ sku: 'S', quantity: 1 }], { country: 'US' });
    expect(result.success).toBe(false);
    expect(result.errorResponse!.content[0].text).toMatch(/400 Bad Request/);
  });
});

const ADDRESS = {
  firstName: 'Ada', lastName: 'Lovelace', country: 'us', address1: '1 Main St', city: 'Brooklyn', zip: '11221'
};

describe('createOrder', () => {
  it('sends the snake_case order with standard shipping and a generated external id', async () => {
    let sent: any;
    const client = fakeClient({ createOrder: async (data: any) => { sent = data; return { id: 'ord_9' }; } });
    const result = await createOrder(client, {
      lineItems: [{ productId: 'p1', variantId: 18100, quantity: 2 }],
      address: ADDRESS
    });
    expect(result.success).toBe(true);
    expect(sent).toMatchObject({
      line_items: [{ product_id: 'p1', variant_id: 18100, quantity: 2 }],
      shipping_method: 1,
      is_printify_express: false,
      is_economy_shipping: false,
      send_shipping_notification: false,
      address_to: {
        first_name: 'Ada', last_name: 'Lovelace', country: 'US', region: '',
        address1: '1 Main St', city: 'Brooklyn', zip: '11221'
      }
    });
    expect(sent.external_id).toMatch(/^[0-9a-f-]{36}$/);
    const text = result.response!.content[0].text;
    expect(text).toContain('**Order Id**: "ord_9"');
    expect(text).toContain('nothing has been charged');
  });

  it.each([
    ['priority', 2, false, false],
    ['express', 3, true, false],
    ['economy', 4, false, true]
  ] as const)('maps %s shipping to its code and flags', async (method, code, express, economy) => {
    let sent: any;
    const client = fakeClient({ createOrder: async (data: any) => { sent = data; return { id: 'o' }; } });
    await createOrder(client, { lineItems: [{ sku: 'S', quantity: 1 }], address: ADDRESS, shippingMethod: method });
    expect(sent.shipping_method).toBe(code);
    expect(sent.is_printify_express).toBe(express);
    expect(sent.is_economy_shipping).toBe(economy);
  });

  it('keeps a caller-supplied external id and label', async () => {
    let sent: any;
    const client = fakeClient({ createOrder: async (data: any) => { sent = data; return { id: 'o' }; } });
    await createOrder(client, { lineItems: [{ sku: 'S', quantity: 1 }], address: ADDRESS, externalId: 'shop-42', label: '#42' });
    expect(sent.external_id).toBe('shop-42');
    expect(sent.label).toBe('#42');
  });

  it('passes print areas for an item that is not a saved product', async () => {
    let sent: any;
    const client = fakeClient({ createOrder: async (data: any) => { sent = data; return { id: 'o' }; } });
    await createOrder(client, {
      lineItems: [{ printProviderId: 5, blueprintId: 9, variantId: 17887, printAreas: { front: 'https://img.test/a.png' }, quantity: 1 }],
      address: ADDRESS
    });
    expect(sent.line_items).toEqual([
      { print_provider_id: 5, blueprint_id: 9, variant_id: 17887, print_areas: { front: 'https://img.test/a.png' }, quantity: 1 }
    ]);
  });

  it('reports a failure without throwing', async () => {
    const client = fakeClient({ createOrder: async () => { throw new Error('Printify SDK: 400 Bad Request'); } });
    const result = await createOrder(client, { lineItems: [{ sku: 'S', quantity: 1 }], address: ADDRESS });
    expect(result.success).toBe(false);
    expect(result.errorResponse!.content[0].text).toMatch(/400 Bad Request/);
  });
});

describe('sendOrderToProduction and cancelOrder', () => {
  it('sends an order to production and says the account is charged', async () => {
    const client = fakeClient({ sendOrderToProduction: async (id: string) => ({ id, status: 'sending-to-production' }) });
    const text = (await sendOrderToProduction(client, 'ord_1')).response!.content[0].text;
    expect(text).toContain('**Order Id**: "ord_1"');
    expect(text).toContain('charge the account');
  });

  it('cancels an order', async () => {
    const client = fakeClient({ cancelOrder: async (id: string) => ({ id, status: 'canceled' }) });
    const text = (await cancelOrder(client, 'ord_1')).response!.content[0].text;
    expect(text).toContain('**Status**: "canceled"');
  });

  it('explains which orders can be cancelled when it fails', async () => {
    const client = fakeClient({ cancelOrder: async () => { throw new Error('Printify SDK: 400 Bad Request'); } });
    const result = await cancelOrder(client, 'ord_1');
    expect(result.success).toBe(false);
    expect(result.errorResponse!.content[0].text).toContain('on hold or awaiting payment');
  });
});
