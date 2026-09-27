import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import * as path from 'node:path';
import * as os from 'node:os';

// A check-then-use race can't be timed from outside, so the swap is staged
// inside openSync: validation has already passed, the open is about to run.
// `opensBeforeSwap` lets the swap land on a later open of the same upload.
let swapBeforeOpen: ((p: string) => void) | undefined;
let opensBeforeSwap = 0;

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    openSync: ((p: any, ...rest: any[]) => {
      if (swapBeforeOpen && opensBeforeSwap-- <= 0) {
        const swap = swapBeforeOpen;
        swapBeforeOpen = undefined;
        swap(String(p));
      }
      return (actual.openSync as any)(p, ...rest);
    }) as typeof actual.openSync
  };
});

const fs = await import('fs');
const { readConfinedFile } = await import('../src/utils/file-utils.js');
const { PrintifyAPI } = await import('../src/printify-api.js');
const { uploadImageToPrintify } = await import('../src/services/printify-uploader.js');

const inside = path.join(process.cwd(), '.tmp-swap-test');
let outside: string;

beforeEach(() => {
  fs.mkdirSync(path.join(inside, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(inside, 'sub', 'a.png'), 'INSIDE');
  outside = fs.mkdtempSync(path.join(os.tmpdir(), 'swap-outside-'));
  fs.writeFileSync(path.join(outside, 'a.png'), 'SECRET');
});

afterEach(() => {
  swapBeforeOpen = undefined;
  opensBeforeSwap = 0;
  delete process.env.PRINTIFY_MCP_DEBUG;
  fs.rmSync(inside, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

describe('readConfinedFile', () => {
  it('reads a file inside the sandbox', () => {
    const { data } = readConfinedFile(path.join(inside, 'sub', 'a.png'), 1024);
    expect(data.toString()).toBe('INSIDE');
  });

  // Final component swapped for a symlink after validation: O_NOFOLLOW
  // refuses it rather than following it out of the sandbox.
  it('refuses a file swapped for a symlink after validation', () => {
    if (process.platform === 'win32') return; // No O_NOFOLLOW there.
    const target = path.join(inside, 'sub', 'a.png');
    swapBeforeOpen = () => {
      fs.rmSync(target);
      fs.symlinkSync(path.join(outside, 'a.png'), target);
    };
    expect(() => readConfinedFile(target, 1024)).toThrow(/denied/);
  });

  // A parent directory swapped for a symlink is followed by the open itself;
  // the post-open re-validation is what catches it.
  it('refuses a parent directory swapped for a symlink after validation', () => {
    const target = path.join(inside, 'sub', 'a.png');
    swapBeforeOpen = () => {
      fs.renameSync(path.join(inside, 'sub'), path.join(inside, 'sub-orig'));
      fs.symlinkSync(outside, path.join(inside, 'sub'));
    };
    expect(() => readConfinedFile(target, 1024)).toThrow(/denied/);
  });
});

describe('PrintifyAPI.uploadImage', () => {
  it('uploads nothing when the source is swapped out of the sandbox', async () => {
    const instance = new PrintifyAPI('token', '42');
    const uploadImage = vi.fn();
    (instance as any).client = { uploads: { uploadImage } };
    const target = path.join(inside, 'sub', 'a.png');
    swapBeforeOpen = () => {
      fs.renameSync(path.join(inside, 'sub'), path.join(inside, 'sub-orig'));
      fs.symlinkSync(outside, path.join(inside, 'sub'));
    };
    await expect(instance.uploadImage('a.png', target)).rejects.toThrow(/denied/);
    expect(uploadImage).not.toHaveBeenCalled();
  });
});

// Swap the parent directory for a symlink to `outside`, as an attacker racing
// the check would.
function swapParentOut() {
  fs.renameSync(path.join(inside, 'sub'), path.join(inside, 'sub-orig'));
  fs.symlinkSync(outside, path.join(inside, 'sub'));
}

function failingClient() {
  return {
    getCurrentShop: () => ({ id: 1, title: 'Shop' }),
    getCurrentShopId: () => '1',
    getAvailableShops: () => [],
    uploadImage: vi.fn(async () => { throw new Error('rejected'); })
  } as any;
}

describe('uploadImageToPrintify', () => {
  // The failed upload's diagnostics read the file's first bytes into the
  // reply to the model; a swap before that open must not expose them.
  it('keeps a swapped-in file out of the error diagnostics', async () => {
    opensBeforeSwap = 1; // let verifyFileReadable's open through, swap on the diagnostics'
    swapBeforeOpen = swapParentOut;
    const r = await uploadImageToPrintify(failingClient(), 'a.png', path.join(inside, 'sub', 'a.png'));
    expect(r.success).toBe(false);
    const text = JSON.stringify(r.errorResponse);
    expect(text).not.toContain(Buffer.from('SECRET').toString('hex'));
    expect(text).toContain('PathRejected');
  });

  // With debugging on, the pre-upload check writes the file's bytes to debug/;
  // a swapped-in file must never be the one copied there.
  it('never writes a swapped-in file to the debug copy', async () => {
    process.env.PRINTIFY_MCP_DEBUG = '1';
    const debugDir = path.join(process.cwd(), 'debug');
    const before = new Set(fs.existsSync(debugDir) ? fs.readdirSync(debugDir) : []);
    swapBeforeOpen = swapParentOut;
    try {
      await uploadImageToPrintify(failingClient(), 'a.png', path.join(inside, 'sub', 'a.png'));
      const added = (fs.existsSync(debugDir) ? fs.readdirSync(debugDir) : []).filter(f => !before.has(f));
      try {
        for (const f of added) {
          expect(fs.readFileSync(path.join(debugDir, f), 'utf8')).not.toBe('SECRET');
        }
      } finally {
        for (const f of added) fs.rmSync(path.join(debugDir, f), { force: true });
      }
    } finally {
      if (before.size === 0) fs.rmSync(debugDir, { recursive: true, force: true });
    }
  });
});
