import { describe, it, expect, vi } from 'vitest';
import sharp from 'sharp';
import { ReplicateClient } from '../src/replicate-client.js';

async function png() {
  return await sharp({ create: { width: 4, height: 4, channels: 4, background: { r: 3, g: 3, b: 3, alpha: 1 } } }).png().toBuffer();
}

function clientWith(run: any) {
  const c = new ReplicateClient('token');
  (c as any).client = { run };
  return c;
}

describe('ReplicateClient.generateImage', () => {
  it('runs the model and returns re-encoded bytes', async () => {
    const run = vi.fn(async () => await png());
    const out = await clientWith(run).generateImage('a cat');
    expect((await sharp(out).metadata()).format).toBe('png');
    expect(run).toHaveBeenCalledOnce();
  });

  it('passes the mapped input to the model', async () => {
    const run = vi.fn(async () => await png());
    await clientWith(run).generateImage('a cat', { seed: 5, aspectRatio: '16:9' });
    const [, payload] = run.mock.calls[0];
    expect(payload.input).toMatchObject({ prompt: 'a cat', seed: 5, aspect_ratio: '16:9' });
  });

  it('honours the requested output format', async () => {
    const run = vi.fn(async () => await png());
    const out = await clientWith(run).generateImage('x', { outputFormat: 'webp' });
    expect((await sharp(out).metadata()).format).toBe('webp');
  });

  // The thrown error must name the prompt and model so a caller can tell which
  // request failed, with the original attached as the cause.
  it('wraps a model failure with request detail', async () => {
    const run = vi.fn(async () => { throw new Error('model unavailable'); });
    const err = await clientWith(run).generateImage('a cat').catch((e: Error) => e);
    expect(err.message).toMatch(/Replicate API error: model unavailable/);
    expect(err.message).toContain('a cat');
    expect((err as any).cause).toBeInstanceOf(Error);
  });

  it('reports the overriding model id in the failure detail', async () => {
    const run = vi.fn(async () => { throw new Error('boom'); });
    const err = await clientWith(run).generateImage('x', {}, 'custom/model').catch((e: Error) => e);
    expect(err.message).toContain('custom/model');
  });

  it('fails clearly when the model returns nothing', async () => {
    const err = await clientWith(vi.fn(async () => null)).generateImage('x').catch((e: Error) => e);
    expect(err.message).toMatch(/null or undefined/);
  });
});
