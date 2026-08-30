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

    const wantedIds = requests.map((r: any) => r.id).filter((id) => id !== undefined);
    let stdout = '';
    let handshakeDone = false;
    let closing = false;
    let forceKill: NodeJS.Timeout;

    // Resolution always happens on 'close', never on a timer: the parent owns
    // child.stdin, and leaving that pipe open keeps the vitest worker's event
    // loop alive long after the assertions pass. Ending stdin is also the
    // server's own shutdown signal, so SIGKILL is only a backstop.
    const shutdown = () => {
      if (closing) return;
      closing = true;
      clearTimeout(deadline);
      child.stdin.end();
      forceKill = setTimeout(() => child.kill('SIGKILL'), 1000);
    };

    child.once('close', () => {
      clearTimeout(deadline);
      clearTimeout(forceKill);
      resolve({ stdout, frames: parseFrames(stdout) });
    });

    const deadline = setTimeout(shutdown, timeoutMs);

    // The protocol requires the initialize response before anything else is
    // sent, so the session is driven by the frames that arrive rather than by a
    // fixed delay a slow machine can outrun.
    child.stdout.on('data', (d) => {
      // stdin is already ended once shutdown() runs, so a late frame taking the
      // handshake branch below would write to a closed pipe and fail the worker.
      if (closing) return;
      stdout += d;
      const frames = parseFrames(stdout);

      if (!handshakeDone && frames.some((f) => f.id === 1 && f.result !== undefined)) {
        handshakeDone = true;
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
        for (const r of requests.slice(1)) child.stdin.write(JSON.stringify(r) + '\n');
      }

      if (handshakeDone && wantedIds.every((id) => frames.some((f) => f.id === id))) shutdown();
    });
    child.stderr.on('data', () => { /* logs belong here; ignored */ });

    child.stdin.write(JSON.stringify(requests[0]) + '\n');
  });
}

/** Every line of stdout, minus only the trailing newline of the last frame. */
function stdoutLines(stdout: string): string[] {
  return stdout.replace(/\n$/, '').split('\n');
}

function parseFrames(stdout: string): any[] {
  return stdoutLines(stdout)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
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

    // Blank lines count: anything on stdout that is not a JSON-RPC frame
    // corrupts the stream, so only the final framing newline is stripped.
    const nonJson = stdoutLines(stdout).filter((l) => {
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
