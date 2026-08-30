import { describe, it, expect, beforeEach } from 'vitest';
import { DefaultsManager } from '../src/model-manager.js';

const ULTRA = 'black-forest-labs/flux-1.1-pro-ultra';
const PRO = 'black-forest-labs/flux-1.1-pro';

let dm: DefaultsManager;
beforeEach(() => { dm = new DefaultsManager(); });

describe('getAvailableModels', () => {
  it('lists both models with their capabilities', () => {
    const models = dm.getAvailableModels();
    expect(models.map((m) => m.id)).toEqual([PRO, ULTRA]);
    expect(models.every((m) => m.capabilities.length > 0)).toBe(true);
  });
});

describe('setDefault validation', () => {
  it('accepts a known model and rejects an unknown one', () => {
    expect(() => dm.setDefault('model', PRO)).not.toThrow();
    expect(dm.getDefault('model')).toBe(PRO);
    expect(() => dm.setDefault('model', 'stability/sdxl')).toThrow(/Invalid model ID/);
  });

  it.each([['16:9'], ['4:3'], ['1:1'], ['21:9']])('accepts aspect ratio %s', (v) => {
    expect(() => dm.setDefault('aspectRatio', v)).not.toThrow();
  });

  it.each([['16x9'], ['widescreen'], ['16:'], [':9']])('rejects aspect ratio %s', (v) => {
    expect(() => dm.setDefault('aspectRatio', v)).toThrow(/Invalid aspect ratio format/);
  });

  it.each([['png'], ['jpeg'], ['jpg'], ['webp']])('accepts output format %s', (v) => {
    expect(() => dm.setDefault('outputFormat', v)).not.toThrow();
  });

  it('rejects an unsupported output format', () => {
    expect(() => dm.setDefault('outputFormat', 'gif')).toThrow(/Invalid output format/);
  });

  it.each(['width', 'height', 'numInferenceSteps', 'safetyTolerance', 'outputQuality'])(
    '%s must be a positive number', (opt) => {
      expect(() => dm.setDefault(opt, 512)).not.toThrow();
      expect(() => dm.setDefault(opt, 0)).toThrow(/Expected a positive number/);
      expect(() => dm.setDefault(opt, -1)).toThrow(/Expected a positive number/);
      expect(() => dm.setDefault(opt, '512')).toThrow(/Expected a positive number/);
    }
  );

  it('bounds guidanceScale to 1..20', () => {
    expect(() => dm.setDefault('guidanceScale', 7.5)).not.toThrow();
    expect(() => dm.setDefault('guidanceScale', 1)).not.toThrow();
    expect(() => dm.setDefault('guidanceScale', 20)).not.toThrow();
    expect(() => dm.setDefault('guidanceScale', 0.9)).toThrow(/between 1 and 20/);
    expect(() => dm.setDefault('guidanceScale', 21)).toThrow(/between 1 and 20/);
    expect(() => dm.setDefault('guidanceScale', 'high')).toThrow(/between 1 and 20/);
  });

  it.each(['raw', 'promptUpsampling'])('%s must be boolean', (opt) => {
    expect(() => dm.setDefault(opt, true)).not.toThrow();
    expect(() => dm.setDefault(opt, 'yes')).toThrow(/Expected a boolean/);
  });

  it('negativePrompt must be a string', () => {
    expect(() => dm.setDefault('negativePrompt', 'blurry')).not.toThrow();
    expect(() => dm.setDefault('negativePrompt', 5)).toThrow(/Expected a string/);
  });

  it('passes through unknown options without validation', () => {
    expect(() => dm.setDefault('somethingNew', { any: 'shape' })).not.toThrow();
    expect(dm.getDefault('somethingNew')).toEqual({ any: 'shape' });
  });
});

describe('setDefault dimension exclusivity', () => {
  // Aspect ratio and explicit dimensions are mutually exclusive; setting one
  // must clear the other or the model receives contradictory input.
  it('setting aspectRatio clears width and height', () => {
    dm.setDefault('width', 512);
    dm.setDefault('height', 512);
    dm.setDefault('aspectRatio', '16:9');
    const all = dm.getAllDefaults();
    expect(all.aspectRatio).toBe('16:9');
    expect(all).not.toHaveProperty('width');
    expect(all).not.toHaveProperty('height');
  });

  it.each(['width', 'height'])('setting %s clears aspectRatio', (opt) => {
    dm.setDefault('aspectRatio', '16:9');
    dm.setDefault(opt, 768);
    const all = dm.getAllDefaults();
    expect(all).not.toHaveProperty('aspectRatio');
    expect(all[opt]).toBe(768);
  });

  it('returns a copy, so callers cannot mutate the defaults', () => {
    const all = dm.getAllDefaults();
    all.model = 'tampered';
    expect(dm.getDefault('model')).not.toBe('tampered');
  });
});

describe('prepareModelInput model-specific parameters', () => {
  it('sends raw for the Ultra model and not Pro fields', () => {
    const { modelId, input } = dm.prepareModelInput('a cat', { model: ULTRA });
    expect(modelId).toBe(ULTRA);
    expect(input.raw).toBe(false);
    expect(input).not.toHaveProperty('prompt_upsampling');
    expect(input).not.toHaveProperty('output_quality');
  });

  it('honours an explicit raw override on Ultra', () => {
    expect(dm.prepareModelInput('x', { model: ULTRA, raw: true }).input.raw).toBe(true);
  });

  it('includes image_prompt_strength on Ultra only when supplied', () => {
    expect(dm.prepareModelInput('x', { model: ULTRA }).input).not.toHaveProperty('image_prompt_strength');
    expect(dm.prepareModelInput('x', { model: ULTRA, imagePromptStrength: 0.4 }).input.image_prompt_strength).toBe(0.4);
  });

  it('sends prompt_upsampling and output_quality for Pro, not raw', () => {
    const { input } = dm.prepareModelInput('x', { model: PRO });
    expect(input.prompt_upsampling).toBe(true);
    expect(input.output_quality).toBe(90);
    expect(input).not.toHaveProperty('raw');
  });

  it('honours Pro overrides', () => {
    const { input } = dm.prepareModelInput('x', { model: PRO, promptUpsampling: false, outputQuality: 50 });
    expect(input.prompt_upsampling).toBe(false);
    expect(input.output_quality).toBe(50);
  });

  it('falls back to the default model when none is given', () => {
    expect(dm.prepareModelInput('x').modelId).toBe(ULTRA);
  });
});

describe('prepareModelInput dimension resolution', () => {
  // Exactly one of aspect_ratio / width+height must reach the model.
  it('prefers an explicit aspectRatio over everything', () => {
    dm.setDefault('width', 512);
    dm.setDefault('height', 512);
    const { input } = dm.prepareModelInput('x', { aspectRatio: '21:9', width: 100, height: 100 });
    expect(input.aspect_ratio).toBe('21:9');
    expect(input).not.toHaveProperty('width');
  });

  it('uses explicit width and height when no aspectRatio is given', () => {
    const { input } = dm.prepareModelInput('x', { width: 800, height: 600 });
    expect(input.width).toBe(800);
    expect(input.height).toBe(600);
    expect(input).not.toHaveProperty('aspect_ratio');
  });

  it('falls back to the default aspectRatio', () => {
    expect(dm.prepareModelInput('x').input.aspect_ratio).toBe('1:1');
  });

  it('falls back to default width and height when no default aspectRatio exists', () => {
    dm.setDefault('width', 640);
    dm.setDefault('height', 480);
    const { input } = dm.prepareModelInput('x');
    expect(input.width).toBe(640);
    expect(input.height).toBe(480);
    expect(input).not.toHaveProperty('aspect_ratio');
  });

  it('falls back to 1:1 when defaults hold neither a ratio nor a full size', () => {
    // Reaching the final fallback takes a specific sequence: setting
    // aspectRatio drops width and height, then setting height alone drops
    // aspectRatio again, leaving no ratio and only half a size.
    dm.setDefault('aspectRatio', '16:9');
    dm.setDefault('height', 500);
    const all = dm.getAllDefaults();
    expect(all).not.toHaveProperty('aspectRatio');
    expect(all).not.toHaveProperty('width');
    expect(dm.prepareModelInput('x').input.aspect_ratio).toBe('1:1');
  });

  it('ignores a partial width-only option', () => {
    expect(dm.prepareModelInput('x', { width: 800 }).input.aspect_ratio).toBe('1:1');
  });
});

describe('prepareModelInput common parameters', () => {
  it('always carries the prompt', () => {
    expect(dm.prepareModelInput('a red bicycle').input.prompt).toBe('a red bicycle');
  });

  it('includes seed only when supplied', () => {
    expect(dm.prepareModelInput('x').input).not.toHaveProperty('seed');
    expect(dm.prepareModelInput('x', { seed: 7 }).input.seed).toBe(7);
  });

  it('applies defaults for the remaining parameters', () => {
    const { input } = dm.prepareModelInput('x');
    expect(input.num_inference_steps).toBe(25);
    expect(input.guidance_scale).toBe(7.5);
    expect(input.negative_prompt).toBe('low quality, bad quality, sketches');
    expect(input.output_format).toBe('png');
    expect(input.safety_tolerance).toBe(2);
  });

  it('overrides the remaining parameters when supplied', () => {
    const { input } = dm.prepareModelInput('x', {
      numInferenceSteps: 40, guidanceScale: 12, negativePrompt: 'blurry',
      outputFormat: 'webp', safetyTolerance: 5
    });
    expect(input.num_inference_steps).toBe(40);
    expect(input.guidance_scale).toBe(12);
    expect(input.negative_prompt).toBe('blurry');
    expect(input.output_format).toBe('webp');
    expect(input.safety_tolerance).toBe(5);
  });

  // safetyTolerance uses !== undefined, so 0 survives where || would drop it.
  it('preserves a safetyTolerance of 0', () => {
    expect(dm.prepareModelInput('x', { safetyTolerance: 0 }).input.safety_tolerance).toBe(0);
  });
});
