import { describe, it, expect, vi } from 'vitest';
import { harness } from './helpers/harness.js';
import { DefaultsManager } from '../src/model-manager.js';

/** A Replicate client backed by a real DefaultsManager, so defaults actually move. */
function replicateWithDefaults(dm: DefaultsManager, overrides: Record<string, any> = {}) {
  return {
    getDefaultsManager: () => dm,
    getDefaultModel: () => dm.getDefault('model'),
    getAllDefaults: () => dm.getAllDefaults(),
    getDefault: (k: string) => dm.getDefault(k),
    setDefault: (k: string, v: any) => dm.setDefault(k, v),
    getAvailableModels: () => dm.getAvailableModels(),
    ...overrides
  } as any;
}

/** A context wired the way bootstrap wires it: one manager, shared with the client. */
function withClient(overrides: Record<string, any> = {}) {
  const defaultsManager = new DefaultsManager();
  return {
    defaultsManager,
    replicateClient: replicateWithDefaults(defaultsManager, overrides)
  };
}

describe('get_defaults', () => {
  it('lists the current defaults', async () => {
    const h = harness(withClient());
    const res = await h.call('get_defaults', {});
    expect(res.isError).toBeFalsy();
    expect(res.content[0].text).toContain('flux-1.1-pro-ultra');
  });

  // Regression: the defaults are local state, but the tool was gated on the
  // Replicate client, so an unset REPLICATE_API_TOKEN made it fail outright.
  it('works with no Replicate client', async () => {
    const res = await harness({ replicateClient: null }).call('get_defaults', {});
    expect(res.isError).toBeFalsy();
    expect(res.content[0].text).toContain('flux-1.1-pro-ultra');
  });

  it('says image generation is unavailable when there is no client', async () => {
    const res = await harness({ replicateClient: null }).call('get_defaults', {});
    expect(res.content[0].text).toContain('REPLICATE_API_TOKEN');
  });

  it('adds no such note when a client is configured', async () => {
    const res = await harness(withClient()).call('get_defaults', {});
    expect(res.content[0].text).not.toContain('REPLICATE_API_TOKEN');
  });
});

describe('set_default', () => {
  it('applies a valid change', async () => {
    const ctx = withClient();
    const h = harness(ctx);
    const res = await h.call('set_default', { option: 'outputFormat', value: 'webp' });
    expect(res.isError).toBeFalsy();
    expect(ctx.defaultsManager.getDefault('outputFormat')).toBe('webp');
  });

  // The client and the context must share one manager, or a default set here
  // would never reach image generation.
  it('reaches the Replicate client', async () => {
    const ctx = withClient();
    await harness(ctx).call('set_default', { option: 'outputFormat', value: 'webp' });
    expect(ctx.replicateClient.getDefault('outputFormat')).toBe('webp');
  });

  it('reports a rejected value without throwing', async () => {
    const h = harness(withClient());
    const res = await h.call('set_default', { option: 'outputFormat', value: 'gif' });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/Invalid output format/);
  });

  it('reports an invalid model id', async () => {
    const h = harness(withClient());
    const res = await h.call('set_default', { option: 'model', value: 'not/a-model' });
    expect(res.isError).toBe(true);
  });

  it('works with no Replicate client, and the change sticks', async () => {
    const h = harness({ replicateClient: null });
    const res = await h.call('set_default', { option: 'raw', value: true });
    expect(res.isError).toBeFalsy();
    const after = await h.call('get_defaults', {});
    expect(after.content[0].text).toMatch(/\| raw \| true \|/);
  });

  it('still validates with no Replicate client', async () => {
    const res = await harness({ replicateClient: null }).call('set_default', { option: 'outputFormat', value: 'gif' });
    expect(res.isError).toBe(true);
  });

  it('surfaces an unexpected failure from the defaults store', async () => {
    const defaultsManager = new DefaultsManager();
    vi.spyOn(defaultsManager, 'setDefault').mockImplementation(() => { throw new Error('storage broke'); });
    const res = await harness({ defaultsManager }).call('set_default', { option: 'raw', value: true });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/storage broke/);
  });
});
