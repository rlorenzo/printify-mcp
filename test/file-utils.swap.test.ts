import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import * as path from 'node:path';
import * as os from 'node:os';

// A check-then-use race can't be timed from outside, so the swap is staged
// inside openSync: validation has already passed, the open is about to run.
let swapBeforeOpen: ((p: string) => void) | undefined;

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    openSync: ((p: any, ...rest: any[]) => {
      const swap = swapBeforeOpen;
      swapBeforeOpen = undefined;
      swap?.(String(p));
      return (actual.openSync as any)(p, ...rest);
    }) as typeof actual.openSync
  };
});

const fs = await import('fs');
const { readConfinedFile } = await import('../src/utils/file-utils.js');
const { PrintifyAPI } = await import('../src/printify-api.js');

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
