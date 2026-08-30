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
    expect(harness().names()).toHaveLength(19);
  });
});
