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

const PRO_DEFAULTS = {
  model: PRO, width: 1024, height: 1024, aspectRatio: '1:1', outputFormat: 'png',
  safetyTolerance: 2, numInferenceSteps: 25, guidanceScale: 7.5,
  negativePrompt: 'low quality', raw: false, promptUpsampling: true, outputQuality: 90
};

/**
 * Stands in for the defaults the context owns. The real client exposes the same
 * manager through getDefaultsManager(), which is where the tools read from.
 */
function fakeDefaults(values: Record<string, any> = PRO_DEFAULTS) {
  const defaults = { ...values };
  return {
    getDefault: (k: string) => defaults[k],
    getAllDefaults: () => ({ ...defaults }),
    setDefault: (k: string, v: any) => { defaults[k] = v; },
    getAvailableModels: () => []
  } as any;
}

function fakeReplicate(overrides: Record<string, any> = {}) {
  const defaults = fakeDefaults();
  return {
    getDefaultsManager: () => defaults,
    getDefaultModel: () => defaults.getDefault('model'),
    getAllDefaults: () => defaults.getAllDefaults(),
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

  // The response body can echo request data, so only the status reaches the model.
  it('reports the HTTP status of an upload failure but not the response body', async () => {
    const err = Object.assign(new Error('bad request'), { response: { status: 400, data: { secret: 'body-leak' } } });
    const h = harness({
      printifyClient: fakePrintify({ uploadImage: vi.fn(async () => { throw err; }) }),
      replicateClient: fakeReplicate()
    });
    const res = await h.call('generate_and_upload_image', { prompt: 'x', fileName: 'f' });
    expect(res.content[0].text).toContain('HTTP status: 400');
    expect(res.content[0].text).not.toContain('body-leak');
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

  it('refuses an output path outside ALLOWED_FILE_DIR', async () => {
    fs.mkdirSync(scratch, { recursive: true });
    process.env.ALLOWED_FILE_DIR = scratch;
    try {
      const replicate = fakeReplicate();
      const out = path.join(scratch, '..', '.tmp-escape.png');
      const res = await harness({ replicateClient: replicate }).call('generate_image', { prompt: 'x', outputPath: out });
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toMatch(/outside the allowed directory/);
      expect(replicate.generateImage).not.toHaveBeenCalled();
      expect(fs.existsSync(out)).toBe(false);
    } finally {
      delete process.env.ALLOWED_FILE_DIR;
    }
  });

  // The denial echoes outputPath, which is model-supplied and can be any
  // length; spaces in it defeat the long-run collapsing. The reply must stay
  // small and still say why the path was refused.
  it('bounds the error text when a huge outputPath is refused', async () => {
    const out = '/outside/' + 'dir with spaces/'.repeat(5_000) + 'x.png';
    const res = await harness({ replicateClient: fakeReplicate() }).call('generate_image', { prompt: 'x', outputPath: out });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/outside the allowed directory/);
    expect(res.content[0].text.length).toBeLessThan(1000);
  });

  // CWE-367: outputPath is validated before the (often slow) Replicate call,
  // then written after it. On POSIX, O_NOFOLLOW refuses to write through a
  // symlink swapped in during that window instead of silently following it.
  it('rejects a symlink swapped in for outputPath during generation', async () => {
    if (process.platform === 'win32') return; // O_NOFOLLOW is a no-op there; see the comment in tools.ts.
    fs.mkdirSync(scratch, { recursive: true });
    const out = path.join(scratch, 'out.png');
    const target = path.join(scratch, 'target.png');
    const replicate = fakeReplicate({
      generateImage: vi.fn(async () => {
        fs.symlinkSync(target, out); // out doesn't exist yet: validation already ran, the write hasn't.
        return await png();
      })
    });
    const res = await harness({ replicateClient: replicate }).call('generate_image', { prompt: 'x', outputPath: out });
    expect(res.isError).toBe(true);
    expect(fs.existsSync(target)).toBe(false);
  });

  // The confinement check at the top of the handler is stale by the time the
  // write happens; re-validating right before the write is what actually
  // enforces ALLOWED_FILE_DIR if it changes while generation is in flight.
  it('re-validates against ALLOWED_FILE_DIR right before writing', async () => {
    fs.mkdirSync(scratch, { recursive: true });
    process.env.ALLOWED_FILE_DIR = scratch;
    const out = path.join(scratch, 'out.png');
    try {
      const replicate = fakeReplicate({
        generateImage: vi.fn(async () => {
          const narrower = path.join(scratch, 'narrower');
          fs.mkdirSync(narrower, { recursive: true });
          process.env.ALLOWED_FILE_DIR = narrower; // sandbox narrows mid-flight
          return await png();
        })
      });
      const res = await harness({ replicateClient: replicate }).call('generate_image', { prompt: 'x', outputPath: out });
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toMatch(/outside the allowed directory/);
      expect(fs.existsSync(out)).toBe(false);
    } finally {
      delete process.env.ALLOWED_FILE_DIR;
    }
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

  // The parent of the output path is a regular file, so creating the directory
  // fails with ENOTDIR. Using a real file rather than a special path such as
  // /proc keeps the case identical on macOS and Linux.
  it('reports an unwritable output path', async () => {
    fs.mkdirSync(scratch, { recursive: true });
    const blocker = path.join(scratch, 'not-a-dir');
    fs.writeFileSync(blocker, 'x');
    const h = harness({ replicateClient: fakeReplicate() });
    const res = await h.call('generate_image', { prompt: 'x', outputPath: path.join(blocker, 'x.png') });
    expect(res.isError).toBe(true);
  });
});
