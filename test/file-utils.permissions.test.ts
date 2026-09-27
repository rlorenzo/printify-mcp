import { describe, it, expect, vi, afterEach } from 'vitest';
import * as path from 'node:path';

// The suite runs as root in CI, where chmod cannot produce a real EACCES, so
// lstat is made to fail for one marked segment instead.
const DENIED_SEGMENT = 'no-access-dir';

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    lstatSync: ((p: string, ...rest: any[]) => {
      if (String(p).split(path.sep).includes(DENIED_SEGMENT)) {
        throw Object.assign(new Error(`EACCES: permission denied, lstat '${p}'`), { code: 'EACCES' });
      }
      return (actual.lstatSync as any)(p, ...rest);
    }) as typeof actual.lstatSync
  };
});

const { validateFilePath } = await import('../src/utils/file-utils.js');

const original = process.env.ALLOWED_FILE_DIR;
afterEach(() => {
  if (original === undefined) delete process.env.ALLOWED_FILE_DIR;
  else process.env.ALLOWED_FILE_DIR = original;
});

describe('validateFilePath with an uninspectable segment', () => {
  // A segment that exists but cannot be inspected might be a symlink out of
  // the sandbox; walking past it as if missing would skip that check.
  it('denies rather than treating the segment as missing', () => {
    const target = path.join(process.cwd(), DENIED_SEGMENT, 'x.png');
    expect(() => validateFilePath(target, 'read')).toThrow(/outside the allowed directory/);
  });

  it('still walks past a segment that is genuinely missing', () => {
    const target = path.join(process.cwd(), 'does-not-exist-yet', 'x.png');
    expect(validateFilePath(target, 'write')).toBe(target);
  });
});
