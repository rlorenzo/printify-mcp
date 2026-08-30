import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toApiOptions, coerceOutputToBuffer } from '../src/replicate-output.js';

vi.mock('axios', () => ({
  default: { get: vi.fn(async (url: string) => ({ data: Buffer.from(`bytes-from:${url}`) })) }
}));
const axios = (await import('axios')).default as any;
beforeEach(() => axios.get.mockClear());

describe('toApiOptions', () => {
  it('always sets output_format, defaulting to png', () => {
    expect(toApiOptions().output_format).toBe('png');
    expect(toApiOptions({ outputFormat: 'webp' }).output_format).toBe('webp');
  });

  it('renames camelCase options to snake_case', () => {
    expect(toApiOptions({
      aspectRatio: '16:9', numInferenceSteps: 30, guidanceScale: 8,
      negativePrompt: 'blur', imagePromptStrength: 0.5
    })).toMatchObject({
      aspect_ratio: '16:9', num_inference_steps: 30, guidance_scale: 8,
      negative_prompt: 'blur', image_prompt_strength: 0.5
    });
  });

  // seed 0, safety 0 and false flags are meaningful and must survive.
  it.each([['seed', 0, 'seed'], ['safetyTolerance', 0, 'safety_tolerance'],
           ['promptUpsampling', false, 'prompt_upsampling'], ['raw', false, 'raw'],
           ['outputQuality', 0, 'output_quality']])(
    'preserves falsy-but-defined %s', (from, value, to) => {
      expect(toApiOptions({ [from]: value })[to]).toBe(value);
    });

  it('drops truthy-checked options when falsy', () => {
    const o = toApiOptions({ width: 0, negativePrompt: '' });
    expect(o).not.toHaveProperty('width');
    expect(o).not.toHaveProperty('negative_prompt');
  });
});

describe('coerceOutputToBuffer', () => {
  it.each([[null], [undefined]])('rejects %s output', async (v) => {
    await expect(coerceOutputToBuffer(v)).rejects.toThrow(/null or undefined/);
  });

  it('downloads a URL string', async () => {
    const buf = await coerceOutputToBuffer('https://example.test/i.png');
    expect(buf.toString()).toBe('bytes-from:https://example.test/i.png');
  });

  it('passes a Buffer through unchanged', async () => {
    const b = Buffer.from('already bytes');
    expect(await coerceOutputToBuffer(b)).toBe(b);
  });

  it('converts a Uint8Array', async () => {
    expect((await coerceOutputToBuffer(new Uint8Array([1, 2, 3]))).equals(Buffer.from([1, 2, 3]))).toBe(true);
  });

  it('converts an ArrayBuffer', async () => {
    expect((await coerceOutputToBuffer(new Uint8Array([4, 5]).buffer)).equals(Buffer.from([4, 5]))).toBe(true);
  });

  it('reads a FileOutput-style .file property', async () => {
    const out = { file: { arrayBuffer: async () => new Uint8Array([7]).buffer } };
    expect((await coerceOutputToBuffer(out)).equals(Buffer.from([7]))).toBe(true);
  });

  it('reads an .arrayBuffer() method', async () => {
    expect((await coerceOutputToBuffer({ arrayBuffer: async () => new Uint8Array([8]).buffer })).equals(Buffer.from([8]))).toBe(true);
  });

  it('reads a .blob() method', async () => {
    const out = { blob: async () => ({ arrayBuffer: async () => new Uint8Array([9]).buffer }) };
    expect((await coerceOutputToBuffer(out)).equals(Buffer.from([9]))).toBe(true);
  });

  it('treats .text() returning a URL as a download', async () => {
    const buf = await coerceOutputToBuffer({ text: async () => 'https://example.test/t.png' });
    expect(buf.toString()).toBe('bytes-from:https://example.test/t.png');
  });

  it('treats non-URL .text() as raw bytes', async () => {
    expect((await coerceOutputToBuffer({ text: async () => 'raw payload' })).toString()).toBe('raw payload');
  });

  it('falls back to toString() when it yields a URL', async () => {
    const out = { toString: () => 'https://example.test/s.png' };
    expect((await coerceOutputToBuffer(out)).toString()).toBe('bytes-from:https://example.test/s.png');
  });

  it('rejects an object that is not a URL and exposes no accessor', async () => {
    await expect(coerceOutputToBuffer({ nothing: true })).rejects.toThrow(/Unsupported Replicate output type/);
  });

  it('rejects an unsupported primitive', async () => {
    await expect(coerceOutputToBuffer(42)).rejects.toThrow(/Unsupported Replicate output type: number/);
  });
});
