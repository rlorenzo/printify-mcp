import { describe, it, expect, vi } from 'vitest';
import { runService } from '../src/utils/error-handler.js';

describe('runService', () => {
  it('wraps a result as success', async () => {
    const r = await runService('Step', {}, async () => ({ response: 'ok' }));
    expect(r).toEqual({ success: true, response: 'ok' });
  });

  // The wrapper owns the envelope. The type forbids `success` on the result;
  // this checks the runtime too, for a result that slips past the types.
  it('keeps success true even if the service returns its own success flag', async () => {
    const r = await runService('Step', {}, async () => ({ response: 'ok', success: false }) as any);
    expect(r.success).toBe(true);
  });

  it('turns a throw into a formatted failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await runService('Fetch Thing', { tips: ['check the key'] }, async () => {
      throw new Error('boom');
    });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.errorResponse.isError).toBe(true);
    expect(r.errorResponse.content[0].text).toContain('Fetch Thing');
    expect(r.errorResponse.content[0].text).toContain('boom');
  });

  // The context builder reads live state the failure may have broken; a
  // throw there must not replace the original error.
  it('still reports the original error when the context builder throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await runService(
      'Fetch Thing',
      { context: () => { throw new Error('context broke'); } },
      async () => { throw new Error('original failure'); }
    );
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.errorResponse.content[0].text).toContain('original failure');
    expect(r.errorResponse.content[0].text).not.toContain('context broke');
  });
});
