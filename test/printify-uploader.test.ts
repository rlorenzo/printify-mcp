import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import sharp from 'sharp';
import { determineImageSourceType, uploadImageToPrintify } from '../src/services/printify-uploader.js';
import { MAX_UPLOAD_BYTES } from '../src/printify-api.js';

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

  it.each([['/abs/x.png'], ['C:\\x.png'], ['C:/x.png'], ['rel\\x.png'], ['../x.png'], ['iVBORw0KGgoAAAANSUhEUg=='], ['/9j/4AAQSkZJRg==']])('%s is a file', (s) => {
    expect(determineImageSourceType(s)).toBe('file');
  });

  it('treats a data URL as base64', () => {
    expect(determineImageSourceType('data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==')).toBe('base64');
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
    await uploadImageToPrintify(c, 'a.png', 'data:image/png;base64,iVBORw0KGgo=');
    expect(c.uploadImage).toHaveBeenCalledWith('a.png', 'data:image/png;base64,iVBORw0KGgo=');
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

  // The pre-check uses PrintifyAPI's own limit; it once allowed 20MB, which
  // the real read then rejected anyway.
  it('rejects a file over the upload limit before uploading', async () => {
    fs.mkdirSync(scratch, { recursive: true });
    const f = path.join(scratch, 'big.png');
    fs.writeFileSync(f, Buffer.alloc(MAX_UPLOAD_BYTES + 1, 1));
    const c = client();
    const r = await uploadImageToPrintify(c, 'big.png', f);
    expect(r.success).toBe(false);
    // Exact bytes: rounded MB made a file 1 byte over read "10MB. Maximum size is 10MB".
    expect(JSON.stringify(r.errorResponse)).toContain(
      `File is too large (${MAX_UPLOAD_BYTES + 1} bytes). Maximum size is ${MAX_UPLOAD_BYTES} bytes (10MB).`
    );
    expect(c.uploadImage).not.toHaveBeenCalled();
  });

  // file:///C:/... must mean the same path here as in PrintifyAPI on every
  // platform; the uploader once kept the slash on POSIX and refused it as an
  // absolute path outside the sandbox.
  it('accepts a file:// URI with a Windows drive path like PrintifyAPI does', async () => {
    const r = await uploadImageToPrintify(client(), 'w.png', 'file:///C:/nope/missing.png');
    const text = JSON.stringify(r.errorResponse);
    expect(text).not.toMatch(/outside the allowed directory/);
    expect(text).toContain('File not found: C:/nope/missing.png');
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
  it('includes the Printify status but not the response body', async () => {
    const err: any = new Error('rejected');
    err.response = { status: 422, statusText: 'Unprocessable', data: { message: 'body-leak' }, headers: { 'x-leak': 'header-leak' } };
    const c = client({ uploadImage: vi.fn(async () => { throw err; }) });
    const r = await uploadImageToPrintify(c, 'a.png', 'https://example.test/a.png');
    expect(r.success).toBe(false);
    const text = JSON.stringify(r.errorResponse);
    expect(text).toContain('422');
    expect(text).not.toContain('body-leak');
    expect(text).not.toContain('header-leak');
  });

  // Not everything thrown is an Error; building the diagnostics must not
  // itself throw and mask the original failure.
  it.each([['a string', 'upload broke'], ['null', null], ['undefined', undefined]])(
    'reports a thrown %s instead of crashing',
    async (_label, thrown) => {
      const c = client({ uploadImage: vi.fn(async () => { throw thrown; }) });
      const r = await uploadImageToPrintify(c, 'a.png', 'https://example.test/a.png');
      expect(r.success).toBe(false);
      expect(JSON.stringify(r.errorResponse)).toContain(String(thrown));
    }
  );

  // Raw base64 is classified as a file path now, so a failed upload echoes it
  // back as the source -- several times over, via the error message too.
  it('does not echo a long raw source back to the model', async () => {
    const payload = 'A'.repeat(50_000);
    const r = await uploadImageToPrintify(client(), 'a.png', payload);
    expect(r.success).toBe(false);
    const text = (r.errorResponse as any).content[0].text as string;
    expect(text).not.toContain('A'.repeat(201));
    expect(text).toContain('(50000 chars)');
    expect(text.length).toBeLessThan(5000);
  });

  // The final text is capped regardless, but building the diagnostic object
  // still shouldn't embed the whole source: an unbounded Source field alone
  // fills the entire cap, crowding out every field that follows it.
  it('bounds the Source field itself, not just the final text', async () => {
    const payload = 'A '.repeat(30_000);
    const r = await uploadImageToPrintify(client(), 'a.png', payload);
    expect(r.success).toBe(false);
    const text = (r.errorResponse as any).content[0].text as string;
    expect(text).toContain('(60000 chars)');
    expect(text).toContain('NodeVersion');
    expect(text.length).toBeLessThan(3000);
  });

  // The diagnostics go back to the model; a resolved absolute path would
  // reveal the server's working directory for a relative input.
  it('keeps the working directory out of file diagnostics', async () => {
    await pngFile('rel.png');
    const c = client({ uploadImage: vi.fn(async () => { throw new Error('nope'); }) });
    const r = await uploadImageToPrintify(c, 'rel.png', path.join('.tmp-upl-test', 'rel.png'));
    const text = JSON.stringify(r.errorResponse);
    expect(text).toContain('FileExists');
    expect(text).not.toContain(process.cwd());
  });

  // The error quotes the path as given: the resolved form of a relative path
  // would reveal the server's working directory. (A directory or empty file
  // is refused by PrintifyAPI.uploadImage; printify-api.test.ts covers those.)
  it('keeps the working directory out of the error for a missing file', async () => {
    fs.mkdirSync(scratch, { recursive: true });
    const r = await uploadImageToPrintify(client(), 'x.png', path.join('.tmp-upl-test', 'gone.png'));
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.errorResponse)).not.toContain(process.cwd());
  });

  it('reports file diagnostics when a file upload fails', async () => {
    const f = await pngFile('fails.png');
    const c = client({ uploadImage: vi.fn(async () => { throw new Error('nope'); }) });
    const r = await uploadImageToPrintify(c, 'fails.png', f);
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.errorResponse)).toMatch(/FileExists|file path/);
  });

  // saveDebugCopy writes to <cwd>/debug, so this runs from a temporary working
  // directory rather than creating and deleting the repository's real one.
  it('writes a debug copy only when enabled', async () => {
    // realpath: on macOS os.tmpdir() is a symlink, and the uploader compares
    // the source against the resolved working directory.
    const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'printify-upload-')));
    // The uploader restricts reads to the working directory, so the source
    // image has to live inside the sandbox too.
    const f = path.join(sandbox, 'dbg.png');
    fs.writeFileSync(f, await sharp({ create: { width: 4, height: 4, channels: 4, background: { r: 1, g: 1, b: 1, alpha: 1 } } }).png().toBuffer());
    const originalCwd = process.cwd();
    process.env.PRINTIFY_MCP_DEBUG = '1';
    try {
      process.chdir(sandbox);
      const r = await uploadImageToPrintify(client(), 'dbg.png', f);
      expect(r.success).toBe(true);
      expect(fs.existsSync(path.join(sandbox, 'debug'))).toBe(true);
    } finally {
      delete process.env.PRINTIFY_MCP_DEBUG;
      process.chdir(originalCwd);
      fs.rmSync(sandbox, { recursive: true, force: true });
    }
  });

  // readSync throws EISDIR here, which previously skipped closeSync and leaked
  // the descriptor on every such upload.
  it('closes the descriptor when the diagnostic read fails', async () => {
    fs.mkdirSync(scratch, { recursive: true });
    const c = client({ uploadImage: vi.fn(async () => { throw new Error('nope'); }) });
    const before = process.report?.getReport() as any;
    const openBefore = before?.libuv?.filter((h: any) => h.type === 'file').length ?? 0;

    for (let i = 0; i < 5; i++) await uploadImageToPrintify(c, 'dir.png', scratch);

    const after = process.report?.getReport() as any;
    const openAfter = after?.libuv?.filter((h: any) => h.type === 'file').length ?? 0;
    expect(openAfter).toBe(openBefore);

    const r = await uploadImageToPrintify(c, 'dir.png', scratch);
    expect(JSON.stringify(r.errorResponse)).toMatch(/EISDIR|FileReadable/);
  });

  it('tailors tips to a base64 source', async () => {
    const c = client({ uploadImage: vi.fn(async () => { throw new Error('bad'); }) });
    const r = await uploadImageToPrintify(c, 'a.png', 'data:image/png;base64,iVBORw0KGgo=');
    expect(JSON.stringify(r.errorResponse)).toMatch(/base64/);
  });
});
