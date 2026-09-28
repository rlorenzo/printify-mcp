/**
 * Printify products service.
 */
import { PrintifyAPI, requireShop } from '../printify-api.js';
import { formatSuccessResponse, runService, TIPS } from '../utils/error-handler.js';

interface ProductVariantInput {
  variantId: number;
  price: number;
  isEnabled?: boolean;
}

interface PrintAreaPlaceholderInput {
  position: string;
  imageId: string;
}

/**
 * One entry per placement, applied to every variant. The key is only the
 * caller's label; the placement comes from each value's `position`.
 */
type FlatPrintAreas = Record<string, PrintAreaPlaceholderInput>;

/** Placements scoped to explicit variants, for per-colorway artwork. */
interface PrintAreaGroupInput {
  variantIds: number[];
  placeholders: PrintAreaPlaceholderInput[];
}

type ProductPrintAreas = FlatPrintAreas | PrintAreaGroupInput[];

interface UpdateProductData {
  title?: string;
  description?: string;
  variants?: ProductVariantInput[];
  printAreas?: ProductPrintAreas;
  tags?: string[];
}

interface CreateProductData extends UpdateProductData {
  title: string;
  description: string;
  blueprintId: number;
  printProviderId: number;
  variants: ProductVariantInput[];
}

export async function listProducts(
  printifyClient: PrintifyAPI,
  options: {
    limit?: number;
    page?: number;
  } = {}
) {
  return runService(
    'List Products',
    {
      context: () => ({ Shop: printifyClient.getCurrentShop(), Limit: options.limit, Page: options.page }),
      tips: [TIPS.apiKey, TIPS.connected, TIPS.shop]
    },
    async () => {
      const currentShop = requireShop(printifyClient);
      const limit = options.limit || 10;
      const page = options.page || 1;
      const products = await printifyClient.getProducts(page, limit);

      return {
        products,
        response: formatSuccessResponse(
          'Products Retrieved Successfully',
          {
            Count: products.data?.length ?? 0,
            Page: page,
            Limit: limit,
            Shop: currentShop,
            Products: (products.data ?? []).map((p: any) => ({ id: p.id, title: p.title }))
          }
        )
      };
    }
  );
}

export async function getProduct(
  printifyClient: PrintifyAPI,
  productId: string
) {
  return runService(
    'Get Product',
    {
      context: () => ({ ProductId: productId, Shop: printifyClient.getCurrentShop() }),
      tips: ['Check that the product ID is valid', TIPS.connected, TIPS.shop]
    },
    async () => {
      const currentShop = requireShop(printifyClient);
      const product = await printifyClient.getProduct(productId);

      const variants: any[] = product.variants ?? [];
      const enabled = variants.filter((v: any) => v.is_enabled);
      const enabledById = new Map<number, any>(enabled.map((v: any) => [v.id, v]));

      return {
        product,
        response: formatSuccessResponse(
          'Product Retrieved Successfully',
          {
            ProductId: productId,
            Title: product.title ?? '',
            Shop: currentShop,
            Description: product.description ?? '',
            Tags: product.tags ?? [],
            BlueprintId: product.blueprint_id ?? null,
            PrintProviderId: product.print_provider_id ?? null,
            // null rather than false/'' where Printify omitted the key: an
            // absent `visible` does not mean the listing is hidden.
            Visible: product.visible ?? null,
            Locked: product.is_locked ?? null,
            CreatedAt: product.created_at ?? null,
            UpdatedAt: product.updated_at ?? null,
            VariantCount: variants.length,
            EnabledCount: enabled.length,
            // Enabled variants only: all of them can exceed the MCP output limit.
            Variants: enabled.map((v: any) => ({
              id: v.id,
              title: v.title,
              price: v.price,
              cost: v.cost
            })),
            PrintAreas: (product.print_areas ?? []).map((area: any) => ({
              variantCount: (area.variant_ids ?? []).length,
              // Named enabled ids, so per-colorway artwork can be traced.
              enabledVariants: (area.variant_ids ?? [])
                .filter((id: number) => enabledById.has(id))
                .map((id: number) => ({ id, title: enabledById.get(id)?.title })),
              placeholders: (area.placeholders ?? []).map((ph: any) => ({
                position: ph.position,
                images: (ph.images ?? []).map((img: any) => ({
                  id: img.id,
                  name: img.name,
                  x: img.x,
                  y: img.y,
                  scale: img.scale,
                  angle: img.angle
                }))
              }))
            })),
            SalesChannel: product.external ?? null
          }
        )
      };
    }
  );
}

export async function createProduct(
  printifyClient: PrintifyAPI,
  productData: CreateProductData
) {
  return runService(
    'Create Product',
    {
      context: () => ({
        Title: productData.title,
        BlueprintId: productData.blueprintId,
        PrintProviderId: productData.printProviderId,
        VariantsCount: productData.variants.length,
        Shop: printifyClient.getCurrentShop()
      }),
      tips: [
        'Check that the blueprint ID is valid',
        'Check that the print provider ID is valid',
        'Check that the variant IDs are valid',
        TIPS.connected,
        TIPS.shop
      ]
    },
    async () => {
      const currentShop = requireShop(printifyClient);
      const product = await printifyClient.createProduct(productData);

      return {
        product,
        response: formatSuccessResponse(
          'Product Created Successfully',
          { ProductId: product.id, Title: product.title, Shop: currentShop },
          `You can now publish this product using the publish_product tool.`
        )
      };
    }
  );
}

export async function updateProduct(
  printifyClient: PrintifyAPI,
  productId: string,
  updateData: UpdateProductData
) {
  return runService(
    'Update Product',
    {
      context: () => ({ ProductId: productId, UpdateData: updateData, Shop: printifyClient.getCurrentShop() }),
      tips: ['Check that the product ID is valid', 'Check that the variant IDs are valid', TIPS.connected, TIPS.shop]
    },
    async () => {
      const currentShop = requireShop(printifyClient);
      const product = await printifyClient.updateProduct(productId, updateData);

      return {
        product,
        response: formatSuccessResponse(
          'Product Updated Successfully',
          { ProductId: productId, Title: updateData.title || 'Not updated', Shop: currentShop },
          `You may need to publish the changes using the publish_product tool.`
        )
      };
    }
  );
}

export async function deleteProduct(
  printifyClient: PrintifyAPI,
  productId: string
) {
  return runService(
    'Delete Product',
    {
      context: () => ({ ProductId: productId, Shop: printifyClient.getCurrentShop() }),
      tips: ['Check that the product ID is valid', TIPS.connected, TIPS.shop]
    },
    async () => {
      const currentShop = requireShop(printifyClient);
      await printifyClient.deleteProduct(productId);

      return {
        response: formatSuccessResponse('Product Deleted Successfully', { ProductId: productId, Shop: currentShop })
      };
    }
  );
}

export async function publishProduct(
  printifyClient: PrintifyAPI,
  productId: string,
  publishDetails?: {
    title?: boolean;
    description?: boolean;
    images?: boolean;
    variants?: boolean;
    tags?: boolean;
  }
) {
  return runService(
    'Publish Product',
    {
      context: () => ({ ProductId: productId, PublishDetails: publishDetails, Shop: printifyClient.getCurrentShop() }),
      tips: ['Check that the product ID is valid', TIPS.connected, TIPS.shop]
    },
    async () => {
      const currentShop = requireShop(printifyClient);
      const result = await printifyClient.publishProduct(productId, publishDetails);

      return {
        result,
        response: formatSuccessResponse('Product Published Successfully', { ProductId: productId, Shop: currentShop })
      };
    }
  );
}

/**
 * Publish status for custom (API) sales channels. After publish_product, such
 * a channel must report the outcome, or the product stays locked as
 * "publishing" in Printify. Shopify, Etsy and similar channels do this
 * themselves.
 */
const PUBLISH_STATUS_TIPS = [
  'Check that the product ID is valid',
  'These calls are for custom (API) sales channels; built-in channels report publishing themselves',
  TIPS.shop
];

export async function setPublishSucceeded(
  printifyClient: PrintifyAPI,
  productId: string,
  external: { id: string; handle: string }
) {
  return runService(
    'Set Publish Succeeded',
    { context: () => ({ ProductId: productId, ExternalId: external?.id, Handle: external?.handle }), tips: PUBLISH_STATUS_TIPS },
    async () => {
      requireShop(printifyClient);
      await printifyClient.setPublishSucceeded(productId, external);
      return {
        response: formatSuccessResponse(
          'Publish Marked Succeeded',
          { ProductId: productId, 'External Id': external.id, Handle: external.handle },
          'The product is unlocked in Printify and linked to its listing.'
        )
      };
    }
  );
}

export async function setPublishFailed(printifyClient: PrintifyAPI, productId: string, reason: string) {
  return runService(
    'Set Publish Failed',
    { context: () => ({ ProductId: productId, Reason: reason }), tips: PUBLISH_STATUS_TIPS },
    async () => {
      requireShop(printifyClient);
      await printifyClient.setPublishFailed(productId, reason);
      return {
        response: formatSuccessResponse(
          'Publish Marked Failed',
          { ProductId: productId, Reason: reason },
          'The product is unlocked in Printify and can be edited or published again.'
        )
      };
    }
  );
}

export async function notifyUnpublished(printifyClient: PrintifyAPI, productId: string) {
  return runService(
    'Notify Unpublished',
    { context: () => ({ ProductId: productId }), tips: PUBLISH_STATUS_TIPS },
    async () => {
      requireShop(printifyClient);
      await printifyClient.notifyUnpublished(productId);
      return {
        response: formatSuccessResponse(
          'Product Marked Unpublished',
          { ProductId: productId },
          'Printify now treats the product as removed from the sales channel.'
        )
      };
    }
  );
}
