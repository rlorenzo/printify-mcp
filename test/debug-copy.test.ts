import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { saveDebugCopy } from '../src/services/image-format.js';

/**
 * saveDebugCopy writes to `<cwd>/debug`, which in the repository is the real
 * debug-output directory. These tests run from a temporary working directory so
 * they never read or delete a developer's actual debug files.
 */
let sandbox: string;
let originalCwd: string;
let debugDir: string;

beforeAll(() => {
  originalCwd = process.cwd();
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'printify-debug-'));
  process.chdir(sandbox);
  debugDir = path.join(sandbox, 'debug');
});

afterAll(() => {
  process.chdir(originalCwd);
  fs.rmSync(sandbox, { recursive: true, force: true });
});

afterEach(() => {
  delete process.env.PRINTIFY_MCP_DEBUG;
  fs.rmSync(debugDir, { recursive: true, force: true });
});

describe('saveDebugCopy', () => {
  it('writes nothing unless explicitly enabled', async () => {
    await saveDebugCopy(Buffer.from('x'), 'a.png');
    expect(fs.existsSync(debugDir)).toBe(false);
  });

  it('writes a copy when enabled', async () => {
    process.env.PRINTIFY_MCP_DEBUG = '1';
    await saveDebugCopy(Buffer.from('payload'), 'a.png');
    const files = fs.readdirSync(debugDir);
    expect(files).toHaveLength(1);
    expect(fs.readFileSync(path.join(debugDir, files[0])).toString()).toBe('payload');
  });

  // fileName arrives from tool arguments, so traversal segments must not let a
  // caller steer the write outside debugDir.
  it('strips directory segments from the file name', async () => {
    process.env.PRINTIFY_MCP_DEBUG = '1';
    await saveDebugCopy(Buffer.from('payload'), '../../escaped.png');
    const files = fs.readdirSync(debugDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^debug_\d+_escaped\.png$/);
    expect(fs.existsSync(path.join(sandbox, '..', 'escaped.png'))).toBe(false);
  });

  it('handles a missing buffer without throwing', async () => {
    process.env.PRINTIFY_MCP_DEBUG = '1';
    await expect(saveDebugCopy(undefined, 'a.png')).resolves.toBeUndefined();
  });

  // A failed debug write must never abort the upload it was meant to diagnose.
  it('swallows a write failure', async () => {
    process.env.PRINTIFY_MCP_DEBUG = '1';
    fs.writeFileSync(debugDir, 'not a directory');
    await expect(saveDebugCopy(Buffer.from('x'), 'a.png')).resolves.toBeUndefined();
    fs.rmSync(debugDir, { force: true });
  });
});
