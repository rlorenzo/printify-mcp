import { describe, it, expect, vi } from 'vitest';
import { requiresImgbb, hasImgbbKey, stageOnImgbb } from '../src/services/imgbb.js';

const ULTRA = 'black-forest-labs/flux-1.1-pro-ultra';
const PRO = 'black-forest-labs/flux-1.1-pro';

class FakeFormData { appended: any[] = []; append(k: string, v: any) { this.appended.push([k, v]); } }
// Note: an explicit `apiKey: undefined` must not fall back to a default.
const deps = (post: any, apiKey: string | undefined = 'key') =>
  ({ axios: { post }, FormData: FakeFormData, apiKey });
const depsNoKey = (post: any) => ({ axios: { post }, FormData: FakeFormData, apiKey: undefined });
const ok = vi.fn(async () => ({ data: { data: { url: 'https://i.test/x.png' } } }));

describe('requiresImgbb / hasImgbbKey', () => {
  it('only the Ultra model requires ImgBB', () => {
    expect(requiresImgbb(ULTRA)).toBe(true);
    expect(requiresImgbb(PRO)).toBe(false);
  });

  it('treats the placeholder key as absent', () => {
    expect(hasImgbbKey('real-key')).toBe(true);
    expect(hasImgbbKey('your-imgbb-api-key')).toBe(false);
    expect(hasImgbbKey('')).toBe(false);
    expect(hasImgbbKey(undefined)).toBe(false);
  });
});

describe('stageOnImgbb', () => {
  it('uploads and returns the hosted URL', async () => {
    const r = await stageOnImgbb(Buffer.from('img'), PRO, deps(ok));
    expect(r).toEqual({ method: 'imgbb', imageUrl: 'https://i.test/x.png' });
    expect(ok.mock.calls[0][0]).toContain('key=key');
  });

  it('sends the image as base64', async () => {
    const post = vi.fn(async () => ({ data: { data: { url: 'u' } } }));
    await stageOnImgbb(Buffer.from('hi'), PRO, deps(post));
    expect(post.mock.calls[0][1].appended[0]).toEqual(['image', Buffer.from('hi').toString('base64')]);
  });

  it('falls back to direct upload when no key is set', async () => {
    expect(await stageOnImgbb(Buffer.from('x'), PRO, depsNoKey(ok))).toEqual({ method: 'direct' });
  });

  // Ultra images are too large for direct upload, so a missing key is terminal.
  it('fails for Ultra when no key is set', async () => {
    const r = await stageOnImgbb(Buffer.from('x'), ULTRA, depsNoKey(ok));
    expect(r.method).toBe('failed');
    expect((r as any).message).toMatch(/IMGBB_API_KEY/);
  });

  it('falls back to direct when a non-Ultra upload fails', async () => {
    const post = vi.fn(async () => { throw new Error('imgbb down'); });
    expect(await stageOnImgbb(Buffer.from('x'), PRO, deps(post))).toEqual({ method: 'direct' });
  });

  it('fails when an Ultra upload fails', async () => {
    const post = vi.fn(async () => { throw new Error('imgbb down'); });
    const r = await stageOnImgbb(Buffer.from('x'), ULTRA, deps(post));
    expect(r.method).toBe('failed');
    expect((r as any).message).toMatch(/cannot be bypassed/);
  });
});
