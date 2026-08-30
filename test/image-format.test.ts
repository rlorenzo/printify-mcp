import { describe, it, expect, vi } from 'vitest';
import { buildModelOptions, mimeTypeFor, extensionFor, withExtension, applyOutputFormat } from '../src/services/image-format.js';

describe('buildModelOptions', () => {
  it('defaults to 1024x1024 when nothing is given', () => {
    expect(buildModelOptions()).toEqual({ width: 1024, height: 1024, outputFormat: 'png' });
  });

  // Ratio and explicit size are mutually exclusive on the wire.
  it('sends aspectRatio alone when provided', () => {
    const o = buildModelOptions({ aspectRatio: '16:9', width: 800, height: 600 });
    expect(o.aspectRatio).toBe('16:9');
    expect(o).not.toHaveProperty('width');
    expect(o).not.toHaveProperty('height');
  });

  it('sends width and height when no ratio is given', () => {
    const o = buildModelOptions({ width: 800, height: 600 });
    expect(o).toMatchObject({ width: 800, height: 600 });
    expect(o).not.toHaveProperty('aspectRatio');
  });

  it('passes through truthy common parameters', () => {
    const o = buildModelOptions({ numInferenceSteps: 40, guidanceScale: 9, negativePrompt: 'blur', model: 'm' });
    expect(o).toMatchObject({ numInferenceSteps: 40, guidanceScale: 9, negativePrompt: 'blur', model: 'm' });
  });

  it('omits truthy-checked parameters when they are falsy', () => {
    const o = buildModelOptions({ numInferenceSteps: 0, negativePrompt: '' });
    expect(o).not.toHaveProperty('numInferenceSteps');
    expect(o).not.toHaveProperty('negativePrompt');
  });

  // These use a defined check, so a deliberate 0 / false must survive.
  it.each([
    ['seed', 0], ['safetyTolerance', 0], ['promptUpsampling', false],
    ['outputQuality', 0], ['raw', false], ['imagePromptStrength', 0]
  ])('preserves a falsy but defined %s', (key, value) => {
    expect(buildModelOptions({ [key]: value })[key]).toBe(value);
  });

  it('omits defined-checked parameters when undefined', () => {
    expect(buildModelOptions({ seed: undefined })).not.toHaveProperty('seed');
  });

  it('always sets an output format, defaulting to png', () => {
    expect(buildModelOptions({}).outputFormat).toBe('png');
    expect(buildModelOptions({ outputFormat: 'webp' }).outputFormat).toBe('webp');
  });
});

describe('format helpers', () => {
  it.each([['jpeg', 'image/jpeg'], ['jpg', 'image/jpeg'], ['webp', 'image/webp'], ['png', 'image/png'], ['tiff', 'image/png']])(
    'mimeTypeFor(%s) is %s', (fmt, expected) => expect(mimeTypeFor(fmt)).toBe(expected)
  );

  it('stores jpeg as .jpg', () => {
    expect(extensionFor('jpeg')).toBe('jpg');
    expect(extensionFor('png')).toBe('png');
  });

  it('appends the extension only when missing', () => {
    expect(withExtension('cat', 'png')).toBe('cat.png');
    expect(withExtension('cat.png', 'png')).toBe('cat.png');
    expect(withExtension('cat', 'jpeg')).toBe('cat.jpg');
    expect(withExtension('cat.jpg', 'jpeg')).toBe('cat.jpg');
    // jpeg and jpg name the same extension, and case must not matter, so
    // neither turns into cat.jpeg.jpg.
    expect(withExtension('cat.jpeg', 'jpeg')).toBe('cat.jpeg');
    expect(withExtension('cat.JPEG', 'jpeg')).toBe('cat.JPEG');
    expect(withExtension('cat.PNG', 'png')).toBe('cat.PNG');
  });

  it('re-encodes at full quality for the requested format', () => {
    const inst = { png: vi.fn().mockReturnThis(), jpeg: vi.fn().mockReturnThis(), webp: vi.fn().mockReturnThis() };
    applyOutputFormat(inst as any, 'png');
    expect(inst.png).toHaveBeenCalledWith({ quality: 100 });
    applyOutputFormat(inst as any, 'jpg');
    expect(inst.jpeg).toHaveBeenCalledWith({ quality: 100 });
    applyOutputFormat(inst as any, 'webp');
    expect(inst.webp).toHaveBeenCalledWith({ quality: 100 });
  });

  it('leaves an unknown format untouched', () => {
    const inst = { png: vi.fn().mockReturnThis(), jpeg: vi.fn().mockReturnThis(), webp: vi.fn().mockReturnThis() };
    expect(applyOutputFormat(inst as any, 'tiff')).toBe(inst);
    expect(inst.png).not.toHaveBeenCalled();
  });
});
