/**
 * Printify orders service: reading orders and quoting shipping.
 */
import { PrintifyAPI, requireShop } from '../printify-api.js';
import { formatSuccessResponse, runService, TIPS } from '../utils/error-handler.js';

/** "25.00" from an amount in cents; Printify reports order money in cents. */
function fromCents(cents: unknown): string | undefined {
  return typeof cents === 'number' ? (cents / 100).toFixed(2) : undefined;
}

/** A recipient's name and destination, without the street address or contact details. */
function recipientSummary(address: any): string | undefined {
  const name = [address?.first_name, address?.last_name].filter(Boolean).join(' ');
  const place = [address?.city, address?.country].filter(Boolean).join(', ');
  const parts = [name, place].filter(Boolean);
  return parts.length > 0 ? parts.join(' — ') : undefined;
}

/**
 * The fields a caller needs to pick an order out of a list. Street addresses,
 * emails and phone numbers stay out of the list; get_order returns them for
 * one order when they are actually needed.
 */
function orderSummary(order: any) {
  return {
    id: order.id,
    status: order.status,
    createdAt: order.created_at,
    shopOrderLabel: order.metadata?.shop_order_label,
    recipient: recipientSummary(order.address_to),
    items: (order.line_items ?? []).reduce((n: number, item: any) => n + (item.quantity ?? 0), 0),
    total: fromCents(order.total_price)
  };
}

export async function listOrders(
  printifyClient: PrintifyAPI,
  options: { page?: number; limit?: number; status?: string; sku?: string } = {}
) {
  return runService(
    'List Orders',
    {
      context: () => ({
        Shop: printifyClient.getCurrentShop(),
        Page: options.page,
        Limit: options.limit,
        ...(options.status ? { Status: options.status } : {}),
        ...(options.sku ? { Sku: options.sku } : {})
      }),
      tips: [TIPS.apiKey, TIPS.connected, TIPS.shop]
    },
    async () => {
      const currentShop = requireShop(printifyClient);
      const page = options.page || 1;
      const limit = options.limit || 10;
      const orders = await printifyClient.listOrders({
        page,
        limit,
        ...(options.status ? { status: options.status } : {}),
        ...(options.sku ? { sku: options.sku } : {})
      });
      const data = Array.isArray(orders?.data) ? orders.data : [];

      return {
        orders,
        response: formatSuccessResponse(
          'Orders Retrieved Successfully',
          {
            Shop: currentShop,
            Page: orders?.current_page ?? page,
            ...(orders?.last_page ? { PageCount: orders.last_page } : {}),
            ...(typeof orders?.total === 'number' ? { Total: orders.total } : {}),
            Limit: limit,
            ...(options.status ? { Status: options.status } : {}),
            ...(options.sku ? { Sku: options.sku } : {}),
            Count: data.length,
            Orders: data.map(orderSummary)
          },
          'Totals are converted from cents. Use get_order for an order\'s items, shipping address and tracking.'
        )
      };
    }
  );
}

export async function getOrder(printifyClient: PrintifyAPI, orderId: string) {
  return runService(
    'Get Order',
    {
      context: () => ({ OrderId: orderId, Shop: printifyClient.getCurrentShop() }),
      tips: ['Check that the order ID is valid and belongs to the current shop', TIPS.apiKey, TIPS.shop]
    },
    async () => {
      requireShop(printifyClient);
      const order: any = await printifyClient.getOrder(orderId);

      const lineItems = (order?.line_items ?? []).map((item: any) => ({
        productId: item.product_id,
        variantId: item.variant_id,
        title: item.metadata?.title,
        variant: item.metadata?.variant_label,
        sku: item.metadata?.sku,
        quantity: item.quantity,
        status: item.status,
        cost: fromCents(item.cost),
        shippingCost: fromCents(item.shipping_cost)
      }));

      const shipments = (order?.shipments ?? []).map((shipment: any) => ({
        carrier: shipment.carrier,
        number: shipment.number,
        url: shipment.url,
        deliveredAt: shipment.delivered_at
      }));

      return {
        order,
        response: formatSuccessResponse(
          'Order Details',
          {
            Id: order?.id,
            Status: order?.status,
            'Created At': order?.created_at,
            ...(order?.sent_to_production_at ? { 'Sent To Production At': order.sent_to_production_at } : {}),
            ...(order?.fulfilled_at ? { 'Fulfilled At': order.fulfilled_at } : {}),
            ...(order?.metadata?.shop_order_label ? { 'Shop Order': order.metadata.shop_order_label } : {}),
            Total: fromCents(order?.total_price),
            Shipping: fromCents(order?.total_shipping),
            Tax: fromCents(order?.total_tax),
            'Ship To': order?.address_to,
            Items: lineItems,
            Shipments: shipments
          },
          'Amounts are converted from cents.'
        )
      };
    }
  );
}

interface ShippingQuoteItem {
  productId?: string;
  variantId?: number;
  printProviderId?: number;
  blueprintId?: number;
  sku?: string;
  quantity: number;
}

interface ShippingQuoteAddress {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  country: string;
  region?: string;
  address1?: string;
  address2?: string;
  city?: string;
  zip?: string;
}

/** Drop undefined fields so the request carries only what the caller gave. */
function compact<T extends Record<string, any>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** Labels for the shipping methods Printify quotes, in the order to show them. */
const SHIPPING_METHODS: Array<[string, string]> = [
  ['standard', 'Standard'],
  ['economy', 'Economy'],
  ['express', 'Express'],
  ['priority', 'Priority'],
  ['printify_express', 'Printify Express']
];

export async function calculateOrderShipping(
  printifyClient: PrintifyAPI,
  lineItems: ShippingQuoteItem[],
  address: ShippingQuoteAddress
) {
  return runService(
    'Calculate Order Shipping',
    {
      context: () => ({ Country: address?.country, Items: lineItems?.length ?? 0 }),
      tips: [
        'Identify each item by productId + variantId, by printProviderId + blueprintId + variantId, or by sku',
        'Printify may require the full recipient address (name, email, phone, street, city, region, zip, country)',
        TIPS.apiKey,
        TIPS.shop
      ]
    },
    async () => {
      requireShop(printifyClient);
      const quote: any = await printifyClient.calculateOrderShipping({
        line_items: lineItems.map((item) => compact({
          product_id: item.productId,
          variant_id: item.variantId,
          print_provider_id: item.printProviderId,
          blueprint_id: item.blueprintId,
          sku: item.sku,
          quantity: item.quantity
        })),
        address_to: compact({
          first_name: address.firstName,
          last_name: address.lastName,
          email: address.email,
          phone: address.phone,
          country: address.country.trim().toUpperCase(),
          region: address.region ?? '',
          address1: address.address1,
          address2: address.address2,
          city: address.city,
          zip: address.zip
        })
      });

      // A method the destination or items don't support comes back missing.
      const rates = Object.fromEntries(
        SHIPPING_METHODS
          .filter(([key]) => typeof quote?.[key] === 'number')
          .map(([key, label]) => [label, fromCents(quote[key])])
      );

      return {
        quote,
        response: formatSuccessResponse(
          'Shipping Quote',
          {
            Country: address.country.trim().toUpperCase(),
            Items: lineItems.reduce((n, item) => n + item.quantity, 0),
            Rates: rates
          },
          'Rates are for the whole order, converted from cents. Nothing was ordered.'
        )
      };
    }
  );
}
