/**
 * Printify orders service: reading, quoting, placing and cancelling orders.
 */
import { randomUUID } from 'crypto';
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

interface NewOrderItem {
  productId?: string;
  variantId?: number;
  printProviderId?: number;
  blueprintId?: number;
  /** Position (front, back, ...) to image URL, for an item not saved as a product. */
  printAreas?: Record<string, string>;
  sku?: string;
  quantity: number;
}

interface OrderAddress extends ShippingQuoteAddress {
  firstName: string;
  lastName: string;
  address1: string;
  city: string;
  zip: string;
  company?: string;
}

type ShippingMethod = 'standard' | 'priority' | 'express' | 'economy';

/**
 * Printify's shipping_method codes. Express and economy also need their
 * matching flag set, or the API rejects the order.
 */
const SHIPPING_METHOD_CODES: Record<ShippingMethod, { code: number; express: boolean; economy: boolean }> = {
  standard: { code: 1, express: false, economy: false },
  priority: { code: 2, express: false, economy: false },
  express: { code: 3, express: true, economy: false },
  economy: { code: 4, express: false, economy: true }
};

export async function createOrder(
  printifyClient: PrintifyAPI,
  input: {
    lineItems: NewOrderItem[];
    address: OrderAddress;
    shippingMethod?: ShippingMethod;
    externalId?: string;
    label?: string;
    sendShippingNotification?: boolean;
  }
) {
  return runService(
    'Create Order',
    {
      context: () => ({ Country: input.address?.country, Items: input.lineItems?.length ?? 0 }),
      tips: [
        'Identify each item by productId + variantId, by printProviderId + blueprintId + variantId with printAreas, or by sku',
        'The address needs a name, street, city, zip and country',
        TIPS.apiKey,
        TIPS.shop
      ]
    },
    async () => {
      requireShop(printifyClient);
      const method = SHIPPING_METHOD_CODES[input.shippingMethod ?? 'standard'];
      // The API requires external_id (the order's id in the caller's own
      // system); callers without one get a generated id.
      const externalId = input.externalId ?? randomUUID();

      const created: any = await printifyClient.createOrder({
        external_id: externalId,
        ...(input.label ? { label: input.label } : {}),
        line_items: input.lineItems.map((item) => compact({
          product_id: item.productId,
          variant_id: item.variantId,
          print_provider_id: item.printProviderId,
          blueprint_id: item.blueprintId,
          print_areas: item.printAreas,
          sku: item.sku,
          quantity: item.quantity
        })),
        shipping_method: method.code,
        is_printify_express: method.express,
        is_economy_shipping: method.economy,
        send_shipping_notification: input.sendShippingNotification ?? false,
        address_to: compact({
          first_name: input.address.firstName,
          last_name: input.address.lastName,
          email: input.address.email,
          phone: input.address.phone,
          country: input.address.country.trim().toUpperCase(),
          region: input.address.region ?? '',
          address1: input.address.address1,
          address2: input.address.address2,
          city: input.address.city,
          zip: input.address.zip,
          company: input.address.company
        })
      });

      return {
        order: created,
        response: formatSuccessResponse(
          'Order Created (On Hold)',
          {
            'Order Id': created?.id,
            'External Id': externalId,
            'Shipping Method': input.shippingMethod ?? 'standard',
            Items: input.lineItems.reduce((n, item) => n + item.quantity, 0)
          },
          'The order is on hold and nothing has been charged. Review it with get_order, then ' +
          'send_order_to_production to have it printed, or cancel_order to drop it.'
        )
      };
    }
  );
}

export async function sendOrderToProduction(printifyClient: PrintifyAPI, orderId: string) {
  return runService(
    'Send Order To Production',
    {
      context: () => ({ OrderId: orderId, Shop: printifyClient.getCurrentShop() }),
      tips: ['Only an on-hold order can be sent to production', 'Check the order with get_order', TIPS.shop]
    },
    async () => {
      requireShop(printifyClient);
      const result: any = await printifyClient.sendOrderToProduction(orderId);
      return {
        result,
        response: formatSuccessResponse(
          'Order Sent To Production',
          { 'Order Id': result?.id ?? orderId, Status: result?.status ?? 'sending-to-production' },
          'Printify will charge the account and start printing. Track it with get_order.'
        )
      };
    }
  );
}

export async function cancelOrder(printifyClient: PrintifyAPI, orderId: string) {
  return runService(
    'Cancel Order',
    {
      context: () => ({ OrderId: orderId, Shop: printifyClient.getCurrentShop() }),
      tips: [
        'Only orders that are on hold or awaiting payment can be cancelled here',
        'Orders already in production must be cancelled through Printify support',
        TIPS.shop
      ]
    },
    async () => {
      requireShop(printifyClient);
      const result: any = await printifyClient.cancelOrder(orderId);
      return {
        result,
        response: formatSuccessResponse(
          'Order Cancelled',
          { 'Order Id': result?.id ?? orderId, Status: result?.status ?? 'canceled' }
        )
      };
    }
  );
}
