import { describe, it, expect, beforeAll } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

/**
 * Boots the built server over stdio and speaks real JSON-RPC to it.
 *
 * The stdout-purity assertion guards the bug behind upstream issues #3 and #7:
 * any debug output on stdout corrupts the protocol stream and clients drop the
 * connection.
 */
function rpc(requests: object[], timeoutMs = 6000): Promise<{ stdout: string; frames: any[] }> {
  return new Promise((resolve) => {
    const child = spawn('node', ['dist/index.js'], {
      env: { ...process.env, PRINTIFY_API_KEY: '', REPLICATE_API_TOKEN: '' },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', () => { /* logs belong here; ignored */ });

    child.stdin.write(JSON.stringify(requests[0]) + '\n');
    setTimeout(() => {
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
      for (const r of requests.slice(1)) child.stdin.write(JSON.stringify(r) + '\n');
    }, 1200);

    setTimeout(() => {
      child.kill();
      const frames = stdout.split('\n').filter(Boolean)
        .map((l) => { try { return JSON.parse(l); } catch { return null; } })
        .filter(Boolean);
      resolve({ stdout, frames });
    }, timeoutMs - 500);
  });
}

const init = {
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'vitest', version: '1' } }
};

describe('stdio server', () => {
  beforeAll(() => {
    if (!existsSync('dist/index.js')) throw new Error('run `npm run build` before the integration test');
  });

  it('completes a session with zero non-JSON bytes on stdout', async () => {
    const { stdout, frames } = await rpc([
      init,
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { jsonrpc: '2.0', id: 3, method: 'prompts/list' },
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'how_to_use', arguments: { topic: 'product_creation' } } }
    ]);

    const nonJson = stdout.split('\n').filter(Boolean).filter((l) => {
      try { JSON.parse(l); return false; } catch { return true; }
    });
    expect(nonJson).toEqual([]);

    expect(frames.find((f) => f.id === 1)?.result?.serverInfo?.name).toBe('Printify-MCP');
    expect(frames.find((f) => f.id === 2)?.result?.tools).toHaveLength(19);
    expect(frames.find((f) => f.id === 3)?.result?.prompts).toHaveLength(1);

    // Exercises import.meta.url doc resolution, which breaks silently if the
    // docs stop being copied into dist/ or the file moves.
    const docs = frames.find((f) => f.id === 4)?.result;
    expect(docs?.isError).toBeFalsy();
    expect(docs?.content?.[0]?.text?.length).toBeGreaterThan(1000);
  }, 15000);

  it('exposes a valid input schema for every tool', async () => {
    const { frames } = await rpc([init, { jsonrpc: '2.0', id: 2, method: 'tools/list' }]);
    const tools = frames.find((f) => f.id === 2)?.result?.tools ?? [];
    expect(tools.length).toBeGreaterThan(0);
    for (const t of tools) {
      expect(t.inputSchema, `${t.name} has no inputSchema`).toBeTruthy();
      expect(t.inputSchema.type).toBe('object');
    }
  }, 15000);
});
