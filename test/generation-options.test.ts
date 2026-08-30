import { describe, it, expect } from 'vitest';
import { mergeGenerationOptions } from '../src/generation-options.js';

const defaults = {
  model: 'flux-1.1-pro', width: 1024, height: 1024, aspectRatio: '1:1',
  outputFormat: 'png', safetyTolerance: 2, numInferenceSteps: 25,
  guidanceScale: 7.5, negativePrompt: 'low quality', raw: false,
  promptUpsampling: false, outputQuality: 80
};

describe('mergeGenerationOptions', () => {
  it('uses defaults when no arguments are given', () => {
    expect(mergeGenerationOptions(defaults, {})).toEqual(defaults);
  });

  it('lets an explicit argument win', () => {
    const out = mergeGenerationOptions(defaults, { width: 512, model: 'flux-1.1-pro-ultra' });
    expect(out.width).toBe(512);
    expect(out.model).toBe('flux-1.1-pro-ultra');
    expect(out.height).toBe(1024);
  });

  // The whole reason this is a key-by-key merge: a spread would overwrite every
  // default with undefined for arguments the caller omitted.
  it('does not let an undefined argument clobber its default', () => {
    const out = mergeGenerationOptions(defaults, { width: undefined, model: undefined, height: 768 });
    expect(out.width).toBe(1024);
    expect(out.model).toBe('flux-1.1-pro');
    expect(out.height).toBe(768);
  });

  it('preserves falsy values that are not undefined', () => {
    const out = mergeGenerationOptions(defaults, { raw: false, safetyTolerance: 0, negativePrompt: '' });
    expect(out.raw).toBe(false);
    expect(out.safetyTolerance).toBe(0);
    expect(out.negativePrompt).toBe('');
  });

  // seed has no default; it only appears when a caller asks for one.
  it('omits seed unless supplied, then passes it through', () => {
    expect(mergeGenerationOptions(defaults, {})).not.toHaveProperty('seed');
    expect(mergeGenerationOptions(defaults, { seed: 42 }).seed).toBe(42);
  });

  it('passes through options that have no default, such as imagePromptStrength', () => {
    expect(mergeGenerationOptions(defaults, { imagePromptStrength: 0.4 }).imagePromptStrength).toBe(0.4);
  });

  it('does not mutate the defaults it is given', () => {
    const snapshot = { ...defaults };
    mergeGenerationOptions(defaults, { width: 1 });
    expect(defaults).toEqual(snapshot);
  });
});
