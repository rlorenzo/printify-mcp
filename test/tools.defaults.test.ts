import { describe, it, expect, vi } from 'vitest';
import { harness } from './helpers/harness.js';
import { DefaultsManager } from '../src/model-manager.js';

/** A Replicate client backed by a real DefaultsManager, so defaults actually move. */
function replicateWithDefaults(overrides: Record<string, any> = {}) {
  const dm = new DefaultsManager();
  return {
    getDefaultModel: () => dm.getDefault('model'),
    getAllDefaults: () => dm.getAllDefaults(),
    getDefault: (k: string) => dm.getDefault(k),
    setDefault: (k: string, v: any) => dm.setDefault(k, v),
    getAvailableModels: () => dm.getAvailableModels(),
    ...overrides
  } as any;
}

describe('get_defaults', () => {
  it('lists the current defaults', async () => {
    const h = harness({ replicateClient: replicateWithDefaults() });
    const res = await h.call('get_defaults', {});
    expect(res.isError).toBeFalsy();
    expect(res.content[0].text).toContain('flux-1.1-pro-ultra');
  });

  it('requires a Replicate client', async () => {
    const res = await harness({ replicateClient: null }).call('get_defaults', {});
    expect(res.isError).toBe(true);
  });
});

describe('set_default', () => {
  it('applies a valid change', async () => {
    const client = replicateWithDefaults();
    const h = harness({ replicateClient: client });
    const res = await h.call('set_default', { option: 'outputFormat', value: 'webp' });
    expect(res.isError).toBeFalsy();
    expect(client.getDefault('outputFormat')).toBe('webp');
  });

  it('reports a rejected value without throwing', async () => {
    const h = harness({ replicateClient: replicateWithDefaults() });
    const res = await h.call('set_default', { option: 'outputFormat', value: 'gif' });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/Invalid output format/);
  });

  it('reports an invalid model id', async () => {
    const h = harness({ replicateClient: replicateWithDefaults() });
    const res = await h.call('set_default', { option: 'model', value: 'not/a-model' });
    expect(res.isError).toBe(true);
  });

  it('requires a Replicate client', async () => {
    const res = await harness({ replicateClient: null }).call('set_default', { option: 'raw', value: true });
    expect(res.isError).toBe(true);
  });

  it('surfaces an unexpected failure from the client', async () => {
    const client = replicateWithDefaults({ setDefault: vi.fn(() => { throw new Error('storage broke'); }) });
    const res = await harness({ replicateClient: client }).call('set_default', { option: 'raw', value: true });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/storage broke/);
  });
});
