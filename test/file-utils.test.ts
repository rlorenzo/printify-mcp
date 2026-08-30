import { describe, it, expect, afterEach } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import {
  validateFilePath,
  ensureDirectoryExists,
  generateTempFilePath,
  getFileInfo,
  cleanupFiles
} from '../src/utils/file-utils.js';

const original = process.env.ALLOWED_FILE_DIR;
afterEach(() => {
  if (original === undefined) delete process.env.ALLOWED_FILE_DIR;
  else process.env.ALLOWED_FILE_DIR = original;
});

describe('validateFilePath', () => {
  it('allows a path inside the working directory', () => {
    expect(validateFilePath('./README.md', 'read')).toBe(path.resolve('README.md'));
  });

  it('allows the base directory itself', () => {
    process.env.ALLOWED_FILE_DIR = '/tmp/allowed';
    expect(validateFilePath('/tmp/allowed', 'read')).toBe(path.resolve('/tmp/allowed'));
  });

  // Tool arguments reach this server from a model, so traversal is reachable
  // input rather than a hypothetical.
  it.each([
    ['../../../etc/passwd'],
    ['/etc/passwd'],
    ['/root/.ssh/id_rsa']
  ])('refuses %s', (candidate) => {
    expect(() => validateFilePath(candidate, 'read')).toThrow(/outside the allowed directory/);
  });

  it('refuses a sibling directory sharing the base name prefix', () => {
    process.env.ALLOWED_FILE_DIR = '/tmp/allowed';
    // /tmp/allowed-evil must not pass a naive startsWith check.
    expect(() => validateFilePath('/tmp/allowed-evil/x', 'read')).toThrow(/outside the allowed directory/);
  });

  it('names the operation in the error', () => {
    expect(() => validateFilePath('/etc/passwd', 'write')).toThrow(/File write denied/);
  });
});

describe('file helpers', () => {
  const scratch = path.join(process.cwd(), '.tmp-test');

  afterEach(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  it('creates a directory only when missing', () => {
    expect(fs.existsSync(scratch)).toBe(false);
    ensureDirectoryExists(scratch);
    expect(fs.existsSync(scratch)).toBe(true);
    // Second call must not throw on an existing directory.
    ensureDirectoryExists(scratch);
    expect(fs.existsSync(scratch)).toBe(true);
  });

  it('generates a unique, absolute temp path and creates its directory', () => {
    const a = generateTempFilePath(scratch, 'img');
    const b = generateTempFilePath(scratch, 'img');
    expect(path.isAbsolute(a)).toBe(true);
    expect(a.endsWith('.png')).toBe(true);
    expect(a).not.toBe(b);
    expect(fs.existsSync(scratch)).toBe(true);
  });

  it('honours a custom extension', () => {
    expect(generateTempFilePath(scratch, 'img', 'webp').endsWith('.webp')).toBe(true);
  });

  it('reports size for an existing file and absence otherwise', () => {
    fs.mkdirSync(scratch, { recursive: true });
    const f = path.join(scratch, 'a.txt');
    fs.writeFileSync(f, 'hello');
    expect(getFileInfo(f)).toMatchObject({ exists: true, size: 5 });
    expect(getFileInfo(path.join(scratch, 'nope.txt'))).toEqual({ exists: false });
    expect(getFileInfo('')).toEqual({ exists: false });
  });

  it('removes existing files and ignores missing ones', () => {
    fs.mkdirSync(scratch, { recursive: true });
    const f = path.join(scratch, 'b.txt');
    fs.writeFileSync(f, 'x');
    expect(() => cleanupFiles([f, path.join(scratch, 'ghost.txt'), ''])).not.toThrow();
    expect(fs.existsSync(f)).toBe(false);
  });
});
