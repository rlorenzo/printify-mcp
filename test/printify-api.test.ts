import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import sharp from 'sharp';
import { PrintifyAPI } from '../src/printify-api.js';

/**
 * Drives PrintifyAPI against a stubbed SDK client. The constructor builds a real
 * printify-sdk-js instance, so tests replace `client` afterwards; no network or
 * credentials are involved.
 */
function api(clientOverrides: Record<string, any> = {}) {
  const uploadImage = vi.fn(async (args: any) => ({ id: 'img_1', ...args }));
  const create = vi.fn(async (data: any) => ({ id: 'prod_1', ...data }));
  const updateOne = vi.fn(async (id: string, data: any) => ({ id, ...data }));
  const getOne = vi.fn(async () => ({ id: 'prod_1', variants: [], print_areas: [] }));

  const instance = new PrintifyAPI('test-token', '42');
  (instance as any).client = {
    uploads: { uploadImage },
    products: { create, updateOne, getOne, list: vi.fn(), deleteOne: vi.fn(), publishOne: vi.fn() },
    shops: { list: vi.fn() },
    catalog: {},
    ...clientOverrides
  };
  return { instance, uploadImage, create, updateOne, getOne };
}

/**
 * A product as Printify actually stores one: print areas scoped to variant
 * ids, three colorways with their own front artwork, one of which also has a
 * back. `updateProduct` used to replace all of this with a single entry.
 */
function threeGroupProduct() {
  return {
    id: 'prod_9',
    variants: [
      { id: 1, is_enabled: true },
      { id: 2, is_enabled: true },
      { id: 3, is_enabled: true },
      { id: 4, is_enabled: false }
    ],
    print_areas: [
      {
        variant_ids: [1],
        placeholders: [
          { position: 'front', images: [{ id: 'black_front' }] },
          { position: 'back', images: [{ id: 'black_back' }] }
        ]
      },
      { variant_ids: [2], placeholders: [{ position: 'front', images: [{ id: 'white_front' }] }] },
      { variant_ids: [3], placeholders: [{ position: 'front', images: [{ id: 'navy_front' }] }] }
    ]
  };
}

const scratch = path.join(process.cwd(), '.tmp-api-test');

/** A real 8x8 PNG: the file-upload branch pipes through sharp, which rejects
 *  anything that is not a decodable image. */
async function writePng(name: string): Promise<string> {
  fs.mkdirSync(scratch, { recursive: true });
  const file = path.join(scratch, name);
  const buf = await sharp({
    create: { width: 8, height: 8, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 1 } }
  }).png().toBuffer();
  fs.writeFileSync(file, buf);
  return file;
}
afterEach(() => fs.rmSync(scratch, { recursive: true, force: true }));

describe('uploadImage source handling', () => {
  it('passes an http(s) URL through as a url upload', async () => {
    const { instance, uploadImage } = api();
    await instance.uploadImage('a.png', 'https://example.test/a.png');
    expect(uploadImage).toHaveBeenCalledWith({ file_name: 'a.png', url: 'https://example.test/a.png' });
  });

  it('handles a plain http URL too', async () => {
    const { instance, uploadImage } = api();
    await instance.uploadImage('a.png', 'http://example.test/a.png');
    expect(uploadImage.mock.calls[0][0]).toHaveProperty('url');
  });

  it('extracts base64 from a data URL', async () => {
    const { instance, uploadImage } = api();
    const b64 = Buffer.from('hello').toString('base64');
    await instance.uploadImage('a.png', `data:image/png;base64,${b64}`);
    expect(uploadImage).toHaveBeenCalledWith({ file_name: 'a.png', contents: b64 });
  });

  it('reads a real file from disk and uploads its base64', async () => {
    const file = await writePng('pic.png');
    const { instance, uploadImage } = api();
    await instance.uploadImage('pic.png', file);
    // sharp re-encodes, so assert it uploaded decodable PNG bytes rather than
    // byte-equality with the file on disk.
    const sent = Buffer.from(uploadImage.mock.calls[0][0].contents, 'base64');
    expect((await sharp(sent).metadata()).format).toBe('png');
  });

  // Regression: a leading slash was stripped "for Windows", which mangled every
  // POSIX absolute path into a relative one.
  it('does not strip the leading slash from a POSIX absolute path', async () => {
    const file = await writePng('abs.png');
    expect(file.startsWith('/')).toBe(true);
    const { instance, uploadImage } = api();
    await expect(instance.uploadImage('abs.png', file)).resolves.toBeTruthy();
    expect(uploadImage.mock.calls[0][0].contents).toBeTruthy();
  });

  it('reads a file:// URL', async () => {
    const file = await writePng('url.png');
    const { instance, uploadImage } = api();
    await instance.uploadImage('url.png', `file://${file}`);
    expect(uploadImage.mock.calls[0][0].contents).toBeTruthy();
  });

  it('reports a helpful error when the file does not exist', async () => {
    const { instance } = api();
    await expect(instance.uploadImage('missing.png', path.join(scratch, 'nope.png')))
      .rejects.toThrow();
  });

  // A relative path used to skip ALLOWED_FILE_DIR entirely.
  it('refuses a relative path that escapes the allowed directory', async () => {
    const { instance, uploadImage } = api();
    await expect(instance.uploadImage('x.png', '../outside/x.png')).rejects.toThrow(/outside the allowed directory/);
    expect(uploadImage).not.toHaveBeenCalled();
  });

  it('propagates an SDK upload failure', async () => {
    const { instance } = api({ uploads: { uploadImage: vi.fn(async () => { throw new Error('rejected by API'); }) } });
    await expect(instance.uploadImage('a.png', 'https://example.test/a.png')).rejects.toThrow(/rejected by API/);
  });
});

describe('createProduct', () => {
  it('coerces ids and prices to numbers and defaults isEnabled', async () => {
    const { instance, create } = api();
    await instance.createProduct({
      title: 'Tee', description: 'A tee', blueprintId: '5', printProviderId: '9',
      variants: [{ variantId: '101', price: '1999' }, { id: 102, price: 2500, isEnabled: false }]
    });
    const sent = create.mock.calls[0][0];
    expect(sent.blueprint_id).toBe(5);
    expect(sent.print_provider_id).toBe(9);
    expect(sent.variants[0]).toEqual({ id: 101, price: 1999, is_enabled: true });
    expect(sent.variants[1]).toEqual({ id: 102, price: 2500, is_enabled: false });
  });

  it('accepts snake_case ids as well', async () => {
    const { instance, create } = api();
    await instance.createProduct({ title: 't', description: 'd', blueprint_id: '7', print_provider_id: '3', variants: [] });
    expect(create.mock.calls[0][0].blueprint_id).toBe(7);
    expect(create.mock.calls[0][0].print_provider_id).toBe(3);
  });

  it('passes tags through and defaults them to an empty list', async () => {
    const { instance, create } = api();
    await instance.createProduct({ title: 't', description: 'd', blueprintId: 1, printProviderId: 1, variants: [], tags: ['a', 'b'] });
    expect(create.mock.calls[0][0].tags).toEqual(['a', 'b']);
    await instance.createProduct({ title: 't', description: 'd', blueprintId: 1, printProviderId: 1, variants: [] });
    expect(create.mock.calls[1][0].tags).toEqual([]);
  });

  it('builds a centred placeholder per print-area position', async () => {
    const { instance, create } = api();
    await instance.createProduct({
      title: 't', description: 'd', blueprintId: 1, printProviderId: 1,
      variants: [{ id: 1, price: 100 }],
      printAreas: { front: { position: 'front', imageId: 'img_a' }, back: { position: 'back', image_id: 'img_b' } }
    });
    const area = create.mock.calls[0][0].print_areas[0];
    expect(area.variant_ids).toEqual([1]);
    expect(area.placeholders).toHaveLength(2);
    expect(area.placeholders[0]).toEqual({
      position: 'front',
      images: [{ id: 'img_a', x: 0.5, y: 0.5, scale: 1, angle: 0 }]
    });
    expect(area.placeholders[1].images[0].id).toBe('img_b');
  });

  it('scopes print areas to the variants a group names', async () => {
    const { instance, create } = api();
    await instance.createProduct({
      title: 't', description: 'd', blueprintId: 1, printProviderId: 1,
      variants: [{ id: 1, price: 100 }, { id: 2, price: 100 }],
      printAreas: [
        { variantIds: [1], placeholders: [{ position: 'front', imageId: 'img_a' }] },
        { variantIds: [2], placeholders: [{ position: 'front', imageId: 'img_b' }] }
      ]
    });
    const areas = create.mock.calls[0][0].print_areas;
    expect(areas.map((a: any) => a.variant_ids)).toEqual([[1], [2]]);
    expect(areas.map((a: any) => a.placeholders[0].images[0].id)).toEqual(['img_a', 'img_b']);
  });

  it('sends no print areas at all for an empty group list', async () => {
    const { instance, create } = api();
    await instance.createProduct({
      title: 't', description: 'd', blueprintId: 1, printProviderId: 1,
      variants: [{ id: 1, price: 100 }],
      printAreas: []
    });
    // Not one all-variant entry carrying no placements.
    expect(create.mock.calls[0][0].print_areas).toEqual([]);
  });

  it('sends no print areas at all for an empty flat map', async () => {
    const { instance, create } = api();
    await instance.createProduct({
      title: 't', description: 'd', blueprintId: 1, printProviderId: 1,
      variants: [{ id: 1, price: 100 }],
      printAreas: {}
    });
    expect(create.mock.calls[0][0].print_areas).toEqual([]);
  });

  // parseInt turned 'abc' into NaN and '12bad' into 12, and both went out as
  // variant ids -- one the API rejects, one that hits the wrong variant.
  it('refuses variant ids that are not positive integers', async () => {
    const { instance, create } = api();
    const product = (id: any) => ({
      title: 't', description: 'd', blueprintId: 1, printProviderId: 1,
      variants: [{ id, price: 100 }]
    });

    for (const bad of ['abc', '12bad', 0, -1, 1.5]) {
      await expect(instance.createProduct(product(bad))).rejects.toThrow(/Invalid variant id/);
    }

    expect(create).not.toHaveBeenCalled();
  });

  // Placements with no variants to carry them would go out as
  // `variant_ids: []`, which the API accepts and then drops.
  it('refuses print areas when there are no variants to attach them to', async () => {
    const { instance, create } = api();

    await expect(instance.createProduct({
      title: 't', description: 'd', blueprintId: 1, printProviderId: 1,
      variants: [],
      printAreas: { front: { position: 'front', imageId: 'img_a' } }
    })).rejects.toThrow(/zero variants/);

    expect(create).not.toHaveBeenCalled();
  });

  it('refuses to run without a shop id', async () => {
    const { instance } = api();
    instance.setShopId('');
    await expect(instance.createProduct({ title: 't' })).rejects.toThrow(/Shop ID is not set/);
  });

  it('propagates an SDK failure', async () => {
    const { instance } = api({ products: { create: vi.fn(async () => { throw new Error('bad blueprint'); }) } });
    await expect(instance.createProduct({ title: 't', description: 'd', blueprintId: 1, printProviderId: 1, variants: [] }))
      .rejects.toThrow(/bad blueprint/);
  });
});

describe('updateProduct', () => {
  it('sends only the fields provided', async () => {
    const { instance, updateOne } = api();
    await instance.updateProduct('prod_9', { title: 'New title' });
    const [id, sent] = updateOne.mock.calls[0];
    expect(id).toBe('prod_9');
    expect(sent.title).toBe('New title');
  });

  it('formats variants the same way as create', async () => {
    const { instance, updateOne } = api();
    await instance.updateProduct('prod_9', { variants: [{ variantId: '55', price: '900' }] });
    expect(updateOne.mock.calls[0][1].variants[0]).toEqual({ id: 55, price: 900, is_enabled: true });
  });

  // Regression: a flat print-area map used to be written out as one entry over
  // every variant, silently collapsing per-colorway artwork into one image.
  it('merges a flat print area into every existing variant group', async () => {
    const { instance, updateOne, getOne } = api();
    getOne.mockResolvedValue(threeGroupProduct() as any);

    await instance.updateProduct('prod_9', {
      printAreas: { front: { position: 'front', imageId: 'img_new' } }
    });

    const areas = updateOne.mock.calls[0][1].print_areas;
    expect(areas.map((a: any) => a.variant_ids)).toEqual([[1], [2], [3]]);
    expect(areas.map((a: any) => a.placeholders.find((p: any) => p.position === 'front').images[0].id))
      .toEqual(['img_new', 'img_new', 'img_new']);
  });

  it('leaves placements the update did not mention alone', async () => {
    const { instance, updateOne, getOne } = api();
    getOne.mockResolvedValue(threeGroupProduct() as any);

    await instance.updateProduct('prod_9', {
      printAreas: { front: { position: 'front', imageId: 'img_new' } }
    });

    const back = updateOne.mock.calls[0][1].print_areas[0].placeholders
      .find((p: any) => p.position === 'back');
    expect(back.images[0].id).toBe('black_back');
  });

  it('adds a placement that no group has yet', async () => {
    const { instance, updateOne, getOne } = api();
    getOne.mockResolvedValue(threeGroupProduct() as any);

    await instance.updateProduct('prod_9', {
      printAreas: { back: { position: 'back', imageId: 'img_back' } }
    });

    const areas = updateOne.mock.calls[0][1].print_areas;
    // The group that already had a back keeps its position; the two that did
    // not gain one, and neither loses its front.
    expect(areas[0].placeholders.map((p: any) => p.position)).toEqual(['front', 'back']);
    expect(areas[0].placeholders[0].images[0].id).toBe('black_front');
    expect(areas[1].placeholders.map((p: any) => p.position)).toEqual(['front', 'back']);
    expect(areas[1].placeholders[1].images[0].id).toBe('img_back');
  });

  it('normalizes explicit per-variant groups and sends them as given', async () => {
    const { instance, updateOne, getOne } = api();

    await instance.updateProduct('prod_9', {
      printAreas: [
        { variantIds: [1], placeholders: [{ position: 'front', imageId: 'img_black' }] },
        { variantIds: [2, 3], placeholders: [{ position: 'front', imageId: 'img_light' }] }
      ]
    });

    expect(updateOne.mock.calls[0][1].print_areas).toEqual([
      { variant_ids: [1], placeholders: [{ position: 'front', images: [{ id: 'img_black', x: 0.5, y: 0.5, scale: 1, angle: 0 }] }] },
      { variant_ids: [2, 3], placeholders: [{ position: 'front', images: [{ id: 'img_light', x: 0.5, y: 0.5, scale: 1, angle: 0 }] }] }
    ]);
    // Explicit groups say everything the request needs; nothing to reconcile.
    expect(getOne).not.toHaveBeenCalled();
  });

  // An empty list is the only way to say "no print areas at all". Read as a
  // flat map it would merge nothing and quietly leave the artwork in place.
  it('clears print areas when given an empty group list', async () => {
    const { instance, updateOne, getOne } = api();
    getOne.mockResolvedValue(threeGroupProduct() as any);

    await instance.updateProduct('prod_9', { printAreas: [] });

    expect(updateOne.mock.calls[0][1].print_areas).toEqual([]);
    expect(getOne).not.toHaveBeenCalled();
  });

  // A flat map with nothing in it says the same thing -- including when the
  // product does have groups, which a merge would otherwise leave in place.
  it('clears print areas when given an empty flat map', async () => {
    const { instance, updateOne, getOne } = api();
    getOne.mockResolvedValue(threeGroupProduct() as any);

    await instance.updateProduct('prod_9', { printAreas: {} });

    expect(updateOne.mock.calls[0][1].print_areas).toEqual([]);
    expect(getOne).not.toHaveBeenCalled();
  });

  // `variantIds: []` is truthy, so it reaches the explicit-groups path; sent
  // as-is it would attach the artwork to nothing.
  it('rejects a print-area group that names no usable variant', async () => {
    const { instance } = api();

    await expect(instance.updateProduct('prod_9', {
      printAreas: [{ variantIds: [], placeholders: [{ position: 'front', imageId: 'i' }] }]
    })).rejects.toThrow(/at least one numeric variant id/);

    await expect(instance.updateProduct('prod_9', {
      printAreas: [{ variantIds: ['not-a-number'], placeholders: [{ position: 'front', imageId: 'i' }] }]
    })).rejects.toThrow(/at least one numeric variant id/);

    // parseInt would read this as 12 and silently target that variant.
    await expect(instance.updateProduct('prod_9', {
      printAreas: [{ variantIds: ['12bad'], placeholders: [{ position: 'front', imageId: 'i' }] }]
    })).rejects.toThrow(/at least one numeric variant id/);
  });

  // An empty variant list is not a variant list; taking it would attach the
  // artwork to no variants at all.
  it('falls back to enabled variants when the update carries an empty variant list', async () => {
    const { instance, updateOne, getOne } = api();
    getOne.mockResolvedValue({
      id: 'prod_9',
      variants: [{ id: 7, is_enabled: true }, { id: 8, is_enabled: false }],
      print_areas: []
    } as any);

    await instance.updateProduct('prod_9', {
      variants: [],
      printAreas: { front: { position: 'front', imageId: 'img_new' } }
    });

    expect(updateOne.mock.calls[0][1].print_areas[0].variant_ids).toEqual([7]);
  });

  it('refuses print areas when the product has no enabled variants', async () => {
    const { instance, updateOne, getOne } = api();
    getOne.mockResolvedValue({
      id: 'prod_9',
      variants: [{ id: 7, is_enabled: false }],
      print_areas: []
    } as any);

    await expect(instance.updateProduct('prod_9', {
      printAreas: { front: { position: 'front', imageId: 'img_new' } }
    })).rejects.toThrow(/zero variants/);

    expect(updateOne).not.toHaveBeenCalled();
  });

  it('keeps placeholders that already carry their own placement', async () => {
    const { instance, updateOne } = api();
    const images = [{ id: 'img_x', x: 0.25, y: 0.75, scale: 0.5, angle: 90 }];

    await instance.updateProduct('prod_9', {
      print_areas: [{ variant_ids: [7], placeholders: [{ position: 'front', images }] }]
    });

    expect(updateOne.mock.calls[0][1].print_areas[0].placeholders[0].images).toEqual(images);
  });

  it('treats printAreas and print_areas identically', async () => {
    const { instance, updateOne, getOne } = api();
    getOne.mockResolvedValue(threeGroupProduct() as any);
    const areas = { front: { position: 'front', imageId: 'img_new' } };

    await instance.updateProduct('prod_9', { printAreas: areas });
    await instance.updateProduct('prod_9', { print_areas: areas });

    const [first, second] = updateOne.mock.calls.map((call: any) => call[1]);
    expect(first.print_areas).toEqual(second.print_areas);
    // The camelCase key is consumed, never forwarded to the API.
    expect(first).not.toHaveProperty('printAreas');
  });

  it('covers every enabled variant when the product has no print areas yet', async () => {
    const { instance, updateOne, getOne } = api();
    getOne.mockResolvedValue({ id: 'prod_9', variants: threeGroupProduct().variants, print_areas: [] } as any);

    await instance.updateProduct('prod_9', {
      printAreas: { front: { position: 'front', imageId: 'img_c' } }
    });

    const areas = updateOne.mock.calls[0][1].print_areas;
    expect(areas).toHaveLength(1);
    expect(areas[0].variant_ids).toEqual([1, 2, 3]);
    expect(areas[0].placeholders[0].images[0].id).toBe('img_c');
  });

  it('scopes a first print area to the variants being updated when they are given', async () => {
    const { instance, updateOne, getOne } = api();
    getOne.mockResolvedValue({ id: 'prod_9', variants: threeGroupProduct().variants, print_areas: [] } as any);

    await instance.updateProduct('prod_9', {
      variants: [{ variantId: '2', price: '900' }],
      printAreas: { front: { position: 'front', imageId: 'img_c' } }
    });

    expect(updateOne.mock.calls[0][1].print_areas[0].variant_ids).toEqual([2]);
  });

  // Regression: the fetch failure was swallowed and the update went out with
  // empty variant ids, attaching the artwork to nothing.
  it('refuses to update print areas when the product cannot be fetched', async () => {
    const { instance, updateOne, getOne } = api();
    getOne.mockRejectedValue(new Error('404 not found'));

    await expect(instance.updateProduct('prod_9', {
      printAreas: { front: { position: 'front', imageId: 'img_c' } }
    })).rejects.toThrow(/failed to fetch product prod_9/);
    expect(updateOne).not.toHaveBeenCalled();
  });

  it('refuses to run without a shop id', async () => {
    const { instance } = api();
    instance.setShopId('');
    await expect(instance.updateProduct('p', { title: 'x' })).rejects.toThrow(/Shop ID is not set/);
  });

  it('propagates an SDK failure', async () => {
    const { instance } = api({ products: { updateOne: vi.fn(async () => { throw new Error('no such product'); }) } });
    await expect(instance.updateProduct('p', { title: 'x' })).rejects.toThrow(/no such product/);
  });
});

describe('uploadImage remaining branches', () => {
  // uploadImage classifies anything that is not an http(s) URL and not a
  // `data:` URL as a file path, by design: raw base64 is never accepted as
  // contents. The generation tools therefore wrap their bytes in a data URL,
  // which is what this covers, using real PNG bytes so sharp validation runs.
  it('takes contents from a data URL carrying real image bytes', async () => {
    const { instance, uploadImage } = api();
    const b64 = (await sharp({ create: { width: 4, height: 4, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } })
      .png().toBuffer()).toString('base64');
    await instance.uploadImage('bare.png', `data:image/png;base64,${b64}`);
    expect(uploadImage.mock.calls[0][0].contents).toBe(b64);
  });

  it('rejects a directory given where a file is expected', async () => {
    fs.mkdirSync(scratch, { recursive: true });
    const { instance } = api();
    await expect(instance.uploadImage('dir.png', scratch)).rejects.toThrow();
  });

  // A `data:` URL with no comma, or an empty payload after it, is malformed
  // input, not a valid (if unusual) one -- it must not be forwarded to
  // Printify's API as an empty or garbage `contents` field.
  it('rejects a data URL with no comma delimiter', async () => {
    const { instance, uploadImage } = api();
    await expect(instance.uploadImage('bare.png', 'data:image/png;base64')).rejects.toThrow(/Invalid data URL/);
    expect(uploadImage).not.toHaveBeenCalled();
  });

  it('rejects a data URL with an empty payload', async () => {
    const { instance, uploadImage } = api();
    await expect(instance.uploadImage('bare.png', 'data:image/png;base64,')).rejects.toThrow(/Invalid data URL/);
    expect(uploadImage).not.toHaveBeenCalled();
  });

  // Without a `;base64` marker, a data URL's payload is percent-encoded text
  // per RFC 2397, not base64 -- accepting it would forward the raw text as
  // `contents` to Printify's API.
  it('rejects a data URL without a ;base64 marker', async () => {
    const { instance, uploadImage } = api();
    await expect(instance.uploadImage('bare.png', 'data:text/plain,hello')).rejects.toThrow(/Invalid data URL/);
    expect(uploadImage).not.toHaveBeenCalled();
  });

  it('rejects a non-image file', async () => {
    fs.mkdirSync(scratch, { recursive: true });
    const f = path.join(scratch, 'notes.txt');
    fs.writeFileSync(f, 'definitely not an image');
    const { instance } = api();
    await expect(instance.uploadImage('notes.txt', f)).rejects.toThrow(/Failed to process file/);
  });

  // The thrown message reaches the model, so it must not carry host paths or
  // stack traces.
  it('does not leak the working directory or a stack trace', async () => {
    fs.mkdirSync(scratch, { recursive: true });
    const f = path.join(scratch, 'bad.txt');
    fs.writeFileSync(f, 'nope');
    const { instance } = api();
    const err = await instance.uploadImage('bad.txt', f).catch((e: Error) => e);
    expect(err.message).not.toContain('Current working directory');
    expect(err.message).not.toContain('Stack trace');
    // The underlying error is still available locally for debugging.
    expect((err as any).cause).toBeInstanceOf(Error);
  });

  it('converts a webp file to PNG before upload', async () => {
    fs.mkdirSync(scratch, { recursive: true });
    const f = path.join(scratch, 'pic.webp');
    fs.writeFileSync(f, await sharp({ create: { width: 6, height: 6, channels: 4, background: { r: 9, g: 9, b: 9, alpha: 1 } } }).webp().toBuffer());
    const { instance, uploadImage } = api();
    await instance.uploadImage('pic.webp', f);
    const sent = Buffer.from(uploadImage.mock.calls[0][0].contents, 'base64');
    expect((await sharp(sent).metadata()).format).toBe('png');
  });
});

describe('uploadImage file validation', () => {
  it('rejects an empty file', async () => {
    fs.mkdirSync(scratch, { recursive: true });
    const f = path.join(scratch, 'empty.png');
    fs.writeFileSync(f, '');
    const { instance } = api();
    await expect(instance.uploadImage('empty.png', f)).rejects.toThrow(/File is empty/);
  });

  it('rejects a file over the 10MB limit', async () => {
    fs.mkdirSync(scratch, { recursive: true });
    const f = path.join(scratch, 'huge.png');
    fs.writeFileSync(f, Buffer.alloc(10 * 1024 * 1024 + 1, 1));
    const { instance } = api();
    const err = await instance.uploadImage('huge.png', f).catch((e: Error) => e);
    expect((err.cause as Error).message).toBe(
      'File is too large (10485761 bytes). Maximum size is 10485760 bytes (10MB).'
    );
  });

  // A Windows file:// URI carries its drive letter behind a leading slash,
  // which must be stripped; a POSIX path must not be.
  it('strips the leading slash only from a /C:/ style path', async () => {
    const { instance } = api();
    const err = await instance.uploadImage('w.png', 'file:///C:/nope/missing.png').catch((e: Error) => e);
    // Either way the slash is gone: the path is quoted as C:/..., never /C:/...
    if (path.isAbsolute('C:/nope/missing.png')) {
      // Windows: C:/... is an absolute path outside the allowed directory.
      expect(err.message).toContain('"C:/nope/missing.png" is outside the allowed directory');
    } else {
      // POSIX: C:/... is a relative path inside it that simply isn't there.
      // Unstripped, /C:/... would be absolute and refused instead.
      expect(err.message).toContain('File not found: C:/nope/missing.png');
    }
  });

  // The thrown message reaches the model; a relative input must not come
  // back resolved against the server's working directory.
  it.each([
    ['a missing file', 'gone.png', /File not found/],
    ['an empty file', 'empty.png', /File is empty/],
    ['a directory', 'dir', /Not a regular file/]
  ])('keeps the working directory out of the error for %s', async (_label, name, expected) => {
    fs.mkdirSync(path.join(scratch, 'dir'), { recursive: true });
    fs.writeFileSync(path.join(scratch, 'empty.png'), '');
    const { instance } = api();
    const rel = path.relative(process.cwd(), path.join(scratch, name));
    const err = await instance.uploadImage('x.png', rel).catch((e: Error) => e);
    expect(err.message).toMatch(expected);
    expect(err.message).not.toContain(process.cwd());
  });

  it('reports a missing parent directory', async () => {
    const { instance } = api();
    await expect(instance.uploadImage('x.png', path.join(scratch, 'no', 'such', 'x.png')))
      .rejects.toThrow(/Failed to process file|File not found/);
  });
});

describe('initialize and getShops', () => {
  const shops = [{ id: 10, title: 'First' }, { id: 11, title: 'Second' }];

  it('caches shops and adopts the first as default', async () => {
    const instance = new PrintifyAPI('t');
    (instance as any).client = { shops: { list: vi.fn(async () => shops) } };
    const result = await instance.initialize();
    expect(result).toEqual(shops);
    expect(instance.getCurrentShopId()).toBe('10');
    expect(instance.getCurrentShop()).toMatchObject({ id: 10, title: 'First' });
  });

  it('keeps an explicitly configured shop id', async () => {
    const instance = new PrintifyAPI('t', '11');
    (instance as any).client = { shops: { list: vi.fn(async () => shops) } };
    await instance.initialize();
    expect(instance.getCurrentShopId()).toBe('11');
  });

  it('tolerates a non-array response', async () => {
    const instance = new PrintifyAPI('t');
    (instance as any).client = { shops: { list: vi.fn(async () => null) } };
    await expect(instance.initialize()).resolves.toEqual([]);
  });

  it('continues with an existing shop id when the lookup fails', async () => {
    const instance = new PrintifyAPI('t', '99');
    (instance as any).client = { shops: { list: vi.fn(async () => { throw new Error('offline'); }) } };
    await expect(instance.initialize()).resolves.toEqual([]);
    expect(instance.getCurrentShopId()).toBe('99');
  });

  // Fabricating shops here would make a caller act on invented shop ids.
  it('propagates the failure when there is no shop id to fall back on', async () => {
    const instance = new PrintifyAPI('t');
    (instance as any).client = { shops: { list: vi.fn(async () => { throw new Error('offline'); }) } };
    await expect(instance.initialize()).rejects.toThrow(/offline/);
  });

  it('getShops refreshes the cache used by getCurrentShop', async () => {
    const instance = new PrintifyAPI('t', '11');
    (instance as any).client = { shops: { list: vi.fn(async () => shops) } };
    expect(instance.getCurrentShop()).toBeNull();
    await instance.getShops();
    expect(instance.getCurrentShop()).toMatchObject({ id: 11 });
  });

  it('getShops returns an empty list for a non-array response', async () => {
    const instance = new PrintifyAPI('t');
    (instance as any).client = { shops: { list: vi.fn(async () => undefined) } };
    await expect(instance.getShops()).resolves.toEqual([]);
  });

  it('getShops propagates an SDK failure', async () => {
    const instance = new PrintifyAPI('t');
    (instance as any).client = { shops: { list: vi.fn(async () => { throw new Error('boom'); }) } };
    await expect(instance.getShops()).rejects.toThrow(/boom/);
  });
});

describe('orders', () => {
  it('lists, gets and quotes through the SDK', async () => {
    const list = vi.fn(async () => ({ current_page: 1, data: [] }));
    const getOne = vi.fn(async (id: string) => ({ id }));
    const calculateShipping = vi.fn(async () => ({ standard: 1 }));
    const { instance } = api({ orders: { list, getOne, calculateShipping } });
    await instance.listOrders({ page: 2, status: 'fulfilled' });
    await instance.getOrder(' 5a96f649b2439217 ');
    await instance.calculateOrderShipping({ line_items: [], address_to: { country: 'US' } });
    expect(list).toHaveBeenCalledWith({ page: 2, status: 'fulfilled' });
    expect(getOne).toHaveBeenCalledWith('5a96f649b2439217');
    expect(calculateShipping).toHaveBeenCalledWith({ line_items: [], address_to: { country: 'US' } });
  });

  // The SDK interpolates the id into the URL unencoded.
  it.each(['ord/../../products', 'a?b=1', '', 'a b'])('rejects the order id %j before any request', async (bad) => {
    const getOne = vi.fn();
    const { instance } = api({ orders: { getOne } });
    await expect(instance.getOrder(bad)).rejects.toThrow(/orderId must be a plain id/);
    expect(getOne).not.toHaveBeenCalled();
  });

  it('needs a shop', async () => {
    const instance = new PrintifyAPI('test-token');
    await expect(instance.listOrders()).rejects.toThrow(/Shop ID is not set/);
  });
});

describe('order changes', () => {
  it('submits, sends to production and cancels through the SDK', async () => {
    const submit = vi.fn(async () => ({ id: 'o1' }));
    const sendToProduction = vi.fn(async (id: string) => ({ id }));
    const cancelUnpaid = vi.fn(async (id: string) => ({ id }));
    const { instance } = api({ orders: { submit, sendToProduction, cancelUnpaid } });
    await instance.createOrder({ external_id: 'x' });
    await instance.sendOrderToProduction('o1');
    await instance.cancelOrder('o1');
    expect(submit).toHaveBeenCalledWith({ external_id: 'x' });
    expect(sendToProduction).toHaveBeenCalledWith('o1');
    expect(cancelUnpaid).toHaveBeenCalledWith('o1');
  });

  it.each(['o1/../../x', 'o1?x=1'])('rejects the order id %j before sending or cancelling', async (bad) => {
    const sendToProduction = vi.fn();
    const cancelUnpaid = vi.fn();
    const { instance } = api({ orders: { sendToProduction, cancelUnpaid } });
    await expect(instance.sendOrderToProduction(bad)).rejects.toThrow(/orderId must be a plain id/);
    await expect(instance.cancelOrder(bad)).rejects.toThrow(/orderId must be a plain id/);
    expect(sendToProduction).not.toHaveBeenCalled();
    expect(cancelUnpaid).not.toHaveBeenCalled();
  });
});

describe('catalog providers and shipping', () => {
  it('lists every provider through the SDK', async () => {
    const listProviders = vi.fn(async () => [{ id: 1 }]);
    const { instance } = api({ catalog: { listProviders } });
    expect(await instance.listAllPrintProviders()).toEqual([{ id: 1 }]);
  });

  it('fetches one provider and one blueprint\'s shipping by id', async () => {
    const getProvider = vi.fn(async (id: string) => ({ id }));
    const getVariantShipping = vi.fn(async () => ({ profiles: [] }));
    const { instance } = api({ catalog: { getProvider, getVariantShipping } });
    await instance.getPrintProvider(' 29 ');
    await instance.getShipping('12', '29');
    expect(getProvider).toHaveBeenCalledWith('29');
    expect(getVariantShipping).toHaveBeenCalledWith('12', '29');
  });

  // The SDK interpolates ids into the URL unencoded; a crafted id must not
  // reach another endpoint with the account's key.
  it.each(['12/../../shops', '29?x=1', '', 'abc'])('rejects the non-numeric id %j before any request', async (bad) => {
    const getProvider = vi.fn();
    const getVariantShipping = vi.fn();
    const { instance } = api({ catalog: { getProvider, getVariantShipping } });
    await expect(instance.getPrintProvider(bad)).rejects.toThrow(/printProviderId must be a numeric id/);
    await expect(instance.getShipping(bad, '29')).rejects.toThrow(/blueprintId must be a numeric id/);
    await expect(instance.getShipping('12', bad)).rejects.toThrow(/printProviderId must be a numeric id/);
    expect(getProvider).not.toHaveBeenCalled();
    expect(getVariantShipping).not.toHaveBeenCalled();
  });
});

describe('getVariants', () => {
  // The SDK's getBlueprintVariants takes no query options, and the API leaves
  // out-of-stock variants out unless show-out-of-stock is passed.
  it('uses the SDK method when out-of-stock variants are not asked for', async () => {
    const getBlueprintVariants = vi.fn(async () => ({ variants: [] }));
    const request = vi.fn();
    const { instance } = api({ catalog: { getBlueprintVariants, request } });
    await instance.getVariants('12', '29');
    expect(getBlueprintVariants).toHaveBeenCalledWith('12', '29');
    expect(request).not.toHaveBeenCalled();
  });

  it('passes show-out-of-stock through the SDK request when asked', async () => {
    const getBlueprintVariants = vi.fn();
    const request = vi.fn(async () => ({ variants: [{ id: 1 }] }));
    const { instance } = api({ catalog: { getBlueprintVariants, request } });
    const result = await instance.getVariants('12', '29', { showOutOfStock: true });
    expect(result).toEqual({ variants: [{ id: 1 }] });
    expect(getBlueprintVariants).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledWith(
      '/v1/catalog/blueprints/12/print_providers/29/variants.json',
      { method: 'GET', params: { 'show-out-of-stock': 1 } }
    );
  });

  // The ids come from the model; they must not be able to reshape the path.
  it('encodes the ids in the request path', async () => {
    const request = vi.fn(async () => ({ variants: [] }));
    const { instance } = api({ catalog: { request } });
    await instance.getVariants('12/../../shops', '29?x=1', { showOutOfStock: true });
    expect(request.mock.calls[0][0]).toBe(
      '/v1/catalog/blueprints/12%2F..%2F..%2Fshops/print_providers/29%3Fx%3D1/variants.json'
    );
  });
});
