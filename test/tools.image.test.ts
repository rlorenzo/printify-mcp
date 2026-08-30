import { describe, it, expect, vi, afterEach } from 'vitest';
import sharp from 'sharp';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { harness, fakePrintify } from './helpers/harness.js';

const ULTRA = 'black-forest-labs/flux-1.1-pro-ultra';
const PRO = 'black-forest-labs/flux-1.1-pro';

async function png() {
  return await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 2, g: 2, b: 2, alpha: 1 } } }).png().toBuffer();
}

function fakeReplicate(overrides: Record<string, any> = {}) {
  return {
    getDefaultModel: () => PRO,
    getAllDefaults: () => ({
      model: PRO, width: 1024, height: 1024, aspectRatio: '1:1', outputFormat: 'png',
      safetyTolerance: 2, numInferenceSteps: 25, guidanceScale: 7.5,
      negativePrompt: 'low quality', raw: false, promptUpsampling: true, outputQuality: 90
    }),
    generateImage: vi.fn(async () => await png()),
    ...overrides
  } as any;
}

const scratch = path.join(process.cwd(), '.tmp-tools-test');
afterEach(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
  delete process.env.IMGBB_API_KEY;
});

describe('generate_and_upload_image', () => {
  it('generates then uploads, reporting the image id', async () => {
    const printify = fakePrintify();
    const h = harness({ printifyClient: printify, replicateClient: fakeReplicate() });
    const res = await h.call('generate_and_upload_image', { prompt: 'a cat', fileName: 'cat' });
    expect(res.isError).toBeFalsy();
    expect(res.content[0].text).toContain('img_1');
  });

  it('passes the merged options through to the client', async () => {
    const replicate = fakeReplicate();
    const h = harness({ printifyClient: fakePrintify(), replicateClient: replicate });
    await h.call('generate_and_upload_image', { prompt: 'x', fileName: 'f', seed: 3, outputFormat: 'webp' });
    const sent = replicate.generateImage.mock.calls[0][1];
    expect(sent).toMatchObject({ seed: 3, outputFormat: 'webp' });
  });

  // An explicit dimension must outrank a stored default aspectRatio; the
  // default previously swallowed it, so the caller's width was silently lost.
  it('lets an explicit width override the default aspectRatio', async () => {
    const replicate = fakeReplicate();
    const h = harness({ printifyClient: fakePrintify(), replicateClient: replicate });
    await h.call('generate_and_upload_image', { prompt: 'x', fileName: 'f', width: 512, height: 512 });
    const sent = replicate.generateImage.mock.calls[0][1];
    expect(sent.width).toBe(512);
    expect(sent).not.toHaveProperty('aspectRatio');
  });

  it('still uses the default aspectRatio when no size is requested', async () => {
    const replicate = fakeReplicate();
    const h = harness({ printifyClient: fakePrintify(), replicateClient: replicate });
    await h.call('generate_and_upload_image', { prompt: 'x', fileName: 'f' });
    expect(replicate.generateImage.mock.calls[0][1].aspectRatio).toBe('1:1');
  });

  // Failing before generation avoids paying for an image that cannot be staged.
  it('refuses an Ultra request with no ImgBB key, before generating', async () => {
    const replicate = fakeReplicate();
    const h = harness({ printifyClient: fakePrintify(), replicateClient: replicate });
    const res = await h.call('generate_and_upload_image', { prompt: 'x', fileName: 'f', model: ULTRA });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/IMGBB_API_KEY/);
    expect(replicate.generateImage).not.toHaveBeenCalled();
  });

  it('reports when no shop is selected', async () => {
    const h = harness({
      printifyClient: fakePrintify({ getCurrentShop: () => null }),
      replicateClient: fakeReplicate()
    });
    const res = await h.call('generate_and_upload_image', { prompt: 'x', fileName: 'f' });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/shop/i);
  });

  it('surfaces a generation failure', async () => {
    const h = harness({
      printifyClient: fakePrintify(),
      replicateClient: fakeReplicate({ generateImage: vi.fn(async () => { throw new Error('replicate down'); }) })
    });
    const res = await h.call('generate_and_upload_image', { prompt: 'x', fileName: 'f' });
    expect(res.isError).toBe(true);
  });

  it('surfaces an upload failure', async () => {
    const h = harness({
      printifyClient: fakePrintify({ uploadImage: vi.fn(async () => { throw new Error('printify rejected'); }) }),
      replicateClient: fakeReplicate()
    });
    const res = await h.call('generate_and_upload_image', { prompt: 'x', fileName: 'f' });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/printify rejected/);
  });

  it('requires a Replicate client', async () => {
    const h = harness({ printifyClient: fakePrintify(), replicateClient: null });
    const res = await h.call('generate_and_upload_image', { prompt: 'x', fileName: 'f' });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/Replicate/i);
  });

  it('requires a Printify client', async () => {
    const h = harness({ printifyClient: null, replicateClient: fakeReplicate() });
    const res = await h.call('generate_and_upload_image', { prompt: 'x', fileName: 'f' });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/Printify/i);
  });
});

describe('generate_image', () => {
  it('writes the generated image to the requested path', async () => {
    fs.mkdirSync(scratch, { recursive: true });
    const out = path.join(scratch, 'out.png');
    const h = harness({ printifyClient: fakePrintify(), replicateClient: fakeReplicate() });
    const res = await h.call('generate_image', { prompt: 'a cat', outputPath: out });
    expect(res.isError).toBeFalsy();
    expect(fs.existsSync(out)).toBe(true);
    expect((await sharp(out).metadata()).format).toBe('png');
  });

  it('requires a Replicate client', async () => {
    const h = harness({ replicateClient: null });
    const res = await h.call('generate_image', { prompt: 'x', outputPath: '/tmp/x.png' });
    expect(res.isError).toBe(true);
  });

  it('surfaces a generation failure', async () => {
    fs.mkdirSync(scratch, { recursive: true });
    const h = harness({
      replicateClient: fakeReplicate({ generateImage: vi.fn(async () => { throw new Error('nope'); }) })
    });
    const res = await h.call('generate_image', { prompt: 'x', outputPath: path.join(scratch, 'o.png') });
    expect(res.isError).toBe(true);
  });

  it('reports an unwritable output path', async () => {
    const h = harness({ replicateClient: fakeReplicate() });
    const res = await h.call('generate_image', { prompt: 'x', outputPath: '/proc/nope/x.png' });
    expect(res.isError).toBe(true);
  });
});
