import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initializeClients } from '../src/bootstrap.js';
import { PrintifyAPI } from '../src/printify-api.js';
import { ReplicateClient } from '../src/replicate-client.js';
import type { PrintifyContext } from '../src/tools.js';

const ctx = (): PrintifyContext => ({ printifyClient: null, replicateClient: null });
const shops = [{ id: 7, title: 'Shop Seven' }];

beforeEach(() => vi.restoreAllMocks());

describe('initializeClients', () => {
  it('leaves both clients null when nothing is configured', async () => {
    const c = await initializeClients(ctx(), {});
    expect(c.printifyClient).toBeNull();
    expect(c.replicateClient).toBeNull();
  });

  it('creates only the Replicate client when only its token is set', async () => {
    const c = await initializeClients(ctx(), { REPLICATE_API_TOKEN: 't' });
    expect(c.printifyClient).toBeNull();
    expect(c.replicateClient).toBeInstanceOf(ReplicateClient);
  });

  it('creates and initializes the Printify client', async () => {
    vi.spyOn(PrintifyAPI.prototype, 'initialize').mockResolvedValue(shops as any);
    vi.spyOn(PrintifyAPI.prototype, 'getCurrentShop').mockReturnValue(shops[0] as any);
    const c = await initializeClients(ctx(), { PRINTIFY_API_KEY: 'k' });
    expect(c.printifyClient).toBeInstanceOf(PrintifyAPI);
  });

  it('selects the first shop when initialize picked none', async () => {
    vi.spyOn(PrintifyAPI.prototype, 'initialize').mockResolvedValue(shops as any);
    vi.spyOn(PrintifyAPI.prototype, 'getCurrentShop').mockReturnValue(null as any);
    const setShopId = vi.spyOn(PrintifyAPI.prototype, 'setShopId').mockImplementation(() => {});
    await initializeClients(ctx(), { PRINTIFY_API_KEY: 'k' });
    expect(setShopId).toHaveBeenCalledWith('7');
  });

  it('tolerates an account with no shops', async () => {
    vi.spyOn(PrintifyAPI.prototype, 'initialize').mockResolvedValue([] as any);
    vi.spyOn(PrintifyAPI.prototype, 'getCurrentShop').mockReturnValue(null as any);
    const c = await initializeClients(ctx(), { PRINTIFY_API_KEY: 'k' });
    expect(c.printifyClient).toBeInstanceOf(PrintifyAPI);
  });

  // A server that refuses to start is worse than one whose tools each report
  // their own unavailability.
  it('does not throw when Printify is unreachable', async () => {
    vi.spyOn(PrintifyAPI.prototype, 'initialize').mockRejectedValue(new Error('network down'));
    const c = await initializeClients(ctx(), { PRINTIFY_API_KEY: 'k', REPLICATE_API_TOKEN: 't' });
    expect(c.printifyClient).toBeInstanceOf(PrintifyAPI);
    // The two clients initialize independently, so a Printify outage must not
    // take the Replicate-backed image tools down with it.
    expect(c.replicateClient).toBeInstanceOf(ReplicateClient);
  });

  it('passes a configured shop id through', async () => {
    vi.spyOn(PrintifyAPI.prototype, 'initialize').mockResolvedValue(shops as any);
    vi.spyOn(PrintifyAPI.prototype, 'getCurrentShop').mockReturnValue(shops[0] as any);
    const c = await initializeClients(ctx(), { PRINTIFY_API_KEY: 'k', PRINTIFY_SHOP_ID: '99' });
    expect(c.printifyClient?.getCurrentShopId()).toBe('99');
  });
});
