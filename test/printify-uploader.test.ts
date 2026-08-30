import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import sharp from 'sharp';
import { determineImageSourceType, uploadImageToPrintify } from '../src/services/printify-uploader.js';

const scratch = path.join(process.cwd(), '.tmp-upl-test');
afterEach(() => fs.rmSync(scratch, { recursive: true, force: true }));

async function pngFile(name: string) {
  fs.mkdirSync(scratch, { recursive: true });
  const f = path.join(scratch, name);
  fs.writeFileSync(f, await sharp({ create: { width: 4, height: 4, channels: 4, background: { r: 1, g: 1, b: 1, alpha: 1 } } }).png().toBuffer());
  return f;
}

function client(overrides: Record<string, any> = {}) {
  return {
    getCurrentShop: () => ({ id: 1, title: 'Shop' }),
    // Used only by the error path's diagnostics.
    getCurrentShopId: () => '1',
    getAvailableShops: () => [{ id: 1, title: 'Shop' }],
    uploadImage: vi.fn(async (fileName: string) => ({
      id: 'img_1', file_name: fileName, width: 4, height: 4, preview_url: 'https://example.test/p.png'
    })),
    ...overrides
  } as any;
}

describe('determineImageSourceType', () => {
  it.each([['https://a/b.png'], ['http://a/b.png']])('%s is a url', (s) => {
    expect(determineImageSourceType(s)).toBe('url');
  });

  it.each([['/abs/x.png'], ['C:\\x.png'], ['C:/x.png'], ['rel\\x.png']])('%s is a file', (s) => {
    expect(determineImageSourceType(s)).toBe('file');
  });

  it('falls back to base64', () => {
    expect(determineImageSourceType('iVBORw0KGgoAAAANSUhEUg==')).toBe('base64');
  });
});

describe('uploadImageToPrintify', () => {
  it('uploads a URL directly without touching the filesystem', async () => {
    const c = client();
    const r = await uploadImageToPrintify(c, 'a.png', 'https://example.test/a.png');
    expect(r.success).toBe(true);
    expect(c.uploadImage).toHaveBeenCalledWith('a.png', 'https://example.test/a.png');
  });

  it('uploads a base64 payload directly', async () => {
    const c = client();
    await uploadImageToPrintify(c, 'a.png', 'iVBORw0KGgo=');
    expect(c.uploadImage).toHaveBeenCalledWith('a.png', 'iVBORw0KGgo=');
  });

  it('verifies and uploads a real file', async () => {
    const f = await pngFile('ok.png');
    const c = client();
    const r = await uploadImageToPrintify(c, 'ok.png', f);
    expect(r.success).toBe(true);
    expect(c.uploadImage).toHaveBeenCalledWith('ok.png', f);
  });

  it('fails when no shop is selected', async () => {
    const r = await uploadImageToPrintify(client({ getCurrentShop: () => null }), 'a.png', 'https://a/b.png');
    expect(r.success).toBe(false);
  });

  it('fails for a missing file', async () => {
    fs.mkdirSync(scratch, { recursive: true });
    const r = await uploadImageToPrintify(client(), 'x.png', path.join(scratch, 'gone.png'));
    expect(r.success).toBe(false);
  });

  // The traversal guard runs before any read.
  it('refuses a path outside the allowed directory', async () => {
    const r = await uploadImageToPrintify(client(), 'p.png', '/etc/passwd');
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.errorResponse)).toMatch(/outside the allowed directory/);
  });

  it('rejects a file over the 20MB limit', async () => {
    fs.mkdirSync(scratch, { recursive: true });
    const f = path.join(scratch, 'big.png');
    fs.writeFileSync(f, Buffer.alloc(20 * 1024 * 1024 + 1, 1));
    const r = await uploadImageToPrintify(client(), 'big.png', f);
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.errorResponse)).toMatch(/too large/);
  });

  it('surfaces an SDK upload failure', async () => {
    const c = client({ uploadImage: vi.fn(async () => { throw new Error('api rejected'); }) });
    const r = await uploadImageToPrintify(c, 'a.png', 'https://example.test/a.png');
    expect(r.success).toBe(false);
  });

  it('reports the image id and preview url on success', async () => {
    const r = await uploadImageToPrintify(client(), 'a.png', 'https://example.test/a.png');
    const text = JSON.stringify(r.response);
    expect(text).toContain('img_1');
    expect(text).toContain('https://example.test/p.png');
  });
});

describe('uploadImageToPrintify diagnostics', () => {
  it('includes Printify response detail when the API returns one', async () => {
    const err: any = new Error('rejected');
    err.response = { status: 422, statusText: 'Unprocessable', data: { message: 'bad image' }, headers: {} };
    const c = client({ uploadImage: vi.fn(async () => { throw err; }) });
    const r = await uploadImageToPrintify(c, 'a.png', 'https://example.test/a.png');
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.errorResponse)).toContain('422');
  });

  it('reports file diagnostics when a file upload fails', async () => {
    const f = await pngFile('fails.png');
    const c = client({ uploadImage: vi.fn(async () => { throw new Error('nope'); }) });
    const r = await uploadImageToPrintify(c, 'fails.png', f);
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.errorResponse)).toMatch(/FileExists|file path/);
  });

  it('writes a debug copy only when enabled', async () => {
    const f = await pngFile('dbg.png');
    process.env.PRINTIFY_MCP_DEBUG = '1';
    try {
      const r = await uploadImageToPrintify(client(), 'dbg.png', f);
      expect(r.success).toBe(true);
      expect(fs.existsSync(path.join(process.cwd(), 'debug'))).toBe(true);
    } finally {
      delete process.env.PRINTIFY_MCP_DEBUG;
      fs.rmSync(path.join(process.cwd(), 'debug'), { recursive: true, force: true });
    }
  });

  it('tailors tips to a base64 source', async () => {
    const c = client({ uploadImage: vi.fn(async () => { throw new Error('bad'); }) });
    const r = await uploadImageToPrintify(c, 'a.png', 'iVBORw0KGgo=');
    expect(JSON.stringify(r.errorResponse)).toMatch(/base64/);
  });
});
