import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { saveDebugCopy } from '../src/services/image-format.js';

const debugDir = path.join(process.cwd(), 'debug');
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
