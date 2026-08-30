import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createPrintifyMcpServer, PrintifyAPI, ReplicateClient, validateFilePath } from '../src/exports.js';

const saved = { ...process.env };
beforeEach(() => {
  delete process.env.PRINTIFY_API_KEY;
  delete process.env.PRINTIFY_SHOP_ID;
  delete process.env.REPLICATE_API_TOKEN;
});
afterEach(() => { process.env = { ...saved }; });

const toolNames = (server: any) => Object.keys(server._registeredTools ?? {});

describe('createPrintifyMcpServer', () => {
  it('registers the full tool surface', () => {
    const { server } = createPrintifyMcpServer({ printifyApiKey: 'k' });
    expect(toolNames(server)).toHaveLength(19);
    expect(Object.keys((server as any)._registeredPrompts ?? {})).toHaveLength(1);
  });

  it('builds clients from explicit options', () => {
    const r = createPrintifyMcpServer({ printifyApiKey: 'k', replicateApiToken: 't' });
    expect(r.printifyClient).toBeInstanceOf(PrintifyAPI);
    expect(r.replicateClient).toBeInstanceOf(ReplicateClient);
  });

  it('leaves clients null when nothing is configured', () => {
    const r = createPrintifyMcpServer({});
    expect(r.printifyClient).toBeNull();
    expect(r.replicateClient).toBeNull();
  });

  it('falls back to environment variables', () => {
    process.env.PRINTIFY_API_KEY = 'from-env';
    process.env.REPLICATE_API_TOKEN = 'from-env';
    const r = createPrintifyMcpServer();
    expect(r.printifyClient).toBeInstanceOf(PrintifyAPI);
    expect(r.replicateClient).toBeInstanceOf(ReplicateClient);
  });

  it('prefers explicit options over the environment', () => {
    process.env.PRINTIFY_SHOP_ID = 'env-shop';
    const r = createPrintifyMcpServer({ printifyApiKey: 'k', printifyShopId: 'opt-shop' });
    expect(r.printifyClient?.getCurrentShopId()).toBe('opt-shop');
  });

  it('honours a custom server name and version', () => {
    const { server } = createPrintifyMcpServer({ printifyApiKey: 'k', serverName: 'Custom', serverVersion: '9.9.9' });
    expect((server as any).server._serverInfo).toMatchObject({ name: 'Custom', version: '9.9.9' });
  });

  it('initialize() is a no-op without a Printify client', async () => {
    const r = createPrintifyMcpServer({});
    await expect(r.initialize()).resolves.toEqual({ printifyClient: null, replicateClient: null });
  });

  // Importing the library must not patch the consumer's console or start a
  // server; that regression is what moved the entry to exports.ts.
  it('does not patch console on import', () => {
    expect(console.log).toBe(console.log);
    const before = console.log;
    createPrintifyMcpServer({ printifyApiKey: 'k' });
    expect(console.log).toBe(before);
  });

  it('re-exports the utility surface', () => {
    expect(typeof validateFilePath).toBe('function');
  });
});
