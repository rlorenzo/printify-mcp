import { describe, it, expect, vi } from 'vitest';
import sharp from 'sharp';
import { generateImage } from '../src/services/image-generator.js';

async function png(w = 16, h = 16) {
  return await sharp({ create: { width: w, height: h, channels: 4, background: { r: 5, g: 5, b: 5, alpha: 1 } } }).png().toBuffer();
}

function fakeReplicate(overrides: Record<string, any> = {}) {
  return {
    getDefaultModel: () => 'black-forest-labs/flux-1.1-pro-ultra',
    generateImage: vi.fn(async () => await png()),
    ...overrides
  } as any;
}

describe('generateImage', () => {
  it('returns a processed PNG with metadata', async () => {
    const r = await generateImage(fakeReplicate(), 'a cat', 'cat');
    expect(r.success).toBe(true);
    expect(r.mimeType).toBe('image/png');
    expect(r.fileName).toBe('cat.png');
    expect(r.dimensions).toBe('16x16');
    expect((await sharp(r.buffer!).metadata()).format).toBe('png');
  });

  it('forwards mapped options to the client', async () => {
    const client = fakeReplicate();
    await generateImage(client, 'x', 'f', { aspectRatio: '16:9', seed: 0, numInferenceSteps: 40 });
    const sent = client.generateImage.mock.calls[0][1];
    expect(sent).toMatchObject({ aspectRatio: '16:9', seed: 0, numInferenceSteps: 40, outputFormat: 'png' });
    expect(sent).not.toHaveProperty('width');
  });

  it.each([
    ['jpeg', 'image/jpeg', 'f.jpg'],
    ['webp', 'image/webp', 'f.webp'],
    ['png', 'image/png', 'f.png']
  ])('honours outputFormat %s', async (fmt, mime, name) => {
    const r = await generateImage(fakeReplicate(), 'x', 'f', { outputFormat: fmt });
    expect(r.mimeType).toBe(mime);
    expect(r.fileName).toBe(name);
  });

  it('does not double-append an extension', async () => {
    expect((await generateImage(fakeReplicate(), 'x', 'f.png')).fileName).toBe('f.png');
  });

  it('reports the overriding model when one is given', async () => {
    const r = await generateImage(fakeReplicate(), 'x', 'f', { model: 'black-forest-labs/flux-1.1-pro' });
    expect(r.model).toBe('black-forest-labs/flux-1.1-pro');
  });

  it('falls back to the client default model', async () => {
    const r = await generateImage(fakeReplicate(), 'x', 'f');
    expect(r.model).toBe('black-forest-labs/flux-1.1-pro-ultra');
  });

  it('reports a generation failure without throwing', async () => {
    const client = fakeReplicate({ generateImage: vi.fn(async () => { throw new Error('replicate is down'); }) });
    const r = await generateImage(client, 'x', 'f');
    expect(r.success).toBe(false);
    expect(r.errorResponse).toBeTruthy();
  });

  it('reports a processing failure when the buffer is not an image', async () => {
    const client = fakeReplicate({ generateImage: vi.fn(async () => Buffer.from('not an image')) });
    const r = await generateImage(client, 'x', 'f');
    expect(r.success).toBe(false);
  });
});
